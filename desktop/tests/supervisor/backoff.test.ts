/**
 * a-AC-3 (backoff half): the bounded geometric backoff grows, clamps to the ceiling, and stays
 * bounded — it never produces an unbounded delay, and jitter stays within the band.
 */

import { describe, expect, it } from "vitest";

import { createBackoff } from "../../src/supervisor/backoff.js";

describe("createBackoff (a-AC-3)", () => {
  it("grows geometrically from the floor with jitter disabled", () => {
    const b = createBackoff({ floorMs: 1000, ceilingMs: 60_000, jitter: 0, random: () => 0.5 });
    expect(b.delayMs()).toBe(1000);
    b.advance();
    expect(b.delayMs()).toBe(2000);
    b.advance();
    expect(b.delayMs()).toBe(4000);
    b.advance();
    expect(b.delayMs()).toBe(8000);
  });

  it("clamps to the ceiling no matter how many rungs are advanced", () => {
    const b = createBackoff({ floorMs: 1000, ceilingMs: 5000, jitter: 0, random: () => 0.5 });
    for (let i = 0; i < 50; i += 1) b.advance();
    expect(b.delayMs()).toBe(5000);
  });

  it("keeps jitter within [1 - j, 1 + j] of the clamped base", () => {
    const low = createBackoff({ floorMs: 1000, ceilingMs: 60_000, jitter: 0.2, random: () => 0 });
    const high = createBackoff({ floorMs: 1000, ceilingMs: 60_000, jitter: 0.2, random: () => 1 });
    // rung 0 base = 1000; jitter band = [800, 1200].
    expect(low.delayMs()).toBe(800);
    expect(high.delayMs()).toBe(1200);
  });

  it("reset returns to rung 0", () => {
    const b = createBackoff({ floorMs: 1000, ceilingMs: 60_000, jitter: 0, random: () => 0.5 });
    b.advance();
    b.advance();
    b.reset();
    expect(b.rung).toBe(0);
    expect(b.delayMs()).toBe(1000);
  });

  it("normalizes an inverted floor/ceiling defensively (never a negative delay)", () => {
    const b = createBackoff({ floorMs: 5000, ceilingMs: 1000, jitter: 0, random: () => 0.5 });
    expect(b.delayMs()).toBeGreaterThanOrEqual(1);
  });
});
