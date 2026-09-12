ALTER TABLE public.mosaics
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS thumb_url text,
  ADD COLUMN IF NOT EXISTS print_url text,
  ADD COLUMN IF NOT EXISTS print_status text,
  ADD COLUMN IF NOT EXISTS dzi_url text,
  ADD COLUMN IF NOT EXISTS tile_base_url text,
  ADD COLUMN IF NOT EXISTS dzi_status text,
  ADD COLUMN IF NOT EXISTS deepzoom_ready boolean,
  ADD COLUMN IF NOT EXISTS deepzoom_progress integer,
  ADD COLUMN IF NOT EXISTS stage text,
  ADD COLUMN IF NOT EXISTS progress integer,
  ADD COLUMN IF NOT EXISTS error text,
  ADD COLUMN IF NOT EXISTS checkpoints jsonb,
  ADD COLUMN IF NOT EXISTS worker_id text,
  ADD COLUMN IF NOT EXISTS metadata jsonb,
  ADD COLUMN IF NOT EXISTS photo_count integer,
  ADD COLUMN IF NOT EXISTS tile_count integer;

ALTER TABLE public.mosaics
  ALTER COLUMN deepzoom_ready SET DEFAULT false,
  ALTER COLUMN deepzoom_progress SET DEFAULT 0,
  ALTER COLUMN progress SET DEFAULT 0,
  ALTER COLUMN checkpoints SET DEFAULT '{}'::jsonb;

UPDATE public.mosaics
SET
  deepzoom_ready = COALESCE(deepzoom_ready, false),
  deepzoom_progress = COALESCE(deepzoom_progress, 0),
  progress = COALESCE(progress, 0),
  checkpoints = COALESCE(checkpoints, '{}'::jsonb),
  stage = COALESCE(stage, status, 'pending');

ALTER TABLE public.mosaics
  ALTER COLUMN deepzoom_ready SET NOT NULL,
  ALTER COLUMN deepzoom_progress SET NOT NULL,
  ALTER COLUMN progress SET NOT NULL,
  ALTER COLUMN checkpoints SET NOT NULL;

ALTER TABLE public.mosaics
  DROP CONSTRAINT IF EXISTS mosaics_print_status_check,
  DROP CONSTRAINT IF EXISTS mosaics_dzi_status_check,
  DROP CONSTRAINT IF EXISTS mosaics_deepzoom_progress_check,
  DROP CONSTRAINT IF EXISTS mosaics_progress_check,
  DROP CONSTRAINT IF EXISTS mosaics_status_check,
  DROP CONSTRAINT IF EXISTS mosaics_stage_check;

ALTER TABLE public.mosaics
  ADD CONSTRAINT mosaics_print_status_check
    CHECK (print_status IS NULL OR print_status IN ('processing', 'ready', 'failed')),
  ADD CONSTRAINT mosaics_dzi_status_check
    CHECK (dzi_status IS NULL OR dzi_status IN ('processing', 'ready', 'failed')),
  ADD CONSTRAINT mosaics_deepzoom_progress_check
    CHECK (deepzoom_progress >= 0 AND deepzoom_progress <= 100),
  ADD CONSTRAINT mosaics_progress_check
    CHECK (progress >= 0 AND progress <= 100),
  ADD CONSTRAINT mosaics_status_check
    CHECK (status IS NULL OR status IN ('pending','queued','processing','fetching','analyzing','building','uploading','finalizing','ready','deepzoom','deepzoom_ready','failed')),
  ADD CONSTRAINT mosaics_stage_check
    CHECK (stage IS NULL OR stage IN ('pending','queued','processing','fetching','analyzing','building','uploading','finalizing','ready','deepzoom','deepzoom_ready','failed'));

CREATE INDEX IF NOT EXISTS mosaics_event_id_created_at_idx
  ON public.mosaics (event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS mosaics_event_status_created_at_idx
  ON public.mosaics (event_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS mosaics_waiting_for_artifacts_idx
  ON public.mosaics (event_id, created_at DESC)
  WHERE status IN ('queued', 'pending', 'processing', 'fetching', 'analyzing', 'building', 'uploading', 'finalizing', 'deepzoom');

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mosaics TO authenticated;
GRANT ALL ON public.mosaics TO service_role;

ALTER TABLE public.mosaics
  ALTER COLUMN print_status DROP DEFAULT,
  ALTER COLUMN dzi_status DROP DEFAULT;