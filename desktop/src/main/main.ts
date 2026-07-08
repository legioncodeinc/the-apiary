/**
 * PRD-005a: the Electron main process — single-instance lock, app lifecycle, and the fleet
 * supervisor wiring, plus the window (005b), tray + service (005c) integration calls.
 *
 * Ordering on `whenReady` (ADR-0005): run the OS-service takeover FIRST (so the app is the sole
 * autostart owner before it starts anything), THEN start the supervisor (Doctor + Hive), THEN
 * open the window + tray. The window/tray/service modules are implemented; their calls stay
 * guarded so a runtime failure in one surfaces a clear log line instead of crashing the whole app
 * while the supervisor keeps running. The service takeover runs in dryRun in this skeleton (no
 * live machine mutation); the LIVE OS-service takeover + standalone-Hivemind consent/abort
 * (ADR-0005 dec.4/5) is the gated follow-up — see the TODO at the takeover call.
 *
 * The single live supervisor AND the single main window are owned by ONE shared {@link AppController}
 * (finding: main and tray must not each hold their own supervisor/window). `before-quit`, `activate`,
 * `second-instance`, and the tray's Restart Fleet / Open Dashboard / Quit all go through it, so a
 * restart swaps the live instance for everyone and quit always targets the LIVE supervisor.
 */

import { app, BrowserWindow } from "electron";

import { createSupervisor } from "../supervisor/index.js";
import { createMainWindow } from "../window/index.js";
import { setupTray } from "../tray/index.js";
import { runServiceTakeover } from "../service/index.js";
import { createAppController, type ManagedWindow } from "./app-controller.js";

/**
 * The shared holder. `openWindow` adapts electron's `BrowserWindow` (via {@link createMainWindow}) to
 * the controller's {@link ManagedWindow} seam and wires the `closed` callback back into the holder so
 * the single-window invariant knows when the window is gone.
 */
const controller = createAppController<BrowserWindow & ManagedWindow>({
  createSupervisor: () => createSupervisor(),
  openWindow: (supervisor) => {
    const win = createMainWindow(supervisor);
    win.on("closed", () => controller.handleWindowClosed(win));
    return win;
  },
  log: {
    info: (m) => console.info(`[main] ${m}`),
    warn: (m, e) => console.warn(`[main] ${m}`, e instanceof Error ? e.message : e),
    error: (m, e) => console.error(`[main] ${m}`, e instanceof Error ? e.message : e),
  },
});

/** Guard so `stop()` is only awaited once even if several quit paths fire. */
let stopping = false;

/**
 * a-AC-5: acquire the single-instance lock. A SECOND launch fails to get the lock, so it must
 * NOT create a supervisor or re-bind ports — it simply signals the first instance and exits. The
 * first instance focuses its window on that signal.
 */
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  // Second instance: do nothing that touches the fleet. Just quit; the primary handles focus.
  app.quit();
} else {
  app.on("second-instance", () => {
    // a-AC-5: focus the existing window rather than starting a second supervisor.
    controller.openOrFocusDashboard();
  });

  app.whenReady().then(async () => {
    // 1. OS-service takeover (005c). Runs dryRun in the skeleton — no live machine mutation.
    //    TODO(005c-live, gated): drop dryRun and surface the standalone-Hivemind decline→abort
    //    outcome here (on abort, stop the app install instead of continuing). ADR-0005 dec.4/5.
    //    Guarded so a takeover failure never blocks the supervisor from coming up.
    try {
      const takeover = await runServiceTakeover();
      console.info("[main] service takeover (dryRun):", JSON.stringify(takeover));
    } catch (error) {
      console.warn("[main] service takeover error:", error instanceof Error ? error.message : error);
    }

    // 2. Start the fleet supervisor (a-AC-2). A hard precondition failure (no system Node ≥22.5,
    //    a-AC-1) throws here; surface it and continue so the window can show an actionable error.
    try {
      const supervisor = controller.createSupervisor();
      const status = await supervisor.start();
      console.info("[main] supervisor started:", JSON.stringify(status));
    } catch (error) {
      console.error("[main] supervisor failed to start:", error instanceof Error ? error.message : error);
    }

    // 3. Main window (005b) + 4. Tray (005c) — both need the supervisor's stable contract.
    if (controller.getSupervisor() !== undefined) {
      try {
        controller.openOrFocusDashboard();
      } catch (error) {
        console.warn("[main] main window failed to open:", error instanceof Error ? error.message : error);
      }

      try {
        setupTray(controller);
      } catch (error) {
        console.warn("[main] tray failed to set up:", error instanceof Error ? error.message : error);
      }
    }

    app.on("activate", () => {
      // macOS re-activate: open the window if none is live, else focus it. Never a second supervisor.
      if (BrowserWindow.getAllWindows().length === 0 && controller.getSupervisor() !== undefined) {
        try {
          controller.openOrFocusDashboard();
        } catch (error) {
          console.warn("[main] window re-open failed:", error instanceof Error ? error.message : error);
        }
      }
    });
  });

  // a-AC-4: stop the fleet cleanly on quit, leaving no orphans. `before-quit` is the reliable hook;
  // preventDefault holds the quit until the async stop resolves, then re-issues it. Always targets
  // the LIVE supervisor (post-restart included), since the controller owns the single instance.
  app.on("before-quit", (event) => {
    if (controller.getSupervisor() === undefined || stopping) return;
    event.preventDefault();
    stopping = true;
    void controller
      .stop()
      .catch((error) => {
        console.error("[main] error stopping supervisor:", error instanceof Error ? error.message : error);
      })
      .finally(() => {
        app.quit();
      });
  });

  app.on("window-all-closed", () => {
    // On non-macOS, closing all windows quits (which triggers `before-quit` → clean fleet stop).
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
