import sharp from 'sharp';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { logger } from '../lib/logger';
import { getSupabase } from '../lib/supabase';
import { config } from '../config';
import type {
  AlgorithmSuite,
  Compositor,
  CompositeOutputs,
  DeepZoomBuilder,
  DeepZoomOutput,
  GridAnalyzer,
  MatchResult,
  Palette,
  PaletteBuilder,
  SourcePhoto,
  TileCell,
  TileGrid,
  TileMatcher,
} from '../algorithms';

/**
 * Foundation / "v0" algorithm suite.
 *
 * First-real-mosaic milestone: the analyzer produces an actual grid and
 * the compositor paints one guest photo per cell. No color matching yet —
 * assignments fall back to round-robin so every photo appears.
 */

const TARGET_CELL_PX = 40; // physical pixel size of each tile on the canvas
const MAX_COLS = 200;
const MAX_ROWS = 150;

// TEMPORARY BENCHMARK cell size (px per tile in the master). The job reads
// this for the compositor; null falls back to the production 120.
export const BENCHMARK_CELL_PX: number | null = 150;

const gridAnalyzer: GridAnalyzer = {
  name: 'uniform@0',
  async analyze(target) {
    const meta = await sharp(target).metadata();
    // EXIF orientation: 5-8 swap width/height (portrait phone photos
    // are commonly stored as landscape pixels + orientation=6/8). Without
    // this swap, portrait covers were analyzed as landscape, producing a
    // landscape grid that later cropped/stretched the cover.
    const orientation = meta.orientation ?? 1;
    const swap = orientation >= 5 && orientation <= 8;
    const rawW = meta.width ?? 0;
    const rawH = meta.height ?? 0;
    const w = swap ? rawH : rawW;
    const h = swap ? rawW : rawH;
    if (!w || !h) {
      throw new Error('analyzer: cover image has unknown dimensions');
    }
    // Print-master grid: the LONG edge is always MASTER_LONG_EDGE_CELLS
    // cells (× renderCellPx 120 = ~24,000 px), independent of the cover's
    // pixel size and of the uploaded photo count. The short edge follows
    // the cover's (oriented) aspect ratio — never distorted.
    const MASTER_LONG_EDGE_CELLS = 200;
    let cols: number;
    let rows: number;
    if (w >= h) {
      cols = MASTER_LONG_EDGE_CELLS;
      rows = Math.max(1, Math.round((MASTER_LONG_EDGE_CELLS * h) / w));
    } else {
      rows = MASTER_LONG_EDGE_CELLS;
      cols = Math.max(1, Math.round((MASTER_LONG_EDGE_CELLS * w) / h));
    }
    // TEMPORARY BENCHMARK: fixed 2:3 portrait grid 32×48 = 1,536 cells
    // (× 150 px → 4,800 × 7,200 master ≈ 305 PPI at 40×60 cm).
    // Set BENCHMARK_GRID to null to restore the 200-cell long-edge grid.
    const BENCHMARK_GRID: { cols: number; rows: number } | null = { cols: 32, rows: 48 };
    // TEMPORARY BENCHMARK cell size (px per tile in the master). The job
    // reads this for the compositor; null falls back to the production 120.
    export const BENCHMARK_CELL_PX: number | null = 150;
    const RENDER_CELL_PX_EFFECTIVE = BENCHMARK_CELL_PX ?? 120;
    if (BENCHMARK_GRID) {
      cols = BENCHMARK_GRID.cols;
      rows = BENCHMARK_GRID.rows;
    }
    console.log(
      JSON.stringify({
        msg: 'BENCHMARK GRID',
        benchmark: !!BENCHMARK_GRID,
        cols,
        rows,
        cellPx: RENDER_CELL_PX_EFFECTIVE,
        totalCells: cols * rows,
        expectedMasterWidth: cols * RENDER_CELL_PX_EFFECTIVE,
        expectedMasterHeight: rows * RENDER_CELL_PX_EFFECTIVE,
      }),
    );
    void MAX_COLS;
    void MAX_ROWS;

    const targetWidth = cols * TARGET_CELL_PX;
    const targetHeight = rows * TARGET_CELL_PX;
    const cells: TileCell[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        cells.push({
          x: c * TARGET_CELL_PX,
          y: r * TARGET_CELL_PX,
          w: TARGET_CELL_PX,
          h: TARGET_CELL_PX,
        });
      }
    }
    return { cols, rows, cells, targetWidth, targetHeight } satisfies TileGrid;
  },
};

/**
 * Color conversion helpers: sRGB (0..255) -> linear -> XYZ (D65) -> CIE L*a*b*.
 * LAB is roughly perceptually uniform, so plain Euclidean distance in LAB
 * (a.k.a. ΔE*76) is a solid perceptual match metric — much better than
 * Euclidean RGB and good enough for photomosaic tile selection without
 * pulling in the heavier ΔE2000 formula.
 */
function srgbChannelToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function labFFn(t: number): number {
  const d = 6 / 29;
  return t > d * d * d ? Math.cbrt(t) : t / (3 * d * d) + 4 / 29;
}

function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const rl = srgbChannelToLinear(r);
  const gl = srgbChannelToLinear(g);
  const bl = srgbChannelToLinear(b);
  // sRGB D65 -> XYZ
  const X = rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375;
  const Y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750;
  const Z = rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041;
  // Normalize by D65 reference white
  const xr = X / 0.95047;
  const yr = Y / 1.0;
  const zr = Z / 1.08883;
  const fx = labFFn(xr);
  const fy = labFFn(yr);
  const fz = labFFn(zr);
  const L = 116 * fy - 16;
  const a = 500 * (fx - fy);
  const bb = 200 * (fy - fz);
  return [L, a, bb];
}

/**
 * Computes a 2×2 perceptual LAB signature per source photo (12 floats:
 * 4 regions × LAB). The image is resized to 16×16 with `fit: 'cover'`
 * matching the compositor crop, then split into four 8×8 quadrants
 * (TL, TR, BL, BR) and averaged independently in CIE L*a*b*.
 */
const PALETTE_CONCURRENCY = 4;
const SIG_SIZE = 16; // analysis crop size (must be even)
const SIG_HALF = SIG_SIZE / 2;

// Extended per-photo descriptor (length 38):
//   [0..11]   2×2 LAB quad signature (existing; perceptual matcher uses this)
//   [12..35]  8-bin normalized RGB histogram (8 R + 8 G + 8 B)
//   [36..37]  64-bit dHash perceptual hash packed as two uint32
// The matcher tolerates older 12-length signatures gracefully — the
// histogram and pHash terms fall back to LAB-only similarity.
const SIG_LAB_LEN = 12;
const HIST_BINS = 8;
const HIST_LEN = HIST_BINS * 3; // 24
const PHASH_NUMS = 2;
const SIG_TOTAL = SIG_LAB_LEN + HIST_LEN + PHASH_NUMS; // 38

interface SignatureTimings {
  decode16Ms: number;
  decode9Ms: number;
  labMs: number;
  histMs: number;
  hashMs: number;
  packMs: number;
}

async function signatureOf(buffer: Buffer, t?: SignatureTimings): Promise<number[]> {
  const img = sharp(buffer, { failOn: 'none' }).rotate();
  // 16×16 RGB for LAB quads + histogram.
  let s = Date.now();
  const raw16 = await img
    .clone()
    .resize(SIG_SIZE, SIG_SIZE, { fit: 'cover', position: 'centre' })
    .removeAlpha()
    .raw()
    .toBuffer();
  if (t) t.decode16Ms += Date.now() - s;
  // 9×8 grayscale for dHash (compare adjacent pixels per row → 64 bits).
  s = Date.now();
  const rawHash = await img
    .clone()
    .resize(9, 8, { fit: 'cover', position: 'centre' })
    .greyscale()
    .removeAlpha()
    .raw()
    .toBuffer();
  if (t) t.decode9Ms += Date.now() - s;

  // --- LAB + histogram pass over the 16×16 RGB buffer --------------------
  s = Date.now();
  const sums = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const counts = [0, 0, 0, 0];
  const hist = new Array<number>(HIST_LEN).fill(0);
  let totalPx = 0;
  for (let y = 0; y < SIG_SIZE; y++) {
    const qy = y < SIG_HALF ? 0 : 1;
    for (let x = 0; x < SIG_SIZE; x++) {
      const qx = x < SIG_HALF ? 0 : 1;
      const q = qy * 2 + qx;
      const i = (y * SIG_SIZE + x) * 3;
      const r = raw16[i]!;
      const g = raw16[i + 1]!;
      const b = raw16[i + 2]!;
      const lab = rgbToLab(r, g, b);
      sums[q * 3] = sums[q * 3]! + lab[0]!;
      sums[q * 3 + 1] = sums[q * 3 + 1]! + lab[1]!;
      sums[q * 3 + 2] = sums[q * 3 + 2]! + lab[2]!;
      counts[q] = counts[q]! + 1;
      // 8 bins per channel → shift 8-bit value right by 5 (256/8 = 32).
      const rb = r >> 5;
      const gb = g >> 5;
      const bb = b >> 5;
      hist[rb] = hist[rb]! + 1;
      hist[HIST_BINS + gb] = hist[HIST_BINS + gb]! + 1;
      hist[HIST_BINS * 2 + bb] = hist[HIST_BINS * 2 + bb]! + 1;
      totalPx++;
    }
  }
  // LAB + hist share the same loop; split the elapsed evenly so both
  // phases are visible in the timing log without double-counting.
  const labHistMs = Date.now() - s;
  if (t) {
    t.labMs += Math.floor(labHistMs / 2);
    t.histMs += labHistMs - Math.floor(labHistMs / 2);
  }

  // --- dHash pass --------------------------------------------------------
  s = Date.now();
  let lo = 0;
  let hi = 0;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = rawHash[y * 9 + x]!;
      const right = rawHash[y * 9 + x + 1]!;
      if (left < right) {
        const bit = y * 8 + x;
        if (bit < 32) lo |= 1 << bit;
        else hi |= 1 << (bit - 32);
      }
    }
  }
  if (t) t.hashMs += Date.now() - s;

  // --- Descriptor packing ------------------------------------------------
  s = Date.now();
  const out = new Array<number>(SIG_TOTAL);
  for (let q = 0; q < 4; q++) {
    const n = counts[q]! || 1;
    out[q * 3] = sums[q * 3]! / n;
    out[q * 3 + 1] = sums[q * 3 + 1]! / n;
    out[q * 3 + 2] = sums[q * 3 + 2]! / n;
  }
  const norm = totalPx > 0 ? 1 / totalPx : 0;
  for (let i = 0; i < HIST_LEN; i++) {
    out[SIG_LAB_LEN + i] = hist[i]! * norm;
  }
  out[SIG_LAB_LEN + HIST_LEN] = lo >>> 0;
  out[SIG_LAB_LEN + HIST_LEN + 1] = hi >>> 0;
  if (t) t.packMs += Date.now() - s;
  return out;
}


const meanLabPalette: PaletteBuilder = {
  name: 'quad-lab@1',
  async build(photos: SourcePhoto[]): Promise<Palette> {
    const log = logger.child({ component: 'palette' });
    log.info({ count: photos.length, concurrency: PALETTE_CONCURRENCY }, 'building quad-lab (2x2) palette');
    const entries: Array<{ photoId: string; signature: number[] }> = new Array(photos.length);
    const timings: SignatureTimings = {
      decode16Ms: 0,
      decode9Ms: 0,
      labMs: 0,
      histMs: 0,
      hashMs: 0,
      packMs: 0,
    };
    const tStart = Date.now();
    let next = 0;
    async function worker() {
      while (true) {
        const idx = next++;
        if (idx >= photos.length) return;
        const p = photos[idx]!;
        try {
          const sig = await signatureOf(p.buffer, timings);
          entries[idx] = { photoId: p.id, signature: sig };
        } catch (err) {
          log.warn({ id: p.id, err: String(err) }, 'palette: photo failed');
          entries[idx] = { photoId: p.id, signature: new Array(12).fill(0) };
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(PALETTE_CONCURRENCY, photos.length) }, worker),
    );
    const elapsedMs = Date.now() - tStart;
    log.info(
      {
        elapsedMs,
        photos: photos.length,
        concurrency: PALETTE_CONCURRENCY,
        decode16Ms: timings.decode16Ms,
        decode9Ms: timings.decode9Ms,
        labMs: timings.labMs,
        histMs: timings.histMs,
        hashMs: timings.hashMs,
        packMs: timings.packMs,
      },
      'timing:palette-phases',
    );
    return { entries, space: 'lab-quad' };
  },
};

/**
 * Perceptual + diversity-aware matcher with global optimization passes.
 *
 *  - Color distance is squared ΔE*76 in CIE L*a*b*.
 *  - Per-photo usage penalty with a quadratic ramp so every uploaded
 *    photo gets a fair shot before any one is reused heavily.
 *  - Hard neighbour penalty inside the 8-neighbourhood (no duplicates
 *    touching) plus a perceptual neighbour penalty for visually similar
 *    photos within radius 2.
 *  - After the initial greedy pass, runs two optimization stages:
 *      1. SWAP passes — exchange tiles between two cells when the
 *         combined perceptual + neighbour cost strictly decreases.
 *         Swaps preserve the photo multiset, so the usage distribution
 *         (and its fairness penalty) is unchanged.
 *      2. REASSIGN passes — re-pick the photo for each cell from a
 *         shortlist of perceptually close candidates, accepting the
 *         change only if it lowers (colour + usage + neighbour) cost.
 *         This lets under-used photos displace over-used ones whenever
 *         it does not damage cover resemblance.
 *
 * Deterministic: a seeded PRNG drives swap-partner sampling so the same
 * inputs always produce the same mosaic.
 */
const perceptualMatcher: TileMatcher = {
  name: 'perceptual-lab-optim@3',
  async match(target, grid, palette): Promise<MatchResult> {
    const log = logger.child({ component: 'matcher' });
    const tMatcherStart = Date.now();
    const phaseTimings: Record<string, number> = {};
    const phaseMeta: Record<string, Record<string, number>> = {};
    const recordPhase = (
      name: string,
      ms: number,
      meta?: Record<string, number>,
    ): void => {
      phaseTimings[name] = ms;
      if (meta) phaseMeta[name] = meta;
      log.info(
        { phase: name, elapsedMs: ms, ...(meta ?? {}) },
        `timing:matcher:${name}`,
      );
    };

    // --- heartbeat -----------------------------------------------------
    // Two complementary signals so we can tell "stuck" from "slow":
    //   1) setInterval — fires whenever the event loop is free (async
    //      stages like sharp/decode). Won't fire during a tight JS loop.
    //   2) inline poll (maybeHeartbeat) — called inside hot loops so we
    //      see progress even while the event loop is blocked.
    const HEARTBEAT_MS = 30_000;
    const hb = {
      phase: 'init',
      pass: 0,
      cellsDone: 0,
      lastAt: Date.now(),
      expectedAt: Date.now() + 30_000,
    };
    const memSnapshot = (): { heapUsedMB: number; heapTotalMB: number; rssMB: number } => {
      try {
        const m = process.memoryUsage();
        const toMB = (n: number): number => Math.round((n / (1024 * 1024)) * 10) / 10;
        return { heapUsedMB: toMB(m.heapUsed), heapTotalMB: toMB(m.heapTotal), rssMB: toMB(m.rss) };
      } catch {
        return { heapUsedMB: 0, heapTotalMB: 0, rssMB: 0 };
      }
    };
    const emitHeartbeat = (source: 'interval' | 'inline'): void => {
      const now = Date.now();
      // Event-loop lag: how late did the timer (or inline check) actually
      // fire vs the scheduled tick? Positive lag means JS thread was busy.
      const lagMs = Math.max(0, now - hb.expectedAt);
      hb.lastAt = now;
      hb.expectedAt = now + HEARTBEAT_MS;
      const mem = memSnapshot();
      log.info(
        {
          source,
          phase: hb.phase,
          pass: hb.pass,
          cellsDone: hb.cellsDone,
          elapsedMs: now - tMatcherStart,
          eventLoopLagMs: lagMs,
          heapUsedMB: mem.heapUsedMB,
          heapTotalMB: mem.heapTotalMB,
          rssMB: mem.rssMB,
        },
        'heartbeat:matcher',
      );
    };
    const hbTimer = setInterval(() => emitHeartbeat('interval'), HEARTBEAT_MS);
    if (typeof hbTimer.unref === 'function') hbTimer.unref();
    const maybeHeartbeat = (): void => {
      const now = Date.now();
      if (now - hb.lastAt >= HEARTBEAT_MS) emitHeartbeat('inline');
    };

    // (hotspot profiler removed — was responsible for a measured ~+57%
    // matcher regression. Phase timings, heartbeats, and per-pass
    // summaries provide sufficient visibility without per-call overhead.)


    const entries = palette.entries.filter(
      (e) => e.photoId && e.signature.length >= 12,
    );
    if (entries.length === 0) {
      clearInterval(hbTimer);
      return {
        assignments: grid.cells.map(() => ''),
        stats: {
          uniquePhotosUsed: 0,
          maxReusePerPhoto: 0,
          swapsApplied: 0,
          reassignmentsApplied: 0,
        },
      };
    }

    // Sample the cover at 2× cell density so each cell carries a 2×2
    // LAB signature identical in shape to the source-photo signatures.
    const sampleW = grid.cols * 2;
    const sampleH = grid.rows * 2;
    const tCoverSample = Date.now();
    const sampled = await sharp(target, { failOn: 'none' })
      .rotate()
      .resize(sampleW, sampleH, { fit: 'fill', kernel: 'lanczos3' })
      .removeAlpha()
      .raw()
      .toBuffer();
    recordPhase('cover-sample-decode', Date.now() - tCoverSample);

    const cols = grid.cols;
    const rows = grid.rows;
    const totalCells = cols * rows;

    // ===== Numeric indices + flat typed-array storage ==================
    // Every per-photo lookup in the hot path is keyed by a dense integer
    // index (0..N-1) instead of a string photo id. This eliminates ~3B
    // Map<string,…>.get() calls (string hash + bucket walk) and lets us
    // pack all per-photo state into contiguous typed arrays for cache
    // locality. Output is byte-identical: indices preserve entries order,
    // so greedy/swap/reassign iterate in the same sequence as before.
    const N = entries.length;
    const idByIdx = new Array<string>(N);
    const idxById = new Map<string, number>();
    for (let i = 0; i < N; i++) {
      const id = entries[i]!.photoId;
      idByIdx[i] = id;
      idxById.set(id, i);
    }
    // Flat signatures: N rows × SIG_TOTAL floats. Contiguous reads hit
    // one cache line per quadrant; replaces N separate number[] objects.
    const sigsFlat = new Float32Array(N * SIG_TOTAL);
    const sigHasFull = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const sig = entries[i]!.signature;
      const len = sig.length;
      const lim = len < SIG_TOTAL ? len : SIG_TOTAL;
      const base = i * SIG_TOTAL;
      for (let k = 0; k < lim; k++) sigsFlat[base + k] = sig[k]!;
      sigHasFull[i] = len >= SIG_TOTAL ? 1 : 0;
    }

    const targetUses = Math.max(1, totalCells / N);

    // ----- tunables -----
    const USAGE_WEIGHT = 30;
    // Visual similarity (separate from spatial reuse): discourages
    // visually-near-duplicate photos from clustering, even when their
    // photo IDs differ. Penalty smoothly remaps similarity above
    // SIM_THRESHOLD into a quadratic ramp, Gaussian-decayed by distance.
    const SIM_RADIUS = 3;
    const SIM_THRESHOLD = 0.55;
    const SIM_PENALTY_BASE = 2500;
    const SIM_SIGMA = SIM_RADIUS / 2;
    const SIM_TWO_SIGMA_SQ = 2 * SIM_SIGMA * SIM_SIGMA;
    const SIM_LAB_REF = 800; // sigDistance treated as "fully different"
    const CLUSTER_SIM = 0.7; // 4-connected cluster diagnostic threshold
    // Spatial reuse: Gaussian-decay penalty for repeated photos within
    // SPATIAL_RADIUS cells.
    const SPATIAL_RADIUS = 8;
    const SPATIAL_SIGMA = SPATIAL_RADIUS / 2;
    const SPATIAL_TWO_SIGMA_SQ = 2 * SPATIAL_SIGMA * SPATIAL_SIGMA;
    const SPATIAL_WEIGHT_BASE = 8000;

    // Luminance weighting: emphasize L* over chroma (wL=2, wa=1, wb=1).
    const W_L = 2;
    const W_A = 1;
    const W_B = 1;

    // Pre-compute target 2×2 LAB per cell (12 floats per cell).
    const tTargetLabs = Date.now();
    const targetLabs: Float64Array = new Float64Array(totalCells * 12);
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const cellIdx = cy * cols + cx;
        for (let qy = 0; qy < 2; qy++) {
          for (let qx = 0; qx < 2; qx++) {
            const sx = cx * 2 + qx;
            const sy = cy * 2 + qy;
            const p = (sy * sampleW + sx) * 3;
            const lab = rgbToLab(sampled[p]!, sampled[p + 1]!, sampled[p + 2]!);
            const q = qy * 2 + qx;
            targetLabs[cellIdx * 12 + q * 3] = lab[0]!;
            targetLabs[cellIdx * 12 + q * 3 + 1] = lab[1]!;
            targetLabs[cellIdx * 12 + q * 3 + 2] = lab[2]!;
          }
        }
      }
    }
    recordPhase('target-lab-precompute', Date.now() - tTargetLabs, { cells: totalCells });

    // Per-photo dense state ----------------------------------------------
    const usageArr = new Int32Array(N); // count of placements per photo
    // positionsArr[photoIdx] is the set of cell indices currently holding
    // that photo. Allocated lazily on first placement to avoid N empty
    // Sets when only a fraction of the palette ever gets used.
    const positionsArr: Array<Set<number> | undefined> = new Array(N);
    // Per-cell photo index. -1 = unassigned. Int32Array → no boxing,
    // and reads/writes are bounded by V8's SMI fast path.
    const assignmentsIdx = new Int32Array(totalCells);
    assignmentsIdx.fill(-1);

    const addPosition = (photoIdx: number, idx: number): void => {
      let s = positionsArr[photoIdx];
      if (!s) {
        s = new Set<number>();
        positionsArr[photoIdx] = s;
      }
      s.add(idx);
    };
    const removePosition = (photoIdx: number, idx: number): void => {
      const s = positionsArr[photoIdx];
      if (s) s.delete(idx);
    };

    // --- helpers --------------------------------------------------------
    // Adaptive reuse penalty: ramp grows with how over-used a photo
    // already is relative to its fair share.
    const usagePenaltyRaw = (count: number): number => {
      if (count <= 0) return 0;
      const ratio = count / targetUses;
      const over = count - targetUses * 0.5;
      const overPos = over > 0 ? over : 0;
      const adaptive = 1 + ratio * ratio;
      return (count * USAGE_WEIGHT + overPos * overPos * USAGE_WEIGHT) * adaptive;
    };
    const usagePenalty = (count: number): number => usagePenaltyRaw(count);
    const usageMarginalCost = (count: number): number =>
      usagePenaltyRaw(count + 1) - usagePenaltyRaw(count);

    // Luminance-weighted squared ΔE summed over the 4 quadrants, reading
    // from the flat signature array (no number[] indirection).
    const sigDistanceIdxFlat = (aIdx: number, bIdx: number): number => {
      const ao = aIdx * SIG_TOTAL;
      const bo = bIdx * SIG_TOTAL;
      let d = 0;
      for (let q = 0; q < 4; q++) {
        const off = q * 3;
        const dL = sigsFlat[ao + off]! - sigsFlat[bo + off]!;
        const dA = sigsFlat[ao + off + 1]! - sigsFlat[bo + off + 1]!;
        const dB = sigsFlat[ao + off + 2]! - sigsFlat[bo + off + 2]!;
        d += W_L * dL * dL + W_A * dA * dA + W_B * dB * dB;
      }
      return d;
    };

    const colorCost = (cellIdx: number, photoIdx: number): number => {
      if (photoIdx < 0) return Number.POSITIVE_INFINITY;
      const so = photoIdx * SIG_TOTAL;
      const co = cellIdx * 12;
      let d = 0;
      for (let q = 0; q < 4; q++) {
        const off = q * 3;
        const dL = sigsFlat[so + off]! - targetLabs[co + off]!;
        const dA = sigsFlat[so + off + 1]! - targetLabs[co + off + 1]!;
        const dB = sigsFlat[so + off + 2]! - targetLabs[co + off + 2]!;
        d += W_L * dL * dL + W_A * dA * dA + W_B * dB * dB;
      }
      return d;
    };

    // Gaussian-decayed spatial penalty: iterate the cell-index Set for
    // this photo (insertion-order preserved, identical to old Map<id,Set>).
    // Exact Math.exp lookup tables (dSq is always an integer in range),
    // computed with the identical expression → bit-identical values.
    const SPATIAL_EXP = new Float64Array(2 * SPATIAL_RADIUS * SPATIAL_RADIUS + 1);
    for (let d = 0; d < SPATIAL_EXP.length; d++) SPATIAL_EXP[d] = Math.exp(-d / SPATIAL_TWO_SIGMA_SQ);
    const SIM_EXP = new Float64Array(2 * SIM_RADIUS * SIM_RADIUS + 1);
    for (let d = 0; d < SIM_EXP.length; d++) SIM_EXP[d] = Math.exp(-d / SIM_TWO_SIGMA_SQ);
    // Above this reuse count, scanning the fixed (2R+1)² window is cheaper
    // than walking every placement of the photo.
    const SPATIAL_WINDOW_THRESHOLD = (2 * SPATIAL_RADIUS + 1) * (2 * SPATIAL_RADIUS + 1);

    const spatialReusePenalty = (
      idx: number,
      photoIdx: number,
      ignoreIdx: number,
    ): number => {
      const s = positionsArr[photoIdx];
      if (!s || s.size === 0) return 0;
      const r = (idx / cols) | 0;
      const c = idx - r * cols;
      let p = 0;
      if (s.size > SPATIAL_WINDOW_THRESHOLD) {
        // Exact local-window scan over assignmentsIdx (same cells, same
        // distances, same formula as the Set path; only sum order differs).
        const r0 = r - SPATIAL_RADIUS < 0 ? 0 : r - SPATIAL_RADIUS;
        const r1 = r + SPATIAL_RADIUS > rows - 1 ? rows - 1 : r + SPATIAL_RADIUS;
        const c0 = c - SPATIAL_RADIUS < 0 ? 0 : c - SPATIAL_RADIUS;
        const c1 = c + SPATIAL_RADIUS > cols - 1 ? cols - 1 : c + SPATIAL_RADIUS;
        for (let rr = r0; rr <= r1; rr++) {
          const rowBase = rr * cols;
          const dy = rr - r;
          const dy2 = dy * dy;
          for (let cc = c0; cc <= c1; cc++) {
            const other = rowBase + cc;
            if (other === idx || other === ignoreIdx) continue;
            if (assignmentsIdx[other] !== photoIdx) continue;
            const dx = cc - c;
            p += SPATIAL_WEIGHT_BASE * SPATIAL_EXP[dx * dx + dy2]!;
          }
        }
        return p;
      }
      for (const other of s) {
        if (other === idx || other === ignoreIdx) continue;
        const rr = (other / cols) | 0;
        const cc = other - rr * cols;
        const dx = cc - c;
        const dy = rr - r;
        const adx = dx < 0 ? -dx : dx;
        const ady = dy < 0 ? -dy : dy;
        const dCheb = adx > ady ? adx : ady;
        if (dCheb > SPATIAL_RADIUS) continue;
        const dSq = dx * dx + dy * dy;
        p += SPATIAL_WEIGHT_BASE * SPATIAL_EXP[dSq]!;
      }
      return p;
    };

    // --- Visual similarity (flat N×N matrix, lazy fill) ----------------
    // Replaces the previous Map<string,number> simCache. Sentinel = -1
    // (similarity is always in [0,1]); fill on miss, never invalidated.
    // For N=2000 this is 16MB; large-N users see proportional RAM growth
    // but Map-of-strings was already O(N²) worst case in practice.
    const popcount32 = (v: number): number => {
      let x = v >>> 0;
      x = x - ((x >>> 1) & 0x55555555);
      x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
      x = (x + (x >>> 4)) & 0x0f0f0f0f;
      return Math.imul(x, 0x01010101) >>> 24;
    };
    const simMatrix = new Float32Array(N * N);
    simMatrix.fill(-1);
    let simCacheHits = 0;
    let simCacheMisses = 0;
    const photoSimilarityIdx = (aIdx: number, bIdx: number): number => {
      if (aIdx === bIdx) return 1;
      const key = aIdx * N + bIdx;
      const cached = simMatrix[key]!;
      if (cached >= 0) {
        simCacheHits++;
        return cached;
      }
      simCacheMisses++;
      const labD = sigDistanceIdxFlat(aIdx, bIdx);
      const labSim = Math.max(0, 1 - labD / SIM_LAB_REF);
      let histSim = labSim;
      let hashSim = labSim;
      if (sigHasFull[aIdx]! === 1 && sigHasFull[bIdx]! === 1) {
        const ao = aIdx * SIG_TOTAL + SIG_LAB_LEN;
        const bo = bIdx * SIG_TOTAL + SIG_LAB_LEN;
        let inter = 0;
        for (let i = 0; i < HIST_LEN; i++) {
          const av = sigsFlat[ao + i]!;
          const bv = sigsFlat[bo + i]!;
          inter += av < bv ? av : bv;
        }
        histSim = inter / 3;
        const aLo = (sigsFlat[ao + HIST_LEN]! | 0) >>> 0;
        const aHi = (sigsFlat[ao + HIST_LEN + 1]! | 0) >>> 0;
        const bLo = (sigsFlat[bo + HIST_LEN]! | 0) >>> 0;
        const bHi = (sigsFlat[bo + HIST_LEN + 1]! | 0) >>> 0;
        const hamming = popcount32(aLo ^ bLo) + popcount32(aHi ^ bHi);
        hashSim = 1 - hamming / 64;
      }
      const s = labSim * 0.35 + histSim * 0.3 + hashSim * 0.35;
      const clamped = s < 0 ? 0 : s > 1 ? 1 : s;
      // Symmetric: write both [a,b] and [b,a] so neither direction misses.
      simMatrix[key] = clamped;
      simMatrix[bIdx * N + aIdx] = clamped;
      return clamped;
    };

    let simPenaltyApplications = 0;
    // Visual-similarity neighbour penalty: penalize placing a candidate
    // that is visually close to a *different* photo already nearby.
    const visualSimilarityPenalty = (
      idx: number,
      photoIdx: number,
      ignoreIdx: number,
    ): number => {
      const r = (idx / cols) | 0;
      const c = idx - r * cols;
      let p = 0;
      const r0 = r - SIM_RADIUS < 0 ? 0 : r - SIM_RADIUS;
      const r1 = r + SIM_RADIUS > rows - 1 ? rows - 1 : r + SIM_RADIUS;
      const c0 = c - SIM_RADIUS < 0 ? 0 : c - SIM_RADIUS;
      const c1 = c + SIM_RADIUS > cols - 1 ? cols - 1 : c + SIM_RADIUS;
      for (let rr = r0; rr <= r1; rr++) {
        const rowBase = rr * cols;
        const dy = rr - r;
        const dy2 = dy * dy;
        for (let cc = c0; cc <= c1; cc++) {
          const ni = rowBase + cc;
          if (ni === idx || ni === ignoreIdx) continue;
          const other = assignmentsIdx[ni]!;
          if (other < 0 || other === photoIdx) continue;
          const sim = photoSimilarityIdx(photoIdx, other);
          if (sim <= SIM_THRESHOLD) continue;
          const t = (sim - SIM_THRESHOLD) / (1 - SIM_THRESHOLD);
          const dx = cc - c;
          const dSq = dx * dx + dy2;
          const decay = SIM_EXP[dSq]!;
          p += SIM_PENALTY_BASE * t * t * decay;
          simPenaltyApplications++;
        }
      }
      return p;
    };

    const cellTotalPenalty = (
      idx: number,
      photoIdx: number,
      ignoreIdx: number,
    ): number =>
      spatialReusePenalty(idx, photoIdx, ignoreIdx) +
      visualSimilarityPenalty(idx, photoIdx, ignoreIdx);

    // Diagnostics helpers (operate on assignmentsIdx).
    const computeAvgNeighborSimilarity = (): number => {
      let sum = 0;
      let pairs = 0;
      for (let i = 0; i < totalCells; i++) {
        const a = assignmentsIdx[i]!;
        if (a < 0) continue;
        const rr = (i / cols) | 0;
        const cc = i - rr * cols;
        if (cc + 1 < cols) {
          const b = assignmentsIdx[i + 1]!;
          if (b >= 0) { sum += photoSimilarityIdx(a, b); pairs++; }
        }
        if (rr + 1 < rows) {
          const b = assignmentsIdx[i + cols]!;
          if (b >= 0) { sum += photoSimilarityIdx(a, b); pairs++; }
        }
      }
      return pairs > 0 ? sum / pairs : 0;
    };
    const computeLargestSimilarityCluster = (): number => {
      const visited = new Uint8Array(totalCells);
      const stack = new Int32Array(totalCells);
      let largest = 0;
      for (let start = 0; start < totalCells; start++) {
        if (visited[start]) continue;
        const sa = assignmentsIdx[start]!;
        if (sa < 0) { visited[start] = 1; continue; }
        visited[start] = 1;
        let size = 1;
        let sp = 0;
        stack[sp++] = start;
        while (sp > 0) {
          const idx = stack[--sp]!;
          const cur = assignmentsIdx[idx]!;
          const rr = (idx / cols) | 0;
          const cc = idx - rr * cols;
          // Inline 4-neighbour visit (no temporary array).
          if (cc + 1 < cols) {
            const ni = idx + 1;
            if (!visited[ni]) {
              const nb = assignmentsIdx[ni]!;
              if (nb >= 0 && photoSimilarityIdx(cur, nb) >= CLUSTER_SIM) {
                visited[ni] = 1; size++; stack[sp++] = ni;
              }
            }
          }
          if (cc > 0) {
            const ni = idx - 1;
            if (!visited[ni]) {
              const nb = assignmentsIdx[ni]!;
              if (nb >= 0 && photoSimilarityIdx(cur, nb) >= CLUSTER_SIM) {
                visited[ni] = 1; size++; stack[sp++] = ni;
              }
            }
          }
          if (rr + 1 < rows) {
            const ni = idx + cols;
            if (!visited[ni]) {
              const nb = assignmentsIdx[ni]!;
              if (nb >= 0 && photoSimilarityIdx(cur, nb) >= CLUSTER_SIM) {
                visited[ni] = 1; size++; stack[sp++] = ni;
              }
            }
          }
          if (rr > 0) {
            const ni = idx - cols;
            if (!visited[ni]) {
              const nb = assignmentsIdx[ni]!;
              if (nb >= 0 && photoSimilarityIdx(cur, nb) >= CLUSTER_SIM) {
                visited[ni] = 1; size++; stack[sp++] = ni;
              }
            }
          }
        }
        if (size > largest) largest = size;
      }
      return largest;
    };

    // --- pass 1: greedy initial assignment -----------------------------
    hb.phase = 'greedy';
    hb.pass = 1;
    hb.cellsDone = 0;
    log.info({ totalCells, palette: N }, 'matcher:greedy:start');
    const tGreedy = Date.now();
    let greedyCandidates = 0;
    let greedyAccepted = 0;
    let greedyLastTick = tGreedy;
    for (let i = 0; i < totalCells; i++) {
      hb.cellsDone = i;
      if ((i & 0x3ff) === 0) maybeHeartbeat();
      if (i > 0 && (i & 2047) === 0) {
        const now = Date.now();
        log.info(
          {
            phase: 'greedy',
            cellsProcessed: i,
            candidateEvaluations: greedyCandidates,
            acceptedAssignments: greedyAccepted,
            elapsedMs: now - tGreedy,
            chunkMs: now - greedyLastTick,
          },
          'matcher:greedy:progress',
        );
        greedyLastTick = now;
      }
      let bestIdx = 0;
      let bestScore = Infinity;
      for (let j = 0; j < N; j++) {
        const used = usageArr[j]!;
        const cCost = colorCost(i, j);
        const uCost = usageMarginalCost(used);
        const pCost = cellTotalPenalty(i, j, -1);
        const score = cCost + uCost + pCost;
        if (score < bestScore) {
          bestScore = score;
          bestIdx = j;
        }
        greedyCandidates++;
      }
      assignmentsIdx[i] = bestIdx;
      usageArr[bestIdx] = usageArr[bestIdx]! + 1;
      addPosition(bestIdx, i);
      greedyAccepted++;
    }
    recordPhase('greedy-assign', Date.now() - tGreedy, {
      cells: totalCells,
      candidates: greedyCandidates,
      acceptedAssignments: greedyAccepted,
    });

    const simBefore = computeAvgNeighborSimilarity();
    const simPenaltyApplicationsAfterGreedy = simPenaltyApplications;

    // --- pass 2: swap optimization -------------------------------------
    let seed = (totalCells * 2654435761) >>> 0;
    const rand = (): number => {
      seed = (seed + 0x6d2b79f5) >>> 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    const SWAP_PASSES = 6;
    const SWAP_LOCAL_RADIUS = 5;
    const SWAP_RANDOM_PARTNERS = 48;
    let totalSwaps = 0;
    let totalSwapCandidates = 0;
    const computeGlobalScore = (): number => {
      let s = 0;
      for (let i = 0; i < totalCells; i++) {
        const p = assignmentsIdx[i]!;
        s += colorCost(i, p) + cellTotalPenalty(i, p, -1);
      }
      return s;
    };
    // Full-grid score is diagnostic-only (never feeds any decision); it is
    // no longer computed per pass on the production path.
    void computeGlobalScore;

    // --- delta-scoring infrastructure ---------------------------------
    const basePen = new Float64Array(totalCells);
    basePen.fill(-1);
    let basePenHits = 0;
    let basePenMisses = 0;
    let basePenInvalidated = 0;
    const getBasePen = (idx: number): number => {
      const v = basePen[idx]!;
      if (v >= 0) {
        basePenHits++;
        return v;
      }
      basePenMisses++;
      const fresh = cellTotalPenalty(idx, assignmentsIdx[idx]!, -1);
      basePen[idx] = fresh;
      return fresh;
    };
    const BASE_PEN_INVALIDATE_R = SIM_RADIUS > SPATIAL_RADIUS ? SIM_RADIUS : SPATIAL_RADIUS;
    const invalidateBasePenAround = (idx: number): void => {
      const rr0 = (idx / cols) | 0;
      const cc0 = idx - rr0 * cols;
      const r0 = rr0 - BASE_PEN_INVALIDATE_R < 0 ? 0 : rr0 - BASE_PEN_INVALIDATE_R;
      const r1 = rr0 + BASE_PEN_INVALIDATE_R > rows - 1 ? rows - 1 : rr0 + BASE_PEN_INVALIDATE_R;
      const c0 = cc0 - BASE_PEN_INVALIDATE_R < 0 ? 0 : cc0 - BASE_PEN_INVALIDATE_R;
      const c1 = cc0 + BASE_PEN_INVALIDATE_R > cols - 1 ? cols - 1 : cc0 + BASE_PEN_INVALIDATE_R;
      for (let rr = r0; rr <= r1; rr++) {
        const rowBase = rr * cols;
        for (let cc = c0; cc <= c1; cc++) {
          const k = rowBase + cc;
          if (basePen[k]! >= 0) {
            basePen[k] = -1;
            basePenInvalidated++;
          }
        }
      }
    };
    // O(1) visual cross-term: contribution that jIdx makes to CTP(iIdx, photoA, -1).
    const visualCross = (
      iIdx: number,
      photoA: number,
      jIdx: number,
      photoB: number,
    ): number => {
      if (photoA === photoB) return 0;
      const ri = (iIdx / cols) | 0;
      const ci = iIdx - ri * cols;
      const rj = (jIdx / cols) | 0;
      const cj = jIdx - rj * cols;
      const dx = cj - ci;
      const dy = rj - ri;
      const adx = dx < 0 ? -dx : dx;
      const ady = dy < 0 ? -dy : dy;
      if (adx > SIM_RADIUS || ady > SIM_RADIUS) return 0;
      const sim = photoSimilarityIdx(photoA, photoB);
      if (sim <= SIM_THRESHOLD) return 0;
      const t = (sim - SIM_THRESHOLD) / (1 - SIM_THRESHOLD);
      const dSq = dx * dx + dy * dy;
      const decay = SIM_EXP[dSq]!;
      return SIM_PENALTY_BASE * t * t * decay;
    };

    // Hoisted out of the per-cell loop: a single function object instead
    // of N×totalCells closure allocations. Monomorphic int signature →
    // V8 keeps it on the optimized tier.
    let _swap_i = 0;
    let _swap_photoA = 0;
    let _swap_passSwaps = 0;
    let _swap_passCandidates = 0;
    let _swap_passRejects = 0;
    let _swap_passSumDelta = 0;
    let _swap_passBestDelta = 0;
    let _swap_passWorstDelta = 0;
    const tryPartner = (j: number): boolean => {
      _swap_passCandidates++;
      const i = _swap_i;
      if (j === i) return false;
      const photoA = _swap_photoA;
      const photoB = assignmentsIdx[j]!;
      if (photoA === photoB) return false;

      const oldColor = colorCost(i, photoA) + colorCost(j, photoB);
      const baseI = getBasePen(i);
      const baseJ = getBasePen(j);
      const crossIJ = visualCross(i, photoA, j, photoB);
      const crossJI = visualCross(j, photoB, i, photoA);
      const oldPen = (baseI - crossIJ) + (baseJ - crossJI);

      const newColor = colorCost(i, photoB) + colorCost(j, photoA);
      // No trial Set mutation: with ignore=j / ignore=i, scoring against the
      // unmutated positions yields exactly the same cell set as before
      // (the only differing cells, i and j, are excluded by idx/ignoreIdx).
      const newPen =
        cellTotalPenalty(i, photoB, j) + cellTotalPenalty(j, photoA, i);

      const delta = (newColor + newPen) - (oldColor + oldPen);
      if (delta < 0) {
        assignmentsIdx[i] = photoB;
        assignmentsIdx[j] = photoA;
        removePosition(photoA, i);
        removePosition(photoB, j);
        addPosition(photoA, j);
        addPosition(photoB, i);
        invalidateBasePenAround(i);
        invalidateBasePenAround(j);
        _swap_passSumDelta += delta;
        if (delta < _swap_passBestDelta) _swap_passBestDelta = delta;
        if (delta > _swap_passWorstDelta) _swap_passWorstDelta = delta;
        return true;
      }
      _swap_passRejects++;
      return false;
    };

    for (let pass = 0; pass < SWAP_PASSES; pass++) {
      hb.phase = 'swap';
      hb.pass = pass + 1;
      hb.cellsDone = 0;
      log.info(
        { pass: pass + 1, totalCells, localRadius: SWAP_LOCAL_RADIUS, randomPartners: SWAP_RANDOM_PARTNERS },
        `matcher:swap-pass-${pass + 1}:start`,
      );
      const tSwapPass = Date.now();
      _swap_passSwaps = 0;
      _swap_passCandidates = 0;
      _swap_passRejects = 0;
      _swap_passSumDelta = 0;
      _swap_passBestDelta = 0;
      _swap_passWorstDelta = 0;
      let swapLastTick = tSwapPass;
      let lastTickCandidates = 0;
      let lastTickSwaps = 0;
      for (let i = 0; i < totalCells; i++) {
        hb.cellsDone = i;
        if ((i & 0x3ff) === 0) maybeHeartbeat();
        if (i > 0 && (i & 2047) === 0) {
          const now = Date.now();
          log.info(
            {
              phase: 'swap',
              passNumber: pass + 1,
              cellsProcessed: i,
              pairsScanned: _swap_passCandidates,
              acceptedSwaps: _swap_passSwaps,
              rejectedSwaps: _swap_passRejects,
              elapsedMs: now - tSwapPass,
              chunkMs: now - swapLastTick,
              chunkPairsScanned: _swap_passCandidates - lastTickCandidates,
              chunkAcceptedSwaps: _swap_passSwaps - lastTickSwaps,
            },
            `matcher:swap-pass-${pass + 1}:progress`,
          );
          swapLastTick = now;
          lastTickCandidates = _swap_passCandidates;
          lastTickSwaps = _swap_passSwaps;
        }
        _swap_i = i;
        _swap_photoA = assignmentsIdx[i]!;
        const r = (i / cols) | 0;
        const c = i - r * cols;
        const r0 = r - SWAP_LOCAL_RADIUS < 0 ? 0 : r - SWAP_LOCAL_RADIUS;
        const r1 = r + SWAP_LOCAL_RADIUS > rows - 1 ? rows - 1 : r + SWAP_LOCAL_RADIUS;
        const c0 = c - SWAP_LOCAL_RADIUS < 0 ? 0 : c - SWAP_LOCAL_RADIUS;
        const c1 = c + SWAP_LOCAL_RADIUS > cols - 1 ? cols - 1 : c + SWAP_LOCAL_RADIUS;
        let swapped = false;
        for (let rr = r0; rr <= r1 && !swapped; rr++) {
          const rowBase = rr * cols;
          for (let cc = c0; cc <= c1; cc++) {
            const j = rowBase + cc;
            if (tryPartner(j)) {
              swapped = true;
              _swap_passSwaps++;
              break;
            }
          }
        }
        if (swapped) continue;
        for (let k = 0; k < SWAP_RANDOM_PARTNERS; k++) {
          const j = (rand() * totalCells) | 0;
          if (tryPartner(j)) {
            _swap_passSwaps++;
            break;
          }
        }
      }
      totalSwaps += _swap_passSwaps;
      totalSwapCandidates += _swap_passCandidates;
      const simHits = simCacheHits;
      const simMiss = simCacheMisses;
      const total = simHits + simMiss;
      const passElapsedMs = Date.now() - tSwapPass;
      const acceptanceRatePct = _swap_passCandidates > 0
        ? Math.round((_swap_passSwaps * 10000) / _swap_passCandidates) / 100
        : 0;
      const avgDelta = _swap_passSwaps > 0 ? _swap_passSumDelta / _swap_passSwaps : 0;
      const currentScore = null;
      const scoreImprovementFromPreviousPass = null;
      const scoreImprovementPct = null;
      const basePenTotal = basePenHits + basePenMisses;
      const basePenHitRatioPct = basePenTotal > 0
        ? Math.round((basePenHits * 10000) / basePenTotal) / 100
        : 0;
      log.info(
        {
          phase: 'swap',
          passNumber: pass + 1,
          scannedCandidates: _swap_passCandidates,
          acceptedSwaps: _swap_passSwaps,
          rejectedSwaps: _swap_passRejects,
          acceptanceRatePct,
          averageDeltaImprovement: avgDelta,
          bestDelta: _swap_passBestDelta,
          worstDelta: _swap_passWorstDelta,
          totalDeltaImprovement: _swap_passSumDelta,
          currentScore,
          scoreImprovementFromPreviousPass,
          scoreImprovementPct,
          basePenHits,
          basePenMisses,
          basePenInvalidated,
          basePenHitRatioPct,
          elapsedMs: passElapsedMs,
        },
        `matcher:swap-pass-${pass + 1}:summary`,
      );
      recordPhase(`swap-pass-${pass + 1}`, passElapsedMs, {
        cells: totalCells,
        candidates: _swap_passCandidates,
        acceptedSwaps: _swap_passSwaps,
        rejectedSwaps: _swap_passRejects,
        acceptanceRatePct,
        averageDeltaImprovement: avgDelta,
        bestDelta: _swap_passBestDelta,
        worstDelta: _swap_passWorstDelta,
        simCacheHitRatioPct: total > 0 ? Math.round((simHits * 10000) / total) / 100 : 0,
      });
      if (_swap_passSwaps === 0) break;
    }

    // --- pass 3: reassignment from perceptual shortlist ----------------
    // Parallel typed arrays (no per-cell {id,d} object allocations).
    // Sort a Uint32Array of indices via Array.prototype.sort (which is
    // stable in V8); ties broken by original entries index so output
    // is identical to the previous {id,d}-object stable sort.
    const SHORTLIST = N < 64 ? N : 64;
    const REASSIGN_PASSES = 3;
    const DIVERSITY_BAND = 0.05;
    let totalReassign = 0;
    let totalReassignCandidates = 0;
    // Scratch buffers reused across cells/passes — no allocation in loop.
    const distsAll = new Float64Array(N);
    const orderAll: number[] = new Array(N);
    for (let j = 0; j < N; j++) orderAll[j] = j;
    for (let pass = 0; pass < REASSIGN_PASSES; pass++) {
      hb.phase = 'reassign';
      hb.pass = pass + 1;
      hb.cellsDone = 0;
      log.info(
        { pass: pass + 1, totalCells, shortlist: SHORTLIST, diversityBand: DIVERSITY_BAND },
        `matcher:reassign-pass-${pass + 1}:start`,
      );
      const tReassignPass = Date.now();
      let passChanges = 0;
      let passCandidates = 0;
      for (let i = 0; i < totalCells; i++) {
        hb.cellsDone = i;
        if ((i & 0xff) === 0) maybeHeartbeat();
        const currentId = assignmentsIdx[i]!;
        const currentUses = usageArr[currentId]!;
        const currentColor = colorCost(i, currentId);
        const currentPen = cellTotalPenalty(i, currentId, -1);
        const currentUsageDelta =
          usagePenaltyRaw(currentUses) - usagePenaltyRaw(currentUses - 1);
        const currentTotal = currentColor + currentPen + currentUsageDelta;

        // Compute color distance for every photo into a flat typed array.
        for (let j = 0; j < N; j++) {
          distsAll[j] = colorCost(i, j);
          orderAll[j] = j;
        }
        // Stable sort of indices by distance, ties broken by index.
        orderAll.sort((a, b) => {
          const da = distsAll[a]!;
          const db = distsAll[b]!;
          if (da !== db) return da - db;
          return a - b;
        });
        const limit = SHORTLIST < N ? SHORTLIST : N;
        const bestD = distsAll[orderAll[0]!]!;
        const bandCutoff = bestD * (1 + DIVERSITY_BAND);
        // Second sort within the shortlist window only (in-place on the
        // first `limit` entries). Same comparator semantics as before:
        // inside the band, prefer lower usage; ties fall back to distance,
        // then to entries index for full determinism.
        const shortIdx = orderAll.slice(0, limit);
        shortIdx.sort((a, b) => {
          const da = distsAll[a]!;
          const db = distsAll[b]!;
          const aIn = da <= bandCutoff;
          const bIn = db <= bandCutoff;
          if (aIn && bIn) {
            const ua = usageArr[a]!;
            const ub = usageArr[b]!;
            if (ua !== ub) return ua - ub;
          }
          if (da !== db) return da - db;
          return a - b;
        });

        let bestId = currentId;
        let bestTotal = currentTotal;
        for (let k = 0; k < limit; k++) {
          const candIdx = shortIdx[k]!;
          if (candIdx === currentId) continue;
          passCandidates++;
          const candUses = usageArr[candIdx]!;
          const candColor = distsAll[candIdx]!;
          removePosition(currentId, i);
          const candPen = cellTotalPenalty(i, candIdx, -1);
          addPosition(currentId, i);
          const candUsageDelta =
            usagePenaltyRaw(candUses + 1) - usagePenaltyRaw(candUses);
          const candTotal = candColor + candPen + candUsageDelta;
          if (candTotal < bestTotal) {
            bestTotal = candTotal;
            bestId = candIdx;
          }
        }

        if (bestId !== currentId) {
          assignmentsIdx[i] = bestId;
          usageArr[currentId] = currentUses - 1;
          usageArr[bestId] = usageArr[bestId]! + 1;
          removePosition(currentId, i);
          addPosition(bestId, i);
          passChanges++;
        }
      }
      totalReassign += passChanges;
      totalReassignCandidates += passCandidates;
      recordPhase(`reassign-pass-${pass + 1}`, Date.now() - tReassignPass, {
        cells: totalCells,
        candidates: passCandidates,
        acceptedReassignments: passChanges,
      });
      if (passChanges === 0) break;
    }

    // --- diagnostics ----------------------------------------------------
    let uniqueUsed = 0;
    let maxUse = 0;
    for (let j = 0; j < N; j++) {
      const v = usageArr[j]!;
      if (v > 0) uniqueUsed++;
      if (v > maxUse) maxUse = v;
    }
    const avgReuse = uniqueUsed > 0 ? totalCells / uniqueUsed : 0;

    const histogram: Record<number, number> = {};
    for (let j = 0; j < N; j++) {
      const v = usageArr[j]!;
      if (v <= 0) continue;
      histogram[v] = (histogram[v] ?? 0) + 1;
    }

    let avgRepeatDistance = 0;
    {
      let photosCounted = 0;
      let sumPerPhotoAvg = 0;
      for (let j = 0; j < N; j++) {
        const positionsOf = positionsArr[j];
        if (!positionsOf || positionsOf.size < 2) continue;
        const arr = Array.from(positionsOf);
        const cap = arr.length < 32 ? arr.length : 32;
        let pairs = 0;
        let sum = 0;
        for (let a = 0; a < cap; a++) {
          const ia = arr[a]!;
          const ra = (ia / cols) | 0;
          const ca = ia - ra * cols;
          for (let b = a + 1; b < cap; b++) {
            const ib = arr[b]!;
            const rb = (ib / cols) | 0;
            const cb = ib - rb * cols;
            const drr = ra - rb;
            const dcc = ca - cb;
            const adr = drr < 0 ? -drr : drr;
            const adc = dcc < 0 ? -dcc : dcc;
            sum += adr > adc ? adr : adc;
            pairs++;
          }
        }
        if (pairs > 0) {
          sumPerPhotoAvg += sum / pairs;
          photosCounted++;
        }
      }
      if (photosCounted > 0) avgRepeatDistance = sumPerPhotoAvg / photosCounted;
    }

    const tDiag = Date.now();
    const simAfter = computeAvgNeighborSimilarity();
    const largestSimilarityCluster = computeLargestSimilarityCluster();
    const simReduction = simBefore - simAfter;
    recordPhase('diagnostics', Date.now() - tDiag);

    const matcherElapsedMs = Date.now() - tMatcherStart;
    const simCacheTotal = simCacheHits + simCacheMisses;
    log.info(
      {
        cells: totalCells,
        palette: N,
        uniquePhotosUsed: uniqueUsed,
        maxReusePerPhoto: maxUse,
        avgReusePerPhoto: Number(avgReuse.toFixed(2)),
        avgSpatialDistanceBetweenRepeats: Number(avgRepeatDistance.toFixed(2)),
        reuseHistogram: histogram,
        swapsApplied: totalSwaps,
        swapCandidatesEvaluated: totalSwapCandidates,
        reassignmentsApplied: totalReassign,
        reassignCandidatesEvaluated: totalReassignCandidates,
        avgNeighborSimilarity: Number(simAfter.toFixed(4)),
        avgNeighborSimilarityBeforeOptim: Number(simBefore.toFixed(4)),
        avgNeighborSimilarityReduction: Number(simReduction.toFixed(4)),
        similarityPenaltiesApplied: simPenaltyApplications,
        similarityPenaltiesAppliedDuringGreedy:
          simPenaltyApplicationsAfterGreedy,
        largestSimilarityCluster,
        similarityClusterThreshold: CLUSTER_SIM,
        matcherElapsedMs,
        phaseTimings,
        simCacheHits,
        simCacheMisses,
        simCacheHitRatioPct:
          simCacheTotal > 0
            ? Math.round((simCacheHits * 10000) / simCacheTotal) / 100
            : 0,
      },
      'timing:matcher-total perceptual-lab matching + optimization complete',
    );

    const memFinal = memSnapshot();
    log.info(
      {
        heapUsedMB: memFinal.heapUsedMB,
        heapTotalMB: memFinal.heapTotalMB,
        rssMB: memFinal.rssMB,
      },
      'matcher:memory:final',
    );

    clearInterval(hbTimer);
    // Materialize the public string[] only here — internal hot path used
    // integer indices throughout.
    const assignmentsOut = new Array<string>(totalCells);
    for (let i = 0; i < totalCells; i++) {
      const idx = assignmentsIdx[i]!;
      assignmentsOut[i] = idx >= 0 ? idByIdx[idx]! : '';
    }
    return {
      assignments: assignmentsOut,
      stats: {
        uniquePhotosUsed: uniqueUsed,
        maxReusePerPhoto: maxUse,
        swapsApplied: totalSwaps,
        reassignmentsApplied: totalReassign,
      },
    };
  },
};


/**
 * Real compositor: paints one resized guest photo per grid cell into a
 * single raw RGB canvas, then encodes the canvas into the requested
 * JPEG variants. Each unique photo is resized once and cached.
 */
const tileCompositor: Compositor = {
  name: 'tile-paint@0',
  async composite(
    target,
    grid,
    photos,
    assignments,
    options,
  ): Promise<CompositeOutputs> {
    const log = logger.child({ component: 'compositor' });
    // Render-time tile size is decoupled from the analyzer's grid math.
    // The single-master pipeline renders at RENDER_CELL_PX=120 →
    // ~24000px canvas, which becomes the sole source for DZI + print +
    // preview + thumb.
    const RENDER_CELL_PX = Math.max(8, Math.min(240, options?.renderCellPx ?? 120));
    const PREVIEW_LONGEST = Math.max(
      512,
      Math.min(6000, options?.previewLongestSide ?? 3000),
    );
    const cellW = RENDER_CELL_PX;
    const cellH = RENDER_CELL_PX;
    const canvasW = grid.cols * cellW;
    const canvasH = grid.rows * cellH;
    const total = grid.cells.length;

    const tCompositorStart = Date.now();
    log.info({ canvasW, canvasH, cellPx: RENDER_CELL_PX }, `Canvas: ${canvasW} x ${canvasH}`);
    log.info(
      { cols: grid.cols, rows: grid.rows, total },
      `Grid: ${grid.cols} x ${grid.rows} — ${total} tiles`,
    );

    if (photos.length === 0) {
      throw new Error('compositor: no source photos');
    }

    const photoById = new Map(photos.map((p) => [p.id, p]));
    const tileCache = new Map<string, Buffer>();

    async function tileFor(photoId: string, idx: number): Promise<Buffer> {
      let id = photoId;
      let photo = id ? photoById.get(id) : undefined;
      if (!photo) {
        const fallback = photos[idx % photos.length];
        if (!fallback) {
          throw new Error('compositor: no source photos available for fallback');
        }
        photo = fallback;
        id = photo.id;
      }
      const cached = tileCache.get(id);
      if (cached) return cached;
      const raw = await sharp(photo.buffer, { failOn: 'none' })
        .rotate()
        .resize(cellW, cellH, { fit: 'cover', position: 'centre' })
        .removeAlpha()
        .raw()
        .toBuffer();
      tileCache.set(id, raw);
      return raw;
    }

    // Allocate the canvas as a single raw RGB buffer.
    const canvas = Buffer.alloc(canvasW * canvasH * 3);
    const stride = canvasW * 3;
    const cellStride = cellW * 3;

    for (let i = 0; i < total; i++) {
      const cell = grid.cells[i];
      if (!cell) continue;
      const col = i % grid.cols;
      const row = Math.floor(i / grid.cols);
      const destX = col * cellW;
      const destY = row * cellH;
      const assignedId = assignments.assignments[i] ?? '';
      const tile = await tileFor(assignedId, i);
      const baseDest = destY * stride + destX * 3;
      for (let y = 0; y < cellH; y++) {
        tile.copy(
          canvas,
          baseDest + y * stride,
          y * cellStride,
          y * cellStride + cellStride,
        );
      }
      if ((i + 1) % 1000 === 0 || i === 0 || i === total - 1) {
        log.info(
          { i: i + 1, total, uniqueTiles: tileCache.size },
          `Rendering tile ${i + 1}/${total}`,
        );
      }
    }

    log.info({ uniqueTiles: tileCache.size }, 'Composite finished');

    // --- Cover overlay (soft light @ 10%) -----------------------------------
    try {
      const coverRaw = await sharp(target, { failOn: 'none' })
        .rotate()
        .resize(canvasW, canvasH, { fit: 'cover', position: 'centre' })
        .blur(1)
        .removeAlpha()
        .raw()
        .toBuffer();
      if (coverRaw.length === canvas.length) {
        const alpha = 0.1;
        const len = canvas.length;
        for (let i = 0; i < len; i++) {
          const a = canvas[i]! / 255;
          const b = coverRaw[i]! / 255;
          let s: number;
          if (b <= 0.5) {
            s = a - (1 - 2 * b) * a * (1 - a);
          } else {
            const d = a <= 0.25 ? ((16 * a - 12) * a + 4) * a : Math.sqrt(a);
            s = a + (2 * b - 1) * (d - a);
          }
          const out = a * (1 - alpha) + s * alpha;
          canvas[i] = out <= 0 ? 0 : out >= 1 ? 255 : Math.round(out * 255);
        }
        log.info('Cover overlay applied (soft-light @ 10%)');
      } else {
        log.warn('Cover overlay skipped: size mismatch');
      }
    } catch (err) {
      log.warn({ err: (err as Error).message }, 'Cover overlay failed; continuing without');
    }

    const base = () =>
      // 24k master canvas (e.g. 24000x16000 = 384MP) intentionally exceeds
      // Sharp's default input safety limit; disable it for this one pipeline.
      sharp(canvas, {
        raw: { width: canvasW, height: canvasH, channels: 3 },
        limitInputPixels: false,
      });

    // --- Master PNG (lossless, size-optimized) ------------------------------
    // The only artifact persisted to /tmp. compressionLevel 9 +
    // adaptive filtering + palette:false keeps it lossless while
    // squeezing zlib as hard as Sharp will go. `effort: 10` (webp-style
    // effort knob available on libpng builds) is ignored gracefully
    // when unsupported.
    const tPng = Date.now();
    const masterPng = await base()
      .png({ compressionLevel: 9, adaptiveFiltering: true, palette: false, effort: 10 })
      .toBuffer();
    const masterMeta = await sharp(masterPng, { limitInputPixels: false }).metadata();
    log.info(
      {
        stage: 'master-png:generated',
        width: masterMeta.width,
        height: masterMeta.height,
        bytes: masterPng.length,
        format: masterMeta.format,
        encodeMs: Date.now() - tPng,
      },
      'master-png:generated',
    );

    // --- Preview WebP (~3000px longest side, quality 90) --------------------
    const previewW =
      canvasW >= canvasH
        ? Math.min(PREVIEW_LONGEST, canvasW)
        : Math.round(Math.min(PREVIEW_LONGEST, canvasH) * (canvasW / canvasH));
    const tPrev = Date.now();
    const previewWebp = await base()
      .resize({ width: previewW, withoutEnlargement: true })
      .webp({ quality: 90, effort: 4 })
      .toBuffer();
    // Explicit pre-upload audit: dims/size/mime — proves the buffer we
    // ship to Storage is the ~3000px WebP, not a thumbnail.
    const previewMeta = await sharp(previewWebp).metadata();
    log.info(
      {
        stage: 'preview-webp:pre-upload',
        width: previewMeta.width,
        height: previewMeta.height,
        bytes: previewWebp.length,
        format: previewMeta.format,
        mimeType: 'image/webp',
        encodeMs: Date.now() - tPrev,
      },
      'preview-webp:generated',
    );

    // --- Thumb (JPEG, lightweight fallback) ---------------------------------
    const tThumb = Date.now();
    const thumb = await base()
      .resize({ width: 480, withoutEnlargement: true })
      .jpeg({ quality: 75, mozjpeg: true })
      .toBuffer();
    const thumbMeta = await sharp(thumb).metadata();
    log.info(
      {
        stage: 'thumb-jpg:generated',
        width: thumbMeta.width,
        height: thumbMeta.height,
        bytes: thumb.length,
        format: thumbMeta.format,
        mimeType: 'image/jpeg',
        encodeMs: Date.now() - tThumb,
      },
      'thumb-jpg:generated',
    );

    log.info(
      {
        masterPngBytes: masterPng.length,
        previewWebpBytes: previewWebp.length,
        thumbBytes: thumb.length,
        elapsedMs: Date.now() - tCompositorStart,
      },
      'timing:compositor-total',
    );
    return { masterPng, previewWebp, thumb };
  },
};



/**
 * Real Deep Zoom pyramid built with Sharp's `dz` tile layout.
 *
 * Output structure under the `mosaics` bucket:
 *   {eventId}/{mosaicId}/dzi.dzi              (XML manifest)
 *   {eventId}/{mosaicId}/dzi_files/{lvl}/{c}_{r}.jpg
 *
 * OpenSeadragon receives the manifest URL as its tileSource and derives
 * tile URLs from the sibling `dzi_files/` directory. The storage bucket
 * must allow public SELECT on these paths (see migrations-external).
 */
async function walkFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    const entries = await fs.readdir(cur, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile()) out.push(full);
    }
  }
  return out;
}

const sharpDeepZoom: DeepZoomBuilder = {
  name: 'sharp-dz@1',
  async build(fullImage, ctx): Promise<DeepZoomOutput> {
    const log = logger.child({
      component: 'deepzoom',
      eventId: ctx.eventId,
      mosaicId: ctx.mosaicId,
    });
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), `dzi-${ctx.mosaicId}-`));
    // Sharp emits `${base}.dzi` + `${base}_files/` when layout='dz'.
    const base = path.join(tmp, 'dzi');
    try {
      log.info('DZI pyramid: build start');
      const tDziPyramid = Date.now();
      await sharp(fullImage, { failOn: 'none', limitInputPixels: false })
        .jpeg({ quality: 90, mozjpeg: true, chromaSubsampling: '4:4:4' })
        .tile({ size: 256, overlap: 1, layout: 'dz' })
        .toFile(base);

      log.info({ elapsedMs: Date.now() - tDziPyramid }, 'timing:dzi-pyramid-generate');

      const manifestSrc = `${base}.dzi`;
      const filesDir = `${base}_files`;
      const manifestBody = await fs.readFile(manifestSrc);

      const sb = getSupabase();
      const bucket = config.SUPABASE_STORAGE_BUCKET;
      const manifestPath = `${ctx.eventId}/${ctx.mosaicId}/dzi.dzi`;

      // 1. Upload the .dzi manifest.
      {
        const { error } = await sb.storage
          .from(bucket)
          .upload(manifestPath, manifestBody, {
            contentType: 'application/xml',
            upsert: true,
            cacheControl: '31536000, immutable',
          });
        if (error) throw new Error(`dzi manifest upload: ${error.message}`);
      }

      // 2. Upload every tile under dzi_files/.
      const tileFiles = await walkFiles(filesDir);
      log.info({ tiles: tileFiles.length }, 'DZI pyramid: uploading tiles');
      const tDziUpload = Date.now();

      const CONCURRENCY = 2;
      let cursor = 0;
      let uploaded = 0;
      const tilePrefix = `${ctx.eventId}/${ctx.mosaicId}/dzi_files/`;

      async function tileWorker() {
        while (true) {
          const i = cursor++;
          if (i >= tileFiles.length) return;
          const f = tileFiles[i]!;
          const rel = path.relative(filesDir, f).split(path.sep).join('/');
          const dest = `${tilePrefix}${rel}`;
          const body = await fs.readFile(f);
          const ext = path.extname(f).toLowerCase();
          const contentType =
            ext === '.png'
              ? 'image/png'
              : ext === '.webp'
                ? 'image/webp'
                : 'image/jpeg';
          const { error } = await sb.storage.from(bucket).upload(dest, body, {
            contentType,
            upsert: true,
            cacheControl: '31536000, immutable',
          });
          if (error) throw new Error(`dzi tile ${rel}: ${error.message}`);
          uploaded++;
          if (uploaded % 200 === 0) {
            log.info({ uploaded, total: tileFiles.length }, 'DZI tiles progress');
          }
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, tileFiles.length) }, tileWorker),
      );
      log.info(
        { uploaded, elapsedMs: Date.now() - tDziUpload },
        'timing:dzi-upload-total DZI pyramid: upload complete',
      );

      const { data: pubManifest } = sb.storage.from(bucket).getPublicUrl(manifestPath);
      const { data: pubBase } = sb.storage.from(bucket).getPublicUrl(tilePrefix);

      return {
        manifestUrl: pubManifest.publicUrl,
        tileBaseUrl: pubBase.publicUrl,
      };
    } finally {
      await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
  },
};

export const defaultAlgorithmSuite: AlgorithmSuite = {
  analyzer: gridAnalyzer,
  palette: meanLabPalette,
  matcher: perceptualMatcher,
  compositor: tileCompositor,
  deepZoom: sharpDeepZoom,
};


/**
 * Tiny registry so a future job can opt into a different suite (e.g.
 * "print-quality") without conditionals scattered through the pipeline.
 */
const suites = new Map<string, AlgorithmSuite>([['default', defaultAlgorithmSuite]]);

export function registerSuite(name: string, suite: AlgorithmSuite) {
  suites.set(name, suite);
}

export function getSuite(name = 'default'): AlgorithmSuite {
  const suite = suites.get(name);
  if (!suite) throw new Error(`Unknown algorithm suite: ${name}`);
  return suite;
}
