/**
 * PRD-005c (c-AC-3): the pure launch-at-login settings computation. Verifies the register form asks
 * for `openAtLogin: true` (hidden to the tray, not popping the window), the unregister form is the
 * exact symmetric opposite, and platform support is scoped to macOS/Windows (Electron documents
 * Linux as a no-op for `setLoginItemSettings`).
 */

import { describe, expect, it } from "vitest";

import { isAutostartSupported, registerAutostartSettings, unregisterAutostartSettings } from "../../src/tray/autostart.js";

describe("registerAutostartSettings (c-AC-3)", () => {
  it("requests openAtLogin: true", () => {
    expect(registerAutostartSettings().openAtLogin).toBe(true);
  });

  it("requests openAsHidden: true so login does not pop the main window", () => {
    expect(registerAutostartSettings().openAsHidden).toBe(true);
  });
});

describe("unregisterAutostartSettings (c-AC-3 symmetry)", () => {
  it("requests openAtLogin: false", () => {
    expect(unregisterAutostartSettings().openAtLogin).toBe(false);
  });

  it("requests openAsHidden: false", () => {
    expect(unregisterAutostartSettings().openAsHidden).toBe(false);
  });

  it("is the exact inverse of the register form", () => {
    const registered = registerAutostartSettings();
    const unregistered = unregisterAutostartSettings();
    expect(unregistered.openAtLogin).toBe(!registered.openAtLogin);
    expect(unregistered.openAsHidden).toBe(!registered.openAsHidden);
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
