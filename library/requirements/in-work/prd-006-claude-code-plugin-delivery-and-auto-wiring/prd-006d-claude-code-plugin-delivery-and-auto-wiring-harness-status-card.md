# PRD-006d: Hive Dashboard Harness-Status Card

> **Parent:** [PRD-006](./prd-006-claude-code-plugin-delivery-and-auto-wiring-index.md)
> **Status:** Backlog
> **Priority:** P1 (ongoing status and the manual repair fallback)
> **Effort:** M (1-2d), split across the honeycomb harness API and the hive-side card
> **Schema changes:** None. Adds one derived per-harness field to the harness API and a repair action.

---

## Overview

Once the plugin can ship (006a) and the daemon reconciles it (006b), users need to see the state and repair it by hand when needed. Today the harness surface reports only whether a harness is "installed" (agent present): `mountHarnessApi` serves `GET /api/diagnostics/harnesses` with an `installed` flag ([`harness-api.ts`](../../../../honeycomb/src/daemon/runtime/dashboard/harness-api.ts):296), and `detectInstalledHarnesses` computes that flag from agent-presence markers ([`harness-detect.ts`](../../../../honeycomb/src/daemon/runtime/dashboard/harness-detect.ts):69-72,131). It does not distinguish "agent present" from "plugin enabled," and there is no repair affordance.

This sub-PRD extends that surface with per-harness connection state (agent present? plugin enabled?) and a "Reconnect / Repair" button that re-runs setup. This is where sub-PRD B reports its outcome and where the manual fallback lives, so a user who sees "agent present, plugin not enabled" can fix it in one click, and a user on a machine the reconcile has not yet reached can repair immediately.

## Goals

- Add a derived plugin-enabled state per harness to the harness API, beside the existing agent-present `installed` flag.
- A Hive dashboard card that shows, per harness: agent present? plugin enabled? and the last reconcile outcome from 006b.
- A "Reconnect / Repair" action that re-runs the connector setup and updates the shown state.
- Read-only and derived: the plugin-enabled state comes from `isPluginEnabled`, not stored Deeplake state.

## Non-Goals

- The reconcile (006b) and the onboarding step (006c); this card surfaces and manually triggers them.
- Packaging (006a).
- A general harness-management redesign; this extends the existing PRD-039a surface, it does not replace it.

## Code-grounded current state

| Where | Today | Change |
|---|---|---|
| [`harness-api.ts`](../../../../honeycomb/src/daemon/runtime/dashboard/harness-api.ts):296 | `mountHarnessApi` serves `GET /api/diagnostics/harnesses`; per harness reports `installed` (agent present). | Add a derived plugin-enabled field (and optionally the last reconcile outcome) per harness. |
| [`harness-detect.ts`](../../../../honeycomb/src/daemon/runtime/dashboard/harness-detect.ts):69-72,131 | `detectInstalledHarnesses()` computes agent presence from `~/.claude/settings.json` OR `~/.claude/plugins/honeycomb`. | Stays as the agent-present source; the new field composes it with `isPluginEnabled`. |
| [`plugin-runner.ts`](../../../../honeycomb/src/connectors/plugin-runner.ts):111 | `isPluginEnabled('honeycomb')` parses `claude plugin list`. | The source of the plugin-enabled field (fail-soft false when `claude` absent). |
| [`auto-wiring.ts`](../../../../honeycomb/src/notifications/auto-wiring.ts):38 / [`connector-runner.ts`](../../../../honeycomb/src/cli/connector-runner.ts):91 | `createAutoWiring` / `buildConnectorRunner` drive the connector. | The "Reconnect / Repair" action re-runs setup through the same path (same as 006b). |
| hive dashboard harness page (`hive` submodule; the 039a-derived harness surface) | Renders the harness list from the harness API. | Gains the connection-state columns and the repair button. |

## Acceptance criteria

| ID | Criterion |
|---|---|
| d-AC-1 | `GET /api/diagnostics/harnesses` returns, per harness, both agent-present and plugin-enabled state (parent AC-8). |
| d-AC-2 | The Hive dashboard shows per-harness connection state (agent present? plugin enabled?) and the last reconcile outcome from 006b (parent AC-8). |
| d-AC-3 | A "Reconnect / Repair" action re-runs the connector setup and the shown state updates to reflect the result (parent AC-8). |
| d-AC-4 | The plugin-enabled state is derived from `isPluginEnabled` (fail-soft false when `claude` is absent), not stored Deeplake state; no secret or path rides the response (parent AC-8). |
| d-AC-5 | A repair that cannot complete shows a clear message and never fails or blocks the daemon or the dashboard (parent AC-9). |

## Implementation notes

- **Extend, do not replace, the 039a surface.** Add the derived field to the existing `mountHarnessApi` response so the card is an incremental change to the harnesses page, keeping the "no secret surfaces" property of `harness-detect.ts` (path-existence and enabled-boolean only).
- **Repair == reconcile-on-demand.** The button calls the same connector composition as 006b so there is one wiring path; the card is the manual trigger, the reconcile is the automatic one.
- **Derived, cheap, fail-soft.** `isPluginEnabled` is one `claude plugin list` parse; compute it on request (or from 006b's cached last outcome) and degrade to "unknown/absent" when `claude` is missing rather than erroring.
- **Cross-harness ready.** Show the state for each connectored harness; claude-code is the first with a plugin-enabled signal, others follow as 006b generalizes.

## Open questions

- [ ] Does the card read plugin-enabled live per request, or from 006b's cached last outcome, to avoid spawning `claude plugin list` on every dashboard poll?
- [ ] Does "Reconnect / Repair" also offer "Disconnect" (uninstall), or is removal out of scope here?
- [ ] Exact hive-side card placement within the existing harnesses page.

## Related

- [PRD-006 index](./prd-006-claude-code-plugin-delivery-and-auto-wiring-index.md)
- [PRD-006b](./prd-006b-claude-code-plugin-delivery-and-auto-wiring-self-healing-reconcile.md) - the reconcile whose outcome this card reports and manually triggers.
- honeycomb [`PRD-039a` Harnesses Page Registry and Telemetry](../../../../honeycomb/library/requirements/completed/prd-039-harnesses-page/prd-039a-harnesses-page-registry-telemetry.md) - the harness API and page this card extends.
- honeycomb [`PRD-020d` Notifications and Health](../../../../honeycomb/library/requirements/completed/prd-020-surfaces/prd-020d-surfaces-notifications-health.md) - the auto-wiring the repair action reuses.
