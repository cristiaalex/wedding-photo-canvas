-- =============================================================================
-- External Supabase project migration: redjgmjkgdaplgsqjfrg.supabase.co
-- =============================================================================
-- This migration MUST be run manually against the EXTERNAL Supabase project
-- that hosts the application tables (events, uploads, mosaics,
-- guestbook_messages). The Lovable Cloud workspace does NOT contain these
-- tables, so `supabase db push` from this repo will not apply it.
--
-- How to apply:
--   Option A: Open the external project's SQL editor and paste this file.
--   Option B: supabase db push --project-ref redjgmjkgdaplgsqjfrg \
--             --file supabase/migrations-external/20260624_enable_rls_app_tables.sql
--
-- Fixes security findings:
--   - rls_app_tables        (No Row-Level Security on Core Application Tables)
--   - guestbook_private_msgs (Private Guestbook Messages Readable by Anyone)
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Enable Row Level Security on every app-facing table
-- ---------------------------------------------------------------------------
ALTER TABLE public.events             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.uploads            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mosaics            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guestbook_messages ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2. Base Data API grants
--    (PostgREST does not grant default privileges on the public schema.)
-- ---------------------------------------------------------------------------

-- events: public can read (needed for guest-facing pages by slug);
--         organizers manage their own rows.
GRANT SELECT                         ON public.events TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.events TO authenticated;
GRANT ALL                            ON public.events TO service_role;

-- uploads: guests can insert and read (public gallery); organizers manage.
GRANT SELECT, INSERT                 ON public.uploads TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uploads TO authenticated;
GRANT ALL                            ON public.uploads TO service_role;

-- mosaics: organizers only — no anon access.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mosaics TO authenticated;
GRANT ALL                            ON public.mosaics TO service_role;

-- guestbook_messages: guests can INSERT only; organizers SELECT/DELETE.
-- Anon is intentionally NOT granted SELECT — privacy guarantee.
GRANT INSERT                         ON public.guestbook_messages TO anon;
GRANT SELECT, INSERT, DELETE         ON public.guestbook_messages TO authenticated;
GRANT ALL                            ON public.guestbook_messages TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Drop any pre-existing policies (idempotent re-run)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Public can view events"            ON public.events;
DROP POLICY IF EXISTS "Organizers insert own events"      ON public.events;
DROP POLICY IF EXISTS "Organizers update own events"      ON public.events;
DROP POLICY IF EXISTS "Organizers delete own events"      ON public.events;

DROP POLICY IF EXISTS "Anyone can view uploads"           ON public.uploads;
DROP POLICY IF EXISTS "Anyone can insert uploads"         ON public.uploads;
DROP POLICY IF EXISTS "Organizers update event uploads"   ON public.uploads;
DROP POLICY IF EXISTS "Organizers delete event uploads"   ON public.uploads;

DROP POLICY IF EXISTS "Organizers view own mosaics"       ON public.mosaics;
DROP POLICY IF EXISTS "Organizers insert own mosaics"     ON public.mosaics;
DROP POLICY IF EXISTS "Organizers update own mosaics"     ON public.mosaics;
DROP POLICY IF EXISTS "Organizers delete own mosaics"     ON public.mosaics;

DROP POLICY IF EXISTS "Anyone can insert guestbook"       ON public.guestbook_messages;
DROP POLICY IF EXISTS "Organizers read guestbook"         ON public.guestbook_messages;
DROP POLICY IF EXISTS "Organizers delete guestbook"       ON public.guestbook_messages;

-- ---------------------------------------------------------------------------
-- 4. EVENTS policies
--    Guest pages look up events by slug with the anon key, so SELECT is public.
--    Write access is restricted to the row's organizer.
-- ---------------------------------------------------------------------------
CREATE POLICY "Public can view events"
  ON public.events
  FOR SELECT
  USING (true);

CREATE POLICY "Organizers insert own events"
  ON public.events
  FOR INSERT
  TO authenticated
  WITH CHECK (organizer_id = auth.uid());

CREATE POLICY "Organizers update own events"
  ON public.events
  FOR UPDATE
  TO authenticated
  USING (organizer_id = auth.uid())
  WITH CHECK (organizer_id = auth.uid());

CREATE POLICY "Organizers delete own events"
  ON public.events
  FOR DELETE
  TO authenticated
  USING (organizer_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 5. UPLOADS policies
--    Guests upload photos and view the gallery anonymously.
--    Only the event organizer can modify/delete uploads for their event.
-- ---------------------------------------------------------------------------
CREATE POLICY "Anyone can view uploads"
  ON public.uploads
  FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert uploads"
  ON public.uploads
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Organizers update event uploads"
  ON public.uploads
  FOR UPDATE
  TO authenticated
  USING (
    event_id IN (SELECT id FROM public.events WHERE organizer_id = auth.uid())
  )
  WITH CHECK (
    event_id IN (SELECT id FROM public.events WHERE organizer_id = auth.uid())
  );

CREATE POLICY "Organizers delete event uploads"
  ON public.uploads
  FOR DELETE
  TO authenticated
  USING (
    event_id IN (SELECT id FROM public.events WHERE organizer_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 6. MOSAICS policies
--    Only the owning organizer may read or write a mosaic record.
-- ---------------------------------------------------------------------------
CREATE POLICY "Organizers view own mosaics"
  ON public.mosaics
  FOR SELECT
  TO authenticated
  USING (
    event_id IN (SELECT id FROM public.events WHERE organizer_id = auth.uid())
  );

CREATE POLICY "Organizers insert own mosaics"
  ON public.mosaics
  FOR INSERT
  TO authenticated
  WITH CHECK (
    event_id IN (SELECT id FROM public.events WHERE organizer_id = auth.uid())
  );

CREATE POLICY "Organizers update own mosaics"
  ON public.mosaics
  FOR UPDATE
  TO authenticated
  USING (
    event_id IN (SELECT id FROM public.events WHERE organizer_id = auth.uid())
  )
  WITH CHECK (
    event_id IN (SELECT id FROM public.events WHERE organizer_id = auth.uid())
  );

CREATE POLICY "Organizers delete own mosaics"
  ON public.mosaics
  FOR DELETE
  TO authenticated
  USING (
    event_id IN (SELECT id FROM public.events WHERE organizer_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 7. GUESTBOOK_MESSAGES policies
--    Privacy promise: "Only the couple will see it."
--    => Guests can INSERT but cannot SELECT. Only the event's organizer reads.
-- ---------------------------------------------------------------------------
CREATE POLICY "Anyone can insert guestbook"
  ON public.guestbook_messages
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Organizers read guestbook"
  ON public.guestbook_messages
  FOR SELECT
  TO authenticated
  USING (
    event_id IN (SELECT id FROM public.events WHERE organizer_id = auth.uid())
  );

CREATE POLICY "Organizers delete guestbook"
  ON public.guestbook_messages
  FOR DELETE
  TO authenticated
  USING (
    event_id IN (SELECT id FROM public.events WHERE organizer_id = auth.uid())
  );

COMMIT;
