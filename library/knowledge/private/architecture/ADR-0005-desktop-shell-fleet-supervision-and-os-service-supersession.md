# ADR-0005, the Apiary desktop shell supervises the fleet over a bundled Node sidecar and supersedes per-daemon OS services

> **Status:** Proposed · **Date:** 2026-07-06
> **Supersedes:** none · **Refines:** [`ADR-0003-fleet-directory-ownership-and-neutral-state-root.md`](./ADR-0003-fleet-directory-ownership-and-neutral-state-root.md) (the `~/.apiary/<product>/` state layout the shell's user-data lives beside), [`ADR-0004-extract-embedding-engine-into-standalone-fleet-daemon.md`](./ADR-0004-extract-embedding-engine-into-standalone-fleet-daemon.md) (the embed daemon the desktop build packs rather than downloads)
> **Owners:** platform, hive, honeycomb, nectar, doctor
> **Related:** [`PRD-005` Apiary Desktop Shell (Electron)](../../../requirements/backlog/prd-005-desktop-shell/prd-005-desktop-shell-index.md), [`PRD-004` Branded In-App Deep Lake Sign-In](../../../requirements/backlog/prd-004-branded-in-app-signin/prd-004-branded-in-app-signin-index.md), [`PRD-003` Fleet Lifecycle, Login Deferral, and One-Command Uninstall](../../../requirements/completed/prd-003-fleet-lifecycle-login-and-uninstall/prd-003-fleet-lifecycle-login-and-uninstall-index.md), [`../../../../nectar/library/knowledge/private/architecture/ADR-0003-three-daemon-topology-and-hive-portal.md`](../../../../nectar/library/knowledge/private/architecture/ADR-0003-three-daemon-topology-and-hive-portal.md) (the doctor-registry + hive-portal topology the shell wraps)

## Context

The Apiary runs a coordinated local fleet on fixed loopback ports — honeycomb `:3850`, the embed daemon `:3851`, doctor `:3852`, hive `:3853`, nectar `:3854` — auto-started by an OS service manager (launchd / systemd / schtasks — `hive/src/service/platform.ts` and the per-product service modules), with the UI reached by opening `127.0.0.1:3853` in a browser. PRD-005 proposes wrapping this in a desktop (Electron) shell: a native window that renders the dashboard, a tray, launch-at-login, and an app-managed supervisor. This ADR records the **process-ownership** decisions that shell forces — how the fleet is supervised under it, and what happens to the OS services it displaces. It is deliberately separate from the shell's UI/packaging work (PRD-005b/005d) and its sign-in surface (PRD-004), which do not change the process graph.

### What already exists (and shapes the decision)

- **Hive is the portal + installer, not the runtime supervisor.** It serves the React SPA dashboard (`hive/src/dashboard/web/`, hosted at `:3853` by `hive/src/daemon/dashboard/host.ts`), spawns products at *install time* via an argv-safe seam (`hive/src/daemon/installer/spawn.ts` — "every npm invocation and product registration verb"), and reads the doctor registry to route the portal (`hive/src/daemon/registry.ts`). Continuous crash-restart of the workloads is not Hive's job.
- **Doctor is the runtime supervisor.** Doctor keeps honeycomb (and the fleet) alive and self-heals crashes via its backoff/restart rungs (`doctor/src/backoff.ts`), registry-driven — the independent liveness authority, "the supervised watchdog" that today runs as the OS-service entry.
- **The OS services own autostart.** Each daemon can register a launchd/systemd/schtasks unit (current labels + legacy names such as `thehive`, `HiveDoctor`, `HivenectarDaemon`); PRD-003 already carries the deregistration + legacy-name coverage machinery.

### The forcing function: the daemons re-spawn themselves on a real Node

The daemons assume a real Node ≥22.5 and re-invoke `process.execPath` with flags — nectar runs `spawn(process.execPath, ["--experimental-sqlite", …])` (`nectar/src/cli.ts:191`) and honeycomb spawns the embed daemon via `execPath` (`honeycomb/src/daemon/runtime/services/embed-supervisor.ts`). Electron's `process.execPath` is the Electron binary with a different flag posture, so **running the daemons inside Electron's Node (via `utilityProcess`/`fork`) would break both self-spawns.** Any supervision model must run the daemons on a real Node, not Electron's.

### The collision this ADR must resolve

If the shell auto-starts the fleet at login *and* the OS service units also auto-start it, the machine double-runs the fleet (port conflicts on the fixed `:385x` block). Exactly one autostart owner can exist per machine. So adopting the shell is not additive — it must **supersede** the per-daemon OS services it displaces.

## Decision

**The desktop shell becomes the fleet's autostart owner and top-level supervisor, running the daemons on a bundled standalone Node sidecar, reusing Hive's existing supervision beneath it, and superseding the per-daemon OS services on adoption.** Concretely:

1. **Bundled Node sidecar, not Electron's Node.** The shell ships a pinned standalone Node ≥22.5 per target OS and spawns the daemons with it as their `execPath`. Because the daemons read `process.execPath` for their own self-spawns, they re-invoke the *sidecar* Node — so nectar's `--experimental-sqlite` self-spawn and honeycomb's embed-daemon spawn work **unmodified**. No daemon source change is required.

2. **Supervision topology: Shell → { Doctor, Hive }; Doctor → workload daemons.** The continuous runtime supervisor is **Doctor** (its restart rungs in `doctor/src/backoff.ts`, registry-driven), not Hive — Hive's `spawn.ts` is install-time and its runtime role is the portal. So the shell starts the fleet and keeps the two *roots* alive — **Doctor** (the workload supervisor) and **Hive** (the dashboard host) — while **Doctor retains sole restart authority over honeycomb, nectar, and the embed daemon, unchanged.** The shell never restarts a workload directly and re-implements no per-daemon supervision. (This corrects the initial "Shell → Hive → daemons" framing to the actual supervision graph while honoring the same intent — reuse the working supervisor rather than reimplement it. Doctor's *own* liveness, previously held by its OS service, transfers to the shell per decision 4.)

3. **Doctor keeps its watchdog role, and the boundary is enforced by registry ownership.** Doctor keeps honeycomb, nectar, and the embed daemon alive via its existing rungs; the shell keeps Doctor and Hive alive. The non-overlap is made **provable**, not merely conventional, through three rules on existing mechanisms:
   - **One owner per registry entry.** The doctor registry (`~/.apiary/registry.json`, `RegistryEntrySchema` already carrying `pidPath`) records a supervisor-owner per daemon — Doctor owns the workloads, the shell owns Doctor + Hive — and a supervisor only ever restarts entries it owns. The shell has no code path that restarts a workload.
   - **PID-liveness no-op.** Every restart checks the entry's `pidPath` first; a live PID short-circuits to a no-op, so even a hypothetical race cannot double-spawn one daemon.
   - **Shell supervises only the two roots.** Doctor's crash-restart of the workloads is untouched; the single new supervision edge is the shell keeping Doctor up (the liveness Doctor's OS service used to provide), and that edge targets a root, never a workload.

   Doctor is retained specifically so the shell is not a single point of failure for workload liveness.

4. **Automatic OS-service takeover on adoption.** On first run as fleet owner, the shell detects existing Apiary service units, stops and deregisters them (current + legacy labels, reusing PRD-003's machinery), starts the fleet under the sidecar, and registers itself for launch-at-login (`app.setLoginItemSettings`). The takeover is idempotent (re-running is a no-op) and logs what it changed. After it, the app is the **sole** autostart owner.

5. **A detected standalone `@deeplake/hivemind` is uninstalled — with the user's consent, prompted on install.** When the desktop app installs and detects a standalone Hivemind sharing `~/.deeplake`, it **prompts the user that it will uninstall Hivemind** and proceeds only on agreement; on agreement it performs a full uninstall of the standalone product so the machine has a single Deep Lake owner. The install-time prompt is the consent gate that turns the earlier "silent takeover" into a user-approved action. Bounds: the uninstall **never deletes the shared `~/.deeplake` credential or the user's memory data** — only the standalone product's binary/service/autostart is removed; reversal is the user reinstalling the public `@deeplake/hivemind` package. If the user **declines**, the **desktop install is aborted** — the app does not install alongside a standalone Hivemind, so a two-owner contention state never arises.

This ADR does **not** change auth or storage (the Deep Lake device flow and Deep Lake backend are untouched — reaffirmed against PRD-004/PRD-005), nor the renderer's source (Hive's dashboard is loaded from loopback `:3853`, a PRD-005b decision), nor the embeddings packing decision (the desktop build packs the model per PRD-005/ADR-0004). It records only the supervision + service-supersession model.

### Scope: desktop only

The OS-service path (PRD-003) remains the supervision model for headless / server / CI installs. This ADR governs the **desktop** deployment; it does not retire the service manager for machines without a desktop session.

## Consequences

**Positive.**

- **Reuses working supervision.** The Shell → { Doctor, Hive } topology keeps Doctor's tested restart rungs as the workload supervisor; the shell adds supervision of two roots, not per-daemon supervision of four. The desktop and headless paths stay close, reducing divergence.
- **Liveness survives shell trouble.** Retaining Doctor means daemon self-heal does not depend on the Electron process being healthy; a workload crash is still caught by Doctor even if the shell is busy or wedged.
- **One clean autostart owner.** Automatic takeover removes the double-start hazard and gives users a single, legible "the app *is* the fleet" model instead of an invisible service plus a window.
- **Daemons run unchanged.** The sidecar Node preserves every `execPath`/`--experimental-sqlite` assumption, so no daemon needs to learn it is running under Electron.
- **A single Deep Lake owner** (decision 5) avoids two processes racing over the shared `~/.deeplake` credential and storage on machines that also carried a standalone Hivemind.

**Negative.**

- **Two supervisors coexist, so the ownership boundary must be exact.** The shell watches Hive; Doctor watches the workloads. If that boundary is ever blurred (e.g. both try to restart the embed daemon), they can fight. Mitigation: the boundary is a documented invariant — shell⇒Hive only, Doctor⇒workloads — and must be enforced, not assumed.
- **The sidecar Node adds weight and a per-OS artifact** to ship, pin, and update (tens of MB per target), and a new thing that must track Node security releases.
- **Takeover mutates host service state.** Stopping and deregistering OS units on the user's machine must be idempotent, well-logged, and reversible-enough; a botched takeover could leave the fleet unstarted. It reuses PRD-003's tested teardown to limit that risk.
- **The standalone-Hivemind takeover reaches beyond Apiary-owned units (decision 5) — consent-gated and install-blocking.** The shell uninstalls a separately-installed product, which is intrusive; the install-time prompt makes it user-approved rather than silent, and a **decline aborts the app install**, so a two-owner contention state never arises. The strict never-touch-data/credential rule applies, and reversal is a user reinstall of the public package. The cost of this crispness: the desktop app will not install on a machine running standalone Hivemind unless the user consents to removing it — an all-or-nothing gate, chosen deliberately over a muddier coexistence.

**Reversibility.** Moderate, and now specified. On shell uninstall, the shell **de-registers and stops** the fleet (removes its launch-at-login and the units/registrations it owns) and does **not** resurrect the superseded OS services — a clean removal, not a restore. A standalone Hivemind uninstalled during takeover (decision 5) is reversed by the user reinstalling the public `@deeplake/hivemind` package; the shell does not silently re-create it. The shared `~/.deeplake` credential and the user's memory data are preserved throughout, so no reversal touches user data.

## Alternatives considered and rejected

### A. Run the daemons inside Electron's Node (`utilityProcess`/`fork`) (REJECTED)

Avoid shipping a separate Node by running the daemons in Electron's bundled Node. Rejected on the forcing function: Electron's `execPath` and flag posture break nectar's `--experimental-sqlite` self-spawn and honeycomb's `execPath` embed spawn. It trades a modest size saving for a broken runtime contract in two daemons.

### B. Shell supervises all four daemons directly (REJECTED — Q1)

Have the Electron main process spawn and health-check honeycomb, nectar, doctor, and hive itself. Rejected because it duplicates Doctor's already-working, registry-driven crash-restart supervision, maximizes new shell surface, and lets the desktop supervision path drift from the headless one. The chosen Shell → { Doctor, Hive } topology reuses the tested supervisor (Doctor) for a fraction of the risk.

### C. Retire Doctor on desktop / absorb its watchdog into the shell (REJECTED — Q2)

Make the Electron main process the sole liveness authority and not run Doctor on desktop. Rejected because it discards Doctor's independent self-heal and makes the shell a single point of failure for daemon liveness — if the shell is wedged, nothing catches a workload crash. Keeping Doctor costs a documented ownership boundary; removing it costs resilience.

### D. Coexist with the OS services / do not autostart when services exist (REJECTED — Q3)

Let the shell run as a viewer/launcher while the OS services keep owning autostart. Rejected because it either risks double-starting the fleet or leaves a muddled two-owner model where the app never becomes the real owner — the exact ambiguity the desktop shell exists to remove.

### E. Never touch non-Apiary installs; only manage Apiary-owned units (CONSIDERED, NOT CHOSEN — Q4)

Leave a standalone `@deeplake/hivemind` entirely alone, managing only Apiary units, even though it shares `~/.deeplake`. This is the **safer** option and avoids surprising a deliberate standalone user. It was not chosen: the decision (5) is to present a single Deep Lake owner on the machine. Recorded here because it is the natural fallback if the takeover in decision 5 proves too surprising in practice — reverting to this is the low-risk retreat.

## Open questions (to resolve at PRD/implementation time)

1. **Uninstall reversibility — RESOLVED.** On shell uninstall, de-register and stop the fleet; do **not** re-register the superseded OS services (clean removal, not restore). A standalone Hivemind uninstalled during takeover is restored by the user reinstalling `@deeplake/hivemind`.
2. **Shell⇔Doctor boundary — RESOLVED (enforcement in decision 3).** Registry single-owner per daemon + `pidPath`-liveness no-op + shell-supervises-roots-only. Remaining *implementation* detail: populate the owner field on registry entries and add the pid-liveness check in the shell's start path.
3. **Standalone-Hivemind mechanics — RESOLVED.** Detect on install → prompt the user it will uninstall Hivemind → on consent, full uninstall (credential/data preserved), reversal = user reinstall; on **decline, abort the desktop install** (no coexistence, no two-owner state, machine left unchanged). Remaining is *implementation* detail only: how Hivemind is detected (npm global / service unit / a live `:3850`) and the exact uninstall invocation.
4. **Sidecar Node sourcing / pinning / size,** and whether `--experimental-sqlite` is still required at the pinned Node version or `node:sqlite` has stabilized (removing the flag from nectar's self-spawn). Shared with PRD-005a/005d.
5. **Desktop + server on one host.** A machine with both a desktop session and a server/service install must not have both autostart owners active; confirm the two scopes (this ADR = desktop; PRD-003 = headless) do not collide.

## References

- [`PRD-005` Apiary Desktop Shell (Electron)](../../../requirements/backlog/prd-005-desktop-shell/prd-005-desktop-shell-index.md) and its sub-PRDs — the shell this ADR sets the process model for; PRD-005a (supervisor) and PRD-005c (native integration + service migration) implement decisions 1–5.
- [`PRD-003` Fleet Lifecycle, Login Deferral, and One-Command Uninstall](../../../requirements/completed/prd-003-fleet-lifecycle-login-and-uninstall/prd-003-fleet-lifecycle-login-and-uninstall-index.md) — the OS-service deregistration + legacy-name machinery the takeover (decision 4) reuses.
- `doctor/src/backoff.ts` and the doctor registry (`~/.apiary/registry.json`, `RegistryEntrySchema` with `pidPath`) — Doctor's crash-restart rungs and the single-owner registry the boundary (decision 3) is enforced through.
- `hive/src/daemon/installer/spawn.ts` (install-time argv-safe spawn) and `hive/src/daemon/registry.ts` (reads the doctor registry to route the portal) — the evidence Hive is the portal/installer, not the runtime supervisor (topology correction, decision 2).
- `hive/src/service/platform.ts` — the launchd/systemd/schtasks logic + legacy labels the takeover supersedes.
- `nectar/src/cli.ts:191` — the `--experimental-sqlite` self-spawn the sidecar Node (decision 1) must satisfy.
- `honeycomb/src/daemon/runtime/services/embed-supervisor.ts` — honeycomb's `execPath`-based embed spawn, the other self-spawn the sidecar preserves.
- [`ADR-0003-fleet-directory-ownership-and-neutral-state-root.md`](./ADR-0003-fleet-directory-ownership-and-neutral-state-root.md) — `~/.apiary/<product>/`, beside which the shell's user-data supervisor state lives.
- [`ADR-0004-extract-embedding-engine-into-standalone-fleet-daemon.md`](./ADR-0004-extract-embedding-engine-into-standalone-fleet-daemon.md) — the embed daemon the desktop build packs (per PRD-005d) rather than downloading.
