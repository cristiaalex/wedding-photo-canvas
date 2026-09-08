# Mosaic Pet — database migrations

These files define the Mosaic Pet database. They are **not** applied by the
Lovable Cloud workspace automatically; they are meant to be run, in ascending
filename order, against a **brand-new, empty Supabase project dedicated to
Mosaic Pet**.

> Never run these against any other project. The project ref is intentionally
> left as the placeholder `<PET_PROJECT_REF>` in every file — no real project
> id is stored in this repository. **Nothing has been executed anywhere yet.**

## Order

| #   | File                                     | Purpose                                                    |
| --- | ---------------------------------------- | ---------------------------------------------------------- |
| 1   | `20260601_pet_baseline_schema.sql`       | Core tables + 3 buckets on an empty project. Run first.    |
| 2   | `20260624` … `20260908_*.sql`            | Mature Mosaic architecture: RLS, worker columns, DZI, print, archives, RAW optimize, billing, audit log, discount codes. Idempotent. |
| 3   | `20260909_pet_product_model.sql`         | Pet product model: project/order status, ZIP sources, preview vs final mosaic, payment/download/cleanup lifecycle, triggers, retention helper. |
| 4   | `20260909_pet_storage_policies.sql`      | Ownership-scoped storage policies (replaces bucket-wide ones). |

All files use `IF NOT EXISTS` / `DROP POLICY IF EXISTS` and can be re-run.

## How the Pet product maps onto the schema

| Pet concept                | Table / column                                                    |
| -------------------------- | ----------------------------------------------------------------- |
| Customer project / order   | `events` (+ `pet_name`, `customer_email`, `orientation`, `print_size`, `processing_status`, `payment_status`, `download_status`, `source_cleanup_status`, step timestamps) |
| Source images / ZIPs       | `uploads` (`source_kind` = photo / zip / zip_entry, `parent_upload_id`, `storage_path`, `processing_status`, `deleted_at`) |
| Selected main pet image    | `events.main_upload_id`, `mosaics.main_upload_id`                 |
| Generation job             | `mosaics` (`job_kind` = preview / final, `stage`, `progress`, `checkpoints`, `worker_id`) |
| Preview mosaic             | `mosaics.preview_*`                                               |
| Final print-ready mosaic   | `mosaics.final_storage_path/size_bytes/width_px/height_px/format`, `final_verified_at`, `final_available`, `expires_at`, `download_count` |
| Purchase                   | `subscriptions` (one-time payment record, `product_tag`, `print_size`, `event_id` unique) |
| Webhook idempotency        | `stripe_events`                                                   |
| Discounts / admin audit    | `discount_codes`, `admin_audit_log`                               |

`guestbook_messages` and `download_batches` are kept (mature, harmless, may be
reused later); nothing in the Pet flow depends on them.

## Lifecycles

**Source photos (temporary — `photos` bucket)**
`uploaded → extracting/optimizing → ready → (used by generation) → deleted`.
`events.source_cleanup_status` goes `pending → scheduled` automatically (trigger)
the moment a final mosaic row becomes `final_available = true` with
`final_verified_at` set. A future cleanup job calls
`pet_sources_ready_for_cleanup()` (service role only), removes the listed
objects from the photos bucket, stamps `uploads.deleted_at`, and sets
`source_cleanup_status = done`. The function never returns final mosaics.
**Cleanup is not implemented yet — only the state machine.**

**Final mosaic (long-lived — `mosaics` bucket)**
Written only by the worker (service role). 50–100 MB finals are expected; the
bucket limit is raised in `20260704_mosaics_bucket_size_limit.sql`. Download
availability = `events.download_status` (`available` once paid AND final
ready), optional `download_expires_at` / `mosaics.expires_at` (NULL = no
expiry). No extra compression is applied by the schema.

## Storage design

| Bucket    | Visibility | Who writes                         | Who reads                             | Retention |
| --------- | ---------- | ---------------------------------- | ------------------------------------- | --------- |
| `covers`  | public     | owner (own slug / id / `qr/`)      | everyone                              | long      |
| `photos`  | private    | customers (into an existing project prefix), worker | owner + worker       | **temporary** |
| `mosaics` | private    | worker only (owner may add the main source image) | owner (signed URLs), public DZI tiles | **long-lived** |

Bucket names are configurable in the app via `VITE_PET_*_BUCKET` and in the
worker via `PET_MOSAICS_BUCKET` / `PET_PHOTOS_BUCKET`.

## Open decisions (deliberately not made here)

- `events` public SELECT policy (`USING (true)`, from the guest-link era) is
  still in place because the guest pages have not been removed yet. Tighten
  it when the Pet customer flow is designed.
- Account-less purchase: `subscriptions.user_id` is still `NOT NULL` and
  unique per user. Lift in the Stripe step if anonymous checkout is chosen.
