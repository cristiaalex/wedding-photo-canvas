-- =============================================================================
-- Add preview_url column to public.mosaics
--
-- Job A now emits a high-quality WebP preview (~2400px, quality 90) derived
-- from the raw master canvas. It's uploaded as `preview.webp` and stored in
-- this new column. The dashboard, loading state and history cards read from
-- `preview_url` first, falling back to `thumb_url` only for legacy rows.
--
-- Safe to run more than once.
-- =============================================================================

ALTER TABLE public.mosaics
  ADD COLUMN IF NOT EXISTS preview_url text;
