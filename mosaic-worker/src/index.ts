// Match libuv's thread pool (used by Sharp's native worker) to our
// in-process concurrency: 8 photo-bank workers can each spin up a Sharp
// pipeline without queueing behind the default pool size of 4. Must be
// set before the first libuv async task — i.e. before Sharp is loaded.
process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE ?? '8';

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import pinoHttp from 'pino-http';

import { config } from './config';
import { logger } from './lib/logger';
import { healthRouter } from './routes/health';
import { generateRouter } from './routes/generate';
import { archiveRouter } from './routes/archive';
import { optimizeRouter } from './routes/optimize';
// Note: Job C ("upload-print") is now auto-chained after Job A; there is
// no separate HTTP endpoint to trigger it.
import { getQueue } from './worker';

const app = express();

app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: true })); // tighten via env later if needed
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/health' } }));

app.use(healthRouter);
app.use(generateRouter);
app.use(archiveRouter);
app.use(optimizeRouter);

// 404
app.use((_req, res) => res.status(404).json({ error: 'not_found' }));

// Error handler
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _next: express.NextFunction,
  ) => {
    logger.error({ err }, 'unhandled_error');
    res.status(500).json({ error: 'internal_error' });
  },
);

const server = app.listen(config.PORT, () => {
  const q = getQueue();
  logger.info(
    {
      port: config.PORT,
      env: config.NODE_ENV,
      maxConcurrent: config.MAX_CONCURRENT_JOBS,
      workerId: q.workerId,
      queueDriver: q.driver,
    },
    'mosaic-worker listening',
  );
});

// --- Graceful shutdown -----------------------------------------------------
// Railway sends SIGTERM on deploy. We stop accepting new HTTP connections,
// then let the queue drain in-flight jobs (bounded by JOB_TIMEOUT_MS) so
// we don't strand a mosaic mid-build during a deploy.
async function shutdown(signal: string) {
  logger.info({ signal }, 'shutdown:start');
  server.close((err) => {
    if (err) logger.error({ err }, 'shutdown:server-close-failed');
  });
  try {
    await getQueue().drainAndStop(20_000);
  } catch (err) {
    logger.error({ err }, 'shutdown:queue-drain-failed');
  }
  logger.info('shutdown:complete');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'unhandledRejection');
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaughtException');
  process.exit(1);
});
