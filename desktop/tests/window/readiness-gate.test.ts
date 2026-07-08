/**
 * PRD-005b (b-AC-1 / b-AC-4): the readiness-gate state machine. loading → ready on hive-ready;
 * loading → failed on budget expiry; failed → loading on retry; idempotent + race-safe.
 */

import { describe, expect, it, vi } from "vitest";

import { BUDGET_EXPIRED_MESSAGE, createReadinessGate, type GateState } from "../../src/window/readiness-gate.js";

describe("createReadinessGate (b-AC-4)", () => {
  it("starts in loading", () => {
    expect(createReadinessGate().getState().phase).toBe("loading");
  });

  it("loading → ready when hive becomes ready", () => {
    const gate = createReadinessGate();
    gate.markHiveReady();
    expect(gate.getState().phase).toBe("ready");
  });

  it("loading → failed with an actionable message when the budget expires", () => {
    const gate = createReadinessGate();
    gate.markBudgetExpired();
    const state = gate.getState();
    expect(state.phase).toBe("failed");
    expect(state.message).toBe(BUDGET_EXPIRED_MESSAGE);
  });

  it("failed → loading on retry", () => {
    const gate = createReadinessGate();
    gate.markBudgetExpired();
    gate.retry();
    expect(gate.getState().phase).toBe("loading");
  });

  it("ignores a late budget expiry once already ready (no flip back to failed)", () => {
    const gate = createReadinessGate();
    gate.markHiveReady();
    gate.markBudgetExpired(); // stale timer fires after Hive already came up
    expect(gate.getState().phase).toBe("ready");
  });

  it("ignores a late hive-ready once already failed (retry is the only way out)", () => {
    const gate = createReadinessGate();
    gate.markBudgetExpired();
    gate.markHiveReady(); // late readiness signal after the failure view showed
    expect(gate.getState().phase).toBe("failed");
  });

  it("retry re-arms: after retry, a hive-ready advances to ready again", () => {
    const gate = createReadinessGate();
    gate.markBudgetExpired();
    gate.retry();
    gate.markHiveReady();
    expect(gate.getState().phase).toBe("ready");
  });

  it("emits one change per real transition and none for no-op events", () => {
    const gate = createReadinessGate();
    const seen: GateState[] = [];
    gate.onChange((s) => seen.push(s));

    gate.markHiveReady(); // loading → ready  (1)
    gate.markHiveReady(); // no-op
    gate.markBudgetExpired(); // no-op (already ready)
    expect(seen.map((s) => s.phase)).toEqual(["ready"]);
  });

  it("retry from loading is a no-op (nothing to retry)", () => {
    const gate = createReadinessGate();
    const listener = vi.fn();
    gate.onChange(listener);
    gate.retry();
    expect(gate.getState().phase).toBe("loading");
    expect(listener).not.toHaveBeenCalled();
  });

  it("unsubscribe stops further notifications", () => {
    const gate = createReadinessGate();
    const listener = vi.fn();
    const unsub = gate.onChange(listener);
    unsub();
    gate.markHiveReady();
    expect(listener).not.toHaveBeenCalled();
  });
});
