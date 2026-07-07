/**
 * PRD-005a a-AC-3: a pure, bounded geometric backoff for root restarts.
 *
 * Mirrors doctor's `backoff.ts` (geometric with jitter, floor, ceiling) — a pure, injectable-RNG
 * value object: no timers, no I/O. The supervisor owns the sleeping (via its injected `sleep`
 * seam) and the give-up decision; this module only computes the next delay and advances the rung.
 *
 * The bound that satisfies "repeated failures stop retrying rather than looping forever" lives in
 * the supervisor (a `maxRestarts` count), not here — this module just produces the delays.
 */

/** Tuning for {@link createBackoff}. */
export interface BackoffOptions {
  /** Floor delay in ms (the rung-0 base, before jitter). */
  readonly floorMs: number;
  /** Ceiling delay in ms (the geometric series is clamped here). */
  readonly ceilingMs: number;
  /** Jitter fraction in [0, 1] (default 0.2). Spreads retries so co-flapping boxes do not stampede. */
  readonly jitter?: number;
  /** Injected RNG returning [0, 1); defaults to Math.random (so tests are deterministic). */
  readonly random?: () => number;
}

/** A pure backoff state machine over a geometric, jittered, clamped schedule. */
export interface Backoff {
  /** The current rung (0-based geometric step count). */
  readonly rung: number;
  /** Delay for the CURRENT rung (floor * 2^rung, clamped to ceiling, then jittered). Does not advance. */
  delayMs(): number;
  /** Advance to the next rung (call after a failed attempt). Returns the new rung. */
  advance(): number;
  /** Reset to rung 0 (call on a confirmed return to healthy). */
  reset(): void;
}

/** Clamp `n` into `[lo, hi]`. */
function clamp(n: number, lo: number, hi: number): number {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

/** Build a bounded backoff machine. Defensively normalizes floor/ceiling so a caller cannot invert them. */
export function createBackoff(options: BackoffOptions): Backoff {
  const floor = Math.max(1, Math.floor(options.floorMs));
  const ceiling = Math.max(floor, Math.floor(options.ceilingMs));
  const jitter = clamp(options.jitter ?? 0.2, 0, 1);
  const random = options.random ?? Math.random;
  let rung = 0;

  return {
    get rung(): number {
      return rung;
    },
    delayMs(): number {
      // Clamp the GEOMETRIC base to [floor, ceiling] BEFORE jitter, so the jitter band is centered
      // on the clamped value; guard 2^rung overflow. Then apply jitter, which legitimately spreads
      // the delay BELOW the base (that is the whole point of jitter: de-stampeding co-flapping
      // boxes). The post-jitter clamp lower bound is therefore 1ms — NOT `floor` — because clamping
      // back up to `floor` here would erase the low half of the jitter band and re-collapse every
      // rung-0 retry onto exactly `floor`, the stampede jitter exists to prevent.
      const factor = rung >= 30 ? ceiling / floor : 2 ** rung;
      const base = clamp(floor * factor, floor, ceiling);
      const jittered = base * (1 - jitter + random() * (2 * jitter));
      return Math.round(clamp(jittered, 1, ceiling));
    },
    advance(): number {
      rung += 1;
      return rung;
    },
    reset(): void {
      rung = 0;
    },
  };
}
