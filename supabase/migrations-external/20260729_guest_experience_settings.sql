-- =============================================================================
-- Guest Experience settings (external Supabase project)
--
-- Adds three canonical boolean columns on public.events that drive the
-- three Guest Experience toggles surfaced in the owner's Settings page:
--
--   guests_can_view_gallery  → Gallery visibility
--   guestbook_enabled        → Guestbook (guests can submit messages)
--   guestbook_public         → Show guestbook publicly (guests can browse
--                              other guests' messages)
--
-- These are guest-facing permissions only. Owner access is enforced by the
-- existing per-event organizer policies and is NOT affected by these flags.
--
-- Photo uploads are intentionally NOT gated by a column — while the event's
-- collection period is active, guests can upload by default.
--
-- Run this file manually in the external Supabase SQL Editor
-- (project redjgmjkgdaplgsqjfrg). `supabase db push` from this repo does
-- NOT reach that project.
-- =============================================================================

BEGIN;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS guests_can_view_gallery boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS guestbook_enabled       boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS guestbook_public        boolean NOT NULL DEFAULT true;

COMMIT;
