import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { logger } from './logger';

/**
 * Local /tmp handoff for the ONE and ONLY master artifact — a lossless
 * PNG of the compositor canvas.
 *
 * Pipeline (single-master, July 2026):
 *   Job A renders the ~24k canvas once, encodes it as a lossless PNG
 *   (`master.png`) and writes it to `masterPathFor(mosaicId)`. Both
 *   downstream jobs consume that same file:
 *     - Job B (Deep Zoom) → feeds the PNG into Sharp's tile pyramid
 *       (no JPEG round-trip on the interactive viewer).
 *     - Job C (Print)     → encodes a high-quality JPEG from the PNG
 *       and uploads it as `print.jpg`.
 *
 * The preview.webp and thumb.jpg are derived from the same canvas in
 * Job A and uploaded directly — they never hit /tmp.
 *
 * A refcount ensures the file is deleted only after the LAST consumer
 * is done. Callers `retainMaster(path, N)` before enqueueing N
 * consumers, and each consumer calls `releaseMaster(path)` in a finally.
 */

const refs = new Map<string, number>();

/** Local /tmp path of the lossless PNG master (single source of truth). */
export function masterPathFor(mosaicId: string): string {
  return path.join(os.tmpdir(), `mosaic-master-${mosaicId}.png`);
}

export function retainMaster(p: string, n = 1): void {
  refs.set(p, (refs.get(p) ?? 0) + n);
}

export async function releaseMaster(p: string): Promise<void> {
  const next = (refs.get(p) ?? 0) - 1;
  if (next <= 0) {
    refs.delete(p);
    try {
      await fs.rm(p, { force: true });
      logger.info({ path: p }, 'master:cleanup');
    } catch (err) {
      logger.warn({ path: p, err: (err as Error).message }, 'master:cleanup-failed');
    }
  } else {
    refs.set(p, next);
  }
}

export async function readMaster(p: string): Promise<Buffer> {
  return fs.readFile(p);
}

export async function writeMaster(p: string, body: Buffer): Promise<void> {
  await fs.writeFile(p, body);
}
