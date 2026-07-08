/**
 * PRD-005c (c-AC-3): the pure launch-at-login settings computation. Verifies the register form asks
 * for `openAtLogin: true` (hidden to the tray, not popping the window), the unregister form is the
 * exact symmetric opposite, and platform support is scoped to macOS/Windows (Electron documents
 * Linux as a no-op for `setLoginItemSettings`).
 */

import { describe, expect, it } from "vitest";

import {
  HIDDEN_LOGIN_FLAG,
  isAutostartSupported,
  registerAutostartSettings,
  unregisterAutostartSettings,
  wasLaunchedHidden,
} from "../../src/tray/autostart.js";

describe("registerAutostartSettings (c-AC-3)", () => {
  it("requests openAtLogin: true on every supported platform", () => {
    expect(registerAutostartSettings("darwin").openAtLogin).toBe(true);
    expect(registerAutostartSettings("win32").openAtLogin).toBe(true);
  });

  it("uses macOS openAsHidden for a hidden start on darwin (no login flag needed)", () => {
    const mac = registerAutostartSettings("darwin");
    expect(mac.openAsHidden).toBe(true);
    expect(mac.args).toEqual([]);
  });

  it("uses the --hidden login flag on Windows (openAsHidden is macOS-only there)", () => {
    // finding: openAsHidden is a no-op on Windows, so the hidden start must ride an args flag.
    const win = registerAutostartSettings("win32");
    expect(win.openAsHidden).toBe(false);
    expect(win.args).toEqual([HIDDEN_LOGIN_FLAG]);
  });
});

describe("unregisterAutostartSettings (c-AC-3 symmetry)", () => {
  it("requests openAtLogin: false", () => {
    expect(unregisterAutostartSettings().openAtLogin).toBe(false);
  });

  it("requests openAsHidden: false and no args", () => {
    expect(unregisterAutostartSettings().openAsHidden).toBe(false);
    expect(unregisterAutostartSettings().args).toEqual([]);
  });

  it("is the exact inverse of the darwin register form", () => {
    const registered = registerAutostartSettings("darwin");
    const unregistered = unregisterAutostartSettings();
    expect(unregistered.openAtLogin).toBe(!registered.openAtLogin);
    expect(unregistered.openAsHidden).toBe(!registered.openAsHidden);
  });
});

describe("wasLaunchedHidden (cross-platform hidden-start detection)", () => {
  it("is true when Electron reports the macOS openAtLogin hidden launch", () => {
    expect(wasLaunchedHidden([], true)).toBe(true);
  });

  it("is true when the Windows --hidden login flag is present in argv", () => {
    expect(wasLaunchedHidden(["electron.exe", HIDDEN_LOGIN_FLAG], false)).toBe(true);
  });

  it("is false for a normal user-initiated launch (no flag, not opened-at-login)", () => {
    expect(wasLaunchedHidden(["electron.exe"], false)).toBe(false);
  });
});

describe("isAutostartSupported", () => {
  it("supports darwin", () => {
    expect(isAutostartSupported("darwin")).toBe(true);
  });

  it("supports win32", () => {
    expect(isAutostartSupported("win32")).toBe(true);
  });

  it("does not claim support for linux (Electron documents it as a no-op there)", () => {
    expect(isAutostartSupported("linux")).toBe(false);
  });

  it("does not claim support for an unknown platform string", () => {
    expect(isAutostartSupported("freebsd")).toBe(false);
  });
});
