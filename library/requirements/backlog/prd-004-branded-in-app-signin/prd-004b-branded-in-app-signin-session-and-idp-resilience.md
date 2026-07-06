# PRD-004b: Session Persistence and IdP-Method Resilience

> **Parent:** [PRD-004](./prd-004-branded-in-app-signin-index.md)
> **Status:** Backlog
> **Priority:** P1
> **Effort:** S-M (0.5-2d for code; the design is gated on an Activeloop answer, not on build effort).
> **Schema changes:** None. Adds one app-managed Electron session partition; no Apiary state-file change.

---

## Overview

004a puts the Auth0 page in an owned window. Two things decide whether that window is a good experience or a trap: **does the user stay signed in**, and **can the embedded window actually host the login method the tenant offers.**

Session persistence is the easy half. An Electron `BrowserWindow` on a persistent partition (e.g. `persist:deeplake-auth`) keeps Activeloop's session cookies, so a returning user is not walked through Auth0 again every launch. The Deep Lake org-bound token in `~/.deeplake/credentials.json` is long-lived and independent of this — the partition only affects the *approval* experience if the user ever needs to re-link.

IdP-method resilience is the load-bearing half, and it is where the honest risk lives. The device flow returns a short-lived **Auth0** token ([`deeplake-issuer.ts`](../../../../honeycomb/src/daemon/runtime/auth/deeplake-issuer.ts)), so the page inside the window is Auth0 Universal Login. Auth0 email/password and passwordless email render fine in an app-owned `BrowserWindow`. **Google SSO is blocked** by Google inside embedded/app contexts (`disallowed_useragent`); GitHub usually tolerates it but is not guaranteed. So the whole "no external browser, no asterisks" promise depends on which methods Activeloop's tenant exposes — a fact this repo cannot set and must confirm. This sub-PRD specifies the persistence, the detection of a window-hostile method, and the **deliberate** degradation posture for the Google-only case, so the shell never renders a blank or hung page.

## Goals

- A returning, previously-linked user is not forced through the full Auth0 login on next launch: a dedicated persistent partition preserves the session; a signed-out/expired session re-prompts cleanly.
- The session partition is dedicated (never the default partition) and its teardown is defined for logout / uninstall / `doctor purge`.
- The shell detects when the loaded flow has navigated to a method the embedded window cannot host (e.g. an `accounts.google.com` navigation that will be refused) and reacts per a documented policy rather than showing a broken page.
- The degradation posture for a Google-only tenant is an explicit, owner-approved decision (not an accidental behavior), and whatever it is, it is honest and actionable.
- UA spoofing to bypass IdP webview policy is not used.

## Non-Goals

- The window-open mechanism and IPC — that is [004a](./prd-004a-branded-in-app-signin-in-app-auth-window.md).
- The branded copy and screens (including how a degradation message is worded) — that is [004c](./prd-004c-branded-in-app-signin-branded-presentation.md); this sub-PRD defines *when* degradation triggers and *what* the sanctioned paths are, not the final wording.
- Negotiating the Activeloop tenant configuration itself (a business action; this PRD flags it and designs around each answer).
- Any Resource-Owner Password Grant path (rejected in the parent).

## Acceptance criteria

| ID | Criterion |
|---|---|
| b-AC-1 | The auth window uses a dedicated persistent session partition; a user who completed sign-in once and relaunches the app is not re-walked through Auth0 unless the session is signed out or expired (parent AC-5). |
| b-AC-2 | The persistent partition is never the default session, and clearing it is wired into logout, uninstall (PRD-003b), and `doctor purge` (PRD-003c) so no live Activeloop session survives removal (parent security). |
| b-AC-3 | For a tenant offering email/password or passwordless email, a first-time user completes sign-in fully inside the app with no external browser (parent AC-7). |
| b-AC-4 | The shell detects a navigation to a known embedded-webview-hostile IdP (e.g. `accounts.google.com`) before the user hits a dead page, and triggers the sanctioned degradation instead of showing the raw refusal (parent AC-8). |
| b-AC-5 | The degradation path presents a clear, actionable state (never a blank/hung window) and follows the owner-approved policy recorded in this sub-PRD's resolved open question. |
| b-AC-6 | No user-agent spoofing or other IdP-policy circumvention is present in the auth window (parent security / non-goal). |

## Implementation notes

- **Partition.** Create the auth `BrowserWindow` with `partition: "persist:deeplake-auth"`. This is app-scoped browser storage; it is orthogonal to the org-bound token file. Do not co-mingle with the dashboard window's session.
- **Hostile-IdP detection.** Listen on the window's `will-navigate` / `did-start-navigation` and inspect the target host. A navigation to `accounts.google.com` (or other known-hostile IdP hosts) is the trigger — Google returns `disallowed_useragent` (HTTP 403 with that error) for OAuth in embedded contexts. Detect on navigation rather than waiting for the error page.
- **Degradation options (pick one, owner-approved).** (a) **Preferred:** an email/passwordless path exists on the tenant — steer the user to it and never hit Google. (b) A co-branded Auth0 tenant / config change from Activeloop that permits an app-hostable method. (c) **Last resort, requires explicit owner sign-off because it violates the stated "no external browser" wish:** hand *only the Google leg* to the system browser via `shell.openExternal`, while the device flow continues to complete in-app (the decoupling makes this safe — the token still lands via the daemon poll). Because option (c) contradicts the owner's constraint, it must not be implemented without a recorded decision.
- **Why the decoupling helps even in the worst case.** Since completion is observed via `/setup/state` and the token arrives via the daemon's background poll, even a system-browser fallback for one leg does not require callback capture in the shell — the user approves wherever they can, and the app notices. This keeps option (c) low-risk *if* it is ever sanctioned.
- **Session teardown.** On explicit sign-out, call `session.fromPartition("persist:deeplake-auth").clearStorageData()`. Register the same teardown in the PRD-003 uninstall/purge allow-list so removal is complete.

## Open questions

- [ ] **Activeloop tenant methods (blocking).** Which login methods does the Auth0 tenant expose — email/password, passwordless email, Google, GitHub? This single answer determines whether 004 ships with zero asterisks or must invoke degradation. Owner/Activeloop to confirm.
- [ ] **Sanctioned degradation for Google-only (blocking if the above is Google-only).** Which of options (a)/(b)/(c) is approved? (c) needs explicit owner sign-off since it re-introduces an external browser for one leg.
- [ ] **Session expiry UX.** When the persisted session expires, does the app silently reopen the auth window on next Deep Lake action, or surface a "re-link" prompt first? Silent re-open is smoother but can surprise.
- [ ] **Hostile-host list maintenance.** The set of embedded-webview-hostile IdP hosts (Google today) may change; where is that list kept and how is it updated without a shell release?

## Related

- [`honeycomb/src/daemon/runtime/auth/deeplake-issuer.ts`](../../../../honeycomb/src/daemon/runtime/auth/deeplake-issuer.ts) — establishes the Auth0-backed device flow whose Universal Login page renders in the window.
- [`PRD-003c` Doctor Purge](../../completed/prd-003-fleet-lifecycle-login-and-uninstall/prd-003c-fleet-lifecycle-login-and-uninstall-doctor-purge.md) and [`PRD-003b` Lifecycle Command Parity](../../completed/prd-003-fleet-lifecycle-login-and-uninstall/prd-003b-fleet-lifecycle-login-and-uninstall-lifecycle-command-parity.md) — the uninstall/purge allow-lists the partition teardown joins.
- [`prd-004a`](./prd-004a-branded-in-app-signin-in-app-auth-window.md) — the window this sub-PRD configures and hardens.
