// tus-js-client accepts Buffer directly in Node.
import * as tus from 'tus-js-client';
import { config } from '../config';
import { logger } from './logger';
import { getSupabase } from './supabase';

/**
 * Thin wrapper around Supabase Storage for the `mosaics` bucket.
 *
 * Why a module: future variants (preview / thumb / print / DZI tiles) all
 * route through here so the job code never touches bucket names directly.
 */

export type MosaicVariant = 'full' | 'preview' | 'thumb' | 'print' | 'dzi';

const EXT: Record<MosaicVariant, { ext: string; contentType: string }> = {
  full: { ext: 'jpg', contentType: 'image/jpeg' },
  // High-quality WebP preview (~2400px, quality 90) — drives dashboard
  // cards, loading states and history strip. Distinct from the tiny
  // thumb (used only as a fallback for very old rows).
  preview: { ext: 'webp', contentType: 'image/webp' },
  thumb: { ext: 'jpg', contentType: 'image/jpeg' },
  print: { ext: 'jpg', contentType: 'image/jpeg' },
  // Deep Zoom manifests are XML; tiles are JPEG (uploaded individually later).
  dzi: { ext: 'dzi', contentType: 'application/xml' },
};


export function pathFor(eventId: string, mosaicId: string, variant: MosaicVariant) {
  const { ext } = EXT[variant];
  return `${eventId}/${mosaicId}/${variant}.${ext}`;
}

export async function downloadToBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Download failed (${res.status}) for ${url}`);
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

export async function uploadVariant(opts: {
  eventId: string;
  mosaicId: string;
  variant: MosaicVariant;
  body: Buffer;
}): Promise<{ path: string; publicUrl: string | null; durationMs: number }> {
  const sb = getSupabase();
  const path = pathFor(opts.eventId, opts.mosaicId, opts.variant);
  const { contentType } = EXT[opts.variant];

  const t0 = Date.now();
  const { error } = await sb.storage
    .from(config.SUPABASE_STORAGE_BUCKET)
    .upload(path, opts.body, {
      contentType,
      upsert: true,
      cacheControl: '31536000, immutable',
    });
  if (error) throw new Error(`Storage upload (${opts.variant}) failed: ${error.message}`);
  const durationMs = Date.now() - t0;

  const { data } = sb.storage.from(config.SUPABASE_STORAGE_BUCKET).getPublicUrl(path);
  const publicUrl = data?.publicUrl ?? null;

  logger.info(
    { type: opts.variant, path, bytes: opts.body.length, durationMs, publicUrl },
    'storage-upload',
  );

  // Fire-and-log HEAD probe — verifies the object is actually served
  // with the size + content-type we uploaded. Never throws.
  if (publicUrl) {
    try {
      const head = await fetch(publicUrl, { method: 'HEAD' });
      logger.info(
        {
          type: opts.variant,
          path,
          status: head.status,
          contentLength: head.headers.get('content-length'),
          contentType: head.headers.get('content-type'),
          etag: head.headers.get('etag'),
        },
        'storage-head',
      );
    } catch (err) {
      logger.warn(
        { type: opts.variant, path, err: (err as Error).message },
        'storage-head:failed',
      );
    }
  }

  return { path, publicUrl, durationMs };
}

export async function createSignedUrl(path: string, expiresInSeconds = 3600) {
  const sb = getSupabase();
  const { data, error } = await sb.storage
    .from(config.SUPABASE_STORAGE_BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error) throw new Error(`Sign url failed: ${error.message}`);
  return data.signedUrl;
}

/**
 * Resumable (TUS) upload — used ONLY for the print variant because that
 * file can exceed the standard Storage upload cap (~50 MB). All other
 * variants (full, preview, thumb, dzi, tiles) continue to use the
 * non-resumable `.upload()` path unchanged.
 */
export async function uploadVariantResumable(opts: {
  eventId: string;
  mosaicId: string;
  variant: MosaicVariant;
  body: Buffer;
}): Promise<{ path: string; publicUrl: string | null; bytes: number; durationMs: number }> {
  const sb = getSupabase();
  const path = pathFor(opts.eventId, opts.mosaicId, opts.variant);
  const { contentType } = EXT[opts.variant];
  const bucket = config.SUPABASE_STORAGE_BUCKET;
  const endpoint = `${config.SUPABASE_URL.replace(/\/$/, '')}/storage/v1/upload/resumable`;

  logger.info(
    { variant: opts.variant, path, bytes: opts.body.length, endpoint },
    'print upload started',
  );
  const t0 = Date.now();

  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(opts.body as unknown as Buffer, {
      endpoint,
      uploadSize: opts.body.length,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      headers: {
        Authorization: `Bearer ${config.SUPABASE_SERVICE_ROLE_KEY}`,
        'x-upsert': 'true',
      },
      metadata: {
        bucketName: bucket,
        objectName: path,
        contentType,
        cacheControl: '31536000, immutable',
      },
      chunkSize: 6 * 1024 * 1024, // Supabase requires fixed 6MB chunks
      onError: (err) => reject(new Error(`TUS upload failed: ${err.message}`)),
      onSuccess: () => resolve(),
    });
    upload.start();
  });

  const durationMs = Date.now() - t0;
  const { data } = sb.storage.from(bucket).getPublicUrl(path);
  const publicUrl = data?.publicUrl ?? null;
  logger.info(
    { type: opts.variant, path, bytes: opts.body.length, durationMs, publicUrl },
    'storage-upload',
  );
  if (publicUrl) {
    try {
      const head = await fetch(publicUrl, { method: 'HEAD' });
      logger.info(
        {
          type: opts.variant,
          path,
          status: head.status,
          contentLength: head.headers.get('content-length'),
          contentType: head.headers.get('content-type'),
          etag: head.headers.get('etag'),
        },
        'storage-head',
      );
    } catch (err) {
      logger.warn(
        { type: opts.variant, path, err: (err as Error).message },
        'storage-head:failed',
      );
    }
  }
  return { path, publicUrl, bytes: opts.body.length, durationMs };
}
