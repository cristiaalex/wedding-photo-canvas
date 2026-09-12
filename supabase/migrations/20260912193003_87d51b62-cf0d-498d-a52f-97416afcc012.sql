ALTER TABLE public.events             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.uploads            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mosaics            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guestbook_messages ENABLE ROW LEVEL SECURITY;

GRANT SELECT                         ON public.events TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.events TO authenticated;
GRANT ALL                            ON public.events TO service_role;

GRANT SELECT, INSERT                 ON public.uploads TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uploads TO authenticated;
GRANT ALL                            ON public.uploads TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mosaics TO authenticated;
GRANT ALL                            ON public.mosaics TO service_role;

GRANT INSERT                         ON public.guestbook_messages TO anon;
GRANT SELECT, INSERT, DELETE         ON public.guestbook_messages TO authenticated;
GRANT ALL                            ON public.guestbook_messages TO service_role;

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

DROP POLICY IF EXISTS "Public read DZI assets" ON storage.objects;
CREATE POLICY "Public read DZI assets"
  ON storage.objects
  FOR SELECT
  TO anon, authenticated
  USING (
    bucket_id = 'mosaics'
    AND (
      name LIKE '%/dzi.dzi'
      OR name LIKE '%/dzi_files/%'
    )
  );

ALTER TABLE public.mosaics
  ADD COLUMN IF NOT EXISTS print_url    text,
  ADD COLUMN IF NOT EXISTS print_status text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mosaics_print_status_check'
  ) THEN
    ALTER TABLE public.mosaics
      ADD CONSTRAINT mosaics_print_status_check
      CHECK (print_status IS NULL OR print_status IN ('processing','ready','failed'));
  END IF;
END $$;