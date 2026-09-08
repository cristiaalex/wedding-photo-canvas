-- Optimized Originals for special RAW formats (DNG / Apple ProRAW).
--
-- Normal JPEG/HEIC uploads are untouched by this feature: their rows keep
-- optimize_status = NULL and behave exactly as before.
--
-- For a DNG upload the client stores the raw file at
--   {event_id}/{photo_id}/source.dng
-- and inserts the uploads row with image_url already pointing at the FINAL
-- optimized original path ({event_id}/{photo_id}/original.jpg). The Railway
-- worker decodes the DNG, writes original.jpg + display/thumb variants,
-- verifies them, flips optimize_status to 'ready' and only then deletes the
-- source RAW.

alter table public.uploads
  add column if not exists original_format text,
  add column if not exists optimize_status text,
  add column if not exists optimize_error text,
  add column if not exists source_path text,
  add column if not exists original_size_bytes bigint,
  add column if not exists optimized_size_bytes bigint,
  add column if not exists optimized_at timestamptz;

-- Only rows in flight are ever scanned by the worker retry path.
create index if not exists uploads_optimize_status_idx
  on public.uploads (optimize_status)
  where optimize_status is not null and optimize_status <> 'ready';

comment on column public.uploads.optimize_status is
  'NULL for normal uploads. pending | processing | ready | failed for special RAW uploads.';
comment on column public.uploads.source_path is
  'Storage path of the source RAW file while it still exists; cleared after a verified conversion.';
