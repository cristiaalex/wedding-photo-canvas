import 'dotenv/config';
import { z } from 'zod';

/**
 * Centralised, validated configuration. Fail fast on boot if something is
 * missing — Railway will mark the deploy as crashed instead of silently
 * running with broken env.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),

  WORKER_API_TOKEN: z.string().min(16, 'WORKER_API_TOKEN must be at least 16 chars'),

  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  SUPABASE_STORAGE_BUCKET: z.string().default('mosaics'),
  SUPABASE_PHOTOS_BUCKET: z.string().default('photos'),
  PHOTO_BANK_CONCURRENCY: z.coerce.number().int().positive().default(8),
  PHOTO_BANK_LOG_EVERY: z.coerce.number().int().positive().default(50),


  MAX_CONCURRENT_JOBS: z.coerce.number().int().positive().default(2),
  // Temporary bump (15min → 25min) while benchmarking the optimized pipeline.
  // Revert once the v3 matcher + memoization runs comfortably under 900s.
  JOB_TIMEOUT_MS: z.coerce.number().int().positive().default(25 * 60 * 1000),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('[config] Invalid environment:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;
