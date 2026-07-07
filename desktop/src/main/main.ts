/**
 * PRD-005a: the Electron main process — single-instance lock, app lifecycle, and the fleet
 * supervisor wiring, plus the thin extension-point calls later waves (005b window, 005c tray +
 * service) fill in.
 *
 * Ordering on `whenReady` (ADR-0005): run the OS-service takeover FIRST (so the app is the sole
 * autostart owner before it starts anything), THEN start the supervisor (Doctor + Hive), THEN
 * open the window + tray. The window/tray/service bodies are stubs in this wave; their calls are
 * guarded so a not-yet-implemented later wave surfaces a clear log line instead of crashing the
 * whole app while the supervisor keeps running.
 */

import { app, BrowserWindow } from "electron";

import { createSupervisor, type FleetSupervisor } from "../supervisor/index.js";
import { createMainWindow } from "../window/index.js";
import { setupTray } from "../tray/index.js";
import { runServiceTakeover } from "../service/index.js";

/** The single live supervisor for this process instance. Created on `whenReady`. */
let supervisor: FleetSupervisor | undefined;
/** The single main window, if 005b's implementation has landed. */
let mainWindow: BrowserWindow | undefined;
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
    if (mainWindow !== undefined) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    // 1. OS-service takeover (005c stub). Guarded: a not-yet-implemented takeover must not stop the
    //    supervisor from coming up in this wave.
    try {
      await runServiceTakeover();
    } catch (error) {
      console.warn("[main] service takeover not available yet:", error instanceof Error ? error.message : error);
    }

    // 2. Start the fleet supervisor (a-AC-2). A hard precondition failure (no system Node ≥22.5,
    //    a-AC-1) throws here; surface it and continue so the window can show an actionable error.
    try {
      supervisor = createSupervisor();
      const status = await supervisor.start();
      console.info("[main] supervisor started:", JSON.stringify(status));
    } catch (error) {
      console.error("[main] supervisor failed to start:", error instanceof Error ? error.message : error);
    }

    // 3. Main window (005b stub) — needs the supervisor's stable contract.
    if (supervisor !== undefined) {
      try {
        mainWindow = createMainWindow(supervisor);
        mainWindow.on("closed", () => {
          mainWindow = undefined;
        });
      } catch (error) {
        console.warn("[main] main window not available yet:", error instanceof Error ? error.message : error);
      }

      // 4. Tray (005c stub).
      try {
        setupTray(supervisor);
      } catch (error) {
        console.warn("[main] tray not available yet:", error instanceof Error ? error.message : error);
      }
    }

    app.on("activate", () => {
      // macOS re-activate with no windows: re-open (once 005b lands). Never a second supervisor.
      if (BrowserWindow.getAllWindows().length === 0 && supervisor !== undefined && mainWindow === undefined) {
        try {
          mainWindow = createMainWindow(supervisor);
          mainWindow.on("closed", () => {
            mainWindow = undefined;
          });
        } catch (error) {
          console.warn("[main] re-open not available yet:", error instanceof Error ? error.message : error);
        }
      }
    });
  });

  // a-AC-4: stop the fleet cleanly on quit, leaving no orphans. `before-quit` is the reliable hook;
  // preventDefault holds the quit until the async stop resolves, then re-issues it.
  app.on("before-quit", (event) => {
    if (supervisor === undefined || stopping) return;
    event.preventDefault();
    stopping = true;
    void supervisor
      .stop()
      .catch((error) => {
        console.error("[main] error stopping supervisor:", error instanceof Error ? error.message : error);
      })
      .finally(() => {
        supervisor = undefined;
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
