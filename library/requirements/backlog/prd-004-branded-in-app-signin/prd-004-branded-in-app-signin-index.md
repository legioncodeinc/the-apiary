# PRD-004: Branded In-App Deep Lake Sign-In for the Desktop Shell

> **Status:** Backlog
> **Priority:** P1 (the desktop shell's first-run trust surface; a sign-in that bounces the user out to a system browser breaks the "one app" promise the shell exists to make)
> **Effort:** M-L (gated on one Activeloop configuration unknown, not on build complexity)
> **Schema changes:** None. No credential format, device-flow protocol, or Deeplake issuer change; this module changes *where the approval page renders*, not the flow.

---

## Overview

The Apiary is exploring a desktop (Electron) shell that gives the fleet a native window, tray, and supervisor instead of a browser tab plus OS services. That shell renders Hive's existing React dashboard ([`hive/src/dashboard/web/app.tsx`](../../../../hive/src/dashboard/web/app.tsx)) in a window the product owns. This module governs one surface of that shell: **the Deep Lake sign-in must happen inside the app, never in an external system browser.**

The organizing constraint from the product owner is explicit: keep the sign-in experience branded and in-app (option "cosmetic wrap," not a self-owned identity broker), and **do not send the user to a browser window outside the app.** Everything below serves that one sentence.

This is unusually clean here because the fleet's login is a **decoupled device flow**, not a redirect-based OAuth code flow. Hive's onboarding login step ([`hive/src/dashboard/web/onboarding/login-step.tsx`](../../../../hive/src/dashboard/web/onboarding/login-step.tsx)) calls `POST /setup/login`, which returns `user_code` + `verification_uri` + `verification_uri_complete` and nothing token-shaped ([`honeycomb/src/daemon/runtime/dashboard/setup-login.ts`](../../../../honeycomb/src/daemon/runtime/dashboard/setup-login.ts)); the page then polls `GET /setup/state` until `authenticated` flips true while the daemon polls `/auth/device/token` in the background and mints the org-bound token via `/users/me/tokens`. Because the approval page and the token poll are independent, **there is no OAuth `redirect_uri` or callback to intercept** — the shell only has to *display* an `https` page and *observe* the state it is already polling. That removes the single hardest part of embedding auth in Electron.

The one open dependency is not code: what renders inside the in-app window is Activeloop's **Auth0** login page (the device flow returns a short-lived Auth0 token — [`deeplake-issuer.ts`](../../../../honeycomb/src/daemon/runtime/auth/deeplake-issuer.ts)). An Electron `BrowserWindow` renders Auth0 email/password and passwordless natively; **Google SSO is the one method that browsers-in-apps get blocked from** (Google's `disallowed_useragent`). So the achievability of "zero external browser, zero asterisks" hinges on which login methods Activeloop's Auth0 tenant exposes — the load-bearing open question below.

This module builds directly on [`PRD-003`](../../completed/prd-003-fleet-lifecycle-login-and-uninstall/prd-003-fleet-lifecycle-login-and-uninstall-index.md), which established that **login is a Hive concern when Hive is present.** The in-app auth window is the desktop shell's rendering of that same Hive-owned onboarding flow — it does not add a second login initiator.

---

## Goals

- **Sign-in never leaves the app.** When the user links Deep Lake from the desktop shell, the Auth0 approval page opens in a window the app owns (its frame, its title bar), not in Chrome/Safari/Edge. No `shell.openExternal` on the happy path.
- **Reuse the decoupled device flow verbatim.** The shell displays `verification_uri_complete` and observes `/setup/state`; it never captures a redirect, runs a loopback listener, or parses a code. The device flow, credential format, and issuer are untouched.
- **The token never touches the window or the renderer.** Approval happens in the in-app window; the daemon polls and writes the org-bound token to `~/.deeplake/credentials.json` (0600) exactly as today. The auth window handles consent only.
- **Stay signed in across launches.** A persistent, dedicated session partition holds the Deep Lake session so a returning user is not re-prompted every boot.
- **Branded framing around the Activeloop page.** The pre-login screen, the window chrome, the success and error states, and the honest "paid service, cheap to try" copy are the app's; only the Auth0 credential page inside is Activeloop's.
- **Degrade honestly, never silently.** If a login method the embedded window cannot host is unavoidable (e.g. Google-only), the shell surfaces a clear, actionable path rather than a dead white page — and the fallback behavior is a deliberate, documented decision, not an accident.

## Non-Goals

- **The desktop (Electron) shell itself.** The main-process supervisor, sidecar-Node model, tray, auto-update, packaging, and signing are [`PRD-005`](../prd-005-desktop-shell/prd-005-desktop-shell-index.md). This module assumes that shell exists and specifies only its sign-in surface.
- **Becoming the identity provider / reseller (the "broker" model).** Owning signup, running our own Auth0/Clerk, and fronting Deep Lake server-side is explicitly out — it reshapes auth, billing, tenancy, and the Activeloop relationship and is a product decision, not this PRD.
- **In-app billing / payment for Deep Lake.** Deep Lake billing is org-bound and lives on Activeloop's property; the shell links out for payment. Rendering Activeloop's checkout in-app carries the same third-party-page caveats and is out of scope here.
- **Auth0 tenant theming / custom domain.** Skinning the Auth0 Universal Login page (logo, colors, `auth.deeplake.ai`) is configurable only by the tenant owner (Activeloop) — a business ask, not an engineering task in this repo.
- **Changing the device flow, credential file, or issuer.** As in PRD-003, `~/.deeplake/credentials.json`, the device-flow protocol, and [`deeplake-issuer.ts`](../../../../honeycomb/src/daemon/runtime/auth/deeplake-issuer.ts) are unchanged; this module changes *where the approval renders*.
- **Resource-Owner Password Grant.** Collecting the user's Deep Lake password in our own form is rejected on principle (deprecated grant, breaks SSO/MFA, handling credentials for an account we don't own) and is not a fallback we pursue.
- **UA spoofing to defeat IdP webview blocks.** Faking a browser user-agent to slip past Google's embedded-webview policy is fragile and against their terms; it is a rejected approach, recorded so it is not reached for later.

---

## Sub-features

| Sub-PRD | Scope | Status |
|---|---|---|
| [`prd-004a-...-in-app-auth-window`](./prd-004a-branded-in-app-signin-in-app-auth-window.md) | The core mechanism: main↔renderer wiring that opens `verification_uri_complete` in an owned `BrowserWindow`, tied to `/setup/state`; token stays off the window; the daemon's own `openBrowser` seam is redirected/suppressed under the shell. | Draft |
| [`prd-004b-...-session-and-idp-resilience`](./prd-004b-branded-in-app-signin-session-and-idp-resilience.md) | Persistent session partition (stay-signed-in), embedded-webview method resilience, hostile-IdP detection, and the documented degradation posture for Google-only tenants. | Draft |
| [`prd-004c-...-branded-presentation`](./prd-004c-branded-in-app-signin-branded-presentation.md) | The branded framing: pre-login screen, in-window chrome, success/error/pending states, and the honest pricing copy — reusing Hive's login-step contract without a second login initiator. | Draft |

---

## Acceptance criteria (module-level)

| ID | Criterion |
|---|---|
| AC-1 | Initiating "Link Deep Lake" from the desktop shell opens the Auth0 approval page (`verification_uri_complete`) in a window owned by the app; no system browser (`shell.openExternal`) is invoked on the happy path. |
| AC-2 | The in-app window and the sign-in completion are driven by the existing decoupled device flow: the shell displays the returned verification URI and observes `GET /setup/state`, with no OAuth redirect capture, loopback listener, or code parsing anywhere in the shell. |
| AC-3 | The org-bound bearer token is never exposed to the renderer or the Electron main process: the daemon polls `/auth/device/token`, mints via `/users/me/tokens`, and writes `~/.deeplake/credentials.json` (0600) exactly as before; the auth window receives only the consent page. |
| AC-4 | When `/setup/state.authenticated` flips true, the in-app auth window closes automatically and the dashboard advances (to the PRD-011 tenancy step / dashboard) without a manual step. |
| AC-5 | A returning user who signed in previously is not forced through the full Auth0 login again on next launch: a dedicated persistent session partition preserves the Deep Lake session; a signed-out or expired session re-prompts cleanly. |
| AC-6 | The in-app auth window renders untrusted third-party content safely: `contextIsolation` on, `nodeIntegration` off, sandboxed, with no Node/preload API surface reachable by the loaded page, and navigation restricted to an allow-list of Activeloop/Auth0 origins. |
| AC-7 | For an Auth0 tenant whose available method the embedded window can host (email/password or passwordless email), a first-time user completes sign-in end to end entirely inside the app with no external browser and no dead-end. |
| AC-8 | If sign-in requires a method the embedded window cannot host (e.g. Google `disallowed_useragent`), the shell detects it and presents the pre-agreed degradation (per 004b) with a clear, actionable message — never a blank or broken page, and never a silent hang. |
| AC-9 | Under the desktop shell, honeycomb's and nectar's own device-flow `openBrowser` path ([`deeplake-issuer.ts`](../../../../honeycomb/src/daemon/runtime/auth/deeplake-issuer.ts)) does not spawn a system browser: solo/CLI-triggered logins inside the shell route to the same in-app window (or are suppressed in favor of the Hive-owned flow), consistent with PRD-003's single-initiator rule. |

---

## Data model changes

None to any Deeplake catalog, and no change to `~/.deeplake/credentials.json` (still the 0600 org-bound token file, written only by the daemon's credential store). New persistent effect, shell-side only:

- **A dedicated Electron session partition** (e.g. `persist:deeplake-auth`) holding Activeloop/Auth0 cookies so sign-in survives restarts. This is app-managed browser storage, not an Apiary state file; its lifecycle (clear on logout / on `doctor purge` / on PRD-003 uninstall) is an open question below.

---

## API and configuration changes

- **No new daemon endpoints.** The shell consumes the existing `POST /setup/login` + `GET /setup/state` contract ([`setup-login.ts`](../../../../honeycomb/src/daemon/runtime/dashboard/setup-login.ts)) unchanged.
- **New shell IPC:** a renderer→main channel that hands `verification_uri_complete` to the main process to open the owned auth window, plus a main→renderer signal on window close. Defined in 004a.
- **`BrowserOpener` behavior under the shell:** honeycomb's injectable browser seam ([`deeplake-issuer.ts`](../../../../honeycomb/src/daemon/runtime/auth/deeplake-issuer.ts) `BrowserOpener` / `defaultBrowserOpener`) must, when running under the desktop shell, resolve to the in-app window rather than the OS opener. Whether this is a shell-injected seam, an env-gated branch, or handled purely at the UI layer (dashboard path only) is settled in 004a/004b.
- **Prerequisite (not delivered here):** the desktop shell's window/session capabilities and its daemon-supervision model, from [`PRD-005`](../prd-005-desktop-shell/prd-005-desktop-shell-index.md).

---

## Security considerations

- **The auth window loads untrusted third-party content.** It must run `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, expose no preload bridge, and constrain navigation + new-window handling to an allow-list of Activeloop/Auth0 origins so the window cannot be steered to an arbitrary page or repurposed as a general browser.
- **The token stays out of the window entirely.** The device flow's decoupling is a security asset: consent happens in the window, but the bearer token arrives only via the daemon's background poll and lands in the 0600 credential file. Nothing in the renderer, the main process, or the auth window ever sees or stores the token (D-4 redaction discipline from honeycomb's auth module carries forward).
- **Session partition is sensitive at rest.** The persistent partition holds Activeloop session cookies; scope it to a dedicated partition (never the default), and define its teardown so a logout / uninstall / `doctor purge` does not leave a live session behind.
- **`https`-only verification URI.** The existing scheme validation ([`setup-login.ts`](../../../../honeycomb/src/daemon/runtime/dashboard/setup-login.ts) re-validates `verification_uri_complete` to `https:` before echoing; [`deeplake-issuer.ts`](../../../../honeycomb/src/daemon/runtime/auth/deeplake-issuer.ts) refuses non-`https`) must be preserved: the shell opens the window only for an `https` URI it received from the daemon, never a URL derived from page content.
- **No UA spoofing / policy circumvention.** Defeating an IdP's embedded-webview block by faking the user-agent is explicitly rejected; the degradation path (004b) is the sanctioned answer.

---

## Open questions

- [ ] **Which login methods does Activeloop's Auth0 tenant expose?** (THE gating unknown.) If email/password or passwordless email is available, the in-app experience is complete with no asterisks (AC-7). If the tenant is effectively **Google-only**, the embedded window will be blocked (`disallowed_useragent`) and AC-8's degradation is unavoidable. Confirm with Activeloop before committing 004b's design.
- [ ] **If Google SSO is unavoidable, what is the sanctioned fallback?** The owner's stated constraint is "no external browser." Options: (a) negotiate an email/passwordless path with Activeloop; (b) a co-branded Auth0 tenant that permits an app-hostable method; (c) accept a one-time system-browser bounce *only* for the Google leg (violates the stated wish — requires owner sign-off). Pick one deliberately.
- [ ] **Interception layer.** Handle interception purely at the dashboard UI (which already receives `verification_uri_complete`) for the Hive onboarding path, and separately redirect honeycomb's/nectar's `openBrowser` seam for solo/CLI logins under the shell — or unify both through one shell-level browser-open service? (Bears on AC-9.)
- [ ] **Session partition lifecycle.** Does signing out, `doctor purge` (PRD-003c), or uninstall (PRD-003b) clear the `persist:deeplake-auth` partition? A stale live session after uninstall is a surprise; wiring it into the existing purge allow-list is the clean answer.
- [ ] **Does the same in-app window serve solo honeycomb/nectar logins,** or only Hive's onboarding? PRD-003 defers login to Hive when present; under the shell, Hive is effectively always present, which may make the solo path unreachable and simplify 004a.
- [ ] **ADR?** PRD-001/002/003 each pair with a numbered ADR, and the desktop shell + in-app-auth posture is arguably a decision of similar weight. Should an **ADR-0005** ("Desktop shell renders auth in-app via the decoupled device flow; no identity broker") be authored alongside the shell initiative? (ADR-0004 is already taken by the embedding-engine extraction.)

---

## Related

- [`PRD-003` Fleet Lifecycle, Login Deferral, and One-Command Uninstall](../../completed/prd-003-fleet-lifecycle-login-and-uninstall/prd-003-fleet-lifecycle-login-and-uninstall-index.md) — establishes "login is a Hive concern when Hive is present"; the in-app auth window is the shell's rendering of that same Hive-owned flow, not a new initiator.
- [`hive/src/dashboard/web/onboarding/login-step.tsx`](../../../../hive/src/dashboard/web/onboarding/login-step.tsx) — Hive's onboarding login step: auto-begins the device flow, surfaces the device code, polls `/setup/state`. The component the shell frames.
- [`honeycomb/src/daemon/runtime/dashboard/setup-login.ts`](../../../../honeycomb/src/daemon/runtime/dashboard/setup-login.ts) — `POST /setup/login`: returns `user_code` + verification URIs (never a token), `https`-revalidated. The contract the shell consumes.
- [`honeycomb/src/daemon/runtime/auth/deeplake-issuer.ts`](../../../../honeycomb/src/daemon/runtime/auth/deeplake-issuer.ts) — the real `api.deeplake.ai` device-flow client (Auth0-backed), the `BrowserOpener` seam, and the `/users/me/tokens` mint. Unchanged; only its browser-open target changes under the shell.
- [`honeycomb/src/daemon/runtime/auth/credentials-store.ts`](../../../../honeycomb/src/daemon/runtime/auth/credentials-store.ts) — the 0600 org-bound credential writer; the token still lands here and only here.
- [`hive/src/shared/fleet-readiness.ts`](../../../../hive/src/shared/fleet-readiness.ts) — the degraded-is-up posture that keeps the fleet healthy during the pre-login window.
- [`PRD-005` Apiary Desktop Shell (Electron)](../prd-005-desktop-shell/prd-005-desktop-shell-index.md) — the parent shell initiative; this module is its sign-in surface and assumes its window/session capabilities.
