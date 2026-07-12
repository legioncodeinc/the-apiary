# QA Report: Fleet Fix Plan — Waves 0–1 (sprightly-percolating-lake)

**Plan document:** `C:\Users\mario\.claude\plans\sprightly-percolating-lake.md` (Wave 0 + Wave 1 sections only; supporting defect definitions in `library/issues/issue-register.md` ISS-005..ISS-022)
**Audit date:** 2026-07-12
**Base branch:** `origin/main` (each repo)
**Head:** honeycomb `fix/route-and-registry-quick-wins` @ `818e709` (PR #297, OPEN) · hive `fix/dashboard-quick-wins` @ `34eecd5` (PR #24, OPEN)
**Auditor:** quality-worker-bee (invoked after security-worker-bee — ordering correct; security reported zero Critical/High findings, no remediation commits)

## Summary

**Pass with warnings.** All eight Wave-1 plan items (1–4 honeycomb, 5–8 hive) are implemented, each with real regression tests that assert the fixed behavior; 86/86 targeted tests pass and both repos typecheck clean; both PRs exist under the plan's exact branch names with green checks. Two items keep this from a clean pass: the plan's **one-time cleanup of duplicate rows in the live projects registry was never performed** (live API still returns the-apiary ×2 and inter-city-yacht-club ×4), and **Wave 0's embed-daemon remediation is not holding at audit time** (port 3851 unresponsive after 4s; live recall returns `degraded: true`) — semantic search is silently dead again, exactly the ISS-007 wedge that Wave 3 is scoped to fix permanently. Recommendation: merge Wave 1 as-is; perform the registry cleanup and re-kill the embed child as ops actions before the Wave-1 dogfood sign-off; do not move ISS-021/ISS-007 to Resolved in the issue register yet.

## Scorecard

| Category      | Status | Notes |
|---------------|--------|-------|
| Completeness  | ⚠️ | 8/8 code items delivered with tests; the ISS-021 one-time live-registry cleanup (an explicit plan sub-item) was not done |
| Correctness   | ✅ | Tests assert the actual fixed behaviors (route non-shadowing, dedupe-first-row-wins, heal-skip, real spawn + negative-first parse, honest ack copy, sig-digit scores, provider refresh); 46+40 targeted tests pass; `tsc --noEmit` clean in both repos |
| Alignment     | ✅ | No scope creep; extras are necessary companions (CLI ack renderer for the new status, `ViewLogsLink` affordance, release version bumps) |
| Gaps          | ⚠️ | Live registry duplicates persist; Wave 0's embed fix has regressed on the dogfood machine (recall `degraded: true` right now) |
| Detrimental   | ✅ | None blocking; minor dead code left behind by the LiveLog prune and a Node DEP0190 deprecation warning surfaced by the win32 `shell: true` spawn |

## Critical Issues (must fix)

None.

## Warnings (should fix)

- [ ] **ISS-021 one-time cleanup of live duplicate registry rows was not performed (open plan item — do not fix in this PR)**, plan `sprightly-percolating-lake.md:46-48` / `registry-sync.ts:146` (code side is done)

  Wave 1 honeycomb item 2 has three parts: dedupe Map (done), heal-skip for freshly-bound projects (done), and "one-time cleanup of the existing duplicate rows in the live registry." The third part was not done and was absent from the implementing Bee's report. Live evidence at audit time — `GET http://127.0.0.1:3850/api/diagnostics/scope/projects` returns 6 rows for 2 projects:

  ```json
  {"projectId":"the-apiary", ...}   // ×2 byte-identical
  {"projectId":"inter-city-yacht-club", ...}   // ×4 byte-identical
  ```

  Once the fixed daemon deploys, the Map dedupe masks these at the read layer, but the physical duplicate rows remain in the DeepLake `projects` table (the running 0.13.0 daemon still serves them raw). Remediation: run the planned cleanup (manual SQL or a `honeycomb maintenance` guard) on the dev machine after the PR merges, then verify the raw table holds one row per `project_id`.

- [ ] **Wave 0 item 1 (embed-daemon heal) is not holding — semantic search is degraded again at audit time**, ops (dogfood machine), class fix scoped at plan Wave 3 items 6–9

  Live at audit: `GET http://127.0.0.1:3851/health` returns nothing within 4s (curl exit 000 at the full timeout — the ISS-007 "accepts TCP, never replies" wedge signature), and a project-scoped recall (`POST /api/memories/recall`, query "honeycomb") returns 14 lexical hits with `degraded: true` — the semantic arm is dead and every search is paying the flat 3s embed deadline again. This does not implicate any Wave-1 code (Wave 0 was ops-only and the daemon-side liveness/respawn fix is deliberately Wave 3), but the plan's per-wave dogfood check requires "search returns scored results (non-0.00, `degraded:false`)" — that check fails right now. Remediation: re-kill the embed child (supervisor respawns it) before Wave-1 dogfood sign-off, and treat the recurrence as confirmation of Wave 3's priority. Note `/health` on :3850 still reports `embeddings: "on"` throughout — the lying latch, exactly as ISS-007 documents.

## Suggestions (consider improving)

- [ ] **Dead code left by the LiveLog prune**, `hive/src/dashboard/web/panels.tsx:418`, `hive/src/dashboard/web/wire.ts:3114-3131`

  After ISS-009, the `LiveLog` component has zero remaining consumers (the Logs page uses its own `LogRow` renderer; the Memories Watch panel renders its own lines), and `isSyncActivityRecord` / `syncActivityVerb` lost their only consumers when the sync activity feed was removed. Consider deleting them (or leaving a deprecation note) in a follow-up; the stale cross-reference in `pages/logs.tsx:9` ("shared with the Sync activity feed") should be updated with them.

- [ ] **DEP0190 deprecation warning from the win32 `shell: true` spawn**, `honeycomb/src/cli/health-probes.ts:94-100`

  The targeted test run prints `(node:…) [DEP0190] DeprecationWarning: Passing args to a child process with shell option true…`. The probe is safe (both argv elements are compile-time constants, matching the documented `fleet-detection.ts` pattern), but Node has deprecated the args-array-with-shell shape; a future Node major may harden it. Consider a single command string (`"cursor-agent status"`) on the shell path when this pattern is next touched.

- [ ] **`shell` is win32-conditional rather than the plan's unconditional `shell: true`**, `honeycomb/src/cli/health-probes.ts:99`

  ```ts
  shell: process.platform === "win32",
  ```

  The plan text says `{ shell: true }`; the implementation enables the shell only on win32. This is a strictly better reading of the plan's own rationale (the `.cmd`/EINVAL hardening is Windows-only; POSIX avoids needless shell parsing) — noted for traceability, no change requested.

## Plan Item Traceability

Legend: ✅ verified · ⚠️ delivered with a caveat / not holding · ❌ missing · 🟦 documented deviation

### Wave 0 — Unblock this machine (ops, no code)

| # | Plan Requirement | Status | Implementation Location | Notes |
|---|---|---|---|---|
| W0-1 | Kill wedged embed child (:3851) → supervisor respawns; restores semantic search | ⚠️ | ops (dogfood machine) | Not verifiable retroactively, and **not holding at audit**: :3851 unresponsive after 4s, live recall `degraded: true`. See Warning 2. Wave 3 owns the permanent fix. |
| W0-2 | Remove stale HKCU env vars `HONEYCOMB_PIPELINE_ENABLED`, `HONEYCOMB_PIPELINE_EXTRACTION_PROVIDER`, `HONEYCOMB_POLLINATING_*` | 🟦 | HKCU user environment (verified live) | The three pipeline/backfill vars are absent. `HONEYCOMB_POLLINATING_ENABLED=true` + `HONEYCOMB_POLLINATING_TOKEN_THRESHOLD=500` deliberately retained — **documented deviation**: the pollinating trigger reads env-only config until a later wave (cf. ISS-013's "latent config split"). |
| W0-3 | Set a Portkey model in hive Settings (`activeModel`), restart honeycomb daemon | ✅ | live `GET :3850/health` | `portkey: "ok"`, `memory: {enabled: true, provider: "configured"}`, daemon up (uptime ~33 min at audit). |
| W0-4 | Acceptance: health shows portkey ok; `memoryFormation.committedSinceBoot > 0`; new memories appear | ✅ | live `GET :3850/health` | `committedSinceBoot: 8`, `lastCommittedAt: 2026-07-12T20:28:12Z`, `lastAction: "inserted"`. **The Wave-0 acceptance test passes — memories form.** |

### Wave 1 honeycomb — PR #297 `fix/route-and-registry-quick-wins`

| # | Plan Requirement | Status | Implementation Location | Notes |
|---|---|---|---|---|
| 1a | ISS-012: register lifecycle literal GETs (`/conflicts`, `/stale-refs`, `/history`) before parametric `GET /:id` | ✅ | `src/daemon/runtime/memories/api.ts:984` (`registerLifecycleReadRoutes` called immediately before `group.get("/:id")`); extraction in `lifecycle-api.ts:223-250`; `mountLifecycleApi` retained as back-compat shim; assemble note at `assemble.ts:1605-1608` | Same shape as the prior `/prime` fix, as the plan specifies. |
| 1b | SP-7 route-order regression test | ✅ | `tests/daemon/runtime/memories/lifecycle-route-order.test.ts` (new, 4 tests) | Asserts all three literals answer 200 with their own list shapes (not the `/:id` `{error:"not_found"}` bug signature) in the production mount order, and that `/:id` still resolves a real id. |
| 2a | ISS-021: dedupe registry rows by `projectId` via `Map` in registry-sync | ✅ | `src/daemon/runtime/projects/registry-sync.ts:146-153` (first row wins) + final merged-list belt at :188-193 | Test: duplicate registry read collapses to one cached project (`registry-sync.test.ts:217-239`). |
| 2b | Skip sync-heal for freshly-bound projects | ✅ | `registry-sync.ts:176-178` (`boundIds` skip) | Tests: lagged-registry bind is not re-upserted; already-present project issues no heal write; unbound legacy project still heals (`registry-sync.test.ts:241-297`). |
| 2c | One-time cleanup of existing duplicate rows in the live registry | ❌ | — | **Open plan item.** Live API still returns 6 rows for 2 projects (the-apiary ×2, ICYC ×4). See Warning 1. Not fixed here per report-don't-fix. |
| 3 | ISS-017: real `probeCursorLogin` via `spawnSync("cursor-agent", ["status"])` with win32 `.cmd`/EINVAL hardening; parse "Logged in" | ✅ | `src/cli/health-probes.ts:89-135` (injectable `CursorLoginSpawn` seam; negative-first "Not logged in" check; account extraction; ENOENT/timeout/throw → soft "login state unknown") | 8 new tests in `tests/cli/health-probes.test.ts:75-140`. `shell` is win32-conditional (see Suggestion 3 — improvement over plan letter, matches plan intent). |
| 4 | ISS-013 (API slice): map `below-threshold` ack to its own status instead of `running` | ✅ | `src/daemon/runtime/pollinating/api.ts:143` (status union + `tokens`/`threshold` additive fields), `ackFor` :198-217, config resolved at mount so ack and trigger share one threshold (:250-256) | Tests: below-threshold acks its own status + token count and is never `"running"`; genuine running ack unchanged without the new fields; secret-guard test updated to admit the numeric fields (`pollinating/api.test.ts:121-141, 243-255`). Companion: CLI ack renderer handles the new status (`src/commands/pollinate.ts:107-131`) — necessary consumer, not creep. |

### Wave 1 hive — PR #24 `fix/dashboard-quick-wins`

| # | Plan Requirement | Status | Implementation Location | Notes |
|---|---|---|---|---|
| 5 | ISS-007 (display): render 3 significant digits instead of `toFixed(2)` | ✅ | `src/dashboard/web/primitives.tsx:336-339` (`formatScore`, `toPrecision(3)` with trailing-zero drop, non-finite → "0"); MemoryCard renders through it at :444 | Plan offered "3 sig digits / top-hit-normalized" — sig-digits option chosen. Tests cover the real RRF range 0.0008–0.05 incl. the "never 0.00" assertion (`tests/dashboard/memory-card-score.test.tsx`). Live scores measured this audit (0.0687, 0.0008) confirm the range. |
| 6 | ISS-019: expose `refreshProjects: loadProjects` from `ScopeProvider`; call from the three onBound sites | ✅ | `scope-context.tsx:112` (interface), :168 (default), :473 (memo, bound to the stable `useCallback` `loadProjects` :317; memo deps updated); call sites `pages/projects.tsx:576-580` (`reList`, covers bind+unbind), `needs-project.tsx:84-91`, `pages/hive-graph.tsx:139-142` | Test drives mount-empty → refresh → list shows the new binding (`tests/dashboard/scope-context.test.tsx:190-247`). |
| 7 | ISS-009: remove LiveLog mounts from /dashboard ×2, /harnesses, /sync, /health; keep /logs + Memories Watch | ✅ | `pages/dashboard.tsx` (full log + `/api/logs` poll + recall-note feed removed), `harness-strip.tsx` (short-tail removed, `streamLines` prop dropped), `pages/harnesses.tsx` (detail stream + logs SWR + `filterRecordsForHarness` removed), `pages/sync.tsx` (activity feed + SSE follow removed), `pages/health.tsx` (`LiveLogTail` + verbosity selector removed); `/logs` (`LogRow` renderer) and Memories Watch (`memories.tsx:545-565`) untouched | Zero `<LiveLog>` mounts remain repo-wide (verified by grep). Additive `ViewLogsLink` affordance (`panels.tsx:451-470`, route const `registry.tsx:214`) fills the holes — reasonable, tested (`view-logs-link.test.tsx`); health-page tests updated to assert the tail is gone. Leftover dead code → Suggestion 1. |
| 8 | ISS-013 (UI slice): show tokens/threshold progress instead of "already running"; zod `.catch` back-compat | ✅ | `pages/memories.tsx:97-110` (`pollinateNoteFromAck`: below-threshold → "not enough new activity yet · N/M tokens", checked first and via status OR reason; genuine running keeps "already running"); `wire.ts:866-869` (`tokens`/`threshold` `.optional().catch(undefined)`) | 10 tests: honest copy matrix + old-daemon body parses unchanged + malformed fields degrade to undefined (`tests/dashboard/pollinate-note.test.ts`). Copy renders progress rather than the literal "tokens/100000" — plan intent (honest progress) met. |

### Verification gates (plan "Verification" section, Wave-1 slice)

| # | Plan Requirement | Status | Evidence |
|---|---|---|---|
| V-1 | `npm run ci`-class checks green in each repo | ✅ | This audit: honeycomb targeted vitest 46/46, hive 40/40; `tsc --noEmit` exit 0 in both. PR checks green (honeycomb: CodeQL/Aikido/CodeRabbit/evaluate/release-gate all pass; hive: CodeRabbit + release-gate pass — hive has no test-runner CI job, tests verified locally by this audit). |
| V-2 | Fix branches + PRs per repo per delivery contract | ✅ | PR #297 (honeycomb) and PR #24 (hive), both OPEN, branch names exactly as planned. |
| V-3 | Dogfood loop after honeycomb merge (memories form, non-0.00 scored search `degraded:false`, no 404s, single project entries, sidebar updates) | ⚠️ | Pre-merge, so pending by definition — but two legs already fail on the live machine today: `degraded:true` recall (Warning 2) and duplicate project entries (Warning 1). Run the full loop after merge + ops actions. |
| V-4 | Issue-register statuses flipped to resolved only after dogfood passes | ✅ | Correctly NOT yet flipped — register still shows ISS-007/009/012/013/017/019/021 open (`library/issues/issue-register.md`), matching the convention. |

## Files Changed

### honeycomb `fix/route-and-registry-quick-wins` (origin/main...818e709)

- `.claude-plugin/marketplace.json` (M), version bump (release chore)
- `.claude-plugin/plugin.json` (M), version bump
- `CHANGELOG.md` (M), Wave-1 entry
- `harnesses/claude-code/.claude-plugin/plugin.json` (M), version bump
- `harnesses/codex/package.json` (M), version bump
- `harnesses/openclaw/openclaw.plugin.json` (M), version bump
- `harnesses/openclaw/package.json` (M), version bump
- `package-lock.json` (M), version bump
- `package.json` (M), version bump
- `src/cli/health-probes.ts` (M), real D4 cursor-agent login probe with injectable spawn seam (ISS-017)
- `src/commands/pollinate.ts` (M), CLI renders the new `below-threshold` ack status with progress (ISS-013 companion)
- `src/daemon/runtime/assemble.ts` (M), comment: lifecycle mount is now a back-compat net (ISS-012)
- `src/daemon/runtime/memories/api.ts` (M), lifecycle literal GETs registered before `/:id` (ISS-012)
- `src/daemon/runtime/memories/lifecycle-api.ts` (M), routes extracted to `registerLifecycleReadRoutes`; `mountLifecycleApi` kept as shim (ISS-012)
- `src/daemon/runtime/pollinating/api.ts` (M), `below-threshold` ack status + tokens/threshold fields; config shared between ack and trigger (ISS-013)
- `src/daemon/runtime/projects/registry-sync.ts` (M), Map dedupe (first row wins), bound-project heal-skip, merged-list belt (ISS-021)
- `tests/cli/health-probes.test.ts` (M), 8 new D4 probe tests
- `tests/daemon/runtime/memories/lifecycle-route-order.test.ts` (A), SP-7 route-order regression guard (4 tests)
- `tests/daemon/runtime/pollinating/api.test.ts` (M), below-threshold status + additive-shape + secret-guard tests
- `tests/daemon/runtime/projects/registry-sync.test.ts` (M), dedupe + heal-skip tests (4 new)

### hive `fix/dashboard-quick-wins` (origin/main...34eecd5)

- `CHANGELOG.md` (M), Wave-1 entry
- `package-lock.json` (M), version bump
- `package.json` (M), version bump
- `src/dashboard/web/harness-strip.tsx` (M), short-tail LiveLog + `streamLines` prop removed (ISS-009)
- `src/dashboard/web/needs-project.tsx` (M), onBound calls `refreshProjects` (ISS-019)
- `src/dashboard/web/pages/dashboard.tsx` (M), full LiveLog + `/api/logs` poll + recall-note feed removed; `ViewLogsLink` (ISS-009)
- `src/dashboard/web/pages/harnesses.tsx` (M), detail log stream + logs SWR + `filterRecordsForHarness` removed; `ViewLogsLink` (ISS-009)
- `src/dashboard/web/pages/health.tsx` (M), `LiveLogTail` + verbosity selector removed; `ViewLogsLink` (ISS-009)
- `src/dashboard/web/pages/hive-graph.tsx` (M), onBound calls `refreshProjects` (ISS-019)
- `src/dashboard/web/pages/memories.tsx` (M), `pollinateNoteFromAck` honest below-threshold copy (ISS-013); Watch panel kept
- `src/dashboard/web/pages/projects.tsx` (M), `reList` calls `refreshProjects` (ISS-019)
- `src/dashboard/web/pages/sync.tsx` (M), activity feed + SSE follow removed; `ViewLogsLink` (ISS-009)
- `src/dashboard/web/panels.tsx` (M), new `ViewLogsLink`; `LiveLog` now consumer-less (see Suggestion 1)
- `src/dashboard/web/primitives.tsx` (M), `formatScore` 3-sig-digit render on MemoryCard (ISS-007)
- `src/dashboard/web/registry.tsx` (M), `LOGS_ROUTE` const exported
- `src/dashboard/web/scope-context.tsx` (M), `refreshProjects` on `ScopeSwitcherValue` (ISS-019)
- `src/dashboard/web/wire.ts` (M), `PollinateAckSchema` tokens/threshold with `.catch` back-compat (ISS-013)
- `tests/dashboard/health-page.test.tsx` (M), asserts tail removed + link present
- `tests/dashboard/memory-card-score.test.tsx` (A), `formatScore` + card render tests (7)
- `tests/dashboard/pollinate-note.test.ts` (A), ack→copy matrix + schema back-compat tests (10)
- `tests/dashboard/scope-context.test.tsx` (M), `refreshProjects` re-enumeration test
- `tests/dashboard/view-logs-link.test.tsx` (A), client-side navigation test
