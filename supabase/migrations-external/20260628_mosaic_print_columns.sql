-- =============================================================================
-- External Supabase project migration: redjgmjkgdaplgsqjfrg.supabase.co
-- =============================================================================
-- Add the columns required by the "Generate Print Version" flow.
--
-- The worker (mosaic-worker/src/jobs/generate-print.ts) writes ONLY:
--   - print_status: 'processing' | 'ready' | 'failed'
--   - print_url:    storage path of the high-res JPEG in the `mosaics` bucket
--
-- Without these columns, PostgREST silently drops the fields (worker log line
-- `progress:update-failed`, PGRST204 "column not found"). The UI therefore
-- never sees `print_status='ready'` and the Download Print button never
-- renders even though the print job actually completed on the worker.
--
-- How to apply:
--   Paste in the external project SQL editor, or:
--   supabase db push --project-ref redjgmjkgdaplgsqjfrg \
--     --file supabase/migrations-external/20260628_mosaic_print_columns.sql
-- =============================================================================

BEGIN;

ALTER TABLE public.mosaics
  ADD COLUMN IF NOT EXISTS print_url    text,
  ADD COLUMN IF NOT EXISTS print_status text;

-- Constrain print_status to the values the worker actually writes so a bad
-- value can never leak into the UI. NULL means "never generated".
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mosaics_print_status_check'
  ) THEN
    ALTER TABLE public.mosaics
      ADD CONSTRAINT mosaics_print_status_check
      CHECK (print_status IS NULL OR print_status IN ('processing','ready','failed'));
  END IF;
END $$;

COMMIT;
