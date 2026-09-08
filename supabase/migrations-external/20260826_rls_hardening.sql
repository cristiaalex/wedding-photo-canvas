-- =============================================================================
-- SECURITY HARDENING — Mosaic Pet database (target: the Pet Supabase project only)
-- =============================================================================
-- Verified on 2026-08-26: the anon/publishable key can currently read EVERY row
-- in public.events, public.uploads and public.guestbook_messages. The earlier
-- file 20260624_enable_rls_app_tables.sql was never applied to the live
-- project. This file supersedes it and folds in every policy change made since
-- (owner-upload privacy, public/private guestbook).
--
-- HOW TO APPLY (required — tools in this repo cannot reach that project):
--   Open the external project's SQL editor and run this file end to end, or
--   supabase db push --project-ref <PET_PROJECT_REF> \
--     --file supabase/migrations-external/20260826_rls_hardening.sql
--
-- Fixes findings:
--   rls_app_tables_no_rls_external, guestbook_private_msgs_no_rls,
--   event_edit_client_auth_no_rls
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Enable RLS everywhere
-- ---------------------------------------------------------------------------
ALTER TABLE public.events             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.uploads            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mosaics            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guestbook_messages ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2. Data API grants (PostgREST grants nothing on public by default)
-- ---------------------------------------------------------------------------
GRANT SELECT                         ON public.events TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.events TO authenticated;
GRANT ALL                            ON public.events TO service_role;

GRANT SELECT, INSERT                 ON public.uploads TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uploads TO authenticated;
GRANT ALL                            ON public.uploads TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mosaics TO authenticated;
GRANT ALL                            ON public.mosaics TO service_role;

GRANT SELECT, INSERT                 ON public.guestbook_messages TO anon;
GRANT SELECT, INSERT, DELETE         ON public.guestbook_messages TO authenticated;
GRANT ALL                            ON public.guestbook_messages TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Reset policies (idempotent re-run)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Public can view events"          ON public.events;
DROP POLICY IF EXISTS "Organizers insert own events"    ON public.events;
DROP POLICY IF EXISTS "Organizers update own events"    ON public.events;
DROP POLICY IF EXISTS "Organizers delete own events"    ON public.events;

DROP POLICY IF EXISTS "Anyone can view uploads"         ON public.uploads;
DROP POLICY IF EXISTS "Anyone can insert uploads"       ON public.uploads;
DROP POLICY IF EXISTS "Organizers update event uploads" ON public.uploads;
DROP POLICY IF EXISTS "Organizers delete event uploads" ON public.uploads;

DROP POLICY IF EXISTS "Organizers view own mosaics"     ON public.mosaics;
DROP POLICY IF EXISTS "Organizers insert own mosaics"   ON public.mosaics;
DROP POLICY IF EXISTS "Organizers update own mosaics"   ON public.mosaics;
DROP POLICY IF EXISTS "Organizers delete own mosaics"   ON public.mosaics;

DROP POLICY IF EXISTS "Anyone can insert guestbook"     ON public.guestbook_messages;
DROP POLICY IF EXISTS "Organizers read guestbook"       ON public.guestbook_messages;
DROP POLICY IF EXISTS "Public guestbook readable"       ON public.guestbook_messages;
DROP POLICY IF EXISTS "Organizers delete guestbook"     ON public.guestbook_messages;

-- ---------------------------------------------------------------------------
-- 4. EVENTS — public read (guest pages resolve by slug), organizer-only writes
-- ---------------------------------------------------------------------------
CREATE POLICY "Public can view events"
  ON public.events FOR SELECT USING (true);

CREATE POLICY "Organizers insert own events"
  ON public.events FOR INSERT TO authenticated
  WITH CHECK (organizer_id = auth.uid());

CREATE POLICY "Organizers update own events"
  ON public.events FOR UPDATE TO authenticated
  USING (organizer_id = auth.uid())
  WITH CHECK (organizer_id = auth.uid());

CREATE POLICY "Organizers delete own events"
  ON public.events FOR DELETE TO authenticated
  USING (organizer_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 5. UPLOADS — guests upload and browse; couple uploads stay private unless
--    the event setting says otherwise. Only the organizer may edit/delete.
-- ---------------------------------------------------------------------------
CREATE POLICY "Anyone can view uploads"
  ON public.uploads FOR SELECT
  USING (
    coalesce(uploaded_by_owner, false) = false
    OR EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = uploads.event_id
        AND (
          coalesce(e.show_owner_uploads_to_guests, false)
          OR (e.organizer_id IS NOT NULL AND e.organizer_id = auth.uid())
        )
    )
  );

CREATE POLICY "Anyone can insert uploads"
  ON public.uploads FOR INSERT WITH CHECK (true);

CREATE POLICY "Organizers update event uploads"
  ON public.uploads FOR UPDATE TO authenticated
  USING (event_id IN (SELECT id FROM public.events WHERE organizer_id = auth.uid()))
  WITH CHECK (event_id IN (SELECT id FROM public.events WHERE organizer_id = auth.uid()));

CREATE POLICY "Organizers delete event uploads"
  ON public.uploads FOR DELETE TO authenticated
  USING (event_id IN (SELECT id FROM public.events WHERE organizer_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- 6. MOSAICS — organizer only
-- ---------------------------------------------------------------------------
CREATE POLICY "Organizers view own mosaics"
  ON public.mosaics FOR SELECT TO authenticated
  USING (event_id IN (SELECT id FROM public.events WHERE organizer_id = auth.uid()));

CREATE POLICY "Organizers insert own mosaics"
  ON public.mosaics FOR INSERT TO authenticated
  WITH CHECK (event_id IN (SELECT id FROM public.events WHERE organizer_id = auth.uid()));

CREATE POLICY "Organizers update own mosaics"
  ON public.mosaics FOR UPDATE TO authenticated
  USING (event_id IN (SELECT id FROM public.events WHERE organizer_id = auth.uid()))
  WITH CHECK (event_id IN (SELECT id FROM public.events WHERE organizer_id = auth.uid()));

CREATE POLICY "Organizers delete own mosaics"
  ON public.mosaics FOR DELETE TO authenticated
  USING (event_id IN (SELECT id FROM public.events WHERE organizer_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- 7. GUESTBOOK — anyone may write; reads only when the couple made the
--    guestbook public, plus the organizer always.
-- ---------------------------------------------------------------------------
CREATE POLICY "Anyone can insert guestbook"
  ON public.guestbook_messages FOR INSERT WITH CHECK (true);

CREATE POLICY "Public guestbook readable"
  ON public.guestbook_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = guestbook_messages.event_id
        AND (
          (coalesce(e.guestbook_enabled, true) AND coalesce(e.guestbook_public, false))
          OR (e.organizer_id IS NOT NULL AND e.organizer_id = auth.uid())
        )
    )
  );

CREATE POLICY "Organizers delete guestbook"
  ON public.guestbook_messages FOR DELETE TO authenticated
  USING (event_id IN (SELECT id FROM public.events WHERE organizer_id = auth.uid()));

COMMIT;
