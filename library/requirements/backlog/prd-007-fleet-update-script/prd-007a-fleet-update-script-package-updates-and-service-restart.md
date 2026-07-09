# PRD-007a: Package Updates and Service Restart

> **Parent:** [PRD-007](./prd-007-fleet-update-script-index.md)
> **Status:** Backlog
> **Priority:** P1 (core)
> **Effort:** S (< 1d)
> **Schema changes:** None. Adds `scripts/install/update.sh` and `scripts/install/update.ps1` (the latter a PowerShell twin, mirroring the install/uninstall pairing).

---

## Overview

This is the core of the update script: detect which Apiary products are installed, resolve each to its `hive-release.json` manifest-pinned (blessed) version, `npm i -g` only the ones that moved, then converge and restart their services so the running daemons load the new code. On a machine already at the blessed set it is a no-op.

It is a self-contained POSIX `sh` orchestrator (`set -u`, explicit per-step failure handling, no `set -e`), structured after [`uninstall.sh`](../../../../scripts/install/uninstall.sh): a friendly step/ok/warn/fail log, a `have()` binary probe, and an ordered `main()` that funnels every terminal exit through a single `finish()` (which fires the terminal telemetry event — see [007c](./prd-007c-fleet-update-script-site-delivery-and-telemetry.md)).

## Goals

- One pasted command moves every *installed* Apiary product to its blessed version and restarts its service, on macOS, Linux, and Windows.
- Manifest-pinned targets by default — reusing the installer's `resolve_product_target` semantics (`ok` / `unpublished` / `unresolved`) and safe-shape validation — with a single `--latest` escape hatch that targets each package's npm `latest` dist-tag instead, behind a printed warning.
- Idempotent in both modes: already-current machines make zero npm mutations and restart nothing.
- Fail-soft and non-destructive: one product's failure never blocks the rest; nothing is ever removed.

## Non-Goals

- Harness/plugin refresh (that is [007b](./prd-007b-fleet-update-script-harness-and-plugin-refresh.md)).
- Site routing, checksums, and telemetry event wiring (that is [007c](./prd-007c-fleet-update-script-site-delivery-and-telemetry.md)) — this sub-PRD calls `phone_home`/`finish`, but their transport definition lives in C.
- Installing products the user never had; Node major upgrades; rollback/downgrade.

## The product set

The blessed, updatable products and their bins (from `install.sh` / `uninstall.sh`):

| Slug | npm package | Bin | Service converge verb | Daemon pid file |
|---|---|---|---|---|
| `honeycomb` | `@legioncodeinc/honeycomb` | `honeycomb` | `honeycomb install` | `~/.apiary/honeycomb/daemon.pid` (legacy `~/.honeycomb/daemon.pid`) |
| `doctor` | `@legioncodeinc/doctor` | `doctor` | `doctor install-service` | — (watchdog) |
| `hive` | `@legioncodeinc/hive` | `hive` | `hive install-service` | `~/.apiary/hive/hive.pid` |
| `nectar` | `@legioncodeinc/nectar` | `nectar` | `nectar install` | `~/.apiary/nectar/nectar.pid` |

`@deeplake/hivemind` is a legacy standalone package the *uninstaller* covers; the updater does not resurrect or bump it (it has no blessed entry in `hive-release.json`). Pre-rename slug aliases are normalized exactly as `install.sh` does (`normalize_product_token`).

## User stories

### US-7a.1 — Update the installed fleet to the blessed versions

**As an** operator who installed the fleet a while ago, **I want to** run one command that brings every installed product to the current tested release, **so that** I get fixes and features without re-running a fresh install or guessing version numbers.

**Acceptance criteria:**
- a-AC-1 Given `honeycomb`, `hive`, and `nectar` are installed at older versions and `hive-release.json` pins newer ones, when I run `update.sh`, then each is `npm i -g`'d to `<pkg>@<blessed>` and the log reports each move as `old → new`.
- a-AC-2 Given a product's installed version already equals its blessed version, when I run `update.sh`, then that product is skipped with `already current` and no `npm install` is issued for it.
- a-AC-3 Given a product is not installed (`npm ls -g <pkg>` reports absent), when I run `update.sh`, then it is neither installed nor mentioned as updated (an update is not an install).
- a-AC-4 Given the manifest marks a product `published:false` or is unreachable/malformed, when resolution runs in the default (blessed) mode, then that product is skipped with a plain note ("could not resolve the blessed version for X; leaving it at its current version") and the run continues; it never silently falls back to `@latest` and never fails the whole run over one product.

### US-7a.1b — Opt into the newest published version

**As an** operator who knowingly wants the newest published bytes ahead of a blessed cut, **I want** a `--latest` flag, **so that** I can pull each package's npm `latest` dist-tag without editing the manifest.

**Acceptance criteria:**
- a-AC-1b-1 Given `--latest` (or the env equivalent), when the script resolves targets, then every installed product targets `<pkg>@latest` instead of the manifest pin, and a one-line warning is printed once ("--latest bypasses the blessed fleet set; products may land on untested or mismatched versions").
- a-AC-1b-2 Given `--latest`, when a product's installed version already equals its npm `latest` (`npm view <pkg> version`), then it is skipped with `already current` (idempotency holds without a manifest pin).
- a-AC-1b-3 Given both blessed and `--latest` are conceptually available, when no flag is passed, then the default is always blessed — `--latest` is strictly opt-in and never implied by any other flag or env default.

### US-7a.2 — Restart services so new code actually runs

**As an** operator, **I want to** have the daemons restarted after the packages update, **so that** the running processes serve the new code instead of the bytes they started with.

**Acceptance criteria:**
- a-AC-5 Given a product's package moved, when the update completes for it, then its service is converged via its idempotent verb and the daemon is confirmed serving the new version (health/status probe), or a plain note names the exact command to finish if the converge did not complete.
- a-AC-6 Given a daemon must be recycled to load new code, when it is restarted, then the recycle verifies a live `node` process before signalling (pid-reuse safe, per `uninstall.sh`'s pattern) and orders the converge (point service at new bytes) before any kill so Doctor cannot race-restart the old code.
- a-AC-7 Given a product that did not move (a-AC-2), when the run completes, then its service is left untouched (no needless restart).

### US-7a.3 — Safe, idempotent, non-destructive

**Acceptance criteria:**
- a-AC-8 Given the whole fleet is already at the blessed versions, when I run `update.sh`, then it makes no npm mutation, restarts nothing, prints "already up to date," and exits 0.
- a-AC-9 Given Node/npm is absent or broken, when I run `update.sh`, then it reports that plainly (with the one command to install Node, mirroring `install.sh`'s `elevation_required_node`) and exits non-zero without touching anything.
- a-AC-10 Given `--dry-run`, when I run `update.sh`, then it resolves and prints every product's current→blessed decision and which services it would restart, mutating nothing and sending no real telemetry (preview only), mirroring `install.sh --dry-run`.

## Implementation notes

- **Structure to copy.** Start from `uninstall.sh`'s skeleton: `set -u`; `step`/`ok`/`warn`/`fail`/`have`; `parse_args` (`--yes` is not needed — update is not destructive — but `--dry-run`, `--latest`, and `--help` are); an ordered `main()`; a single terminal funnel.
- **Mirror the resolver (decided).** Carry a **copy** of `fetch_manifest`, `manifest_field`, `npm_package_name_is_safe`, `semver_is_safe`, and `resolve_product_target` from `install.sh` — a deliberate mirror, not a sourced fragment, so `update.sh` stays a single self-contained file (the same posture `install.ps1` takes toward `install.sh`). Mark both copies with a `# SYNC: mirror of install.sh <fn>` comment. The manifest URL is the same `https://get.theapiary.sh/hive-release.json` with the same raw-GitHub fallback.
- **`--latest` target resolution.** When `--latest` is set, bypass the manifest entirely: the target for every product is `<pkg>@latest`. Print the a-AC-1b-1 warning once, up front. All other posture (idempotency, per-product fail-soft, restart, telemetry) is unchanged.
- **Detect installed.** For each product slug, `npm ls -g <pkg> --depth=0 >/dev/null 2>&1` decides installed/absent (exactly `uninstall.sh`'s probe). Optionally read `~/.honeycomb/install-state.json` as a hint, but `npm ls -g` is authoritative.
- **Version-gap.** Read the installed version (`npm ls -g <pkg> --depth=0 --json` → parse with `node`, guaranteed present here, matching how `install.sh` parses the manifest). In blessed mode compare to the manifest `version` (offline, quiet). In `--latest` mode compare to `npm view <pkg> version` (one network call/product). Skip when equal in both modes, so `product_updated` (007c) fires only on a real move.
- **Update.** `npm install -g <target>` per moved product; fail-soft per product (`warn` + record it did not move, continue), never aborting the loop — same posture as `install_extra_product`.
- **Restart (decided: converge-first, recycle-only-if-needed).** After a product moves, run its converge verb (`honeycomb install`, `hive install-service`, `nectar install`, `doctor install-service`), which is idempotent and (for the health-gated ones) confirms the daemon is up. Where the converge verb does not itself recycle a long-running daemon onto new code, stop the pid using `uninstall.sh`'s `stop_daemon_pidfile` logic (live-node verify) and let the service manager / Doctor bring it back — but only *after* the converge has pointed the service at the new bytes, to avoid the Doctor race. Converge `doctor` **last** (it is the watchdog); restarting it mid-run can interfere with the other products' recycle.
- **Bin resolution.** `npm i -g` does not refresh the current shell PATH; resolve `<npm prefix -g>/bin/<bin>` the way `install.sh`'s `resolve_honeycomb_bin` does before invoking a product's verb by absolute path.
- **`--dry-run` (decided: mirror `install.sh`).** Resolve every product's current→target decision (blessed or `@latest` per the flag) and the services it would restart, print them, mutate nothing, and preview — not send — the telemetry events.
- **Terminal funnel.** Every exit path routes through `finish <code>` so 007c's `update_completed` / `update_failed` fires exactly once; `update_started` fires first in `main()` after `resolve_install_id` (007c).

## Open questions

- [ ] **`--no-restart` flag.** Some operators may want packages updated without a service bounce (e.g. to schedule the restart). Add now or defer? Proposed: defer (out of scope), restart-always is the safe default.
- [ ] **Health-probe surface.** Which endpoint confirms "daemon now serving new version"? Hive exposes `http://127.0.0.1:3853/health`; confirm the equivalent honeycomb/nectar version-bearing status surface for a-AC-5, or accept "converge verb exited 0" as sufficient.
- [ ] **Concurrent update + Doctor auto-update.** If PRD-065 Doctor is mid-auto-update when the explicit script runs, do they collide? Proposed: both are idempotent-to-the-same-blessed-set, so the loser no-ops; verify no npm-global lock contention causes a spurious failure (retry-once if so). Note `--latest` can move a product *off* the blessed set that Doctor would then try to pull *back*; document that `--latest` is an operator override that Doctor's next cycle may reconcile.

## Related

- [`scripts/install/install.sh`](../../../../scripts/install/install.sh) — the resolver, telemetry, bin-resolution, and Node-bootstrap patterns reused here.
- [`scripts/install/uninstall.sh`](../../../../scripts/install/uninstall.sh) — the script skeleton, service inventory, and pid-file live-node recycle reused here.
- [`hive-release.json`](../../../../hive-release.json) — the source of every blessed version this script targets.
- [007c](./prd-007c-fleet-update-script-site-delivery-and-telemetry.md) — defines `phone_home` / `finish` / `resolve_install_id` this sub-PRD calls.
