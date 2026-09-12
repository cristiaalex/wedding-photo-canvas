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

GRANT SELECT, INSERT                 ON public.guestbook_messages TO anon;
GRANT SELECT, INSERT, DELETE         ON public.guestbook_messages TO authenticated;
GRANT ALL                            ON public.guestbook_messages TO service_role;

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

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid null,
  stripe_customer_id text not null,
  stripe_subscription_id text unique,
  stripe_price_id text,
  status text not null default 'incomplete',
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_user_id_key ON public.subscriptions (user_id);
CREATE INDEX IF NOT EXISTS subscriptions_customer_idx ON public.subscriptions (stripe_customer_id);

GRANT SELECT ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own subscription readable" ON public.subscriptions;
CREATE POLICY "own subscription readable"
  ON public.subscriptions FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.stripe_events (
  id text primary key,
  type text not null,
  processed_at timestamptz not null default now()
);

GRANT ALL ON public.stripe_events TO service_role;
ALTER TABLE public.stripe_events ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.touch_subscriptions_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

DROP TRIGGER IF EXISTS subscriptions_touch_updated_at ON public.subscriptions;
CREATE TRIGGER subscriptions_touch_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.touch_subscriptions_updated_at();

CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL,
  actor_email   text,
  action        text NOT NULL,
  target_type   text,
  target_id     text,
  detail        jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_audit_log_created_at_idx
  ON public.admin_audit_log (created_at DESC);

GRANT ALL ON public.admin_audit_log TO service_role;
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text,
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS amount_total integer,
  ADD COLUMN IF NOT EXISTS currency text;

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_payment_intent_key
  ON public.subscriptions (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_checkout_session_key
  ON public.subscriptions (stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;