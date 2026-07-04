# Execution Ledger: Apiary State-Root Migration (fleet ADR-0003)

Single source of truth for sequencing the fleet-wide migration from the legacy `~/.honeycomb` shared home to the neutral `~/.apiary/` fleet root with per-product subdirectories. Status legend: OPEN / IN PROGRESS / DONE / VERIFIED / BLOCKED.

**Authoritative decision record:** superproject [`library/knowledge/private/architecture/ADR-0003-fleet-directory-ownership-and-neutral-state-root.md`](../knowledge/private/architecture/ADR-0003-fleet-directory-ownership-and-neutral-state-root.md) (Status: Accepted). Mirrors: nectar ADR-0005, doctor ADR-0003, hive ADR-0005, honeycomb adr/0008. **Edit the authoritative copy, then re-sync all four mirrors; never edit a mirror in isolation.**

**Fleet decisions (locked, 2026-07-04):**
1. Fleet root name: `~/.apiary/` (confirmed over `~/.doctor/`); per-product subdirs `doctor/`, `honeycomb/`, `nectar/`, `hive/`; shared surface (`registry.json`, `device.json`, `install-id`) at the root, doctor-managed. `~/.deeplake/` unchanged.
2. XDG rule: honor `$XDG_STATE_HOME/apiary` on Linux only when `$XDG_STATE_HOME` is explicitly set; the default is `<homedir>/.apiary` on every OS; no `~/.local/state` default. The canonical `resolveFleetRoot` chain lives in ADR-0003 "Resolved decisions"; every repo implements it verbatim (mirrored, never imported).
3. Registry compatibility window contract: doctor creates the root and migrates the registry wholesale on its own first boot; every writer targets `~/.apiary/registry.json` when the fleet root directory exists, else the legacy `~/.honeycomb/doctor.daemons.json`, never both; doctor reads new-first and merges (new wins per daemon `name`, legacy-only entries merge additively, no write-back to legacy); the fallback is removed only when every supported install path ships its migration.

**The planning-gap corrective (2026-07-04):** the four per-repo PRDs were originally authored in parallel against an ADR with two unresolved ambiguities (the XDG reading and the registry handshake), and each invented its own default. Both are now resolved in ADR-0003 "Resolved decisions"; all four PRDs were reconciled to CITE the ADR rather than restate it. Any future contract change goes into the ADR first, then re-syncs outward.

---

## The four per-repo PRDs

| Repo | PRD | Location | Scope | Status |
|---|---|---|---|---|
| doctor | PRD-004 `apiary-fleet-root-migration` (004a-c) | `doctor/library/requirements/backlog/prd-004-apiary-fleet-root-migration/` | Shared root helper; relocation of the fleet-shared surface (registry, device.json, install-id); registry merge rule; supervision continuity incl. telemetry trust-root extension | OPEN (backlog) |
| honeycomb | PRD-072 `apiary-state-root-migration` (072a-d) | `honeycomb/library/requirements/backlog/prd-072-apiary-state-root-migration/` | Largest surface (original `~/.honeycomb` owner): pid/lock cutover, seven state families, fleet-shared writes, service-unit root pinning | OPEN (backlog) |
| nectar | PRD-020 `apiary-state-root-migration` (020a-c) | `nectar/library/requirements/backlog/prd-020-apiary-state-root-migration/` | Root helper + path adoption; one-time migration + legacy fallback; service unit + doctor-registry adoption. PRD-019 brooding state reconciled to `~/.apiary/nectar/projects.json` | OPEN (backlog) |
| hive | PRD-010 `apiary-state-root-migration` (010a-c) | `hive/library/requirements/backlog/prd-010-apiary-state-root-migration/` | Root helper + path constants; first-boot migration + pid/lock continuity; registry coordination + mid-migration portal honesty | OPEN (backlog) |

## Sequencing (build order rationale)

| Wave | Work | Depends on | Status |
|---|---|---|---|
| W1 | doctor PRD-004: root helper, fleet-root + shared-surface creation/migration, registry merge rule, trust-root extension | ADR-0003 (Accepted) | OPEN |
| W2 | honeycomb PRD-072, nectar PRD-020, hive PRD-010, in any order or in parallel: each product's own subdir migration + write-side registry contract adoption | W1 shipped (doctor tolerates both locations from W1 on, so W2 products can land independently) | OPEN |
| W3 | Superproject installer (`install.sh` / `install.ps1`, ADR-0002 surface): mint `~/.apiary/install-id`, write registry entries per the window contract, pin the resolved root as `APIARY_HOME` into service environments, Windows LocalSystem install-time home capture | W1 (the paths exist) | OPEN |
| W4 | Window close: remove every legacy `~/.honeycomb` fallback (read and write side) across all four repos | Every supported install path ships its migration (W1-W3 VERIFIED) | OPEN |

**W4 is the close-out gate.** Each repo's PRD requires legacy-window code to carry a removal-criterion comment (e.g. hive rr-AC-7) so W4 is a deletion sweep, not an archaeology project.

## Cross-repo invariants to verify at each wave

| ID | Invariant | Verify against |
|---|---|---|
| X-1 | All four repos implement the identical `resolveFleetRoot` chain (ADR-0003 "Resolved decisions"), anchored on `os.homedir()`, never `process.cwd()` | doctor 004a, honeycomb 072a, nectar 020a, hive 010a |
| X-2 | No product writes into another product's subdir; shared files only at the root, written per ownership (doctor manages; others write only their own registry entry) | all four PRDs |
| X-3 | Registry writers follow the window contract (new when the fleet root exists, else legacy, never both); only doctor merges | doctor 004b, honeycomb 072c, nectar 020c, hive 010c |
| X-4 | Advertised registry paths (`pidPath`, `telemetryDbPath`) match the paths the product actually writes, at every moment in the window | honeycomb 072c, nectar 020c, hive 010b/c |
| X-5 | Migration is one-time, idempotent, additive; no legacy file deleted unless successfully migrated; readers fall back while the window is open | all four PRDs |

## Remaining repo-local open items (not fleet-blocking)

| Repo | Item | Where |
|---|---|---|
| doctor | Telemetry trust-root binding tightness (per-own-name recommended); pid-path existence-check timing (boot/reload recommended); legacy marker name | 004b/004c open questions |
| honeycomb | Registry path-string convention (`~`-literal vs resolved absolute) - shared question with hive, settle once with doctor 004b; dual pid stamping during the window; memory-mount path shape dual recognition; install-id consolidation posture | 072 index open questions |
| nectar | pid/lock migrate-or-fresh (fresh recommended); daemon-writes-registry-on-upgrade refresh; install-id read order vs installer timeline; launchd `logs/` subdir name | 020 index open questions |
| hive | Root-helper distribution (mirror as `src/shared/` module recommended); `--home=` only on `hive install`; legacy launchd log tail copy (no recommended); registry `pidPath` convention (same question as honeycomb's) | 010 index open questions |

**One item to settle before W1 implementation starts:** the registry `pidPath`/`telemetryDbPath` string convention (tilde-literal with doctor expanding under the SAME resolved root, versus resolved absolute paths). Honeycomb 072c and hive 010c both flag it; it belongs to doctor 004b as the registry contract owner. Settle it there, then note the answer here.

## Related

- Superproject [`ADR-0002`](../knowledge/private/architecture/ADR-0002-one-line-installer-product-loading-and-install-time-telemetry.md) - the installer surface W3 modifies.
- nectar PRD-019 (`nectar/library/requirements/backlog/prd-019-project-scoped-brooding-activation/`) - consumer of `~/.apiary/nectar/projects.json`; can ship before or after PRD-020 (its state-file path already cites the ADR layout).
- doctor `ADR-0002-service-registration-static-registry-plus-runtime-sqlite` - the registry contract whose location this program moves.
