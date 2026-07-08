/**
 * PRD-005c (c-AC-2): the notification-decision core. Verifies the fleet fires a notification only
 * on the false→true transition into `hasTerminalFailure` (never repeating on every tick while it
 * stays true — the dedupe), that it is suppressed while the main window is focused, and that a
 * recovery or any non-terminal tick never notifies.
 */

import { describe, expect, it } from "vitest";

import { decideNotification, TERMINAL_FAILURE_TITLE } from "../../src/tray/notification-policy.js";
import type { FleetStatus } from "../../src/supervisor/index.js";

function status(hasTerminalFailure: boolean, roots: FleetStatus["roots"] = []): FleetStatus {
  return { roots, allHealthy: false, hasTerminalFailure };
}

const FAILED_HIVE: FleetStatus["roots"] = [{ name: "hive", phase: "failed", port: 3853, restarts: 5, detail: "gave up" }];

describe("decideNotification (c-AC-2)", () => {
  it("notifies on the transition from no-previous-status into terminal failure (first tick)", () => {
    const decision = decideNotification(undefined, status(true, FAILED_HIVE), false);
    expect(decision.kind).toBe("notify");
    if (decision.kind === "notify") {
      expect(decision.title).toBe(TERMINAL_FAILURE_TITLE);
      expect(decision.body).toContain("hive");
    }
  });

  it("notifies on the false→true transition", () => {
    const previous = status(false, [{ name: "hive", phase: "healthy", port: 3853, restarts: 0 }]);
    const next = status(true, FAILED_HIVE);
    expect(decideNotification(previous, next, false).kind).toBe("notify");
  });

  it("dedupes: does not notify again on a later tick while still in terminal failure", () => {
    const previous = status(true, FAILED_HIVE);
    const next = status(true, FAILED_HIVE);
    const decision = decideNotification(previous, next, false);
    expect(decision).toEqual({ kind: "suppressed", reason: "no-transition" });
  });

  it("does not notify on recovery (true→false)", () => {
    const previous = status(true, FAILED_HIVE);
    const next = status(false, [{ name: "hive", phase: "healthy", port: 3853, restarts: 0 }]);
    const decision = decideNotification(previous, next, false);
    expect(decision).toEqual({ kind: "suppressed", reason: "not-critical" });
  });

  it("does not notify on a tick that never touches terminal failure", () => {
    const previous = status(false, [{ name: "hive", phase: "starting", port: 3853, restarts: 0 }]);
    const next = status(false, [{ name: "hive", phase: "healthy", port: 3853, restarts: 0 }]);
    expect(decideNotification(previous, next, false)).toEqual({ kind: "suppressed", reason: "not-critical" });
  });

  it("suppresses a fresh transition into terminal failure when the window is focused", () => {
    const previous = status(false);
    const next = status(true, FAILED_HIVE);
    expect(decideNotification(previous, next, true)).toEqual({ kind: "suppressed", reason: "window-focused" });
  });

  it("re-notifies if the fleet recovers and then fails again (a new transition)", () => {
    const recovered = status(false, [{ name: "hive", phase: "healthy", port: 3853, restarts: 0 }]);
    const failedAgain = status(true, FAILED_HIVE);
    expect(decideNotification(recovered, failedAgain, false).kind).toBe("notify");
  });

  it("body names every failed/port-conflict root", () => {
    const roots: FleetStatus["roots"] = [
      { name: "doctor", phase: "port-conflict", port: 3852, restarts: 0, detail: "foreign" },
      { name: "hive", phase: "failed", port: 3853, restarts: 5, detail: "gave up" },
    ];
    const decision = decideNotification(status(false), status(true, roots), false);
    expect(decision.kind).toBe("notify");
    if (decision.kind === "notify") {
      expect(decision.body).toContain("doctor");
      expect(decision.body).toContain("hive");
    }
  });
});
