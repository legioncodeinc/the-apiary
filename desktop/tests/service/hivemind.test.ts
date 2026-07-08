/**
 * c-AC-8 (ADR-0005 decision 5): the standalone @deeplake/hivemind decision machine + uninstall argv,
 * INCLUDING the credential-preservation invariant — no code path may target `~/.deeplake`.
 */

import { describe, expect, it } from "vitest";

import {
  assertNoProtectedPath,
  buildStandaloneUninstall,
  decideStandalone,
  findProtectedPath,
  isStandalonePresent,
  npmUninstallCommand,
} from "../../src/service/hivemind.js";
import type { OsContext } from "../../src/service/service-manager.js";
import type { Command } from "../../src/service/service-manager.js";

const winCtx: OsContext = { os: "windows", homeDir: "C:/Users/dev", uid: 0 };
const macCtx: OsContext = { os: "macos", homeDir: "/Users/dev", uid: 501 };

describe("isStandalonePresent / decideStandalone", () => {
  it("proceeds when nothing is detected", () => {
    expect(isStandalonePresent({ npmGlobal: false, serviceUnit: false, livePort: false })).toBe(false);
    expect(decideStandalone({ npmGlobal: false, serviceUnit: false, livePort: false }).kind).toBe("proceed");
  });
  it("requires a prompt when ANY signal fires (npm global / service unit / live port)", () => {
    expect(decideStandalone({ npmGlobal: true, serviceUnit: false, livePort: false }).kind).toBe("prompt-required");
    expect(decideStandalone({ npmGlobal: false, serviceUnit: true, livePort: false }).kind).toBe("prompt-required");
    expect(decideStandalone({ npmGlobal: false, serviceUnit: false, livePort: true }).kind).toBe("prompt-required");
  });
});

describe("npmUninstallCommand", () => {
  it("is `npm uninstall -g @deeplake/hivemind` and is NOT tolerated (a real failure must surface)", () => {
    const cmd = npmUninstallCommand();
    expect([cmd.file, ...cmd.args]).toEqual(["npm", "uninstall", "-g", "@deeplake/hivemind"]);
    expect(cmd.tolerateFailure).toBe(false);
  });
});

describe("buildStandaloneUninstall (service teardown THEN npm uninstall)", () => {
  it("ends with the npm uninstall and includes service-deregister argv before it", () => {
    const commands = buildStandaloneUninstall(winCtx);
    const last = commands[commands.length - 1];
    expect(last?.file).toBe("npm");
    // Service teardown ran first (schtasks on Windows).
    expect(commands.some((c) => c.file === "schtasks")).toBe(true);
  });

  it("NEVER references ~/.deeplake on any platform (credential-preservation invariant, c-AC-8)", () => {
    expect(findProtectedPath(buildStandaloneUninstall(winCtx))).toBeUndefined();
    expect(findProtectedPath(buildStandaloneUninstall(macCtx))).toBeUndefined();
  });
});

describe("assertNoProtectedPath (the invariant guard)", () => {
  it("throws if a command ever points at the protected .deeplake dir", () => {
    const evil: Command[] = [{ id: "rm-data", file: "rm", args: ["-rf", "/Users/dev/.deeplake"], tolerateFailure: true }];
    expect(() => assertNoProtectedPath(evil)).toThrowError(/credential-preservation invariant/);
  });
  it("throws for a trailing-slash .deeplake path", () => {
    const evil: Command[] = [
      { id: "rm-data", file: "rm", args: ["-rf", "/Users/dev/.deeplake/credentials.json"], tolerateFailure: true },
    ];
    expect(() => assertNoProtectedPath(evil)).toThrowError(/credential-preservation invariant/);
  });
  it("throws for a bare `.deeplake` token and a backslash path", () => {
    expect(() =>
      assertNoProtectedPath([{ id: "x", file: "rm", args: [".deeplake"], tolerateFailure: true }]),
    ).toThrowError(/credential-preservation invariant/);
    expect(() =>
      assertNoProtectedPath([
        { id: "x", file: "rmdir", args: ["C:\\Users\\dev\\.deeplake"], tolerateFailure: true },
      ]),
    ).toThrowError(/credential-preservation invariant/);
  });
  it("does NOT throw for an unrelated path that merely contains the substring", () => {
    const fine: Command[] = [
      { id: "ok", file: "rm", args: ["-f", "/Users/dev/.deeplake-backup-notes.txt"], tolerateFailure: true },
    ];
    // `.deeplake-backup-notes.txt` is a different token, not the protected dir.
    expect(() => assertNoProtectedPath(fine)).not.toThrow();
  });
});
