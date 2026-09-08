-- ---------------------------------------------------------------------------
-- Guest photo ownership
--
-- Adds a per-device Guest ID column to uploads so guests can remove ONLY the
-- photos they contributed themselves, without accounts.
--
-- Ownership rule:
--   - Every upload from the Guest Page carries `guest_uuid` (generated on the
--     device and stored in localStorage, mirroring the existing guest
--     identity pattern).
--   - A guest may delete an upload only until whichever comes first:
--       (a) 24 hours after uploaded_at, or
--       (b) the event's first mosaic row is created.
--   - The event organizer keeps full moderation via the dashboard flow
--     (unchanged).
--
-- Because guests are unauthenticated (`anon`), enforcement lives inside a
-- SECURITY DEFINER function rather than a raw RLS delete policy — RLS alone
-- cannot verify that the caller actually owns the row.
-- ---------------------------------------------------------------------------

ALTER TABLE public.uploads
  ADD COLUMN IF NOT EXISTS guest_uuid uuid;

CREATE INDEX IF NOT EXISTS uploads_guest_uuid_idx
  ON public.uploads (event_id, guest_uuid);

-- ---------------------------------------------------------------------------
-- delete_own_upload(_upload_id, _guest_uuid)
--
-- Returns jsonb: { ok: bool, reason?: text }
--   reasons: not_found | forbidden | expired | mosaic_generated
-- On success, also removes storage objects under {event_id}/{photo_id}/.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_own_upload(
  _upload_id uuid,
  _guest_uuid uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  _row public.uploads;
  _has_mosaic boolean;
  _prefix text;
BEGIN
  SELECT * INTO _row FROM public.uploads WHERE id = _upload_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF _row.guest_uuid IS NULL OR _row.guest_uuid <> _guest_uuid THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  IF _row.uploaded_at < (now() - interval '24 hours') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'expired');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.mosaics WHERE event_id = _row.event_id
  ) INTO _has_mosaic;

  IF _has_mosaic THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'mosaic_generated');
  END IF;

  -- Storage objects sit under "{event_id}/{photo_id}/..." — derive the
  -- prefix from image_url so we clean up every variant (original, display,
  -- thumb_600, thumb_300).
  _prefix := substring(_row.image_url from '^([^/]+/[^/]+)/');

  DELETE FROM public.uploads WHERE id = _upload_id;

  IF _prefix IS NOT NULL THEN
    DELETE FROM storage.objects
    WHERE bucket_id = 'photos'
      AND name LIKE _prefix || '/%';
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_own_upload(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.delete_own_upload(uuid, uuid) TO anon, authenticated;
