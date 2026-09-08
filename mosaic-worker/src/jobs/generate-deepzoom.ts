import { jobLogger } from '../lib/logger';
import { createJobEventBus } from '../lib/events';
import { createProgressService, updateMosaic, maybePromoteReady } from '../lib/progress';
import { startCreep } from '../lib/progress-creep';
import { CHECKPOINT } from '../lib/checkpoints';
import { getSuite } from '../algorithms/registry';
import { readMaster, releaseMaster } from '../lib/master-file';


/**
 * Job B — Build Deep Zoom (single-master pipeline).
 *
 * Reads the 24k master JPEG that Job A wrote to `/tmp` (no download from
 * Storage), builds the DZI pyramid + tiles, and persists:
 *   - `dzi_url`
 *   - `tile_base_url`
 *   - `image_url` (set to the DZI manifest URL — this is what unlocks
 *      the "Open Interactive Mosaic" button in the UI)
 *   - `dzi_status = 'ready'`
 *   - `deepzoom_ready = true`
 *
 * Failure here never demotes the mosaic from READY; the row is left with
 * `dzi_status = 'failed'` and the Interactive button stays hidden.
 */

export interface GenerateDeepZoomInput {
  jobId: string;
  workerId: string;
  eventId: string;
  mosaicId: string;
  /** Local /tmp path to the 24k JPEG master produced by Job A. */
  masterPath: string;
  suite?: string;
}

import { throwIfCancelled, registerActive, unregisterActive, watchCancellation } from '../lib/cancellation';

export async function runGenerateDeepZoom(input: GenerateDeepZoomInput): Promise<void> {
  const { jobId, workerId, eventId, mosaicId, masterPath } = input;
  const log = jobLogger(jobId, eventId);
  const bus = createJobEventBus();
  const progress = createProgressService(mosaicId);
  const detach = progress.attach(bus);
  const tJobStart = Date.now();
  registerActive(mosaicId, eventId);
  const stopCancelWatch = watchCancellation(mosaicId);

  try {
    throwIfCancelled(mosaicId);
    await progress.markClaimed(workerId);
    // Job B never writes the main `status` column — that stays at
    // FINALIZING until BOTH background jobs finish (see maybePromoteReady).
    // We only touch the `dzi_status` sidecar column + `deepzoom_progress`.
    await updateMosaic(mosaicId, { dzi_status: 'processing', deepzoom_progress: 0 } as never);

    bus.emit({
      type: 'checkpoint',
      name: CHECKPOINT.DEEPZOOM_STARTED,
      data: { source: masterPath },
    });

    const tRead = Date.now();
    const fullBuf = await readMaster(masterPath);
    log.info(
      { elapsedMs: Date.now() - tRead, bytes: fullBuf.length, path: masterPath },
      'timing:dzi-master-read',
    );

    throwIfCancelled(mosaicId);
    const suite = getSuite(input.suite);
    const tBuild = Date.now();
    // Transient upstream failures (Storage 502/504, tile PUT timeouts) are
    // common enough that a single-shot failure shouldn't cost the user the
    // Interactive Mosaic. Retry the whole build once with a short backoff
    // before surfacing `dzi_status = 'failed'`.
    const isTransient = (e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      return /timeout|gateway|ETIMEDOUT|ECONNRESET|EAI_AGAIN|502|503|504|network/i.test(msg);
    };
    // Fine-grained creep for the DZI band (71 → 92). Real completion
    // will jump to 92 via the stage/DEEPZOOM_READY write below.
    const dziCreep = startCreep({
      bus,
      from: 71,
      to: 92,
      durationMs: 45_000,
      note: 'deepzoom',
    });
    let out;
    try {
      try {
        out = await suite.deepZoom.build(fullBuf, { eventId, mosaicId });
      } catch (firstErr) {
        if (!isTransient(firstErr)) throw firstErr;
        log.warn(
          { err: firstErr instanceof Error ? firstErr.message : String(firstErr) },
          'dzi:transient-failure, retrying once',
        );
        await new Promise((r) => setTimeout(r, 2000));
        out = await suite.deepZoom.build(fullBuf, { eventId, mosaicId });
      }
    } finally {
      dziCreep.stop(92);
    }
    log.info({ elapsedMs: Date.now() - tBuild }, 'timing:dzi-build-and-upload-total');

    bus.emit({ type: 'deepzoom', manifestUrl: out.manifestUrl, tileBaseUrl: out.tileBaseUrl });
    // image_url is the DZI entry point — the frontend uses its presence
    // to decide whether to show the "Open Interactive Mosaic" button.
    await updateMosaic(mosaicId, {
      image_url: out.manifestUrl,
      dzi_status: 'ready',
      deepzoom_ready: true,
      deepzoom_progress: 100,
    } as never);
    bus.emit({
      type: 'checkpoint',
      name: CHECKPOINT.DEEPZOOM_COMPLETED,
      data: { builder: suite.deepZoom.name, manifestUrl: out.manifestUrl },
    });

    // Try to promote to READY — the other job may already be done.
    await maybePromoteReady(mosaicId);

    const totalMs = Date.now() - tJobStart;
    log.info({ mosaicId, elapsedMs: totalMs }, 'job-b:done');
    log.info(
      {
        mosaicId,
        masterReadMs: null,
        dziBuildAndUploadMs: null,
        totalJobB: totalMs,
      },
      'PIPELINE SUMMARY (Job B - DZI)',
    );

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateMosaic(mosaicId, { dzi_status: 'failed' } as never).catch(() => undefined);
    // Even if DZI build failed, the print job may already be done —
    // promote so the mosaic doesn't get stuck at 'finalizing'.
    await maybePromoteReady(mosaicId).catch(() => undefined);
    throw err instanceof Error ? err : new Error(message);
  } finally {
    stopCancelWatch();
    unregisterActive(mosaicId);
    detach();
    await releaseMaster(masterPath);
  }
}
