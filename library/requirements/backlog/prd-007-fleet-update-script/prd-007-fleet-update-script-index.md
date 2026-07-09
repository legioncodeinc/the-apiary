# PRD-007: One-Command Fleet Update Script

> **Status:** Backlog
> **Priority:** P1 (users can install and uninstall the fleet in one command, but have no supported way to *update* it; the only paths today are the background Doctor auto-update, PRD-065, and re-running the installer, which is a fresh-install flow, not an update flow)
> **Effort:** M (3-8h) across three sub-PRDs; sub-PRD A alone is the core and is S (< 1d).
> **Schema changes:** None to any Deeplake catalog. Adds two published scripts (`update.sh` / `update.ps1`), their `SHA256SUMS` entries and inspect-page rows, two `build.mjs` list entries, one `_worker.js` route, and three new PostHog event names on the install-site telemetry channel (`update_started` / `update_completed` / `update_failed`), reusing the existing `product_updated` per-product event.

---

## Overview

`get.theapiary.sh` serves two one-command lifecycle scripts today: **install** (`curl -fsSL https://get.theapiary.sh | sh`) and **uninstall** (`curl -fsSL https://get.theapiary.sh/uninstall | sh`). It serves no **update**. A user who installed the fleet weeks ago and wants the current release has no supported explicit path: re-running the installer is a *fresh-install* flow (it takes the portal path on a bare invocation, installs Hive, opens onboarding, and only converges already-present products as a side effect), and the background Doctor auto-update (PRD-065, driven by [`blessed-version.json`](../../../../site/install/build.mjs)) is silent, watchdog-scoped, and not something a user can invoke or reason about.

This PRD ships the third lifecycle script — **`curl -fsSL https://get.theapiary.sh/update | sh`** (and a PowerShell twin for `irm ... | iex`) — a user-invoked, whole-fleet update that:

1. Detects which Apiary products are actually installed on the machine and, by default, updates each to its **`hive-release.json` manifest-pinned (blessed) version** — matching the installer's deliberate no-`@latest` invariant ([`install.sh`](../../../../scripts/install/install.sh) b-AC-2, `resolve_product_target`). A single explicit escape hatch, **`--latest`**, overrides the manifest and targets each package's npm `latest` dist-tag instead, for the operator who knowingly wants the newest published bytes ahead of a blessed cut (with a printed warning that this bypasses the tested fleet set).
2. Restarts the relevant services after a successful package update, so the running daemons load the new code rather than continuing to run the old bytes.
3. Detects which coding-assistant harnesses are installed, and for any harness with a delivered plugin (Claude Code first), installs the newest plugin version into its correct location and refreshes the harness to pick it up — falling back to plain-language user instructions when an automatic refresh is not possible.
4. Fires an install-site PostHog event on the same anonymous channel the installer uses (`update_started` first, exactly one of `update_completed` / `update_failed` at the terminal state, plus one `product_updated` per product actually moved), reusing the installer's payload shape and anonymous install id.
5. Leaves the user on a plain-language completion summary that names what moved, what restarted, and any remaining manual step.

Like `uninstall.sh`, the update script is a self-contained POSIX `sh` orchestrator that lives beside its siblings in [`scripts/install/`](../../../../scripts/install/), is copied + checksummed by [`site/install/build.mjs`](../../../../site/install/build.mjs), routed by [`_worker.js`](../../../../site/install/_worker.js), and deployed by the existing [`deploy-install-site.yaml`](../../../../.github/workflows/deploy-install-site.yaml) on a superproject `v*` tag. It is **idempotent**: on a machine already at the blessed versions it makes no npm mutation, restarts nothing, and reports "already up to date."

The doc lives in the-apiary because this is a fleet-level concern spanning the installer scripts (`scripts/install/`), the install site (`site/install/`), and the honeycomb submodule (harness detection, the plugin connector, and the reconcile seam). The script itself is new; the honeycomb-side seams it leans on already exist.

## Priority framing (read this first)

- **A is the core.** Package updates to the blessed versions + service restart is the whole reason the script exists; it must land first and is independently useful even before B and C.
- **B is the harness/plugin half.** It closes the same gap PRD-006 closes for install — a package update that bumps the plugin bundle is invisible inside Claude Code until the plugin is reinstalled and the harness refreshed. B reuses PRD-006's connector + reconcile seams rather than re-deriving them.
- **C is the delivery + telemetry surface.** Routes, checksums, the inspect page, the deploy flow, and the three new update events. Without C the script exists in the repo but is not reachable at `get.theapiary.sh/update` and reports nothing.

---

## Code-grounded current state

Every row is verified against the installer scripts at repo root and the honeycomb submodule at its current pin.

| Area | Where | Today | Gap |
|---|---|---|---|
| Lifecycle scripts served | [`site/install/_worker.js`](../../../../site/install/_worker.js):42-87 | Special-cases `GET /` (install) and `GET /uninstall` for shell-vs-page content negotiation; every other path falls through to static assets. | No `/update` route. A shell client hitting `/update` would fall through to assets and 404 (no `update.sh` exists). |
| Script build + checksums | [`site/install/build.mjs`](../../../../site/install/build.mjs):35 | `SCRIPTS = ['install.sh', 'install.ps1', 'uninstall.sh', 'uninstall.ps1']` are copied, SHA-256'd into `SHA256SUMS`, and their source injected into the inspect page. | `update.sh` / `update.ps1` are not in the list, so they are not built, checksummed, or shown on the inspect page. |
| Manifest-pinned version resolution | [`install.sh`](../../../../scripts/install/install.sh):559-590 (`resolve_product_target`, `resolve_core_product_target`) | Resolves each product's `packageName` / `version` / `published` from `hive-release.json` (`fetch_manifest`, `manifest_field`), with safe-shape validation, returning `ok <pkg>@<ver>` / `unpublished` / `unresolved`. | This is exactly the resolver the update script needs to compute each installed product's *blessed* target; it lives in `install.sh` and must be shared (or mirrored) by `update.sh`. |
| Installed-product detection | [`uninstall.sh`](../../../../scripts/install/uninstall.sh):657-692 (`remove_npm_packages`) | Probes `npm ls -g <pkg> --depth=0` per package in the frozen coverage inventory (`@legioncodeinc/{honeycomb,nectar,hive,doctor}`, `@deeplake/hivemind`). | The same `npm ls -g` probe is the authoritative "is this product installed?" signal the update script needs; no shared helper exists yet. |
| Service inventory | [`uninstall.sh`](../../../../scripts/install/uninstall.sh):30-58 | Current + legacy labels for launchd (`com.legioncode.{honeycomb,nectar,doctor,hive}`), systemd (`{honeycomb,nectar,doctor,hive}.service`), and Windows tasks. | The restart step needs the *current* labels (legacy ones are for cleanup only); the inventory exists but is uninstall-shaped (remove, not restart). |
| Per-product service converge verbs | [`install.sh`](../../../../scripts/install/install.sh):761-773, 836-847, 1168 | Each product ships an idempotent service verb the installer already drives: `honeycomb install`, `hive install-service`, `nectar install`, `doctor install-service`. | The update script reuses these to converge + restart a product's service after its package bumps, rather than hand-rolling launchd/systemd/schtasks restart logic. |
| Running-daemon recycle | [`uninstall.sh`](../../../../scripts/install/uninstall.sh):474-647 (`stop_daemon_pidfile`, `stop_daemons_by_process_scan`) | Reads per-product pid files and process-scans for the scoped package marker, verifying a live `node` process before signalling (pid-reuse safe). | A freshly `npm i -g`'d package does not restart the already-running daemon; that daemon keeps running old code until recycled. The pid-file + node-verify pattern is the safe primitive to reuse. |
| Doctor watchdog | [`install.sh`](../../../../scripts/install/install.sh):106-110, 762-771 | Doctor is a second global that registers an OS service and restarts the primary daemon on crash + survives reboot. | Restarting a daemon *by killing it* can let Doctor race to restart it on old code before the converge verb runs; ordering (converge/point at new bytes, then recycle) matters. |
| Harness detection | [`honeycomb/src/daemon/runtime/dashboard/harness-detect.ts`](../../../../honeycomb/src/daemon/runtime/dashboard/harness-detect.ts):69-72,131 | `detectInstalledHarnesses()` reports each harness present/absent (claude-code present when `~/.claude/settings.json` OR `~/.claude/plugins/honeycomb` exists). | The update script needs the same "which harnesses are here?" answer; it can invoke a honeycomb CLI/daemon surface rather than re-implementing detection in shell. |
| Plugin connector + refresh | [`honeycomb/src/connectors/claude-code.ts`](../../../../honeycomb/src/connectors/claude-code.ts):137-165, [`plugin-runner.ts`](../../../../honeycomb/src/connectors/plugin-runner.ts):104,111, [`auto-wiring.ts`](../../../../honeycomb/src/notifications/auto-wiring.ts):38-48 | `install()` runs `marketplace add/update` + `plugin install honeycomb@honeycomb` + `enable` (idempotent); `available()` / `isPluginEnabled()` are cheap probes; `createAutoWiring().wire()` delegates to `connector.install()`. Re-running `honeycomb setup` by hand refreshes a stale plugin (confirmed in PRD-006). | The refresh-after-update path is exactly `honeycomb setup` / the reconcile — but nothing triggers it after an *update*. A new plugin bundle shipped by the package bump is invisible in Claude Code until the plugin is reinstalled + the session refreshed. |
| Install-site telemetry | [`install.sh`](../../../../scripts/install/install.sh):244-270 (`phone_home`), 995-1003 (`finish`) | Fires `install_started` first, exactly one of `install_completed` / `install_failed` at the terminal state, plus `product_installed` / `product_updated` / `product_removed`, all with an anonymous `install-id` and an allow-listed payload, via a public PostHog key baked at deploy time. | No `update_*` events exist. The update script must reuse the identical transport, key-injection seam, anonymous id, and payload shape, adding only the three new event names (and reusing `product_updated`). |
| Key injection at build | [`build.mjs`](../../../../site/install/build.mjs):62-86 (`POSTHOG_KEY_PATTERNS`, `injectPosthogKey`) | Anchored per-file regex substitution of the one `HONEYCOMB_INSTALL_POSTHOG_KEY=""` declaration line in each script; throws if the anchor is missing. | `update.sh` / `update.ps1` must carry the identical anchor line and be registered in `POSTHOG_KEY_PATTERNS` so the deploy bakes the same public key into them. |
| Blessed-version channel | [`build.mjs`](../../../../site/install/build.mjs):158-166 | Emits `blessed-version.json` (honeycomb's manifest-pinned version) for Doctor auto-update (PRD-065). | Confirms "blessed = manifest-pinned" is the fleet's existing notion of the current release; the update script targets the same versions, making the explicit update and the background auto-update converge on one release set. |

---

## Sub-features

| Sub-PRD | Scope | Priority | Status |
|---|---|---|---|
| [`prd-007a-...-package-updates-and-service-restart`](./prd-007a-fleet-update-script-package-updates-and-service-restart.md) | The core `update.sh` / `update.ps1`: detect installed products, resolve each to its `hive-release.json` blessed version, `npm i -g` only those that moved, converge + restart their services, idempotent no-op when already current. | P1 core | Backlog |
| [`prd-007b-...-harness-and-plugin-refresh`](./prd-007b-fleet-update-script-harness-and-plugin-refresh.md) | Detect installed harnesses; for each with a delivered plugin (Claude Code first), reinstall the newest plugin and refresh the harness via the PRD-006 connector/reconcile seam; print manual instructions when a refresh can't be automated. | P1 | Backlog |
| [`prd-007c-...-site-delivery-and-telemetry`](./prd-007c-fleet-update-script-site-delivery-and-telemetry.md) | Serve `/update` (+ `/update.sh` / `/update.ps1`) with `text/plain` + `nosniff`; add the scripts to `build.mjs`, `SHA256SUMS`, `_headers`, and the inspect page; deploy on the existing `v*` flow; add `update_started` / `update_completed` / `update_failed` and reuse `product_updated`. | P1 | Backlog |

---

## Acceptance criteria (module-level)

| ID | Criterion |
|---|---|
| AC-1 | `curl -fsSL https://get.theapiary.sh/update \| sh` on a machine with the fleet installed at an older release updates every installed Apiary npm package to its `hive-release.json` manifest-pinned (blessed) version by default — never a bare `@latest` unless `--latest` is passed — and reports each version that moved (old → new). |
| AC-1b | With `--latest`, every installed package targets its npm `latest` dist-tag instead of the manifest pin; the run prints a one-line warning that this bypasses the blessed fleet set, and is otherwise identical (idempotent, per-product fail-soft, same telemetry). Default (no flag) is always blessed. |
| AC-2 | After a successful package update, each updated product's service is converged and restarted so the running daemon serves the new code, verified by the daemon reporting the new version on its health/status surface. |
| AC-3 | The script is idempotent: on a machine already at the blessed versions it performs no `npm install`, restarts no service, and reports "already up to date" with exit 0. |
| AC-4 | Only *installed* products are touched: a product not present (`npm ls -g` reports absent) is neither installed nor updated by this script — it is an update, not an installer. |
| AC-5 | The script reports which harnesses are installed, and for each harness with a delivered plugin (Claude Code), the newest plugin is installed into its correct location and the harness is refreshed to pick it up; when an automatic refresh is impossible, a plain-language instruction (e.g. "restart Claude Code to load the updated plugin") is printed instead of silently doing nothing. |
| AC-6 | The PowerShell twin (`irm https://get.theapiary.sh/update.ps1 \| iex`) achieves AC-1..AC-5 on Windows, including scheduled-task/service restart. |
| AC-7 | `update_started` fires before any resolution work; exactly one of `update_completed` / `update_failed` fires at the terminal state; one `product_updated` fires per product actually moved — all on the same anonymous install-site channel, key seam, install id, and payload shape as the installer, with no PII and no license/code values. |
| AC-8 | `GET /update`, `/update.sh`, and `/update.ps1` serve `text/plain` with `nosniff`; `SHA256SUMS` contains entries for both scripts; `sha256sum -c` verifies against the served bytes; the inspect page shows their checksums and source. |
| AC-9 | No step is destructive or blocking on failure: a manifest hiccup, an npm failure on one product, a service that won't restart, or an un-refreshable harness each degrade to a clear message and a non-blocking continue/summary; the script never removes a package, never deletes state, and never leaves a daemon stopped that it could not restart without saying so. |
| AC-10 | Running the update script requires no pre-installed Apiary tooling beyond what it is updating (Node/npm and `curl`); it never assumes the honeycomb CLI is on PATH before it resolves it, mirroring the installer's bootstrap posture. |

---

## Data model changes

No Deeplake catalog changes. Persistent and behavioral effects:

- **Two new published scripts** (`update.sh`, `update.ps1`) in `scripts/install/`, copied + checksummed into the install-site deploy.
- **Install-state read (optional):** the script MAY read `~/.honeycomb/install-state.json` (the installer's last-selected-products bookkeeping) as a hint, but the authoritative "installed" signal is `npm ls -g`; the update script does not need to rewrite install-state.
- **Telemetry:** three new event names on the existing install-site PostHog channel; no new payload fields, no new key. The anonymous `~/.honeycomb/install-id` is read (and minted if absent) exactly as the installer does.

---

## API and configuration changes

- **Site (C):** `_worker.js` gains a `/update` branch mirroring `/uninstall`; `build.mjs` `SCRIPTS` gains `update.sh` / `update.ps1` and the inspect template gains `{{SHA_UPDATE_SH}}` / `{{SHA_UPDATE_PS1}}` + source tokens; `_headers` pins `text/plain` + `nosniff` for the new routes; `POSTHOG_KEY_PATTERNS` gains entries for the two new scripts.
- **Shared resolver (A):** the manifest resolution + safe-shape helpers (`resolve_product_target`, `npm_package_name_is_safe`, `semver_is_safe`, `fetch_manifest`, `manifest_field`) are shared with `update.sh` — either by extracting a common sourced fragment or by a deliberate, documented mirror kept in sync (the installer already tolerates small mirrored duplication; see the open question).
- **Harness/plugin (B):** reuses honeycomb's existing surfaces — `detectInstalledHarnesses()`, the connector `install()` / `available()` / `isPluginEnabled()`, and the PRD-006 reconcile — invoked through a honeycomb CLI verb (e.g. `honeycomb setup` / a `honeycomb reconcile` seam), not re-implemented in shell.

---

## Decided

- [x] **Resolver: mirror, don't share.** `update.sh` carries its own copy of the manifest resolver (`resolve_product_target`, `fetch_manifest`, `manifest_field`, `npm_package_name_is_safe`, `semver_is_safe`), mirroring the ~120 lines with a sync note, exactly as `install.ps1` mirrors `install.sh`. Keeps each script a single self-contained file; a `SYNC:` comment on both copies flags the duplication for maintainers.
- [x] **Service restart: converge-first, recycle-only-if-needed.** After a product's package moves, run its idempotent converge verb (`honeycomb install`, `hive install-service`, `nectar install`, `doctor install-service`) to point the OS service at the new bytes and health-check it; recycle the running daemon via its pid file (live-node-verified, per `uninstall.sh`) **only** if the converge verb does not itself restart it — and always *after* converge, so Doctor cannot race-restart old code. `doctor` (the watchdog) converges last.
- [x] **`--dry-run` parity.** `update.sh` mirrors `install.sh --dry-run`: resolve every product's current→target decision and the services it would restart, mutate nothing, send no real telemetry (preview the events only).

## Open questions

- [ ] **Version-gap detection under `--latest`.** In the default (blessed) mode the script compares `npm ls -g <pkg>` against the manifest `version` and skips when equal (cheap, offline, so `product_updated` only fires on a real move). Under `--latest` there is no manifest pin to compare against; compare the installed version to `npm view <pkg> version` (one network call/product) and skip when equal, vs always `npm i -g <pkg>@latest` and let npm no-op? Proposed: `npm view` compare, so the idempotent no-op and single-`product_updated`-per-move properties hold in both modes.
- [ ] **Whole-fleet vs selected-only.** Should the update also *converge* the plugin/harness wiring for products that were installed but whose harness plugin drifted (overlap with PRD-006b's reconcile), or strictly update-in-place what is present? Proposed: update-in-place + trigger the existing reconcile once (do not duplicate PRD-006b's loop).
- [ ] **Relationship to Doctor auto-update (PRD-065).** With Doctor already auto-updating to `blessed-version.json`, is the explicit script mostly for machines without Doctor, or a user-facing "update everything now" regardless? Proposed: user-facing, whole-fleet, Doctor-independent — it must work with `--no-doctor` installs — and it simply converges on the same blessed set, so the two never fight.
- [ ] **`--dry-run` parity.** The installer's `--dry-run` (resolve + print, mutate nothing) is a strong pattern; should `update.sh` mirror it (preview which products would move and to what version, and which harnesses would refresh)? Proposed: yes — same flag, same "resolve everything, send/mutate nothing, still preview the telemetry" behavior.

---

## Out of scope

- **Changing the update *policy* / cadence.** Doctor's background auto-update (PRD-065, `blessed-version.json`) owns automatic, unattended updates. This PRD ships the explicit, user-invoked script; it does not change when or whether Doctor auto-updates.
- **Node/npm major upgrades.** The installer pins and provisions a Node LTS (`HONEYCOMB_NODE_VERSION`); bumping the provisioned Node runtime is an installer concern, not an update-script concern. The update script assumes a working Node/npm (and reports plainly if it is missing).
- **The plugin/MCP/skill *implementation*.** PRD-006 (and honeycomb PRD-075/076) own the plugin surface and its reliable delivery on install; this PRD only ensures an *update* reinstalls the newest shipped plugin and refreshes the harness. It does not alter the plugin's contents or the reconcile design.
- **Partial / per-product update selection.** The script is whole-fleet over what is installed; a `--products=` narrowing (like the installer's) is a possible later addition, not this PRD.
- **Rollback / downgrade.** Moving to an *older* pinned version, or reverting a bad update, is a separate concern; this script moves forward to the blessed set only.
- **Server-side / team state.** Machine-local only, exactly like install and uninstall.

---

## Prior art

- [`PRD-002` One-Line Installer Product Loading and Install-Time Telemetry](../../completed/prd-002-installer-product-loading-and-phone-home/prd-002-installer-product-loading-and-phone-home-index.md) — the manifest-pinned resolution (`resolve_product_target`), the anonymous install-id + `phone_home` telemetry channel, and the `product_installed`/`product_updated`/`product_removed` events this PRD reuses.
- [`PRD-003` Fleet Lifecycle, Login Deferral, and One-Command Uninstall](../../completed/prd-003-fleet-lifecycle-login-and-uninstall/prd-003-fleet-lifecycle-login-and-uninstall-index.md) — the sibling one-command lifecycle script (`uninstall.sh`), whose structure, coverage inventory, service handling, pid-file recycle, `/dev/tty` posture, and site routing this PRD mirrors. See especially [`PRD-003d`](../../completed/prd-003-fleet-lifecycle-login-and-uninstall/prd-003d-fleet-lifecycle-login-and-uninstall-global-uninstall-script.md).
- [`PRD-006` Reliable Claude Code Plugin Delivery and Auto-Wiring](../../in-work/prd-006-claude-code-plugin-delivery-and-auto-wiring/prd-006-claude-code-plugin-delivery-and-auto-wiring-index.md) — the connector, `available()`/`isPluginEnabled()` probes, `createAutoWiring().wire()`, and the self-healing reconcile that sub-PRD B triggers after an update.
- [`PRD-005` Desktop Shell](../../in-work/prd-005-desktop-shell/prd-005-desktop-shell-index.md) — adjacent fleet-supervision surface (`prd-005d` packaging/updates/distribution) that will eventually host an in-app "update available" affordance over this same blessed set.
- honeycomb PRD-065 (Doctor auto-update) — the background counterpart to this explicit script; both converge on `blessed-version.json` / the `hive-release.json` pinned versions.
- [`site/install/README.md`](../../../../site/install/README.md), [`build.mjs`](../../../../site/install/build.mjs), [`_worker.js`](../../../../site/install/_worker.js), [`_headers`](../../../../site/install/_headers), [`index.template.html`](../../../../site/install/index.template.html) — the build/serve surface gaining the update routes and checksums.
- [`.github/workflows/deploy-install-site.yaml`](../../../../.github/workflows/deploy-install-site.yaml) — the deploy flow, unchanged in shape, that also ships the update scripts on a superproject `v*` tag.
