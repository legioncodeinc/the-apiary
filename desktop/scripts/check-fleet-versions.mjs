#!/usr/bin/env node
// PRD-005d d-AC-8: fail the desktop build if its declared fleet-dependency versions drift from
// the pinned release manifest (`hive-release.json` at the superproject root).
//
// This is the I/O EDGE around the pure `checkVersionConsistency` core in
// `src/packaging/version-consistency.ts` (compiled to `dist/packaging/version-consistency.js` by
// `tsc` — this script therefore runs AFTER `npm run build`, which is why `npm run dist` chains
// `build` before invoking electron-builder). All file reads and JSON parsing happen HERE, at the
// edge; the imported module never touches the filesystem itself (mirrors the root
// `.github/scripts/validate-hive-release-manifest.mjs`'s "zero-dependency Node script reading
// hive-release.json" pattern, reused here for the desktop package's own consistency gate).
//
// The desktop app does not yet declare the four fleet products as real npm
// dependencies (honeycomb/doctor/hive/nectar ship as built bundles per 005a's sidecar-Node
// design, not as `dependencies` entries in THIS package.json) — so this script reads the
// declared versions from an explicit `fleetVersions` block in desktop/package.json, which is the
// single place the desktop app pins what it expects the fleet to be. Wiring the real submodule
// consumption (npm-installed tarballs or vendored `dist/`) is a follow-up; this script's CONTRACT
// (fail loudly on drift) does not change when that lands — only where `declared` is read from.
//
// Exit code 0 = every required product's declared version matches hive-release.json.
// Exit code 1 = at least one mismatch, missing declaration, or missing manifest entry.
//
// Usage: node scripts/check-fleet-versions.mjs [path-to-hive-release.json]

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkVersionConsistency, formatVersionConsistencyReport } from "../dist/packaging/version-consistency.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(__dirname, "..");
// Default: the superproject root's hive-release.json, two levels up from desktop/.
const defaultManifestPath = resolve(desktopRoot, "..", "hive-release.json");
const manifestPath = resolve(process.cwd(), process.argv[2] ?? defaultManifestPath);

function readJson(path, label) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    console.error(`::error::Could not read ${label} at ${path}: ${error.message}`);
    process.exit(1);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.error(`::error::${label} at ${path} is not valid JSON: ${error.message}`);
    process.exit(1);
  }
}

function main() {
  console.log(`Checking fleet version consistency against ${manifestPath}`);

  const manifest = readJson(manifestPath, "hive-release.json");
  const desktopPackageJsonPath = resolve(desktopRoot, "package.json");
  const desktopPackageJson = readJson(desktopPackageJsonPath, "desktop/package.json");

  // The desktop app's declared expectation for each fleet product's version. Today this is an
  // explicit `fleetVersions` block (see module doc); if absent entirely, treat as "declares
  // nothing" so the report surfaces missing-declaration for every product rather than crashing.
  const declared = desktopPackageJson.fleetVersions ?? {};

  const report = checkVersionConsistency(manifest, declared);
  console.log(formatVersionConsistencyReport(report));

  process.exitCode = report.ok ? 0 : 1;
}

main();
