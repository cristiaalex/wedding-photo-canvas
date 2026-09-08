/**
 * Queue abstraction.
 *
 * Today we ship an in-process queue (`./in-process.ts`). Tomorrow we will
 * run multiple Railway replicas behind the same Supabase project and need
 * a *shared* queue with at-most-one-worker job ownership. That migration
 * MUST NOT require changes to:
 *   - the HTTP routes (they only call `queue.enqueue(...)`)
 *   - the job implementations (they only run a payload)
 *   - the progress service (it only writes to the row)
 *
 * The contract below is what every queue driver must satisfy. The two
 * planned drivers are:
 *
 *   1. `InProcessQueue`        — single instance, bounded concurrency.
 *      Suitable for one Railway service with one replica.
 *
 *   2. `SupabaseLeaseQueue`    — DB-backed queue using a `job_queue`
 *      table + `claim_next_job(worker_id, lease_seconds)` RPC that does
 *      an atomic `UPDATE … RETURNING` to grant a lease. Multiple workers
 *      pull from the same table; lost workers' leases expire and another
 *      worker re-claims. Job rows carry `worker_id`, `lease_expires_at`,
 *      `attempts`, `last_error`.
 *
 * Both drivers expose the same `enqueue` and `start` shape so swapping
 * is a one-line change in `index.ts`.
 */

export interface JobPayloadMap {
  'generate-mosaic': {
    eventId: string;
    mosaicId: string;
    coverImageUrl: string;
    suite?: string;
  };
  'generate-deepzoom': {
    eventId: string;
    mosaicId: string;
    /**
     * Local /tmp path to the lossless PNG master produced by Job A.
     * The DZI builder consumes unencoded pixels — no JPEG round-trip.
     */
    masterPath: string;
    suite?: string;
  };
  'generate-archive': {
    eventId: string;
    /** Row id in `download_batches` — membership is already persisted. */
    batchId: string;
  };
  'optimize-upload': {
    eventId: string;
    /** uploads.id whose source RAW must become an Optimized Original. */
    uploadId: string;
  };
  'upload-print': {
    eventId: string;
    mosaicId: string;
    /**
     * Local /tmp path to the lossless PNG master produced by Job A.
     * Job C re-encodes it into a high-quality print JPEG.
     */
    masterPath: string;
  };
}


export type JobKind = keyof JobPayloadMap;

export interface QueuedJob<K extends JobKind = JobKind> {
  kind: K;
  jobId: string;
  payload: JobPayloadMap[K];
  enqueuedAt: number;
  attempts: number;
}

export interface EnqueueOptions {
  /** Optional client-supplied id for idempotency / chaining. */
  jobId?: string;
}

export interface EnqueueResult {
  jobId: string;
  queued: number;
  running: number;
}

export interface QueueStats {
  queued: number;
  running: number;
  maxConcurrent: number;
  workerId: string;
  driver: string;
}

export interface Queue {
  readonly driver: string;
  /** Stable id for this worker *instance* (one per process / replica). */
  readonly workerId: string;

  enqueue<K extends JobKind>(
    kind: K,
    payload: JobPayloadMap[K],
    options?: EnqueueOptions,
  ): Promise<EnqueueResult> | EnqueueResult;

  /** Begin draining. Idempotent — safe to call on boot and after enqueue. */
  start(): void;

  /** Stop accepting new work and resolve once in-flight jobs finish. */
  drainAndStop(timeoutMs: number): Promise<void>;

  stats(): QueueStats;

  /** Abort a mosaic: drop queued jobs and flag in-flight work to stop. */
  cancel(mosaicId: string): { dropped: number };
}
