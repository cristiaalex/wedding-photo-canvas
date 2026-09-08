-- =============================================================================
-- Mosaic Pet database migration (target: the Pet Supabase project only)
-- =============================================================================
-- Raise the `mosaics` bucket file_size_limit to 512 MB so the print variant
-- (~140 MB JPEG at 24000x18000, quality 92, 4:4:4) can be uploaded via TUS.
--
-- Standard `.upload()` remains capped at the project's global upload ceiling,
-- so print uploads use the resumable (TUS) endpoint — see
-- mosaic-worker/src/lib/storage.ts::uploadVariantResumable.
--
-- All other variants (full/preview/thumb/dzi/tiles) are unaffected.
--
-- Apply in the external project's SQL editor OR:
--   supabase db push --project-ref <PET_PROJECT_REF> \
--     --file supabase/migrations-external/20260704_mosaics_bucket_size_limit.sql
-- =============================================================================

UPDATE storage.buckets
   SET file_size_limit = 536870912  -- 512 MB
 WHERE id = 'mosaics';
