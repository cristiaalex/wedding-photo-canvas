/**
 * Job D — Download Archive (incremental ZIP of ORIGINAL uploads).
 *
 * Reads the membership rows of ONE `download_batches` row and streams the
 * original uploaded bytes of exactly those uploads into a single ZIP, which
 * is stored in the private `mosaics` bucket under
 *   download-archives/{eventId}/batch-{n}.zip
 *
 * Guarantees:
 *  - originals only (no display/thumb variant, no re-encode, no resize)
 *  - previous batches are never re-read or re-zipped
 *  - claim is conditional (pending|failed → processing) so a restart or a
 *    duplicate enqueue cannot double-run or falsely mark a batch completed
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import archiver from 'archiver';
import * as tus from 'tus-js-client';
import { config } from '../config';
import { logger } from '../lib/logger';
import { getSupabase } from '../lib/supabase';

export interface GenerateArchiveInput {
  jobId: string;
  workerId: string;
  eventId: string;
  batchId: string;
}

interface BatchRow {
  id: string;
  event_id: string;
  batch_number: number;
  photo_count: number;
  status: string;
}

const DOWNLOAD_CONCURRENCY = 8;

export function archivePathFor(eventId: string, batchNumber: number): string {
  return `download-archives/${eventId}/batch-${batchNumber}.zip`;
}

function extensionOf(storagePath: string): string {
  const base = storagePath.split('?')[0]!.split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot + 1) : '';
  return /^[a-z0-9]{1,5}$/i.test(ext) ? ext.toLowerCase() : 'jpg';
}

async function downloadOriginal(imageUrl: string): Promise<Buffer> {
  if (/^https?:\/\//i.test(imageUrl)) {
    const res = await fetch(imageUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  const sb = getSupabase();
  const { data, error } = await sb.storage
    .from(config.SUPABASE_PHOTOS_BUCKET)
    .download(imageUrl);
  if (error || !data) throw new Error(`storage: ${error?.message ?? 'no data'}`);
  return Buffer.from(await data.arrayBuffer());
}

async function loadBatchUploads(batchId: string): Promise<Array<{ id: string; image_url: string }>> {
  const sb = getSupabase();
  const ids: string[] = [];
  const PAGE = 1000;
  for (let page = 0; ; page++) {
    const { data, error } = await sb
      .from('download_batch_items')
      .select('upload_id')
      .eq('batch_id', batchId)
      .range(page * PAGE, (page + 1) * PAGE - 1);
    if (error) throw new Error(`archive: batch items query failed: ${error.message}`);
    const rows = (data ?? []) as Array<{ upload_id: string }>;
    ids.push(...rows.map((r) => r.upload_id));
    if (rows.length < PAGE) break;
  }

  const out: Array<{ id: string; image_url: string }> = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { data, error } = await sb
      .from('uploads')
      .select('id,image_url,uploaded_at')
      .in('id', chunk);
    if (error) throw new Error(`archive: uploads query failed: ${error.message}`);
    for (const row of (data ?? []) as Array<{ id: string; image_url: string | null }>) {
      if (row.image_url) out.push({ id: row.id, image_url: row.image_url });
    }
  }
  return out;
}

async function uploadZip(localPath: string, objectPath: string, bytes: number): Promise<void> {
  const endpoint = `${config.SUPABASE_URL.replace(/\/$/, '')}/storage/v1/upload/resumable`;
  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(fs.createReadStream(localPath) as unknown as Buffer, {
      endpoint,
      uploadSize: bytes,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      headers: {
        Authorization: `Bearer ${config.SUPABASE_SERVICE_ROLE_KEY}`,
        'x-upsert': 'true',
      },
      metadata: {
        bucketName: config.SUPABASE_STORAGE_BUCKET,
        objectName: objectPath,
        contentType: 'application/zip',
        cacheControl: '3600',
      },
      chunkSize: 6 * 1024 * 1024,
      onError: (err) => reject(new Error(`TUS zip upload failed: ${err.message}`)),
      onSuccess: () => resolve(),
    });
    upload.start();
  });
}

export async function runGenerateArchive(input: GenerateArchiveInput): Promise<void> {
  const sb = getSupabase();
  const log = logger.child({ component: 'archive', batchId: input.batchId, eventId: input.eventId });

  // --- Claim: only a pending/failed batch may start. Idempotent by design.
  const { data: claimed, error: claimErr } = await sb
    .from('download_batches')
    .update({
      status: 'processing',
      worker_id: input.workerId,
      started_at: new Date().toISOString(),
      error: null,
    })
    .eq('id', input.batchId)
    .in('status', ['pending', 'failed'])
    .select('id,event_id,batch_number,photo_count,status')
    .maybeSingle();
  if (claimErr) throw new Error(`archive: claim failed: ${claimErr.message}`);
  if (!claimed) {
    log.info('archive:claim-skipped (not pending/failed)');
    return;
  }
  const batch = claimed as BatchRow;

  const objectPath = archivePathFor(batch.event_id, batch.batch_number);
  const localPath = path.join(os.tmpdir(), `archive-${batch.id}.zip`);

  try {
    const uploads = await loadBatchUploads(batch.id);
    log.info({ photos: uploads.length }, 'archive:start');
    if (uploads.length === 0) throw new Error('archive: batch has no uploads');

    const out = fs.createWriteStream(localPath);
    // level 0 (store): originals are already compressed — zipping them again
    // burns CPU for ~0% gain and would alter nothing in the bytes we ship.
    const zip = archiver('zip', { zlib: { level: 0 }, store: true });
    const closed = new Promise<void>((resolve, reject) => {
      out.on('close', () => resolve());
      out.on('error', reject);
      zip.on('error', reject);
    });
    zip.pipe(out);

    let skipped = 0;
    const pad = String(uploads.length).length;

    // Bounded prefetch: at most DOWNLOAD_CONCURRENCY photos in memory at a
    // time. Entries are appended in order and we wait for each one to be
    // consumed by the zip stream before pulling the next photo in.
    const pending = new Map<number, Promise<Buffer | null>>();
    const start = (i: number) => {
      if (i >= uploads.length) return;
      const item = uploads[i]!;
      pending.set(
        i,
        downloadOriginal(item.image_url).catch((err) => {
          skipped++;
          log.warn({ uploadId: item.id, err: (err as Error).message }, 'archive:photo-skipped');
          return null;
        }),
      );
    };
    for (let i = 0; i < Math.min(DOWNLOAD_CONCURRENCY, uploads.length); i++) start(i);

    for (let i = 0; i < uploads.length; i++) {
      const buf = await pending.get(i)!;
      pending.delete(i);
      start(i + DOWNLOAD_CONCURRENCY);
      if (buf) {
        const name = `${String(i + 1).padStart(pad, '0')}.${extensionOf(uploads[i]!.image_url)}`;
        const entryDone = new Promise<void>((resolve) => zip.once('entry', () => resolve()));
        zip.append(buf, { name });
        await entryDone;
      }
      if ((i + 1) % 100 === 0) log.info({ done: i + 1, total: uploads.length }, 'archive:progress');
    }
    await zip.finalize();
    await closed;

    const bytes = fs.statSync(localPath).size;
    log.info({ bytes, skipped }, 'archive:zip-built');
    await uploadZip(localPath, objectPath, bytes);

    await sb
      .from('download_batches')
      .update({
        status: 'completed',
        storage_path: objectPath,
        size_bytes: bytes,
        completed_at: new Date().toISOString(),
        error: null,
      })
      .eq('id', batch.id);
    log.info({ objectPath, bytes }, 'archive:completed');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await sb
      .from('download_batches')
      .update({ status: 'failed', error: message })
      .eq('id', batch.id);
    log.error({ err: message }, 'archive:failed');
    throw err;
  } finally {
    try {
      fs.rmSync(localPath, { force: true });
    } catch {
      /* noop */
    }
  }
}
