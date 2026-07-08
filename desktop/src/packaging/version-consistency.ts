/**
 * PRD-005d d-AC-8: verify the desktop app's declared fleet-dependency versions match the pinned
 * release manifest (`hive-release.json` at the superproject root — see PRD-001/PRD-001a), and
 * FAIL the build on any mismatch rather than silently shipping a skewed fleet.
 *
 * Shape reference (`hive-release.json`, read at audit time):
 * ```json
 * {
 *   "manifestVersion": "0.7.0",
 *   "products": {
 *     "honeycomb": { "version": "0.6.0", "packageName": "@legioncodeinc/honeycomb", "published": true },
 *     "doctor":    { "version": "0.4.2", "packageName": "@legioncodeinc/doctor",    "published": true },
 *     "hive":      { "version": "0.6.8", "packageName": "@legioncodeinc/hive",      "published": true },
 *     "nectar":    { "version": "0.3.3", "packageName": "@legioncodeinc/nectar",    "published": true }
 *   }
 * }
 * ```
 *
 * This module is pure: it takes the PARSED manifest object and the desktop app's OWN declared
 * fleet-dependency versions (conceptually, its `package.json` `dependencies`/`optionalDependencies`
 * entries for `@legioncodeinc/{honeycomb,doctor,hive,nectar}`, or — until those are wired as real
 * npm deps — an equivalent declared-versions map the build script assembles) as plain data, and
 * returns a typed report. It never reads the filesystem itself (that is the caller's job, e.g. a
 * `scripts/check-fleet-versions.mjs` build step that `JSON.parse`s both files and calls this),
 * which keeps it unit-testable with no real disk I/O — mirroring node-resolver.ts's seam
 * discipline of "pure decision logic in the module, I/O pushed to the edge".
 */

/** One product entry from `hive-release.json`'s `products` map. */
export interface ManifestProductEntry {
  readonly version: string;
  readonly packageName: string;
  readonly published: boolean;
}

/** The parsed shape of `hive-release.json` (only the fields this check reads). */
export interface HiveReleaseManifest {
  readonly manifestVersion: string;
  readonly products: Readonly<Record<string, ManifestProductEntry>>;
}

/** The four fleet products the desktop shell depends on and supervises (ADR-0005). */
export const REQUIRED_FLEET_PRODUCTS = ["honeycomb", "doctor", "hive", "nectar"] as const;
export type FleetProductName = (typeof REQUIRED_FLEET_PRODUCTS)[number];

/** The desktop app's own declared version for each fleet product, keyed the same way as the manifest. */
export type DeclaredFleetVersions = Readonly<Partial<Record<FleetProductName, string>>>;

/** One product's consistency verdict. */
export type ProductVersionCheck =
  | { readonly kind: "match"; readonly product: FleetProductName; readonly version: string }
  | {
      readonly kind: "mismatch";
      readonly product: FleetProductName;
      readonly manifestVersion: string;
      readonly declaredVersion: string;
    }
  /** The desktop app declares no version at all for a product the manifest requires. */
  | { readonly kind: "missing-declaration"; readonly product: FleetProductName; readonly manifestVersion: string }
  /** The manifest itself has no entry for a required product — a manifest defect, not a desktop-app defect. */
  | { readonly kind: "missing-from-manifest"; readonly product: FleetProductName };

/** The full report: per-product checks plus the overall pass/fail. */
export interface VersionConsistencyReport {
  readonly checks: readonly ProductVersionCheck[];
  /** True iff every required product matched. A build script should exit non-zero when this is false (d-AC-8). */
  readonly ok: boolean;
}

/**
 * Compare the desktop app's declared fleet versions against the pinned `hive-release.json`
 * manifest. Checks all of {@link REQUIRED_FLEET_PRODUCTS}, even after the first mismatch, so a
 * single run surfaces every discrepancy rather than failing fast on the first one.
 */
export function checkVersionConsistency(
  manifest: HiveReleaseManifest,
  declared: DeclaredFleetVersions,
): VersionConsistencyReport {
  const checks: ProductVersionCheck[] = REQUIRED_FLEET_PRODUCTS.map((product) => {
    const manifestEntry = manifest.products[product];
    const declaredVersion = declared[product];

    if (manifestEntry === undefined) {
      return { kind: "missing-from-manifest", product };
    }
    if (declaredVersion === undefined) {
      return { kind: "missing-declaration", product, manifestVersion: manifestEntry.version };
    }
    if (declaredVersion !== manifestEntry.version) {
      return {
        kind: "mismatch",
        product,
        manifestVersion: manifestEntry.version,
        declaredVersion,
      };
    }
    return { kind: "match", product, version: declaredVersion };
  });

  const ok = checks.every((check) => check.kind === "match");
  return { checks, ok };
}

/**
 * Render a report as a single human-readable, actionable multi-line message — never a raw
 * stack, matching the fleet's "actionable error" convention (see node-resolver.ts). Intended for
 * a build script to print then `process.exit(1)` on `report.ok === false`.
 */
export function formatVersionConsistencyReport(report: VersionConsistencyReport): string {
  if (report.ok) {
    return "Fleet version consistency: OK — all pinned products match hive-release.json.";
  }

  const lines = ["Fleet version consistency check FAILED:"];
  for (const check of report.checks) {
    switch (check.kind) {
      case "match":
        continue;
      case "mismatch":
        lines.push(
          `  - ${check.product}: desktop declares ${check.declaredVersion}, manifest pins ${check.manifestVersion}. ` +
            `Update the desktop app's declared dependency to ${check.manifestVersion}, or bump hive-release.json if the desktop app is intentionally ahead.`,
        );
        break;
      case "missing-declaration":
        lines.push(
          `  - ${check.product}: manifest pins ${check.manifestVersion} but the desktop app declares no version for it. ` +
            `Add a pinned dependency on ${check.product}@${check.manifestVersion}.`,
        );
        break;
      case "missing-from-manifest":
        lines.push(
          `  - ${check.product}: the desktop app requires this product but hive-release.json has no entry for it. ` +
            `Add ${check.product} to hive-release.json's products map.`,
        );
        break;
    }
  }
  lines.push("Refusing to package a skewed fleet — fix the mismatch above and re-run.");
  return lines.join("\n");
}
