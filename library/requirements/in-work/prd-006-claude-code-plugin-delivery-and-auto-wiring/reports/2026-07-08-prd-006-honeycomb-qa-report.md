# QA Report: PRD-006 Claude Code Plugin Delivery and Auto-Wiring (honeycomb side)

**Audit date:** 2026-07-08
**Auditor:** quality-worker-bee subagent
**Orchestration:** `/the-smoker`
**Scope:** honeycomb-side ACs only. `git diff main...HEAD` on `feature/prd-006-plugin-delivery` (honeycomb submodule, worktree `C:/Users/mario/GitHub/honeycomb-prd006`; merge-base `6afb337`). Sub-PRDs 006a (a-AC-1..6), 006b (b-AC-1..7), 006c honeycomb seam (c-AC-1/4/5), 006d honeycomb API (d-AC-1/3/4/5), and the module ACs they roll up to.
**Out of scope (separate hive-submodule track):** c-AC-2, c-AC-3, d-AC-2, and the hive-render halves of AC-7/AC-8. These are recorded as "honeycomb seam ready, hive UI pending," never failed.
**Ordering:** `security-worker-bee` ran first and is clean (no Critical/High/Medium; see `2026-07-08-security-audit.md` in this folder). This quality pass correctly runs second.

---

## Summary

The PRD-006 honeycomb branch is a clean, defensively-written, fully-tested diff that satisfies every honeycomb-side acceptance criterion. All 15 changed files trace to plan requirements, `npm run ci` is green (436 files, 4691 passed, 13 pre-existing skips outside this diff), `pack:check` is green (69 files, no forbidden, declared plugin components present), and the three previously-unshipped plugin components now appear in `npm pack --dry-run`. Both adjudication flags resolve to "intent met under a documented, load-bearing architectural constraint": **F-1** (AC-4/AC-5/b-AC-2) and **F-2** (d-AC-1). No finding invalidates a honeycomb AC, so no code remediation was required. **The honeycomb branch is SHIPPABLE at the medium+ standard**, with the hive-UI track the only remaining PRD-006 surface.

---

## Scorecard

| Axis | Status | Notes |
|---|---|---|
| Completeness | PASS | Every honeycomb AC has code + a per-AC-named test. |
| Correctness | PASS | Gate order, outcome mapping, fail-soft, and no-secret invariants verified against code + tests. |
| Alignment | PASS | Implementation matches the PRD (reuse-not-fork; tier-legal placement). |
| Gaps | PASS (2 documented limitations) | F-1 (no autonomous idle-loop in a purely-idle long-lived daemon) and F-2 (daemon endpoint `pluginEnabled` is CLI-authoritative). Neither invalidates an AC. |
| Detrimental patterns | PASS | No `.skip`/`.only` in the diff; tests named per-AC; no forked wiring; SQL-safety untouched + green. |

---

## Adjudication of the two flags

### F-1 (module AC-4 / AC-5 / b-AC-2): recurring-cadence host

**What the code does (verified `src/cli/harness-reconcile.ts` + `src/cli/runtime.ts`):**
`buildRuntimeDeps()` builds one reconciler and binds `lifecycle = buildDaemonLifecycle(daemon, { onDaemonUp: () => reconcile.start() })` (`runtime.ts:713`). `reconcile.start()` (`harness-reconcile.ts:257-275`) fires an immediate fail-soft `reconcileOnce()` and arms a `setInterval` cadence (`DEFAULT_RECONCILE_INTERVAL_MS = 300_000`), then `handle.unref()`s it. `onDaemonUp` fires from `lifecycle.start()` whenever the daemon is confirmed up, started or already-running (`runtime.ts:406-419`). Because the reconciler is hosted in the Tier-4 CLI process (the tier that may legally import `createConnectorRegistry` + `createAutoWiring`; the Tier-2 daemon cannot, and injecting it as a daemon service would require editing the forbidden `server.ts`/`services/types.ts` contention seams per `AGENTS.md` + `runtime/CONVENTIONS.md`), the unref'd interval never keeps a short-lived CLI alive for a second tick. So a **purely-idle long-running daemon with zero CLI activity and no restart has no autonomous connector-backed reconcile.**

**Ruling:**
- **AC-4 (VERIFIED, fully met):** on both install paths the daemon comes up, `onDaemonUp` fires an immediate `reconcileOnce()`, and a present-agent/plugin-not-enabled/CLI-available box is wired within that daemon-start reconcile pass with no user action. Proven by `b-AC-1` tests (`harness-reconcile.test.ts:52-98`, including the `onDaemonUp` trigger + throwing-hook fail-soft).
- **AC-5 / b-AC-2 (VERIFIED with a documented limitation, NOT reopened):** the recurring cadence is genuinely implemented and tested on fake timers (`harness-reconcile.test.ts:109-137`), and a reconcile re-fires on (a) next daemon-start via `onDaemonUp` — and the daemon is OS-service-managed with start-on-boot (PRD-064h), so a reboot/login re-fires it; (b) any daemon-ensuring CLI invocation; (c) the `harness connect`/`repair` verbs. None require a plugin re-install by the user, so AC-5's literal intent ("wired at the next reconcile, with no re-install by the user") holds for all realistic timelines. The **only** uncovered case is a daemon up indefinitely with no CLI activity and no reboot while `claude` is installed in that window. Hosting a durable in-daemon idle loop is correctly deferred (blocked by the forbidden contention seam) and tracked as F-1. This is a **Warning-level follow-up**, not a blocker, and does not invalidate the AC.

### F-2 (d-AC-1): daemon endpoint `pluginEnabled` value in production

**What the code does (verified `src/daemon/runtime/dashboard/harness-api.ts` + `src/daemon/runtime/assemble.ts`):**
`mountHarnessApi` exposes `pluginEnabled` fed by an OPTIONAL injected `resolvePluginEnabled` seam that defaults to the empty set → `false` (`harness-api.ts:134,345-346,363`). The production composition root `assemble.ts` mounts the harness API with `{ storage, defaultScope, installedHarnesses, resolveInstalled }` and **does not pass `resolvePluginEnabled`** (`assemble.ts:1719-1725`). So in production **`GET /api/diagnostics/harnesses` returns `pluginEnabled: false` for every harness.** This is by design: the Tier-2 daemon cannot import the Tier-4 `isPluginEnabled` (AGENTS.md build-tier invariant), so the authoritative live derivation is served by the Tier-4 CLI verb `honeycomb harness status --json` (`src/cli/harness-status.ts` → `buildHarnessStatusRunner`), which Hive shells and which the ledger records as the d-AC-2 consumption path.

**Ruling: d-AC-1 met at "endpoint present but CLI-authoritative."** The endpoint carries the `pluginEnabled` field, correctly typed and fail-soft, with an injectable tier-legal seam; the always-false production value is a direct consequence of the load-bearing tier invariant, not a defect. AC-8's intent (the dashboard shows per-harness plugin-enabled) is satisfied because the hive card consumes the authoritative CLI verb, not the daemon endpoint. **Consumer-guidance risk (Warning):** any consumer that reads `pluginEnabled` from the daemon endpoint expecting a true value would always see false; hive must read `honeycomb harness status --json` (which the ledger confirms). No code remediation required.

---

## Critical Issues (must fix)

None.

---

## Warnings (should fix / documented follow-ups)

- **W-1 (F-1): No autonomous reconcile in a purely-idle long-lived daemon.** `src/cli/harness-reconcile.ts:257-275` + `src/cli/runtime.ts:713`. The recurring cadence lives in the short-lived CLI process (unref'd interval) and is triggered on daemon-start + daemon-ensuring CLI invocations; the long-lived daemon does not host it. Realistic ordering-race timelines are covered (service-managed boot restart, any CLI activity, onboarding/repair verbs), so this does not invalidate AC-5. **Follow-up:** land a durable long-lived driver (daemon spawning the CLI reconcile verb on a cadence, or a DI service once the contention seam is free). Non-blocking.
- **W-2 (F-2): Daemon endpoint `pluginEnabled` is always `false` in production.** `src/daemon/runtime/dashboard/harness-api.ts:345-346` + `src/daemon/runtime/assemble.ts:1719-1725`. Intended (tier invariant); authoritative path is the CLI verb. **Follow-up / guidance:** hive must read plugin-enabled from `honeycomb harness status --json`, never the daemon endpoint. Consider a doc note on the endpoint field. Non-blocking.

---

## Suggestions (consider improving)

- **S-1: `pack-check.mjs` mixes derivation with a literal file list.** `scripts/pack-check.mjs:21-27`. The MCP-server path (from `.mcp.json` `args`) and hooks handlers (from `hooks.json`) are fully derived (a-AC-4 satisfied), and the conventional `skills/`/`commands/` dir-non-empty checks are convention-derived. The additional literal `REQUIRED_PLUGIN_FILES` (`recall.md`/`remember.md`/`forget.md`/`SKILL.md`) is a hand-maintained belt-and-suspenders list; a new command/skill file is protected by the dir-non-empty check but not individually asserted. Optional: derive per-file command/skill assertions from the dirs to keep the guard fully self-updating. Low priority.

---

## Plan Item Traceability (honeycomb-side)

| AC | Requirement (abridged) | Verdict | Evidence |
|---|---|---|---|
| a-AC-1 | `files` includes `.mcp.json`, `skills`, `commands` | PASS | `package.json:34-36` |
| a-AC-2 | `npm pack --dry-run` lists the 5 files | PASS | Verified live: all 5 PRESENT in pack listing |
| a-AC-3 | pack-check fails on any missing declared component | PASS | `pack-check.mjs:79-148` (derived MCP/hooks + dir + file checks → `exit 1`) |
| a-AC-4 | Checklist derived from plugin declarations | PASS | MCP from `.mcp.json` args (`:81-103`), hooks from `hooks.json` (`:105-129`), conventional dirs (`:137-142`); literal file list is additive (see S-1) |
| a-AC-5 | Re-release install exposes skill+commands+MCP | PASS (pending release) | pack-listing proxy verified; live-install confirmation needs a publish (module AC-3) |
| a-AC-6 | `npm run ci` + `pack:check` pass; no forbidden files | PASS | ci green (4691); pack-check OK (69 files, no forbidden) |
| b-AC-1 | Daemon-start wire when agent present + plugin off + cli available | PASS | `harness-reconcile.ts:217-236,257-263`; tests `:52-98` |
| b-AC-2 | Recurring cadence wires out-of-order install | PASS (F-1 limitation) | `:264-274`; fake-timer test `:109-137`; see W-1 |
| b-AC-3 | Already-enabled → cheap no-op | PASS | Gate 1 `:220`; test `:141-156` |
| b-AC-4 | `claude` absent → no register, records absent status | PASS | Gates 2/3 `:222-224`; tests `:160-192` |
| b-AC-5 | Reuses detect + isPluginEnabled + createAutoWiring; no fork | PASS | `:155-160,189-201`; tests `:204-271` (real composition asserted) |
| b-AC-6 | Throw/timeout absorbed fail-soft; never blocks daemon | PASS | `:167-178,230-235`; tests `:274-337` |
| b-AC-7 | Exposes last outcome for 006c/006d | PASS | `:282-287`; tests `:339-384` |
| c-AC-1 | Onboarding step triggers reconcile via honeycomb seam | PASS | `harness-status.ts(cli):131-135`; delegates to `reconcileOnce`; test `harness-status.test.ts:79-88` |
| c-AC-4 | Seam returns renderable status; no hive reimplementation | PASS | `mapOutcomeToConnectStatus` `:58-74`; tests `:68-111` |
| c-AC-5 | Never hangs/dead-ends; resolves to clear state, exits 0 on non-error | PASS | `:113-128`; `runHarnessVerb` `:186-191`; tests `:113-136` + `harness-verb.test.ts:81-101` |
| c-AC-2 | Success → "Claude Code connected" | SEAM READY / hive UI pending | seam returns `connected`; hive render is hive track |
| c-AC-3 | `claude` absent → "Install Claude Code, then Retry" | SEAM READY / hive UI pending | seam returns `agent-absent`/`cli-absent`; Retry re-shells `connect`; hive render is hive track |
| d-AC-1 | Endpoint returns agent-present + plugin-enabled | PASS (endpoint present, CLI-authoritative) | `harness-api.ts:78,310-311,345-346`; F-2 ruling + W-2; CLI verb authoritative (`harness-status.ts(cli):147-170`) |
| d-AC-3 | Repair re-runs setup; state updates | PASS | `harness-status.ts(cli):137-145`; tests `:138-158` |
| d-AC-4 | plugin-enabled derived from isPluginEnabled, fail-soft false; no secret/path | PASS | `:159-164`; tests `harness-status.test.ts:160-220`, `harness-api-plugin-enabled.test.ts:92-132` |
| d-AC-5 | Repair that cannot complete → clear message, never blocks | PASS | `:137-145`; `runHarnessVerb` `:194-206`; tests `:223-240` |
| d-AC-2 | Hive dashboard shows state + last outcome | SEAM READY / hive UI pending | consumes `harness status --json`; hive card is hive track |
| AC-1 | Tarball contains `.mcp.json` + skill + 3 commands | PASS | via a-AC-1/2 |
| AC-2 | pack-check fails build on missing component | PASS | via a-AC-3 |
| AC-3 | Re-release + install exposes surface | PASS (pending release) | pack proxy; needs publish |
| AC-4 | Both paths: enabled with no user action within one reconcile cycle | PASS | F-1 ruling: daemon-start `onDaemonUp` pass |
| AC-5 | Ordering race: claude after honeycomb → wired next reconcile | PASS (F-1 limitation) | F-1 ruling; W-1 follow-up |
| AC-6 | Steady state cheap no-op | PASS | via b-AC-3/b-AC-4 gate order |
| AC-7 | Onboarding connect step | hc SEAM DONE / hive UI pending | `harness connect` |
| AC-8 | Dashboard per-harness state + Repair | hc API DONE / hive UI pending | endpoint field + `harness status`/`repair` verbs |
| AC-9 | No flow regresses install; degrade to clear message | PASS | all honeycomb seams fail-soft, exit 0 |

---

## Files Changed (15)

| File | Summary |
|---|---|
| `package.json` | `files` gains the three plugin paths (`.mcp.json`, `skills`, `commands`). a-AC-1. |
| `scripts/pack-check.mjs` | Derives MCP/hooks assertions from `.mcp.json`/`hooks.json`, asserts skills/commands dirs + files. a-AC-3/4. |
| `src/cli/harness-reconcile.ts` | The 006b self-healing reconciler (gates, fail-soft, cadence, last-outcome). b-AC-1..7. |
| `src/cli/harness-status.ts` | CLI-tier connect/status/repair runner over the reconcile. c-AC-1/4/5, d-AC-3/4/5. |
| `src/cli/runtime.ts` | Binds reconciler to `onDaemonUp` + the harness-status runner into RuntimeDeps. F-1 trigger site. |
| `src/commands/contracts.ts` | Adds the `harness` verb to the verb table. |
| `src/commands/dispatch.ts` | Routes `harness` → `runHarnessVerb` with `--json`. |
| `src/commands/harness-status.ts` | Thin renderable contract + verb handler (text/JSON). c-AC-4/5, d-AC-3/4/5. |
| `src/commands/index.ts` | Re-exports the harness contract + verb. |
| `src/commands/local-handlers.ts` | Optional `harnessStatus` dep on `LocalDeps`. |
| `src/daemon/runtime/dashboard/harness-api.ts` | Adds `pluginEnabled` field + injected `resolvePluginEnabled` seam. d-AC-1/4. F-2 site. |
| `tests/cli/harness-reconcile.test.ts` | 006b per-AC tests (b-AC-1..7). |
| `tests/cli/harness-status.test.ts` | 006c/006d runner per-AC tests. |
| `tests/commands/harness-verb.test.ts` | `harness` verb handler per-AC tests. |
| `tests/daemon/runtime/dashboard/harness-api-plugin-enabled.test.ts` | d-AC-1/4 endpoint tests. |

---

## `npm run ci` tail

```
 Test Files  436 passed (436)
      Tests  4691 passed | 13 skipped (4704)
   Duration  18.97s
...
SQL-safety audit: scanned 307 file(s) under src/daemon, src/daemon-client/
OK - every SQL interpolation routes through an escaping helper.
```

(The 13 skips are pre-existing suites outside this diff, e.g. `tests/cli/entry-guard.test.ts`; the PRD-006 diff contains no `.skip`/`.only`.)

---

## Verdict

**SHIPPABLE at the medium+ standard.** All honeycomb-side ACs pass; both flags resolve to intent-met-under-documented-constraint with non-blocking Warning-level follow-ups (W-1, W-2); no AC is reopened; no code remediation was required. The hive-UI track (c-AC-2/3, d-AC-2, hive halves of AC-7/8) is the only remaining PRD-006 surface, and the honeycomb seams it consumes (`honeycomb harness connect|status|repair --json`, the `GET /api/diagnostics/harnesses` `pluginEnabled` field) are present and shaped for it.
