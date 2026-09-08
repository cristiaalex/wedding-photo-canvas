-- =============================================================================
-- Owner (couple) upload privacy
--
-- Adds ONE event-level setting plus the ownership flag needed to enforce it:
--
--   events.show_owner_uploads_to_guests  boolean NOT NULL DEFAULT false
--       OFF (default) = photos uploaded by the couple are private from guests.
--       ON            = those photos follow the normal gallery rules.
--
--   uploads.uploaded_by_owner            boolean NOT NULL DEFAULT false
--       Set automatically by a trigger: true when the inserting session is
--       the event's organizer. Guests (anon) always insert false.
--
-- Enforcement lives in the uploads SELECT policy, so a private couple photo
-- is invisible to guest sessions at the database level — not just in the UI.
-- Mosaic generation runs as the organizer, so private photos remain fully
-- available as Mosaic source photos.
--
-- Run manually in the external Supabase SQL editor (project redjgmjkgdaplgsqjfrg).
-- =============================================================================

BEGIN;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS show_owner_uploads_to_guests boolean NOT NULL DEFAULT false;

ALTER TABLE public.uploads
  ADD COLUMN IF NOT EXISTS uploaded_by_owner boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- Trigger: stamp ownership server-side so it cannot be spoofed by a client.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_owner_upload()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.uploaded_by_owner := EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = NEW.event_id
      AND e.organizer_id IS NOT NULL
      AND e.organizer_id = auth.uid()
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS uploads_mark_owner ON public.uploads;
CREATE TRIGGER uploads_mark_owner
  BEFORE INSERT ON public.uploads
  FOR EACH ROW EXECUTE FUNCTION public.mark_owner_upload();

-- ---------------------------------------------------------------------------
-- SELECT policy: guest-uploaded photos behave exactly as before.
-- Couple-uploaded photos are visible to the organizer always, and to everyone
-- else only when the event setting is ON.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can view uploads" ON public.uploads;

CREATE POLICY "Anyone can view uploads"
  ON public.uploads
  FOR SELECT
  USING (
    uploaded_by_owner = false
    OR EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = uploads.event_id
        AND (
          e.show_owner_uploads_to_guests
          OR (e.organizer_id IS NOT NULL AND e.organizer_id = auth.uid())
        )
    )
  );

COMMIT;
