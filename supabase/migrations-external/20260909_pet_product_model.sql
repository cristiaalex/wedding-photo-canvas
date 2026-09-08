-- =============================================================================
-- Mosaic Pet — PRODUCT DATA MODEL (additive, idempotent)
-- =============================================================================
-- Runs after the mature Mosaic schema has been built by the earlier files.
-- Nothing is dropped. Every change is ADD COLUMN IF NOT EXISTS / CREATE IF NOT
-- EXISTS so the file can be re-run safely on the Pet project.
--
-- Mapping of the Pet product onto the proven Mosaic architecture:
--
--   events    -> one CUSTOMER PROJECT / ORDER ("my dog Max, 30x40 portrait")
--   uploads   -> customer SOURCE IMAGES (single photos, ZIP files and the
--                files extracted from a ZIP). TEMPORARY processing assets.
--   mosaics   -> one row per GENERATION JOB. The worker already writes
--                stage / progress / checkpoints / worker_id here, so no
--                separate jobs table is needed. Holds the preview mosaic and
--                the final print-ready mosaic (the purchased product).
--   subscriptions -> one-time PURCHASE record (kept name for code compat).
--
-- Source-photo lifecycle (photos bucket, temporary):
--   uploaded -> optimized -> used for generation -> final mosaic verified
--   -> source_cleanup_status: pending -> scheduled -> running -> done
--   Cleanup itself is NOT executed by this migration; it only provides the
--   state so a worker job can run it safely later.
--
-- Final-mosaic lifecycle (mosaics bucket, long-lived):
--   preview generated -> final generated -> final verified (size/resolution
--   recorded, object confirmed accessible) -> available for download until
--   download_expires_at (NULL = no expiry configured).
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Shared updated_at trigger function
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 1. events — customer project / order
-- ---------------------------------------------------------------------------
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS product_kind           text        NOT NULL DEFAULT 'pet',
  ADD COLUMN IF NOT EXISTS customer_email         text,
  ADD COLUMN IF NOT EXISTS pet_name               text,
  ADD COLUMN IF NOT EXISTS main_upload_id         uuid,   -- selected main pet image (FK added below)
  ADD COLUMN IF NOT EXISTS orientation            text,
  ADD COLUMN IF NOT EXISTS print_size             text,
  ADD COLUMN IF NOT EXISTS processing_status      text        NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS payment_status         text        NOT NULL DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS paid_at                timestamptz,
  ADD COLUMN IF NOT EXISTS download_status        text        NOT NULL DEFAULT 'unavailable',
  ADD COLUMN IF NOT EXISTS download_expires_at    timestamptz,
  ADD COLUMN IF NOT EXISTS source_cleanup_status  text        NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS source_cleanup_at      timestamptz,
  ADD COLUMN IF NOT EXISTS source_cleanup_error   text,
  ADD COLUMN IF NOT EXISTS source_bytes_total     bigint,
  ADD COLUMN IF NOT EXISTS uploads_completed_at   timestamptz,
  ADD COLUMN IF NOT EXISTS preview_requested_at   timestamptz,
  ADD COLUMN IF NOT EXISTS preview_ready_at       timestamptz,
  ADD COLUMN IF NOT EXISTS final_requested_at     timestamptz,
  ADD COLUMN IF NOT EXISTS final_ready_at         timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at             timestamptz NOT NULL DEFAULT now();

-- Enumerations as CHECK constraints (added once; re-runs are no-ops).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_orientation_check') THEN
    ALTER TABLE public.events ADD CONSTRAINT events_orientation_check
      CHECK (orientation IS NULL OR orientation IN ('portrait', 'landscape', 'square'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_processing_status_check') THEN
    ALTER TABLE public.events ADD CONSTRAINT events_processing_status_check
      CHECK (processing_status IN (
        'draft',            -- project created, uploads in progress
        'uploads_complete', -- customer finished uploading
        'preview_queued', 'preview_processing', 'preview_ready',
        'final_queued',   'final_processing',   'final_ready',
        'failed'
      ));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_payment_status_check') THEN
    ALTER TABLE public.events ADD CONSTRAINT events_payment_status_check
      CHECK (payment_status IN ('unpaid', 'pending', 'paid', 'refunded', 'failed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_download_status_check') THEN
    ALTER TABLE public.events ADD CONSTRAINT events_download_status_check
      CHECK (download_status IN ('unavailable', 'available', 'downloaded', 'expired'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_source_cleanup_status_check') THEN
    ALTER TABLE public.events ADD CONSTRAINT events_source_cleanup_status_check
      CHECK (source_cleanup_status IN ('pending', 'scheduled', 'running', 'done', 'failed', 'skipped'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS events_processing_status_idx ON public.events (processing_status);
CREATE INDEX IF NOT EXISTS events_payment_status_idx    ON public.events (payment_status);
-- Cleanup worker scans: paid + final ready + sources not yet purged.
CREATE INDEX IF NOT EXISTS events_source_cleanup_due_idx
  ON public.events (source_cleanup_status, final_ready_at)
  WHERE source_cleanup_status IN ('pending', 'scheduled', 'failed');
-- Expiry sweeps of downloadable finals.
CREATE INDEX IF NOT EXISTS events_download_expires_idx
  ON public.events (download_expires_at)
  WHERE download_expires_at IS NOT NULL AND download_status = 'available';

DROP TRIGGER IF EXISTS events_set_updated_at ON public.events;
CREATE TRIGGER events_set_updated_at
  BEFORE UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. uploads — source images, ZIP files and ZIP-extracted files
-- ---------------------------------------------------------------------------
ALTER TABLE public.uploads
  ADD COLUMN IF NOT EXISTS source_kind        text        NOT NULL DEFAULT 'photo',
  ADD COLUMN IF NOT EXISTS parent_upload_id   uuid REFERENCES public.uploads(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS storage_path       text,     -- object key inside the photos bucket
  ADD COLUMN IF NOT EXISTS size_bytes         bigint,
  ADD COLUMN IF NOT EXISTS width_px           integer,
  ADD COLUMN IF NOT EXISTS height_px          integer,
  ADD COLUMN IF NOT EXISTS processing_status  text        NOT NULL DEFAULT 'uploaded',
  ADD COLUMN IF NOT EXISTS processing_error   text,
  ADD COLUMN IF NOT EXISTS extracted_count    integer,  -- ZIP only: files extracted
  ADD COLUMN IF NOT EXISTS processed_at       timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at         timestamptz,  -- stamped when the source object was purged
  ADD COLUMN IF NOT EXISTS updated_at         timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uploads_source_kind_check') THEN
    ALTER TABLE public.uploads ADD CONSTRAINT uploads_source_kind_check
      CHECK (source_kind IN ('photo', 'zip', 'zip_entry'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uploads_processing_status_check') THEN
    ALTER TABLE public.uploads ADD CONSTRAINT uploads_processing_status_check
      CHECK (processing_status IN (
        'uploaded',    -- object is in the photos bucket
        'extracting',  -- ZIP being unpacked by the worker
        'optimizing',  -- RAW/large image being converted (see optimize_status)
        'ready',       -- usable by the mosaic engine
        'rejected',    -- not an image / corrupt / too small
        'failed',
        'deleted'      -- source purged after final mosaic verification
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS uploads_parent_upload_idx ON public.uploads (parent_upload_id)
  WHERE parent_upload_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS uploads_event_processing_idx ON public.uploads (event_id, processing_status);
-- Cleanup worker: everything not yet deleted for an event.
CREATE INDEX IF NOT EXISTS uploads_pending_cleanup_idx ON public.uploads (event_id)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS uploads_set_updated_at ON public.uploads;
CREATE TRIGGER uploads_set_updated_at
  BEFORE UPDATE ON public.uploads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Selected main pet image FK (uploads must exist first, hence added here).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_main_upload_fk') THEN
    ALTER TABLE public.events ADD CONSTRAINT events_main_upload_fk
      FOREIGN KEY (main_upload_id) REFERENCES public.uploads(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. mosaics — generation jobs + preview / final outputs
--    Existing columns already used by the worker and kept as-is:
--      status, stage, progress, checkpoints, worker_id, error, metadata,
--      image_url (DZI manifest), dzi_url, tile_base_url, dzi_status,
--      preview_url, thumb_url, print_url, print_status, photo_count,
--      tile_count, source_image_url, created_at, completed_at.
-- ---------------------------------------------------------------------------
ALTER TABLE public.mosaics
  ADD COLUMN IF NOT EXISTS job_kind             text        NOT NULL DEFAULT 'final',
  ADD COLUMN IF NOT EXISTS orientation          text,
  ADD COLUMN IF NOT EXISTS print_size           text,
  ADD COLUMN IF NOT EXISTS main_upload_id       uuid REFERENCES public.uploads(id) ON DELETE SET NULL,
  -- preview mosaic (web-sized, shown before purchase)
  ADD COLUMN IF NOT EXISTS preview_storage_path text,
  ADD COLUMN IF NOT EXISTS preview_size_bytes   bigint,
  ADD COLUMN IF NOT EXISTS preview_width_px     integer,
  ADD COLUMN IF NOT EXISTS preview_height_px    integer,
  ADD COLUMN IF NOT EXISTS preview_ready_at     timestamptz,
  -- final print-ready mosaic (the purchased product; 50-100 MB is expected)
  ADD COLUMN IF NOT EXISTS final_storage_path   text,
  ADD COLUMN IF NOT EXISTS final_size_bytes     bigint,
  ADD COLUMN IF NOT EXISTS final_width_px       integer,
  ADD COLUMN IF NOT EXISTS final_height_px      integer,
  ADD COLUMN IF NOT EXISTS final_format         text,        -- e.g. 'jpeg', 'tiff', 'png'
  ADD COLUMN IF NOT EXISTS final_ready_at       timestamptz, -- file written
  ADD COLUMN IF NOT EXISTS final_verified_at    timestamptz, -- object confirmed accessible + size/resolution recorded
  ADD COLUMN IF NOT EXISTS final_available      boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS expires_at           timestamptz, -- download availability end (NULL = not configured)
  ADD COLUMN IF NOT EXISTS download_count       integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_downloaded_at  timestamptz,
  ADD COLUMN IF NOT EXISTS last_downloaded_at   timestamptz,
  -- processing timeline
  ADD COLUMN IF NOT EXISTS queued_at            timestamptz,
  ADD COLUMN IF NOT EXISTS started_at           timestamptz,
  ADD COLUMN IF NOT EXISTS print_completed_at   timestamptz,
  ADD COLUMN IF NOT EXISTS dzi_completed_at     timestamptz,
  ADD COLUMN IF NOT EXISTS failed_at            timestamptz,
  -- source cleanup is tracked per project on events; mirror the moment this
  -- job released its sources for auditability.
  ADD COLUMN IF NOT EXISTS sources_released_at  timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at           timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mosaics_job_kind_check') THEN
    ALTER TABLE public.mosaics ADD CONSTRAINT mosaics_job_kind_check
      CHECK (job_kind IN ('preview', 'final'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mosaics_orientation_check') THEN
    ALTER TABLE public.mosaics ADD CONSTRAINT mosaics_orientation_check
      CHECK (orientation IS NULL OR orientation IN ('portrait', 'landscape', 'square'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS mosaics_event_job_kind_idx ON public.mosaics (event_id, job_kind, created_at DESC);
CREATE INDEX IF NOT EXISTS mosaics_expiring_idx ON public.mosaics (expires_at)
  WHERE expires_at IS NOT NULL AND final_available = true;

DROP TRIGGER IF EXISTS mosaics_set_updated_at ON public.mosaics;
CREATE TRIGGER mosaics_set_updated_at
  BEFORE UPDATE ON public.mosaics
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Keep the project-level timeline in sync when a job's final becomes
-- verified/available or a preview finishes. Runs as trigger owner so the
-- worker (service role) and future server functions both benefit.
CREATE OR REPLACE FUNCTION public.mosaics_sync_event_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.job_kind = 'preview'
     AND NEW.preview_ready_at IS NOT NULL
     AND (OLD.preview_ready_at IS NULL) THEN
    UPDATE public.events
       SET processing_status = 'preview_ready',
           preview_ready_at  = COALESCE(preview_ready_at, NEW.preview_ready_at)
     WHERE id = NEW.event_id
       AND processing_status IN ('preview_queued', 'preview_processing', 'uploads_complete', 'draft');
  END IF;

  IF NEW.job_kind = 'final'
     AND NEW.final_available = true
     AND (OLD.final_available IS DISTINCT FROM true) THEN
    UPDATE public.events
       SET processing_status     = 'final_ready',
           final_ready_at        = COALESCE(final_ready_at, NEW.final_verified_at, now()),
           download_status       = CASE WHEN payment_status = 'paid' THEN 'available' ELSE download_status END,
           download_expires_at   = COALESCE(download_expires_at, NEW.expires_at),
           -- sources may now be purged; the cleanup job flips this to running/done
           source_cleanup_status = CASE WHEN source_cleanup_status = 'pending' THEN 'scheduled' ELSE source_cleanup_status END
     WHERE id = NEW.event_id;
  END IF;

  IF NEW.status = 'failed' AND OLD.status IS DISTINCT FROM 'failed' THEN
    UPDATE public.events SET processing_status = 'failed' WHERE id = NEW.event_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mosaics_sync_event_status ON public.mosaics;
CREATE TRIGGER mosaics_sync_event_status
  AFTER UPDATE ON public.mosaics
  FOR EACH ROW EXECUTE FUNCTION public.mosaics_sync_event_status();

-- ---------------------------------------------------------------------------
-- 4. purchases — reuse public.subscriptions (one-time payment record)
-- ---------------------------------------------------------------------------
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS product_tag  text,   -- must equal the Pet Stripe product tag
  ADD COLUMN IF NOT EXISTS print_size   text,
  ADD COLUMN IF NOT EXISTS orientation  text,
  ADD COLUMN IF NOT EXISTS mosaic_id    uuid REFERENCES public.mosaics(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS refunded_at  timestamptz;

-- One purchase per project (the user-level unique index from the Wedding era
-- is still present; the Pet checkout step will decide whether it is lifted).
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_event_id_key
  ON public.subscriptions (event_id)
  WHERE event_id IS NOT NULL;

DROP TRIGGER IF EXISTS subscriptions_set_updated_at ON public.subscriptions;
CREATE TRIGGER subscriptions_set_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Reflect payment into the project row (service role writes purchases).
CREATE OR REPLACE FUNCTION public.subscriptions_sync_event_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.event_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.status = 'paid' THEN
    UPDATE public.events
       SET payment_status  = 'paid',
           paid_at         = COALESCE(paid_at, NEW.paid_at, now()),
           print_size      = COALESCE(NEW.print_size, print_size),
           orientation     = COALESCE(NEW.orientation, orientation),
           download_status = CASE WHEN processing_status = 'final_ready' THEN 'available' ELSE download_status END
     WHERE id = NEW.event_id;
  ELSIF NEW.status IN ('refunded') THEN
    UPDATE public.events
       SET payment_status  = 'refunded',
           download_status = 'unavailable'
     WHERE id = NEW.event_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS subscriptions_sync_event_payment ON public.subscriptions;
CREATE TRIGGER subscriptions_sync_event_payment
  AFTER INSERT OR UPDATE OF status ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.subscriptions_sync_event_payment();

-- ---------------------------------------------------------------------------
-- 5. Retention helper — which sources are safe to purge right now.
--    Read-only, service-role only (the cleanup job calls it). It never
--    returns the final mosaic; only rows from the temporary photos bucket.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pet_sources_ready_for_cleanup(_limit integer DEFAULT 50)
RETURNS TABLE (event_id uuid, upload_id uuid, storage_path text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.event_id, u.id, COALESCE(u.storage_path, u.image_url)
  FROM public.uploads u
  JOIN public.events e ON e.id = u.event_id
  WHERE e.source_cleanup_status IN ('scheduled', 'failed')
    AND e.processing_status = 'final_ready'
    AND EXISTS (
      SELECT 1 FROM public.mosaics m
      WHERE m.event_id = e.id
        AND m.job_kind = 'final'
        AND m.final_available = true
        AND m.final_verified_at IS NOT NULL
    )
    AND u.deleted_at IS NULL
  ORDER BY e.final_ready_at ASC NULLS LAST
  LIMIT _limit;
$$;

REVOKE ALL ON FUNCTION public.pet_sources_ready_for_cleanup(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pet_sources_ready_for_cleanup(integer) TO service_role;

-- Lock down the internal trigger functions as well.
REVOKE ALL ON FUNCTION public.mosaics_sync_event_status()        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.subscriptions_sync_event_payment() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Column comments
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN public.events.source_cleanup_status IS
  'pending -> scheduled (final verified) -> running -> done | failed | skipped. Only the temporary photos bucket is purged; the final mosaic is never deleted by cleanup.';
COMMENT ON COLUMN public.events.download_expires_at IS
  'When the final mosaic stops being downloadable. NULL = no expiry configured.';
COMMENT ON COLUMN public.uploads.source_kind IS
  'photo = single image; zip = uploaded archive; zip_entry = file extracted from a zip (parent_upload_id set).';
COMMENT ON COLUMN public.mosaics.job_kind IS
  'preview = web-sized mosaic shown before purchase; final = print-ready deliverable.';
COMMENT ON COLUMN public.mosaics.final_verified_at IS
  'Set only after the final object was confirmed accessible and its size/resolution recorded. Source cleanup is gated on this.';

COMMIT;
