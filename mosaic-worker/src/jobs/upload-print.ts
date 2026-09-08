import sharp from 'sharp';
import { jobLogger } from '../lib/logger';
import { updateMosaic, maybePromoteReady } from '../lib/progress';
import { uploadVariantResumable } from '../lib/storage';
import { readMaster, releaseMaster } from '../lib/master-file';
import { throwIfCancelled } from '../lib/cancellation';


/**
 * Job C — Upload Print (SINGLE-MASTER pipeline).
 *
 * Reads the lossless PNG master that Job A wrote to /tmp, encodes it
 * ONCE as a high-quality JPEG (q92, 4:4:4 chroma), and uploads it as
 * the print variant. No matcher, no palette, no compositor — pure
 * PNG→JPEG re-encode + upload.
 *
 * On success writes `print_url` + `print_status = 'ready'`.
 * On failure writes `print_status = 'failed'` (leaves print_url untouched).
 */

export interface UploadPrintInput {
  jobId: string;
  workerId: string;
  eventId: string;
  mosaicId: string;
  /** Local /tmp path to the lossless PNG master produced by Job A. */
  masterPath: string;
}

export async function runUploadPrint(input: UploadPrintInput): Promise<void> {
  const { jobId, eventId, mosaicId, masterPath } = input;
  const log = jobLogger(jobId, eventId);
  log.info({ eventId, mosaicId, masterPath }, 'JOB C (upload-print) START');
  const tStart = Date.now();

  try {
    throwIfCancelled(mosaicId);
    await writePrintStatus(mosaicId, 'processing');

    // Read the lossless master and encode the print JPEG from it.
    const pngBuf = await readMaster(masterPath);
    log.info({ bytes: pngBuf.length }, 'master.png loaded; encoding print JPEG');

    const tEncode = Date.now();
    const printBuf = await sharp(pngBuf, { failOn: 'none', limitInputPixels: false })
      .jpeg({ quality: 92, mozjpeg: true, chromaSubsampling: '4:4:4' })
      .toBuffer();
    log.info(
      { elapsedMs: Date.now() - tEncode, bytes: printBuf.length },
      'timing:jpeg-encode-print',
    );

    throwIfCancelled(mosaicId);
    const uploaded = await uploadVariantResumable({
      eventId,
      mosaicId,
      variant: 'print',
      body: printBuf,
    });

    await updateMosaic(mosaicId, {
      print_url: uploaded.publicUrl ?? uploaded.path,
    });
    await writePrintStatus(mosaicId, 'ready');
    // Nudge the main progress bar into the "finishing" band. The client's
    // monotonic guard ignores this if DZI is still finishing (still < 92);
    // once DZI completes to 92, this 97 write becomes visible on the next
    // realtime event or poll tick.
    await updateMosaic(mosaicId, { progress: 97 } as never).catch(() => undefined);
    log.info(
      {
        mosaicId,
        printUrl: uploaded.publicUrl ?? uploaded.path,
        bytes: uploaded.bytes,
        uploadMs: uploaded.durationMs,
      },
      'print_status updated to ready',
    );
    await maybePromoteReady(mosaicId);
    const totalMs = Date.now() - tStart;
    log.info({ mosaicId, elapsedMs: totalMs }, 'JOB C (upload-print) COMPLETE');
    log.info(
      {
        mosaicId,
        printEncodeMs: null,
        printUploadMs: uploaded.durationMs,
        printBytes: uploaded.bytes,
        totalJobC: totalMs,
      },
      'PIPELINE SUMMARY (Job C - Print)',
    );

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ eventId, mosaicId, message }, 'JOB C (upload-print) FAILED');
    await writePrintStatus(mosaicId, 'failed').catch(() => undefined);
    // Even on failure, the other downstream job may already be done —
    // promote the mosaic to READY so the user isn't stuck at 'finalizing'.
    await maybePromoteReady(mosaicId).catch(() => undefined);
    throw error;
  } finally {
    await releaseMaster(masterPath);
  }
}

async function writePrintStatus(
  mosaicId: string,
  status: 'processing' | 'ready' | 'failed',
) {
  await updateMosaic(mosaicId, { print_status: status } as never);
}
