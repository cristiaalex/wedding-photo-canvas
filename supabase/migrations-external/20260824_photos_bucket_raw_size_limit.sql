-- =============================================================================
-- External Supabase project migration: redjgmjkgdaplgsqjfrg.supabase.co
-- =============================================================================
-- Allow the TEMPORARY special-RAW source (Apple ProRAW / DNG, ~85 MB) to be
-- uploaded into the `photos` bucket through the resumable (TUS) endpoint.
--
-- 150 MB is a deliberate safety ceiling: enough for the supported RAW formats,
-- not an open-ended limit. The RAW is temporary — the worker replaces it with
-- the ~10-15 MB Optimized Original and then deletes the source.
--
-- Normal JPEG/PNG/HEIC uploads are unaffected: they keep using the standard
-- object endpoint and are only a few MB each.
--
-- NOTE: the project-wide upload limit (Settings -> Storage) must be >= 150 MB
-- as well, otherwise the bucket limit has no effect.
--
-- Apply in the external project's SQL editor OR:
--   supabase db push --project-ref redjgmjkgdaplgsqjfrg \
--     --file supabase/migrations-external/20260824_photos_bucket_raw_size_limit.sql
-- =============================================================================

UPDATE storage.buckets
   SET file_size_limit = 157286400  -- 150 MB
 WHERE id = 'photos';
