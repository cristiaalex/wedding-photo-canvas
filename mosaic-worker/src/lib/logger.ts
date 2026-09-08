import pino from 'pino';
import { config } from '../config';

export const logger = pino({
  level: config.LOG_LEVEL,
  base: { service: 'mosaic-worker' },
  timestamp: pino.stdTimeFunctions.isoTime,
  // Railway captures stdout/stderr — plain JSON is the right format there.
  formatters: {
    level(label) {
      return { level: label };
    },
  },
});

export type Logger = typeof logger;

/** Convenience: child logger scoped to a single job. */
export function jobLogger(jobId: string, eventId: string) {
  return logger.child({ jobId, eventId });
}
