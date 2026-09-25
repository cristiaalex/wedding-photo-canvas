import sharp from 'sharp';
import { jobLogger } from '../lib/logger';
import { updateMosaic, maybePromoteReady } from '../lib/progress';
import { readMaster, releaseMaster } from '../lib/master-file';
import { uploadVariant } from '../lib/storage';
import { throwIfCancelled, registerActive, unregisterActive, watchCancellation } from '../lib/cancellation';

/**
 * Job B — Web Zoom image (replaces the DZI tile pyramid).
 *
 * Reads the SAME master written by Job A, produces ONE aspect-preserving
 * WebP (long edge 8000 px, q88) and uploads exactly one object to the
 * private mosaics bucket. The object path is stored in `image_url`
 * (with `dzi_status = 'ready'` as the existing "viewer asset ready" flag).
 *
 * This is a viewing asset only — it never touches print columns, and a
 * failure here never counts as a successful print.
 */

export const WEB_ZOOM_LONG_EDGE = 8000;
export const WEB_ZOOM_QUALITY = 88;

export interface GenerateWebZoomInput {
  jobId: string;
  workerId: string;
  eventId: string;
  mosaicId: string;
  masterPath: string;
}

export async function runGenerateWebZoom(input: GenerateWebZoomInput): Promise<void> {
  const { jobId, eventId, mosaicId, masterPath } = input;
  const log = jobLogger(jobId, eventId);
  const t0 = Date.now();
  registerActive(mosaicId, eventId);
  const stopCancelWatch = watchCancellation(mosaicId);

  try {
    throwIfCancelled(mosaicId);
    await updateMosaic(mosaicId, { dzi_status: 'processing', deepzoom_progress: 0 } as never);

    const masterBuf = await readMaster(masterPath);
    throwIfCancelled(mosaicId);

    const webBuf = await sharp(masterBuf, { failOn: 'none', limitInputPixels: false })
      .resize({
        width: WEB_ZOOM_LONG_EDGE,
        height: WEB_ZOOM_LONG_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: WEB_ZOOM_QUALITY, effort: 4, smartSubsample: true })
      .toBuffer();

    const meta = await sharp(webBuf).metadata();
    log.info(
      { width: meta.width, height: meta.height, bytes: webBuf.length, quality: WEB_ZOOM_QUALITY },
      'WEB ZOOM DIMENSIONS',
    );

    throwIfCancelled(mosaicId);
    const { path } = await uploadVariant({ eventId, mosaicId, variant: 'webzoom', body: webBuf });

    await updateMosaic(mosaicId, {
      image_url: path,
      dzi_url: null,
      tile_base_url: null,
      dzi_status: 'ready',
      deepzoom_ready: true,
      deepzoom_progress: 100,
    } as never);

    await maybePromoteReady(mosaicId);
    log.info({ mosaicId, elapsedMs: Date.now() - t0, path }, 'job-b:web-zoom:done');
  } catch (err) {
    await updateMosaic(mosaicId, { dzi_status: 'failed' } as never).catch(() => undefined);
    await maybePromoteReady(mosaicId).catch(() => undefined);
    throw err;
  } finally {
    stopCancelWatch();
    unregisterActive(mosaicId);
    await releaseMaster(masterPath);
  }
}
