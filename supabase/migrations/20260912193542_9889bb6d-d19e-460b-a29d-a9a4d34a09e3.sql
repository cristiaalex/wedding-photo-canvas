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
      AND (storage.foldername(_name))[1] IN (e.id::text, e.slug)
  );
$$;
REVOKE ALL ON FUNCTION public.pet_owns_object_prefix(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pet_owns_object_prefix(text) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "Anyone can upload photos"     ON storage.objects;
DROP POLICY IF EXISTS "Authenticated read photos"    ON storage.objects;
DROP POLICY IF EXISTS "Authenticated delete photos"  ON storage.objects;
DROP POLICY IF EXISTS "pet photos insert"            ON storage.objects;
DROP POLICY IF EXISTS "pet photos owner read"        ON storage.objects;
DROP POLICY IF EXISTS "pet photos owner delete"      ON storage.objects;

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

DROP POLICY IF EXISTS "Authenticated read mosaics"   ON storage.objects;
DROP POLICY IF EXISTS "Authenticated write mosaics"  ON storage.objects;
DROP POLICY IF EXISTS "Authenticated delete mosaics" ON storage.objects;
DROP POLICY IF EXISTS "pet mosaics owner read"       ON storage.objects;
DROP POLICY IF EXISTS "pet mosaics owner source insert" ON storage.objects;

CREATE POLICY "pet mosaics owner read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'mosaics' AND public.pet_owns_object_prefix(name));

CREATE POLICY "pet mosaics owner source insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'mosaics'
    AND public.pet_owns_object_prefix(name)
    AND array_length(storage.foldername(name), 1) = 1
  );

DROP POLICY IF EXISTS "Authenticated write covers" ON storage.objects;
DROP POLICY IF EXISTS "pet covers owner insert"    ON storage.objects;

CREATE POLICY "pet covers owner insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'covers'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR (storage.foldername(name))[1] = 'qr'
      OR public.pet_owns_object_prefix(name)
    )
  );