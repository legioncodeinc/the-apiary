/**
 * PRD-005a/c (finding: ONE shared supervisor + window between main and tray).
 *
 * Proves the pure {@link createAppController} holder both `main.ts` and `setupTray` drive:
 *   - swap-on-restart: Restart Fleet stops the OLD supervisor, creates a NEW one, and notifies the
 *     swap listeners (tray/window rebind) — so quit/open-dashboard then target the LIVE instance and
 *     never the stale one that used to leak;
 *   - single-window invariant: openOrFocusDashboard focuses the existing window instead of spawning
 *     a second one (the tray bug);
 *   - quit-targets-live: stop() stops whatever supervisor is currently live (including after a swap).
 */

import { describe, expect, it, vi } from "vitest";

import { createAppController, type ManagedWindow } from "../../src/main/app-controller.js";
import type { FleetStatus, FleetSupervisor } from "../../src/supervisor/index.js";

/** A minimal fake supervisor recording start/stop, enough to prove which instance is targeted. */
function makeFakeSupervisor(label: string): FleetSupervisor & { readonly label: string; started: boolean; stopped: boolean } {
  const idle: FleetStatus = { roots: [], allHealthy: false, hasTerminalFailure: false };
  const sup = {
    label,
    started: false,
    stopped: false,
    async start(): Promise<FleetStatus> {
      sup.started = true;
      return idle;
    },
    async stop(): Promise<void> {
      sup.stopped = true;
    },
    getFleetStatus: () => idle,
    onHiveReady: () => () => undefined,
    onStatusChange: () => () => undefined,
  };
  return sup;
}

/** A fake window that tracks focus + destroyed state for the single-window invariant. */
function makeFakeWindow(): ManagedWindow & { focusCount: number; destroy(): void } {
  let destroyed = false;
  return {
    focusCount: 0,
    isDestroyed: () => destroyed,
    focus() {
      this.focusCount += 1;
    },
    destroy() {
      destroyed = true;
    },
  };
}

describe("createAppController swap-on-restart (finding)", () => {
  it("stops the OLD supervisor, creates a NEW one, and notifies swap listeners", async () => {
    const supervisors = [makeFakeSupervisor("A"), makeFakeSupervisor("B")];
    let created = 0;
    const controller = createAppController({
      createSupervisor: () => supervisors[created++]!,
      openWindow: () => makeFakeWindow(),
    });

    const first = controller.createSupervisor();
    expect(first.label).toBe("A");

    const swapped: string[] = [];
    controller.onSupervisorSwap((s) => swapped.push((s as typeof supervisors[number]).label));

    await controller.restartFleet();

    expect(supervisors[0]!.stopped).toBe(true); // old stopped
    expect(supervisors[1]!.started).toBe(true); // new started
    expect(swapped).toEqual(["B"]); // listeners rebound to the new instance
    expect((controller.getSupervisor() as typeof supervisors[number]).label).toBe("B");
  });

  it("quit-targets-live: stop() stops the CURRENT supervisor after a restart, not the stale one", async () => {
    const supervisors = [makeFakeSupervisor("A"), makeFakeSupervisor("B")];
    let created = 0;
    const controller = createAppController({
      createSupervisor: () => supervisors[created++]!,
      openWindow: () => makeFakeWindow(),
    });
    controller.createSupervisor();
    await controller.restartFleet();

    await controller.stop();

    // The LIVE instance (B) is the one stopped by quit; A was already stopped during restart.
    expect(supervisors[1]!.stopped).toBe(true);
    expect(controller.getSupervisor()).toBeUndefined();
  });

  it("leaves NO live supervisor if the replacement cannot be created (no stale leak)", async () => {
    const first = makeFakeSupervisor("A");
    let call = 0;
    const controller = createAppController({
      createSupervisor: () => {
        if (call++ === 0) return first;
        throw new Error("node resolution regressed");
      },
      openWindow: () => makeFakeWindow(),
    });
    controller.createSupervisor();

    await expect(controller.restartFleet()).rejects.toThrow("node resolution regressed");
    expect(first.stopped).toBe(true); // old was still stopped
    expect(controller.getSupervisor()).toBeUndefined(); // no stale instance retained
  });
});

describe("createAppController single-window invariant (finding)", () => {
  it("opens one window, then FOCUSES it rather than opening a second", () => {
    const window = makeFakeWindow();
    const openWindow = vi.fn(() => window);
    const controller = createAppController({ createSupervisor: () => makeFakeSupervisor("A"), openWindow });
    controller.createSupervisor();

    const w1 = controller.openOrFocusDashboard();
    const w2 = controller.openOrFocusDashboard();

    expect(openWindow).toHaveBeenCalledTimes(1); // never a second window
    expect(w1).toBe(w2);
    expect(window.focusCount).toBe(1); // the second call focused the existing window
  });

  it("opens a fresh window after the previous one was closed", () => {
    const first = makeFakeWindow();
    const second = makeFakeWindow();
    const queue = [first, second];
    const openWindow = vi.fn(() => queue.shift()!);
    const controller = createAppController({ createSupervisor: () => makeFakeSupervisor("A"), openWindow });
    controller.createSupervisor();

    const w1 = controller.openOrFocusDashboard();
    controller.handleWindowClosed(w1!);
    const w2 = controller.openOrFocusDashboard();

    expect(openWindow).toHaveBeenCalledTimes(2);
    expect(w2).toBe(second);
  });

  it("treats a destroyed-but-not-cleared window as gone (opens fresh)", () => {
    const first = makeFakeWindow();
    const second = makeFakeWindow();
    const queue = [first, second];
    const controller = createAppController({
      createSupervisor: () => makeFakeSupervisor("A"),
      openWindow: () => queue.shift()!,
    });
    controller.createSupervisor();

    controller.openOrFocusDashboard();
    first.destroy(); // window destroyed without a handleWindowClosed callback
    const w2 = controller.openOrFocusDashboard();
    expect(w2).toBe(second);
  });
});

describe("createAppController lifecycle", () => {
  it("createSupervisor is idempotent (reuses the single live instance)", () => {
    const controller = createAppController({
      createSupervisor: vi.fn(() => makeFakeSupervisor("A")),
      openWindow: () => makeFakeWindow(),
    });
    const a = controller.createSupervisor();
    const b = controller.createSupervisor();
    expect(a).toBe(b);
  });

  it("stop() is safe with no live supervisor", async () => {
    const controller = createAppController({
      createSupervisor: () => makeFakeSupervisor("A"),
      openWindow: () => makeFakeWindow(),
    });
    await expect(controller.stop()).resolves.toBeUndefined();
  });
});
