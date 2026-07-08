/**
 * d-AC-8: the desktop app's declared fleet-dependency versions must match hive-release.json's
 * pinned versions; any mismatch, missing declaration, or missing manifest entry must report
 * `ok: false` so a build script can fail rather than ship a skewed fleet.
 */

import { describe, expect, it } from "vitest";

import {
  REQUIRED_FLEET_PRODUCTS,
  checkVersionConsistency,
  formatVersionConsistencyReport,
  type HiveReleaseManifest,
} from "../../src/packaging/version-consistency.js";

/** Mirrors the real hive-release.json shape read at audit time (see prd-005d + module doc). */
const REAL_SHAPED_MANIFEST: HiveReleaseManifest = {
  manifestVersion: "0.7.0",
  products: {
    honeycomb: { version: "0.6.0", packageName: "@legioncodeinc/honeycomb", published: true },
    doctor: { version: "0.4.2", packageName: "@legioncodeinc/doctor", published: true },
    hive: { version: "0.6.8", packageName: "@legioncodeinc/hive", published: true },
    nectar: { version: "0.3.3", packageName: "@legioncodeinc/nectar", published: true },
  },
};

describe("checkVersionConsistency", () => {
  it("passes when every declared version matches the manifest exactly", () => {
    const report = checkVersionConsistency(REAL_SHAPED_MANIFEST, {
      honeycomb: "0.6.0",
      doctor: "0.4.2",
      hive: "0.6.8",
      nectar: "0.3.3",
    });
    expect(report.ok).toBe(true);
    expect(report.checks).toHaveLength(REQUIRED_FLEET_PRODUCTS.length);
    expect(report.checks.every((c) => c.kind === "match")).toBe(true);
  });

  it("FAILS the check on a single-product version mismatch", () => {
    const report = checkVersionConsistency(REAL_SHAPED_MANIFEST, {
      honeycomb: "0.5.9", // stale — manifest pins 0.6.0
      doctor: "0.4.2",
      hive: "0.6.8",
      nectar: "0.3.3",
    });
    expect(report.ok).toBe(false);
    const honeycombCheck = report.checks.find((c) => c.product === "honeycomb");
    expect(honeycombCheck).toEqual({
      kind: "mismatch",
      product: "honeycomb",
      manifestVersion: "0.6.0",
      declaredVersion: "0.5.9",
    });
  });

  it("FAILS when the desktop app declares no version for a required product", () => {
    const report = checkVersionConsistency(REAL_SHAPED_MANIFEST, {
      honeycomb: "0.6.0",
      doctor: "0.4.2",
      hive: "0.6.8",
      // nectar intentionally omitted
    });
    expect(report.ok).toBe(false);
    const nectarCheck = report.checks.find((c) => c.product === "nectar");
    expect(nectarCheck).toEqual({ kind: "missing-declaration", product: "nectar", manifestVersion: "0.3.3" });
  });

  it("FAILS when the manifest itself has no entry for a required product", () => {
    const manifestMissingHive: HiveReleaseManifest = {
      manifestVersion: "0.7.0",
      products: {
        honeycomb: REAL_SHAPED_MANIFEST.products.honeycomb!,
        doctor: REAL_SHAPED_MANIFEST.products.doctor!,
        nectar: REAL_SHAPED_MANIFEST.products.nectar!,
        // hive intentionally omitted from the manifest
      },
    };
    const report = checkVersionConsistency(manifestMissingHive, {
      honeycomb: "0.6.0",
      doctor: "0.4.2",
      hive: "0.6.8",
      nectar: "0.3.3",
    });
    expect(report.ok).toBe(false);
    const hiveCheck = report.checks.find((c) => c.product === "hive");
    expect(hiveCheck).toEqual({ kind: "missing-from-manifest", product: "hive" });
  });

  it("surfaces every mismatch in one pass rather than failing fast on the first", () => {
    const report = checkVersionConsistency(REAL_SHAPED_MANIFEST, {
      honeycomb: "0.5.9",
      doctor: "0.4.0",
      hive: "0.6.8",
      nectar: "0.3.3",
    });
    expect(report.ok).toBe(false);
    const mismatches = report.checks.filter((c) => c.kind === "mismatch");
    expect(mismatches).toHaveLength(2);
  });

  it("is pure: identical input yields identical output", () => {
    const declared = { honeycomb: "0.6.0", doctor: "0.4.2", hive: "0.6.8", nectar: "0.3.3" };
    expect(checkVersionConsistency(REAL_SHAPED_MANIFEST, declared)).toEqual(
      checkVersionConsistency(REAL_SHAPED_MANIFEST, declared),
    );
  });
});

describe("formatVersionConsistencyReport", () => {
  it("renders a clean one-liner when everything matches", () => {
    const report = checkVersionConsistency(REAL_SHAPED_MANIFEST, {
      honeycomb: "0.6.0",
      doctor: "0.4.2",
      hive: "0.6.8",
      nectar: "0.3.3",
    });
    expect(formatVersionConsistencyReport(report)).toMatch(/OK/);
  });

  it("renders an actionable, per-product message on failure — never a raw stack", () => {
    const report = checkVersionConsistency(REAL_SHAPED_MANIFEST, {
      honeycomb: "0.5.9",
      doctor: "0.4.2",
      hive: "0.6.8",
      nectar: "0.3.3",
    });
    const message = formatVersionConsistencyReport(report);
    expect(message).toMatch(/FAILED/);
    expect(message).toMatch(/honeycomb/);
    expect(message).toMatch(/0\.6\.0/);
    expect(message).toMatch(/0\.5\.9/);
  });
});
