CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event_name       text,
  wedding_date     date,
  venue            text,
  welcome_message  text,
  cover_image_url  text,
  qr_image_url     text,
  slug             text NOT NULL UNIQUE,
  plan             text DEFAULT 'free',
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_organizer_id_idx ON public.events (organizer_id);

CREATE TABLE IF NOT EXISTS public.uploads (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  guest_name   text,
  image_url    text NOT NULL,
  file_hash    text,
  uploaded_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS uploads_event_id_idx ON public.uploads (event_id);
CREATE INDEX IF NOT EXISTS uploads_event_hash_idx ON public.uploads (event_id, file_hash);

CREATE TABLE IF NOT EXISTS public.mosaics (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id               uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  source_image_url       text,
  mosaic_image_url       text,
  thumb_image_url        text,
  deepzoom_manifest_url  text,
  tiles_json             jsonb,
  photo_count            integer,
  tile_count             integer,
  status                 text DEFAULT 'pending',
  created_at             timestamptz NOT NULL DEFAULT now(),
  completed_at           timestamptz
);
CREATE INDEX IF NOT EXISTS mosaics_event_id_idx ON public.mosaics (event_id);

CREATE TABLE IF NOT EXISTS public.guestbook_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  guest_name  text,
  message     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS guestbook_messages_event_id_idx ON public.guestbook_messages (event_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.events, public.uploads, public.mosaics, public.guestbook_messages TO anon, authenticated;
GRANT ALL ON public.events, public.uploads, public.mosaics, public.guestbook_messages TO service_role;

DROP POLICY IF EXISTS "Public read covers" ON storage.objects;
CREATE POLICY "Public read covers"
  ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'covers');

DROP POLICY IF EXISTS "Authenticated write covers" ON storage.objects;
CREATE POLICY "Authenticated write covers"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'covers');
DROP POLICY IF EXISTS "Owners update covers" ON storage.objects;
CREATE POLICY "Owners update covers"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'covers' AND owner = auth.uid());
DROP POLICY IF EXISTS "Owners delete covers" ON storage.objects;
CREATE POLICY "Owners delete covers"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'covers' AND owner = auth.uid());

DROP POLICY IF EXISTS "Anyone can upload photos" ON storage.objects;
CREATE POLICY "Anyone can upload photos"
  ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'photos');
DROP POLICY IF EXISTS "Authenticated read photos" ON storage.objects;
CREATE POLICY "Authenticated read photos"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'photos');
DROP POLICY IF EXISTS "Authenticated delete photos" ON storage.objects;
CREATE POLICY "Authenticated delete photos"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'photos');

DROP POLICY IF EXISTS "Authenticated read mosaics" ON storage.objects;
CREATE POLICY "Authenticated read mosaics"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'mosaics');
DROP POLICY IF EXISTS "Authenticated write mosaics" ON storage.objects;
CREATE POLICY "Authenticated write mosaics"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'mosaics');
DROP POLICY IF EXISTS "Authenticated delete mosaics" ON storage.objects;
CREATE POLICY "Authenticated delete mosaics"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'mosaics');