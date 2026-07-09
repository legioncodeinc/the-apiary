#!/usr/bin/env node
// site/install/build.mjs — DRY build step for the get.theapiary.sh install surface.
//
// PRD-050a follow-up (vanity domain + published checksum + inspect-before-piping page).
//
// SINGLE SOURCE OF TRUTH: the canonical installer scripts live at scripts/install/.
// This build COPIES them into the Cloudflare Pages publish dir (site/install/dist/),
// computes their SHA-256, and renders the inspect index.html from a template injecting
// the LIVE checksums + one-liners + the script source. Checksums are therefore computed
// from EXACTLY what gets deployed — self-consistent by construction.
//
// Run: `node build.mjs` (from site/install/, the Cloudflare Pages "build command").
// Emits: dist/{install.sh, install.ps1, uninstall.sh, uninstall.ps1, SHA256SUMS, index.html}
//
// Standalone tooling: pure Node ESM, no dependencies, never imported by the app build.
// It is NOT part of `tsc && esbuild` and never ships in the npm tarball.

import { createHash } from 'node:crypto';
import { mkdir, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Repo root is two levels up from site/install/.
const REPO_ROOT = join(__dirname, '..', '..');
const SRC_DIR = join(REPO_ROOT, 'scripts', 'install');
const DIST_DIR = join(__dirname, 'dist');
const TEMPLATE = join(__dirname, 'index.template.html');

const VANITY = 'https://get.theapiary.sh';
const GITHUB_SRC = 'https://github.com/legioncodeinc/the-apiary/tree/main/scripts/install';

// The install, uninstall, and update scripts, in the order they appear in SHA256SUMS + the page.
const SCRIPTS = ['install.sh', 'install.ps1', 'uninstall.sh', 'uninstall.ps1', 'update.sh', 'update.ps1'];

// PRD-002c: both installer scripts declare their PostHog key as an EMPTY string in source control
// (`HONEYCOMB_INSTALL_POSTHOG_KEY=""` / `$HoneycombInstallPosthogKey = ''`). This is a PostHog
// project API key — safe to expose client-side by design (ADR-0002) — so it is injected here at
// deploy-build time, the same "bake a public key into the install site" mechanism the ADR calls
// for, rather than a runtime secret lookup on the user's machine. Sourced from an env var so
// `deploy-install-site.yaml` can supply it as a plain (non-secret) repository variable.
//
// IMPORTANT: this is an ANCHORED, per-language regex substitution of the exact declaration line —
// deliberately NOT a blind find/replace of a placeholder token over the whole file. An earlier
// version of this build step used a shared placeholder token, which also appeared (by construction)
// in the scripts' own "is telemetry configured" empty-string guard once naively substituted,
// silently disabling telemetry forever after the very first real key was baked in. Anchoring the
// substitution to the ONE declaration line closes that class of bug structurally: nothing else in
// either script can accidentally match the pattern.
//
// An UNSET/empty env var leaves each script's declaration at its committed empty-string default,
// which both scripts' `phone_home`/`Send-PhoneHome` treat as "telemetry disabled" (never a hard
// failure) — so a keyless build (e.g. a PR preview, or local `node build.mjs`) still produces a
// fully working, just silently non-reporting, installer.
const POSTHOG_KEY = process.env.HONEYCOMB_INSTALL_POSTHOG_KEY ?? '';
// Defense-in-depth: only ever inject a key shaped like a PostHog project key. Anything else
// (accidental whitespace, an unrelated secret pasted into the wrong env var, …) is treated as
// "not set" rather than silently baked into a public, world-readable script.
const POSTHOG_KEY_SAFE = /^[A-Za-z0-9_-]{0,200}$/.test(POSTHOG_KEY) ? POSTHOG_KEY : '';

const POSTHOG_KEY_PATTERNS = {
  'install.sh': {
    pattern: /^HONEYCOMB_INSTALL_POSTHOG_KEY=""$/m,
    replace: (key) => `HONEYCOMB_INSTALL_POSTHOG_KEY="${key}"`,
  },
  'install.ps1': {
    pattern: /^\$HoneycombInstallPosthogKey = ''$/m,
    replace: (key) => `$HoneycombInstallPosthogKey = '${key}'`,
  },
  // PRD-007c: the update scripts declare the SAME public PostHog key with the SAME anchored
  // declaration line as the install scripts, so update_started / update_completed / update_failed /
  // product_updated report on the identical anonymous install-site channel. One key, injected the
  // same way — no second key, no new payload fields.
  'update.sh': {
    pattern: /^HONEYCOMB_INSTALL_POSTHOG_KEY=""$/m,
    replace: (key) => `HONEYCOMB_INSTALL_POSTHOG_KEY="${key}"`,
  },
  'update.ps1': {
    pattern: /^\$HoneycombInstallPosthogKey = ''$/m,
    replace: (key) => `$HoneycombInstallPosthogKey = '${key}'`,
  },
};

// Inject the key into one script's source text via its anchored pattern above. Throws (failing the
// build loudly) if the expected declaration line is missing — a silent no-op here would mean a
// refactor of install.sh/install.ps1 quietly broke telemetry injection without anyone noticing.
function injectPosthogKey(name, text, key) {
  const spec = POSTHOG_KEY_PATTERNS[name];
  if (spec === undefined) return text;
  if (!spec.pattern.test(text)) {
    throw new Error(
      `site/install build: expected declaration line for ${name} (pattern ${spec.pattern}) not found — ` +
        'the PostHog key injection point may have moved; update POSTHOG_KEY_PATTERNS in build.mjs.',
    );
  }
  return text.replace(spec.pattern, spec.replace(key));
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

// Minimal HTML escape for injecting raw script source into a <pre><code> block.
function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// String.replace/replaceAll interpret $-sequences in replacement text.
// Script sources contain many $ tokens, so use split/join for literal token replacement.
function replaceToken(text, token, value) {
  return text.split(token).join(value);
}

async function main() {
  // Clean slate so the dist mirrors EXACTLY the current canonical scripts (no stale copies).
  await rm(DIST_DIR, { recursive: true, force: true });
  await mkdir(DIST_DIR, { recursive: true });

  // 1) Copy canonical scripts + capture their bytes for hashing/rendering. The PostHog key is
  //    injected HERE (before hashing/writing) so SHA256SUMS always reflects exactly the bytes
  //    actually served — no separate "hash then patch" step that could ever drift.
  const sources = {};
  const sums = {};
  for (const name of SCRIPTS) {
    const srcPath = join(SRC_DIR, name);
    const rawText = await readFile(srcPath, 'utf8');
    const text = injectPosthogKey(name, rawText, POSTHOG_KEY_SAFE);
    const bytes = Buffer.from(text, 'utf8');
    await writeFile(join(DIST_DIR, name), bytes);
    sources[name] = text;
    sums[name] = sha256(bytes);
  }

  // 2) Write SHA256SUMS in the standard `<sha256>  <file>` format (two spaces => binary mode),
  //    verifiable with `sha256sum -c SHA256SUMS` from the dist dir.
  const sumsBody = SCRIPTS.map((name) => `${sums[name]}  ${name}`).join('\n') + '\n';
  await writeFile(join(DIST_DIR, 'SHA256SUMS'), sumsBody, 'utf8');

  // 2b) Copy the _headers rules into the PUBLISH dir. Cloudflare Pages only reads _headers from
  //     the build OUTPUT directory (dist/), NOT the project root — without this, the text/plain +
  //     nosniff rules on /install.sh|/install.ps1|/SHA256SUMS would never publish.
  await copyFile(join(__dirname, '_headers'), join(DIST_DIR, '_headers'));

  // 2c) Copy the canonical favicon from the shared branding set.
  await copyFile(join(REPO_ROOT, 'branding', 'honeycomb', 'logos', 'favicon.svg'), join(DIST_DIR, 'favicon.svg'));

  // 2c-bis) Copy the Pages ADVANCED-MODE worker into the publish dir root. A Direct-Upload deploy
  //     (`wrangler pages deploy site/install/dist`) uploads only this directory and does NOT
  //     compile a sibling `functions/` directory, so the bare "/" content negotiation (script for a
  //     pipe, page for a browser) MUST ship as a `_worker.js` at the root of the deployed output.
  //     Without it, "/" falls back to Pages' default static serving of index.html, and
  //     `curl -fsSL https://get.theapiary.sh | sh` pipes HTML into sh ("newline unexpected").
  await copyFile(join(__dirname, '_worker.js'), join(DIST_DIR, '_worker.js'));

  // 2d) Publish the fleet release manifest itself (PRD-009d). the-apiary is a PRIVATE repo, so
  //     the raw.githubusercontent.com URL the installers historically fetched returns 404 for
  //     anonymous users. The install site is the public distribution point, so the manifest
  //     deploys here as https://get.theapiary.sh/hive-release.json, right next to the scripts
  //     that consume it. The JSON.parse doubles as validation: a missing or malformed manifest
  //     fails this build loudly (the catch in main exits non-zero) instead of shipping a
  //     manifest the installers would then reject at run time.
  const manifestRaw = await readFile(join(REPO_ROOT, 'hive-release.json'), 'utf8');
  const manifest = JSON.parse(manifestRaw);
  await writeFile(join(DIST_DIR, 'hive-release.json'), manifestRaw, 'utf8');

  // 2e) Emit the blessed-version channel for Doctor auto-update (PRD-065).
  //     The superproject owns the fleet release manifest, so read honeycomb's pinned
  //     version from hive-release.json instead of a package.json in this root.
  const honeycombVersion = manifest?.products?.honeycomb?.version;
  if (typeof honeycombVersion !== 'string' || honeycombVersion.length === 0) {
    throw new Error('site/install build: hive-release.json is missing products.honeycomb.version');
  }
  const blessed = { version: honeycombVersion, generatedAt: new Date().toISOString() };
  await writeFile(join(DIST_DIR, 'blessed-version.json'), JSON.stringify(blessed, null, 2) + '\n', 'utf8');

  // 3) Render index.html from the template, injecting live values.
  const template = await readFile(TEMPLATE, 'utf8');
  const replacements = {
    '{{VANITY}}': VANITY,
    '{{GITHUB_SRC}}': GITHUB_SRC,
    '{{SHA_SH}}': sums['install.sh'],
    '{{SHA_PS1}}': sums['install.ps1'],
    '{{SHA_UNINSTALL_SH}}': sums['uninstall.sh'],
    '{{SHA_UNINSTALL_PS1}}': sums['uninstall.ps1'],
    '{{SHA_UPDATE_SH}}': sums['update.sh'],
    '{{SHA_UPDATE_PS1}}': sums['update.ps1'],
    '{{BUILT_AT}}': new Date().toISOString(),
    '{{SOURCE_SH}}': escapeHtml(sources['install.sh']),
    '{{SOURCE_PS1}}': escapeHtml(sources['install.ps1']),
    '{{SOURCE_UNINSTALL_SH}}': escapeHtml(sources['uninstall.sh']),
    '{{SOURCE_UNINSTALL_PS1}}': escapeHtml(sources['uninstall.ps1']),
    '{{SOURCE_UPDATE_SH}}': escapeHtml(sources['update.sh']),
    '{{SOURCE_UPDATE_PS1}}': escapeHtml(sources['update.ps1']),
  };
  let html = template;
  for (const [token, value] of Object.entries(replacements)) {
    html = replaceToken(html, token, value);
  }
  await writeFile(join(DIST_DIR, 'index.html'), html, 'utf8');

  // 4) Report (stdout is the Cloudflare Pages build log).
  console.log('site/install build complete → dist/');
  console.log('  install.sh   ', sums['install.sh']);
  console.log('  install.ps1  ', sums['install.ps1']);
  console.log('  uninstall.sh ', sums['uninstall.sh']);
  console.log('  uninstall.ps1', sums['uninstall.ps1']);
  console.log('  update.sh    ', sums['update.sh']);
  console.log('  update.ps1   ', sums['update.ps1']);
  console.log('  SHA256SUMS   written');
  console.log('  hive-release.json copied (fleet manifest, manifestVersion', `${manifest.manifestVersion})`);
  console.log('  blessed-version.json', honeycombVersion);
  console.log('  _headers     copied');
  console.log('  _worker.js   copied (Pages advanced-mode content negotiation for "/")');
  console.log('  favicon.svg  copied');
  console.log('  index.html   rendered');
  console.log(
    '  posthog key  ',
    POSTHOG_KEY_SAFE.length > 0
      ? 'baked (install-time telemetry ENABLED)'
      : 'NOT set (HONEYCOMB_INSTALL_POSTHOG_KEY env var absent/invalid — install-time telemetry stays disabled, matches the no-op default)',
  );
}

main().catch((err) => {
  console.error('site/install build FAILED:', err);
  process.exit(1);
});
