# Execution Ledger — PRD-006 (Reliable Claude Code Plugin Delivery + Auto-Wiring)

> Orchestration: `/the-smoker`. PRD: `library/requirements/backlog/prd-006-claude-code-plugin-delivery-and-auto-wiring/`.
> Code repos: **honeycomb** submodule (worktree `C:/Users/mario/GitHub/honeycomb-prd006`, branch `feature/prd-006-plugin-delivery` off `main` 6afb337) and **hive** submodule (UI, separate branch/PR).
> Status: `OPEN` / `IN PROGRESS` / `DONE` / `VERIFIED` / `BLOCKED`. DONE = implemented + locally verified by the implementer; VERIFIED = confirmed by a separate close-out pass.

## Two-repo split

- **honeycomb** (this run's primary PR): 006a (full), 006b (full), 006c honeycomb seam, 006d harness-API + repair action.
- **hive** (second track PR): 006c onboarding step UI, 006d dashboard card render.
- **the-apiary**: PRD-006 backlog → completed + this ledger (doc PR).

## Dependency map

- 006a: independent (honeycomb, P0 urgent).
- 006b: foundational reconcile (honeycomb, P0). 006c-seam + 006d-api both consume it.
- 006c-seam, 006d-api: depend on 006b (call reconcile / read its status).
- hive UI (006c/006d render): depends on the honeycomb seams landing.

## Wave plan

| Wave | Item | Repo | Owner Bee | Model | Depends on |
|---|---|---|---|---|---|
| 1 | 006a packaging + pack-check guard | honeycomb | ci-release-worker-bee | gpt-5.3-codex-high-fast | — |
| 1 | 006b self-healing reconcile | honeycomb | typescript-node-worker-bee | claude-opus-4-8-thinking-high | — |
| 2 | 006c honeycomb onboarding-status seam | honeycomb | typescript-node-worker-bee | claude-sonnet-5-thinking-high | 006b |
| 2 | 006d harness-API plugin-enabled field + repair action | honeycomb | typescript-node-worker-bee | claude-sonnet-5-thinking-high | 006b |
| Close | security-worker-bee → quality-worker-bee | honeycomb | security/quality | claude-opus-4-8-thinking-high | all honeycomb impl |
| Hive | 006c step UI + 006d card (second track) | hive | react/website bee | tbd | honeycomb seams merged |

Gate for every honeycomb item: `npm run ci` green in the worktree.

---

## AC Ledger

### PRD-006a — Packaging completeness (honeycomb, P0)

| ID | Criterion (abridged) | Repo | Status | Owner | Evidence |
|---|---|---|---|---|---|
| a-AC-1 | `package.json` `files` includes `.mcp.json`, `skills`, `commands` | honeycomb | VERIFIED | W1/QA | `package.json:34-36`; confirmed in QA close-out (2026-07-08) |
| a-AC-2 | `npm pack --dry-run` lists `.mcp.json`, `skills/honeycomb-memory/SKILL.md`, `commands/{recall,remember,forget}.md` | honeycomb | VERIFIED | W1/QA | QA re-ran `npm pack --dry-run`: all 5 files PRESENT |
| a-AC-3 | `pack-check` fails if any declared plugin component missing from pack | honeycomb | VERIFIED | W1/QA | guard logic confirmed (`pack-check.mjs:79-148`, `exit 1` on missing); prior probe removed remember.md → PROBE_EXIT=1 |
| a-AC-4 | Guard derives checklist from plugin's own declarations (.mcp.json args, conventional dirs), not a literal list | honeycomb | VERIFIED | W1/QA | MCP from `.mcp.json` args + hooks from `hooks.json` + conventional dir checks; literal file list is additive (QA S-1, non-blocking) |
| a-AC-5 | After re-release, installed plugin exposes skill + 3 commands + registered MCP server | honeycomb | DONE (pending release) | W1/QA | pack-listing proxy verified; live-install confirmation still needs a publish (module AC-3) |
| a-AC-6 | `npm run ci` + `pack:check` pass; no forbidden files pulled in | honeycomb | VERIFIED | W1/QA | QA re-ran: ci green (4691 passed), pack:check OK (69 files, no forbidden) |

### PRD-006b — Self-healing reconcile (honeycomb, P0)

| ID | Criterion (abridged) | Repo | Status | Owner | Evidence |
|---|---|---|---|---|---|
| b-AC-1 | On daemon start, agent present + plugin not enabled + claude available → reconcile runs connector install → plugin enabled | honeycomb | VERIFIED | W1/QA | `harness-reconcile.ts:217-236,257-263`; onDaemonUp seam (`runtime.ts:713`); tests `:52-98` |
| b-AC-2 | Reconcile also runs on recurring cadence (out-of-order install wired next cycle) | honeycomb | VERIFIED (documented limitation) | W1/QA | cadence implemented + fake-timer tested (`:109-137`); SEE F-1 RULING — cadence host is the short-lived CLI, so the recurrence fires on daemon-start + daemon-ensuring CLI invocations, not an autonomous long-lived idle loop. Non-blocking follow-up |
| b-AC-3 | Plugin already enabled → no `claude plugin install`, cheap no-op | honeycomb | VERIFIED | W1/QA | Gate 1 `:220`; test `:141-156` |
| b-AC-4 | `claude` absent → no registration, no spin/error, records "cli-absent" status | honeycomb | VERIFIED | W1/QA | Gates 2/3 `:222-224`; tests `:160-192` |
| b-AC-5 | Reuses detectInstalledHarnesses + isPluginEnabled + createAutoWiring over real connector; no fork | honeycomb | VERIFIED | W1/QA | `:155-160,189-201`; tests `:204-271` assert the real composition |
| b-AC-6 | Reconcile throw/timeout absorbed fail-soft; never fails/blocks daemon | honeycomb | VERIFIED | W1/QA | `:167-178,230-235`; tests `:274-337` |
| b-AC-7 | Exposes last outcome (wired/already-enabled/agent-absent/cli-absent/error) for 006c/006d | honeycomb | VERIFIED | W1/QA | `:282-287`; tests `:339-384` |

### PRD-006c — Onboarding connect step (honeycomb seam + hive UI, P1)

| ID | Criterion (abridged) | Repo | Status | Owner | Evidence |
|---|---|---|---|---|---|
| c-AC-1 | Onboarding step triggers 006b reconcile via honeycomb seam | hive+hc | VERIFIED (hc seam) | W2/QA | `harness-status.ts(cli):131-135` → `reconcile.reconcileOnce()`; test `harness-status.test.ts:79-88`. Hive UI wiring = hive track |
| c-AC-2 | Success → "Claude Code connected" | hive | SEAM READY / hive UI pending | Hive | honeycomb seam returns `connected`; hive render is hive track (do not fail here) |
| c-AC-3 | `claude` absent → "Install Claude Code, then Retry"; Retry re-runs reconcile | hive | SEAM READY / hive UI pending | Hive | seam returns `agent-absent`/`cli-absent`; Retry re-shells `connect`; hive render is hive track |
| c-AC-4 | honeycomb seam returns renderable status (connected/agent-absent/cli-absent/error); hive does not reimplement detection/wiring | honeycomb | VERIFIED | W2/QA | `mapOutcomeToConnectStatus` `:58-74`; tests `:68-111` |
| c-AC-5 | Step never hangs/dead-ends; resolves to clear state | hive+hc | VERIFIED (hc seam) | W2/QA | `:113-128`; `runHarnessVerb:186-191`; tests `:113-136` + `harness-verb.test.ts:81-101` (exits 0 on non-error) |

### PRD-006d — Harness-status card (honeycomb API + hive UI, P1)

| ID | Criterion (abridged) | Repo | Status | Owner | Evidence |
|---|---|---|---|---|---|
| d-AC-1 | `GET /api/diagnostics/harnesses` returns per-harness agent-present + plugin-enabled | honeycomb | VERIFIED (endpoint present, CLI-authoritative) | W2/QA | F-2 RULING confirmed: endpoint carries `pluginEnabled` (fail-soft) but `assemble.ts:1719-1725` injects NO `resolvePluginEnabled`, so it is `false` in prod; authoritative live value = `harness status` CLI verb (which hive consumes). Meets intent under the Tier-2→Tier-4 invariant. SEE W-2 |
| d-AC-2 | Hive dashboard shows per-harness connection state + last reconcile outcome | hive | SEAM READY / hive UI pending | Hive | consumes `harness status --json` (authoritative); hive card is hive track (do not fail here) |
| d-AC-3 | "Reconnect / Repair" action re-runs setup; shown state updates | honeycomb+hive | VERIFIED (hc seam) | W2/QA | `harness-status.ts(cli):137-145` re-runs reconcile; tests `:138-158`. Hive button = hive track |
| d-AC-4 | plugin-enabled derived from isPluginEnabled (fail-soft false when claude absent); no secret/path in response | honeycomb | VERIFIED | W2/QA | `:159-164`; tests `harness-status.test.ts:160-220` + `harness-api-plugin-enabled.test.ts:92-132` (no secret/path asserted) |
| d-AC-5 | Repair that cannot complete → clear message, never fails/blocks daemon/dashboard | honeycomb+hive | VERIFIED (hc seam) | W2/QA | `:137-145`; `runHarnessVerb:194-206`; tests `:223-240` (connected:false, exit 0) |

### PRD-006 — Module-level

| ID | Criterion (abridged) | Repo | Status | Owner | Evidence |
|---|---|---|---|---|---|
| AC-1 | Tarball contains `.mcp.json` + skill + 3 commands (npm pack --dry-run) | honeycomb | VERIFIED | W1/QA (006a) | via 006a; QA re-ran pack listing |
| AC-2 | pack-check fails build if any declared plugin component missing | honeycomb | VERIFIED | W1/QA (006a) | via 006a (guard logic confirmed) |
| AC-3 | After re-release + install, session exposes skill + commands + MCP server | honeycomb | DONE (pending release) | W1/QA (006a) | pack proxy verified; needs publish to fully confirm live |
| AC-4 | Both install paths: agent present + plugin not enabled → enabled with no user action within one reconcile cycle | honeycomb | VERIFIED | W1/QA (006b) | F-1 RULING: daemon-start `onDaemonUp` reconcile pass wires within one cycle, no user action |
| AC-5 | Ordering race covered: Claude Code installed after Honeycomb → wired next reconcile | honeycomb | VERIFIED (documented limitation) | W1/QA (006b) | F-1 RULING: reconcile re-fires on next daemon-start (service-managed boot restart), any daemon-ensuring CLI verb, or connect/repair — no plugin re-install by the user. Autonomous idle-loop in a purely-idle long-lived daemon is a non-blocking follow-up (W-1), NOT reopened |
| AC-6 | Steady state cheap no-op (plugin enabled or claude absent → no install) | honeycomb | VERIFIED | W1/QA (006b) | gate order isPluginEnabled → available → wire |
| AC-7 | Onboarding "Connect your coding assistant" step: connected / install-claude-retry | hive+hc | VERIFIED (hc seam) / hive UI pending | W2/QA | seam ready + tested (`harness connect`); hive step UI = hive track |
| AC-8 | Dashboard per-harness agent-present + plugin-enabled + Reconnect/Repair | honeycomb+hive | VERIFIED (hc API+verbs) / hive UI pending | W2/QA | endpoint field + `harness status`/`repair` verbs ready + tested; hive card = hive track (reads CLI verb per W-2) |
| AC-9 | No flow regresses install: degrade to clear message, never fail/block | honeycomb+hive | VERIFIED (hc) | all/QA | all honeycomb seams fail-soft, exit 0; hive UI to honor on its side |

---

## Wave log

- **Setup:** honeycomb worktree `feature/prd-006-plugin-delivery` off main 6afb337; deps installed; ledger created.
- **Wave 1:** COMPLETE. 006a + 006b DONE + merged; combined `npm run ci` green (4660), SQL-safety OK.
- **Wave 2:** COMPLETE (honeycomb side). 006c seam + 006d API DONE + merged (b91fb6a); combined `npm run ci` green (4691). Surface = `honeycomb harness status|connect|repair` verbs + daemon `pluginEnabled` field via injected seam. Hive-UI ACs (c-AC-2/3, d-AC-2) remain on the hive track.
- **Close-out:** COMPLETE (honeycomb side). security-worker-bee clean (no Crit/High/Medium; `reports/2026-07-08-security-audit.md`); quality-worker-bee ran second and VERIFIED all honeycomb ACs (`reports/2026-07-08-prd-006-honeycomb-qa-report.md`). No code remediation required. Branch SHIPPABLE at medium+.
- **Ship (honeycomb):** DONE — PR https://github.com/legioncodeinc/honeycomb/pull/274 (`feature/prd-006-plugin-delivery`). PRD-006 moved backlog → in-work (hive-UI track open, so NOT completed yet).
- **Hive track:** OPEN — consume `harness connect/status/repair --json` in the onboarding step (c-AC-2/3) + dashboard card (d-AC-2). Product decisions needed before build: step placement, skippable-vs-blocking, card placement, absent-agent copy (PRD open questions).

## Follow-ups / limitations

### Quality rulings (2026-07-08, quality-worker-bee)

- **F-2 RULING — d-AC-1 met at "endpoint present, CLI-authoritative."** Confirmed the daemon composition root (`src/daemon/runtime/assemble.ts:1719-1725`) mounts the harness API WITHOUT `resolvePluginEnabled`, so `GET /api/diagnostics/harnesses` returns `pluginEnabled:false` for every harness in production. This is a direct consequence of the load-bearing Tier-2→Tier-4 import invariant (the daemon cannot import `isPluginEnabled`), not a defect. The authoritative live value is served by the Tier-4 CLI verb `honeycomb harness status --json`, which hive consumes. d-AC-1's field is present, correctly typed, fail-soft, and injectable; AC-8's intent is met via the CLI-authoritative path. **NOT reopened.** Guidance (W-2): hive must read plugin-enabled from the CLI verb, never the daemon endpoint.
- **F-1 RULING — AC-4 fully met; AC-5 / b-AC-2 met with a documented, non-blocking limitation (NOT reopened).** Confirmed (`src/cli/harness-reconcile.ts:257-275` + `src/cli/runtime.ts:713`): `onDaemonUp` fires an immediate `reconcileOnce()` on every daemon-up (started or already-running), and `start()` arms an unref'd `setInterval` cadence hosted in the short-lived CLI process. AC-4 is satisfied by the daemon-start pass (wire within one reconcile cycle, no user action). AC-5's "wired at the next reconcile with no re-install by the user" is satisfied for all realistic timelines because a reconcile re-fires on the next daemon-start (the daemon is OS-service-managed with start-on-boot, PRD-064h), any daemon-ensuring CLI verb, or the connect/repair verbs. The only uncovered case is a daemon up indefinitely with zero CLI activity and no reboot; a durable in-daemon idle loop is correctly deferred (blocked by the forbidden `server.ts`/`services/types.ts` contention seam) and tracked as W-1 below. Module cadence is implemented + fake-timer tested.

### Open follow-ups (non-blocking)

- **W-1 (follow-up):** land a durable long-lived reconcile driver (daemon spawning the CLI reconcile verb on a cadence, or a DI service once the contention seam frees) to cover the purely-idle long-running daemon. Non-blocking.
- **W-2 (guidance):** hive dashboard card + onboarding must read plugin-enabled from `honeycomb harness status --json` (authoritative), not the daemon endpoint (`pluginEnabled:false` in prod). Consider a doc note on the endpoint field.
- **S-1 (suggestion):** `scripts/pack-check.mjs` mixes derived checks (MCP/hooks/dirs) with a literal command/skill file list; optionally derive per-file assertions from the dirs to keep the guard fully self-updating.
- **AC-3 (pending release):** live-install confirmation of the plugin surface still needs a honeycomb publish + the fleet installer resolving the new version.

- **Hive track:** pending — 006c/006d UI in hive submodule (after honeycomb seams merge).

## Watchdog / termination log

- (none yet)
