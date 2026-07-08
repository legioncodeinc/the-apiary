/**
 * PRD-005c: the system tray — the thin electron wrapper (c-AC-1, c-AC-2, c-AC-3).
 *
 * This wires the PURE cores ({@link buildTrayMenuModel}, {@link decideNotification},
 * {@link registerAutostartSettings}) to real electron surfaces (`Tray`, `Menu`, `Notification`,
 * `app.setLoginItemSettings`). The pure logic is unit-tested; this wrapper is integration-only (it
 * imports `electron`, so it is exercised by hand / e2e, not the node vitest env — like `main.ts`).
 *
 * The tray consumes ONLY the stable {@link FleetSupervisor} surface (005a): it reads
 * {@link FleetSupervisor.getFleetStatus} to render fleet state, subscribes via
 * {@link FleetSupervisor.onStatusChange} to re-render on change, and calls
 * {@link FleetSupervisor.stop} from the "Quit" action. It MUST NOT edit the supervisor.
 *
 * Flow:
 *   1. Build the tray icon + menu from the current snapshot (c-AC-1); it works while the main
 *      window is closed because the tray, unlike the window, is never torn down by "closed".
 *   2. Subscribe to `onStatusChange`: re-render the menu/tooltip every tick, and run every tick
 *      through the notification-decision core to (maybe) fire a native `Notification` (c-AC-2).
 *   3. Register launch-at-login on setup (c-AC-3); expose {@link disableAutostart} for symmetry
 *      (e.g. a future "uninstall"/settings surface can call it without re-deriving the settings).
 *   4. Wire actions: Open Dashboard focuses/creates the main window; Restart Fleet stops the current
 *      supervisor and starts a fresh one (the frozen 005a contract has no in-place per-root restart,
 *      and `start()` is a one-shot no-op on an already-started instance — so "restart" means a new
 *      supervisor instance, exactly as `createSupervisor()` is designed to be called); Quit stops
 *      the supervisor then quits the app.
 */

import { app, BrowserWindow, Menu, nativeImage, Notification, Tray } from "electron";

import { createSupervisor, type FleetStatus, type FleetSupervisor } from "../supervisor/index.js";
import { createMainWindow } from "../window/index.js";
import { registerAutostartSettings, unregisterAutostartSettings } from "./autostart.js";
import { buildTrayMenuModel, type TrayMenuAction } from "./menu-model.js";
import { decideNotification } from "./notification-policy.js";

/**
 * Register launch-at-login (c-AC-3). Exported so a future settings/uninstall surface can call the
 * symmetric unregister without re-deriving the electron call site.
 */
export function enableAutostart(): void {
  const settings = registerAutostartSettings();
  app.setLoginItemSettings({ openAtLogin: settings.openAtLogin, openAsHidden: settings.openAsHidden });
}

/** Unregister launch-at-login (symmetry for opt-out/uninstall paths). */
export function disableAutostart(): void {
  const settings = unregisterAutostartSettings();
  app.setLoginItemSettings({ openAtLogin: settings.openAtLogin, openAsHidden: settings.openAsHidden });
}

/** True iff any BrowserWindow in this process currently has OS focus (drives c-AC-2 suppression). */
function isAnyWindowFocused(): boolean {
  return BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.isFocused());
}

/**
 * Create the system tray (c-AC-1, c-AC-2, c-AC-3). `main.ts` calls this once on `whenReady` after
 * the supervisor and main window are up. Returns the live `Tray`; it is not destroyed on window
 * close, so its actions keep working with the main window closed (c-AC-1).
 */
export function setupTray(initialSupervisor: FleetSupervisor): Tray {
  const tray = new Tray(trayIcon());

  // The tray owns a mutable reference so "Restart Fleet" can swap in a fresh supervisor instance
  // without touching main.ts's module-scoped variable (main.ts is not editable by this wave).
  let supervisor = initialSupervisor;
  let mainWindow: BrowserWindow | undefined;
  let lastStatus: FleetStatus | undefined;
  let unsubscribe: (() => void) | undefined;

  const openDashboard = (): void => {
    if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      return;
    }
    mainWindow = createMainWindow(supervisor);
    mainWindow.on("closed", () => {
      mainWindow = undefined;
    });
  };

  const restartFleet = async (): Promise<void> => {
    try {
      await supervisor.stop();
    } catch (error) {
      console.error("[tray] error stopping supervisor during restart:", error instanceof Error ? error.message : error);
    }
    unsubscribe?.();
    try {
      supervisor = createSupervisor();
      subscribe();
      await supervisor.start();
    } catch (error) {
      console.error("[tray] error restarting supervisor:", error instanceof Error ? error.message : error);
    }
  };

  const quit = (): void => {
    void supervisor
      .stop()
      .catch((error) => {
        console.error("[tray] error stopping supervisor on quit:", error instanceof Error ? error.message : error);
      })
      .finally(() => {
        app.quit();
      });
  };

  const runAction = (action: TrayMenuAction): void => {
    if (action.id === "open-dashboard") openDashboard();
    else if (action.id === "restart-fleet") void restartFleet();
    else quit();
  };

  const render = (status: FleetStatus): void => {
    const model = buildTrayMenuModel(status);
    tray.setToolTip(model.tooltip);
    const template = [
      ...model.statusLines.map((line) => ({ label: line.label, enabled: false })),
      { type: "separator" as const },
      ...model.actions.map((action) => ({
        label: action.label,
        enabled: action.enabled,
        click: () => runAction(action),
      })),
    ];
    tray.setContextMenu(Menu.buildFromTemplate(template));
  };

  const maybeNotify = (status: FleetStatus): void => {
    const decision = decideNotification(lastStatus, status, isAnyWindowFocused());
    if (decision.kind === "notify" && Notification.isSupported()) {
      new Notification({ title: decision.title, body: decision.body }).show();
    }
  };

  function subscribe(): void {
    const status = supervisor.getFleetStatus();
    lastStatus = status;
    render(status);
    unsubscribe = supervisor.onStatusChange((next) => {
      maybeNotify(next);
      lastStatus = next;
      render(next);
    });
  }

  subscribe();
  enableAutostart();

  tray.on("click", openDashboard);

  return tray;
}

/**
 * The tray icon image. This repo does not yet ship a dedicated branded tray asset (no `.ico`/`.png`
 * exists under this package), so this uses `nativeImage.createEmpty()` — Electron's documented,
 * crash-free placeholder for "no image yet" — rather than pointing `Tray` at a path that does not
 * exist (which throws at construction). Swapping in a branded icon is a follow-up asset task, not
 * a behavior change to this module.
 */
function trayIcon(): Electron.NativeImage {
  return nativeImage.createEmpty();
}
