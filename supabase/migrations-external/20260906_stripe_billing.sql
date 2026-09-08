-- Stripe billing state (TEST MODE first).
-- Run this against the external (user-managed) Supabase project.

-- 1. Subscriptions ---------------------------------------------------------
create table if not exists public.subscriptions (
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

create unique index if not exists subscriptions_user_id_key on public.subscriptions (user_id);
create index if not exists subscriptions_customer_idx on public.subscriptions (stripe_customer_id);

grant select on public.subscriptions to authenticated;
grant all on public.subscriptions to service_role;

alter table public.subscriptions enable row level security;

drop policy if exists "own subscription readable" on public.subscriptions;
create policy "own subscription readable"
  on public.subscriptions for select
  to authenticated
  using (user_id = auth.uid());
-- No insert/update/delete policies: only the service role (webhook/server) writes.

-- 2. Webhook idempotency ---------------------------------------------------
create table if not exists public.stripe_events (
  id text primary key,               -- Stripe event id (evt_...)
  type text not null,
  processed_at timestamptz not null default now()
);

grant all on public.stripe_events to service_role;
alter table public.stripe_events enable row level security;
-- Intentionally no policies: service role only.

-- 3. updated_at trigger ----------------------------------------------------
create or replace function public.touch_subscriptions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists subscriptions_touch_updated_at on public.subscriptions;
create trigger subscriptions_touch_updated_at
  before update on public.subscriptions
  for each row execute function public.touch_subscriptions_updated_at();
