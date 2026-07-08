# PRD-005: Apiary Desktop Shell (Electron)

> **Status:** In-work
> **Priority:** P1 (the foundation the desktop product rests on; PRD-004's in-app sign-in and any native-app ambition depend on it existing)
> **Effort:** XL (> 3d; a walking skeleton is small, a shippable cross-OS installer is weeks)
> **Schema changes:** None to any Deeplake catalog. Replaces the fleet's OS-service autostart with an app-managed supervisor; adds a new `apiary-desktop` package and its installers.

---

## Overview

Today the Apiary is four headless daemons — Honeycomb (memory), Nectar (source map), Doctor (watchdog), and Hive (portal) — each binding a loopback port, each auto-started by an OS service manager (launchd / systemd / schtasks — [`hive/src/service/platform.ts`](../../../../hive/src/service/platform.ts)), with the UI reached by opening `127.0.0.1:3853` in a browser. It works, but it asks a non-technical user to trust a background service they can't see and a browser tab pointed at loopback.

This module specifies a **desktop (Electron) shell** that turns the fleet into one visible application: a native window that renders the dashboard, a tray presence, launch-at-login, and — critically — a **main process that supervises the daemons itself**, replacing the per-daemon OS services. The pleasant reality uncovered during scoping is that most of the hard parts already exist: Hive is already a full React SPA dashboard served over loopback ([`hive/src/dashboard/web/app.tsx`](../../../../hive/src/dashboard/web/app.tsx), [`hive/src/daemon/dashboard/host.ts`](../../../../hive/src/daemon/dashboard/host.ts)), and Hive already spawns and registers the other daemons ([`hive/src/daemon/installer/spawn.ts`](../../../../hive/src/daemon/installer/spawn.ts), [`hive/src/daemon/registry.ts`](../../../../hive/src/daemon/registry.ts)). So Electron does not mean "build a UI" — it means **give Hive's dashboard a native window and make the shell the fleet's supervisor and updater.**

Two things are genuinely new engineering, and this PRD centers on them:

1. **The Node-runtime model.** The daemons assume a real Node ≥22.5 and re-spawn *themselves* with flags — Nectar runs `spawn(process.execPath, ["--experimental-sqlite", …])` ([`nectar/src/cli.ts:191`](../../../../nectar/src/cli.ts)) and Honeycomb spawns the embed daemon via `execPath`. Electron's bundled Node has a different `execPath` and flag posture, so the daemons must **not** run inside Electron's Node. The shell ships a standalone Node ≥22.5 sidecar and spawns the daemons with it, keeping every `execPath` / `--experimental-sqlite` assumption intact.
2. **Packaging the embeddings runtime — packed, not downloaded.** The embeddings runtime (`@huggingface/transformers` + its native ONNX runtime, plus the nomic-embed-text-v1.5 model, ~600 MB — [`honeycomb/package.json`](../../../../honeycomb/package.json)) is **bundled into the desktop app**. In the npm-package world it is an optional first-run download with a BM25 lexical fallback, to keep the tarball lean; for the desktop product that trade is wrong — semantic recall *is* the point, a ~600 MB first-run download is a poor first impression, and silently degrading to BM25 ships the marquee feature quietly worse. So the desktop build packs the model + runtime (asar-unpacked for the native ONNX binaries and the large model file) and is large by design; BM25 remains only as a safety net. Tree-sitter is WASM, so no native-ABI pain there. (The npm-package distribution is unchanged — only the desktop build packs.)

The signing/notarization reality is understood and accepted (no EV cert today): unsigned is fine for internal/dev builds; a public installer wants at least an Apple Developer ID (mac notarization + auto-update) and ideally an OV cert (Windows SmartScreen). This module treats signing as a **separate track gated on certs**, not a blocker for the shell itself.

This is the parent of [`PRD-004`](../prd-004-branded-in-app-signin/prd-004-branded-in-app-signin-index.md) (branded in-app sign-in), and it builds directly on [`PRD-003`](../../completed/prd-003-fleet-lifecycle-login-and-uninstall/prd-003-fleet-lifecycle-login-and-uninstall-index.md) (fleet lifecycle and the OS-service model this replaces).

---

## Goals

- **One visible app.** A native window renders the existing Hive dashboard; the user never opens a browser tab or juggles loopback origins.
- **The shell is the supervisor.** The Electron main process starts, health-checks, restarts, and cleanly stops the fleet, replacing the launchd/systemd/schtasks autostart for daemons managed by the app.
- **Daemons run on a bundled Node ≥22.5 sidecar,** not Electron's Node, preserving every `execPath` and `--experimental-sqlite` assumption in the existing daemons unchanged.
- **Launch at login** via the app (`setLoginItemSettings`), so the fleet boots with the device as it does today — but owned by the app, not the OS service manager.
- **Native presence:** tray with fleet status + quick actions, an app menu, and native notifications for state the dashboard would otherwise hide.
- **Auto-update** on the OS'es where signing permits it, with an honest manual-download fallback where it does not.
- **Semantic recall works on first launch, offline:** the embeddings model + ONNX runtime ship inside the app, so recall is semantic from the first query with no download; the BM25 lexical fallback remains only as a safety net, not the shipped default.
- **Single instance, clean ports:** one running fleet per machine; a second launch focuses the existing window; a port already in use is detected and surfaced, not crashed into.
- **No daemon source changes required to run under the shell** beyond what PRD-003/PRD-004 already specify; the shell adapts to the daemons, not the reverse.

## Non-Goals

- **The in-app sign-in experience.** How Deep Lake's login renders inside the app is [`PRD-004`](../prd-004-branded-in-app-signin/prd-004-branded-in-app-signin-index.md); this module provides the window/session substrate it assumes.
- **Code-signing certificate procurement.** Acquiring an Apple Developer ID / Windows OV cert is a business action; this module specifies the packaging that *uses* them and the unsigned fallback, not the purchase.
- **Mac App Store / Microsoft Store distribution.** Store submission (and the Apple IAP rules it would drag in) is out; distribution here is direct-download installers.
- **Rewriting the daemons or the dashboard.** Honeycomb, Nectar, Doctor, and Hive keep their current architecture; the shell consumes their built outputs. The dashboard is Hive's, reused as-is.
- **Replacing Deep Lake auth or storage.** Auth stays the Deep Lake device flow; storage stays Deep Lake. (Reaffirmed to avoid the earlier ambiguity: the shell changes packaging and where things render, never the auth or storage backend.)
- **Retiring Hive.** Hive remains the portal daemon that serves the dashboard and can supervise workload daemons; this PRD decides only how the shell relates to it (open question below), not whether it exists.
- **A headless/server deployment mode.** The OS-service path (PRD-003) remains for headless/CI/server installs; the shell is the desktop face, not a replacement for every deployment.

---

## Sub-features

| Sub-PRD | Scope | Status |
|---|---|---|
| [`prd-005a-...-main-process-supervisor`](./prd-005a-desktop-shell-main-process-supervisor.md) | The main-process fleet supervisor: bundled Node sidecar, spawn/health-check/restart/stop of the daemons, single-instance lock, port-in-use handling, graceful shutdown, and the Hive-relationship decision. | In-work |
| [`prd-005b-...-dashboard-window`](./prd-005b-desktop-shell-dashboard-window.md) | Rendering Hive's dashboard in a `BrowserWindow` (loopback vs. bundled-asset decision), the renderer security posture, window lifecycle, and the deep-link/IPC surface PRD-004 builds on. | In-work |
| [`prd-005c-...-native-integration-and-autostart`](./prd-005c-desktop-shell-native-integration-and-autostart.md) | Tray, app menu, native notifications, launch-at-login, and the migration off per-daemon OS services (deregister launchd/systemd/schtasks; avoid double-spawn; reconcile with Doctor's watchdog role). | In-work |
| [`prd-005d-...-packaging-updates-distribution`](./prd-005d-desktop-shell-packaging-updates-distribution.md) | electron-builder installers per OS, asar + embeddings/native-artifact placement, electron-updater wiring, the signing/notarization tracks, and how the shell consumes the four submodules' built bundles. | In-work |

---

## Acceptance criteria (module-level)

| ID | Criterion |
|---|---|
| AC-1 | Launching the app renders the existing Hive dashboard in a native window; the user reaches the full dashboard with no browser and no manual loopback URL entry. |
| AC-2 | The Electron main process starts the fleet on launch, health-checks each daemon, restarts a crashed daemon within a bounded policy, and stops all daemons cleanly on quit — with no orphaned processes left behind. |
| AC-3 | The daemons run on a bundled standalone Node ≥22.5 sidecar (not Electron's Node); Nectar's `--experimental-sqlite` self-spawn and Honeycomb's embed-daemon `execPath` spawn work unmodified under the shell. |
| AC-4 | The app registers launch-at-login through Electron; on a machine where the shell manages the fleet, the per-daemon OS service units (current and legacy labels) are deregistered so the fleet is not double-started. |
| AC-5 | A tray presence shows live fleet status and offers at least open-dashboard / restart-fleet / quit; native notifications fire for at least one critical state (e.g. a daemon that cannot be restarted). |
| AC-6 | Only one fleet runs per machine: a second app launch focuses the existing window instead of starting a second supervisor or double-binding ports; a port already in use is detected and surfaced as an actionable message, not a crash. |
| AC-7 | The embeddings model and its native ONNX runtime are bundled in the packaged app (asar-unpacked); semantic recall works on a freshly installed, offline machine from the first query with no external model download; the BM25 lexical fallback remains available as a safety net but is not the shipped default. |
| AC-8 | The renderer window runs with `contextIsolation` on and `nodeIntegration` off; any privileged capability is exposed only through a minimal, explicit preload bridge. |
| AC-9 | electron-builder produces installable artifacts for macOS, Windows, and Linux from the four submodules' built bundles; an unsigned build installs and runs (with the known OS trust warnings), and the packaging is structured so that adding signing/notarization later requires config, not re-architecture. |
| AC-10 | Auto-update works on platforms where signing is present; where it is absent, the app degrades to a clear "update available — download" prompt rather than a broken silent-update path. |
| AC-11 | On install, a detected standalone `@deeplake/hivemind` triggers a consent prompt; on consent the app fully uninstalls it (preserving `~/.deeplake` credential + memory data); on decline the app install is aborted with the machine left unchanged. |

---

## Data model changes

No Deeplake catalog changes. Persistent effects, all shell-managed:

- **Supervisor state / logs** under the app's user-data dir (Electron `app.getPath("userData")`): daemon PIDs, last-restart bookkeeping, and shell logs. Distinct from the fleet's `~/.apiary` state root (ADR-0003), which the daemons continue to own.
- **The embeddings model + ONNX runtime** are packed into the app resources (asar-unpacked, ~600 MB), so no first-run model download occurs. Any runtime scratch/cache the engine writes still lives in user-data, but the model weights ship in the installer.
- **Deregistered OS service units** (AC-4): the migration removes the launchd/systemd/schtasks units the app now supersedes, reusing PRD-003's uninstall/legacy-name coverage.
- **Bundled Node sidecar** shipped inside the app resources (unpacked from asar as needed).

---

## API and configuration changes

- **New package:** `apiary-desktop` (Electron main + preload + minimal renderer glue), consuming the built `dist`/`bundle` outputs of the four submodules (or their published npm tarballs) rather than vendoring source. Ties into the existing version orchestration ([`hive-release.json`](../../../../hive-release.json), [`scripts/`](../../../../scripts/)).
- **Bundled Node runtime:** a pinned standalone Node ≥22.5 binary per target OS, used as the daemons' `execPath`.
- **Shell↔renderer IPC:** a minimal, explicit preload bridge (open external URL policy, fleet-status subscription, restart/quit actions) — and the auth-window channel PRD-004 defines.
- **No daemon endpoint changes.** The shell talks to the daemons over their existing loopback HTTP surfaces (health, `/setup/*`, dashboard host).
- **Launch-at-login** via `app.setLoginItemSettings`, replacing the daemon OS-service autostart on shell-managed machines.

---

## Security considerations

- **Renderer isolation.** `contextIsolation: true`, `nodeIntegration: false`, sandbox on, no remote module; privileged actions cross only a minimal, audited preload bridge. The renderer loads dashboard content that itself proxies to daemons — treat the boundary with care.
- **Loopback-only, token/gate preserved.** The shell must not widen the daemons' exposure beyond loopback, and must preserve Hive's existing gate/token model ([`hive/src/daemon/gate.ts`](../../../../hive/src/daemon/gate.ts)); if the renderer loads bundled assets via a custom protocol instead of `http://127.0.0.1:3853`, the same-origin/gate assumptions must be re-satisfied, not bypassed.
- **Argv-safe spawning.** Daemon spawning must stay injection-proof (argv arrays, `shell:false`), matching the discipline already in [`hive/src/daemon/installer/spawn.ts`](../../../../hive/src/daemon/installer/spawn.ts); the shell must not introduce a shell-string spawn path.
- **Supervisor authority.** The main process holds the power to spawn processes and write user-data; keep that surface small and never let renderer-supplied strings become spawn arguments or file paths.
- **Update integrity.** Auto-update artifacts must be integrity-checked (signature where signing exists; at minimum checksum verification), mirroring the "inspect before you pipe" posture PRD-003 holds for the installer.
- **No secret in the bundle beyond the known public telemetry key.** The existing build-time telemetry key discipline (public write-only, CI-injected — [`hive/esbuild.config.mjs`](../../../../hive/esbuild.config.mjs)) carries forward; the shell adds no new embedded secret.

---

## Open questions

- [x] **Shell vs. Hive as top supervisor** — **Decided ([`ADR-0005`](../../../knowledge/private/architecture/ADR-0005-desktop-shell-fleet-supervision-and-os-service-supersession.md)):** the runtime supervisor is **Doctor**, not Hive (Hive's spawn is install-time; its runtime role is the portal). The shell keeps the two roots (Doctor + Hive) alive; Doctor retains sole restart authority over the workloads; the shell reimplements no per-daemon supervision. Implemented in 005a.
- [x] **Doctor's role under the shell** — **Decided (ADR-0005):** Doctor keeps its watchdog role unchanged; the shell owns only Hive's liveness, so ownership is non-overlapping. The remaining work is enforcing that boundary (005a/005c open questions).
- [ ] **Renderer source: loopback vs. bundled asset.** Point the `BrowserWindow` at `http://127.0.0.1:3853` (keep Hive serving, zero dashboard change — fastest) or load the esbuild SPA bundle via a custom protocol (one fewer dependency, but re-opens gate/same-origin work)? Proposed: loopback first (005b).
- [ ] **Bundled Node sourcing and size.** Which Node ≥22.5 distribution is shipped per OS, how is it pinned/updated, and what is the app-size budget impact? Is `--experimental-sqlite` still required at the target Node version, or has `node:sqlite` stabilized (removing the flag)?
- [x] **Migration for existing installs** — **Decided (ADR-0005):** automatic takeover of the Apiary OS service units (stop + deregister, reuse PRD-003 teardown, idempotent + logged); on shell uninstall, de-register and stop — do **not** restore the OS services (clean removal, not restore).
- [x] **Which daemons the shell manages vs. leaves to services** — **Decided (ADR-0005):** single machine owner; a detected standalone `@deeplake/hivemind` is **uninstalled with the user's consent, prompted on install** (never deletes `~/.deeplake` credential/data; reversal = reinstall); on **decline, the app install is aborted** (no two-owner state).
- [x] **ADR** — **Done:** [`ADR-0005`](../../../knowledge/private/architecture/ADR-0005-desktop-shell-fleet-supervision-and-os-service-supersession.md) (Proposed) records the supervision + OS-service-supersession model.

---

## Related

- [`PRD-004` Branded In-App Deep Lake Sign-In](../prd-004-branded-in-app-signin/prd-004-branded-in-app-signin-index.md) — the child module; its in-app auth window assumes this shell's window/session/IPC substrate.
- [`PRD-003` Fleet Lifecycle, Login Deferral, and One-Command Uninstall](../../completed/prd-003-fleet-lifecycle-login-and-uninstall/prd-003-fleet-lifecycle-login-and-uninstall-index.md) — the OS-service lifecycle this shell supersedes on desktop; its uninstall/purge allow-lists are reused for service deregistration.
- [`PRD-001` Hive Release Manifest and Combined Release Train](../prd-001-hive-release-manifest-and-ci/prd-001-hive-release-manifest-and-ci-index.md) — the pinned fleet versions the shell packages.
- [`ADR-0003` Fleet directory ownership and neutral state root](../../../knowledge/private/architecture/ADR-0003-fleet-directory-ownership-and-neutral-state-root.md) — `~/.apiary`, which the daemons keep owning under the shell.
- [`ADR-0004` Extract the embedding engine into a standalone fleet daemon](../../../knowledge/private/architecture/ADR-0004-extract-embedding-engine-into-standalone-fleet-daemon.md) — the embed daemon the shell spawns. ADR-0004's lean posture keeps the model **out** of the `@deeplake/hivemind` npm tarball (first-run download); the **desktop build is the deliberate exception** and packs the model (asar-unpacked) so semantic recall works offline on first launch — see Overview §2 and AC-7. The two distributions differ on packaging only, not on the embed daemon itself.
- Fleet assets this module builds on:
  - [`hive/src/dashboard/web/app.tsx`](../../../../hive/src/dashboard/web/app.tsx) and [`hive/src/daemon/dashboard/host.ts`](../../../../hive/src/daemon/dashboard/host.ts) — the dashboard the window renders.
  - [`hive/src/daemon/installer/spawn.ts`](../../../../hive/src/daemon/installer/spawn.ts) and [`hive/src/daemon/registry.ts`](../../../../hive/src/daemon/registry.ts) — the existing spawn/registry supervision the shell reuses or wraps.
  - [`hive/src/service/platform.ts`](../../../../hive/src/service/platform.ts) — the launchd/systemd/schtasks logic the shell's autostart replaces (and whose legacy-name deregistration it reuses).
  - [`nectar/src/cli.ts`](../../../../nectar/src/cli.ts) — the `--experimental-sqlite` self-spawn that fixes the sidecar-Node requirement.
  - [`honeycomb/src/daemon/runtime/services/embed-supervisor.ts`](../../../../honeycomb/src/daemon/runtime/services/embed-supervisor.ts) and [`honeycomb/package.json`](../../../../honeycomb/package.json) — the embed daemon and the ~600 MB runtime + model the desktop build packs (asar-unpacked) rather than downloading on first run.
