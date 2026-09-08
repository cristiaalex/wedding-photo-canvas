-- =============================================================================
-- Mosaic Pet — BASELINE SCHEMA (run FIRST on a brand-new Pet Supabase project)
-- =============================================================================
-- The original migrations in this folder were written against a database whose
-- core tables (events, uploads, mosaics, guestbook_messages) and storage
-- buckets already existed. This baseline recreates that starting point so the
-- whole folder can be applied, in filename order, to an EMPTY Pet project.
--
-- Column sets here are the minimal "as of 2026-06" shape. Every later column
-- is added by the subsequent migrations using ADD COLUMN IF NOT EXISTS, and
-- every policy / function / bucket rule is (re)created by them. RLS is enabled
-- and hardened by 20260624_enable_rls_app_tables.sql and
-- 20260826_rls_hardening.sql — do not skip those.
--
-- How to apply (only against the Pet project — never any other project):
--   supabase db push --project-ref <PET_PROJECT_REF> \
--     --file supabase/migrations-external/20260601_pet_baseline_schema.sql
--   …then the remaining files in ascending filename order.
--
-- Column names such as `wedding_date` are kept ON PURPOSE at this stage so the
-- application code keeps compiling; a later product migration renames them.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- events — one row per customer project (organizer-owned)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- uploads — source photos contributed to an event
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- mosaics — generation jobs + outputs (worker writes progress/variants here)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- guestbook_messages
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.guestbook_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  guest_name  text,
  message     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS guestbook_messages_event_id_idx ON public.guestbook_messages (event_id);

-- ---------------------------------------------------------------------------
-- Data API grants (the later RLS migrations restrict what each role may do)
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.events, public.uploads, public.mosaics, public.guestbook_messages TO anon, authenticated;
GRANT ALL ON public.events, public.uploads, public.mosaics, public.guestbook_messages TO service_role;

-- ---------------------------------------------------------------------------
-- Storage buckets — owned by the Pet project
--   covers  : public  — cover images
--   photos  : private — TEMPORARY customer source photos. Short retention:
--                        may be purged once the final mosaic is delivered.
--   mosaics : private — PERMANENT / long-lived final mosaics, print exports,
--                        deep-zoom tiles and download archives.
-- Size limits are raised by 20260704_mosaics_bucket_size_limit.sql and
-- 20260824_photos_bucket_raw_size_limit.sql; bucket policies by
-- 20260625_dzi_public_read.sql and 20260826_rls_hardening.sql.
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('covers', 'covers', true),
       ('photos', 'photos', false),
       ('mosaics', 'mosaics', false)
ON CONFLICT (id) DO NOTHING;

-- Public read of cover images.
DROP POLICY IF EXISTS "Public read covers" ON storage.objects;
CREATE POLICY "Public read covers"
  ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'covers');

-- Signed-in organizers manage their own cover objects (path prefix = user id
-- or event id is enforced by the app; ownership column by Storage).
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

-- Temporary source photos: anyone with the event link may upload (guest
-- flow); reads go through signed URLs issued by the app / worker.
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

-- Final mosaics are written by the worker (service role, bypasses RLS) and
-- read by signed-in organizers; DZI tiles get public read in 20260625.
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

COMMIT;
