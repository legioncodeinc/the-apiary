# PRD-006b: Self-Healing Harness Auto-Wire Reconcile

> **Parent:** [PRD-006](./prd-006-claude-code-plugin-delivery-and-auto-wiring-index.md)
> **Status:** Backlog
> **Priority:** P0 (the primary automatic backstop that makes the plugin appear on both install paths)
> **Effort:** M (1-2d)
> **Schema changes:** None to any Deeplake catalog. Adds a daemon-side reconcile loop and any daemon-local cadence bookkeeping.

---

## Overview

The connector is correct but nothing runs it reliably. `honeycomb install` runs it once, best-effort, at the end of install ([`runInstallSetupStep`](../../../../honeycomb/src/commands/install.ts):462, called at :541), which is the moment the `claude` CLI is least likely to be on PATH, and the portal install path never runs `honeycomb install` at all ([`scripts/install/install.ps1`](../../../../scripts/install/install.ps1):1187-1192 and [`scripts/install/install.sh`](../../../../scripts/install/install.sh):1323-1338 route bare invocations to the portal). When `claude` is absent at install time the connector fail-softs and registers no marketplace plugin ([`claude-code.ts`](../../../../honeycomb/src/connectors/claude-code.ts):203-211).

This sub-PRD adds an idempotent reconcile that runs on daemon start and on a periodic or idle cadence. For each supported harness whose agent is present but whose plugin is not yet enabled, it runs the connector `install()` idempotently. It reuses the pieces that already exist: `detectInstalledHarnesses` for agent presence, `isPluginEnabled` for the plugin-enabled check, and `createAutoWiring` (the PRD-020d health-driven auto-wire) to delegate to the connector. Gated on `claude` being available and the plugin not already enabled, steady state is a cheap no-op with no repeated `claude plugin install`. This closes the ordering race (Claude Code installed after Honeycomb becomes wired at the next reconcile) and covers both install paths with zero user action, making it the primary backstop behind sub-PRD A's packaging fix.

## Goals

- A reconcile that, on daemon start and on a recurring cadence, wires any supported harness whose agent is present but whose plugin is not enabled.
- Reuse, not fork: `detectInstalledHarnesses` ([`harness-detect.ts`](../../../../honeycomb/src/daemon/runtime/dashboard/harness-detect.ts):131), `isPluginEnabled` ([`plugin-runner.ts`](../../../../honeycomb/src/connectors/plugin-runner.ts):111), `createAutoWiring` ([`auto-wiring.ts`](../../../../honeycomb/src/notifications/auto-wiring.ts):38), and the real connector composition (`buildConnectorRunner` / `createConnectorRegistry`, [`connector-runner.ts`](../../../../honeycomb/src/cli/connector-runner.ts):57,91).
- Gate on `available() === true` and `isPluginEnabled('honeycomb') === false` so steady state is a no-op and a persistently absent `claude` never spins.
- Cover both install paths (portal and `--products`) and the out-of-order install case with no user action.
- Fail-soft: a reconcile that cannot complete degrades to a status the dashboard (006d) shows; it never fails or blocks the daemon.

## Non-Goals

- The onboarding step (006c) and the dashboard card (006d), which consume this reconcile's outcome.
- Shipping the plugin components (006a); the reconcile assumes the package is complete.
- Changing the connector's registration steps ([`claude-code.ts`](../../../../honeycomb/src/connectors/claude-code.ts):151-155); this only decides when to call it.

## Code-grounded current state

| Where | Today | Use in the reconcile |
|---|---|---|
| [`harness-detect.ts`](../../../../honeycomb/src/daemon/runtime/dashboard/harness-detect.ts):69-72,131 | `detectInstalledHarnesses()` reports claude-code present when `~/.claude/settings.json` OR `~/.claude/plugins/honeycomb` exists. | Agent-present signal (the "should we consider wiring?" gate). |
| [`plugin-runner.ts`](../../../../honeycomb/src/connectors/plugin-runner.ts):104,111 | `available()` probes `claude --version`; `isPluginEnabled(name)` parses `claude plugin list`. | The two gates: run only when `claude` is available and the plugin is not enabled. |
| [`auto-wiring.ts`](../../../../honeycomb/src/notifications/auto-wiring.ts):38-48 | `createAutoWiring({ connector }).wire()` delegates to `connector.install()` (idempotent, returns `wroteConfig`). | The delegation seam the reconcile calls; no forked merge logic. |
| [`connector-runner.ts`](../../../../honeycomb/src/cli/connector-runner.ts):57-70,91 | Builds the real `ClaudeCodeConnector` with `createClaudePluginRunner()` + `packageRoot()`. | The connector composition the reconcile reuses (the daemon needs the same real connector + `claude` runner). |
| [`install.ts`](../../../../honeycomb/src/commands/install.ts):462,541 | One-shot best-effort wire at end of install. | Stays; the reconcile is the durable complement, not a replacement. |
| [`claude-code.ts`](../../../../honeycomb/src/connectors/claude-code.ts):203-211 | Fail-soft when `claude` absent: settings.json fallback, no plugin registered. | The exact state the reconcile heals once `claude` later appears. |

## Acceptance criteria

| ID | Criterion |
|---|---|
| b-AC-1 | On daemon start, if `claude` is available and the `honeycomb` plugin is not enabled while the claude-code agent is present, the reconcile runs the connector `install()` and the plugin becomes enabled (parent AC-4). |
| b-AC-2 | The reconcile also runs on a recurring cadence (periodic or idle), so a Claude Code installed after Honeycomb is wired at the next cycle with no user action (parent AC-5). |
| b-AC-3 | When the plugin is already enabled, the reconcile does not invoke `claude plugin install` or any registration command; it is a cheap no-op (parent AC-6). |
| b-AC-4 | When `claude` is not available, the reconcile performs no registration and does not spin or error; it records an "agent/CLI absent" status for 006d/006c to surface (parent AC-6, AC-9). |
| b-AC-5 | The reconcile reuses `detectInstalledHarnesses`, `isPluginEnabled`, and `createAutoWiring` over the real connector composition; it does not fork the connector or its merge logic. |
| b-AC-6 | A reconcile that throws or times out is absorbed to a fail-soft status and never fails or blocks the daemon (parent AC-9). |
| b-AC-7 | The reconcile exposes its last outcome (wired / already-enabled / agent-absent / cli-absent / error) for the onboarding step (006c) and dashboard card (006d) to read. |

## Implementation notes

- **Host: lean daemon (pending the parent open question).** `auto-wiring.ts` is already the daemon's health-driven auto-wire seam, and the daemon already runs `detectInstalledHarnesses`. The counter-argument (keeping the external `claude plugin` side effect out of the loopback daemon) is why Doctor is the alternative; record the decision before building.
- **Gate order is the cheap path.** Check `isPluginEnabled('honeycomb')` first (a single `claude plugin list` parse) and short-circuit; only when not enabled and `available()` is true do the `install()` steps run. This keeps steady state to one cheap probe per cycle.
- **Idempotent by construction.** The connector's `install()` steps are each CLI no-ops when already done ([`claude-code.ts`](../../../../honeycomb/src/connectors/claude-code.ts):149-155), and `createAutoWiring.wire()` returns `wroteConfig=false` on the no-op; the reconcile relies on that rather than adding its own change-detection.
- **Generalize carefully.** The connector registry builds claude-code, codex, and cursor ([`connector-runner.ts`](../../../../honeycomb/src/cli/connector-runner.ts):62-73), but only claude-code uses the `claude plugin` runner today. Scope the first cut to claude-code and shape the loop so codex/cursor slot in without a rewrite.
- **Fail-soft everywhere.** Any probe or `install()` failure becomes a recorded status, never a daemon error, matching the connector's own fail-soft posture and the install path's best-effort contract.

## Open questions

- [ ] Daemon vs Doctor host (see parent). If daemon, confirm the reconcile lives outside the request path so a slow `claude plugin` call never affects loopback latency.
- [ ] Cadence shape: start-only, fixed interval, idle-triggered, or a combination, and the backoff when `claude` is absent.
- [ ] Where the last-outcome status lives (daemon memory vs a small status file vs the existing harness API response) and whether 006d reads it live or from a cache.
- [ ] Do we reconcile codex/cursor in the same pass now, or land claude-code first?

## Related

- [PRD-006 index](./prd-006-claude-code-plugin-delivery-and-auto-wiring-index.md)
- [PRD-006a](./prd-006a-claude-code-plugin-delivery-and-auto-wiring-packaging-completeness.md) - the packaging fix this reconcile assumes is in place.
- honeycomb [`PRD-020d` Notifications and Health](../../../../honeycomb/library/requirements/completed/prd-020-surfaces/prd-020d-surfaces-notifications-health.md) - the auto-wiring engine reused here.
- honeycomb [`PRD-039a` Harnesses Page Registry and Telemetry](../../../../honeycomb/library/requirements/completed/prd-039-harnesses-page/prd-039a-harnesses-page-registry-telemetry.md) - `harness-detect.ts` (detection) this reconcile consumes.
- honeycomb [`PRD-019a` Connector Base](../../../../honeycomb/library/requirements/completed/prd-019-harness-integrations/prd-019a-harness-integrations-connector-base.md) - the connector the reconcile drives.
