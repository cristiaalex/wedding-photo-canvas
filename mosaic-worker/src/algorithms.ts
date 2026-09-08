/**
 * Stable algorithm interfaces.
 *
 * These contracts are the *extension points* for Sprint 6B and beyond.
 * Every advanced algorithm we have on the roadmap plugs into one of these
 * without changing the worker, queue, progress service, or storage layer:
 *
 *   - LAB matching          → PaletteBuilder + TileMatcher
 *   - KD-tree NN search     → TileMatcher
 *   - Adaptive Density      → GridAnalyzer (cell sizing)
 *   - Entropy Maps          → GridAnalyzer (per-cell entropy)
 *   - Saliency Maps         → GridAnalyzer (per-cell saliency)
 *   - Edge Preservation     → GridAnalyzer (edge mask) + Compositor weighting
 *   - Deep Zoom             → DeepZoomBuilder
 *   - Print Quality         → Compositor (output variant)
 *
 * The current worker ships **identity / stub** implementations of these
 * interfaces so the end-to-end flow works. Real implementations are added
 * later — purely additive, no signature changes.
 */

import type { CheckpointName } from './lib/checkpoints';

export interface SourcePhoto {
  id: string;
  /** Original upload image_url from the uploads row; usually a photos-bucket storage path. */
  imageUrl?: string;
  buffer: Buffer;
  width: number;
  height: number;
}

export interface TileCell {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Reserved for adaptive density / entropy / saliency / edge weights. */
  weights?: {
    entropy?: number;
    saliency?: number;
    edge?: number;
    density?: number;
  };
}

export interface TileGrid {
  cols: number;
  rows: number;
  cells: TileCell[];
  /** Width/height of the source mosaic-target image in pixels. */
  targetWidth: number;
  targetHeight: number;
}

export interface Palette {
  /** Per-photo color signature. The shape is opaque to callers. */
  entries: ReadonlyArray<{ photoId: string; signature: number[] }>;
  /** Color space label, e.g. "lab" or "srgb-mean". */
  space: string;
}

export interface MatchStats {
  /** Number of distinct source photos placed on the canvas. */
  uniquePhotosUsed: number;
  /** Largest number of times any single photo was reused. */
  maxReusePerPhoto: number;
  /** Total successful swap operations across all optimization passes. */
  swapsApplied: number;
  /** Total successful reassignment operations across all passes. */
  reassignmentsApplied: number;
}

export interface MatchResult {
  /** Same length & order as `grid.cells`. Each value is a SourcePhoto.id. */
  assignments: string[];
  /** Optional matcher quality stats — exposed for observability. */
  stats?: MatchStats;
}

/**
 * Single-master compositor output.
 *
 * The compositor renders the ~24k canvas ONCE and returns every artifact
 * derived from that single canvas in one shot:
 *
 *   - `masterPng`  — lossless PNG of the canvas. The one and only file
 *                    the pipeline persists to /tmp. Consumed by Job B
 *                    (Deep Zoom pyramid) and Job C (print JPEG encode).
 *   - `previewWebp`— ~3000px longest-side WebP (quality 90). Primary
 *                    visual for dashboard cards, loading states, mosaic
 *                    overview pages. Uploaded directly by Job A.
 *   - `thumb`      — ~480px JPEG. Lightweight fallback only.
 *
 * There is no separate "print" / "full" / "preview JPEG" buffer — those
 * are all derived from `masterPng` downstream when needed.
 */
export interface CompositeOutputs {
  masterPng: Buffer;
  previewWebp: Buffer;
  thumb: Buffer;
}


export interface DeepZoomOutput {
  /** Public or signed URL of the .dzi manifest. */
  manifestUrl: string;
  /** Public or signed URL prefix where tile files live. */
  tileBaseUrl: string;
}

// --- Pluggable algorithm contracts ----------------------------------------

export interface GridAnalyzer {
  readonly name: string;
  analyze(target: Buffer): Promise<TileGrid>;
}

export interface PaletteBuilder {
  readonly name: string;
  build(photos: SourcePhoto[]): Promise<Palette>;
}

export interface TileMatcher {
  readonly name: string;
  match(target: Buffer, grid: TileGrid, palette: Palette): Promise<MatchResult>;
}

export interface CompositorOptions {
  /**
   * Override the per-cell render resolution (default 60px). The
   * single-master pipeline renders at 120px → ~24000px wide.
   */
  renderCellPx?: number;
  /**
   * Longest-side (px) of the WebP preview derived from the canvas.
   * Defaults to 3000. Quality is fixed at 90.
   */
  previewLongestSide?: number;
}

export interface Compositor {
  readonly name: string;
  composite(
    target: Buffer,
    grid: TileGrid,
    photos: SourcePhoto[],
    assignments: MatchResult,
    options?: CompositorOptions,
  ): Promise<CompositeOutputs>;
}

export interface DeepZoomBuilder {
  readonly name: string;
  build(fullImage: Buffer, ctx: { eventId: string; mosaicId: string }): Promise<DeepZoomOutput>;
}

/**
 * Bundle of algorithms used for one job. The orchestrator receives this
 * via a registry (see `algorithms/registry.ts`) — swap any field to swap
 * the algorithm without touching the pipeline.
 */
export interface AlgorithmSuite {
  analyzer: GridAnalyzer;
  palette: PaletteBuilder;
  matcher: TileMatcher;
  compositor: Compositor;
  deepZoom: DeepZoomBuilder;
}

/** Map of checkpoint → algorithm name that produced it (for observability). */
export type CheckpointProducerMap = Partial<Record<CheckpointName, string>>;
