import { randomUUID } from 'crypto';
import { config } from '../config';
import { logger } from '../lib/logger';
import { createProgressService } from '../lib/progress';
import { runGenerateMosaic } from '../jobs/generate-mosaic';
import { runGenerateDeepZoom } from '../jobs/generate-deepzoom';
import { runUploadPrint } from '../jobs/upload-print';
import { runGenerateArchive } from '../jobs/generate-archive';
import { runOptimizeUpload } from '../jobs/optimize-upload';
import { cancelMosaic, isCancelled, isCancelledError, clearCancel } from '../lib/cancellation';
import type {
  EnqueueOptions,
  EnqueueResult,
  JobKind,
  JobPayloadMap,
  Queue,
  QueueStats,
  QueuedJob,
} from './queue';

/**
 * In-process queue driver.
 *
 * - Bounded concurrency (`MAX_CONCURRENT_JOBS`).
 * - Hard wall-clock timeout per job.
 * - Chains `generate-deepzoom` after a successful `generate-mosaic`.
 *
 * It satisfies the `Queue` contract so it can be replaced by a
 * DB-backed `SupabaseLeaseQueue` later (see queue.ts header) without
 * any caller change. All callers only depend on `Queue`, never on this
 * file directly.
 */
export class InProcessQueue implements Queue {
  readonly driver = 'in-process';
  readonly workerId = `worker-${randomUUID()}`;

  private items: QueuedJob[] = [];
  private running = 0;
  private stopping = false;
  private idleResolvers: Array<() => void> = [];

  /**
   * Cancels a mosaic: drops any of its jobs still waiting in the queue and
   * flags the in-flight one so it aborts at its next checkpoint.
   */
  cancel(mosaicId: string): { dropped: number } {
    cancelMosaic(mosaicId);
    const before = this.items.length;
    this.items = this.items.filter((item) => {
      const p = item.payload as { mosaicId?: string };
      return p.mosaicId !== mosaicId;
    });
    const dropped = before - this.items.length;
    logger.info({ mosaicId, dropped }, 'queue:cancelled');
    return { dropped };
  }

  enqueue<K extends JobKind>(
    kind: K,
    payload: JobPayloadMap[K],
    options?: EnqueueOptions,
  ): EnqueueResult {
    const jobId = options?.jobId ?? randomUUID();
    if (kind === 'generate-mosaic') {
      const p = payload as JobPayloadMap['generate-mosaic'];
      clearCancel(p.mosaicId, p.eventId);
    }
    const job: QueuedJob<K> = {
      kind,
      jobId,
      payload,
      enqueuedAt: Date.now(),
      attempts: 0,
    };
    this.items.push(job as QueuedJob);
    logger.info(
      { jobId, kind, queued: this.items.length, workerId: this.workerId },
      'queue:enqueued',
    );
    this.start();
    return { jobId, queued: this.items.length, running: this.running };
  }

  start(): void {
    logger.info(
      { queued: this.items.length, running: this.running, maxConcurrent: config.MAX_CONCURRENT_JOBS, workerId: this.workerId },
      'start() entered',
    );
    if (this.stopping) return;
    while (this.running < config.MAX_CONCURRENT_JOBS && this.items.length > 0) {
      const item = this.items.shift();
      if (!item) break;
      logger.info(
        { jobId: item.jobId, kind: item.kind, queued: this.items.length, running: this.running, workerId: this.workerId },
        'queue length',
      );
      this.running++;
      void this.runOne(item).finally(() => {
        this.running--;
        if (this.running === 0 && this.items.length === 0) {
          this.idleResolvers.splice(0).forEach((r) => r());
        }
        this.start();
      });
    }
  }

  async drainAndStop(timeoutMs: number): Promise<void> {
    this.stopping = true;
    if (this.running === 0 && this.items.length === 0) return;
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, timeoutMs).unref();
      this.idleResolvers.push(() => {
        clearTimeout(t);
        resolve();
      });
    });
  }

  stats(): QueueStats {
    return {
      queued: this.items.length,
      running: this.running,
      maxConcurrent: config.MAX_CONCURRENT_JOBS,
      workerId: this.workerId,
      driver: this.driver,
    };
  }

  // -- internals ----------------------------------------------------------

  private async runOne(item: QueuedJob): Promise<void> {
    const log = logger.child({
      jobId: item.jobId,
      kind: item.kind,
      workerId: this.workerId,
    });
    const start = Date.now();
    const payloadForDiagnostics = item.payload as Partial<JobPayloadMap['generate-mosaic'] & JobPayloadMap['generate-deepzoom']>;
    const eventId = payloadForDiagnostics.eventId;
    const mosaicId = payloadForDiagnostics.mosaicId;

    log.info({ eventId, mosaicId }, 'runOne() entered');

    // Cancelled while waiting in the queue → never start it.
    if (mosaicId && isCancelled(mosaicId)) {
      log.info({ mosaicId, jobType: item.kind }, 'queue:job-skipped-cancelled');
      return;
    }
    log.info({ eventId, mosaicId, queued: this.items.length, running: this.running, workerId: this.workerId }, 'queue length');

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Job timed out after ${config.JOB_TIMEOUT_MS}ms`)),
        config.JOB_TIMEOUT_MS,
      ),
    );

    try {
      log.info({ eventId, mosaicId, jobType: item.kind }, 'selected job type');
      switch (item.kind) {
        case 'generate-mosaic': {
          const p = item.payload as JobPayloadMap['generate-mosaic'];
          log.info({ eventId: p.eventId, mosaicId: p.mosaicId, jobType: item.kind }, 'just before calling the handler');
          const result = await Promise.race([
            runGenerateMosaic({
              jobId: item.jobId,
              workerId: this.workerId,
              eventId: p.eventId,
              mosaicId: p.mosaicId,
              coverImageUrl: p.coverImageUrl,
              suite: p.suite,
            }),
            timeout,
          ]);
          log.info({ eventId: p.eventId, mosaicId: p.mosaicId, jobType: item.kind }, 'immediately after calling the handler');
          log.info({ ms: Date.now() - start }, 'queue:job-a:complete');

          // --- Chain Jobs B (Deep Zoom) + C (Upload Print) ------------
          // Both read the SAME master.png from /tmp — refcount=2 was set
          // in Job A. The last one to finish deletes the file.
          if (isCancelled(p.mosaicId)) {
            log.info({ mosaicId: p.mosaicId }, 'queue:chain-skipped-cancelled');
            return;
          }
          this.enqueue('generate-deepzoom', {
            eventId: p.eventId,
            mosaicId: p.mosaicId,
            masterPath: result.masterPath,
            suite: p.suite,
          });
          this.enqueue('upload-print', {
            eventId: p.eventId,
            mosaicId: p.mosaicId,
            masterPath: result.masterPath,
          });
          return;
        }

        case 'generate-deepzoom': {
          const p = item.payload as JobPayloadMap['generate-deepzoom'];
          log.info({ eventId: p.eventId, mosaicId: p.mosaicId, jobType: item.kind }, 'just before calling the handler');
          await Promise.race([
            runGenerateDeepZoom({
              jobId: item.jobId,
              workerId: this.workerId,
              eventId: p.eventId,
              mosaicId: p.mosaicId,
              masterPath: p.masterPath,
              suite: p.suite,
            }),
            timeout,
          ]);
          log.info({ eventId: p.eventId, mosaicId: p.mosaicId, jobType: item.kind }, 'immediately after calling the handler');
          log.info({ ms: Date.now() - start }, 'queue:job-b:complete');
          return;
        }
        case 'upload-print': {
          const p = item.payload as JobPayloadMap['upload-print'];
          log.info({ eventId: p.eventId, mosaicId: p.mosaicId, jobType: item.kind }, 'just before calling the handler');
          await Promise.race([
            runUploadPrint({
              jobId: item.jobId,
              workerId: this.workerId,
              eventId: p.eventId,
              mosaicId: p.mosaicId,
              masterPath: p.masterPath,
            }),
            timeout,
          ]);
          log.info({ eventId: p.eventId, mosaicId: p.mosaicId, jobType: item.kind }, 'immediately after calling the handler');
          log.info({ ms: Date.now() - start }, 'queue:job-c:complete');
          return;
        }
        case 'generate-archive': {
          const p = item.payload as JobPayloadMap['generate-archive'];
          log.info({ eventId: p.eventId, batchId: p.batchId, jobType: item.kind }, 'archive job start');
          // No wall-clock race here: a 2,000-photo archive legitimately runs
          // longer than JOB_TIMEOUT_MS, and the job marks its own failure.
          await runGenerateArchive({
            jobId: item.jobId,
            workerId: this.workerId,
            eventId: p.eventId,
            batchId: p.batchId,
          });
          log.info({ ms: Date.now() - start }, 'queue:job-d:complete');
          return;
        }
        case 'optimize-upload': {
          const p = item.payload as JobPayloadMap['optimize-upload'];
          log.info({ eventId: p.eventId, uploadId: p.uploadId, jobType: item.kind }, 'optimize job start');
          await Promise.race([
            runOptimizeUpload({
              jobId: item.jobId,
              workerId: this.workerId,
              eventId: p.eventId,
              uploadId: p.uploadId,
            }),
            timeout,
          ]);
          log.info({ ms: Date.now() - start }, 'queue:job-e:complete');
          return;
        }
        default: {
          const _exhaustive: never = item.kind;
          throw new Error(`Unknown job kind: ${String(_exhaustive)}`);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isCancelledError(err) || /cancelled/i.test(message)) {
        log.info({ eventId, mosaicId, jobType: item.kind }, 'queue:job-cancelled');
        return;
      }
      log.error(
        {
          eventId,
          mosaicId,
          jobType: item.kind,
          message,
          stack: err instanceof Error ? err.stack : undefined,
          err,
        },
        'handler threw',
      );
      log.error({ err, ms: Date.now() - start }, 'queue:job:failed');
      // Job A failure ⇒ mark mosaic as failed.
      // Job B failure ⇒ leave mosaic READY; log + record error.
      // Job C (print) failure ⇒ the job itself writes print_status='failed';
      //   we only need to log here.
      try {
        if (item.kind === 'generate-mosaic') {
          const p = item.payload as JobPayloadMap['generate-mosaic'];
          await createProgressService(p.mosaicId).markFailed(message);
        } else if (item.kind === 'generate-deepzoom') {
          const p = item.payload as JobPayloadMap['generate-deepzoom'];
          await createProgressService(p.mosaicId).apply({
            type: 'log',
            level: 'error',
            msg: 'deepzoom failed',
            meta: { error: message },
          });
        }
      } catch (statusErr) {
        log.error({ err: statusErr }, 'queue:status-write-failed');
      }
    }
  }
}

// Module-level singleton for the running process. Exposed via `getQueue()`
// so future drivers can swap in via env without changing call sites.
let instance: Queue | null = null;

export function getQueue(): Queue {
  if (!instance) instance = new InProcessQueue();
  return instance;
}
