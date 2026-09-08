-- =============================================================================
-- Mosaic Pet — STORAGE POLICY HARDENING (photos / mosaics / covers)
-- =============================================================================
-- Replaces the broad bucket-wide policies from the baseline with ownership-
-- scoped ones. Object keys are always prefixed with the project id:
--   photos  : {event_id}/{upload_id}/original.jpg | display.webp | thumb_*.webp
--             {event_id}/{upload_id}/source.<raw>  (RAW/ZIP sources)
--   mosaics : {event_id}/{mosaic_id}.jpg, {event_id}/{mosaic_id}/print.*,
--             {event_id}/{mosaic_id}/dzi/**        (tiles, public read)
--   covers  : {user_id}/... or {event_id}/...       (public read)
--
-- Retention roles:
--   photos  = TEMPORARY. Written by customers, read/deleted by the worker
--             (service role) and by the project owner. Purged after the final
--             mosaic is verified.
--   mosaics = LONG-LIVED customer product. Written ONLY by the worker; the
--             browser never gets INSERT/DELETE on this bucket. Reads by the
--             owner (signed URLs) and public DZI tiles.
--   covers  = optional public assets, owner-managed.
--
-- Anonymous uploads: the Pet purchase flow may be account-less. Uploads by
-- anon stay allowed INTO the photos bucket only (INSERT, no read-back of other
-- people's files). Anon never gets SELECT/UPDATE/DELETE on photos or mosaics.
-- Bucket-wide settings (file size limits) stay in 20260704 / 20260824.
-- =============================================================================

BEGIN;

-- Helper: does the current user own the project encoded in the object key?
CREATE OR REPLACE FUNCTION public.pet_owns_object_prefix(_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.events e
    WHERE e.organizer_id IS NOT NULL
      AND e.organizer_id = auth.uid()
      AND e.id::text = (storage.foldername(_name))[1]
  );
$$;
REVOKE ALL ON FUNCTION public.pet_owns_object_prefix(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pet_owns_object_prefix(text) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- photos (temporary)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can upload photos"     ON storage.objects;
DROP POLICY IF EXISTS "Authenticated read photos"    ON storage.objects;
DROP POLICY IF EXISTS "Authenticated delete photos"  ON storage.objects;
DROP POLICY IF EXISTS "pet photos insert"            ON storage.objects;
DROP POLICY IF EXISTS "pet photos owner read"        ON storage.objects;
DROP POLICY IF EXISTS "pet photos owner delete"      ON storage.objects;

-- Customers (signed-in or not) may add source files into a project prefix.
-- Keys must be {event_id}/... so nothing can be dropped at the bucket root.
CREATE POLICY "pet photos insert"
  ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id = 'photos'
    AND array_length(storage.foldername(name), 1) >= 1
    AND EXISTS (SELECT 1 FROM public.events e WHERE e.id::text = (storage.foldername(name))[1])
  );

CREATE POLICY "pet photos owner read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'photos' AND public.pet_owns_object_prefix(name));

CREATE POLICY "pet photos owner delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'photos' AND public.pet_owns_object_prefix(name));

-- ---------------------------------------------------------------------------
-- mosaics (long-lived product) — worker writes via service role only
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated read mosaics"   ON storage.objects;
DROP POLICY IF EXISTS "Authenticated write mosaics"  ON storage.objects;
DROP POLICY IF EXISTS "Authenticated delete mosaics" ON storage.objects;
DROP POLICY IF EXISTS "pet mosaics owner read"       ON storage.objects;
DROP POLICY IF EXISTS "pet mosaics owner source insert" ON storage.objects;

CREATE POLICY "pet mosaics owner read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'mosaics' AND public.pet_owns_object_prefix(name));

-- The app uploads the chosen main image as {event_id}/{mosaic_id}.jpg before
-- the worker starts (run-mosaic-generation). Owners may write that one kind
-- of object; everything else in this bucket is worker-only.
CREATE POLICY "pet mosaics owner source insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'mosaics'
    AND public.pet_owns_object_prefix(name)
    AND array_length(storage.foldername(name), 1) = 1
  );

-- "Public read DZI assets" from 20260625 is kept as-is (tiles are unguessable
-- uuid paths and needed by the viewer).

-- ---------------------------------------------------------------------------
-- covers (public read, owner-managed)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated write covers" ON storage.objects;
DROP POLICY IF EXISTS "pet covers owner insert"    ON storage.objects;

CREATE POLICY "pet covers owner insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'covers'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.pet_owns_object_prefix(name)
    )
  );
-- "Public read covers", "Owners update covers", "Owners delete covers" from
-- the baseline remain in force.

COMMIT;
