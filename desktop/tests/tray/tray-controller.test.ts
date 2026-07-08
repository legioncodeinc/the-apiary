/**
 * PRD-005c (finding: the initial fleet-status snapshot must run through the notification decision).
 *
 * Proves the {@link createNotificationGate} state machine the tray wrapper delegates to:
 *   - a fleet ALREADY in terminal failure on the FIRST tick fires exactly one notification (the bug:
 *     the initial snapshot used to bypass the decision, so a fast port-in-use failure never notified);
 *   - the once-per-transition dedupe still holds across the initial + subsequent ticks;
 *   - focus suppression still holds on that first tick.
 */

import { describe, expect, it } from "vitest";

import { createNotificationGate } from "../../src/tray/tray-controller.js";
import type { FleetStatus } from "../../src/supervisor/index.js";

/** A fleet snapshot in terminal failure (a foreign process grabbed hive's port). */
const TERMINAL: FleetStatus = {
  roots: [
    { name: "doctor", phase: "healthy", port: 3852, restarts: 0 },
    { name: "hive", phase: "port-conflict", port: 3853, restarts: 0, detail: "port 3853 in use" },
  ],
  allHealthy: false,
  hasTerminalFailure: true,
};

/** A fully-healthy fleet snapshot. */
const HEALTHY: FleetStatus = {
  roots: [
    { name: "doctor", phase: "healthy", port: 3852, restarts: 0 },
    { name: "hive", phase: "healthy", port: 3853, restarts: 0 },
  ],
  allHealthy: true,
  hasTerminalFailure: false,
};

describe("createNotificationGate first-tick behavior (finding)", () => {
  it("notifies on a first tick that is ALREADY in terminal failure (unfocused)", () => {
    const gate = createNotificationGate();
    const decision = gate.tick(TERMINAL, false);
    expect(decision.kind).toBe("notify");
  });

  it("suppresses the first terminal-failure tick while the window is focused", () => {
    const gate = createNotificationGate();
    const decision = gate.tick(TERMINAL, true);
    expect(decision.kind).toBe("suppressed");
    if (decision.kind === "suppressed") expect(decision.reason).toBe("window-focused");
  });

  it("dedupes: a second terminal tick after the first does NOT notify again", () => {
    const gate = createNotificationGate();
    expect(gate.tick(TERMINAL, false).kind).toBe("notify");
    expect(gate.tick(TERMINAL, false).kind).toBe("suppressed");
  });

  it("does not notify on a first tick that is healthy", () => {
    const gate = createNotificationGate();
    expect(gate.tick(HEALTHY, false).kind).toBe("suppressed");
  });

  it("re-arms after reset so a fresh subscription (post Restart Fleet) can notify again", () => {
    const gate = createNotificationGate();
    expect(gate.tick(TERMINAL, false).kind).toBe("notify");
    gate.reset();
    // After reset, `previous` is undefined again: a terminal first tick notifies once more.
    expect(gate.tick(TERMINAL, false).kind).toBe("notify");
  });
});
