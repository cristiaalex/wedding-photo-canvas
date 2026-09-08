/**
 * Cooperative job cancellation.
 *
 * "Stop generation" in the UI marks the mosaic row `failed`. That alone
 * only stops DB writes (writePatch has `.neq('status','failed')`) — the
 * CPU-heavy pipeline kept running, so a subsequent Regenerate ended up
 * with two pipelines fighting over the same worker.
 *
 * This registry makes cancellation real:
 *   - `cancelMosaic()` / `cancelEvent()` flag in-flight work.
 *   - Jobs call `throwIfCancelled()` at stage boundaries and pass
 *     `isCancelled()` into hot loops, aborting quickly.
 *   - `watchCancellation()` also polls the DB row so a cancel that never
 *     reached this process (restart, other replica) is still honoured.
 */
import { getSupabase } from './supabase';
import { logger } from './logger';

export class CancelledError extends Error {
  readonly cancelled = true;
  constructor(message = 'Generation cancelled') {
    super(message);
    this.name = 'CancelledError';
  }
}

export function isCancelledError(err: unknown): boolean {
  return err instanceof CancelledError || (err as { cancelled?: boolean })?.cancelled === true;
}

const cancelledMosaics = new Set<string>();
const cancelledEvents = new Set<string>();
/** mosaicId -> eventId for jobs currently registered as running. */
const activeMosaics = new Map<string, string>();

export function registerActive(mosaicId: string, eventId: string): void {
  activeMosaics.set(mosaicId, eventId);
}

export function unregisterActive(mosaicId: string): void {
  activeMosaics.delete(mosaicId);
}

export function cancelMosaic(mosaicId: string): void {
  cancelledMosaics.add(mosaicId);
  logger.info({ mosaicId }, 'cancel:mosaic-flagged');
}

/**
 * Cancels every in-flight mosaic of an event except (optionally) one —
 * used when a fresh generation is accepted so an abandoned previous run
 * cannot keep burning CPU next to the new one.
 */
export function cancelEvent(eventId: string, exceptMosaicId?: string): string[] {
  const cancelled: string[] = [];
  for (const [mosaicId, evId] of activeMosaics) {
    if (evId !== eventId) continue;
    if (exceptMosaicId && mosaicId === exceptMosaicId) continue;
    cancelMosaic(mosaicId);
    cancelled.push(mosaicId);
  }
  cancelledEvents.add(eventId);
  return cancelled;
}

export function clearCancel(mosaicId: string, eventId?: string): void {
  cancelledMosaics.delete(mosaicId);
  if (eventId) cancelledEvents.delete(eventId);
}

export function isCancelled(mosaicId: string): boolean {
  return cancelledMosaics.has(mosaicId);
}

export function throwIfCancelled(mosaicId: string): void {
  if (cancelledMosaics.has(mosaicId)) throw new CancelledError();
}

/**
 * Polls `mosaics.status` so an out-of-band cancel (UI writes `failed`)
 * stops the pipeline even if the worker never received the HTTP call.
 * Returns a stop function; always call it in a `finally`.
 */
export function watchCancellation(mosaicId: string, intervalMs = 5_000): () => void {
  let stopped = false;
  const timer = setInterval(async () => {
    if (stopped) return;
    try {
      const sb = getSupabase();
      const { data } = await sb
        .from('mosaics')
        .select('status')
        .eq('id', mosaicId)
        .maybeSingle();
      const status = (data as { status?: string | null } | null)?.status ?? null;
      if (status === 'failed' || status === 'cancelled' || data === null) {
        logger.info({ mosaicId, status }, 'cancel:detected-from-db');
        cancelMosaic(mosaicId);
      }
    } catch {
      /* cancellation polling must never break a job */
    }
  }, intervalMs);
  timer.unref?.();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
