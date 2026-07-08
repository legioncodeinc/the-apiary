/**
 * c-AC-6 (ADR-0005 decision 3): the single-supervisor-owner boundary. The shell owns exactly the two
 * roots (Doctor + Hive); Doctor owns the workloads. A supervisor never acts on a unit it doesn't own.
 */

import { describe, expect, it } from "vitest";

import { canActOn, isOwnedBy, shellOwns } from "../../src/service/ownership.js";

describe("shellOwns (the shell owns only the two roots)", () => {
  it("is true for doctor and hive", () => {
    expect(shellOwns("doctor")).toBe(true);
    expect(shellOwns("hive")).toBe(true);
  });
  it("is FALSE for every workload (Doctor owns those, not the shell)", () => {
    expect(shellOwns("honeycomb")).toBe(false);
    expect(shellOwns("nectar")).toBe(false);
    expect(shellOwns("embed")).toBe(false);
  });
});

describe("isOwnedBy", () => {
  it("doctor owns the workloads", () => {
    expect(isOwnedBy("doctor", "honeycomb")).toBe(true);
    expect(isOwnedBy("doctor", "nectar")).toBe(true);
    expect(isOwnedBy("doctor", "embed")).toBe(true);
  });
  it("doctor does NOT own the roots (the shell does)", () => {
    expect(isOwnedBy("doctor", "hive")).toBe(false);
    expect(isOwnedBy("shell", "hive")).toBe(true);
  });
});

describe("canActOn (the boundary decision, c-AC-6)", () => {
  it("allows the shell to act on a root it owns", () => {
    const d = canActOn("shell", "hive");
    expect(d.allowed).toBe(true);
  });
  it("FORBIDS the shell from acting on a workload it does not own", () => {
    const d = canActOn("shell", "honeycomb");
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain("does not own");
  });
  it("forbids acting on a daemon with no recorded owner", () => {
    expect(canActOn("shell", "unknown-daemon").allowed).toBe(false);
    expect(canActOn("doctor", "unknown-daemon").allowed).toBe(false);
  });
  it("allows Doctor to act on a workload it owns but forbids it on a root", () => {
    expect(canActOn("doctor", "nectar").allowed).toBe(true);
    expect(canActOn("doctor", "hive").allowed).toBe(false);
  });
});
