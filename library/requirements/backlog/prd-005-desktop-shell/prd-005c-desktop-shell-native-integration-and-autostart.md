# PRD-005c: Native Integration and Autostart

> **Parent:** [PRD-005](./prd-005-desktop-shell-index.md)
> **Status:** Backlog
> **Priority:** P2 (native polish + the service-migration that makes the shell the real owner; ships after 005a/005b)
> **Effort:** M (1-3d)
> **Schema changes:** None. Deregisters OS service units; adds launch-at-login registration.

---

## Overview

This is what makes the shell feel like an app and behave like the fleet's owner: a tray presence, an app menu, native notifications, launch-at-login, and — the load-bearing part — the migration off the per-daemon OS services so the app is the single autostart authority. Today each daemon can register with launchd / systemd / schtasks ([`hive/src/service/platform.ts`](../../../../hive/src/service/platform.ts), plus the per-product service modules). If the shell also starts the fleet at login, a machine would double-start it. So installing the shell must deregister the daemon services it supersedes and take over autostart via Electron.

## Goals

- A tray presence shows live fleet status and offers at least open-dashboard, restart-fleet, and quit.
- Native notifications fire for at least one critical state (e.g. a daemon that cannot be restarted) that the dashboard would otherwise hide when closed.
- The app registers launch-at-login so the fleet boots with the device, owned by the app.
- Installing/adopting the shell deregisters the per-daemon OS service units (current and legacy labels) so the fleet is never double-started.
- Doctor's watchdog role is reconciled with the shell supervisor so they do not fight.
- Uninstall reverses cleanly: launch-at-login is removed and, per policy, service state is left in a coherent condition.

## Non-Goals

- Supervision/restart logic itself (005a) — this consumes it for the tray/notification surface.
- The dashboard window (005b) and packaging/updates (005d).
- The headless OS-service path (PRD-003), which remains for server/CI installs.

## Acceptance criteria

| ID | Criterion |
|---|---|
| c-AC-1 | The tray shows live fleet status and offers at least open-dashboard, restart-fleet, and quit; actions work while the main window is closed (parent AC-5). |
| c-AC-2 | At least one critical fleet state raises a native notification when the window is not focused (parent AC-5). |
| c-AC-3 | The app registers launch-at-login via Electron; after a reboot the fleet comes up under the app without the user opening it manually (parent AC-4). |
| c-AC-4 | Adopting the shell deregisters the per-daemon OS service units it supersedes — current and legacy labels (launchd `com.legioncode.hive` + legacy, systemd units, schtasks names) — so no daemon is started twice (parent AC-4). |
| c-AC-5 | With the shell managing the fleet, exactly one set of daemons runs after login (no duplicate from a surviving service unit), verified on all three OSes' service managers. |
| c-AC-6 | Doctor and the shell supervisor have defined, non-overlapping ownership; they do not repeatedly restart or fight over the same daemon (parent AC-2). |
| c-AC-7 | Uninstalling the shell removes its launch-at-login registration, stops the fleet, and de-registers the units it owns; it does **not** re-register the superseded OS services (clean removal, not restore) (ADR-0005 OQ-1). |
| c-AC-8 | If a standalone `@deeplake/hivemind` sharing `~/.deeplake` is detected during install, the installer prompts before proceeding; on consent it fully uninstalls the standalone product **without deleting `~/.deeplake` or memory data**; on decline it **aborts the app install**, leaving the machine unchanged — no partial install, no two Deep Lake owners (ADR-0005 decision 5). |

## Implementation notes

- **Deregistration reuse.** PRD-003 already handles service-unit removal including legacy names ([`hive/src/service/platform.ts`](../../../../hive/src/service/platform.ts) `LEGACY_*`, and the per-product `uninstall`/service modules). Reuse that machinery for the takeover rather than re-implementing per-OS service teardown.
- **Takeover sequence.** On first run as fleet owner: detect existing service units → stop them → deregister → start the fleet under the shell → register launch-at-login. Make it idempotent (re-running is a no-op) and log what it changed.
- **Launch-at-login.** `app.setLoginItemSettings({ openAtLogin: true })` (with the Windows/macOS specifics). This replaces the daemon services' boot role for shell-managed machines.
- **Doctor reconciliation — decided (ADR-0005).** Doctor keeps watchdogging the workloads; the shell supervises only the two roots (Doctor + Hive). Non-overlap is enforced by the doctor registry's single-owner-per-daemon + a `pidPath`-liveness no-op, so the two supervisors never act on the same process.
- **Notifications scope.** Start minimal — the "cannot restart a daemon" case — and avoid notification spam for transient restarts the supervisor handles silently.
- **Tray status source.** Subscribe to the same fleet-status the dashboard uses (via 005a's supervisor state / Hive's `/api/fleet-status`), so tray and dashboard never disagree.

## Open questions

- [x] **Takeover reversibility** — **Decided ([`ADR-0005`](../../../knowledge/private/architecture/ADR-0005-desktop-shell-fleet-supervision-and-os-service-supersession.md)):** on shell uninstall, de-register + stop; do **not** restore the OS services. A standalone Hivemind uninstalled during takeover is restored by the user reinstalling `@deeplake/hivemind`.
- [x] **Doctor ownership** (shared with 005a) — **Decided (ADR-0005):** Doctor keeps watchdogging the workloads; the shell owns only the two roots (Doctor + Hive). Boundary enforced via registry single-owner + `pidPath`-liveness no-op.
- [x] **Coexistence with a standalone Hivemind** — **Decided (ADR-0005):** detect on install → **prompt** → on consent, full uninstall (credential/data preserved, reversal = reinstall); on **decline, abort the app install** (no two-owner state). Only detection + uninstall-invocation mechanics remain (implementation).
- [ ] **Notification catalog.** Which states beyond "cannot restart" warrant a notification (login expired? update ready?) — coordinate with PRD-004b (auth) and 005d (updates).

## Related

- [`hive/src/service/platform.ts`](../../../../hive/src/service/platform.ts) — the launchd/systemd/schtasks logic and legacy-name deregistration reused for takeover.
- [`PRD-003b` Lifecycle Command Parity](../../completed/prd-003-fleet-lifecycle-login-and-uninstall/prd-003b-fleet-lifecycle-login-and-uninstall-lifecycle-command-parity.md) and [`PRD-003c` Doctor Purge](../../completed/prd-003-fleet-lifecycle-login-and-uninstall/prd-003c-fleet-lifecycle-login-and-uninstall-doctor-purge.md) — the service/state teardown machinery the migration reuses.
- [`prd-005a`](./prd-005a-desktop-shell-main-process-supervisor.md) — the supervisor whose status this surfaces and whose Doctor-overlap question this shares.
