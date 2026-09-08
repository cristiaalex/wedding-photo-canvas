/**
 * Download-archive endpoints (Job D).
 *
 * Both are bearer-guarded with the same WORKER_API_TOKEN used by /generate,
 * and are only ever called from the app's server functions AFTER they have
 * verified that the caller owns the event. Nothing here is public.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { logger } from '../lib/logger';
import { getQueue } from '../worker';
import { getSupabase } from '../lib/supabase';

export const archiveRouter = Router();

function requireWorkerToken(req: Request, res: Response, next: NextFunction) {
  const header = req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token || token !== config.WORKER_API_TOKEN) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  return next();
}

const enqueueSchema = z.object({
  eventId: z.string().uuid(),
  batchId: z.string().uuid(),
});

/** Enqueue ZIP generation for an already-created batch. Idempotent: the job
 *  claims the row conditionally, so a duplicate enqueue is a no-op. */
archiveRouter.post('/archive', requireWorkerToken, async (req, res) => {
  const parsed = enqueueSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', details: parsed.error.flatten().fieldErrors });
  }
  const { eventId, batchId } = parsed.data;

  const sb = getSupabase();
  const { data: batch, error } = await sb
    .from('download_batches')
    .select('id,status,event_id')
    .eq('id', batchId)
    .eq('event_id', eventId)
    .maybeSingle();
  if (error) return res.status(500).json({ error: 'lookup_failed' });
  if (!batch) return res.status(404).json({ error: 'batch_not_found' });
  if (batch.status === 'completed') {
    return res.status(200).json({ accepted: false, reason: 'already_completed' });
  }

  // A retry of a failed batch re-uses the SAME batch + membership rows.
  if (batch.status === 'failed') {
    await sb.from('download_batches').update({ status: 'pending', error: null }).eq('id', batchId);
  }

  const queue = getQueue();
  const { jobId, queued, running } = await queue.enqueue(
    'generate-archive',
    { eventId, batchId },
    // Stable job id ⇒ a double-click cannot queue the same batch twice.
    { jobId: `archive-${batchId}` },
  );
  logger.info({ jobId, batchId, eventId, queued, running }, 'archive:accepted');
  return res.status(202).json({ accepted: true, jobId, queued, running });
});

const signSchema = z.object({
  eventId: z.string().uuid(),
  batchId: z.string().uuid(),
});

/** Lazily sign a completed archive for download (short-lived URL). */
archiveRouter.post('/archive-url', requireWorkerToken, async (req, res) => {
  const parsed = signSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body' });
  }
  const { eventId, batchId } = parsed.data;
  const sb = getSupabase();
  const { data: batch } = await sb
    .from('download_batches')
    .select('id,status,storage_path,batch_number')
    .eq('id', batchId)
    .eq('event_id', eventId)
    .maybeSingle();
  if (!batch || batch.status !== 'completed' || !batch.storage_path) {
    return res.status(404).json({ error: 'archive_not_ready' });
  }
  const { data, error } = await sb.storage
    .from(config.SUPABASE_STORAGE_BUCKET)
    .createSignedUrl(batch.storage_path, 60 * 10, {
      download: `photos-archive-${batch.batch_number}.zip`,
    });
  if (error || !data?.signedUrl) {
    return res.status(500).json({ error: 'sign_failed' });
  }
  return res.status(200).json({ url: data.signedUrl });
});
