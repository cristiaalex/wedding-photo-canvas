/**
 * Public worker surface.
 *
 * `worker.ts` is intentionally a thin facade over the queue driver so
 * the rest of the codebase (HTTP routes, health checks, tests) never
 * imports a specific driver. To swap to a DB-backed multi-replica queue,
 * change `getQueue()` in `./queue/in-process.ts` (or introduce a
 * `./queue/supabase-lease.ts` and wire it here) — no other file changes.
 */
export { getQueue } from './queue/in-process';
export type {
  Queue,
  QueueStats,
  JobKind,
  JobPayloadMap,
  EnqueueResult,
} from './queue/queue';
