/**
 * Canonical, explicit lifecycle states for a mosaic row.
 *
 * The worker is the *only* writer of these values. The frontend reads them
 * verbatim and renders a state — it MUST NOT invent its own progress %.
 *
 * NOTE: `queued` has been removed from the worker's vocabulary. The new
 * pipeline flips the row to `processing` the moment the /generate route
 * accepts a job — there is no separate "waiting to be picked up" state
 * exposed to the frontend. This keeps the state machine consistent with
 * the single-master pipeline (row exists → worker owns it → done/failed).
 */
export const STAGE = {
  /** Row is owned by the worker; downloading source assets. */
  FETCHING: 'fetching',
  /** Building tile grid + entropy/saliency/edge maps. */
  ANALYZING: 'analyzing',
  /** Palette + matching + compositing the final image. */
  BUILDING: 'building',
  /** Writing preview / full / print variants to storage. */
  UPLOADING: 'uploading',
  /**
   * Job A finished and the master is on disk. Downstream jobs (Deep Zoom
   * + Print Upload) are running in parallel. The mosaic is NOT yet
   * user-visible in the "ready" sense — READY is only emitted once both
   * `dzi_status = 'ready'` AND `print_status = 'ready'`.
   */
  FINALIZING: 'finalizing',
  /**
   * Mosaic is fully available: Interactive viewer AND Print download
   * are both ready. This is the single terminal success state.
   */
  READY: 'ready',
  /** DZI pyramid + tile upload is in progress (post-master render). */
  DEEPZOOM: 'deepzoom',
  /** DZI pyramid + tiles are available; OpenSeadragon can mount. */
  DEEPZOOM_READY: 'deepzoom_ready',
  /**
   * Initial state written by /generate when the row is accepted, before
   * any of the more granular stages fire. Replaces the old QUEUED value.
   */
  PROCESSING: 'processing',
  /** Terminal failure. `error` column has the message. */
  FAILED: 'failed',
} as const;


export type Stage = (typeof STAGE)[keyof typeof STAGE];

/**
 * Lower-bound progress (0..100) for each stage.
 *
 * The pipeline emits fine-grained `progress` events *within* each band
 * (see progress-creep.ts and the per-job creep calls); a `stage` event
 * only ever snaps the bar UP to the band floor, never back down.
 *
 * Bands:
 *   0     collecting  (fetching cover + guest photos)
 *   1-10  collecting  (photo bank download — real percent)
 *   11-20 connecting  (analyzing target)
 *   21-70 crafting    (palette → matcher → compositor)
 *   71-92 interactive (deep zoom pyramid)
 *   93-97 print       (print JPEG encode + upload)
 *   98-100 finishing  (promote to READY)
 */
export const STAGE_PROGRESS: Record<Stage, number> = {
  [STAGE.PROCESSING]: 0,
  [STAGE.FETCHING]: 1,
  [STAGE.ANALYZING]: 11,
  [STAGE.BUILDING]: 21,
  [STAGE.UPLOADING]: 66,
  [STAGE.FINALIZING]: 70,
  [STAGE.DEEPZOOM]: 71,
  [STAGE.DEEPZOOM_READY]: 92,
  [STAGE.READY]: 100,
  [STAGE.FAILED]: 0,
};
