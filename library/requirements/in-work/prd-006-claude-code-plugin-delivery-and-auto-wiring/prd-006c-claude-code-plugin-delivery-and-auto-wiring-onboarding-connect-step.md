# PRD-006c: Hive Onboarding "Connect Your Coding Assistant" Step

> **Parent:** [PRD-006](./prd-006-claude-code-plugin-delivery-and-auto-wiring-index.md)
> **Status:** Backlog
> **Priority:** P1 (guided first-run; the one place a human must act when automation cannot)
> **Effort:** M (1-2d), split across a honeycomb-side seam and a hive-side UI step
> **Schema changes:** None. Adds a honeycomb-side onboarding seam and a hive onboarding step that consumes it.

---

## Overview

The portal install path is the primary onboarding flow, and today it wires nothing: a bare `install.ps1` / `install.sh` invocation routes to the portal ([`install.ps1`](../../../../scripts/install/install.ps1):1187-1192, [`install.sh`](../../../../scripts/install/install.sh):1323-1338), which installs Hive and opens onboarding but never runs `honeycomb install`. Sub-PRD B makes the daemon reconcile the plugin automatically once `claude` is present, but there is one case automation cannot resolve on its own: Claude Code is not installed at all. That requires a human prompt.

This sub-PRD adds an explicit Hive onboarding step, "Connect your coding assistant," that triggers the reconcile (006b) and shows status: "Claude Code connected" on success, or, when the `claude` CLI is absent, "Install Claude Code, then Retry." Hive owns the step UI (it lives in the `hive` submodule); this PRD scopes the honeycomb-side seam the step calls and names the hive-side integration point. It turns the portal path from "wires nothing" into "wires what it can and clearly asks for the one thing it cannot."

## Goals

- A Hive onboarding step that triggers the 006b reconcile and renders its outcome.
- A clear "Claude Code connected" success state when the plugin ends up enabled.
- A plain-language "Install Claude Code, then Retry" state when `claude` is absent, with a Retry that re-runs the reconcile after the user installs the agent.
- A honeycomb-side seam the step calls (run reconcile, return a renderable status), so hive does not reimplement detection or wiring.
- No hang and no dead-end: the step always resolves to a clear state and never blocks onboarding completion.

## Non-Goals

- The reconcile itself (006b) and the ongoing dashboard card (006d).
- Packaging (006a).
- Building or bundling Claude Code; the step guides the user to install it, it does not install the agent for them.
- Changing Hive's tenancy or login steps (owned by [`PRD-003`](../../completed/prd-003-fleet-lifecycle-login-and-uninstall/prd-003-fleet-lifecycle-login-and-uninstall-index.md)).

## Code-grounded current state

| Where | Today | Relevance |
|---|---|---|
| [`scripts/install/install.ps1`](../../../../scripts/install/install.ps1):927,1187-1192 | Bare invocation -> `Invoke-PortalMain`: installs Hive, `hive install-service`, opens onboarding; no `honeycomb install`. | The path that currently wires nothing; this step fills the gap. |
| [`scripts/install/install.sh`](../../../../scripts/install/install.sh):1088,1323-1338 | Bare invocation -> `run_portal_path`: same portal behavior. | Same gap on POSIX. |
| [`honeycomb/src/commands/install.ts`](../../../../honeycomb/src/commands/install.ts):462 | `runInstallSetupStep` runs the connector via the same engine `honeycomb setup` uses. | The step's honeycomb-side seam runs the same reconcile/connector path, exposed for the portal flow. |
| [`honeycomb/src/connectors/plugin-runner.ts`](../../../../honeycomb/src/connectors/plugin-runner.ts):104,111 | `available()` and `isPluginEnabled()`. | The seam returns a status derived from these so the step can render connected vs "install claude" vs "enabled." |
| hive onboarding flow (`hive` submodule, e.g. the onboarding step components under `hive/src/dashboard/web/onboarding/`) | Hive owns the onboarding step sequence (see the login step referenced by [`PRD-003`](../../completed/prd-003-fleet-lifecycle-login-and-uninstall/prd-003-fleet-lifecycle-login-and-uninstall-index.md)). | Where the new "Connect your coding assistant" step is added; exact component path is a hive-side detail confirmed during implementation. |

## Acceptance criteria

| ID | Criterion |
|---|---|
| c-AC-1 | Hive onboarding shows a "Connect your coding assistant" step that, when reached or actioned, triggers the 006b reconcile via a honeycomb-side seam (parent AC-7). |
| c-AC-2 | On success (plugin enabled), the step shows "Claude Code connected" (parent AC-7). |
| c-AC-3 | When `claude` is absent, the step shows "Install Claude Code, then Retry," and Retry re-runs the reconcile so a just-installed agent gets wired without restarting onboarding (parent AC-7). |
| c-AC-4 | The honeycomb-side seam returns a renderable status (connected / agent-absent / cli-absent / error) without hive reimplementing detection or wiring (parent AC-7). |
| c-AC-5 | The step never hangs and never dead-ends onboarding: it resolves to a clear state and either lets onboarding proceed or offers Retry (parent AC-9). |

## Implementation notes

- **Reuse the reconcile, do not duplicate it.** The seam should invoke the same 006b reconcile (same connector composition, same gates), returning its outcome; the step is a thin UI over that outcome.
- **Retry is the human loop.** The only state the automation cannot self-heal is "no agent installed." Retry after the user installs `claude` closes it; the daemon reconcile (006b) would also catch it later, so Retry is a convenience, not the only path.
- **Skippable vs blocking is an open question.** A user without Claude Code should be able to finish onboarding and connect later from the dashboard card (006d); confirm whether the step is skippable.
- **Hive owns the UI, honeycomb owns the seam.** Keep the boundary clean: hive renders and calls; honeycomb detects and wires. The seam surface (an existing loopback endpoint or a small new one) is settled during implementation.

## Open questions

- [ ] Is the step skippable (proceed, connect later via 006d) or does it block onboarding completion?
- [ ] Exact honeycomb-side seam: reuse an existing setup/health endpoint or add a small onboarding-scoped one that returns the renderable status?
- [ ] Where the step sits in Hive's onboarding sequence relative to login and tenancy.
- [ ] Copy for the absent-agent state, including a link to Claude Code install docs.

## Related

- [PRD-006 index](./prd-006-claude-code-plugin-delivery-and-auto-wiring-index.md)
- [PRD-006b](./prd-006b-claude-code-plugin-delivery-and-auto-wiring-self-healing-reconcile.md) - the reconcile this step triggers.
- [PRD-006d](./prd-006d-claude-code-plugin-delivery-and-auto-wiring-harness-status-card.md) - the dashboard card that handles connect-later.
- the-apiary [`PRD-003`](../../completed/prd-003-fleet-lifecycle-login-and-uninstall/prd-003-fleet-lifecycle-login-and-uninstall-index.md) - the portal path and Hive onboarding ownership this step joins.
