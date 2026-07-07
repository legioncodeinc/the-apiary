/**
 * Boundary (ADR-0005 decision 3): the pid-liveness no-op. A restart consults the pid file first;
 * a LIVE pid means "already alive" so the shell never double-spawns. Total on missing/garbage files.
 */

import { describe, expect, it } from "vitest";

import { isPidAlive, isRootAlreadyAlive, readPidFile } from "../../src/supervisor/pid-liveness.js";

describe("isPidAlive", () => {
  it("returns false for a non-positive or non-integer pid", () => {
    expect(isPidAlive(0)).toBe(false);
    expect(isPidAlive(-1)).toBe(false);
    expect(isPidAlive(1.5)).toBe(false);
  });
  it("returns true for the current process pid", () => {
    expect(isPidAlive(process.pid)).toBe(true);
  });
  it("returns false for a pid that is almost certainly dead", () => {
    // A very high pid is overwhelmingly unlikely to be live in a test runner.
    expect(isPidAlive(2_000_000_000)).toBe(false);
  });
});

describe("readPidFile", () => {
  it("parses a positive integer pid", () => {
    expect(readPidFile("/whatever", () => "  4242\n")).toBe(4242);
  });
  it("returns null on a missing file", () => {
    expect(
      readPidFile("/missing", () => {
        throw Object.assign(new Error("nope"), { code: "ENOENT" });
      }),
    ).toBeNull();
  });
  it("returns null on garbage content", () => {
    expect(readPidFile("/whatever", () => "not a pid")).toBeNull();
  });
});

describe("isRootAlreadyAlive (boundary no-op)", () => {
  it("is true when the pid file names a live pid", () => {
    expect(isRootAlreadyAlive("/pid", { readFile: () => "4242", isPidAlive: (pid) => pid === 4242 })).toBe(true);
  });
  it("is false when the pid file names a dead pid (so the caller spawns)", () => {
    expect(isRootAlreadyAlive("/pid", { readFile: () => "4242", isPidAlive: () => false })).toBe(false);
  });
  it("is false when there is no pid file (so the caller spawns)", () => {
    expect(
      isRootAlreadyAlive("/pid", {
        readFile: () => {
          throw Object.assign(new Error("nope"), { code: "ENOENT" });
        },
        isPidAlive: () => true,
      }),
    ).toBe(false);
  });
});
