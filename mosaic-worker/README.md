# mosaic-worker

Standalone image-processing backend for **Mosaic Pet** (dedicated deployment — not shared with any other product).

This service is intentionally **separate** from the main app. The Lovable
frontend (TanStack Start / Supabase) only triggers jobs and reads status —
all heavy image work lives here so it survives browser refreshes, Safari
tab suspension, and SPA navigation.

```
Frontend (lovable.app) ──POST /generate──▶ mosaic-worker (Railway)
                                                  │
                          ┌────────── Job A ──────┴──────────┐
                          │ fetch → analyze → build → upload  │
                          │            → READY                │
                          └────────────────┬──────────────────┘
                                           │ (auto-chained)
                          ┌────────── Job B ▼───────────────┐
                          │ build DZI pyramid → upload tiles │
                          │      → DEEPZOOM_READY            │
                          └──────────────────────────────────┘
```

## Endpoints

| Method | Path        | Auth                          | Description                                  |
| ------ | ----------- | ----------------------------- | -------------------------------------------- |
| GET    | `/health`   | none                          | Liveness + dependency check (used by Railway)|
| POST   | `/generate` | `Authorization: Bearer TOKEN` | Enqueue a mosaic generation job              |

### `POST /generate`

```json
{
  "eventId": "uuid",
  "mosaicId": "uuid",
  "coverImageUrl": "https://...",
  "suite": "default"
}
```

Returns `202 Accepted` immediately. The `mosaics` row is the source of
truth — the frontend subscribes to / polls it and renders the lifecycle.

## Lifecycle states (the contract with the frontend)

The worker is the **only** writer of `mosaics.status`. The frontend simply
renders these values; it must not invent progress.

| Stage             | Meaning                                                          |
| ----------------- | ---------------------------------------------------------------- |
| `queued`          | Row exists, no worker has claimed it yet                         |
| `fetching`        | Downloading source assets                                        |
| `analyzing`       | Building tile grid + entropy/saliency/edge maps                  |
| `building`        | Palette + matching + compositing                                 |
| `uploading`       | Writing preview/full/thumb/print to storage                      |
| `ready`           | **User can open and enjoy the mosaic now**                       |
| `deepzoom`        | Background DZI pyramid in progress                               |
| `deepzoom_ready`  | OpenSeadragon can mount tiles                                    |
| `failed`          | Terminal failure; see `error` column                             |

`ready` is reached as fast as possible — Deep Zoom is a **separate job**
(Job B) chained automatically after Job A succeeds. Its failure never
demotes the mosaic out of `ready`.

## Architecture

```
src/
  index.ts                  HTTP server, graceful drain
  worker.ts                 Facade: re-exports the active queue driver
  algorithms.ts             STABLE algorithm interfaces (see below)
  algorithms/
    registry.ts             Suite registry + v0 passthrough implementations
  queue/
    queue.ts                Queue contract (driver-agnostic)
    in-process.ts           Default driver: bounded concurrency, chains Job B
  jobs/
    generate-mosaic.ts      Job A: fetch → analyze → build → upload → READY
    generate-deepzoom.ts    Job B: DZI pyramid + tile upload → DEEPZOOM_READY
  lib/
    stages.ts               Stage enum + canonical progress hints
    checkpoints.ts          CheckpointName enum + persisted record shape
    events.ts               Internal JobEvent bus (decouples generator/UI)
    progress.ts             Translates JobEvents → DB writes (ONLY writer)
    storage.ts              Variant-aware uploads to the `mosaics` bucket
    supabase.ts             Service-role client (singleton)
    logger.ts               Pino + job-scoped child loggers
  routes/
    health.ts               GET /health
    generate.ts             POST /generate
```

### Stable algorithm interfaces (the freeze point)

`src/algorithms.ts` declares the contracts that every future advanced
algorithm plugs into. Sprint 6B+ adds real implementations without
touching the worker, queue, progress, storage, or routes:

| Interface         | Future algorithms                                        |
| ----------------- | -------------------------------------------------------- |
| `GridAnalyzer`    | Adaptive Density, Entropy Maps, Saliency Maps, Edge Mask |
| `PaletteBuilder`  | LAB color palette                                        |
| `TileMatcher`     | KD-tree nearest neighbour over LAB                       |
| `Compositor`      | Edge-aware compositing, Print-quality variant            |
| `DeepZoomBuilder` | DZI pyramid + OpenSeadragon tile layout                  |

Today these are wired to v0 passthrough implementations in
`algorithms/registry.ts`. New suites register via `registerSuite('name', …)`
and callers opt in by passing `suite` on `POST /generate`.

### Decoupled progress

Generators never touch the database. They emit typed `JobEvent`s onto a
per-job bus; `lib/progress.ts` is the only subscriber that writes to
`mosaics`. This means future transports (Realtime broadcast, websockets,
SSE) can be added in one place without changing pipeline code.

### Real checkpoints (resume-ready)

Every meaningful milestone is persisted to `mosaics.checkpoints` (JSONB),
keyed by `CheckpointName`:

```
photos_downloaded · analysis_completed · palette_generated ·
matching_completed · composition_completed · preview_uploaded ·
full_uploaded · print_uploaded · deepzoom_started · deepzoom_completed
```

Each record carries `{ at, data }`. Resume logic isn't implemented yet —
the data is persisted so a future Sprint can turn it on without a
migration or pipeline rewrite.

### Distributed-ready queue

The default driver (`InProcessQueue`) runs one Railway replica with
bounded concurrency. The `Queue` interface is designed so a future
`SupabaseLeaseQueue` (DB-backed `job_queue` table + `claim_next_job`
RPC granting time-bounded leases per `worker_id`) drops in without any
caller change. Each worker process already advertises a stable
`workerId` (`worker-<uuid>`) which is written into `mosaics.worker_id`
on claim — multi-replica observability works today.

Job ownership invariants the design already respects:
- No singleton in-memory state outside the queue driver
- Jobs are addressed by `mosaicId` + `jobId` (not by array index)
- Job B is enqueued via the same `Queue.enqueue` API as Job A, so a
  shared queue picks it up on whichever replica is free
- Failure handling differs per kind (Job A → FAILED; Job B → keeps READY)

## Local development

```bash
cp .env.example .env
# fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WORKER_API_TOKEN
npm install
npm run dev
```

## Deploying to Railway

1. New Railway project, **Root Directory** = `mosaic-worker`.
2. Add the env vars from `.env.example`.
3. Nixpacks runs `npm install && npm run build` then `npm start`.
4. Healthcheck `/health` is configured in `railway.json`.

## Security notes

- Service-role key is only read inside this worker. Never ship to browser.
- Every `POST /generate` requires `Authorization: Bearer $WORKER_API_TOKEN`.
- The worker only mutates the `mosaicId` it was asked to process.
