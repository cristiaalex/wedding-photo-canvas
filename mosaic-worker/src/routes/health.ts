import { Router } from 'express';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getSupabase } from '../lib/supabase';
import { getQueue } from '../worker';

const execFileAsync = promisify(execFile);

/** RAW-processing binaries must exist at runtime, not just at build time. */
async function hasBinary(cmd: string, args: string[]): Promise<boolean> {
  try {
    await execFileAsync(cmd, args, { timeout: 3000 });
    return true;
  } catch (err) {
    // A non-zero exit still proves the binary exists; ENOENT does not.
    return (err as NodeJS.ErrnoException)?.code !== 'ENOENT';
  }
}

export const healthRouter = Router();

/**
 * Liveness + light dependency check.
 *
 * Railway uses this as the deploy healthcheck — keep it fast (<1s) and
 * non-destructive. We deliberately do NOT mark the worker unhealthy when
 * Supabase is briefly unreachable, because that would cause Railway to
 * loop-restart the container during an upstream incident.
 */
healthRouter.get('/health', async (_req, res) => {
  const stats = getQueue().stats();
  let supabase: 'ok' | 'degraded' = 'ok';
  try {
    const sb = getSupabase();
    const { error } = await sb.auth.getUser();
    if (error && error.status && error.status >= 500) supabase = 'degraded';
  } catch {
    supabase = 'degraded';
  }

  const [exiftool, dcrawEmu] = await Promise.all([
    hasBinary('exiftool', ['-ver']),
    hasBinary('dcraw_emu', ['-v']),
  ]);

  res.status(200).json({
    status: 'ok',
    service: 'mosaic-worker',
    uptimeSeconds: Math.round(process.uptime()),
    worker: stats,
    deps: { supabase, exiftool, dcrawEmu },
    timestamp: new Date().toISOString(),
  });
});
