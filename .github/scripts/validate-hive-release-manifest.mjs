#!/usr/bin/env node
// Validates `hive-release.json` against the schema documented in
// `hive-release.schema.md` (PRD-001a) and, for every product the manifest
// declares published, confirms the pinned version resolves on the public npm
// registry (PRD-001b b-AC-1/b-AC-2). Zero dependencies on purpose: the
// superproject root has no package.json/lockfile, so this must run with a
// bare `node` (>=18, for global fetch) and nothing else.
//
// Exit code 0  = every check passed (registry checks that were skipped
//                because a product is `published: false` do not count
//                against this).
// Exit code 1  = at least one check failed (malformed manifest, missing
//                required field, invalid semver, or a `published: true`
//                product whose pin does not resolve on the registry).
//
// Usage: node .github/scripts/validate-hive-release-manifest.mjs [path-to-manifest]

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REQUIRED_SLUGS = ['honeycomb', 'doctor', 'hive', 'nectar'];
const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const FALLBACK_PACKAGE_NAMES = {
  honeycomb: '@legioncodeinc/honeycomb',
  doctor: '@legioncodeinc/doctor',
  hive: '@legioncodeinc/hive',
  nectar: '@legioncodeinc/nectar',
};

const manifestPath = resolve(process.cwd(), process.argv[2] ?? 'hive-release.json');

/** @type {string[]} */
const errors = [];
/** @type {string[]} */
const notes = [];

function fail(message) {
  errors.push(message);
  console.error(`::error::${message}`);
}

function note(message) {
  notes.push(message);
  console.log(message);
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function registryHasVersion(packageName, version) {
  // Query the public npm registry's per-version document directly (no `npm`
  // CLI, no auth, no lockfile needed). A 200 means the version exists; a 404
  // means it genuinely does not (yet) exist, which is the expected shape for
  // an unpublished product and must never be treated as a crash.
  const url = `https://registry.npmjs.org/${encodeURIComponent(packageName).replace('%40', '@')}/${encodeURIComponent(version)}`;
  let response;
  try {
    // Bounded: a hung registry must not stall the PR-blocking validate job or a release train.
    response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (networkError) {
    return { ok: false, reason: `network error contacting the npm registry: ${networkError.message}` };
  }
  if (response.status === 200) {
    return { ok: true };
  }
  if (response.status === 404) {
    return { ok: false, reason: 'not found on the registry (404)' };
  }
  return { ok: false, reason: `unexpected registry response: HTTP ${response.status}` };
}

async function main() {
  console.log(`Validating manifest: ${manifestPath}`);

  let raw;
  try {
    raw = readFileSync(manifestPath, 'utf8');
  } catch (readError) {
    fail(`Could not read manifest at ${manifestPath}: ${readError.message}`);
    return finish();
  }

  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (parseError) {
    fail(`Manifest is not valid JSON: ${parseError.message}`);
    return finish();
  }

  if (!isPlainObject(manifest)) {
    fail('Manifest root must be a JSON object.');
    return finish();
  }

  // ── manifestVersion ────────────────────────────────────────────────────
  if (typeof manifest.manifestVersion !== 'string' || manifest.manifestVersion.trim() === '') {
    fail('`manifestVersion` is required and must be a non-empty string.');
  } else if (!SEMVER_RE.test(manifest.manifestVersion)) {
    fail(`\`manifestVersion\` ("${manifest.manifestVersion}") is not valid semver (expected x.y.z).`);
  } else {
    note(`manifestVersion: ${manifest.manifestVersion}`);
  }

  // ── products map ───────────────────────────────────────────────────────
  if (!isPlainObject(manifest.products)) {
    fail('`products` is required and must be an object.');
    return finish();
  }

  const actualSlugs = Object.keys(manifest.products);
  const missingSlugs = REQUIRED_SLUGS.filter((slug) => !actualSlugs.includes(slug));
  const unknownSlugs = actualSlugs.filter((slug) => !REQUIRED_SLUGS.includes(slug));

  if (missingSlugs.length > 0) {
    fail(`Manifest is missing required product pin(s): ${missingSlugs.join(', ')}.`);
  }
  if (unknownSlugs.length > 0) {
    fail(`Manifest has unrecognized product slug(s): ${unknownSlugs.join(', ')}. Required slugs are exactly: ${REQUIRED_SLUGS.join(', ')}.`);
  }

  // ── per-product checks ─────────────────────────────────────────────────
  const registryChecks = [];

  for (const slug of REQUIRED_SLUGS) {
    const entry = manifest.products[slug];
    if (entry === undefined) {
      // Already reported above as a missing slug; skip further checks on it.
      continue;
    }
    if (!isPlainObject(entry)) {
      fail(`products.${slug} must be an object (got ${typeof entry}).`);
      continue;
    }

    const version = entry.version;
    if (typeof version !== 'string' || version.trim() === '') {
      fail(`products.${slug}.version is required and must be a non-empty string (missing or empty pin is invalid by construction).`);
      continue;
    }
    if (!SEMVER_RE.test(version)) {
      fail(`products.${slug}.version ("${version}") is not valid semver (expected x.y.z, no "v" prefix, no ranges).`);
      continue;
    }

    if (entry.packageName !== undefined && (typeof entry.packageName !== 'string' || entry.packageName.trim() === '')) {
      fail(`products.${slug}.packageName, if present, must be a non-empty string.`);
      continue;
    }
    if (entry.published !== undefined && typeof entry.published !== 'boolean') {
      fail(`products.${slug}.published, if present, must be a boolean.`);
      continue;
    }

    const packageName = entry.packageName ?? FALLBACK_PACKAGE_NAMES[slug];
    const published = entry.published !== false; // default true

    if (!published) {
      note(`products.${slug}: NOT YET PUBLISHED (manifest declares \`published: false\`) — skipping registry resolution for ${packageName}@${version}. This is expected for a product that has not cut its first real release tag yet; it is not a failure.`);
      continue;
    }

    registryChecks.push({ slug, packageName, version });
  }

  if (registryChecks.length > 0) {
    const results = await Promise.all(
      registryChecks.map(async ({ slug, packageName, version }) => {
        const result = await registryHasVersion(packageName, version);
        return { slug, packageName, version, result };
      }),
    );
    for (const { slug, packageName, version, result } of results) {
      if (result.ok) {
        note(`products.${slug}: OK — ${packageName}@${version} resolves on the npm registry.`);
      } else {
        fail(`products.${slug}: pinned version ${packageName}@${version} does NOT resolve on the npm registry (${result.reason}).`);
      }
    }
  }

  return finish();
}

function finish() {
  console.log('');
  if (errors.length > 0) {
    console.error(`Manifest validation FAILED with ${errors.length} error(s):`);
    for (const message of errors) {
      console.error(`  - ${message}`);
    }
    process.exitCode = 1;
  } else {
    console.log(`Manifest validation PASSED (${notes.length} check(s) logged above).`);
    process.exitCode = 0;
  }
}

await main();
