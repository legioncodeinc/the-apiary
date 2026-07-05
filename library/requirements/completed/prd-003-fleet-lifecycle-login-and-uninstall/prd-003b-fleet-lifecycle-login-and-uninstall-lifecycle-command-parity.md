# PRD-003b: Lifecycle Command Parity (start / stop / uninstall on every product)

> **Parent:** [PRD-003](./prd-003-fleet-lifecycle-login-and-uninstall-index.md)
> **Status:** Backlog
> **Priority:** P0
> **Effort:** L (1-3d)
> **Schema changes:** None. Adds per-product doctor registry deletes on uninstall (existing contract, new writer).

---

## Overview

The fleet's lifecycle vocabulary is uneven. honeycomb has `install`, `login`, `daemon start|stop|status`, and a partially built uninstall surface. nectar has `daemon`, `install`, `uninstall`, and `service-status`, but no `start`/`stop` fronting the daemon. doctor has `install-service` / `uninstall-service`, `restart`, and `status`, but no plain `start`/`stop`/`uninstall`. hive has `start`, `install-service`, `uninstall-service`, and `register`, but no `stop` and no state-aware `uninstall`. A non-technical user cannot reason about four different verb sets.

This sub-PRD gives every product the same three verbs, fronting the lifecycle machinery each product already has:

- **`start`** - start the daemon (via the OS service when registered, directly otherwise).
- **`stop`** - stop the daemon.
- **`uninstall`** - remove the product's OS service unit, delete its entry from doctor's registry (`~/.apiary/registry.json`), and remove the product's own state dir. It removes nothing shared (`~/.deeplake` survives; that is [003c](./prd-003c-fleet-lifecycle-login-and-uninstall-doctor-purge.md) territory) and nothing belonging to another product.

Current verbs stay working (aliases where renamed) so existing docs and muscle memory do not break.

## Goals

- One lifecycle vocabulary: `start`, `stop`, `uninstall` behave equivalently on honeycomb, nectar, doctor, and hive.
- `uninstall` on each product removes exactly three things: its service unit (current label, plus best-effort legacy labels), its doctor registry entry, and its state dir under the fleet root.
- nectar and doctor gain daemon `start`/`stop` parity with honeycomb's `daemon start|stop|status`; hive gains `stop`.
- honeycomb's partial uninstall surface is completed to the same three-part contract.
- Every verb exits with a clear success message or a plain-language actionable error; `uninstall` on a not-installed product is a friendly no-op.

## Non-Goals

- Login behavior (003a) and full-machine purge (003c / 003d).
- Changing how OS services are registered (each product's existing launchd / systemd-user / schtasks machinery stays; `uninstall` drives it).
- The registry schema (doctor ADR-0002 / PRD-001); this sub-PRD only adds delete writers.
- Removing shared assets: `~/.deeplake`, other products' dirs, and legacy `~/.hivemind` / `~/.honeycomb` dirs are out of scope for per-product uninstall.

## Acceptance criteria

| ID | Criterion |
|---|---|
| b-AC-1 | Each of honeycomb, nectar, doctor, and hive exposes `start` and `stop` commands that start and stop that product's daemon on macOS, Linux, and Windows (parent AC-4). |
| b-AC-2 | Each product's `uninstall` removes its OS service unit (launchd plist / systemd-user unit / scheduled task, current label plus best-effort legacy label), so the service no longer starts at boot (parent AC-4). |
| b-AC-3 | Each product's `uninstall` deletes that product's entry from doctor's registry, leaving other entries intact (parent AC-4). |
| b-AC-4 | Each product's `uninstall` removes that product's state dir under the fleet root and nothing else: no other product's dir, no `~/.apiary/registry.json` wholesale, no `~/.deeplake` (parent AC-4, AC-8). |
| b-AC-5 | Existing verb spellings (`daemon start|stop|status`, `service-status`, `install-service`/`uninstall-service`) keep working as aliases of the new verbs. |
| b-AC-6 | `uninstall` on a product that is not installed (or already uninstalled) exits 0 with a message saying there was nothing to remove (parent AC-9). |
| b-AC-7 | After `uninstall`, doctor no longer probes or attempts remediation of the removed product (the registry delete is what doctor's probe loop reads). |

## Implementation notes

- **Front, do not fork.** Each verb fronts existing machinery: honeycomb's [`daemon-service.ts`](../../../../honeycomb/src/cli/daemon-service.ts) (`com.legioncode.honeycomb`, legacy `ai.honeycomb.daemon`), nectar's [`service/`](../../../../nectar/src/service/platform.ts) (`com.legioncode.nectar`, legacy `com.hivenectar.daemon` / `hivenectar.service` / `HivenectarDaemon`), doctor's [`service/`](../../../../doctor/src/service/platform.ts) (`com.legioncode.doctor`, legacy `com.legioncode.hivedoctor` / `hivedoctor.service` / `HiveDoctor`), hive's [`service/`](../../../../hive/src/service/platform.ts) (`com.legioncode.hive`, legacy `thehive`). All four already carry legacy-label deregistration paths for install-time migration; `uninstall` reuses them.
- **State dirs per ADR-0003.** Product dirs live under the fleet root (`~/.apiary/<product>`, resolved by each repo's `apiary-root` module); `uninstall` deletes the resolved product dir only, by absolute path, never by glob.
- **Registry delete ordering.** Stop the daemon, remove the unit, delete the registry entry, then remove the state dir, so doctor never sees a registered-but-gone product mid-flight.
- **Doctor self-uninstall.** `doctor uninstall` removes doctor's own unit, registry entry, and state dir; the npm package itself remains (removing packages is 003c/003d). Order its own service removal last within the verb.
- **PRD-002 handoff.** PRD-002b left "who owns delete/uninstall" open; this sub-PRD answers it: each product's `uninstall` verb writes its own registry delete, and the installer is not the delete path.

## Open questions

- [ ] **Bare verbs vs `daemon`-prefixed:** parent proposal is bare `start|stop|uninstall` everywhere with existing spellings as aliases; confirm honeycomb keeps `daemon start|stop|status` as the alias rather than the primary.
- [ ] **Does uninstall also remove the npm global package for that product?** Proposed: no (the CLI removing its own running package is fragile mid-command); package removal belongs to purge (003c) and the script (003d). Confirm the user expectation "uninstall = service + registry + state" is acceptable when the `bin` remains on PATH.
- [ ] **hive `stop` semantics** while a user is viewing the dashboard it serves: immediate stop, or warn when active sessions exist?

## Related

- [`ADR-0003` Fleet directory ownership and neutral state root](../../../knowledge/private/architecture/ADR-0003-fleet-directory-ownership-and-neutral-state-root.md) - the state-root layout `uninstall` removes from.
- doctor [`ADR-0002` Service registration, static registry plus runtime SQLite](../../../../doctor/library/knowledge/private/architecture/ADR-0002-service-registration-static-registry-plus-runtime-sqlite.md) - the registry contract the delete writer follows.
- [`PRD-002b` Install Coverage and Registry Writes](../prd-002-installer-product-loading-and-phone-home/prd-002b-installer-product-loading-and-phone-home-registration-and-install-coverage.md) - the create/update writers; this sub-PRD supplies the delete.
- Service platform modules: [`honeycomb/src/cli/daemon-service.ts`](../../../../honeycomb/src/cli/daemon-service.ts), [`nectar/src/service/platform.ts`](../../../../nectar/src/service/platform.ts), [`doctor/src/service/platform.ts`](../../../../doctor/src/service/platform.ts), [`hive/src/service/platform.ts`](../../../../hive/src/service/platform.ts).
- CLI entry points gaining verbs: [`nectar/src/cli.ts`](../../../../nectar/src/cli.ts), [`doctor/src/cli/command-table.ts`](../../../../doctor/src/cli/command-table.ts), [`hive/src/cli.ts`](../../../../hive/src/cli.ts).
