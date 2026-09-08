/**
 * Optimized-Original endpoint (Job E).
 *
 * Bearer-guarded with the same WORKER_API_TOKEN as /generate and /archive.
 * Called by the app's server function right after a guest uploads a special
 * RAW file (DNG / Apple ProRAW). Nothing here is public.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { logger } from '../lib/logger';
import { getQueue } from '../worker';
import { getSupabase } from '../lib/supabase';

export const optimizeRouter = Router();

function requireWorkerToken(req: Request, res: Response, next: NextFunction) {
  const header = req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token || token !== config.WORKER_API_TOKEN) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  return next();
}

const schema = z.object({
  eventId: z.string().uuid(),
  uploadId: z.string().uuid(),
});

optimizeRouter.post('/optimize', requireWorkerToken, async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', details: parsed.error.flatten().fieldErrors });
  }
  const { eventId, uploadId } = parsed.data;

  const sb = getSupabase();
  const { data: row, error } = await sb
    .from('uploads')
    .select('id,optimize_status,source_path')
    .eq('id', uploadId)
    .eq('event_id', eventId)
    .maybeSingle();
  if (error) return res.status(500).json({ error: 'lookup_failed' });
  if (!row) return res.status(404).json({ error: 'upload_not_found' });
  const r = row as { optimize_status: string | null; source_path: string | null };
  if (r.optimize_status === 'ready') {
    return res.status(200).json({ accepted: false, reason: 'already_optimized' });
  }
  if (!r.source_path) return res.status(409).json({ error: 'no_source_file' });

  // Stable job id ⇒ a retry while the job is queued is a no-op, and the job
  // itself is idempotent (it only overwrites its own derivatives).
  const { jobId, queued, running } = await getQueue().enqueue(
    'optimize-upload',
    { eventId, uploadId },
    { jobId: `optimize-${uploadId}` },
  );
  logger.info({ jobId, uploadId, eventId, queued, running }, 'optimize:accepted');
  return res.status(202).json({ accepted: true, jobId, queued, running });
});
