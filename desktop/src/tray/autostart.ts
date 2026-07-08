/**
 * PRD-005c (c-AC-3): the PURE launch-at-login settings computation.
 *
 * No `electron` import. Computes the exact argument object the electron wrapper passes to
 * `app.setLoginItemSettings(...)` for both the register and unregister forms, so the "what do we
 * ask the OS for" decision is unit-tested without a real Electron `app` singleton.
 *
 * Electron's `setLoginItemSettings` shape differs slightly by platform (macOS/Windows accept
 * `openAtLogin`/`openAsHidden`/`path`/`args`; Linux is unsupported and a no-op). This module only
 * computes the settings object — the wrapper decides whether to call the API at all (e.g. skip on
 * an unsupported platform) and passes `process.execPath`/argv itself, since those are runtime facts
 * this pure module should not need to know about to be tested.
 */

/** The subset of Electron's `Settings` (app.setLoginItemSettings) this module computes. */
export interface LoginItemSettings {
  readonly openAtLogin: boolean;
  /**
   * macOS-only hidden-start signal. Electron honors `openAsHidden` ONLY on darwin; on Windows it is
   * ignored, so a hidden start there is driven by {@link HIDDEN_LOGIN_FLAG} in {@link args} instead.
   */
  readonly openAsHidden: boolean;
  /**
   * Login-launch argv appended to the executable. On Windows this carries {@link HIDDEN_LOGIN_FLAG}
   * so the app can start minimized to the tray (Windows has no `openAsHidden`); empty elsewhere.
   */
  readonly args: readonly string[];
}

/**
 * The CLI flag Electron passes at login-launch (Windows) to request a hidden/tray start. The app
 * reads {@link wasLaunchedHidden} at startup and, when true, does not pop the main window. macOS uses
 * `openAsHidden` for the same effect, so the flag is not needed there.
 */
export const HIDDEN_LOGIN_FLAG = "--hidden";

/**
 * Platforms Electron's `setLoginItemSettings` meaningfully supports. Linux is excluded — Electron
 * documents the call as a no-op there, so the wrapper should not rely on it for autostart on Linux.
 */
export type AutostartPlatform = "darwin" | "win32";

/** Whether `app.setLoginItemSettings` has real effect on this platform (c-AC-3 scoping: Windows/macOS). */
export function isAutostartSupported(platform: string): platform is AutostartPlatform {
  return platform === "darwin" || platform === "win32";
}

/**
 * The settings to register launch-at-login, started hidden to the tray (ADR-0005: the app is the
 * autostart owner). Per-platform: macOS gets `openAsHidden: true`; Windows gets the
 * {@link HIDDEN_LOGIN_FLAG} in `args` because it has no `openAsHidden` (finding: without a
 * cross-platform hidden signal the window still pops on Windows login).
 */
export function registerAutostartSettings(platform: string = process.platform): LoginItemSettings {
  const isMac = platform === "darwin";
  const isWindows = platform === "win32";
  return {
    openAtLogin: true,
    openAsHidden: isMac,
    args: isWindows ? [HIDDEN_LOGIN_FLAG] : [],
  };
}

/** The settings to unregister launch-at-login (symmetry for uninstall / user opt-out). */
export function unregisterAutostartSettings(): LoginItemSettings {
  return { openAtLogin: false, openAsHidden: false, args: [] };
}

/** True iff the process was login-launched hidden, either via macOS `openAsHidden` or the Windows flag. */
export function wasLaunchedHidden(
  argv: readonly string[],
  openedAtLoginHidden: boolean,
): boolean {
  return openedAtLoginHidden || argv.includes(HIDDEN_LOGIN_FLAG);
}
