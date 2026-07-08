# PRD-004a: In-App Authentication Window

> **Parent:** [PRD-004](./prd-004-branded-in-app-signin-index.md)
> **Status:** Backlog
> **Priority:** P1
> **Effort:** M (1-3d), assuming the desktop shell's window/IPC substrate exists.
> **Schema changes:** None. No daemon endpoint, credential-format, or device-flow change.

---

## Overview

This is the mechanism at the heart of PRD-004: render the Deep Lake approval page in a window the app owns, driven by the flow the fleet already runs.

Today Hive's onboarding calls `POST /setup/login`, receives `verification_uri_complete`, and shows the user a device code to type into a browser; it then polls `GET /setup/state` until `authenticated` ([`login-step.tsx`](../../../../hive/src/dashboard/web/onboarding/login-step.tsx), [`setup-login.ts`](../../../../honeycomb/src/daemon/runtime/dashboard/setup-login.ts)). Under the desktop shell we intercept at the moment the renderer has `verification_uri_complete`: instead of instructing the user to leave, the renderer hands that URL to the Electron main process, which opens it in an owned `BrowserWindow`. The daemon keeps polling `/auth/device/token` and minting via `/users/me/tokens` in the background; the renderer keeps polling `/setup/state`. When `authenticated` flips true, main closes the window. **No redirect is captured, no loopback listener runs, no code is parsed** — the decoupled device flow makes the window a pure display surface.

A second path also spawns a browser today: honeycomb's (and nectar's) own device-flow client shells to the OS opener via the injectable `BrowserOpener` seam ([`deeplake-issuer.ts`](../../../../honeycomb/src/daemon/runtime/auth/deeplake-issuer.ts) `defaultBrowserOpener`, which `execFileSync`s the platform opener). Under the shell that seam must not reach the system browser. Because PRD-003 already defers login to Hive whenever Hive is present — and under the shell Hive is effectively always present — the primary answer is that the Hive-owned UI path is the only initiator and the daemon's `openBrowser` is suppressed; the fallback answer (for any solo/CLI login that still fires) is to route that seam to the same in-app window. Which mechanism (env-gated suppression vs. an injected shell opener) is settled here.

## Goals

- The renderer, on receiving `verification_uri_complete` from `POST /setup/login`, opens the Auth0 page in an owned `BrowserWindow` via a main-process IPC — never `shell.openExternal`.
- The window's lifecycle is bound to the existing state poll: it closes automatically when `/setup/state.authenticated` is true, and the dashboard advances without a manual step.
- The org-bound token never reaches the renderer, the main process, or the auth window; it lands only in `~/.deeplake/credentials.json` via the daemon's existing writer.
- honeycomb's/nectar's `BrowserOpener` does not spawn a system browser under the shell: it is either suppressed in favor of the Hive-owned flow or routed to the in-app window.
- The window opens only for an `https` URI received from the daemon, preserving the existing scheme validation.

## Non-Goals

- Session persistence and IdP-method resilience — that is [004b](./prd-004b-branded-in-app-signin-session-and-idp-resilience.md).
- The branded pre-login screen, chrome, and copy — that is [004c](./prd-004c-branded-in-app-signin-branded-presentation.md).
- Building the shell's generic window/IPC framework (prerequisite from the shell initiative).
- Any change to `POST /setup/login` / `GET /setup/state` or the device-flow protocol.

## Acceptance criteria

| ID | Criterion |
|---|---|
| a-AC-1 | On receiving `verification_uri_complete` from `POST /setup/login`, the renderer opens it in an app-owned `BrowserWindow` through a main-process IPC channel; `shell.openExternal` is not called on this path (parent AC-1). |
| a-AC-2 | The shell captures no OAuth redirect and runs no loopback/callback listener: sign-in completion is observed solely via the existing `GET /setup/state` poll (parent AC-2). |
| a-AC-3 | The bearer/device token is never passed to the renderer, main process, or auth window; after success it exists only in `~/.deeplake/credentials.json` (0600), written by the daemon's credential store (parent AC-3). |
| a-AC-4 | When `/setup/state.authenticated` becomes true, the auth window closes automatically and the parent flow advances; a user-closed window before completion returns the UI to a re-tryable state, not a hang (parent AC-4). |
| a-AC-5 | The window opens only for an `https` URI received from the daemon; a non-`https` or page-derived URL is refused (parent security). |
| a-AC-6 | Under the desktop shell, honeycomb's and nectar's `BrowserOpener` do not launch a system browser: the seam is suppressed (Hive-owned flow is sole initiator) or resolves to the in-app window (parent AC-9). |
| a-AC-7 | The IPC channel carries only the verification URL and window-lifecycle signals — never a token, device code secret, or credential (parent AC-3). |

## Implementation notes

- **Interception point.** The renderer already holds `verification_uri_complete` (it is in the `POST /setup/login` response body — [`setup-login.ts`](../../../../honeycomb/src/daemon/runtime/dashboard/setup-login.ts)). The cleanest hook is in the login-step's success handler: instead of rendering the code-to-copy affordance, emit an IPC (`auth:open-window`, payload = the URL) to main. This needs no daemon change.
- **Window ownership in main.** Main creates a child `BrowserWindow` (modal to the dashboard window or a dedicated window), loads the URL, and holds a handle. A main→renderer `auth:window-closed` signal lets the UI reconcile if the user closes it manually.
- **Closing on completion.** Two options: (1) the renderer, on seeing `authenticated`, IPCs `auth:close-window` to main; (2) main independently polls `/setup/state`. Prefer (1) — single poller (the renderer), single source of truth, less duplication.
- **The `openBrowser` seam.** `defaultBrowserOpener` in [`deeplake-issuer.ts`](../../../../honeycomb/src/daemon/runtime/auth/deeplake-issuer.ts) is already injectable and returns `true` iff it opened the URL. Under the shell, either (a) the daemons run with login deferred to Hive (PRD-003a) so this never fires, or (b) inject a shell-aware opener that signals main. Because the daemons are sidecar processes separate from Electron main, a daemon-side opener cannot open an Electron window directly — it would have to signal the shell (e.g. via a small loopback callback the shell listens on). Suppression via PRD-003 deferral is the simpler, preferred path; document the callback approach only as the solo-login fallback.
- **Token isolation is free.** The device flow already keeps the token off the page — `POST /setup/login` returns "user_code + the verification URIs. NEVER the device/bearer token" ([`setup-login.ts`](../../../../honeycomb/src/daemon/runtime/dashboard/setup-login.ts)). This sub-PRD must not regress that by, e.g., reading the token into the renderer to detect completion; `/setup/state`'s boolean is the only completion signal needed.

## Open questions

- [ ] **Modal vs. standalone window.** Should the auth window be modal to the dashboard (blocks interaction, clearly "one task") or a sibling window? Modal reads as more app-native for a blocking step.
- [ ] **Who owns the completion poll** — renderer (preferred, single poller) or main? If the auth window can outlive the dashboard window, main may need its own signal.
- [ ] **Solo-login callback.** If a solo honeycomb/nectar login under the shell must reach the in-app window, what is the daemon→shell signal (a loopback endpoint the shell registers)? Only needed if PRD-003 deferral does not already suppress it.

## Related

- [`hive/src/dashboard/web/onboarding/login-step.tsx`](../../../../hive/src/dashboard/web/onboarding/login-step.tsx) — the component whose success handler grows the IPC hook.
- [`honeycomb/src/daemon/runtime/dashboard/setup-login.ts`](../../../../honeycomb/src/daemon/runtime/dashboard/setup-login.ts) — the `POST /setup/login` contract (URIs, no token, `https`-revalidated).
- [`honeycomb/src/daemon/runtime/auth/deeplake-issuer.ts`](../../../../honeycomb/src/daemon/runtime/auth/deeplake-issuer.ts) — the `BrowserOpener` seam to suppress/redirect under the shell.
- [`PRD-003a` Solo-vs-Fleet Login Deferral](../../completed/prd-003-fleet-lifecycle-login-and-uninstall/prd-003a-fleet-lifecycle-login-and-uninstall-solo-vs-fleet-login-deferral.md) — the deferral rule that makes suppression the primary answer.
