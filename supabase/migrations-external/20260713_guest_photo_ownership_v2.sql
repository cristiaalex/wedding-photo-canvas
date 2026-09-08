-- ---------------------------------------------------------------------------
-- Guest photo ownership — v2
--
-- Supersedes 20260713_guest_photo_ownership.sql. The previous version tried
-- to `DELETE FROM storage.objects` inside a SECURITY DEFINER function, which
-- Supabase rejects at runtime with:
--
--   ERROR:  42501  Direct deletion from storage tables is not allowed.
--                  Use the Storage API instead.
--
-- Split the flow into two RPCs so the app can call the Storage API between
-- validation and the final row delete:
--
--   1. prepare_own_upload_delete(_upload_id, _guest_uuid)
--        -> validates ownership + 24h window + no-mosaic
--        -> returns { ok, paths: text[] } (the object names under 'photos'
--           bucket that must be removed via the Storage API)
--
--   2. finalize_own_upload_delete(_upload_id, _guest_uuid)
--        -> re-validates and deletes the uploads row
--        -> called ONLY after supabase.storage.from('photos').remove(paths)
--
-- Ownership rules and the 24h / pre-mosaic restrictions are unchanged.
-- ---------------------------------------------------------------------------

-- Drop the broken v1 function.
DROP FUNCTION IF EXISTS public.delete_own_upload(uuid, uuid);

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

  -- Storage objects sit under "{event_id}/{photo_id}/..." — collect every
  -- variant (original, display, thumb_600, thumb_300) so the caller can
  -- remove them in one Storage API call.
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
    -- Row already gone — treat as success so the client can converge state.
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
