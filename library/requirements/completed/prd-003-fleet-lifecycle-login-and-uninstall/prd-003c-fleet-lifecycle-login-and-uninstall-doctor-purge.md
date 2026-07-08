# PRD-003c: Doctor Purge (destructive full-machine wipe)

> **Parent:** [PRD-003](./prd-003-fleet-lifecycle-login-and-uninstall-index.md)
> **Status:** Completed
> **Priority:** P1 (unblocked users need 003a/003b first; purge is the escape hatch)
> **Effort:** M (0.5-1d)
> **Schema changes:** None. Deletes state; creates nothing persistent.

---

## Overview

Per-product `uninstall` (003b) is surgical by design: it leaves shared credentials, legacy dirs from older installs, and the other products alone. A user who wants the machine returned to a pre-Apiary state (a failed install, a handed-off laptop, a support "start over") has no single action for that today; they would need to hand-remove four services, five-plus directories, and up to seven npm packages across three name generations.

This sub-PRD adds **`doctor purge`**: one explicitly destructive, confirmation-gated verb that wipes ALL Hive / Honeycomb / Nectar / Deeplake / Doctor files and services, current and legacy names alike, with doctor removing itself last. It joins doctor's command menu beside the remediation verbs but is user-initiated only, never a remediation rung.

The purge set (a closed allow-list, nothing else):

- **State dirs:** every `~/.apiary/*` per-product dir plus `registry.json` and `device.json` (the whole fleet root), `~/.deeplake`, and the legacy `~/.hivemind` and `~/.honeycomb` dirs.
- **OS service units:** all four products on the current reverse-DNS labels (`com.legioncode.{honeycomb,nectar,doctor,hive}`) and all known legacy labels (`ai.honeycomb.daemon`, `com.hivenectar.daemon` / `hivenectar.service` / `HivenectarDaemon`, `com.legioncode.hivedoctor` / `hivedoctor.service` / `HiveDoctor`, `thehive` / `thehive.service`), across launchd, systemd-user, and Windows scheduled tasks.
- **npm global packages:** `@legioncodeinc/honeycomb`, `@legioncodeinc/nectar`, `@legioncodeinc/hive`, `@legioncodeinc/doctor`, plus legacy names: `@deeplake/hivemind` and any legacy unscoped/legacy-scoped names referenced by the repos' migration code.

**Ordering matters:** other products' services and packages first, then state dirs, then doctor's own service, and doctor's own npm package last, so a partial failure always leaves the tool that can resume the purge.

## Goals

- One command that returns a machine to a pre-Apiary state, covering every historical name generation.
- Interactive confirmation that names the destruction (including that shared `~/.deeplake` credentials will be deleted) and requires an explicit affirmative; `--yes` as the only non-interactive bypass.
- Self-removal ordered last, with each step best-effort and logged, so a partially failed purge is resumable by re-running.
- A purge on a clean machine (nothing installed) succeeds as a no-op.

## Non-Goals

- Becoming a remediation rung: doctor's ladder (rungs 1-4) is unchanged; purge never runs unattended.
- Per-product surgical uninstall (003b) or the no-tooling-required script path (003d).
- Removing anything outside the allow-list above: user projects, npm caches, Node itself, and unrelated `~/.config` entries are untouchable.
- Remote/team state: purge is machine-local only; nothing is deleted server-side.

## Acceptance criteria

| ID | Criterion |
|---|---|
| c-AC-1 | `doctor purge` without `--yes` prints an explicit summary of what will be destroyed (dirs, services, packages, including `~/.deeplake`) and proceeds only on an explicit interactive confirmation; any other input aborts with no changes (parent AC-5). |
| c-AC-2 | `doctor purge --yes` runs the same wipe non-interactively (parent AC-5). |
| c-AC-3 | After a successful purge: no `~/.apiary`, no `~/.deeplake`, no `~/.hivemind`, no `~/.honeycomb`; no Apiary service unit (current or legacy label) remains registered with launchd / systemd-user / schtasks; no current or legacy Apiary npm global package remains (parent AC-5, AC-6 coverage list). |
| c-AC-4 | Doctor's own service unit and npm package are removed last; if any earlier step fails, doctor survives, reports which steps failed, and a re-run resumes (parent AC-5). |
| c-AC-5 | Purge deletes only allow-listed absolute paths and enumerated unit/package names; it never follows a symlink out of a state root and never glob-expands outside the list (parent AC-8). |
| c-AC-6 | On a machine with no Apiary assets, `doctor purge --yes` exits 0 reporting nothing to remove (parent AC-8, AC-9). |

## Implementation notes

- **Command menu.** `purge` joins [`doctor/src/cli/command-table.ts`](../../../../doctor/src/cli/command-table.ts) with a summary that flags it destructive, mirroring the confirm posture of `uninstall-hivemind` (rung 3), which today deliberately never touches `~/.deeplake` - purge is the one verb that does, which the confirmation copy must say plainly.
- **Reuse rung 3's package-removal seam.** [`doctor/src/rungs/uninstall-hivemind.ts`](../../../../doctor/src/rungs/uninstall-hivemind.ts) already detects and removes `@deeplake/hivemind` hermetically; purge generalizes that runner across the package list rather than shelling ad hoc.
- **Legacy inventory is code-derived.** The unit labels and package names must be sourced from each repo's exported `SERVICE_LABEL` / `LEGACY_*` constants and migration code, not hand-maintained in doctor, or the list will drift; 003d's script needs the same inventory, so consider a single generated manifest both consume.
- **Self-removal.** The final `npm uninstall -g @legioncodeinc/doctor` runs as a detached best-effort step (a process removing its own running package); document that the purge success message prints before that last step and how failure of only that step is reported on re-run (re-run requires the package to still exist, hence last).

## Open questions

- [ ] **Confirmation strength:** a y/N prompt, or typing a token (product name or "purge") as some destructive CLIs require? Proposed: type `purge` to confirm, since y/N is too easy to reflex through for a credential-destroying action.
- [ ] **Complete legacy unscoped-name list:** migration code names `@deeplake/hivemind`, `hivenectar`, `hivedoctor` unit names; confirm whether any unscoped npm packages (`hivemind`, `hivenectar`, `hivedoctor`) ever shipped and belong on the package list.
- [ ] **Self-removal on Windows:** schtasks deletion plus npm self-uninstall ordering under a running Node process; confirm the detached-step approach works or whether the script (003d) is the documented Windows path for the final step.

## Related

- [`doctor/src/cli/command-table.ts`](../../../../doctor/src/cli/command-table.ts) and [`dispatch.ts`](../../../../doctor/src/cli/dispatch.ts) - the menu and confirm plumbing `purge` joins.
- [`doctor/src/rungs/uninstall-hivemind.ts`](../../../../doctor/src/rungs/uninstall-hivemind.ts) - the existing confirm-gated package remover purge generalizes.
- [003b](./prd-003b-fleet-lifecycle-login-and-uninstall-lifecycle-command-parity.md) - the surgical per-product uninstall purge supersets.
- [003d](./prd-003d-fleet-lifecycle-login-and-uninstall-global-uninstall-script.md) - the no-tooling-required script that shares purge's coverage inventory.
- Service platform modules carrying the current and legacy labels: [`honeycomb/src/cli/daemon-service.ts`](../../../../honeycomb/src/cli/daemon-service.ts), [`nectar/src/service/platform.ts`](../../../../nectar/src/service/platform.ts), [`doctor/src/service/platform.ts`](../../../../doctor/src/service/platform.ts), [`hive/src/service/platform.ts`](../../../../hive/src/service/platform.ts).
