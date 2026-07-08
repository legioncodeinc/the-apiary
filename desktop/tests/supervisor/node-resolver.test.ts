/**
 * a-AC-1: the system-node resolver is defensive — finds a Node ≥22.5, rejects too-old / missing
 * with an actionable error, honors the explicit override, and never uses Electron's execPath.
 */

import { delimiter, join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  MIN_NODE_MAJOR,
  MIN_NODE_MINOR,
  NODE_OVERRIDE_ENV,
  NodeResolutionError,
  meetsMinimum,
  parseNodeVersion,
  resolveSystemNode,
} from "../../src/supervisor/node-resolver.js";

describe("parseNodeVersion", () => {
  it("parses a v-prefixed version", () => {
    expect(parseNodeVersion("v22.5.1\n")).toEqual({ major: 22, minor: 5, patch: 1 });
  });
  it("parses a bare version", () => {
    expect(parseNodeVersion("25.2.1")).toEqual({ major: 25, minor: 2, patch: 1 });
  });
  it("returns null for garbage", () => {
    expect(parseNodeVersion("not a version")).toBeNull();
  });
});

describe("meetsMinimum", () => {
  it(`accepts exactly ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}.0`, () => {
    expect(meetsMinimum({ major: MIN_NODE_MAJOR, minor: MIN_NODE_MINOR, patch: 0 })).toBe(true);
  });
  it("accepts a higher major even with a lower minor", () => {
    expect(meetsMinimum({ major: 25, minor: 0, patch: 0 })).toBe(true);
  });
  it("rejects a too-low minor on the min major", () => {
    expect(meetsMinimum({ major: MIN_NODE_MAJOR, minor: MIN_NODE_MINOR - 1, patch: 9 })).toBe(false);
  });
  it("rejects a too-low major", () => {
    expect(meetsMinimum({ major: MIN_NODE_MAJOR - 1, minor: 99, patch: 0 })).toBe(false);
  });
});

describe("resolveSystemNode (a-AC-1)", () => {
  it("resolves the first PATH node that reports a qualifying version", () => {
    // The resolver joins each PATH dir with the platform exe name via node:path.join, so the
    // expected candidate is built the SAME way — platform-neutral, no hardcoded separator (this
    // test runs green on both POSIX and Windows CI).
    const expected = join("/opt/node/bin", "node");
    const resolved = resolveSystemNode({
      // Join with the HOST's path delimiter: the resolver splits PATH with node:path.delimiter
      // (`;` on win32, `:` on POSIX), so building the PATH the same way keeps this test host-neutral.
      env: { PATH: ["/opt/node/bin", "/usr/bin"].join(delimiter) },
      platform: "linux",
      exists: (p) => p === expected,
      probeVersion: (p) => {
        expect(p).toBe(expected);
        return "v22.5.1\n";
      },
    });
    expect(resolved.path).toBe(expected);
    expect(resolved.version).toEqual({ major: 22, minor: 5, patch: 1 });
  });

  it("honors the explicit override env var before searching PATH", () => {
    const probeVersion = vi.fn((p: string) => {
      expect(p).toBe("/custom/node");
      return "v24.0.0";
    });
    const resolved = resolveSystemNode({
      env: { [NODE_OVERRIDE_ENV]: "/custom/node", PATH: "/usr/bin" },
      platform: "linux",
      exists: () => true,
      probeVersion,
    });
    expect(resolved.path).toBe("/custom/node");
    // Override wins on the first candidate; PATH's node is never probed.
    expect(probeVersion).toHaveBeenCalledTimes(1);
  });

  it("throws an actionable error naming the too-old version when only an old Node exists", () => {
    expect(() =>
      resolveSystemNode({
        env: { PATH: "/usr/bin" },
        platform: "linux",
        exists: () => true,
        probeVersion: () => "v20.11.0",
      }),
    ).toThrow(NodeResolutionError);
    try {
      resolveSystemNode({ env: { PATH: "/usr/bin" }, platform: "linux", exists: () => true, probeVersion: () => "v20.11.0" });
    } catch (error) {
      expect((error as Error).message).toContain("20.11.0");
      expect((error as Error).message).toContain(`>=${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}`);
    }
  });

  it("throws an actionable error when no node exists at all", () => {
    expect(() =>
      resolveSystemNode({ env: { PATH: "/usr/bin" }, platform: "linux", exists: () => false, probeVersion: () => "v25.0.0" }),
    ).toThrow(/Could not find a system Node/);
  });

  it("falls back to the Windows default node.exe path when PATH misses", () => {
    const resolved = resolveSystemNode({
      env: { PATH: "C:\\nowhere" },
      platform: "win32",
      exists: (p) => p === "C:\\Program Files\\nodejs\\node.exe",
      probeVersion: () => "v25.2.1",
    });
    expect(resolved.path).toBe("C:\\Program Files\\nodejs\\node.exe");
  });
});
