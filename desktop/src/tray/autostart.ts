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
  /** Launch minimized/hidden to the tray rather than popping the main window on login. */
  readonly openAsHidden: boolean;
}

/** The settings to register launch-at-login, hidden to the tray (ADR-0005: the app is now the autostart owner). */
export function registerAutostartSettings(): LoginItemSettings {
  return { openAtLogin: true, openAsHidden: true };
}

/** The settings to unregister launch-at-login (symmetry for uninstall / user opt-out). */
export function unregisterAutostartSettings(): LoginItemSettings {
  return { openAtLogin: false, openAsHidden: false };
}

/**
 * Platforms Electron's `setLoginItemSettings` meaningfully supports. Linux is excluded — Electron
 * documents the call as a no-op there, so the wrapper should not rely on it for autostart on Linux.
 */
export type AutostartPlatform = "darwin" | "win32";

/** Whether `app.setLoginItemSettings` has real effect on this platform (c-AC-3 scoping: Windows/macOS). */
export function isAutostartSupported(platform: string): platform is AutostartPlatform {
  return platform === "darwin" || platform === "win32";
}
