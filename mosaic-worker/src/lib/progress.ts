import { getSupabase } from './supabase';
import { logger } from './logger';
import { STAGE, STAGE_PROGRESS, type Stage } from './stages';
import type { CheckpointName, CheckpointMap, CheckpointRecord } from './checkpoints';
import type { JobEvent, JobEventBus } from './events';

/**
 * Progress service: translates internal `JobEvent`s into atomic updates
 * on the `mosaics` row.
 *
 * This is the ONLY module that should write to `mosaics` from the worker.
 * The generator never imports this file — it only emits events into a
 * `JobEventBus` (see `events.ts`). That decoupling is what lets us
 * change the transport (DB row → Realtime channel → websocket) without
 * touching algorithm code.
 *
 * Schema columns it expects on `public.mosaics`:
 *   - status            text   (Stage value, see stages.ts)
 *   - stage             text   (mirror of status, kept for backward compat)
 *   - progress          int    (0..100 — primary/main bar)
 *   - deepzoom_progress int    (0..100 — secondary DZI bar, optional)
 *   - image_url         text   (DZI manifest URL, set by Job B)
 *   - thumb_url         text   (small preview thumbnail from Job A)
 *   - print_url         text   (24k master JPEG uploaded by Job C)
 *   - print_status      text   ('processing' | 'ready' | 'failed')
 *   - dzi_url           text   (Deep Zoom manifest, optional legacy field)
 *   - tile_base_url     text   (Deep Zoom tile prefix, optional)
 *   - dzi_status        text   ('processing' | 'ready' | 'failed')
 *   - deepzoom_ready    bool
 *   - error             text   nullable
 *   - checkpoints       jsonb  ({ [CheckpointName]: CheckpointRecord })
 *   - worker_id         text   (last worker that wrote)
 *   - metadata          jsonb
 *   - updated_at        timestamptz
 *
 * Columns that don't yet exist in the live schema are written as part of
 * the patch and simply ignored by PostgREST when absent (we surface the
 * warning in logs). A migration adds them when the frontend needs them.
 */

export interface MosaicPatch {
  status?: Stage;
  stage?: Stage;
  progress?: number;
  deepzoom_progress?: number;
  error?: string | null;
  image_url?: string | null;
  thumb_url?: string | null;
  preview_url?: string | null;
  print_url?: string | null;
  dzi_url?: string | null;
  tile_base_url?: string | null;
  deepzoom_ready?: boolean;
  checkpoints?: CheckpointMap;
  worker_id?: string | null;
  metadata?: Record<string, unknown> | null;
  photo_count?: number | null;
  tile_count?: number | null;
  tiles_json?: unknown;
}


/** Direct write helper for callers outside the event stream (e.g. job stats). */
export async function updateMosaic(mosaicId: string, fields: MosaicPatch) {
  await writePatch(mosaicId, fields);
}

/**
 * Promote the mosaic to STAGE.READY iff both downstream jobs have
 * finished successfully (dzi_status === 'ready' AND print_status ===
 * 'ready'). Called from Job B and Job C after each finishes; whichever
 * runs second flips the row. Idempotent — safe to call repeatedly.
 *
 * This enforces the invariant: the user never sees a READY mosaic with
 * Interactive or Print still unavailable.
 */
export async function maybePromoteReady(mosaicId: string): Promise<boolean> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('mosaics')
    .select('status, dzi_status, print_status')
    .eq('id', mosaicId)
    .maybeSingle();
  if (error || !data) {
    logger.warn({ err: error, mosaicId }, 'promote-ready:read-failed');
    return false;
  }
  const row = data as { status: string | null; dzi_status: string | null; print_status: string | null };
  if (row.status === STAGE.READY) return true;
  if (row.status === STAGE.FAILED) return false;
  // Promote to READY once each downstream job has reached a terminal state
  // (ready OR failed). A failed print or DZI does not block the mosaic —
  // the UI hides the corresponding button/link when the sidecar status is
  // not 'ready'. Without this, a transient failure would leave the mosaic
  // stuck at 'finalizing' forever.
  const dziDone = row.dzi_status === 'ready' || row.dzi_status === 'failed';
  const printDone = row.print_status === 'ready' || row.print_status === 'failed';
  if (!dziDone || !printDone) return false;
  await writePatch(mosaicId, {
    status: STAGE.READY,
    stage: STAGE.READY,
    progress: 100,
    deepzoom_ready: row.dzi_status === 'ready',
    error: null,
  });
  logger.info({ mosaicId }, 'promote-ready:mosaic marked READY');
  return true;
}



async function writePatch(mosaicId: string, fields: MosaicPatch) {
  const sb = getSupabase();
  const payload: Record<string, unknown> = {
    ...fields,
    updated_at: new Date().toISOString(),
  };
  // Cancel-safety: once a mosaic reaches a terminal `failed` status (typically
  // set by the client's "Stop generation" action), no further worker writes
  // may resurrect it. The `.neq('status','failed')` predicate turns every
  // stage/progress/variant write into a no-op for cancelled jobs, so the
  // progress bar never comes back and `maybePromoteReady` can't flip a
  // cancelled row to READY.
  logger.info(
    {
      operation: 'UPDATE',
      table: 'public.mosaics',
      file: 'mosaic-worker/src/lib/progress.ts',
      function: 'writePatch',
      line: 108,
      match: { id: mosaicId, statusNot: 'failed' },
      payload,
    },
    'mosaics-db-write:before',
  );
  const { error } = await sb
    .from('mosaics')
    .update(payload)
    .eq('id', mosaicId)
    .neq('status', 'failed');
  if (error) {
    // Elevate schema-mismatch failures (missing column, bad enum, etc.) to
    // ERROR so they cannot silently drop preview_url / print_url writes.
    const msg = (error.message ?? '').toLowerCase();
    const schemaMismatch =
      msg.includes('column') ||
      msg.includes('does not exist') ||
      msg.includes('schema cache') ||
      msg.includes('invalid input');
    if (schemaMismatch) {
      logger.error(
        { err: error, mosaicId, fields: Object.keys(fields), payload },
        'progress:update-failed:SCHEMA-MISMATCH',
      );
    } else {
      logger.warn(
        { err: error, mosaicId, fields: Object.keys(fields), payload },
        'progress:update-failed',
      );
    }
    return;
  }
  // Read the row back so we can prove the values landed. Non-fatal on error.
  try {
    const { data: row } = await sb
      .from('mosaics')
      .select(
        'preview_url, thumb_url, print_url, image_url, dzi_url, tile_base_url, print_status, dzi_status, status, stage, progress',
      )
      .eq('id', mosaicId)
      .maybeSingle();
    logger.info({ mosaicId, ...row }, 'mosaics-db-readback');
  } catch {
    /* readback is diagnostic only */
  }
}

/**
 * Read the current checkpoints map so we can merge new entries instead
 * of overwriting. Returns `{}` on any read error — checkpoint persistence
 * must never block the job.
 */
async function readCheckpoints(mosaicId: string): Promise<CheckpointMap> {
  try {
    const sb = getSupabase();
    const { data } = await sb
      .from('mosaics')
      .select('checkpoints')
      .eq('id', mosaicId)
      .maybeSingle();
    return ((data?.checkpoints as CheckpointMap | null) ?? {}) as CheckpointMap;
  } catch {
    return {};
  }
}

export interface ProgressService {
  /** Apply a single internal event to the DB row. */
  apply(ev: JobEvent): Promise<void>;
  /** Subscribe to a bus and forward all events; returns an unsubscribe. */
  attach(bus: JobEventBus): () => void;
  /** Imperative helpers for orchestrator code outside the event stream. */
  markProcessing(): Promise<void>;
  markClaimed(workerId: string): Promise<void>;
  markFailed(message: string): Promise<void>;
  hasCheckpoint(name: CheckpointName): Promise<boolean>;
}


export function createProgressService(mosaicId: string): ProgressService {
  // In-memory mirror so we can merge checkpoints without a round-trip per
  // event. We hydrate on first checkpoint write.
  let checkpointCache: CheckpointMap | null = null;

  // Server-side monotonic guard for the main `progress` column.
  // Prevents `stage` snap-backs (e.g. finalizing writes 70 after the
  // creep already reached 85) and coalesces sub-1% updates into fewer
  // DB writes so Realtime stays lightweight.
  let lastProgress = -1;
  let lastProgressWriteAt = 0;
  const MIN_WRITE_INTERVAL_MS = 300;

  async function writeProgress(pct: number, force = false): Promise<boolean> {
    const clamped = Math.max(0, Math.min(100, Math.round(pct)));
    if (clamped <= lastProgress && !force) return false;
    const now = Date.now();
    // Throttle non-terminal writes; terminal values (0/100) always flush.
    if (
      !force &&
      clamped < 100 &&
      clamped - lastProgress < 1 &&
      now - lastProgressWriteAt < MIN_WRITE_INTERVAL_MS
    ) {
      return false;
    }
    lastProgress = clamped;
    lastProgressWriteAt = now;
    await writePatch(mosaicId, { progress: clamped });
    return true;
  }

  async function persistCheckpoint(rec: CheckpointRecord) {
    if (!checkpointCache) checkpointCache = await readCheckpoints(mosaicId);
    checkpointCache[rec.name] = rec;
    await writePatch(mosaicId, { checkpoints: checkpointCache });
  }

  return {
    async apply(ev) {
      switch (ev.type) {
        case 'stage': {
          const floor = STAGE_PROGRESS[ev.stage];
          // Stage transitions set status/stage always, but only advance
          // `progress` UP to the band floor — never backwards.
          const patch: MosaicPatch = {
            status: ev.stage,
            stage: ev.stage,
          };
          if (ev.stage === STAGE.READY) patch.error = null;
          if (ev.stage === STAGE.DEEPZOOM) patch.deepzoom_progress = 0;
          if (ev.stage === STAGE.DEEPZOOM_READY) {
            patch.deepzoom_ready = true;
            patch.deepzoom_progress = 100;
          }
          if (floor > lastProgress) {
            patch.progress = floor;
            lastProgress = floor;
            lastProgressWriteAt = Date.now();
          }
          logger.info(
            {
              mosaicId,
              stage: ev.stage,
              progress: patch.progress ?? lastProgress,
              details: 'stage-transition',
            },
            'progress-update',
          );
          await writePatch(mosaicId, patch);
          return;
        }
        case 'progress': {
          const pct = Math.max(0, Math.min(100, Math.round(ev.percent)));
          const wrote = await writeProgress(pct);
          if (wrote) {
            logger.info(
              { mosaicId, progress: pct, details: 'progress-tick' },
              'progress-update',
            );
          }
          return;
        }
        case 'checkpoint': {
          await persistCheckpoint({
            name: ev.name,
            at: new Date().toISOString(),
            data: ev.data ?? {},
          });
          return;
        }
        case 'variant': {
          const col =
            ev.variant === 'full'
              ? 'image_url'
              : ev.variant === 'thumb'
                ? 'thumb_url'
                : ev.variant === 'preview'
                  ? 'preview_url'
                  : ev.variant === 'print'
                    ? 'print_url'
                    : null;
          if (!col) return;
          await writePatch(mosaicId, { [col]: ev.url } as MosaicPatch);
          return;
        }

        case 'deepzoom': {
          await writePatch(mosaicId, {
            dzi_url: ev.manifestUrl,
            tile_base_url: ev.tileBaseUrl,
          });
          return;
        }
        case 'failed': {
          await writePatch(mosaicId, { status: STAGE.FAILED, error: ev.error });
          return;
        }
        case 'log':
          // Logs are side-band; the logger already captured them.
          return;
      }
    },
    attach(bus) {
      return bus.on((ev) => this.apply(ev));
    },
    markProcessing: () => {
      lastProgress = 0;
      lastProgressWriteAt = Date.now();
      return writePatch(mosaicId, {
        status: STAGE.PROCESSING,
        stage: STAGE.PROCESSING,
        progress: 0,
        error: null,
      });
    },
    markClaimed: (workerId) => writePatch(mosaicId, { worker_id: workerId }),
    markFailed: (message) =>
      writePatch(mosaicId, { status: STAGE.FAILED, error: message }),

    async hasCheckpoint(name) {
      const map = checkpointCache ?? (await readCheckpoints(mosaicId));
      checkpointCache = map;
      return Boolean(map[name]);
    },
  };
}
