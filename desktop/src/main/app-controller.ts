/**
 * PRD-005a/c (finding: ONE shared supervisor + window between main and tray).
 *
 * The single source of truth for the live {@link FleetSupervisor} instance AND the single main
 * window reference. `main.ts` (lifecycle, before-quit, activate, second-instance focus) and
 * `setupTray` (Open Dashboard / Restart Fleet / Quit) BOTH go through this one holder, so:
 *   - "Restart Fleet" stops the old supervisor, creates a new one, and REBINDS every window/tray
 *     subscription to the new instance — main.ts learns about the swap instead of holding a stale
 *     supervisor that `before-quit` would then leak.
 *   - "Open Dashboard" (tray or dock re-activate) focuses the ONE main window rather than spawning
 *     a second one.
 *   - Quit always stops the LIVE supervisor.
 *
 * This module is PURE (no `electron` import): every side-effecting capability is injected as a seam
 * (create a supervisor, open a window, focus/destroyed checks). The electron-importing wrappers pass
 * the real electron-backed seams; the swap/single-window/quit-targets-live invariants are unit-tested
 * here with fakes.
 */

import type { FleetSupervisor } from "../supervisor/index.js";

/**
 * The minimal window handle the controller needs. The electron wrapper adapts a `BrowserWindow` to
 * this shape; tests pass a fake. It is intentionally NOT `BrowserWindow` so this module stays pure.
 */
export interface ManagedWindow {
  /** True once the underlying native window has been destroyed (closed). */
  isDestroyed(): boolean;
  /** Bring the window to the foreground (restoring it first if minimized). */
  focus(): void;
}

/** The seams the controller needs. All injected so the holder logic is electron-free and unit-testable. */
export interface AppControllerSeams<W extends ManagedWindow = ManagedWindow> {
  /** Create a fresh supervisor instance (production: `createSupervisor` from ../supervisor). */
  readonly createSupervisor: () => FleetSupervisor;
  /** Open a new main window bound to `supervisor`, returning the managed handle. */
  readonly openWindow: (supervisor: FleetSupervisor) => W;
  /** Structured, credential-free logging for the lifecycle transitions. */
  readonly log?: {
    info?(message: string): void;
    warn?(message: string, error?: unknown): void;
    error?(message: string, error?: unknown): void;
  };
}

/** A listener notified whenever the live supervisor is swapped (tray/window re-subscribe on this). */
export type SupervisorSwapListener = (supervisor: FleetSupervisor) => void;

/** The shared holder both `main.ts` and `setupTray` drive. */
export interface AppController<W extends ManagedWindow = ManagedWindow> {
  /** Create the supervisor for this process (idempotent: reuses the existing live instance). */
  createSupervisor(): FleetSupervisor;
  /** The live supervisor, or `undefined` before {@link createSupervisor}/after {@link stop}. */
  getSupervisor(): FleetSupervisor | undefined;
  /** The live main window, or `undefined` if none is open. */
  getMainWindow(): W | undefined;
  /**
   * Open the main window if none is live, otherwise focus the existing one. Single-window invariant:
   * never spawns a second window while one is already open (finding: tray opened a 2nd window).
   */
  openOrFocusDashboard(): W | undefined;
  /**
   * Restart the fleet: stop the OLD supervisor, create a NEW one, and rebind window + tray
   * subscriptions to it via the swap listeners. After this, quit/open-dashboard target the new
   * instance (finding: restart used to strand main.ts on the stale supervisor).
   */
  restartFleet(): Promise<void>;
  /** Stop the LIVE supervisor cleanly and clear it (idempotent; safe to call from any quit path). */
  stop(): Promise<void>;
  /** Register a swap listener (returns an unsubscribe). Fired on every {@link restartFleet}. */
  onSupervisorSwap(listener: SupervisorSwapListener): () => void;
  /** Record that the main window closed (so the single-window invariant knows it is gone). */
  handleWindowClosed(window: W): void;
}

/** Construct the shared {@link AppController} over the injected seams. */
export function createAppController<W extends ManagedWindow = ManagedWindow>(
  seams: AppControllerSeams<W>,
): AppController<W> {
  let supervisor: FleetSupervisor | undefined;
  let mainWindow: W | undefined;
  const swapListeners = new Set<SupervisorSwapListener>();

  const info = (m: string): void => seams.log?.info?.(m);
  const warn = (m: string, e?: unknown): void => seams.log?.warn?.(m, e);
  const errorLog = (m: string, e?: unknown): void => seams.log?.error?.(m, e);

  const liveWindow = (): W | undefined => (mainWindow !== undefined && !mainWindow.isDestroyed() ? mainWindow : undefined);

  return {
    createSupervisor(): FleetSupervisor {
      if (supervisor === undefined) {
        supervisor = seams.createSupervisor();
      }
      return supervisor;
    },

    getSupervisor(): FleetSupervisor | undefined {
      return supervisor;
    },

    getMainWindow(): W | undefined {
      return liveWindow();
    },

    openOrFocusDashboard(): W | undefined {
      const existing = liveWindow();
      if (existing !== undefined) {
        existing.focus();
        return existing;
      }
      if (supervisor === undefined) {
        warn("openOrFocusDashboard called with no live supervisor");
        return undefined;
      }
      mainWindow = seams.openWindow(supervisor);
      return mainWindow;
    },

    async restartFleet(): Promise<void> {
      const old = supervisor;
      if (old !== undefined) {
        try {
          await old.stop();
        } catch (error) {
          errorLog("error stopping supervisor during restart", error);
        }
      }
      let next: FleetSupervisor;
      try {
        next = seams.createSupervisor();
      } catch (error) {
        // Creating the replacement failed (e.g. Node resolution regressed): surface it and leave the
        // controller with NO live supervisor rather than a stale one, so quit paths no-op safely and
        // the tray does not re-subscribe to a dead instance. No swap listener fires (nothing to bind).
        errorLog("error creating replacement supervisor during restart", error);
        supervisor = undefined;
        throw error instanceof Error ? error : new Error(String(error));
      }
      supervisor = next;
      // Rebind window + tray subscriptions to the NEW instance before starting it, so the first
      // status tick after start() reaches the already-rebound listeners.
      for (const listener of swapListeners) {
        try {
          listener(next);
        } catch (error) {
          warn("supervisor-swap listener threw", error);
        }
      }
      try {
        await next.start();
      } catch (error) {
        errorLog("error starting replacement supervisor during restart", error);
      }
      info("fleet restarted");
    },

    async stop(): Promise<void> {
      const live = supervisor;
      supervisor = undefined;
      if (live === undefined) return;
      try {
        await live.stop();
      } catch (error) {
        errorLog("error stopping supervisor", error);
      }
    },

    onSupervisorSwap(listener: SupervisorSwapListener): () => void {
      swapListeners.add(listener);
      return () => swapListeners.delete(listener);
    },

    handleWindowClosed(window: W): void {
      if (mainWindow === window) mainWindow = undefined;
    },
  };
}
