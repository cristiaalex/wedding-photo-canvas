CREATE TABLE IF NOT EXISTS public.download_batches (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  batch_number  integer NOT NULL,
  photo_count   integer NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  storage_path  text,
  size_bytes    bigint,
  attempts      integer NOT NULL DEFAULT 0,
  worker_id     text,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  started_at    timestamptz,
  completed_at  timestamptz,
  UNIQUE (event_id, batch_number)
);

CREATE TABLE IF NOT EXISTS public.download_batch_items (
  batch_id   uuid NOT NULL REFERENCES public.download_batches(id) ON DELETE CASCADE,
  upload_id  uuid NOT NULL REFERENCES public.uploads(id) ON DELETE CASCADE,
  event_id   uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  PRIMARY KEY (batch_id, upload_id),
  UNIQUE (event_id, upload_id)
);

CREATE INDEX IF NOT EXISTS download_batches_event_idx
  ON public.download_batches (event_id, batch_number);
CREATE INDEX IF NOT EXISTS download_batch_items_batch_idx
  ON public.download_batch_items (batch_id);

GRANT SELECT ON public.download_batches TO authenticated;
GRANT SELECT ON public.download_batch_items TO authenticated;
GRANT ALL ON public.download_batches TO service_role;
GRANT ALL ON public.download_batch_items TO service_role;

ALTER TABLE public.download_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.download_batch_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Organizers can view their download batches" ON public.download_batches;
CREATE POLICY "Organizers can view their download batches"
  ON public.download_batches
  FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = download_batches.event_id AND e.organizer_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Organizers can view their batch items" ON public.download_batch_items;
CREATE POLICY "Organizers can view their batch items"
  ON public.download_batch_items
  FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = download_batch_items.event_id AND e.organizer_id = auth.uid()
  ));

CREATE OR REPLACE FUNCTION public.create_download_batch(_event_id uuid)
RETURNS public.download_batches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _batch public.download_batches;
  _next  integer;
  _count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = _event_id AND e.organizer_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('download_batch:' || _event_id::text, 0));

  SELECT * INTO _batch
  FROM public.download_batches
  WHERE event_id = _event_id AND status IN ('pending', 'processing')
  ORDER BY batch_number DESC
  LIMIT 1;
  IF FOUND THEN
    RETURN _batch;
  END IF;

  SELECT COALESCE(MAX(batch_number), 0) + 1 INTO _next
  FROM public.download_batches WHERE event_id = _event_id;

  INSERT INTO public.download_batches (event_id, batch_number, status)
  VALUES (_event_id, _next, 'pending')
  RETURNING * INTO _batch;

  INSERT INTO public.download_batch_items (batch_id, upload_id, event_id)
  SELECT _batch.id, u.id, _event_id
  FROM public.uploads u
  WHERE u.event_id = _event_id
    AND u.image_url IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.download_batch_items i
      WHERE i.event_id = _event_id AND i.upload_id = u.id
    );

  GET DIAGNOSTICS _count = ROW_COUNT;

  IF _count = 0 THEN
    DELETE FROM public.download_batches WHERE id = _batch.id;
    RETURN NULL;
  END IF;

  UPDATE public.download_batches
  SET photo_count = _count
  WHERE id = _batch.id
  RETURNING * INTO _batch;

  RETURN _batch;
END;
$$;

REVOKE ALL ON FUNCTION public.create_download_batch(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_download_batch(uuid) TO authenticated;

ALTER TABLE public.uploads
  ADD COLUMN IF NOT EXISTS original_format text,
  ADD COLUMN IF NOT EXISTS optimize_status text,
  ADD COLUMN IF NOT EXISTS optimize_error text,
  ADD COLUMN IF NOT EXISTS source_path text,
  ADD COLUMN IF NOT EXISTS original_size_bytes bigint,
  ADD COLUMN IF NOT EXISTS optimized_size_bytes bigint,
  ADD COLUMN IF NOT EXISTS optimized_at timestamptz;

CREATE INDEX IF NOT EXISTS uploads_optimize_status_idx
  ON public.uploads (optimize_status)
  WHERE optimize_status IS NOT NULL AND optimize_status <> 'ready';

COMMENT ON COLUMN public.uploads.optimize_status IS
  'NULL for normal uploads. pending | processing | ready | failed for special RAW uploads.';
COMMENT ON COLUMN public.uploads.source_path IS
  'Storage path of the source RAW file while it still exists; cleared after a verified conversion.';