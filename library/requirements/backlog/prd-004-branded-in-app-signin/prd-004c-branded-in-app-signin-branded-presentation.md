# PRD-004c: Branded Sign-In Presentation

> **Parent:** [PRD-004](./prd-004-branded-in-app-signin-index.md)
> **Status:** Backlog
> **Priority:** P2 (the experience polish on top of the 004a/004b mechanism; ships after them)
> **Schema changes:** None. Presentation only; reuses the existing setup wire.

---

## Overview

This is the "#1 cosmetic wrap" the product owner chose: everything around the Activeloop Auth0 page is the app's, so the sign-in *feels* like one branded experience even though the credential page inside the window belongs to Activeloop. The reusable material already exists — Hive's login step was reworked once before precisely because "the prior screen surfaced the device code with no context, no sense of what Deeplake is or why it is worth linking, and no honest pricing expectation," and now explains "what Deeplake is, what linking unlocks, and that it is a paid service that is cheap to try" ([`login-step.tsx`](../../../../hive/src/dashboard/web/onboarding/login-step.tsx)). This sub-PRD carries that framing into the desktop shell around the in-app window: a branded pre-login screen, owned window chrome, and honest pending/success/error states — without adding a second login initiator (the wire contract is reused verbatim).

## Goals

- A branded pre-login screen inside the shell explains what Deep Lake is, what linking unlocks, and the honest "paid service, cheap to try" expectation before the auth window opens.
- The auth window carries app-owned chrome (title, framing) so it reads as part of the app, not a stray browser popup.
- Clear pending ("waiting for you to approve…"), success, and error/retry states, driven by the `/setup/state` poll the flow already runs.
- Presentation reuses Hive's existing setup wire and login-step contract; it does not create a parallel login path or a second initiator (consistent with PRD-003 and 004a).
- Degradation messaging (when 004b triggers) is worded honestly and actionably.

## Non-Goals

- The window mechanism/IPC (004a) and the session/IdP-resilience logic (004b); this sub-PRD is presentation over both.
- Theming Activeloop's Auth0 page itself — that is the tenant owner's to configure (parent non-goal); we frame around it, not inside it.
- Any pricing/billing UI beyond honest expectation-setting copy; payment is out of scope for PRD-004.
- New brand assets creation (use the existing Hive/Apiary design-system tokens and marks).

## Acceptance criteria

| ID | Criterion |
|---|---|
| c-AC-1 | Before the auth window opens, the shell shows a branded screen stating what Deep Lake is, what linking unlocks, and that it is a paid service that is inexpensive to try (parity with the intent of [`login-step.tsx`](../../../../hive/src/dashboard/web/onboarding/login-step.tsx)). |
| c-AC-2 | The auth window presents with app-owned chrome (title/framing) rather than a bare, unlabeled popup (parent AC-1 feel). |
| c-AC-3 | The UI shows distinct, honest pending / success / error states derived from the existing `GET /setup/state` poll, including a retry affordance on failure, with no indefinite spinner. |
| c-AC-4 | Presentation reuses Hive's setup wire/login-step contract; no second login initiator or parallel device-flow request is introduced (parent AC-9, PRD-003). |
| c-AC-5 | When 004b's degradation triggers, the message shown is clear, names the actual next step, and contains no token or device-secret material. |
| c-AC-6 | All sign-in surfaces render correctly in the shell's supported light/dark themes using existing design-system tokens. |

## Implementation notes

- **Reuse, don't fork.** Build on the existing `login-step.tsx` structure and its wire client (`createWireClient`, `SetupLoginWire`, `SetupStateWire`) rather than duplicating device-flow request shapes — the prior rework already solved the copy and the poll cadence (`LOGIN_STEP_POLL_MS`).
- **Copy source of truth.** The "what Deeplake is / what linking unlocks / cheap to try" narrative already lives in the login step; lift it, adjust for the desktop framing (the user is in an app window, not a browser tab, so "opens in a browser tab" language must change to reflect the in-app window).
- **Pending state honesty.** The pending copy should reflect that the user approves in the app-owned window that just opened, not "check your browser." This is a small but important wording change from the current browser-tab framing.
- **Error/retry.** Reuse the existing retry/restart-login affordance pattern (Hive's login step already has retry/restart from fleet 0.5.1) so a failed or abandoned attempt is re-tryable in place.
- **Theme tokens.** Use the design-system CSS the dashboard already serves ([`hive/src/daemon/dashboard/web-assets.ts`](../../../../hive/src/daemon/dashboard/web-assets.ts) concatenates the token files); no new palette.

## Open questions

- [ ] **How much of the Auth0 page is visible vs. framed?** Does the app add a header/footer band around the embedded page, or open it clean? A frame reinforces "in-app" but risks looking like a phishing wrapper around a real login — weigh carefully.
- [ ] **Pending copy specifics.** Exact wording for "approve in the window that just opened" — and what it says if the window was closed early.
- [ ] **Degradation wording ownership.** 004b decides *when* degradation fires; does the final user-facing wording live here or with 004b's resolved decision? Proposed: mechanism in 004b, wording here.

## Related

- [`hive/src/dashboard/web/onboarding/login-step.tsx`](../../../../hive/src/dashboard/web/onboarding/login-step.tsx) — the reworked login step whose copy and wire this sub-PRD reuses and reframes for the shell.
- [`hive/src/daemon/dashboard/web-assets.ts`](../../../../hive/src/daemon/dashboard/web-assets.ts) — the design-system token/CSS source the presentation themes against.
- [`prd-004a`](./prd-004a-branded-in-app-signin-in-app-auth-window.md) and [`prd-004b`](./prd-004b-branded-in-app-signin-session-and-idp-resilience.md) — the mechanism and resilience this presentation sits on top of.
