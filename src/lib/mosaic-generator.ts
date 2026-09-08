// True color-matched photo mosaic generator (v2).
//
// Pipeline:
//   1. Sample average LAB color per cell of the target portrait.
//   2. For each guest photo: cache a square thumbnail + average LAB color.
//   3. For each cell, pick the guest photo with smallest ΔE (CIE76) — reuse allowed.
//   4. Compose the tile grid at OUTPUT px, optionally tint each tile toward the
//      target cell color to preserve overall portrait clarity from a distance.
//   5. Encode PNG and return blob + a tile manifest.

export type MosaicProgress = (stage: string, pct: number) => void;

export type MosaicTile = {
  x: number; // grid column
  y: number; // grid row
  src: string; // source guest photo URL used
};

export type MosaicManifest = {
  version: 2;
  grid: number; // legacy scalar (== cols); use `cols`/`rows` when present
  outputSize: number; // legacy scalar square canvas px (== outputWidth for square)
  tileSize: number; // px
  tiles: MosaicTile[];
  // Non-square (portrait/landscape) support. Older manifests only have the
  // scalar `grid` / `outputSize` fields above; newer worker-generated ones
  // include these so viewers can locate tiles correctly on rectangular canvases.
  cols?: number;
  rows?: number;
  outputWidth?: number;
  outputHeight?: number;
};

export type MosaicStats = {
  totalUploadedPhotos: number;
  uniquePhotosUsed: number;
  mostReusedCount: number;
  averageReuseCount: number; // mean uses across photos used ≥1 time
  diversityScore: number; // uniqueUsed / totalCells (0..1)
  outputSize: number;
  grid: number;
  tileSize: number;
  fileSizeBytes: number;
};

export type MosaicResult = {
  blob: Blob;
  previewBlob: Blob;
  thumbBlob: Blob;
  manifest: MosaicManifest;
  uniquePhotos: number;
  stats: MosaicStats;
};

// Lightweight dashboard preview — never used for printing or deep zoom.
export const PREVIEW_MAX_DIM = 1200;
export const PREVIEW_TARGET_BYTES = 300 * 1024;
// Tiny grid thumb — used in "Previous mosaics" strip.
export const THUMB_MAX_DIM = 320;
export const THUMB_TARGET_BYTES = 40 * 1024;


// Defaults — print-ready (~26"x26" @ 300dpi); 80×80 grid → 100px tiles.
export const DEFAULT_GRID = 80;
export const DEFAULT_OUTPUT = 8000;
export const DEFAULT_OVERLAY_OPACITY = 0.30;
const COLOR_BLEND_ALPHA = 0.22;
const ANALYSIS_THUMB = 32;
const TILE_LOAD_CONCURRENCY = 6;
const MAX_MOSAIC_UPLOAD_BYTES = 45 * 1024 * 1024;

// Diversity tuning.
// score = colorDeltaE * colorWeight
//       + (usageCount ^ reuseExponent) * reusePenaltyWeight
//       + (neighborhoodPenalty if a prior placement is within neighborhoodRadius)
// colorTolerance: squared-ΔE76 window in which two photos are treated as
//   color-equivalent for the underused-photo tie-break.
export const DEFAULT_DIVERSITY = {
  colorWeight: 1,
  reusePenaltyWeight: 14,
  reuseExponent: 1.35,
  neighborhoodRadius: 6,
  neighborhoodPenalty: 1500,
  colorTolerance: 36, // ~ΔE 6
} as const;

type RGB = { r: number; g: number; b: number };
type LAB = { L: number; a: number; b: number };

type PhotoEntry = {
  url: string;
  thumb: HTMLCanvasElement; // tileSize × tileSize, cover-cropped
  lab: LAB;
};

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });
}

function coverRect(iw: number, ih: number, dw: number, dh: number) {
  const ir = iw / ih;
  const dr = dw / dh;
  let sw: number, sh: number, sx: number, sy: number;
  if (ir > dr) {
    sh = ih;
    sw = sh * dr;
    sx = (iw - sw) / 2;
    sy = 0;
  } else {
    sw = iw;
    sh = sw / dr;
    sx = 0;
    sy = (ih - sh) / 2;
  }
  return { sx, sy, sw, sh };
}

function averageColor(data: Uint8ClampedArray): RGB {
  let r = 0,
    g = 0,
    b = 0,
    n = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 8) continue;
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    n++;
  }
  if (n === 0) return { r: 0, g: 0, b: 0 };
  return { r: r / n, g: g / n, b: b / n };
}

// sRGB → CIE Lab (D65). Good enough; we only need relative distances.
function rgbToLab({ r, g, b }: RGB): LAB {
  const srgb = [r, g, b].map((v) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  const [R, G, B] = srgb;
  let X = R * 0.4124564 + G * 0.3575761 + B * 0.1804375;
  let Y = R * 0.2126729 + G * 0.7151522 + B * 0.072175;
  let Z = R * 0.0193339 + G * 0.119192 + B * 0.9503041;
  X /= 0.95047;
  Y /= 1.0;
  Z /= 1.08883;
  const f = (t: number) =>
    t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 / 116) * t + 16 / 116;
  const fx = f(X),
    fy = f(Y),
    fz = f(Z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

function deltaE76(a: LAB, b: LAB): number {
  const dL = a.L - b.L,
    da = a.a - b.a,
    db = a.b - b.b;
  return dL * dL + da * da + db * db; // squared — fine for comparison
}

async function runConcurrent<T>(
  items: string[],
  worker: (url: string, index: number) => Promise<T | null>,
  concurrency: number,
  onOne?: (done: number, total: number) => void,
): Promise<T[]> {
  const results: T[] = [];
  let next = 0;
  let done = 0;
  const total = items.length;
  async function pump() {
    while (next < total) {
      const i = next++;
      try {
        const r = await worker(items[i], i);
        if (r != null) results.push(r);
      } catch (e) {
        console.warn("[mosaic] tile load failed", items[i], e);
      } finally {
        done++;
        onOne?.(done, total);
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, total) }, () => pump()),
  );
  return results;
}

async function buildPhotoEntry(url: string, tileSize: number): Promise<PhotoEntry> {
  const img = await loadImage(url);
  // thumbnail at tileSize (used in composition)
  const thumb = document.createElement("canvas");
  thumb.width = tileSize;
  thumb.height = tileSize;
  const tctx = thumb.getContext("2d")!;
  tctx.imageSmoothingEnabled = true;
  tctx.imageSmoothingQuality = "high";
  const cr = coverRect(img.width, img.height, tileSize, tileSize);
  tctx.drawImage(img, cr.sx, cr.sy, cr.sw, cr.sh, 0, 0, tileSize, tileSize);

  // average color from a tiny analysis thumb
  const a = document.createElement("canvas");
  a.width = ANALYSIS_THUMB;
  a.height = ANALYSIS_THUMB;
  const actx = a.getContext("2d")!;
  actx.imageSmoothingEnabled = true;
  actx.imageSmoothingQuality = "low";
  actx.drawImage(img, cr.sx, cr.sy, cr.sw, cr.sh, 0, 0, ANALYSIS_THUMB, ANALYSIS_THUMB);
  const px = actx.getImageData(0, 0, ANALYSIS_THUMB, ANALYSIS_THUMB).data;
  const rgb = averageColor(px);
  img.src = ""; // free decoded bitmap
  return { url, thumb, lab: rgbToLab(rgb) };
}

export async function generateMosaic(
  coverUrl: string,
  tileUrls: string[],
  opts: {
    grid?: number;
    outputSize?: number;
    colorWeight?: number;
    colorTolerance?: number;
    reusePenaltyWeight?: number;
    reuseExponent?: number;
    neighborhoodRadius?: number;
    neighborhoodPenalty?: number;
    overlayOpacity?: number;
  } = {},
  onProgress?: MosaicProgress,
): Promise<MosaicResult> {
  const grid = opts.grid ?? DEFAULT_GRID;
  const outputSize = opts.outputSize ?? DEFAULT_OUTPUT;
  const tileSize = Math.floor(outputSize / grid);
  const overlayOpacity = Math.max(0, Math.min(1, opts.overlayOpacity ?? DEFAULT_OVERLAY_OPACITY));
  const colorWeight = opts.colorWeight ?? DEFAULT_DIVERSITY.colorWeight;
  const colorTolerance = opts.colorTolerance ?? DEFAULT_DIVERSITY.colorTolerance;
  const reusePenaltyWeight =
    opts.reusePenaltyWeight ?? DEFAULT_DIVERSITY.reusePenaltyWeight;
  const reuseExponent = opts.reuseExponent ?? DEFAULT_DIVERSITY.reuseExponent;
  const neighborhoodRadius =
    opts.neighborhoodRadius ?? DEFAULT_DIVERSITY.neighborhoodRadius;
  const neighborhoodPenalty =
    opts.neighborhoodPenalty ?? DEFAULT_DIVERSITY.neighborhoodPenalty;
  const t0 = performance.now();
  console.log(
    `[mosaic] start v2 — grid=${grid}x${grid}, output=${outputSize}px, tile=${tileSize}px, photos=${tileUrls.length}, diversity={colorW:${colorWeight}, reuseW:${reusePenaltyWeight}, reuseExp:${reuseExponent}, tol:${colorTolerance}, radius:${neighborhoodRadius}, nbPenalty:${neighborhoodPenalty}}`,
  );

  // 1. Cover → per-cell average LAB colors.
  onProgress?.("analyzing-cover", 0);
  const cover = await loadImage(coverUrl);
  const cellCanvas = document.createElement("canvas");
  cellCanvas.width = grid;
  cellCanvas.height = grid;
  const cctx = cellCanvas.getContext("2d")!;
  cctx.imageSmoothingEnabled = true;
  cctx.imageSmoothingQuality = "high";
  const ccr = coverRect(cover.width, cover.height, grid, grid);
  cctx.drawImage(cover, ccr.sx, ccr.sy, ccr.sw, ccr.sh, 0, 0, grid, grid);
  const cellPixels = cctx.getImageData(0, 0, grid, grid).data;
  // NOTE: keep `cover` decoded — we re-use it for the optional overlay below.

  const cellRGB: RGB[] = new Array(grid * grid);
  const cellLAB: LAB[] = new Array(grid * grid);
  for (let i = 0; i < grid * grid; i++) {
    const o = i * 4;
    const rgb: RGB = {
      r: cellPixels[o],
      g: cellPixels[o + 1],
      b: cellPixels[o + 2],
    };
    cellRGB[i] = rgb;
    cellLAB[i] = rgbToLab(rgb);
  }

  // 2. Build photo entries (thumb + avg color), concurrency-limited.
  onProgress?.("analyzing-photos", 8);
  const tPhotos = performance.now();
  const entries = await runConcurrent(
    tileUrls,
    (url) => buildPhotoEntry(url, tileSize),
    TILE_LOAD_CONCURRENCY,
    (done, total) =>
      onProgress?.("analyzing-photos", 8 + Math.round((done / total) * 55)),
  );
  console.log(
    `[mosaic] photo analysis: ${entries.length}/${tileUrls.length} ok in ${Math.round(
      performance.now() - tPhotos,
    )}ms`,
  );
  console.log(`[mosaic] matchingMode=LAB`);
  console.log(`[mosaic] photosAnalyzed=${entries.length}`);

  if (entries.length === 0) {
    throw new Error("No guest photos could be loaded for the mosaic.");
  }

  // 3. Match: for each cell pick the best photo, balancing color accuracy
  //    against visual diversity.
  //
  //    Primary objective: color fidelity (squared ΔE76).
  //    Secondary: avoid clusters by penalising
  //      (a) any photo already placed within `neighborhoodRadius` cells, and
  //      (b) heavily reused photos (additive cost per prior use).
  //    Ties within `colorTolerance` always go to the less-used photo so
  //    similar candidates spread across the canvas.
  onProgress?.("matching", 65);
  const tMatch = performance.now();
  const assignment: number[] = new Array(grid * grid);
  const usage: number[] = new Array(entries.length).fill(0);
  // lastPlacement[p] = list of recently-placed cell indices for photo p
  // (we only need positions within `neighborhoodRadius` of the current cell;
  //  scanning row-major means stale entries are cheap to skip).
  const lastPlacement: Array<number[]> = Array.from(
    { length: entries.length },
    () => [],
  );
  const r2 = neighborhoodRadius * neighborhoodRadius;

  let deltaESum = 0;
  for (let cy = 0; cy < grid; cy++) {

    for (let cx = 0; cx < grid; cx++) {
      const idx = cy * grid + cx;
      const target = cellLAB[idx];
      let bestIdx = 0;
      let bestScore = Infinity;
      let bestColorD = Infinity;

      for (let p = 0; p < entries.length; p++) {
        const colorD = deltaE76(target, entries[p].lab);

        // Neighborhood check: any prior placement within the radius?
        let nbHit = false;
        const placements = lastPlacement[p];
        for (let k = placements.length - 1; k >= 0; k--) {
          const prev = placements[k];
          const px = prev % grid;
          const py = (prev - px) / grid;
          const dx = px - cx;
          const dy = py - cy;
          // Row-major: anything older than `radius` rows can be dropped.
          if (cy - py > neighborhoodRadius) {
            // placements is appended row-major, so everything from index 0..k
            // is at least as old and equally stale — drop them all.
            placements.splice(0, k + 1);
            break;
          }
          if (dx * dx + dy * dy <= r2) {
            nbHit = true;
            break;
          }
        }

        const score =
          colorD * colorWeight +
          Math.pow(usage[p], reuseExponent) * reusePenaltyWeight +
          (nbHit ? neighborhoodPenalty : 0);

        if (
          score < bestScore ||
          // Tie-break within color tolerance: prefer least-used photo.
          (Math.abs(colorD - bestColorD) <= colorTolerance &&
            usage[p] < usage[bestIdx])
        ) {
          bestScore = score;
          bestIdx = p;
          bestColorD = colorD;
        }
      }

      assignment[idx] = bestIdx;
      usage[bestIdx]++;
      lastPlacement[bestIdx].push(idx);
      deltaESum += Math.sqrt(Math.max(0, bestColorD));
    }
  }
  const uniqueUsed = usage.filter((n) => n > 0).length;
  const maxUse = usage.reduce((m, n) => (n > m ? n : m), 0);
  const averageDeltaE = deltaESum / (grid * grid);
  console.log(
    `[mosaic] matched ${grid * grid} cells in ${Math.round(performance.now() - tMatch)}ms — unique used: ${uniqueUsed}/${entries.length}, max reuse: ${maxUse}`,
  );
  console.log(`[mosaic] averageDeltaE=${averageDeltaE.toFixed(2)}`);


  // 4. Compose final canvas.
  onProgress?.("composing", 72);
  const tCompose = performance.now();
  const out = document.createElement("canvas");
  out.width = outputSize;
  out.height = outputSize;
  const octx = out.getContext("2d")!;
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
  octx.fillStyle = "#000";
  octx.fillRect(0, 0, outputSize, outputSize);

  const usedPhotos = new Set<number>();
  const manifestTiles: MosaicTile[] = new Array(grid * grid);

  for (let cy = 0; cy < grid; cy++) {
    for (let cx = 0; cx < grid; cx++) {
      const idx = cy * grid + cx;
      const pi = assignment[idx];
      usedPhotos.add(pi);
      const entry = entries[pi];
      const x = cx * tileSize;
      const y = cy * tileSize;
      octx.drawImage(entry.thumb, x, y, tileSize, tileSize);
      // Color correction: tint toward target cell color.
      const c = cellRGB[idx];
      octx.fillStyle = `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${COLOR_BLEND_ALPHA})`;
      octx.fillRect(x, y, tileSize, tileSize);
      manifestTiles[idx] = { x: cx, y: cy, src: entry.url };
    }
    if (cy % 8 === 0) {
      onProgress?.("composing", 72 + Math.round((cy / grid) * 22));
      // yield to the browser so the UI/progress bar can repaint
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  console.log(
    `[mosaic] composition in ${Math.round(performance.now() - tCompose)}ms, unique photos used: ${usedPhotos.size}`,
  );

  // 4b. Optional source-image overlay — subtly re-asserts face contours and
  //     overall readability at viewing distance while individual tiles stay
  //     visible under zoom.
  if (overlayOpacity > 0) {
    const ocr = coverRect(cover.width, cover.height, outputSize, outputSize);
    octx.save();
    octx.globalAlpha = overlayOpacity;
    octx.globalCompositeOperation = "source-over";
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = "high";
    octx.drawImage(cover, ocr.sx, ocr.sy, ocr.sw, ocr.sh, 0, 0, outputSize, outputSize);
    octx.restore();
  }
  cover.src = "";

  // 5. Encode as JPEG — a 6000×6000 PNG of a photo mosaic is ~80 MB which
  //    exceeds Supabase Storage's per-object limit. JPEG q0.9 lands ~5–10 MB
  //    with no perceptible quality loss for a photographic mosaic.
  onProgress?.("encoding", 96);
  const tEnc = performance.now();
  let blob: Blob = await new Promise((resolve, reject) => {
    out.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Failed to encode mosaic"))),
      "image/jpeg",
      0.9,
    );
  });
  if (blob.size > MAX_MOSAIC_UPLOAD_BYTES) {
    blob = await new Promise((resolve, reject) => {
      out.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Failed to compress mosaic"))),
        "image/jpeg",
        0.82,
      );
    });
  }
  if (blob.size > MAX_MOSAIC_UPLOAD_BYTES) {
    throw new Error(
      `Mosaic export is still too large (${(blob.size / 1024 / 1024).toFixed(1)} MB).`,
    );
  }
  console.log(
    `[mosaic] JPEG encoded in ${Math.round(performance.now() - tEnc)}ms (${(blob.size / 1024 / 1024).toFixed(2)} MB), total ${Math.round(performance.now() - t0)}ms`,
  );

  // 5b. Lightweight preview (dashboard cards). Adaptive quality until <300 KB.
  onProgress?.("encoding-preview", 98);
  const tPrev = performance.now();
  const previewDim = Math.min(PREVIEW_MAX_DIM, outputSize);
  const prevCanvas = document.createElement("canvas");
  prevCanvas.width = previewDim;
  prevCanvas.height = previewDim;
  const pctx = prevCanvas.getContext("2d")!;
  pctx.imageSmoothingEnabled = true;
  pctx.imageSmoothingQuality = "high";
  pctx.drawImage(out, 0, 0, previewDim, previewDim);
  let previewBlob: Blob | null = null;
  for (const q of [0.82, 0.74, 0.66, 0.58, 0.5, 0.42]) {
    const b: Blob = await new Promise((resolve, reject) => {
      prevCanvas.toBlob(
        (x) => (x ? resolve(x) : reject(new Error("Failed to encode preview"))),
        "image/jpeg",
        q,
      );
    });
    previewBlob = b;
    if (b.size <= PREVIEW_TARGET_BYTES) break;
  }
  if (!previewBlob) throw new Error("Failed to encode mosaic preview");
  console.log(
    `[mosaic] preview encoded in ${Math.round(performance.now() - tPrev)}ms — ${previewDim}x${previewDim}, ${(previewBlob.size / 1024).toFixed(1)} KB`,
  );

  // 5c. Tiny thumb (~300px) for the "Previous mosaics" strip.
  const tThumb = performance.now();
  const thumbDim = Math.min(THUMB_MAX_DIM, outputSize);
  const thumbCanvas = document.createElement("canvas");
  thumbCanvas.width = thumbDim;
  thumbCanvas.height = thumbDim;
  const tctx = thumbCanvas.getContext("2d")!;
  tctx.imageSmoothingEnabled = true;
  tctx.imageSmoothingQuality = "high";
  tctx.drawImage(out, 0, 0, thumbDim, thumbDim);
  let thumbBlob: Blob | null = null;
  for (const q of [0.78, 0.7, 0.62, 0.54, 0.46]) {
    const b: Blob = await new Promise((resolve, reject) => {
      thumbCanvas.toBlob(
        (x) => (x ? resolve(x) : reject(new Error("Failed to encode thumb"))),
        "image/jpeg",
        q,
      );
    });
    thumbBlob = b;
    if (b.size <= THUMB_TARGET_BYTES) break;
  }
  if (!thumbBlob) throw new Error("Failed to encode mosaic thumb");
  console.log(
    `[mosaic] thumb encoded in ${Math.round(performance.now() - tThumb)}ms — ${thumbDim}x${thumbDim}, ${(thumbBlob.size / 1024).toFixed(1)} KB`,
  );

  onProgress?.("done", 100);


  // Stats — computed from final `usage` array.
  const usedCounts = usage.filter((n) => n > 0);
  const totalCells = grid * grid;
  const uniqueUsedFinal = usedCounts.length;
  const mostReusedCount = usedCounts.reduce((m, n) => (n > m ? n : m), 0);
  const averageReuseCount =
    uniqueUsedFinal > 0
      ? usedCounts.reduce((s, n) => s + n, 0) / uniqueUsedFinal
      : 0;
  const stats: MosaicStats = {
    totalUploadedPhotos: tileUrls.length,
    uniquePhotosUsed: uniqueUsedFinal,
    mostReusedCount,
    averageReuseCount: Math.round(averageReuseCount * 100) / 100,
    diversityScore: Math.round((uniqueUsedFinal / totalCells) * 1000) / 1000,
    outputSize,
    grid,
    tileSize,
    fileSizeBytes: blob.size,
  };
  console.log(
    `[mosaic] metrics — output=${outputSize}x${outputSize}px, grid=${grid}x${grid}, tile=${tileSize}px, ` +
      `uniquePhotosUsed=${uniqueUsedFinal}, maxReuse=${mostReusedCount}, ` +
      `avgReuse=${stats.averageReuseCount}, diversity=${(stats.diversityScore * 100).toFixed(1)}%, ` +
      `overlayOpacity=${overlayOpacity}, jpegSize=${(blob.size / 1024 / 1024).toFixed(2)}MB`,
  );

  return {
    blob,
    previewBlob,
    thumbBlob,
    uniquePhotos: usedPhotos.size,

    stats,
    manifest: {
      version: 2,
      grid,
      outputSize,
      tileSize,
      tiles: manifestTiles,
    },
  };
}

// Back-compat shim — old callers expect a Blob.
export async function generateMosaicBlob(
  coverUrl: string,
  tileUrls: string[],
  onProgress?: MosaicProgress,
): Promise<Blob> {
  const r = await generateMosaic(coverUrl, tileUrls, {}, onProgress);
  return r.blob;
}

export const MOSAIC_OUTPUT_SIZE = DEFAULT_OUTPUT;
