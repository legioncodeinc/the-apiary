/**
 * PRD-005c (c-AC-1): the tray menu-model builder. Verifies the standing actions are always present
 * (open-dashboard/restart-fleet/quit — so the tray works with the main window closed), that
 * "Restart Fleet" is enabled only when there is a terminal failure to restart, and that the
 * tooltip/status lines reflect the fleet snapshot.
 */

import { describe, expect, it } from "vitest";

import { buildTrayMenuModel } from "../../src/tray/menu-model.js";
import type { FleetStatus } from "../../src/supervisor/index.js";

function status(overrides: Partial<FleetStatus> & { roots: FleetStatus["roots"] }): FleetStatus {
  return {
    allHealthy: false,
    hasTerminalFailure: false,
    ...overrides,
  };
}

describe("buildTrayMenuModel (c-AC-1)", () => {
  it("always includes open-dashboard, restart-fleet, and quit", () => {
    const model = buildTrayMenuModel(status({ roots: [] }));
    const ids = model.actions.map((a) => a.id);
    expect(ids).toEqual(["open-dashboard", "restart-fleet", "quit"]);
  });

  it("open-dashboard and quit are always enabled regardless of fleet state", () => {
    const healthy = buildTrayMenuModel(
      status({
        roots: [
          { name: "doctor", phase: "healthy", port: 3852, restarts: 0 },
          { name: "hive", phase: "healthy", port: 3853, restarts: 0 },
        ],
        allHealthy: true,
      }),
    );
    const open = healthy.actions.find((a) => a.id === "open-dashboard");
    const quit = healthy.actions.find((a) => a.id === "quit");
    expect(open?.enabled).toBe(true);
    expect(quit?.enabled).toBe(true);
  });

  it("restart-fleet is disabled when the fleet is healthy (nothing to restart)", () => {
    const model = buildTrayMenuModel(
      status({
        roots: [{ name: "hive", phase: "healthy", port: 3853, restarts: 0 }],
        allHealthy: true,
      }),
    );
    expect(model.actions.find((a) => a.id === "restart-fleet")?.enabled).toBe(false);
  });

  it("restart-fleet is disabled while still starting", () => {
    const model = buildTrayMenuModel(
      status({
        roots: [{ name: "hive", phase: "starting", port: 3853, restarts: 0 }],
      }),
    );
    expect(model.actions.find((a) => a.id === "restart-fleet")?.enabled).toBe(false);
  });

  it("restart-fleet is enabled when a root has a terminal failure", () => {
    const model = buildTrayMenuModel(
      status({
        roots: [{ name: "hive", phase: "failed", port: 3853, restarts: 5, detail: "gave up" }],
        hasTerminalFailure: true,
      }),
    );
    expect(model.actions.find((a) => a.id === "restart-fleet")?.enabled).toBe(true);
  });

  it("restart-fleet is enabled on a port-conflict terminal state too", () => {
    const model = buildTrayMenuModel(
      status({
        roots: [{ name: "doctor", phase: "port-conflict", port: 3852, restarts: 0, detail: "foreign process" }],
        hasTerminalFailure: true,
      }),
    );
    expect(model.actions.find((a) => a.id === "restart-fleet")?.enabled).toBe(true);
  });

  it("produces one status line per root with a human-readable phase label", () => {
    const model = buildTrayMenuModel(
      status({
        roots: [
          { name: "doctor", phase: "healthy", port: 3852, restarts: 0 },
          { name: "hive", phase: "restarting", port: 3853, restarts: 2 },
        ],
      }),
    );
    expect(model.statusLines).toEqual([
      { root: "doctor", label: "Doctor: healthy" },
      { root: "hive", label: "Hive: restarting…" },
    ]);
  });

  it("tooltip summarizes attention-needed when a terminal failure exists", () => {
    const model = buildTrayMenuModel(
      status({
        roots: [{ name: "hive", phase: "failed", port: 3853, restarts: 5 }],
        hasTerminalFailure: true,
      }),
    );
    expect(model.tooltip).toContain("attention needed");
  });

  it("tooltip summarizes healthy when everything is up", () => {
    const model = buildTrayMenuModel(
      status({
        roots: [{ name: "hive", phase: "healthy", port: 3853, restarts: 0 }],
        allHealthy: true,
      }),
    );
    expect(model.tooltip).toContain("fleet healthy");
  });

  it("tooltip summarizes starting when neither healthy nor failed", () => {
    const model = buildTrayMenuModel(
      status({
        roots: [{ name: "hive", phase: "starting", port: 3853, restarts: 0 }],
      }),
    );
    expect(model.tooltip).toContain("starting");
  });

  it("is pure: the same status always produces an equivalent model", () => {
    const input = status({
      roots: [{ name: "doctor", phase: "healthy", port: 3852, restarts: 0 }],
      allHealthy: true,
    });
    expect(buildTrayMenuModel(input)).toEqual(buildTrayMenuModel(input));
  });
});
