-- Discount Codes V1 (Stripe Coupons + Promotion Codes).
-- Purely additive and idempotent. No drops, no rewrites of existing rows.
-- Run against the external (user-managed) Supabase project.

-- 1. Discount codes ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.discount_codes (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                     text NOT NULL,
  discount_type            text NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
  percent_off              numeric(5,2),
  amount_off_cents         integer,
  currency                 text NOT NULL DEFAULT 'eur',
  valid_until              timestamptz,               -- NULL = forever
  max_redemptions          integer,                   -- NULL = unlimited
  per_customer_limit       integer,                   -- NULL = unlimited
  partner_name             text,
  commission_percent       numeric(5,2),
  internal_note            text,
  stripe_coupon_id         text,
  stripe_promotion_code_id text,
  status                   text NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active', 'paused')),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT discount_codes_value_check CHECK (
    (discount_type = 'percent'
       AND percent_off IS NOT NULL AND percent_off > 0 AND percent_off <= 100
       AND amount_off_cents IS NULL)
    OR
    (discount_type = 'fixed'
       AND amount_off_cents IS NOT NULL AND amount_off_cents > 0
       AND percent_off IS NULL)
  ),
  CONSTRAINT discount_codes_commission_check CHECK (
    commission_percent IS NULL
    OR (commission_percent >= 0 AND commission_percent <= 100)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS discount_codes_code_key
  ON public.discount_codes (upper(code));
CREATE INDEX IF NOT EXISTS discount_codes_created_at_idx
  ON public.discount_codes (created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS discount_codes_promo_key
  ON public.discount_codes (stripe_promotion_code_id)
  WHERE stripe_promotion_code_id IS NOT NULL;

GRANT ALL ON public.discount_codes TO service_role;
ALTER TABLE public.discount_codes ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies: back-office data, service role only.

CREATE OR REPLACE FUNCTION public.touch_discount_codes_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  new.updated_at = now();
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS discount_codes_touch_updated_at ON public.discount_codes;
CREATE TRIGGER discount_codes_touch_updated_at
  BEFORE UPDATE ON public.discount_codes
  FOR EACH ROW EXECUTE FUNCTION public.touch_discount_codes_updated_at();

-- 2. Purchase snapshot columns ---------------------------------------------
-- Immutable, per-transaction snapshot. Never recomputed from the current
-- discount-code configuration. Existing rows stay NULL (no discount).
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS discount_code_id        uuid,
  ADD COLUMN IF NOT EXISTS discount_code           text,
  ADD COLUMN IF NOT EXISTS original_amount_cents   integer,
  ADD COLUMN IF NOT EXISTS discount_amount_cents   integer,
  ADD COLUMN IF NOT EXISTS partner_name            text,
  ADD COLUMN IF NOT EXISTS commission_percent      numeric(5,2),
  ADD COLUMN IF NOT EXISTS commission_amount_cents integer;

CREATE INDEX IF NOT EXISTS subscriptions_discount_code_idx
  ON public.subscriptions (discount_code_id)
  WHERE discount_code_id IS NOT NULL;

-- Grants / RLS unchanged: owner may read own row, writes are service-role only.
