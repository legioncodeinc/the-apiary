/**
 * PRD-005c: the system tray — the thin electron wrapper (c-AC-1, c-AC-2, c-AC-3).
 *
 * This wires the PURE cores ({@link buildTrayMenuModel}, {@link createNotificationGate},
 * {@link registerAutostartSettings}) to real electron surfaces (`Tray`, `Menu`, `Notification`,
 * `app.setLoginItemSettings`). The pure logic is unit-tested; this wrapper is integration-only (it
 * imports `electron`, so it is exercised by hand / e2e, not the node vitest env — like `main.ts`).
 *
 * The tray drives the SHARED {@link AppController} (005a/finding), NOT a private supervisor: it reads
 * the live supervisor's {@link FleetSupervisor.getFleetStatus} to render fleet state, subscribes via
 * {@link FleetSupervisor.onStatusChange} to re-render, and routes Open Dashboard / Restart Fleet /
 * Quit through the controller so restart swaps the ONE live instance for everyone (window + tray) and
 * Open Dashboard focuses the ONE main window instead of spawning a second (both were prior findings).
 *
 * Flow:
 *   1. Build the tray icon + menu from the current snapshot (c-AC-1); it works while the main
 *      window is closed because the tray, unlike the window, is never torn down by "closed".
 *   2. Subscribe to `onStatusChange`: re-render the menu/tooltip every tick, and run EVERY tick —
 *      including the INITIAL snapshot — through the notification gate to (maybe) fire a native
 *      `Notification` (c-AC-2). Re-subscribe to the NEW supervisor on a Restart Fleet swap.
 *   3. Register launch-at-login on setup (c-AC-3), gated to the platforms that support it.
 *   4. Wire actions: Open Dashboard focuses/creates the shared main window; Restart Fleet restarts the
 *      fleet through the controller; Quit stops the live supervisor then quits the app.
 */

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, Menu, nativeImage, Notification, Tray } from "electron";

import type { AppController } from "../main/app-controller.js";
import type { FleetStatus } from "../supervisor/index.js";
import { registerAutostartSettings, isAutostartSupported, unregisterAutostartSettings } from "./autostart.js";
import { buildTrayMenuModel, type TrayMenuAction } from "./menu-model.js";
import { createNotificationGate } from "./tray-controller.js";
import { resolveTrayIconPath } from "./tray-icon-path.js";

/** This compiled module's directory (`dist/tray`), used to resolve the branded icon asset. */
const thisDir = dirname(fileURLToPath(import.meta.url));

/**
 * Register launch-at-login (c-AC-3). Gated on {@link isAutostartSupported}: Electron documents
 * `setLoginItemSettings` as a no-op on Linux, so calling it there is dead effort (finding). Passes
 * the per-platform `args` (the Windows `--hidden` flag) so a login launch starts hidden to the tray
 * on every supported OS, not just macOS `openAsHidden` (finding).
 */
export function enableAutostart(): void {
  if (!isAutostartSupported(process.platform)) return;
  const settings = registerAutostartSettings(process.platform);
  app.setLoginItemSettings({
    openAtLogin: settings.openAtLogin,
    openAsHidden: settings.openAsHidden,
    args: [...settings.args],
  });
}

/** Unregister launch-at-login (symmetry for opt-out/uninstall paths). Same platform gate as enable. */
export function disableAutostart(): void {
  if (!isAutostartSupported(process.platform)) return;
  const settings = unregisterAutostartSettings();
  app.setLoginItemSettings({
    openAtLogin: settings.openAtLogin,
    openAsHidden: settings.openAsHidden,
    args: [...settings.args],
  });
}

/** True iff any BrowserWindow in this process currently has OS focus (drives c-AC-2 suppression). */
function isAnyWindowFocused(): boolean {
  return BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.isFocused());
}

/**
 * Create the system tray (c-AC-1, c-AC-2, c-AC-3). `main.ts` calls this once on `whenReady` after
 * the supervisor and main window are up, passing the SHARED controller. Returns the live `Tray`; it
 * is not destroyed on window close, so its actions keep working with the main window closed (c-AC-1).
 */
export function setupTray(controller: AppController): Tray {
  const tray = new Tray(trayIcon());

  const gate = createNotificationGate();
  let unsubscribe: (() => void) | undefined;

  const runAction = (action: TrayMenuAction): void => {
    if (action.id === "open-dashboard") controller.openOrFocusDashboard();
    else if (action.id === "restart-fleet") {
      void controller.restartFleet().catch((error) => {
        console.error("[tray] error restarting fleet:", error instanceof Error ? error.message : error);
      });
    } else {
      void controller
        .stop()
        .catch((error) => {
          console.error("[tray] error stopping supervisor on quit:", error instanceof Error ? error.message : error);
        })
        .finally(() => app.quit());
    }
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

  /** Run one status tick (initial OR change) through render + the notification gate (finding: the
   * initial snapshot must not bypass the notification decision). */
  const onTick = (status: FleetStatus): void => {
    const decision = gate.tick(status, isAnyWindowFocused());
    if (decision.kind === "notify" && Notification.isSupported()) {
      new Notification({ title: decision.title, body: decision.body }).show();
    }
    render(status);
  };

  /** (Re)bind to a supervisor: run its CURRENT snapshot through the tick path, then subscribe. */
  const bind = (): void => {
    unsubscribe?.();
    const supervisor = controller.getSupervisor();
    if (supervisor === undefined) return;
    onTick(supervisor.getFleetStatus());
    unsubscribe = supervisor.onStatusChange(onTick);
  };

  // Rebind to the NEW supervisor whenever Restart Fleet swaps it in. Reset the gate so the swapped
  // fleet's first tick is judged fresh (a new terminal failure after restart can notify again). The
  // tray lives for the whole app lifetime, so the swap subscription is intentionally never disposed.
  controller.onSupervisorSwap(() => {
    gate.reset();
    bind();
  });

  tray.on("click", () => controller.openOrFocusDashboard());

  bind();
  enableAutostart();

  return tray;
}

/**
 * The tray icon image: the branded Hive badge shipped under `assets/` (Windows `.ico`, a 32px PNG
 * elsewhere), resolved relative to this compiled module (see {@link resolveTrayIconPath}). If the
 * asset is somehow missing/unreadable, `nativeImage.createFromPath` yields an EMPTY image rather
 * than throwing; we detect that and fall back to `createEmpty()` so `new Tray(...)` never crashes
 * at construction (the crash-free property the previous placeholder guaranteed).
 */
function trayIcon(): Electron.NativeImage {
  const image = nativeImage.createFromPath(resolveTrayIconPath(thisDir, process.platform));
  return image.isEmpty() ? nativeImage.createEmpty() : image;
}
