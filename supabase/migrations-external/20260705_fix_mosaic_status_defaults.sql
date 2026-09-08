-- =============================================================================
-- Hotfix: remove invalid sidecar status defaults from public.mosaics
--
-- Run this once if inserting a new mosaic fails with:
--   violates check constraint "mosaics_print_status_check"
--
-- Root cause: an older schema left print_status with a default like 'pending'.
-- The single-master pipeline expects print_status/dzi_status to be NULL until
-- the worker starts those sidecar jobs, then 'processing' -> 'ready'/'failed'.
-- =============================================================================

BEGIN;

ALTER TABLE public.mosaics
  ALTER COLUMN print_status DROP DEFAULT,
  ALTER COLUMN dzi_status DROP DEFAULT;

UPDATE public.mosaics
SET print_status = NULL
WHERE print_status IS NOT NULL
  AND print_status NOT IN ('processing', 'ready', 'failed');

UPDATE public.mosaics
SET dzi_status = NULL
WHERE dzi_status IS NOT NULL
  AND dzi_status NOT IN ('processing', 'ready', 'failed');

ALTER TABLE public.mosaics
  DROP CONSTRAINT IF EXISTS mosaics_print_status_check,
  DROP CONSTRAINT IF EXISTS mosaics_dzi_status_check;

ALTER TABLE public.mosaics
  ADD CONSTRAINT mosaics_print_status_check
    CHECK (print_status IS NULL OR print_status IN ('processing', 'ready', 'failed')),
  ADD CONSTRAINT mosaics_dzi_status_check
    CHECK (dzi_status IS NULL OR dzi_status IN ('processing', 'ready', 'failed'));

COMMIT;