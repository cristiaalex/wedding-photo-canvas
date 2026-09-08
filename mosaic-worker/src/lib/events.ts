import { EventEmitter } from 'events';
import type { Stage } from './stages';
import type { CheckpointName } from './checkpoints';

/**
 * Internal job events.
 *
 * The generator emits these. A *separate* progress service translates
 * them into DB writes. This is the seam that lets us change how the UI
 * is fed (DB rows today, realtime channel tomorrow, websocket later)
 * without touching algorithm code.
 *
 * Rule of thumb: algorithm code may import from `./events` but MUST NOT
 * import from `./progress` or `./supabase` — that would re-couple the
 * pipeline to the transport layer.
 */

export type JobEvent =
  | { type: 'stage'; stage: Stage; note?: string }
  | { type: 'progress'; percent: number; note?: string } // intra-stage fine-grained
  | {
      type: 'checkpoint';
      name: CheckpointName;
      data?: Record<string, unknown>;
    }
  | { type: 'variant'; variant: 'preview' | 'full' | 'thumb' | 'print'; url: string; path: string }
  | { type: 'deepzoom'; manifestUrl: string; tileBaseUrl: string }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; msg: string; meta?: Record<string, unknown> }
  | { type: 'failed'; error: string };

export interface JobEventBus {
  emit(ev: JobEvent): void;
  on(handler: (ev: JobEvent) => void | Promise<void>): () => void;
}

/**
 * Create a bus scoped to one job. We use a plain Node EventEmitter under
 * the hood so listeners are cheap and synchronous; the progress service
 * is responsible for queueing its own DB writes if it wants to batch.
 */
export function createJobEventBus(): JobEventBus {
  const ee = new EventEmitter();
  ee.setMaxListeners(50);
  return {
    emit(ev) {
      ee.emit('event', ev);
    },
    on(handler) {
      ee.on('event', handler);
      return () => ee.off('event', handler);
    },
  };
}
