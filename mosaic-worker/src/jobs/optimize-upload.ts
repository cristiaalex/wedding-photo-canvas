/**
 * Job E — "Optimized Original" for special RAW formats (DNG / Apple ProRAW).
 *
 * Why it exists: an iPhone Pro ProRAW frame is ~85 MB. Browsers cannot decode
 * DNG at all (no Safari/Chrome/Android support), so those uploads skip the
 * client pipeline entirely and land here as raw bytes:
 *
 *   {eventId}/{photoId}/source.dng     ← uploaded by the guest, temporary
 *
 * This job produces, from that single decode:
 *
 *   {eventId}/{photoId}/original.jpg   ← Optimized Original (native res, q94)
 *   {eventId}/{photoId}/display.webp   ← 3000px  q88   (same as client pipeline)
 *   {eventId}/{photoId}/thumb_600.webp ←  800px  q85
 *   {eventId}/{photoId}/thumb_300.webp ←  400px  q82
 *
 * Decoding strategy (cheapest first):
 *   1. exiftool -b -JpgFromRaw / -PreviewImage — Apple ProRAW embeds a
 *      full-resolution JPEG rendered by the phone's ISP. If its dimensions are
 *      >= 90% of the RAW dimensions we use it (sub-second, ~200 MB RSS).
 *   2. dcraw_emu (LibRaw) -w -T → 16-bit TIFF → sharp. Slower (~5-15 s for
 *      48 MP, ~1.5 GB peak between the TIFF on /tmp and sharp's pipeline) but
 *      always correct.
 *
 * Safety: the source RAW is deleted ONLY after the optimized original has been
 * re-downloaded, decoded, dimension-checked and the DB row updated. Any failure
 * anywhere keeps the RAW and marks the row 'failed' so it can be retried. The
 * whole job is idempotent — re-running it just overwrites the derivatives.
 */

import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import sharp from 'sharp';

import { config } from '../config';
import { logger } from '../lib/logger';
import { getSupabase } from '../lib/supabase';

const execFileAsync = promisify(execFile);

export type OptimizeUploadInput = {
  jobId: string;
  workerId: string;
  eventId: string;
  uploadId: string;
};

type UploadRow = {
  id: string;
  event_id: string;
  image_url: string | null;
  source_path: string | null;
  optimize_status: string | null;
  original_size_bytes: number | null;
};

/** Optimized-Original encoding strategy.
 *
 *  Goal: BEST practical quality/size ratio for wedding photographs at NATIVE
 *  resolution — an ~85 MB Apple ProRAW frame should land around 10-15 MB.
 *
 *  Why these settings:
 *   - mozjpeg: true      → trellis quantisation, optimised scans + Huffman
 *                          tables. Typically 20-35% smaller than libjpeg-turbo
 *                          at equal perceived quality. Already used elsewhere
 *                          in this worker, so no new dependency.
 *   - progressive        → implied by mozjpeg (optimiseScans), also smaller.
 *   - 4:2:0 chroma       → for continuous-tone photography this is visually
 *                          indistinguishable from 4:4:4 at 40+ MP (chroma
 *                          detail is far below the sensor's luma detail) while
 *                          removing ~25-30% of the bytes. 4:4:4 only matters
 *                          for synthetic graphics / hard colour edges, and was
 *                          the single biggest contributor to the old 40-60 MB
 *                          outputs together with q94.
 *   - quality ladder     → q90 first; if the file exceeds the target it is
 *                          re-encoded one step down, never below Q_FLOOR, so a
 *                          genuinely complex frame keeps its quality instead of
 *                          being crushed.
 *   - metadata           → EXIF/ICC kept (orientation is baked in by .rotate(),
 *                          capture date + camera survive); the DNG's multi-MB
 *                          embedded previews never reach the JPEG because we
 *                          re-encode pixels rather than copying containers.
 */
const QUALITY_LADDER: number[] = [90, 86, 83, 80, 78];
const TARGET_MAX_BYTES = 15 * 1024 * 1024;
/** Below this, try one step UP for extra quality (simple/low-detail frames). */
const TARGET_MIN_BYTES = 7 * 1024 * 1024;
const CHROMA = '4:2:0';

type EncodeResult = {
  buffer: Buffer;
  quality: number;
  attempts: { quality: number; bytes: number }[];
};

/** Encode at native resolution, walking the quality ladder toward the target. */
async function encodeOptimizedOriginal(source: sharp.Sharp): Promise<EncodeResult> {
  const encode = (quality: number) =>
    source
      .clone()
      .rotate() // bake EXIF orientation into pixels
      .jpeg({
        quality,
        chromaSubsampling: CHROMA,
        mozjpeg: true, // trellis + optimised scans/Huffman + progressive
        progressive: true,
        optimizeCoding: true,
        trellisQuantisation: true,
        overshootDeringing: true,
        optimizeScans: true,
      })
      .withMetadata()
      .toBuffer();

  const attempts: { quality: number; bytes: number }[] = [];
  let best: Buffer | null = null;
  let bestQuality: number = QUALITY_LADDER[0]!;

  for (let i = 0; i < QUALITY_LADDER.length; i += 1) {
    const quality = QUALITY_LADDER[i]!;
    const buf = await encode(quality);
    attempts.push({ quality, bytes: buf.byteLength });
    best = buf;
    bestQuality = quality;

    if (buf.byteLength <= TARGET_MAX_BYTES) {
      // Comfortably under target on the first try → spend a little of the
      // budget back on quality (q94, still 4:2:0 + mozjpeg).
      if (i === 0 && buf.byteLength < TARGET_MIN_BYTES) {
        const upQuality = 94;
        const up = await encode(upQuality);
        attempts.push({ quality: upQuality, bytes: up.byteLength });
        if (up.byteLength <= TARGET_MAX_BYTES) {
          best = up;
          bestQuality = upQuality;
        }
      }
      break;
    }

    // Too big. Each ladder step removes roughly 30% of the bytes at 40+ MP, so
    // skip steps that are predicted to still overshoot — a 48 MP re-encode
    // costs ~5 s and we do not want five of them.
    let predicted = buf.byteLength;
    while (i + 1 < QUALITY_LADDER.length - 1 && predicted * 0.7 > TARGET_MAX_BYTES) {
      predicted *= 0.7;
      i += 1;
    }
    // Floor reached → accept the last result rather than degrade further.
  }


  if (!best) throw new Error('optimize: encoding produced no output');
  return { buffer: best, quality: bestQuality, attempts };
}


async function downloadToFile(storagePath: string, localPath: string): Promise<number> {
  const sb = getSupabase();
  const { data, error } = await sb.storage.from(config.SUPABASE_PHOTOS_BUCKET).download(storagePath);
  if (error || !data) throw new Error(`optimize: source download failed: ${error?.message ?? 'no data'}`);
  const buf = Buffer.from(await data.arrayBuffer());
  await fs.promises.writeFile(localPath, buf);
  return buf.byteLength;
}

async function rawDimensions(rawPath: string): Promise<{ width: number; height: number } | null> {
  try {
    const { stdout } = await execFileAsync('exiftool', ['-s3', '-ImageWidth', '-ImageHeight', rawPath], {
      maxBuffer: 1024 * 1024,
    });
    const parts = stdout.trim().split(/\s+/).map((n) => Number.parseInt(n, 10));
    const w = parts[0] ?? 0;
    const h = parts[1] ?? 0;
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return { width: w, height: h };
  } catch {
    /* exiftool missing or unreadable tag → fall through to LibRaw */
  }
  return null;
}

/** Fast path: pull the embedded full-size JPEG rendered by the camera/phone. */
async function extractEmbeddedPreview(rawPath: string, outPath: string): Promise<Buffer | null> {
  for (const tag of ['-JpgFromRaw', '-PreviewImage', '-OtherImage']) {
    try {
      await execFileAsync('exiftool', ['-b', tag, '-w', '!%d%f.preview.jpg', rawPath], {
        maxBuffer: 1024 * 1024,
      });
      const written = rawPath.replace(/\.[^.]+$/, '') + '.preview.jpg';
      const stat = await fs.promises.stat(written).catch(() => null);
      if (stat && stat.size > 0) {
        const buf = await fs.promises.readFile(written);
        await fs.promises.rm(written, { force: true });
        await fs.promises.writeFile(outPath, buf);
        return buf;
      }
    } catch {
      /* try next tag */
    }
  }
  return null;
}

/** Correct path: full LibRaw demosaic to a 16-bit TIFF sharp can read. */
async function decodeWithLibRaw(rawPath: string): Promise<string> {
  // -w  camera white balance   -T  write TIFF   -q 3 AHD demosaic
  // -o 1 sRGB output           -6  16-bit
  await execFileAsync('dcraw_emu', ['-w', '-T', '-q', '3', '-o', '1', '-6', rawPath], {
    maxBuffer: 4 * 1024 * 1024,
    timeout: 10 * 60 * 1000,
  });
  const tiff = `${rawPath}.tiff`;
  const stat = await fs.promises.stat(tiff).catch(() => null);
  if (!stat || stat.size === 0) throw new Error('optimize: LibRaw produced no TIFF');
  return tiff;
}

async function uploadObject(storagePath: string, body: Buffer, contentType: string): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.storage.from(config.SUPABASE_PHOTOS_BUCKET).upload(storagePath, body, {
    contentType,
    upsert: true,
    cacheControl: '31536000, immutable',
  });
  if (error) throw new Error(`optimize: upload ${storagePath} failed: ${error.message}`);
}

export async function runOptimizeUpload(input: OptimizeUploadInput): Promise<void> {
  const sb = getSupabase();
  const log = logger.child({ component: 'optimize', uploadId: input.uploadId, eventId: input.eventId });

  const { data: found, error: findErr } = await sb
    .from('uploads')
    .select('id,event_id,image_url,source_path,optimize_status,original_size_bytes')
    .eq('id', input.uploadId)
    .eq('event_id', input.eventId)
    .maybeSingle();
  if (findErr) throw new Error(`optimize: lookup failed: ${findErr.message}`);
  const row = found as UploadRow | null;
  if (!row) throw new Error('optimize: upload row not found');
  if (row.optimize_status === 'ready') {
    log.info('optimize:already-ready');
    return;
  }
  if (!row.source_path) throw new Error('optimize: no source_path on row');

  // Claim (pending/failed/processing-after-crash all allowed; the work is
  // idempotent so a duplicate run only rewrites the same objects).
  await sb.from('uploads').update({ optimize_status: 'processing', optimize_error: null }).eq('id', row.id);

  const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `optimize-${row.id}-`));
  const rawPath = path.join(workDir, 'source.dng');
  let tiffPath: string | null = null;

  try {
    const sourceBytes = await downloadToFile(row.source_path, rawPath);
    log.info({ sourceBytes }, 'optimize:source-downloaded');

    // --- Decode -----------------------------------------------------------
    const dims = await rawDimensions(rawPath);
    let source: sharp.Sharp | null = null;

    const previewPath = path.join(workDir, 'preview.jpg');
    const preview = await extractEmbeddedPreview(rawPath, previewPath);
    if (preview) {
      const meta = await sharp(preview).metadata().catch(() => null);
      const pw = meta?.width ?? 0;
      const ph = meta?.height ?? 0;
      const fullEnough =
        !dims || (pw >= dims.width * 0.9 && ph >= dims.height * 0.9) || Math.max(pw, ph) >= 5000;
      if (pw > 0 && ph > 0 && fullEnough) {
        log.info({ pw, ph, raw: dims }, 'optimize:using-embedded-preview');
        source = sharp(previewPath, { failOn: 'none' });
      }
    }
    if (!source) {
      log.info({ raw: dims }, 'optimize:libraw-decode');
      tiffPath = await decodeWithLibRaw(rawPath);
      source = sharp(tiffPath, { failOn: 'none', limitInputPixels: false });
    }

    const meta = await source.metadata();
    if (!meta.width || !meta.height) throw new Error('optimize: decoded image has no dimensions');

    // --- Optimized Original: native resolution, size-targeted JPEG --------
    const encoded = await encodeOptimizedOriginal(source);
    const optimized = encoded.buffer;
    log.info(
      {
        quality: encoded.quality,
        chroma: CHROMA,
        encoder: 'sharp/libvips + mozjpeg',
        bytes: optimized.byteLength,
        width: meta.width,
        height: meta.height,
        megapixels: Math.round(((meta.width ?? 0) * (meta.height ?? 0)) / 1e5) / 10,
        attempts: encoded.attempts,
      },
      'optimize:encoded',
    );


    // --- Derivatives: identical geometry/quality to the client pipeline ---
    const mk = (maxEdge: number, quality: number) =>
      sharp(optimized, { failOn: 'none', limitInputPixels: false })
        .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
        .webp({ quality })
        .toBuffer();
    const [display, thumb600, thumb300] = await Promise.all([mk(3000, 88), mk(800, 85), mk(400, 82)]);

    const base = row.source_path.replace(/\/[^/]+$/, '');
    const originalPath = `${base}/original.jpg`;

    await uploadObject(originalPath, optimized, 'image/jpeg');
    await Promise.all([
      uploadObject(`${base}/display.webp`, display, 'image/webp'),
      uploadObject(`${base}/thumb_600.webp`, thumb600, 'image/webp'),
      uploadObject(`${base}/thumb_300.webp`, thumb300, 'image/webp'),
    ]);

    // --- Verify from Storage BEFORE deleting anything ---------------------
    const { data: verifyBlob, error: verifyErr } = await sb.storage
      .from(config.SUPABASE_PHOTOS_BUCKET)
      .download(originalPath);
    if (verifyErr || !verifyBlob) throw new Error(`optimize: verification download failed: ${verifyErr?.message}`);
    const verifyBuf = Buffer.from(await verifyBlob.arrayBuffer());
    if (verifyBuf.byteLength === 0) throw new Error('optimize: verification found empty file');
    const verifyMeta = await sharp(verifyBuf, { limitInputPixels: false }).metadata();
    if (!verifyMeta.width || !verifyMeta.height) throw new Error('optimize: verification found invalid image');
    if (verifyMeta.format !== 'jpeg') throw new Error(`optimize: verification found ${verifyMeta.format}, expected jpeg`);
    // Native resolution must survive (orientation may swap the axes).
    const srcLong = Math.max(meta.width, meta.height);
    const srcShort = Math.min(meta.width, meta.height);
    const outLong = Math.max(verifyMeta.width, verifyMeta.height);
    const outShort = Math.min(verifyMeta.width, verifyMeta.height);
    if (outLong < srcLong * 0.99 || outShort < srcShort * 0.99) {
      throw new Error(`optimize: resolution loss ${outLong}x${outShort} vs source ${srcLong}x${srcShort}`);
    }


    // --- Commit DB state ---------------------------------------------------
    const { error: updErr } = await sb
      .from('uploads')
      .update({
        image_url: originalPath,
        optimize_status: 'ready',
        optimize_error: null,
        optimized_size_bytes: verifyBuf.byteLength,
        original_size_bytes: row.original_size_bytes ?? sourceBytes,
        optimized_at: new Date().toISOString(),
      })
      .eq('id', row.id)
      .eq('event_id', row.event_id);
    if (updErr) throw new Error(`optimize: db update failed: ${updErr.message}`);

    // --- Only now: drop the huge source RAW -------------------------------
    const { error: rmErr } = await sb.storage
      .from(config.SUPABASE_PHOTOS_BUCKET)
      .remove([row.source_path]);
    if (rmErr) {
      // Non-fatal: the customer's photo is safe either way, we just kept bytes.
      log.warn({ err: rmErr.message }, 'optimize:source-delete-failed');
    } else {
      await sb.from('uploads').update({ source_path: null }).eq('id', row.id);
    }

    log.info(
      {
        sourceBytes,
        optimizedBytes: verifyBuf.byteLength,
        width: verifyMeta.width,
        height: verifyMeta.height,
        saved: sourceBytes - verifyBuf.byteLength,
      },
      'optimize:complete',
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err }, 'optimize:failed');
    await sb
      .from('uploads')
      .update({ optimize_status: 'failed', optimize_error: message.slice(0, 500) })
      .eq('id', row.id);
    throw err;
  } finally {
    if (tiffPath) await fs.promises.rm(tiffPath, { force: true }).catch(() => undefined);
    await fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
