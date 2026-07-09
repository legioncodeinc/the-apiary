# PRD-007b: Harness Detection and Plugin Refresh

> **Parent:** [PRD-007](./prd-007-fleet-update-script-index.md)
> **Status:** Backlog
> **Priority:** P1
> **Effort:** S (< 1d)
> **Schema changes:** None. Reuses honeycomb's existing harness-detection, connector, and reconcile seams (PRD-006); adds no new honeycomb surface beyond what a `honeycomb setup` / reconcile invocation already exposes.

---

## Overview

Updating the npm packages ([007a](./prd-007a-fleet-update-script-package-updates-and-service-restart.md)) ships a new plugin bundle onto disk, but a coding-assistant harness keeps serving the *old* plugin until the plugin is reinstalled and the harness session is refreshed — the exact invisibility gap PRD-006 documents for install, now recurring on every update. This sub-PRD makes the update script detect which harnesses are installed and, for each one that carries a delivered plugin (Claude Code first), reinstall the newest plugin into its correct location and refresh the harness to pick it up, printing plain-language instructions for the one case an automatic refresh cannot cover.

The heavy lifting already exists in honeycomb: `detectInstalledHarnesses()`, the connector's idempotent `install()` (`marketplace add/update` + `plugin install honeycomb@honeycomb` + `enable`), the `available()` / `isPluginEnabled()` probes, `createAutoWiring().wire()`, and — from PRD-006 — a self-healing reconcile. Re-running `honeycomb setup` by hand already refreshes a stale plugin (confirmed in PRD-006). This sub-PRD's job is to *trigger* that refresh after an update, through the honeycomb CLI, rather than re-implement any of it in shell.

## Goals

- Report which harnesses are installed on the machine (the six: claude-code, codex, cursor, hermes, pi, openclaw).
- For each harness with a delivered plugin, install the newest plugin version into its correct location and refresh the harness so the running/next session serves it.
- When an automatic refresh is impossible (e.g. the harness must be restarted by the user, or its CLI is absent), print one plain-language instruction rather than silently doing nothing.
- Reuse PRD-006's connector + reconcile seams; add no parallel wiring logic.

## Non-Goals

- Reinstalling or changing the plugin's *contents* — PRD-006 / honeycomb PRD-075/076 own the plugin surface; this only ensures the newest shipped plugin is (re)installed and picked up.
- Non-Claude-Code harness feature parity — the acceptance surface here is Claude Code; the shape should generalize to the other connectored harnesses (codex, cursor) as they gain plugins, but they are not gating.
- Duplicating PRD-006b's reconcile loop/cadence — this sub-PRD triggers the reconcile once as part of the update, it does not own the daemon-side loop.

## User stories

### US-7b.1 — See which harnesses are installed

**As an** operator running an update, **I want to** be told which coding assistants the update touched, **so that** I know where the refreshed memory features will show up.

**Acceptance criteria:**
- b-AC-1 Given one or more harnesses are installed, when `update.sh` runs, then it prints each detected harness (via honeycomb's `detectInstalledHarnesses`, invoked through the resolved `honeycomb` bin — not re-implemented in shell), and prints "no coding assistants detected" when none are.

### US-7b.2 — Refresh the Claude Code plugin after an update

**As a** Claude Code user, **I want to** have the updated Honeycomb plugin, skill, commands, and MCP server available after I update, **so that** I actually get the new memory surface instead of the version I installed weeks ago.

**Acceptance criteria:**
- b-AC-2 Given the `honeycomb` package moved and Claude Code is installed with the plugin enabled, when the refresh step runs, then the newest plugin is (re)installed into its location and enabled via the connector/reconcile, idempotently, with no user action, and the step reports "Claude Code plugin refreshed."
- b-AC-3 Given Claude Code is installed but its `claude` CLI is not on PATH (so an automatic refresh cannot complete), when the refresh step runs, then it prints a plain-language instruction (the exact `honeycomb setup` command, and/or "open a new terminal so PATH refreshes, then run `honeycomb setup`") instead of claiming success — and never fails the update.
- b-AC-4 Given the plugin was reinstalled but a *running* Claude Code session cannot hot-reload it, when the step completes, then it prints "restart Claude Code to load the updated plugin" so the user knows the one manual action remaining (parent AC-5's honesty requirement).

### US-7b.3 — Degrade cleanly, never block

**Acceptance criteria:**
- b-AC-5 Given the refresh step cannot complete for any reason (CLI absent, connector error, reconcile unavailable), when it fails, then it degrades to a clear message and the update run still reports its package/service outcome and exits on the package result, never on the harness result.
- b-AC-6 Given no harness is installed, when the refresh step runs, then it is a clean no-op ("no coding assistants to refresh"), not an error.

## Implementation notes

- **Invoke, don't re-implement.** After 007a resolves the `honeycomb` bin, drive the refresh through a honeycomb CLI verb — `honeycomb setup` is the confirmed-working refresh in PRD-006; `honeycomb harness repair`/`honeycomb harness connect` are the narrower wiring seams if preferred. The shell script owns *ordering and reporting*, honeycomb owns the wiring.
- **Detection.** Use the real honeycomb detection surface **`honeycomb harness status`** (add `--json` for robust parsing; verb confirmed on the blessed build, PRD-006c/006d) so the shell never hard-codes `~/.claude` paths; fall back to printing "run `honeycomb harness status` to see which coding assistants are wired" if the surface is unavailable. (Note: an earlier draft named a nonexistent `honeycomb harnesses` verb — `honeycomb harness status` is the correct spelling.)
- **Gate on a real move.** Only run the refresh when the plugin-bearing package (`honeycomb`) actually moved in 007a; a no-op update (parent AC-3) does no plugin work. If the package moved but the plugin was already enabled and unchanged, the connector's idempotency makes this a cheap converge, matching PRD-006 AC-6's steady-state-is-a-no-op property.
- **PRD-006 overlap.** If PRD-006b's daemon-side reconcile is already live, the update's refresh can be as simple as "nudge the reconcile once and report its outcome," avoiding a second wiring path. Record which mechanism is authoritative so the two never double-register.
- **Honesty over optimism.** Mirror the connector's fail-soft posture: never print "connected/refreshed" unless the probe (`isPluginEnabled`) confirms it; otherwise print the exact next command (PRD-006's connectors already model this).

## Open questions

- [ ] **Refresh verb.** Is `honeycomb setup` the right thing for the script to call, or should honeycomb expose a purpose-named `honeycomb reconcile --harness=all` the update script and the desktop shell both use? Proposed: a named reconcile seam, with `honeycomb setup` as the fallback until it exists.
- [ ] **Other harnesses.** Do codex/cursor get the same refresh in this PRD, or claude-code only with the others following the connector-registry shape later? Proposed: claude-code is the gating surface; the loop iterates every connectored harness so codex/cursor come along for free where a connector exists.
- [ ] **Running-session reload.** Can any harness hot-reload a plugin mid-session, or is "restart the assistant" always the residual manual step? Proposed: assume restart-required and always print the one-line instruction when a session may be live (b-AC-4).

## Related

- [`PRD-006`](../../in-work/prd-006-claude-code-plugin-delivery-and-auto-wiring/prd-006-claude-code-plugin-delivery-and-auto-wiring-index.md) — the connector, probes, `auto-wiring.ts`, and reconcile this sub-PRD triggers; especially [`prd-006b`](../../in-work/prd-006-claude-code-plugin-delivery-and-auto-wiring/prd-006b-claude-code-plugin-delivery-and-auto-wiring-self-healing-reconcile.md).
- [`honeycomb/src/daemon/runtime/dashboard/harness-detect.ts`](../../../../honeycomb/src/daemon/runtime/dashboard/harness-detect.ts) — `detectInstalledHarnesses()`.
- [`honeycomb/src/connectors/claude-code.ts`](../../../../honeycomb/src/connectors/claude-code.ts), [`plugin-runner.ts`](../../../../honeycomb/src/connectors/plugin-runner.ts), [`honeycomb/src/notifications/auto-wiring.ts`](../../../../honeycomb/src/notifications/auto-wiring.ts) — the connector, probes, and wire seam.
- [007a](./prd-007a-fleet-update-script-package-updates-and-service-restart.md) — resolves the `honeycomb` bin and signals whether the plugin-bearing package moved.
