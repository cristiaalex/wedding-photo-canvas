/**
 * @deprecated — SINGLE-MASTER PIPELINE (July 2026)
 *
 * The old "generate-print" job re-rendered the mosaic at 24k in a
 * separate pass. It has been superseded by Job A + Job C:
 *
 *   - Job A (`generate-mosaic`) renders the 24k master ONCE and writes
 *     it to `/tmp` (see `master-file.ts`).
 *   - Job C (`upload-print`) uploads that same file verbatim as the
 *     print variant. No second render, no matcher, no compositor.
 *
 * This module is intentionally left in the tree — DO NOT DELETE — so it
 * can be brought back for future Premium features that legitimately do
 * need a distinct print render, such as:
 *
 *   - regenerating the print at a different DPI or paper size
 *   - canvas / poster / metal export presets
 *   - watermarked "sample" print previews
 *   - re-issuing a print after the source album grew
 *
 * When you revive it, register it in `src/queue/queue.ts`
 * (`JobPayloadMap`) and `src/queue/in-process.ts` (`runOne` switch),
 * and add a route in `src/routes/generate-print.ts` (also currently
 * deprecated/deleted). The 24k master file in `/tmp` is refcounted, so
 * a resurrected print pipeline that consumes it MUST call
 * `retainMaster()` before enqueueing and `releaseMaster()` in finally.
 */

export interface DeprecatedGeneratePrintInput {
  jobId: string;
  workerId: string;
  eventId: string;
  mosaicId: string;
  coverImageUrl: string;
  suite?: string;
}

export async function runGeneratePrint(
  _input: DeprecatedGeneratePrintInput,
): Promise<never> {
  throw new Error(
    'generate-print is deprecated in the single-master pipeline. ' +
      'Use `upload-print` (Job C) instead, which uploads the 24k master ' +
      'that Job A already rendered. See the header of this file for ' +
      'guidance on reviving this job for future Premium features.',
  );
}
