# PRD-005b: Dashboard Window and Renderer Integration

> **Parent:** [PRD-005](./prd-005-desktop-shell-index.md)
> **Status:** Backlog
> **Priority:** P1
> **Effort:** M (1-3d)
> **Schema changes:** None. Presentation/host integration only.

---

## Overview

Hive already serves a full React dashboard over loopback ([`hive/src/dashboard/web/app.tsx`](../../../../hive/src/dashboard/web/app.tsx), served by [`hive/src/daemon/dashboard/host.ts`](../../../../hive/src/daemon/dashboard/host.ts) at `127.0.0.1:3853`). This sub-PRD puts that dashboard in a native `BrowserWindow` and defines the renderer's security posture and the IPC surface that PRD-004's in-app auth window builds on.

The fastest, lowest-risk path is to point the window at `http://127.0.0.1:3853` and keep Hive serving exactly as it does today — the whole SPA, its gate, and its token model come for free, zero dashboard change. The alternative (load the esbuild SPA bundle via a custom protocol) drops one runtime dependency but re-opens the same-origin/gate assumptions the dashboard relies on. This module recommends loopback-first and treats the custom-protocol path as a later optimization.

## Goals

- The Hive dashboard renders in a native `BrowserWindow`; the user reaches the full dashboard with no browser and no manual URL.
- The renderer is isolated: `contextIsolation` on, `nodeIntegration` off, sandboxed, with privileged capability only through a minimal preload bridge.
- The window waits for the dashboard host to be ready (Hive bound) and shows an honest loading/failed state instead of a blank or error page if it is not yet up.
- A minimal, explicit IPC surface exists for the actions the shell needs (open-external policy, fleet-status, restart/quit) and for the PRD-004 auth-window channel.
- Loopback-only exposure and Hive's gate/token model are preserved, not widened or bypassed.

## Non-Goals

- Supervising/spawning the daemons (005a); tray/menu/notifications (005c); packaging (005d).
- The in-app auth window's behavior (PRD-004) — this sub-PRD provides the window/IPC substrate it consumes.
- Redesigning the dashboard UI (it is Hive's, reused as-is).

## Acceptance criteria

| ID | Criterion |
|---|---|
| b-AC-1 | The dashboard renders in a native `BrowserWindow` and reaches full functionality with no external browser and no manual loopback URL entry (parent AC-1). |
| b-AC-2 | The renderer runs with `contextIsolation: true`, `nodeIntegration: false`, and sandbox on; no Node/require surface is reachable from dashboard content (parent AC-8). |
| b-AC-3 | Privileged actions cross only a minimal, explicitly enumerated preload bridge; the bridge exposes no general `ipcRenderer` and no arbitrary spawn/file/network capability (parent AC-8 / security). |
| b-AC-4 | Before the dashboard host is ready, the window shows a loading state and, on failure to come up within a budget, an actionable message — never a raw blank/error page. |
| b-AC-5 | The window's loopback exposure is not widened beyond `127.0.0.1`, and Hive's existing gate/token model continues to apply to dashboard requests (parent security). |
| b-AC-6 | If dashboard assets are ever served via a custom protocol instead of loopback, the same-origin/gate assumptions are re-satisfied (documented), not disabled (parent security). |
| b-AC-7 | The IPC surface required by PRD-004 (open the auth window for an `https` verification URI, signal window close) is present and carries no token or secret. |

## Implementation notes

- **Loopback first.** `win.loadURL("http://127.0.0.1:3853")` once 005a reports Hive healthy. This reuses [`host.ts`](../../../../hive/src/daemon/dashboard/host.ts) and the served design-system CSS/bundle unchanged.
- **Readiness gate.** Do not `loadURL` until Hive's `/health` answers; show a native splash/loading view meanwhile. Reuse the fleet-readiness posture ([`hive/src/shared/fleet-readiness.ts`](../../../../hive/src/shared/fleet-readiness.ts)) — an answering degraded daemon counts as up.
- **Preload bridge.** Expose a small typed API via `contextBridge` (e.g. `apiary.onFleetStatus`, `apiary.restartFleet`, `apiary.openAuthWindow(url)`), never the raw `ipcRenderer`. Every channel is allow-listed.
- **External links.** Intercept `window.open` / `will-navigate`: dashboard-internal navigation stays in-window; a genuine external link (docs, Discord) uses `shell.openExternal` deliberately — but the Deep Lake auth URL does NOT (PRD-004 opens it in an owned window).
- **Custom-protocol option (deferred).** If later loading `app://` bundled assets, register a standard-scheme privileged protocol and re-establish the gate/token equivalence; note it re-opens work [`host.ts`](../../../../hive/src/daemon/dashboard/host.ts)'s same-origin design currently gives for free.

## Open questions

- [ ] **Loopback vs. custom protocol** as the shipping default. Proposed: loopback (`127.0.0.1:3853`) for v1.
- [ ] **Window chrome.** Native frame vs. custom title bar / frameless with the dashboard drawing its own chrome? Affects the branded feel PRD-004c also touches.
- [ ] **Multi-window.** Is the auth window (PRD-004) a child of the dashboard window or a sibling? Coordinated with PRD-004a's modal-vs-standalone question.
- [ ] **Offline / Hive-down UX.** If Hive cannot start, what does the window show, and does it offer a retry/logs affordance?

## Related

- [`hive/src/dashboard/web/app.tsx`](../../../../hive/src/dashboard/web/app.tsx) — the SPA the window renders.
- [`hive/src/daemon/dashboard/host.ts`](../../../../hive/src/daemon/dashboard/host.ts) and [`web-assets.ts`](../../../../hive/src/daemon/dashboard/web-assets.ts) — the loopback host and asset resolver reused as-is.
- [`hive/src/shared/fleet-readiness.ts`](../../../../hive/src/shared/fleet-readiness.ts) — the readiness posture the window's loading gate uses.
- [`hive/src/daemon/gate.ts`](../../../../hive/src/daemon/gate.ts) — the gate/token model that must be preserved.
- [`PRD-004a` In-App Authentication Window](../prd-004-branded-in-app-signin/prd-004a-branded-in-app-signin-in-app-auth-window.md) — the consumer of this sub-PRD's IPC surface.
