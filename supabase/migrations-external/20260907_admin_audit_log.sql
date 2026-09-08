-- Admin audit log (foundation only).
--
-- Prepares the architecture so every future privileged admin action can be
-- recorded. Nothing writes to it yet apart from the `recordAdminAction()`
-- seam in src/lib/admin.server.ts.
--
-- Access model: service-role only. No anon/authenticated grants, so this
-- table is unreachable from the browser even with a valid user session.
-- Existing customer-facing policies are untouched.

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
-- Intentionally no policies: only the service-role key (server-side) may read
-- or write this table.
