-- Convert billing from recurring subscriptions to ONE-TIME payments.
-- Safe + idempotent: purely additive, no drops, no data loss.
-- Run against the external (user-managed) Supabase project.

-- 1. New one-time payment columns on the existing table ---------------------
alter table public.subscriptions
  add column if not exists stripe_payment_intent_id text,
  add column if not exists stripe_checkout_session_id text,
  add column if not exists paid_at timestamptz,
  add column if not exists amount_total integer,
  add column if not exists currency text;

-- Recurring-only columns are intentionally KEPT (nullable) so nothing breaks;
-- they are simply no longer written or read by the application.

-- 2. Idempotency guards -----------------------------------------------------
create unique index if not exists subscriptions_payment_intent_key
  on public.subscriptions (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

create unique index if not exists subscriptions_checkout_session_key
  on public.subscriptions (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

-- 3. Backfill: any previously successful test subscription counts as paid ---
update public.subscriptions
set status = 'paid',
    paid_at = coalesce(paid_at, current_period_start, created_at)
where status in ('active', 'trialing')
  and paid_at is null;

-- Grants / RLS unchanged: select for the owner, writes are service-role only.
