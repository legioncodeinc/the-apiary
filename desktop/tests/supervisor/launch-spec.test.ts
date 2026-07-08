/**
 * a-AC-1 + a-AC-7: the launch spec spawns the RESOLVED sidecar node (never Electron's execPath)
 * with an ARGV ARRAY (a resolved *.js CLI entry + a verb) — no shell string, no `.cmd`. Ports are
 * the fixed loopback contract (doctor 3852, hive 3853).
 */

import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { LaunchSpecError, ROOT_PORTS, buildRootLaunchSpecs, resolveCliEntry } from "../../src/supervisor/launch-spec.js";

const SIDECAR = "/opt/node/bin/node";

describe("resolveCliEntry", () => {
  it("resolves the doctor CLI entry under an injected global root", () => {
    // Build the expected entry via node:path.join (the same call the resolver uses), so the
    // assertion is separator-neutral and green on both POSIX and Windows CI.
    const expected = join("/g/node_modules", "@legioncodeinc/doctor", "bundle", "cli.js");
    const entry = resolveCliEntry("doctor", {
      globalRoots: ["/g/node_modules"],
      exists: (p) => p === expected,
    });
    expect(entry).toBe(expected);
  });

  it("resolves the hive CLI entry under an injected global root", () => {
    const expected = join("/g/node_modules", "@legioncodeinc/hive", "dist", "cli.js");
    const entry = resolveCliEntry("hive", {
      globalRoots: ["/g/node_modules"],
      exists: (p) => p === expected,
    });
    expect(entry).toBe(expected);
  });

  it("throws an actionable error when the global CLI is missing", () => {
    expect(() => resolveCliEntry("hive", { globalRoots: ["/g/node_modules"], exists: () => false })).toThrow(LaunchSpecError);
    try {
      resolveCliEntry("hive", { globalRoots: ["/g/node_modules"], exists: () => false });
    } catch (error) {
      expect((error as Error).message).toContain("@legioncodeinc/hive");
      expect((error as Error).message).toContain("npm i -g");
    }
  });
});

describe("buildRootLaunchSpecs (a-AC-1 / a-AC-7)", () => {
  const specs = buildRootLaunchSpecs(SIDECAR, {
    globalRoots: ["/g/node_modules"],
    exists: () => true,
    home: "/home/me",
  });

  it("starts doctor first, then hive", () => {
    expect(specs.map((s) => s.name)).toEqual(["doctor", "hive"]);
  });

  it("uses the resolved sidecar node as the command, NEVER Electron's execPath (a-AC-1)", () => {
    for (const spec of specs) {
      expect(spec.command).toBe(SIDECAR);
      // A defensive sanity check: the command is a node path, not an electron/app binary.
      expect(spec.command.toLowerCase()).not.toContain("electron");
    }
  });

  it("passes an argv ARRAY (cli entry + verb), never a shell string (a-AC-7)", () => {
    for (const spec of specs) {
      expect(Array.isArray(spec.args)).toBe(true);
      // argv[0] is a resolved *.js entry (never a .cmd, so shell:false is always legal on Windows).
      expect(spec.args[0]).toMatch(/cli\.js$/);
      expect(spec.args[0]).not.toMatch(/\.cmd$/);
      expect(spec.args[1]).toBe("start");
      // No element concatenates into a shell command: each is a discrete, non-empty token.
      for (const arg of spec.args) {
        expect(typeof arg).toBe("string");
        expect(arg.length).toBeGreaterThan(0);
      }
    }
  });

  it("binds the fixed loopback ports and loopback-only /health URLs", () => {
    const doctor = specs.find((s) => s.name === "doctor");
    const hive = specs.find((s) => s.name === "hive");
    expect(doctor?.port).toBe(ROOT_PORTS.doctor);
    expect(doctor?.port).toBe(3852);
    expect(hive?.port).toBe(ROOT_PORTS.hive);
    expect(hive?.port).toBe(3853);
    expect(doctor?.healthUrl).toBe("http://127.0.0.1:3852/health");
    expect(hive?.healthUrl).toBe("http://127.0.0.1:3853/health");
  });
});
