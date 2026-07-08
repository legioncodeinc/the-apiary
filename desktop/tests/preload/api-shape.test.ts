/**
 * PRD-005b (b-AC-3): the preload bridge surface is MINIMAL and explicitly enumerated. No raw
 * ipcRenderer key, no generic invoke, no spawn/file/network capability. The enumerated key list and
 * the channel list are the source of truth the concrete preload asserts against.
 */

import { describe, expect, it } from "vitest";

import { APIARY_API_KEYS, APIARY_IPC_CHANNELS } from "../../src/preload/api-shape.js";

describe("apiary preload surface (b-AC-3)", () => {
  it("exposes exactly the four enumerated keys", () => {
    expect([...APIARY_API_KEYS].sort()).toEqual(
      ["onAuthWindowClosed", "onFleetStatus", "openAuthWindow", "version"].sort(),
    );
  });

  it("does NOT enumerate any raw ipc / invoke / spawn / file / network capability", () => {
    const forbidden = ["ipcRenderer", "ipc", "invoke", "send", "on", "spawn", "exec", "fs", "readFile", "fetch"];
    for (const key of APIARY_API_KEYS) {
      expect(forbidden).not.toContain(key);
    }
  });

  it("allow-lists exactly the three IPC channels the bridge uses", () => {
    expect(Object.values(APIARY_IPC_CHANNELS).sort()).toEqual(
      ["apiary:auth-window-closed", "apiary:fleet-status", "apiary:open-auth-window"].sort(),
    );
  });

  it("freezes the enumerations so nothing can be appended at runtime", () => {
    expect(Object.isFrozen(APIARY_API_KEYS)).toBe(true);
    expect(Object.isFrozen(APIARY_IPC_CHANNELS)).toBe(true);
  });
});
