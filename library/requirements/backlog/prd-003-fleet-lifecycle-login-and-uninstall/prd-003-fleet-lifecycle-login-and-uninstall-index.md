# PRD-003: Fleet Lifecycle, Login Deferral, and One-Command Uninstall

> **Status:** Backlog
> **Priority:** P0 (non-technical users can hang at login and have no clean exit path today; install, login, and uninstall are the trust surfaces at the top and bottom of the funnel)
> **Effort:** XL (> 3d)
> **Schema changes:** None to any Deeplake catalog. Adds doctor registry deletes on uninstall and one new published install-site artifact (the uninstall script and its checksums).

---

## Overview

The Apiary's front door is `curl -fsSL https://get.theapiary.sh | sh`; there is no back door. Once installed, the fleet's login story is also split-brained: hive owns an onboarding login step (a device-flow proxy to honeycomb's `/setup/login` + `/setup/state`, rendered in [`hive/src/dashboard/web/onboarding/login-step.tsx`](../../../../hive/src/dashboard/web/onboarding/login-step.tsx)), but honeycomb can also open its own browser popup, and nectar has no login verb at all - it silently waits for someone else to write the shared `~/.deeplake/credentials.json`. A non-technical user who installs alongside hive can get *two* competing login prompts; a solo nectar user gets *zero* and a daemon that stays degraded forever with no path forward.

This module makes the fleet's lifecycle legible to a non-technical user, end to end. The organizing rule: **authentication is a HIVE concern when hive is present; solo installs self-serve.** Four pillars:

1. **Solo-vs-fleet detection and login deferral.** honeycomb and nectar detect whether hive is installed alongside them. With hive: they never open a browser popup or prompt, and report degraded on `/health` until hive-side login writes the shared credentials. Solo: on first install with no `~/.deeplake/credentials.json`, they open the device-flow login popup automatically. `honeycomb login` and a new `nectar login` open the popup directly in both modes.
2. **Lifecycle command parity.** Every product exposes `uninstall` (removes the OS service unit, the doctor registry entry, and the product's state dir) plus `start` and `stop` fronting the existing daemon lifecycle, so nectar, doctor, and hive reach parity with honeycomb's `daemon start|stop|status`.
3. **Doctor purge.** A new explicitly destructive, confirmation-gated `doctor purge` (with `--yes` for non-interactive use) that wipes every Apiary asset on the machine, current and legacy names included, removing doctor itself last.
4. **One-command uninstall script.** `curl -fsSL https://get.theapiary.sh/uninstall | sh` (plus a PowerShell twin), sourced from [`scripts/install/`](../../../../scripts/install/) beside `install.sh` / `install.ps1`, deployed and checksummed through the existing [`deploy-install-site.yaml`](../../../../.github/workflows/deploy-install-site.yaml) flow, covering every historical product and package name.

Background this builds on (already shipped in fleet 0.5.1): every install/readiness health probe treats an ANSWERING degraded daemon (503 `/health` with storage unreachable, the pre-login state) as up ([`hive/src/shared/fleet-readiness.ts`](../../../../hive/src/shared/fleet-readiness.ts)); only an explicit no-response fails a gate. That is the substrate that makes "defer login, sit degraded, never hang the install" a safe posture. Hive's dashboard login step also already has retry/restart-login buttons.

---

## Goals

- **One login owner per machine.** When hive is present, hive's onboarding is the only surface that initiates login; honeycomb and nectar never race it with their own popups or prompts.
- **No silent dead-ends solo.** A solo honeycomb or nectar install without credentials opens the device-flow popup automatically on first install, and `honeycomb login` / the new `nectar login` re-open it on demand in either mode.
- **Every product has a full lifecycle vocabulary:** `start`, `stop`, and `uninstall` on honeycomb, nectar, doctor, and hive, with `uninstall` removing the service unit, the doctor registry entry, and the product's state dir.
- **One destructive escape hatch:** `doctor purge` wipes all Hive/Honeycomb/Nectar/Deeplake/Doctor files and services, including legacy-name artifacts from older installs, with doctor removing itself last.
- **A published exit door:** a one-command uninstall script on `get.theapiary.sh`, checksummed and deployed exactly like the installer, that fully purges all Apiary assets under all historical names.
- **Never hang, never dead-end:** every flow above terminates in a clear success message or an actionable plain-language error; no flow blocks indefinitely on user input that was never requested.

## Non-Goals

- **No change to team/hybrid deployment modes.** Tenancy selection and deployment-mode behavior in hive's onboarding are untouched; this module only governs *who initiates* device-flow login on a single machine.
- **No credential migration.** The shared `~/.deeplake/credentials.json` format, the device-flow protocol, and honeycomb's Deeplake issuer ([`honeycomb/src/daemon/runtime/auth/deeplake-issuer.ts`](../../../../honeycomb/src/daemon/runtime/auth/deeplake-issuer.ts)) are unchanged; this module changes *when and by whom* the flow is started, not the flow itself.
- **No registry schema changes.** Uninstall and purge *write* (delete from) doctor's registry per its existing contract; the contract itself stays doctor's ADR-0002 / PRD-001.
- **Not product selection or install-time telemetry.** Which products get installed and how installs phone home is [`PRD-002`](../prd-002-installer-product-loading-and-phone-home/prd-002-installer-product-loading-and-phone-home-index.md); this module is the mirror image (login and removal), and only touches the installer surface to add the uninstall route beside it.
- **No remediation-ladder changes.** Doctor's rungs 1-4 (restart / reinstall / uninstall-conflicting-Hivemind / escalate) are unchanged; `purge` is a new user-initiated verb, not a rung.

---

## Sub-features

| Sub-PRD | Scope | Status |
|---|---|---|
| [`prd-003a-...-solo-vs-fleet-login-deferral`](./prd-003a-fleet-lifecycle-login-and-uninstall-solo-vs-fleet-login-deferral.md) | Solo-vs-fleet detection in honeycomb and nectar, login deferral to hive when present, solo auto-popup on first install, and the `honeycomb login` / new `nectar login` verbs. | Draft |
| [`prd-003b-...-lifecycle-command-parity`](./prd-003b-fleet-lifecycle-login-and-uninstall-lifecycle-command-parity.md) | `uninstall`, `start`, and `stop` on every product (nectar, doctor, and hive reach parity with honeycomb); uninstall removes unit + registry entry + state dir. | Draft |
| [`prd-003c-...-doctor-purge`](./prd-003c-fleet-lifecycle-login-and-uninstall-doctor-purge.md) | The destructive, confirmation-gated `doctor purge` (`--yes` for non-interactive): all state dirs, all four service units, all npm globals under current and legacy names, doctor last. | Draft |
| [`prd-003d-...-global-uninstall-script`](./prd-003d-fleet-lifecycle-login-and-uninstall-global-uninstall-script.md) | `uninstall.sh` / `uninstall.ps1` in `scripts/install/`, the `get.theapiary.sh/uninstall` route, SHA-256 checksum publication, and full historical-name coverage. | Draft |

---

## Acceptance criteria (module-level)

| ID | Criterion |
|---|---|
| AC-1 | honeycomb or nectar installed alongside hive never opens a browser popup or prompts for login; each reports degraded (storage unreachable) on `/health` until hive-side login writes the shared `~/.deeplake/credentials.json`, at which point it becomes healthy without restart or manual action. |
| AC-2 | A solo honeycomb or nectar install (no hive detected) with no `~/.deeplake/credentials.json` opens the device-flow login popup automatically on first install; when credentials already exist, no popup opens. |
| AC-3 | `honeycomb login` and the new `nectar login` open the device-flow login popup directly, in both solo and fleet mode, and exit with a clear success or actionable failure message. |
| AC-4 | Every product (honeycomb, nectar, doctor, hive) exposes working `start`, `stop`, and `uninstall` commands; `uninstall` removes that product's OS service unit, its doctor registry entry, and its state dir, and touches nothing belonging to any other product. |
| AC-5 | `doctor purge` requires interactive confirmation (or `--yes`), then removes every `~/.apiary/*` state dir, `~/.deeplake`, legacy `~/.hivemind` and `~/.honeycomb` dirs, all four products' OS service units (current and legacy labels), and all npm global packages under current and legacy names, uninstalling doctor's own service and package last. |
| AC-6 | `curl -fsSL https://get.theapiary.sh/uninstall \| sh` (and the PowerShell variant) performs the same full purge without any pre-installed Apiary tooling required, covering all historical product names: hive, hivedoctor, doctor, honeycomb, nectar, hivenectar, and `@deeplake/hivemind`. |
| AC-7 | The uninstall script is served from `get.theapiary.sh` with the same content-type pinning and published SHA-256 checksums as the installer, built and deployed by the existing `deploy-install-site.yaml` flow on a superproject `v*` tag. |
| AC-8 | No purge or uninstall path deletes anything outside the enumerated allow-list of state roots, unit paths, and package names; a purge on a machine with none of those assets exits successfully as a no-op. |
| AC-9 | Every flow in this module (install-time login, `login` verbs, `uninstall`, `purge`, the uninstall script) terminates: it either succeeds with a clear message or fails with a plain-language, actionable error; none blocks indefinitely. |

---

## Data model changes

No Deeplake catalog changes. Persistent effects:

- **doctor registry deletes.** Product `uninstall` removes that product's registry entry; `purge` and the uninstall script remove the registry file with the rest of `~/.apiary`. Contract unchanged (doctor ADR-0002 / PRD-001); this module adds the delete writers PRD-002 left as an open question.
- **A new published artifact:** `uninstall.sh` / `uninstall.ps1` in the install-site build, with entries added to the published `SHA256SUMS`.
- **Deleted state (by design):** `~/.apiary/*` (including `registry.json` and `device.json`), `~/.deeplake`, and legacy `~/.hivemind` / `~/.honeycomb` dirs, under purge/uninstall-script paths only.

---

## API and configuration changes

- **New CLI verbs:** `nectar login`, `nectar start`, `nectar stop`; `doctor start`, `doctor stop`, `doctor uninstall`, `doctor purge`; `hive start` (exists), `hive stop`, `hive uninstall`; honeycomb keeps `login` and `daemon start|stop|status` and completes its partial `uninstall` surface. Exact verb spellings (bare vs `daemon`-prefixed) are settled in 003b.
- **Fleet-mode detection inputs (003a):** presence of a hive entry in `~/.apiary/registry.json`, hive answering on `127.0.0.1:3853`, and hive present in the npm global tree; precedence and staleness handling settled in 003a.
- **Install-site routes:** `GET /uninstall` (and `/uninstall.sh`, `/uninstall.ps1`) on `get.theapiary.sh`, served `text/plain` + `nosniff` via [`site/install/_headers`](../../../../site/install/_headers), checksummed in `SHA256SUMS`, and listed on the inspect page built by [`site/install/build.mjs`](../../../../site/install/build.mjs).

---

## Security considerations

- **Destructive actions are confirmation-gated.** `doctor purge` and the uninstall script's purge require an explicit interactive confirmation naming what will be destroyed; `--yes` (script and CLI) is the only non-interactive bypass and must be typed deliberately, never defaulted.
- **The uninstall script is pinned and checksummed like the installer.** Same `text/plain` + `nosniff` headers, same `SHA256SUMS` publication, same build-from-tag guarantee, so "inspect before you pipe" holds for removal exactly as for install.
- **Purge never traverses outside the known state roots.** Deletion targets are a closed allow-list of absolute, product-owned paths (fleet root subdirs, `~/.deeplake`, legacy dirs, unit file paths, npm package names); no wildcard expansion outside the list, no following symlinks out of a root, no recursive delete of a path the fleet did not create.
- **Self-removal ordering.** doctor (and the script's own working state) is removed last, so a partially failed purge leaves the tool that can retry it.
- **Credential destruction is explicit.** `~/.deeplake` holds shared credentials also used by a standalone Hivemind (`@deeplake/hivemind`) install; the confirmation copy must name it so a user with a surviving Hivemind install is not surprised.

---

## Open questions

- [ ] **Detection precedence and staleness.** When the three fleet signals disagree (registry lists hive but hive was manually removed; hive answers but has no registry entry), which wins? Is fleet mode evaluated once at install and persisted, or live on every daemon start?
- [ ] **Headless machines.** When solo-mode auto-login cannot open a browser (SSH session, CI, no display), the flow must degrade to printing the device-code URL and code rather than hanging; confirm this is the required fallback for both the auto-popup and the `login` verbs.
- [ ] **Verb spelling and placement.** honeycomb uses `daemon start|stop|status`; nectar has `daemon` / `service-status`; doctor has `install-service` / `uninstall-service`; hive has `install-service` / `uninstall-service`. Do all products adopt bare `start|stop|uninstall`, keep per-product spellings with aliases, or both? (003b proposes bare verbs with existing spellings kept as aliases.)
- [ ] **Does the uninstall script reuse `doctor purge`?** When doctor is installed and healthy, the script could delegate to `doctor purge --yes`; when Node/npm is broken it must carry standalone shell logic anyway. Is the delegation worth the dual path, or should the script always be self-contained?
- [ ] **Hive's uninstall owner.** Hive is registered as an OS service (`com.legioncode.hive`) with `install-service` / `uninstall-service` but no state-dir/registry-aware `uninstall`; does hive grow the full verb, or does doctor perform hive's uninstall on its behalf?
- [ ] **Legacy Windows task-name inventory.** The legacy scheduled-task names found in code are `HivenectarDaemon`, `HiveDoctor`, and `thehive`; confirm the complete historical list (including any honeycomb legacy task name) before freezing the script's coverage table.
- [ ] **ADR.** PRD-001 and PRD-002 each implement a numbered ADR. Fleet-wide auth ownership ("authentication is a HIVE concern") and the destructive-purge contract are arguably decisions of the same weight; should an ADR-0004 be authored alongside this PRD?

---

## Related

- [`ADR-0003` Fleet directory ownership and neutral state root](../../../knowledge/private/architecture/ADR-0003-fleet-directory-ownership-and-neutral-state-root.md) - defines `~/.apiary` and the per-product subdirs that uninstall and purge remove.
- [`PRD-002` One-Line Installer Product Loading and Install-Time Telemetry](../prd-002-installer-product-loading-and-phone-home/prd-002-installer-product-loading-and-phone-home-index.md) - the install-side sibling; its open question "who owns delete/uninstall" is answered by this module (003b/003c/003d own the delete writers).
- [`PRD-001` Hive Release Manifest and Combined Release Train](../prd-001-hive-release-manifest-and-ci/prd-001-hive-release-manifest-and-ci-index.md) - supplies the pinned versions; the uninstall script removes what the manifest-pinned installer laid down.
- doctor [`ADR-0002` Service registration, static registry plus runtime SQLite](../../../../doctor/library/knowledge/private/architecture/ADR-0002-service-registration-static-registry-plus-runtime-sqlite.md) - the registry contract whose entries uninstall deletes.
- Fleet assets this module touches:
  - [`scripts/install/install.sh`](../../../../scripts/install/install.sh) and [`install.ps1`](../../../../scripts/install/install.ps1) - the siblings the uninstall script lives beside.
  - [`site/install/`](../../../../site/install/) and [`.github/workflows/deploy-install-site.yaml`](../../../../.github/workflows/deploy-install-site.yaml) - the build and deploy flow the uninstall route joins.
  - [`hive/src/dashboard/web/onboarding/login-step.tsx`](../../../../hive/src/dashboard/web/onboarding/login-step.tsx) and [`hive/src/shared/fleet-readiness.ts`](../../../../hive/src/shared/fleet-readiness.ts) - hive's login step and the degraded-is-up probe posture this module builds on.
  - [`honeycomb/src/daemon/runtime/auth/deeplake-issuer.ts`](../../../../honeycomb/src/daemon/runtime/auth/deeplake-issuer.ts) and [`credentials-store.ts`](../../../../honeycomb/src/daemon/runtime/auth/credentials-store.ts) - the device flow and shared-credential writer (unchanged; deferral changes who starts it).
  - [`nectar/src/hive-graph/deeplake-credentials.ts`](../../../../nectar/src/hive-graph/deeplake-credentials.ts) - nectar's credential reader, which gains a `login` writer path.
  - Service platform modules with the current and legacy unit names: [`honeycomb/src/cli/daemon-service.ts`](../../../../honeycomb/src/cli/daemon-service.ts), [`nectar/src/service/platform.ts`](../../../../nectar/src/service/platform.ts), [`doctor/src/service/platform.ts`](../../../../doctor/src/service/platform.ts), [`hive/src/service/platform.ts`](../../../../hive/src/service/platform.ts).
  - [`doctor/src/cli/command-table.ts`](../../../../doctor/src/cli/command-table.ts) - the command menu `purge` joins.
