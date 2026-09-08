/**
 * Persistent milestones inside a single job.
 *
 * Checkpoints are written to `mosaics.checkpoints` (JSONB). They are the
 * substrate for future *resumable generation* — if a worker dies mid-job,
 * the next claim will be able to skip already-completed stages by
 * reading these markers. Resume is NOT implemented today; we only persist
 * the milestones so the data is already there when we turn it on.
 *
 * Design rule: every checkpoint MUST be (a) idempotent to re-run and
 * (b) carry enough metadata (counts, hashes, URLs) to be self-describing.
 */
export const CHECKPOINT = {
  PHOTOS_DOWNLOADED: 'photos_downloaded',
  ANALYSIS_COMPLETED: 'analysis_completed',
  PALETTE_GENERATED: 'palette_generated',
  MATCHING_COMPLETED: 'matching_completed',
  COMPOSITION_COMPLETED: 'composition_completed',
  PREVIEW_UPLOADED: 'preview_uploaded',
  FULL_UPLOADED: 'full_uploaded',
  PRINT_UPLOADED: 'print_uploaded',
  DEEPZOOM_STARTED: 'deepzoom_started',
  DEEPZOOM_COMPLETED: 'deepzoom_completed',
} as const;

export type CheckpointName = (typeof CHECKPOINT)[keyof typeof CHECKPOINT];

export interface CheckpointRecord<T = Record<string, unknown>> {
  name: CheckpointName;
  at: string; // ISO timestamp
  data: T;
}

/**
 * Builds the JSONB shape we persist. Stored as an object keyed by name
 * (not an array) so resume logic can `hasCheckpoint(name)` in O(1) and
 * re-running the same milestone overwrites rather than duplicates.
 */
export type CheckpointMap = Partial<Record<CheckpointName, CheckpointRecord>>;
