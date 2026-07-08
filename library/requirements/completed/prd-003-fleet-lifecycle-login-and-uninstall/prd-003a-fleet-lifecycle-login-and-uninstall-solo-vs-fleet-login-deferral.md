# PRD-003a: Solo-vs-Fleet Login Deferral

> **Parent:** [PRD-003](./prd-003-fleet-lifecycle-login-and-uninstall-index.md)
> **Status:** Completed
> **Priority:** P0
> **Effort:** L (1-3d)
> **Schema changes:** None. No credential format or device-flow protocol change; only who initiates the flow and when.

---

## Overview

Today honeycomb can open its own device-flow browser popup, hive's onboarding runs the same flow through its login step (proxied to honeycomb's `/setup/login` + `/setup/state`), and nectar never initiates login at all - it reads the shared `~/.deeplake/credentials.json` and stays degraded until someone else writes it. On a fleet install that means competing prompts; on a solo nectar install it means a permanent silent dead-end.

This sub-PRD gives honeycomb and nectar a **solo-vs-fleet decision** and makes the outcome deterministic:

- **Fleet mode (hive detected):** the daemon defers ALL login/auth initiation to hive. It reports degraded (storage unreachable) on `/health` until hive-side login writes the shared credentials, and it NEVER opens a browser popup or prompts. The fleet 0.5.1 probe posture (an answering degraded daemon counts as up) already keeps installs and readiness gates from failing during this window.
- **Solo mode (no hive):** on first install, if `~/.deeplake/credentials.json` does not exist, the product opens the device-flow login popup automatically. If credentials exist, nothing opens.
- **Explicit verbs in both modes:** `honeycomb login` and a NEW `nectar login` open the device-flow popup directly, regardless of mode, so a user can always self-serve on demand.

Detection signals to combine (precedence settled here during implementation, flagged below): a hive entry in `~/.apiary/registry.json`, hive answering on `127.0.0.1:3853`, and `@legioncodeinc/hive` present in the npm global tree.

## Goals

- honeycomb and nectar each classify themselves solo or fleet using the three detection signals, with a documented precedence and a defined answer when signals disagree.
- In fleet mode, neither daemon ever opens a browser or prompts; each sits degraded on `/health` until the shared credentials appear, then recovers without restart.
- In solo mode, first install auto-opens the device-flow popup exactly when `~/.deeplake/credentials.json` is absent.
- `nectar login` exists; it and `honeycomb login` open the popup directly in both modes and report success/failure in plain language.
- Headless environments degrade to printing the verification URL and user code instead of failing or hanging on a browser that cannot open.

## Non-Goals

- Changing the device flow, the credential file format, or honeycomb's Deeplake issuer internals.
- Changing hive's onboarding UI or its login-step proxy (retry/restart-login shipped in 0.5.1 and stays as is).
- Team/hybrid deployment modes and tenancy selection (untouched).
- Lifecycle verbs (`start`/`stop`/`uninstall`) - that is [003b](./prd-003b-fleet-lifecycle-login-and-uninstall-lifecycle-command-parity.md).

## Acceptance criteria

| ID | Criterion |
|---|---|
| a-AC-1 | With hive detected, a fresh honeycomb or nectar install completes without opening any browser popup or interactive prompt, and the daemon serves 503 degraded (storage unreachable) on `/health` (parent AC-1). |
| a-AC-2 | In fleet mode, once hive-side login writes `~/.deeplake/credentials.json`, the deferring daemon transitions to healthy on `/health` without a restart or any manual step (parent AC-1). |
| a-AC-3 | With no hive detected and no `~/.deeplake/credentials.json`, first install opens the device-flow popup automatically; with credentials present, no popup opens (parent AC-2). |
| a-AC-4 | `honeycomb login` opens the device-flow popup directly in both solo and fleet mode (parent AC-3). |
| a-AC-5 | `nectar login` exists, opens the device-flow popup directly in both modes, and on success results in credentials nectar can read on its next storage attempt (parent AC-3). |
| a-AC-6 | The solo/fleet classification is deterministic for a given machine state, and its inputs (which signals fired) are visible in the product's logs or status output for supportability. |
| a-AC-7 | When no browser can be opened (headless), the auto-popup path and both `login` verbs print the verification URL and user code and poll to completion instead of hanging or crashing (parent AC-9). |

## Implementation notes

- **Detection signals.** (1) `~/.apiary/registry.json` contains a hive entry; (2) hive answers on `127.0.0.1:3853`; (3) `@legioncodeinc/hive` in the npm global tree. A live answer on 3853 is the strongest "fleet" signal; a registry entry alone may be stale after a manual removal. Proposed rule: any signal present means fleet for popup-suppression purposes (suppressing a popup wrongly is cheap; opening one wrongly is the bug this PRD kills), but record which signals fired.
- **Nectar's login writer.** nectar today only reads credentials ([`nectar/src/hive-graph/deeplake-credentials.ts`](../../../../nectar/src/hive-graph/deeplake-credentials.ts)). `nectar login` should run the same Deeplake device flow honeycomb's issuer runs ([`honeycomb/src/daemon/runtime/auth/deeplake-issuer.ts`](../../../../honeycomb/src/daemon/runtime/auth/deeplake-issuer.ts)) and write the same shared file honeycomb's credential store writes ([`credentials-store.ts`](../../../../honeycomb/src/daemon/runtime/auth/credentials-store.ts)); whether that is a shared library, a copied client, or a proxy through a running honeycomb is an implementation choice, but the on-disk result must be byte-compatible.
- **Degraded posture is already safe.** Fleet 0.5.1 made every install/readiness probe treat an answering degraded daemon as up ([`hive/src/shared/fleet-readiness.ts`](../../../../hive/src/shared/fleet-readiness.ts)); this sub-PRD relies on that and must not reintroduce a gate that fails on 503-degraded.
- **First-install-only auto-popup.** The auto-popup fires from the install path (the `install` CLI verb), not from every daemon boot; a daemon restart with missing credentials sits degraded and logs how to run `login`, it does not pop a browser.

## Open questions

- [ ] **Signal precedence on disagreement** (registry says hive, port silent, npm tree empty): fleet or solo? Proposed: fleet for suppression, plus a log line naming the stale signal; confirm.
- [ ] **Evaluation moment:** classify once at install and persist, or re-evaluate on every daemon start? Live evaluation self-heals after a hive uninstall (a formerly deferring solo daemon can then self-serve); persistence is more predictable. Proposed: live at each start.
- [ ] **`nectar login` mechanism:** run the device flow in-process (new client code in nectar) or proxy through honeycomb's `/setup/login` when honeycomb is present? In-process is required for a nectar-only solo install.

## Related

- [`hive/src/dashboard/web/onboarding/login-step.tsx`](../../../../hive/src/dashboard/web/onboarding/login-step.tsx) - hive's login step, the sole login initiator in fleet mode.
- [`hive/src/shared/fleet-readiness.ts`](../../../../hive/src/shared/fleet-readiness.ts) - the degraded-is-up probe posture this deferral depends on.
- [`honeycomb/src/daemon/runtime/auth/deeplake-issuer.ts`](../../../../honeycomb/src/daemon/runtime/auth/deeplake-issuer.ts) and [`credentials-store.ts`](../../../../honeycomb/src/daemon/runtime/auth/credentials-store.ts) - the device flow and shared-credential writer both `login` verbs front.
- [`nectar/src/hive-graph/deeplake-credentials.ts`](../../../../nectar/src/hive-graph/deeplake-credentials.ts) - nectar's credential reader, gaining a writer sibling.
- [`nectar/src/doctor-registry.ts`](../../../../nectar/src/doctor-registry.ts) and [`nectar/src/apiary-root.ts`](../../../../nectar/src/apiary-root.ts) - where nectar already reads the fleet root and registry (detection inputs).
