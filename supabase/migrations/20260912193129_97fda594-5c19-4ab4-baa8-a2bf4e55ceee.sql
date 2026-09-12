ALTER TABLE public.mosaics
  ADD COLUMN IF NOT EXISTS preview_url text;

ALTER TABLE public.uploads
  ADD COLUMN IF NOT EXISTS guest_uuid uuid;

CREATE INDEX IF NOT EXISTS uploads_guest_uuid_idx
  ON public.uploads (event_id, guest_uuid);

CREATE OR REPLACE FUNCTION public.prepare_own_upload_delete(
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
  _paths text[];
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

  _prefix := substring(_row.image_url from '^([^/]+/[^/]+)/');

  IF _prefix IS NULL THEN
    _paths := ARRAY[]::text[];
  ELSE
    SELECT COALESCE(array_agg(name), ARRAY[]::text[])
    INTO _paths
    FROM storage.objects
    WHERE bucket_id = 'photos'
      AND name LIKE _prefix || '/%';
  END IF;

  RETURN jsonb_build_object('ok', true, 'paths', to_jsonb(_paths));
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_own_upload_delete(
  _upload_id uuid,
  _guest_uuid uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row public.uploads;
  _has_mosaic boolean;
BEGIN
  SELECT * INTO _row FROM public.uploads WHERE id = _upload_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true);
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

  DELETE FROM public.uploads WHERE id = _upload_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_own_upload_delete(uuid, uuid) FROM public;
REVOKE ALL ON FUNCTION public.finalize_own_upload_delete(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.prepare_own_upload_delete(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_own_upload_delete(uuid, uuid) TO anon, authenticated;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS guests_can_view_gallery boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS guestbook_enabled       boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS guestbook_public        boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_owner_uploads_to_guests boolean NOT NULL DEFAULT false;

ALTER TABLE public.uploads
  ADD COLUMN IF NOT EXISTS uploaded_by_owner boolean NOT NULL DEFAULT false;

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