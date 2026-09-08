-- =============================================================================
-- Single-Master Pipeline Migration
--
-- Safe to paste into the SQL editor and safe to run more than once.
-- All statements that reference newly-created columns are executed dynamically,
-- so the editor cannot pre-parse them before ALTER TABLE has added the columns.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  -- ---------------------------------------------------------------------------
  -- 1. Add every column required by the single-master pipeline.
  -- ---------------------------------------------------------------------------
  EXECUTE $sql$
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
      ADD COLUMN IF NOT EXISTS tile_count integer
  $sql$;

  -- ---------------------------------------------------------------------------
  -- 2. Defaults / nullability for worker-owned bookkeeping columns.
  -- ---------------------------------------------------------------------------
  EXECUTE $sql$
    ALTER TABLE public.mosaics
      ALTER COLUMN deepzoom_ready SET DEFAULT false,
      ALTER COLUMN deepzoom_progress SET DEFAULT 0,
      ALTER COLUMN progress SET DEFAULT 0,
      ALTER COLUMN checkpoints SET DEFAULT '{}'::jsonb
  $sql$;

  EXECUTE $sql$
    UPDATE public.mosaics
    SET
      deepzoom_ready = COALESCE(deepzoom_ready, false),
      deepzoom_progress = COALESCE(deepzoom_progress, 0),
      progress = COALESCE(progress, 0),
      checkpoints = COALESCE(checkpoints, '{}'::jsonb),
      stage = COALESCE(stage, status, 'pending')
  $sql$;

  EXECUTE $sql$
    ALTER TABLE public.mosaics
      ALTER COLUMN deepzoom_ready SET NOT NULL,
      ALTER COLUMN deepzoom_progress SET NOT NULL,
      ALTER COLUMN progress SET NOT NULL,
      ALTER COLUMN checkpoints SET NOT NULL
  $sql$;

  -- ---------------------------------------------------------------------------
  -- 3. Remove legacy 8K preview schema.
  -- ---------------------------------------------------------------------------
  EXECUTE $sql$
    ALTER TABLE public.mosaics
      DROP COLUMN IF EXISTS preview_url,
      DROP COLUMN IF EXISTS preview_status,
      DROP COLUMN IF EXISTS preview_generated_at
  $sql$;

  -- ---------------------------------------------------------------------------
  -- 4. Drop old CHECK constraints before normalizing legacy values.
  -- ---------------------------------------------------------------------------
  EXECUTE $sql$
    ALTER TABLE public.mosaics
      DROP CONSTRAINT IF EXISTS mosaics_print_status_check,
      DROP CONSTRAINT IF EXISTS mosaics_dzi_status_check,
      DROP CONSTRAINT IF EXISTS mosaics_deepzoom_progress_check,
      DROP CONSTRAINT IF EXISTS mosaics_progress_check,
      DROP CONSTRAINT IF EXISTS mosaics_status_check,
      DROP CONSTRAINT IF EXISTS mosaics_stage_check
  $sql$;

  -- ---------------------------------------------------------------------------
  -- 5. Normalize legacy values so the new constraints can be validated.
  -- ---------------------------------------------------------------------------
  EXECUTE $sql$
    UPDATE public.mosaics
    SET print_status = lower(btrim(print_status))
    WHERE print_status IS NOT NULL
  $sql$;

  EXECUTE $sql$
    UPDATE public.mosaics
    SET dzi_status = lower(btrim(dzi_status))
    WHERE dzi_status IS NOT NULL
  $sql$;

  EXECUTE $sql$
    UPDATE public.mosaics
    SET status = lower(btrim(status))
    WHERE status IS NOT NULL
  $sql$;

  EXECUTE $sql$
    UPDATE public.mosaics
    SET stage = lower(btrim(stage))
    WHERE stage IS NOT NULL
  $sql$;

  EXECUTE $sql$
    UPDATE public.mosaics
    SET print_status = CASE
      WHEN print_status IN ('processing', 'ready', 'failed') THEN print_status
      WHEN print_status IN ('complete', 'completed', 'done', 'success', 'succeeded', 'uploaded') THEN 'ready'
      WHEN print_status IN ('queued', 'pending', 'started', 'running', 'uploading', 'generating') THEN 'processing'
      WHEN print_status IN ('error', 'errored', 'failure') THEN 'failed'
      WHEN print_url IS NOT NULL AND btrim(print_url) <> '' THEN 'ready'
      WHEN status = 'failed' THEN 'failed'
      WHEN status IN ('queued', 'pending', 'processing', 'fetching', 'analyzing', 'building', 'uploading', 'finalizing', 'deepzoom') THEN 'processing'
      ELSE NULL
    END
  $sql$;

  EXECUTE $sql$
    UPDATE public.mosaics
    SET dzi_status = CASE
      WHEN dzi_status IN ('processing', 'ready', 'failed') THEN dzi_status
      WHEN dzi_status IN ('complete', 'completed', 'done', 'success', 'succeeded', 'uploaded', 'deepzoom_ready') THEN 'ready'
      WHEN dzi_status IN ('queued', 'pending', 'started', 'running', 'uploading', 'generating', 'deepzoom') THEN 'processing'
      WHEN dzi_status IN ('error', 'errored', 'failure') THEN 'failed'
      WHEN deepzoom_ready IS TRUE THEN 'ready'
      WHEN dzi_url IS NOT NULL AND btrim(dzi_url) <> '' THEN 'ready'
      WHEN tile_base_url IS NOT NULL AND btrim(tile_base_url) <> '' THEN 'ready'
      WHEN image_url ILIKE '%.dzi%' OR image_url ILIKE '%/dzi/%' THEN 'ready'
      WHEN status = 'failed' THEN 'failed'
      WHEN status IN ('queued', 'pending', 'processing', 'fetching', 'analyzing', 'building', 'uploading', 'finalizing', 'deepzoom') THEN 'processing'
      ELSE NULL
    END
  $sql$;

  EXECUTE $sql$
    UPDATE public.mosaics
    SET status = CASE
      WHEN status IN ('pending', 'queued', 'processing', 'fetching', 'analyzing', 'building', 'uploading', 'finalizing', 'ready', 'deepzoom', 'deepzoom_ready', 'failed') THEN status
      WHEN status IN ('complete', 'completed', 'done', 'success', 'succeeded') THEN 'ready'
      WHEN status IN ('error', 'errored', 'failure') THEN 'failed'
      WHEN status IN ('started', 'running', 'generating') THEN 'processing'
      ELSE 'pending'
    END
  $sql$;

  EXECUTE $sql$
    UPDATE public.mosaics
    SET stage = CASE
      WHEN stage IN ('pending', 'queued', 'processing', 'fetching', 'analyzing', 'building', 'uploading', 'finalizing', 'ready', 'deepzoom', 'deepzoom_ready', 'failed') THEN stage
      WHEN stage IN ('complete', 'completed', 'done', 'success', 'succeeded') THEN 'ready'
      WHEN stage IN ('error', 'errored', 'failure') THEN 'failed'
      WHEN stage IN ('started', 'running', 'generating') THEN 'processing'
      ELSE COALESCE(status, 'pending')
    END
  $sql$;

  EXECUTE $sql$
    UPDATE public.mosaics
    SET
      deepzoom_ready = COALESCE(dzi_status = 'ready', false),
      deepzoom_progress = CASE
        WHEN dzi_status = 'ready' THEN 100
        ELSE LEAST(GREATEST(COALESCE(deepzoom_progress, 0), 0), 100)
      END,
      progress = LEAST(GREATEST(COALESCE(progress, 0), 0), 100)
  $sql$;

  EXECUTE $sql$
    UPDATE public.mosaics
    SET
      status = 'ready',
      stage = 'ready',
      progress = 100,
      deepzoom_ready = true,
      deepzoom_progress = 100,
      error = NULL
    WHERE dzi_status = 'ready'
      AND print_status = 'ready'
  $sql$;

  -- ---------------------------------------------------------------------------
  -- 6. Add constraints for the worker lifecycle and sidecar states.
  -- ---------------------------------------------------------------------------
  EXECUTE $sql$
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
        CHECK (status IS NULL OR status IN (
          'pending',
          'queued',
          'processing',
          'fetching',
          'analyzing',
          'building',
          'uploading',
          'finalizing',
          'ready',
          'deepzoom',
          'deepzoom_ready',
          'failed'
        )),
      ADD CONSTRAINT mosaics_stage_check
        CHECK (stage IS NULL OR stage IN (
          'pending',
          'queued',
          'processing',
          'fetching',
          'analyzing',
          'building',
          'uploading',
          'finalizing',
          'ready',
          'deepzoom',
          'deepzoom_ready',
          'failed'
        ))
  $sql$;

  -- ---------------------------------------------------------------------------
  -- 7. Indexes used by dashboard/history polling and ready-mosaic lookup.
  -- ---------------------------------------------------------------------------
  EXECUTE $sql$
    CREATE INDEX IF NOT EXISTS mosaics_event_id_created_at_idx
      ON public.mosaics (event_id, created_at DESC)
  $sql$;

  EXECUTE $sql$
    CREATE INDEX IF NOT EXISTS mosaics_event_status_created_at_idx
      ON public.mosaics (event_id, status, created_at DESC)
  $sql$;

  EXECUTE $sql$
    CREATE INDEX IF NOT EXISTS mosaics_waiting_for_artifacts_idx
      ON public.mosaics (event_id, created_at DESC)
      WHERE status IN ('queued', 'pending', 'processing', 'fetching', 'analyzing', 'building', 'uploading', 'finalizing', 'deepzoom')
  $sql$;

  -- ---------------------------------------------------------------------------
  -- 8. Data API grants. These do not loosen RLS.
  -- ---------------------------------------------------------------------------
  EXECUTE $sql$
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.mosaics TO authenticated
  $sql$;

  EXECUTE $sql$
    GRANT ALL ON public.mosaics TO service_role
  $sql$;
END $$;

COMMIT;
