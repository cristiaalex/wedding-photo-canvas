import { jobLogger } from '../lib/logger';
import { createJobEventBus } from '../lib/events';
import { createProgressService, updateMosaic } from '../lib/progress';
import { startCreep } from '../lib/progress-creep';

import { downloadToBuffer, uploadVariant } from '../lib/storage';
import { STAGE } from '../lib/stages';
import { CHECKPOINT } from '../lib/checkpoints';
import { getSuite, BENCHMARK_CELL_PX } from '../algorithms/registry';
import { loadEventPhotos } from '../lib/photo-bank';
import { masterPathFor, retainMaster, writeMaster } from '../lib/master-file';
import {
  clearCancel,
  isCancelled,
  registerActive,
  throwIfCancelled,
  unregisterActive,
  watchCancellation,
} from '../lib/cancellation';

// Cell size of the master render. During the temporary benchmark this is the
// 150 px override from the registry; in production it is the original 120.
const RENDER_CELL_PX = BENCHMARK_CELL_PX ?? 120;



/**
 * Job A — Build Mosaic (SINGLE-MASTER pipeline).
 *
 * Renders the ~24k canvas ONCE (renderCellPx=120) and derives every
 * artifact from that single canvas:
 *
 *   compositor
 *       └── master.png       (lossless, → /tmp, consumed by Jobs B + C)
 *       └── preview.webp     (~3000px, q90 — uploaded here as preview_url)
 *       └── thumb.jpg        (~480px  — uploaded here as thumb_url, fallback only)
 *
 * Job B (Deep Zoom) reads master.png from /tmp and builds the tile
 * pyramid directly from unencoded pixels — no JPEG-in / JPEG-out.
 * Job C (Print) reads the same master.png and encodes the print JPEG
 * from it. There is only ever ONE master on disk per generation.
 */

export interface GenerateMosaicInput {
  jobId: string;
  workerId: string;
  eventId: string;
  mosaicId: string;
  coverImageUrl: string;
  suite?: string;
}

export interface GenerateMosaicResult {
  /** Local /tmp path of the lossless PNG master (consumed by Jobs B + C). */
  masterPath: string;
}


export async function runGenerateMosaic(
  input: GenerateMosaicInput,
): Promise<GenerateMosaicResult> {
  const { jobId, workerId, eventId, mosaicId, coverImageUrl } = input;
  const log = jobLogger(jobId, eventId);
  const bus = createJobEventBus();
  const progress = createProgressService(mosaicId);
  const detach = progress.attach(bus);

  log.info({ eventId, mosaicId }, 'JOB A START');
  clearCancel(mosaicId);
  registerActive(mosaicId, eventId);
  const stopCancelWatch = watchCancellation(mosaicId);
  const tJobStart = Date.now();
  const stageTimings: Record<string, number> = {};
  const mark = (label: string, t0: number) => {
    const ms = Date.now() - t0;
    stageTimings[label] = ms;
    log.info({ stage: label, elapsedMs: ms }, `timing:${label}`);
    return ms;
  };

  try {
    await progress.markClaimed(workerId);

    // --- FETCHING (bar band: 1 → 10) ---------------------------------------
    bus.emit({ type: 'stage', stage: STAGE.FETCHING });
    const tCover = Date.now();
    const targetBuf = await downloadToBuffer(coverImageUrl);
    mark('cover-download', tCover);
    log.info({ bytes: targetBuf.length }, 'cover image downloaded');
    // Cover download counts for ~1 point of the band; photo bank fills 2→10.
    bus.emit({ type: 'progress', percent: 2 });

    const tBank = Date.now();
    throwIfCancelled(mosaicId);
    const photos = await loadEventPhotos(
      eventId,
      (done, total) => {
      // Map real photo-download progress into the 2..10 band.
      const pct = 2 + Math.floor((done / Math.max(1, total)) * 8);
      bus.emit({ type: 'progress', percent: pct });
      },
      () => isCancelled(mosaicId),
    );
    throwIfCancelled(mosaicId);
    mark('photo-bank-total', tBank);
    log.info({ count: photos.length }, 'photo-bank ready');
    bus.emit({
      type: 'checkpoint',
      name: CHECKPOINT.PHOTOS_DOWNLOADED,
      data: { sourceBytes: targetBuf.length, count: photos.length },
    });

    // --- ANALYZING (band: 11 → 20) -----------------------------------------
    throwIfCancelled(mosaicId);
    bus.emit({ type: 'stage', stage: STAGE.ANALYZING });
    const suite = getSuite(input.suite);
    const analyzeCreep = startCreep({
      bus,
      from: 11,
      to: 20,
      durationMs: 6_000,
      note: 'analyzing',
    });
    const tAnalyze = Date.now();
    let grid;
    try {
      grid = await suite.analyzer.analyze(targetBuf);
    } finally {
      analyzeCreep.stop(20);
    }
    mark('analyzer', tAnalyze);
    bus.emit({
      type: 'checkpoint',
      name: CHECKPOINT.ANALYSIS_COMPLETED,
      data: {
        analyzer: suite.analyzer.name,
        cols: grid.cols,
        rows: grid.rows,
        cells: grid.cells.length,
      },
    });

    // --- BUILDING (band: 21 → 65 — palette + matcher + compositor) ---------
    throwIfCancelled(mosaicId);
    bus.emit({ type: 'stage', stage: STAGE.BUILDING });
    // Palette gets ~10 points, matcher ~15, compositor ~20.
    const paletteCreep = startCreep({
      bus,
      from: 21,
      to: 30,
      durationMs: 8_000,
      note: 'palette',
    });
    const tPalette = Date.now();
    let palette;
    try {
      palette = await suite.palette.build(photos);
    } finally {
      paletteCreep.stop(30);
    }
    mark('palette-total', tPalette);
    bus.emit({
      type: 'checkpoint',
      name: CHECKPOINT.PALETTE_GENERATED,
      data: { palette: suite.palette.name, size: palette.entries.length, space: palette.space },
    });

    const matcherCreep = startCreep({
      bus,
      from: 30,
      to: 45,
      durationMs: 15_000,
      note: 'matching',
    });
    const tMatcher = Date.now();
    let matches;
    try {
      matches = await suite.matcher.match(targetBuf, grid, palette);
    } finally {
      matcherCreep.stop(45);
    }
    mark('matcher-total', tMatcher);
    bus.emit({
      type: 'checkpoint',
      name: CHECKPOINT.MATCHING_COMPLETED,
      data: {
        matcher: suite.matcher.name,
        assignments: matches.assignments.length,
        stats: matches.stats ?? null,
      },
    });

    // ONE compositor render → { masterPng, previewWebp, thumb }.
    const compositeCreep = startCreep({
      bus,
      from: 45,
      to: 65,
      durationMs: 25_000,
      note: 'compositing',
    });
    const tComposite = Date.now();
    let outputs;
    try {
      outputs = await suite.compositor.composite(targetBuf, grid, photos, matches, {
        renderCellPx: RENDER_CELL_PX,
        previewLongestSide: 3000,
      });
    } finally {
      compositeCreep.stop(65);
    }
    mark('compositor-total', tComposite);

    if (!outputs.masterPng?.length) {
      throw new Error('compositor: no master PNG produced');
    }
    if (!outputs.previewWebp?.length) {
      throw new Error('compositor: no preview WebP produced');
    }
    if (!outputs.thumb?.length) {
      throw new Error('compositor: no thumb produced');
    }
    {
      const mw = grid.cols * RENDER_CELL_PX;
      const mh = grid.rows * RENDER_CELL_PX;
      log.info(
        { width: mw, height: mh, cellPx: RENDER_CELL_PX, pixelCount: mw * mh, format: 'png' },
        `MASTER DIMENSIONS: width = ${mw} height = ${mh} pixelCount = ${mw * mh} format = png`,
      );
    }

    const matcherStats = matches.stats ?? null;
    // `photo_count` in the DB is displayed to the user as "N photos used" in
    // the mosaic history. Use the number of UNIQUE guest photos actually
    // placed into the mosaic — not the size of the loaded photo bank
    // (which was misleading because most events reuse a subset).
    const uniqueUsed = matcherStats?.uniquePhotosUsed ?? photos.length;

    // --- Build legacy-compatible tiles_json manifest -----------------------
    // Shape matches the browser generator (MosaicManifest):
    //   { version, grid, outputSize, tileSize, tiles: [{ x, y, src }] }
    // The interactive viewer reads scalar `grid`/`outputSize` (originally
    // built for square canvases). We map cols→grid and canvasW→outputSize
    // so `idx = row*cols + col` matches the compositor's paint order.
    // `src` is the upload's storage path (or original https URL) — stable
    // across time. The viewer signs / resolves it later. Use the photo bank
    // records already loaded for matching instead of a second huge `.in(id, …)`
    // query; large events can exceed URL/query limits and leave every src empty.
    const canvasW = grid.cols * RENDER_CELL_PX;
    const idToSrc = new Map(photos.map((p) => [p.id, p.imageUrl ?? '']));
    const tiles = matches.assignments.map((photoId, i) => {
      const col = i % grid.cols;
      const row = Math.floor(i / grid.cols);
      return { x: col, y: row, src: idToSrc.get(photoId) ?? '' };
    });
    const missingSrc = tiles.filter((t) => !t.src).length;
    if (missingSrc > 0) {
      log.warn({ missingSrc, total: tiles.length }, 'tiles_json: some tiles missing src');
    }
    const tilesManifest = {
      version: 2,
      grid: grid.cols,
      outputSize: canvasW,
      tileSize: RENDER_CELL_PX,
      cols: grid.cols,
      rows: grid.rows,
      outputWidth: canvasW,
      outputHeight: grid.rows * RENDER_CELL_PX,
      tiles,
    };

    await updateMosaic(mosaicId, {
      photo_count: uniqueUsed,
      tile_count: grid.cells.length,
      tiles_json: tilesManifest,
      metadata: {
        matcher: matcherStats
          ? {
              name: suite.matcher.name,
              uniquePhotosUsed: matcherStats.uniquePhotosUsed,
              maxReusePerPhoto: matcherStats.maxReusePerPhoto,
              swapsApplied: matcherStats.swapsApplied,
              reassignmentsApplied: matcherStats.reassignmentsApplied,
            }
          : null,
        palette: { size: palette.entries.length },
      },
    });


    bus.emit({
      type: 'checkpoint',
      name: CHECKPOINT.COMPOSITION_COMPLETED,
      data: {
        compositor: suite.compositor.name,
        bytes: {
          masterPng: outputs.masterPng.length,
          previewWebp: outputs.previewWebp.length,
          thumb: outputs.thumb.length,
        },
      },
    });

    // --- UPLOADING + save the ONE master to /tmp (band: 66 → 70) -----------
    throwIfCancelled(mosaicId);
    bus.emit({ type: 'stage', stage: STAGE.UPLOADING });
    const uploadCreep = startCreep({
      bus,
      from: 66,
      to: 70,
      durationMs: 6_000,
      note: 'uploading',
    });
    const tUpload = Date.now();

    // Single master file on disk. Refcount = 2 (Job B + Job C).
    const masterPath = masterPathFor(mosaicId);
    await writeMaster(masterPath, outputs.masterPng);
    log.info(
      { path: masterPath, bytes: outputs.masterPng.length },
      'master.png saved to /tmp',
    );
    retainMaster(masterPath, 2);
    log.info(
      {
        gridCols: grid.cols,
        gridRows: grid.rows,
        cellPx: RENDER_CELL_PX,
        totalCells: grid.cells.length,
        masterWidth: grid.cols * RENDER_CELL_PX,
        masterHeight: grid.rows * RENDER_CELL_PX,
        masterBytes: outputs.masterPng.length,
        uploadedPhotos: photos.length,
        uniquePhotosUsed: matcherStats?.uniquePhotosUsed ?? null,
        maxReusePerPhoto: matcherStats?.maxReusePerPhoto ?? null,
        avgReusePerPhoto: grid.cells.length / Math.max(1, uniqueUsed),
        matcherMs: stageTimings['matcher-total'] ?? null,
        compositorMs: stageTimings['compositor-total'] ?? null,
        masterGenerationMs: Date.now() - tJobStart,
      },
      'BENCHMARK SUMMARY (Job A) — print/webzoom times+sizes in timing:jpeg-encode-print, JOB C COMPLETE, WEB ZOOM DIMENSIONS, job-b:web-zoom:done',
    );

    let preview: Awaited<ReturnType<typeof uploadVariant>>;
    let thumb: Awaited<ReturnType<typeof uploadVariant>>;
    try {
      // Upload preview.webp + thumb.jpg concurrently — never touch /tmp.
      [preview, thumb] = await Promise.all([
        uploadVariant({
          eventId,
          mosaicId,
          variant: 'preview',
          body: outputs.previewWebp,
        }),
        uploadVariant({
          eventId,
          mosaicId,
          variant: 'thumb',
          body: outputs.thumb,
        }),
      ]);
    } finally {
      uploadCreep.stop(70);
    }
    bus.emit({
      type: 'variant',
      variant: 'preview',
      url: preview.publicUrl ?? preview.path,
      path: preview.path,
    });
    bus.emit({
      type: 'variant',
      variant: 'thumb',
      url: thumb.publicUrl ?? thumb.path,
      path: thumb.path,
    });
    mark('upload-preview-and-thumb', tUpload);

    // --- POST-UPLOAD AUDIT: HEAD probe + DB readback --------------------
    // Confirms end-to-end that (a) the uploaded object matches the buffer
    // we generated, and (b) the DB row actually holds the preview_url.
    try {
      const previewHeadUrl = preview.publicUrl;
      if (previewHeadUrl) {
        const head = await fetch(previewHeadUrl, { method: 'HEAD' });
        log.info(
          {
            stage: 'preview-webp:post-upload-head',
            path: preview.path,
            publicUrl: previewHeadUrl,
            status: head.status,
            contentType: head.headers.get('content-type'),
            contentLength: head.headers.get('content-length'),
          },
          'preview-webp:head',
        );
      } else {
        log.warn({ path: preview.path }, 'preview-webp:no-public-url');
      }
    } catch (e) {
      log.warn({ err: String(e) }, 'preview-webp:head-failed');
    }

    // Wait a tick for the writePatch triggered by the 'variant' events to
    // flush, then read the row back and log the persisted URLs.
    await new Promise((r) => setTimeout(r, 500));
    try {
      const { getSupabase } = await import('../lib/supabase');
      const sb = getSupabase();
      const { data: row, error: readErr } = await sb
        .from('mosaics')
        .select('id, preview_url, thumb_url, print_url, dzi_url, image_url')
        .eq('id', mosaicId)
        .maybeSingle();
      log.info(
        {
          stage: 'db-readback:after-preview-upload',
          mosaicId,
          error: readErr?.message ?? null,
          preview_url: row?.preview_url ?? null,
          thumb_url: row?.thumb_url ?? null,
          print_url: row?.print_url ?? null,
          dzi_url: row?.dzi_url ?? null,
          image_url: row?.image_url ?? null,
        },
        'mosaics-db-readback',
      );
    } catch (e) {
      log.warn({ err: String(e) }, 'db-readback:failed');
    }

    // --- FINALIZING ---------------------------------------------------------
    throwIfCancelled(mosaicId);
    bus.emit({ type: 'stage', stage: STAGE.FINALIZING });
    log.info({ mosaicId }, 'job-a:done (awaiting deepzoom + print)');

    const jobAElapsed = Date.now() - tJobStart;
    log.info(
      { eventId, mosaicId, elapsedMs: jobAElapsed, stages: stageTimings },
      'JOB A COMPLETE',
    );
    log.info(
      {
        mosaicId,
        render: stageTimings['compositor-total'] ?? null,
        previewEncode: null, // captured inside compositor logs (preview-webp:generated.encodeMs)
        thumbEncode: null,   // captured inside compositor logs (thumb-jpg:generated.encodeMs)
        storageUploads: stageTimings['upload-preview-and-thumb'] ?? null,
        dzi: 'see JOB B PIPELINE SUMMARY',
        print: 'see JOB C PIPELINE SUMMARY',
        databaseWrites: null, // aggregated per writePatch call in progress-update logs
        totalJobA: jobAElapsed,
      },
      'PIPELINE SUMMARY (Job A)',
    );
    return { masterPath };

  } catch (error) {
    log.error(
      {
        eventId,
        mosaicId,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : error,
      },
      'JOB A FAILED',
    );
    throw error;
  } finally {
    stopCancelWatch();
    unregisterActive(mosaicId);
    detach();
  }
}
