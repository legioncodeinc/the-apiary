# PRD-005a: Main-Process Fleet Supervisor

> **Parent:** [PRD-005](./prd-005-desktop-shell-index.md)
> **Status:** Backlog
> **Priority:** P1
> **Effort:** L (1-3d)
> **Schema changes:** None. Shell-managed supervisor state in user-data; no Deeplake or `~/.apiary` change.

---

## Overview

The Electron main process becomes the fleet's supervisor: it starts the daemons on launch, watches them, restarts a crashed one within bounds, and stops them all cleanly on quit. The delicate part is the runtime. The daemons assume a real Node ≥22.5 and re-spawn themselves with flags — Nectar runs `spawn(process.execPath, ["--experimental-sqlite", …])` ([`nectar/src/cli.ts:191`](../../../../nectar/src/cli.ts)) and Honeycomb spawns the embed daemon via `execPath` ([`honeycomb/src/daemon/runtime/services/embed-supervisor.ts`](../../../../honeycomb/src/daemon/runtime/services/embed-supervisor.ts)). Electron's `process.execPath` is the Electron binary with a different flag posture, so running the daemons inside Electron's Node would break both self-spawns. The shell therefore ships a **standalone Node ≥22.5 sidecar** and uses it as the daemons' `execPath`, leaving their internals untouched.

The second decision is *how much* the shell supervises directly. Hive already spawns and registers the workload daemons ([`hive/src/daemon/installer/spawn.ts`](../../../../hive/src/daemon/installer/spawn.ts), [`hive/src/daemon/registry.ts`](../../../../hive/src/daemon/registry.ts)), and Doctor already watchdogs Honeycomb. The shell can either supervise all four directly or start Hive and lean on Hive's existing supervision — reusing working code. This sub-PRD settles that, plus single-instance, port handling, and shutdown.

## Goals

- Daemons run on a bundled standalone Node ≥22.5 sidecar; Nectar's `--experimental-sqlite` self-spawn and Honeycomb's embed-daemon spawn work unmodified.
- The supervisor starts the fleet on launch, health-checks each daemon via its existing `/health`, and restarts a crashed daemon under a bounded policy (no crash-loop hammering).
- On quit, all daemons stop cleanly with no orphaned processes.
- Single instance: a second launch focuses the existing window rather than starting a second supervisor.
- A port already in use is detected and surfaced as an actionable message, never a silent double-bind or crash.
- Spawning stays argv-safe (`shell:false`, argv arrays), matching the existing spawn discipline.

## Non-Goals

- The dashboard window and renderer security (005b), tray/notifications/autostart (005c), and packaging of the sidecar binary (005d).
- Changing any daemon's internals or its loopback contract.
- The headless OS-service path (PRD-003) — unaffected; this is the desktop supervisor.

## Acceptance criteria

| ID | Criterion |
|---|---|
| a-AC-1 | The daemons are spawned with a bundled Node ≥22.5 sidecar as `execPath`; Nectar's `--experimental-sqlite` self-spawn and Honeycomb's embed-daemon `execPath` spawn succeed under the shell with no source change (parent AC-3). |
| a-AC-2 | On launch the supervisor starts the fleet and confirms each daemon healthy via its existing `/health`; startup surfaces progress and does not hang indefinitely if a daemon fails to come up (parent AC-2). |
| a-AC-3 | A daemon that crashes is restarted within a bounded retry policy; repeated failures stop retrying and surface an actionable state rather than looping forever (parent AC-2). |
| a-AC-4 | On app quit, every daemon (and the sidecar) is stopped cleanly; no orphaned daemon or embed process remains (parent AC-2). |
| a-AC-5 | A second app launch focuses the running instance and does not start a second supervisor or re-bind ports (parent AC-6). |
| a-AC-6 | A required loopback port already in use is detected before spawn and surfaced with a clear message; the shell does not crash or silently double-bind (parent AC-6). |
| a-AC-7 | All daemon spawning uses argv arrays with `shell:false`; no request- or config-derived string is ever concatenated into a shell command (parent security). |

## Implementation notes

- **Sidecar Node.** Ship a pinned Node ≥22.5 per OS in the app resources (unpacked from asar). Spawn daemons as `sidecarNode <daemon-entry> …`. Because the daemons read `process.execPath` for their own self-spawns, they will re-invoke the *sidecar* Node, not Electron — which is exactly right.
- **`--experimental-sqlite`.** Nectar requires it today ([`nectar/src/cli.ts`](../../../../nectar/src/cli.ts), [`nectar/src/telemetry/db.ts`](../../../../nectar/src/telemetry/db.ts)). Confirm whether the pinned Node version still needs the flag or whether `node:sqlite` has stabilized; if still needed, ensure the shell's initial spawn passes it and Nectar's self-spawn continues to.
- **Reuse the existing supervisor (Doctor); do not reimplement.** The continuous workload supervisor is **Doctor** (`doctor/src/backoff.ts` restart rungs, registry-driven), not Hive — Hive's `spawn.ts` is install-time and Hive's runtime role is the portal. So the shell starts the fleet and keeps the two *roots* alive (Doctor + Hive); Doctor keeps honeycomb/nectar/embed alive unchanged, and the shell supervises no workload directly. Doctor's own liveness (previously provided by its OS service) moves to the shell — the single new supervision edge. Boundary enforced via the doctor registry's single-owner-per-daemon + `pidPath`-liveness no-op (ADR-0005 decision 3).
- **Doctor overlap.** Doctor watchdogs Honeycomb; under the shell the main process also watches. Decide ownership so they do not fight (e.g. Doctor continues as-is and the shell only supervises Hive; or Doctor is not run under the shell). Flagged below.
- **utilityProcess vs child_process.** Prefer Node `child_process`/detached spawns of the sidecar over Electron `utilityProcess`, since the latter runs Electron's Node and reintroduces the `execPath`/flag mismatch.
- **Argv-safe.** Follow [`hive/src/daemon/installer/spawn.ts`](../../../../hive/src/daemon/installer/spawn.ts)'s `shell:false` + argv discipline; do not regress it.

## Open questions

- [x] **Shell-supervises-all vs. reuse existing supervision** — **Decided ([`ADR-0005`](../../../knowledge/private/architecture/ADR-0005-desktop-shell-fleet-supervision-and-os-service-supersession.md)):** reuse existing supervision — the runtime supervisor is **Doctor** (not Hive); the shell keeps the roots (Doctor + Hive) up and Doctor keeps the workloads up, unchanged. The shell reimplements no per-daemon supervision.
- [x] **Doctor under the shell** — **Decided (ADR-0005):** Doctor keeps watchdogging the workloads; the shell owns only the two roots (Doctor + Hive). Boundary made provable via **registry single-owner per daemon + `pidPath`-liveness no-op + shell-supervises-roots-only**. Remaining implementation: populate the registry owner field and add the pid-liveness check to the shell's start path.
- [ ] **`node:sqlite` flag status.** At the pinned Node version, is `--experimental-sqlite` still required, or can Nectar drop it? Affects both the initial spawn and Nectar's self-spawn.
- [ ] **Restart policy shape.** Backoff curve, max attempts, and what "give up" surfaces (tray warning + dashboard state?).

## Related

- [`nectar/src/cli.ts`](../../../../nectar/src/cli.ts) — the `--experimental-sqlite` self-spawn the sidecar Node must satisfy.
- [`honeycomb/src/daemon/runtime/services/embed-supervisor.ts`](../../../../honeycomb/src/daemon/runtime/services/embed-supervisor.ts) — Honeycomb's own `execPath`-based supervisor, the precedent for the sidecar model.
- [`hive/src/daemon/installer/spawn.ts`](../../../../hive/src/daemon/installer/spawn.ts) and [`hive/src/daemon/registry.ts`](../../../../hive/src/daemon/registry.ts) — the existing spawn/registry supervision to reuse.
- [`doctor` package](../../../../doctor/package.json) — the watchdog whose role must be reconciled.
