/**
 * Progress creep — makes the UI feel alive during opaque stages
 * (palette build, matching, compositing, DZI tiling, print upload).
 *
 * The pipeline can't easily instrument every internal step, so we emit
 * a synthetic "creep" toward a ceiling using an easing curve. The
 * server-side monotonic guard in `progress.ts` ensures real progress
 * events always win, and the creep never crosses the ceiling.
 *
 * Emissions are throttled (min 1% delta or ≥400ms) so Supabase
 * Realtime stays lightweight while the bar visibly advances.
 */

import type { JobEventBus } from './events';

export interface CreepHandle {
  /** Stop the ticker and (optionally) jump to a final value. */
  stop(finalPercent?: number): void;
  /** Current emitted percent. */
  current(): number;
}

export interface CreepOptions {
  bus: JobEventBus;
  /** Lower bound (inclusive) of the band this creep animates through. */
  from: number;
  /** Upper bound (exclusive) — the creep will never emit >= `to`. */
  to: number;
  /** Approximate time (ms) to reach ~90% of the band. Default 20s. */
  durationMs?: number;
  /** How often to consider emitting a tick. Default 450ms. */
  tickMs?: number;
  /** Minimum delta before we emit. Default 1%. */
  minDeltaPct?: number;
  /** Optional stage label for logging. */
  note?: string;
}

/**
 * Kicks off a background ticker that eases progress from `from` toward
 * `to`, never quite reaching `to`. Returns a handle to stop it — the
 * caller MUST call `stop()` when the underlying stage completes.
 */
export function startCreep(opts: CreepOptions): CreepHandle {
  const {
    bus,
    from,
    to,
    durationMs = 20_000,
    tickMs = 450,
    minDeltaPct = 1,
    note,
  } = opts;
  const span = Math.max(0, to - from);
  const started = Date.now();
  let emitted = from;

  // Emit the starting value immediately so the bar snaps to the band.
  bus.emit({ type: 'progress', percent: from, note });

  const timer: NodeJS.Timeout = setInterval(() => {
    const elapsed = Date.now() - started;
    // easeOutCubic on normalized time, capped just under the ceiling.
    const t = Math.min(1, elapsed / durationMs);
    const eased = 1 - Math.pow(1 - t, 3);
    // Never quite reach `to` while creeping — real completion jumps us there.
    const target = from + span * (eased * 0.94);
    const next = Math.floor(target);
    if (next - emitted >= minDeltaPct && next < to) {
      emitted = next;
      bus.emit({ type: 'progress', percent: emitted, note });
    }
  }, tickMs);

  return {
    stop(finalPercent) {
      clearInterval(timer);
      if (typeof finalPercent === 'number' && finalPercent > emitted) {
        emitted = Math.min(100, Math.round(finalPercent));
        bus.emit({ type: 'progress', percent: emitted, note });
      }
    },
    current: () => emitted,
  };
}
