/**
 * Photo Bank Loader.
 *
 * Reads every uploaded guest photo for an event, downloads the underlying
 * image bytes from Supabase Storage (or an external https URL), probes
 * dimensions with sharp, and returns a `SourcePhoto[]` ready to feed the
 * algorithm pipeline (palette → matcher → compositor).
 *
 * This module is intentionally narrow: it does not run any matching,
 * palette, or compositing logic. It is the bridge between the
 * `uploads` table and the algorithm contracts in `src/algorithms.ts`.
 *
 * Failure policy: a photo that cannot be downloaded or decoded is logged
 * and skipped. The loader only throws when zero valid photos remain.
 */

import sharp from 'sharp';
import { config } from '../config';
import { logger } from './logger';
import { getSupabase } from './supabase';
import type { SourcePhoto } from '../algorithms';

interface UploadRow {
  id: string;
  image_url: string | null;
}

const PAGE_SIZE = 500;

async function fetchUploadRows(eventId: string): Promise<UploadRow[]> {
  const sb = getSupabase();
  const all: UploadRow[] = [];
  let page = 0;
  while (true) {
    const { data, error } = await sb
      .from('uploads')
      .select('id,image_url')
      .eq('event_id', eventId)
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (error) throw new Error(`photo-bank: uploads query failed: ${error.message}`);
    const rows = (data ?? []) as UploadRow[];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    page++;
  }
  return all;
}

async function downloadOne(imageUrl: string): Promise<Buffer> {
  if (/^https?:\/\//i.test(imageUrl)) {
    const res = await fetch(imageUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  // Treat as a storage path inside the photos bucket.
  const sb = getSupabase();
  const { data, error } = await sb.storage
    .from(config.SUPABASE_PHOTOS_BUCKET)
    .download(imageUrl);
  if (error || !data) throw new Error(`storage: ${error?.message ?? 'no data'}`);
  return Buffer.from(await data.arrayBuffer());
}

/**
 * Load every guest photo for an event as decoded `SourcePhoto` records.
 * Throws only when zero photos could be loaded.
 *
 * Optional `onProgress(done, total)` fires after every photo finishes
 * (success or skip). It runs synchronously — keep the handler cheap;
 * throttling belongs in the caller.
 */
export async function loadEventPhotos(
  eventId: string,
  onProgress?: (done: number, total: number) => void,
  shouldAbort?: () => boolean,
): Promise<SourcePhoto[]> {
  const log = logger.child({ component: 'photo-bank', eventId });
  log.info('Photo loader started');
  const tStart = Date.now();

  const rows = await fetchUploadRows(eventId);
  const candidates = rows.filter((r): r is UploadRow & { image_url: string } =>
    Boolean(r.image_url),
  );
  const total = candidates.length;
  log.info({ total }, `Found ${total} uploaded photos`);

  if (total === 0) {
    throw new Error('photo-bank: no uploads found for event');
  }

  const photos: SourcePhoto[] = [];
  let skipped = 0;
  let done = 0;
  const concurrency = config.PHOTO_BANK_CONCURRENCY;
  const logEvery = config.PHOTO_BANK_LOG_EVERY;

  let cursor = 0;
  async function worker() {
    while (true) {
      if (shouldAbort?.()) return;
      const i = cursor++;
      if (i >= total) return;
      const row = candidates[i];
      if (!row) return;
      const idx = i + 1;
      try {
        const original = await downloadOne(row.image_url);
        // Pre-shrink to bound memory: tiles render at ~60px, 512px keeps headroom
        // for descriptor sampling and high-quality downscale. Single cache —
        // palette/matcher/compositor all consume this same buffer.
        const shrunk = await sharp(original, { failOn: 'none' })
          .rotate()
          .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 90, mozjpeg: true })
          .toBuffer({ resolveWithObject: true });
        const width = shrunk.info.width ?? 0;
        const height = shrunk.info.height ?? 0;
        if (!width || !height) throw new Error('unknown dimensions');
        photos.push({ id: row.id, imageUrl: row.image_url, buffer: shrunk.data, width, height });
      } catch (err) {
        skipped++;
        log.warn(
          { uploadId: row.id, url: row.image_url, err: (err as Error).message },
          `Photo ${idx}/${total} skipped`,
        );
      } finally {
        done++;
        try {
          onProgress?.(done, total);
        } catch {
          /* progress reporting must never break the loader */
        }
        if (done % logEvery === 0 || done === total) {
          log.info(
            { done, total, loaded: photos.length, skipped },
            `Downloading photo ${done}/${total}`,
          );
        }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, worker));

  const elapsedMs = Date.now() - tStart;
  log.info({ loaded: photos.length, skipped, total, elapsedMs }, 'Finished downloading photos');
  log.info({ count: photos.length, elapsedMs }, `timing:photo-bank-total (${photos.length} items)`);

  if (shouldAbort?.()) {
    throw new Error('photo-bank: cancelled');
  }

  if (photos.length === 0) {
    throw new Error(`photo-bank: 0 valid photos after ${total} attempts`);
  }

  return photos;
}
