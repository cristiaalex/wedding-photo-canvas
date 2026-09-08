import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { logger } from '../lib/logger';
import { createProgressService } from '../lib/progress';
import { getQueue } from '../worker';
import { cancelEvent } from '../lib/cancellation';
import type { Queue } from '../queue/queue';

export const generateRouter = Router();

const bodySchema = z.object({
  eventId: z.string().uuid(),
  mosaicId: z.string().uuid(),
  coverImageUrl: z.string().url(),
  /** Optional algorithm suite override; default is 'default'. */
  suite: z.string().min(1).optional(),
});

/** Bearer-token guard. Keeps `/generate` non-public. */
function requireWorkerToken(req: Request, res: Response, next: NextFunction) {
  const header = req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token || token !== config.WORKER_API_TOKEN) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  return next();
}

generateRouter.post('/generate', requireWorkerToken, async (req, res) => {
  // STEP 1: request body parsing
  logger.info('STEP 1');
  let body: z.infer<typeof bodySchema>;
  try {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      logger.info('STEP 1 OK');
      return res.status(400).json({
        error: 'invalid_body',
        details: parsed.error.flatten().fieldErrors,
      });
    }
    body = parsed.data;
    logger.info('STEP 1 OK');
  } catch (e) {
    logger.error({ err: e }, 'STEP 1 FAILED');
    throw e;
  }

  logger.info({ eventId: body.eventId, mosaicId: body.mosaicId }, 'POST /generate received');

  // STEP 1.5: abort any older in-flight generation for this event so two
  // pipelines never run side by side (Stop generation + Regenerate).
  try {
    const stale = cancelEvent(body.eventId, body.mosaicId);
    const q = getQueue();
    stale.forEach((id) => q.cancel(id));
    if (stale.length > 0) {
      logger.info({ eventId: body.eventId, cancelled: stale }, 'generate:cancelled-previous-runs');
    }
  } catch (e) {
    logger.warn({ err: e }, 'generate:cancel-previous-failed');
  }

  // STEP 2: markProcessing
  logger.info('STEP 2');
  try {
    await createProgressService(body.mosaicId).markProcessing();
    logger.info('STEP 2 OK');
  } catch (e) {
    logger.error({ err: e }, 'STEP 2 FAILED');
    throw e;
  }
  logger.info({ eventId: body.eventId, mosaicId: body.mosaicId }, 'markProcessing completed');


  // STEP 3: getQueue
  logger.info('STEP 3');
  let queue: Queue;
  try {
    queue = getQueue();
    logger.info('STEP 3 OK');
  } catch (e) {
    logger.error({ err: e }, 'STEP 3 FAILED');
    throw e;
  }

  logger.info(
    { eventId: body.eventId, mosaicId: body.mosaicId, workerId: queue.workerId },
    'enqueue() called',
  );

  // STEP 4: queue.enqueue()
  logger.info('STEP 4');
  let jobId: string;
  let queued: number;
  let running: number;
  try {
    const result = await queue.enqueue('generate-mosaic', body);
    jobId = result.jobId;
    queued = result.queued;
    running = result.running;
    logger.info('STEP 4 OK');
  } catch (e) {
    logger.error({ err: e }, 'STEP 4 FAILED');
    throw e;
  }
  logger.info(
    { jobId, eventId: body.eventId, mosaicId: body.mosaicId, queued, running, workerId: queue.workerId },
    'enqueue() returned',
  );
  logger.info(
    { queued, running, workerId: queue.workerId },
    'queue length',
  );

  logger.info({ jobId, ...body, workerId: queue.workerId }, 'generate:accepted');

  // STEP 5: sending HTTP 202
  logger.info('STEP 5');
  try {
    const response = res.status(202).json({
      accepted: true,
      jobId,
      queued,
      running,
      workerId: queue.workerId,
    });
    logger.info('STEP 5 OK');
    return response;
  } catch (e) {
    logger.error({ err: e }, 'STEP 5 FAILED');
    throw e;
  }
});


const cancelSchema = z.object({
  eventId: z.string().uuid().optional(),
  mosaicId: z.string().uuid(),
});

/**
 * Hard-stop a generation. Drops queued jobs for the mosaic and flags the
 * in-flight pipeline, which aborts at its next checkpoint. Idempotent.
 */
generateRouter.post('/cancel', requireWorkerToken, async (req, res) => {
  const parsed = cancelSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'invalid_body',
      details: parsed.error.flatten().fieldErrors,
    });
  }
  const { mosaicId, eventId } = parsed.data;
  const queue = getQueue();
  const { dropped } = queue.cancel(mosaicId);
  if (eventId) {
    cancelEvent(eventId).forEach((id) => queue.cancel(id));
  }
  try {
    await createProgressService(mosaicId).markFailed('Cancelled by user');
  } catch (err) {
    logger.warn({ err, mosaicId }, 'cancel:mark-failed-write-failed');
  }
  logger.info({ mosaicId, eventId, dropped }, 'cancel:accepted');
  return res.status(200).json({ cancelled: true, mosaicId, dropped });
});
