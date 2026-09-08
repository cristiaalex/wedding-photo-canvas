-- =============================================================================
-- External Supabase project migration: redjgmjkgdaplgsqjfrg.supabase.co
-- =============================================================================
-- Allow anonymous public read access to Deep Zoom assets in the `mosaics`
-- bucket so OpenSeadragon can fetch the `.dzi` manifest and every tile
-- directly from Supabase Storage without signed URLs (signing a whole
-- pyramid directory is not supported).
--
-- Scope is intentionally narrow:
--   - `dzi.dzi` manifest at the mosaic root
--   - any object under a `dzi_files/` subdirectory (the tile pyramid)
--
-- All other objects in the `mosaics` bucket (full/preview/thumb/print JPEGs)
-- remain private and are accessed via short-lived signed URLs as today.
--
-- How to apply:
--   Open the external project's SQL editor and paste this file, or:
--   supabase db push --project-ref redjgmjkgdaplgsqjfrg \
--     --file supabase/migrations-external/20260625_dzi_public_read.sql
-- =============================================================================

BEGIN;

DROP POLICY IF EXISTS "Public read DZI assets" ON storage.objects;

CREATE POLICY "Public read DZI assets"
  ON storage.objects
  FOR SELECT
  TO anon, authenticated
  USING (
    bucket_id = 'mosaics'
    AND (
      name LIKE '%/dzi.dzi'
      OR name LIKE '%/dzi_files/%'
    )
  );

COMMIT;
