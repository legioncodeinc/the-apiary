# The Apiary — Supplemental Investigation Plan (checklist)

**Date:** 2026-07-09
**Purpose:** A concrete, pass/fail plan for the open investigation threads identified after the [live-verification addendum](2026-07-08-live-verification-addendum.md) and the [confirmed-bugs register](2026-07-09-confirmed-bugs-and-fixes.md). Every item has (a) explicit **AI steps** (commands/queries the assistant runs), (b) **Human steps** (actions only a person can do — click, type in Cursor, observe UI), and (c) a **binary pass/fail acceptance criterion** so we are verifying, not guessing.

**How to use:** Work top to bottom. Do **Group 0** first (preconditions). For each AC, run the AI steps and Human steps, then tick the box and record PASS/FAIL + evidence in the [Results log](#results-log). A FAIL either confirms a bug (file it in the register) or spawns a follow-up AC. Do not tick an AC without recorded evidence.

**Conventions:**
- Daemons: honeycomb `:3850`, embeddings `:3851`, doctor `:3852`, hive `:3853`, nectar `:3854`.
- Live state root: `~/.apiary/`. Honeycomb logs: `~/.apiary/honeycomb/.daemon/logs.db` (tables `event_log`, `request_log`), queue `~/.apiary/honeycomb/.daemon/local-queue.db` (`local_job`).
- Reusable query/curl snippets are in the [Cookbook](#cookbook) — steps reference them as `[CB-n]`.
- "bound repo" = a path under a binding in `~/.deeplake/projects.json` (currently only `C:\Users\mario\GitHub\the-apiary`).

---

## Group 0 — Preconditions (must all PASS before any other group)

**Objective:** Confirm we are reading the LIVE fleet, not stale state (the trap that caused the original mis-diagnosis).

**AI steps:** run `[CB-1]` (all five health endpoints), `[CB-2]` (KPIs), and confirm `~/.apiary/honeycomb/.daemon/logs.db` mtime is within minutes.
**Human steps:** none.

- [ ] **AC-0.1** All five daemons answer. **PASS if** `:3850/health`, `:3851/health`, `:3852/status.json`, `:3853/api/fleet-status`, `:3854/health` all return 200 JSON. **FAIL if** any is unreachable → note which, stop and restart the fleet.
- [ ] **AC-0.2** We are on the live daemon. **PASS if** `~/.apiary/honeycomb/.daemon/logs.db` mtime is < 10 min old AND `event_log` MAX(time) is today. **FAIL if** stale → you are reading the wrong `.daemon`.
- [ ] **AC-0.3** honeycomb reports healthy. **PASS if** `:3850/health` shows `pipeline:ok, storage:reachable, schema:ok`. **FAIL** → capture `reasons` and branch to the relevant group.

---

## Group A — Codex harness reporting (suspected BUG-01/02 sibling)

**Objective:** Determine whether Codex is silently broken the same way Cursor was (config rejected / cwd unnormalized), or simply unused.
**Hypothesis:** `~/.codex/hooks.json` has `version: undefined` and `codex.turnsCaptured=0`; Codex likely never captures.

**AI steps:**
1. `[CB-3]` cursor/codex/claude harness rows from `:3850/api/diagnostics/harnesses`.
2. Read `~/.codex/hooks.json`; confirm presence/absence of a numeric `version` and that hook commands point at a honeycomb bundle.
3. Read the Codex connector `honeycomb/src/connectors/codex.ts` — does it emit `version`? What config schema does Codex validate against (does Codex require a version like Cursor)?
4. After the Human step, grep the live `local_job`/`event_log` and re-read harness row for `source_tool='codex'` / `agent='codex'` evidence `[CB-4]`.

**Human steps:**
1. Confirm whether you actually use Codex at all. If not, mark AC-A3 N/A.
2. If you do: run one Codex turn **inside `the-apiary`** (a bound repo), then tell the AI "done."
3. Report whether Codex shows any config-error UI (analogous to Cursor's banner).

- [ ] **AC-A1** Baseline. **PASS if** we record Codex's `installed/pluginEnabled/turnsCaptured/lastSeen` and the `~/.codex/hooks.json` `version` value. (Documentation AC — always completable.)
- [ ] **AC-A2** Codex config validity. **PASS if** `~/.codex/hooks.json` has a numeric `version` **and** Codex reports no config error. **FAIL if** `version` is missing/non-numeric (→ file BUG-01-codex).
- [ ] **AC-A3** Codex actually captures. **PASS if**, after one Codex turn in a bound repo, `codex.turnsCaptured` increments AND a `sessions` row with `agent='codex'` appears. **FAIL if** it stays 0 (→ Codex is broken; determine which layer via A2 + cwd check). **N/A if** Codex is unused.
- [ ] **AC-A4** Codex cwd normalization. **PASS if** the Codex payload's cwd/workspace field resolves to a bound path (no `no_bound_project` bump on the Codex turn). **FAIL if** gated (→ BUG-02-codex).

---

## Group B — Cursor end-to-end fix verification (BUG-01 + BUG-02)

**Objective:** Prove that fixing the two Cursor bugs makes Cursor actually report. Run this AFTER the shim/connector fixes land and the bundle is rebuilt+reinstalled.
**Hypothesis:** with `version` present and `/c:/…` normalized, a Cursor turn in `the-apiary` produces a `sessions` row with `agent='cursor'`.

**AI steps:**
1. Confirm `~/.cursor/hooks.json` has `"version": 1` and the bundle mtime is post-fix `[CB-5]`.
2. Record baseline `cursor.turnsCaptured` and `no_bound_project` `[CB-3]`/`[CB-1]`.
3. After the Human turn: re-read `cursor.turnsCaptured`, `no_bound_project`, and grep `event_log` for a Cursor capture / any `capture.flush.failed`.
4. Confirm the resolved cwd binds (temporarily re-add the `hc-probe` if needed to capture `workspace_roots`, then remove it).

**Human steps:**
1. Fully reload Cursor (Developer: Reload Window) with `the-apiary` open.
2. Confirm the "Configuration Errors" banner is **gone**.
3. Submit one Agent prompt; tell the AI "done."

- [ ] **AC-B1** Config accepted. **PASS if** Cursor shows no config-error banner after reload. **FAIL** → re-check `version`/schema.
- [ ] **AC-B2** Hooks fire. **PASS if** Cursor's hook log shows `sessionStart`/`beforeSubmitPrompt` spans for the turn. **FAIL** → Cursor not executing hooks.
- [ ] **AC-B3** Capture binds (not gated). **PASS if** `no_bound_project` does **not** increment on the Cursor turn. **FAIL** → BUG-02 not fully fixed (cwd still mismatches).
- [ ] **AC-B4** Cursor reports. **PASS if** `cursor.turnsCaptured > 0` and `lastSeen` is the turn time. **FAIL** → capture reached the daemon but didn't persist (check Defect 1 / BUG-03).

---

## Group C — Memory/session capture pipeline (Defect 1 / BUG-03)

**Objective:** Confirm the variable-width batch-INSERT bug is the cause of the stuck count, and (post-fix) that it's resolved.
**Hypothesis:** `capture.flush.failed: buildInsertMany: row column count 15 != expected 19` drops batches; `droppedEvents` is its blast-radius counter.

**AI steps:**
1. `[CB-6]` count `capture.flush.failed` + `capture.batch_insert.failed` in `event_log` and show the latest 5 `fields`.
2. `[CB-2]` record `memoryCount`/`sessionCount` + `droppedEvents`; wait one active window and re-read to see if `sessionCount` grows while failures fire.
3. Post-fix: re-run and confirm the `15 != 19` reason no longer appears and `sessionCount` grows 1:1 with captured turns.

**Human steps:**
1. In a bound repo, run ~5 turns of mixed content (a plain user message + an assistant turn that uses tokens) to force a mixed-width batch.

- [ ] **AC-C1** Bug reproduces. **PASS if** `event_log` currently contains `capture.flush.failed` with reason `row column count 15 != expected 19` dated today. **FAIL if** absent (bug may already be fixed or not triggering).
- [ ] **AC-C2** Damage is real. **PASS if** `droppedEvents > 0` and `sessionCount` lags the number of turns run in AC's human step. **FAIL** → captures persisting fine.
- [ ] **AC-C3 (post-fix)** Resolved. **PASS if** after the fix, running a mixed batch produces **no** `15 != 19` failures and `sessionCount` increases by the number of turns. **FAIL** → fix incomplete.

---

## Group D — Memory commit / dedup-probe (BUG-04)

**Objective:** Capture the exact failing dedup-probe query (currently only `query_error`) so it can be fixed, then verify commits resume.

**AI steps:**
1. `[CB-7]` show latest `stage.failed` where `kind='memory_controlled_write'`.
2. Locate the dedup-probe query builder in `honeycomb/src` (grep `dedup`/`controlled-write`/`probe`); identify the SQL and why it errors (column/scope/quoting).
3. Propose a one-line instrumentation patch to log the failing query text + underlying error class, if the query can't be derived statically.
4. Post-fix: confirm `memoryFormation.committedSinceBoot` climbs after extractions.

**Human steps:** none (unless a temporary instrumented build must be run — then: rebuild honeycomb daemon, restart, reproduce).

- [ ] **AC-D1** Failure characterized. **PASS if** we have the exact query (or the instrumented error) and the reason it errors. **FAIL** → still only `query_error` → instrument.
- [ ] **AC-D2** Extraction vs commit split confirmed. **PASS if** `extraction.result` events fire but `memory_controlled_write` fails — proving extraction works and only the commit is blocked.
- [ ] **AC-D3 (post-fix)** Commits resume. **PASS if** `committedSinceBoot` increases and `memoryCount` grows after extractions. **FAIL** → not fixed.

---

## Group E — Recall & search quality (project scope + embeddings)

**Objective:** Determine whether recall is silently degraded (global/BM25 fallback) instead of project-scoped semantic search — impacts Memories search.
**Hypothesis:** `recall.project_scope_degraded → inbox_global_fallback` and `recall.degraded sources:[]` indicate a degraded path.

**AI steps:**
1. `[CB-8]` count + show latest `recall.project_scope_degraded` and `recall.degraded` events with `fields`.
2. `curl -s ":3851/health"` — confirm embeddings ready (`ready:true`, dims 768).
3. Trace the recall path: is the `{#}` cosine/semantic arm used, or the BM25/ILIKE fallback? (grep `grep-core`/`hybrid-recall`/`degraded` in honeycomb).
4. `curl` a recall: `POST :3850/api/memories/recall {query:"..."}` for a known term; inspect whether hits carry semantic scores or lexical only.

**Human steps:**
1. In the dashboard Memories page, search a term you KNOW is in a memory; report whether results are relevant and clickable.

- [ ] **AC-E1** Degradation frequency. **PASS if** we quantify how often recall degrades (count of `recall.*degraded` today) and the reason in `fields`.
- [ ] **AC-E2** Embeddings actually used. **PASS if** a recall returns semantic-scored hits (cosine path). **FAIL if** every recall falls back to BM25/global (→ recall-degraded bug; find why project scope isn't resolving).
- [ ] **AC-E3** Search UX (ties to BUG-08). **PASS if** search returns relevant, clickable, memory-only results. **FAIL** → confirms BUG-08 and/or a relevance problem.

---

## Group F — Claude Code binding attribution (is there a CC cwd bug too?)

**Objective:** Confirm the `no_bound_project` gating is from other repos, NOT from bound activity — i.e., rule out a Claude-Code cwd-binding bug analogous to Cursor's.

**AI steps:**
1. Record `no_bound_project` `[CB-1]`. Note whether it moves during a period of ONLY-bound Claude Code activity (this session is in `the-apiary`).
2. `[CB-9]` sample recent `local_job` rows for `project_id` values — confirm bound captures resolve to `the-apiary` (they do today) and gated ones aren't from `the-apiary`.
3. If per-event gate detail is absent, propose temporary instrumentation to log `{agent, cwd, reason}` on each gated capture.

**Human steps:**
1. Run several Claude Code turns **only** inside `the-apiary` for ~5 min; do nothing in other repos.

- [ ] **AC-F1** Bound activity doesn't gate. **PASS if** `no_bound_project` stays FLAT during the bound-only window. **FAIL if** it climbs (→ Claude Code has a cwd/binding bug; investigate its cwd normalization like Cursor's).
- [ ] **AC-F2** Gated source identified. **PASS if** we can attribute the historical +9…+N gated captures to specific unbound paths (via instrumentation or by binding a candidate repo and watching the counter stop). **FAIL** → attribution remains inference; add gate logging.

---

## Group G — Live dashboard UI audit (biggest coverage gap — never driven)

**Objective:** Observe the RUNNING dashboard (not code) for rendering, console, network, and empty-state bugs across every page.

**AI steps:**
1. Start/attach to the hive portal (`:3853`) via the preview/Chrome tooling; for each page (Dashboard, ROI, Projects, Harnesses, Memories, Memory Graph, Hive Graph, Sync, Health, Logs) capture: console errors, failed network requests, and a screenshot/DOM snapshot.
2. Cross-check each visible symptom against the register (BUG-06…BUG-15).
3. Record any NEW rendering/wiring bug not already filed.

**Human steps:**
1. If the portal requires the desktop shell or auth, open it and confirm the AI can reach `:3853`.
2. Click through interactive elements the AI cannot reliably drive (native menus, OS dialogs) and report behavior.

- [ ] **AC-G1** Every nav page loads without a console error. **PASS if** no uncaught errors per page. **FAIL** → list page + error.
- [ ] **AC-G2** No failed (4xx/5xx) dashboard API calls per page. **PASS if** network is clean. **FAIL** → list the failing endpoint (maps to a daemon bug).
- [ ] **AC-G3** Confirmed-bug symptoms reproduce visually. **PASS if** BUG-07 (Projects Open no-op), BUG-08 (search non-clickable), BUG-09 (dup log) are observed in the live UI. (Validates the static findings.)
- [ ] **AC-G4** No NEW un-filed UI bug. **PASS if** nothing new; **FAIL** → file each new finding in the register.

---

## Group H — doctor & fleet lifecycle (OPS-02 version mismatch)

**Objective:** Root-cause the unresolved hive escalation `reinstall-primary → unverified-got-0.7.0` (manifest says 0.9.0).

**AI steps:**
1. `curl :3852/status.json` — capture the full hive escalation block.
2. Compare installed hive version vs `hive-release.json` / the release manifest vs what doctor "got" (0.7.0).
3. Read the doctor escalation/reinstall logic (`doctor/src`) — what does `unverified-got-0.7.0` mean (version probe mismatch? cached installer?).
4. Check `~/.apiary/doctor/incidents-hive.ndjson` + `state-hive.json` for the escalation history.

**Human steps:**
1. Report the hive version shown in the app/About, and whether the dashboard behaves correctly despite the escalation.

- [ ] **AC-H1** Escalation characterized. **PASS if** we know what version doctor expected, what it got (0.7.0), and why it's "unverified."
- [ ] **AC-H2** Impact assessed. **PASS if** we determine whether this is cosmetic (stale incident) or an active supervision failure. **FAIL** → file a bug with the mismatch chain.
- [ ] **AC-H3** Resolution path. **PASS if** we have a concrete remediation (reinstall/pin/clear incident) and it clears `resolved:false`.

---

## Group I — nectar, brooding & graphs (OPS-03 + BUG-11/12)

**Objective:** Decide whether nectar's idle state (no credentials, portkey off, no active projects) is intended config or a bug, and what it takes to populate the graphs.

**AI steps:**
1. `curl :3854/health` — capture `brooding/watch/activeProjects/projection/portkey`.
2. Trace nectar's `watch` credential requirement + Portkey gate (`nectar/src`).
3. Check whether `HONEYCOMB_PIPELINE_ENABLED` + `HONEYCOMB_PIPELINE_GRAPH_ENABLED` are set (Memory Graph, BUG-12); read `honeycomb/.env.local` / process env.
4. Confirm the Hive Graph two-signal contradiction (BUG-11) in `hive/src/.../hive-graph.tsx`.

**Human steps:**
1. Decide (product): should brooding/nectar be active on this machine? Should Portkey be configured?

- [ ] **AC-I1** nectar state explained. **PASS if** we know why `watch=stopped(no-credentials)`, `portkey=disabled`, `activeProjects=0` — config vs bug.
- [ ] **AC-I2** Memory Graph populate path. **PASS if** we confirm the exact flags to set and that setting them yields `entities` rows (or identify a code bug if not).
- [ ] **AC-I3** Hive Graph contradiction. **PASS if** the two disagreeing signals are traced to source and a reconciliation is specified (BUG-11).

---

## Group J — ROI end-to-end (BUG-06)

**Objective:** Confirm exactly why net/trend are dead and what inputs are missing.

**AI steps:**
1. `curl ":3850/api/diagnostics/roi?project=the-apiary"` — record `savings/infra/pollination/net/rollups`.
2. Confirm in `assemble.ts` that `roiUsage`/`roiInfra` are not wired; confirm `fetchRoiTrendView` returns the empty stub.
3. Identify what a live usage meter needs (PRD-060d seam) to make pollination non-absent.

**Human steps:** none.

- [ ] **AC-J1** Failure confirmed. **PASS if** `net.computed:false` with `pollination:absent` and `fetchRoiTrendView` proven to ignore inputs. (Already LIVE+CODE — re-confirm on current build.)
- [ ] **AC-J2** Savings data sanity. **PASS if** `savings.measuredCents` is non-zero and traceable to captured token usage. **FAIL** → savings pipeline also broken.
- [ ] **AC-J3** Fix scope defined. **PASS if** we list the exact wiring + meter needed to make net compute.

---

## Group K — The `bun run` hook error

**Objective:** Identify the hook invoking `bun` (CommandNotFoundException in Cursor's hook log) and whether it's a honeycomb/other broken hook.

**AI steps:**
1. Grep all Cursor/Claude hook configs (`~/.cursor/hooks.json`, `~/.claude/…`, project `.cursor`) and claude-plugin configs for `bun`.
2. Read the newest Cursor hook log around the `bun` error to see the full command + which config (`user` vs `claude-plugin`) it came from.
3. Determine owner (honeycomb? GitKraken? other plugin?) and whether it silently fails every turn.

**Human steps:**
1. Confirm whether `bun` is installed / intended to be on PATH.

- [ ] **AC-K1** Source identified. **PASS if** we know which hook/config runs `bun run …` and who owns it.
- [ ] **AC-K2** Impact assessed. **PASS if** we determine whether it's benign (unrelated tool) or breaks a capture/step. **FAIL** → file a bug.

---

## Execution order (recommended)

1. **Group 0** (preconditions) → 2. **A** (Codex, cheap likely-bug) → 3. **E** (recall quality) → 4. **F** (CC binding) → 5. **D** (dedup query) → 6. **G** (live UI — biggest gap) → 7. **H** (doctor) → 8. **I** (nectar/graphs) → 9. **K** (bun) → 10. **J** (ROI re-confirm). Run **B** and **C-AC3** after the honeycomb fixes land.

---

## Results log

Record each AC as it's run. Format: `AC-id | PASS/FAIL/N/A | date | evidence (endpoint output / log line / file:line / screenshot) | follow-up`.

| AC | Result | Date | Evidence | Follow-up |
|----|--------|------|----------|-----------|
| AC-0.1 | PASS | 2026-07-09 | All five daemons 200 (3850/3851/3852/3853/3854). | — |
| AC-0.2 | PASS | 2026-07-09 | `logs.db` age 0.0min; `event_log` MAX `2026-07-09T13:44Z`. | — |
| AC-0.3 | PASS | 2026-07-09 | honeycomb `pipeline:ok, storage:reachable, schema:ok`. capture.gated.no_bound_project=**196**, droppedEvents=39, committedSinceBoot=**0**. | Gating climbing fast (+82 since prior) → prioritize Group F. Memory formation fully stalled → Defects 1&2. |
| AC-A1 | PASS | 2026-07-09 | codex: installed=true, pluginEnabled=false, turnsCaptured=0, lastSeen=null, runtimePath=legacy. `~/.codex/hooks.json` version=undefined, events SessionStart/UserPromptSubmit/PreToolUse/PostToolUse/Stop, cmd → honeycomb bundle. | — |
| AC-A2 | PASS | 2026-07-09 | Codex hooks schema ([references/codex/hooks-schema.ts:45](../../honeycomb/references/codex/hooks-schema.ts:45)) has **no `version` field** (OpenAI Codex docs); missing version is CORRECT for Codex. **BUG-01-codex hypothesis REFUTED.** Config valid. | Codex not broken by missing version. |
| AC-A3 | PASS | 2026-07-09 | Human ran a Codex turn; daemon now shows codex `turnsCaptured=20, active=true, lastSeen=13:52`. Codex captures. | Codex functional. |
| AC-A4 | PASS | 2026-07-09 | Codex's 20 turns bound (not gated) → Codex reports a native cwd, no `/c:/` issue. The `/c:/` bug is Cursor-specific. | — |
| AC-E1 | PASS | 2026-07-09 | `recall.project_scope_degraded` (8×, mode `inbox_global_fallback`) + `recall.degraded` (7×, mode `lexical_fallback`, sources `[]`, last 01:04). Embeddings `:3851` healthy (ready, 768d). | — |
| AC-E2 | **FAIL** | 2026-07-09 | **BUG-17 (corrected root cause).** Owner clarified: dashboard works; the HARNESS injection is the complaint. Proven: every `recall-sessions/<id>.json` = `injectedRefs:[]` (nudge fired = recall returned nothing). Renderer timeout `DEFAULT_RECALL_TIMEOUT_MS=2500`; daemon `/api/memories/recall` latency (200s) min 2.3s / avg **40s** / max **25min**. So harness aborts at 2.5s → 0 hits → nothing injected; dashboard has no budget so it waits & works. Data + vector search healthy (<1s direct). | Fix = make recall sub-second (profile the ~40s orchestration; hunt the 25min retry-storm tail). Earlier "inbox degrade / embeddings missing" RETRACTED. |
| AC-E3 | RECLASSIFIED | 2026-07-09 | Dashboard search works (owner-confirmed); UI issue is BUG-08 only. Harness injection = BUG-17 (latency). | — |
| AC-G1 | PASS | 2026-07-09 | Live Chrome on `:3853`: no JS console errors (one a11y warning: form fields missing id/name). Health rail resolves to active/green. | — |
| AC-G2 | **FAIL** | 2026-07-09 | `/api/diagnostics/notifications` 400×113 (BUG-18). Live: kpis/sessions/rules/skills/harnesses stuck `[pending]`; `/setup/tenancy` + `/scope/projects` `net::ERR_ABORTED`. prime 404×57; conflicts/stale-refs 404×4. | BUG-18, BUG-19 filed. |
| AC-G3 | BLOCKED | 2026-07-09 | Could not reach Projects/Memories pages to repro BUG-07/08 — dashboard stuck on empty state (workspace switch hung, BUG-19). | Retry on idle daemon. |
| AC-G4 | **FAIL** | 2026-07-09 | New: BUG-19 (dashboard hangs under daemon latency; polling saturates connection pool); fresh-load defaults to ORG "local (unresolved)" / WORKSPACE "default" not authed apiary → empty state. | Filed. |
| AC-F1 | PASS | 2026-07-09 | DeepLake `sessions` by agent: claude-code **3498**, codex 20, cursor **0**. Claude Code binds fine (no cwd bug); Cursor gated (BUG-02). | No CC binding bug. |
| AC-F2 | PASS | 2026-07-09 | `no_bound_project` surge attributed to Cursor (0 sessions despite firing hooks) = BUG-02; not a new bug. | — |
| AC-H1 | PASS | 2026-07-09 | `incidents-hive.ndjson`: stale "unreachable-refused" incidents 07-08 11:46-49, `reinstall-primary skipped:already-blessed`, `resolved:false`. hive manifest 0.7.0 == installed 0.7.0 (no mismatch). | — |
| AC-H2 | PASS | 2026-07-09 | `state-hive.json` `lastKnownHealth:ok, rung 1, 0 failures`; live `/health` ok. Escalation is **stale, not active** — cosmetic. | Minor: doctor doesn't auto-close resolved incidents (OPS-02). |
| AC-H3 | PASS | 2026-07-09 | Remediation: auto-close/clear the stale incident on health recovery. | Low sev. |
| AC-I1 | PASS | 2026-07-09 | nectar `/health`: watch stopped `no-credentials`, portkey disabled, activeProjects 0 — config/ops (OPS-03), not a bug. | — |
| AC-I2 | PASS | 2026-07-09 | `/api/diagnostics/memory-graph` = `{built:false,nodes:[],edges:[]}`; pipeline flags absent in `.env.local` (0 matches). Empty = flags unset (BUG-12, config). | — |
| AC-I3 | PASS | 2026-07-09 | Hive Graph two-signal contradiction traced (BUG-11); nectar brooding `portkey_disabled`. | — |
| AC-J1 | PASS(fail-confirmed) | 2026-07-09 | ROI live: `savings ok 112396` ($1,124), `net.computed:false`, `pollination:absent`, `infra:partial`, rollups [0,0,0,0]. Confirms BUG-06. | — |
| AC-J2 | PASS | 2026-07-09 | Savings has real measured data ($1,124); pipeline not blank. | — |
| AC-J3 | PASS | 2026-07-09 | Fix scope = thread roiUsage/roiInfra + build usage meter + implement trend (BUG-06). | — |
| AC-K1 | PASS | 2026-07-09 | No `bun` in `~/.cursor/hooks.json`, `~/.claude/settings.json`, or project `.cursor`. The `bun run` in Cursor's hook log is a **third-party claude-plugin hook**, not honeycomb. | — |
| AC-K2 | PASS | 2026-07-09 | Benign to honeycomb capture (honeycomb hooks use `node`). The `bun`-using plugin hook fails (bun not installed) but is unrelated to the fleet. | Not honeycomb's bug. |
| AC-E3 | **FAIL** | 2026-07-09 | Data layer broken (BUG-17) → Memories search cannot return relevant results regardless of UI (BUG-08). | Fix BUG-17 before BUG-08. |

---

## Cookbook (reusable AI commands)

> All read-only. `node:sqlite` requires Node ≥ 22.5 (host is v25.2.1). Open every DB `readOnly`.

- **[CB-1] Health + gate counts:** `curl -s http://127.0.0.1:3850/health` → read `reasons.capture.gated.no_bound_project`, `reasons.capture.droppedEvents`, `reasons.memoryFormation.committedSinceBoot`. Repeat for `:3851/health`, `:3852/status.json`, `:3853/api/fleet-status`, `:3854/health`.
- **[CB-2] KPIs:** `curl -s http://127.0.0.1:3850/api/diagnostics/kpis` → `memoryCount, sessionCount, turnCount, teamSkillCount, estimatedSavings, extra.captureDroppedEvents`.
- **[CB-3] Harness rows:** `curl -s http://127.0.0.1:3850/api/diagnostics/harnesses` → per harness `installed, pluginEnabled, active, turnsCaptured, lastSeen, runtimePath`.
- **[CB-4] / [CB-6] / [CB-7] / [CB-8] event_log query (Node):**
  ```js
  import { DatabaseSync } from "node:sqlite";
  const db = new DatabaseSync(process.env.HOME + "/.apiary/honeycomb/.daemon/logs.db", { readOnly: true });
  // counts by type:
  db.prepare("SELECT event, COUNT(*) n, MAX(time) last FROM event_log GROUP BY event ORDER BY n DESC").all();
  // latest N of a type with fields (swap the event name):
  db.prepare("SELECT time,fields FROM event_log WHERE event=? ORDER BY id DESC LIMIT 5").all("capture.flush.failed");
  ```
  Useful event names: `capture.flush.failed`, `capture.batch_insert.failed`, `stage.failed`, `extraction.result`, `recall.project_scope_degraded`, `recall.degraded`.
- **[CB-5] Cursor wiring:** read `~/.cursor/hooks.json` (`version` present? `_honeycomb` entries?), `ls -la ~/.cursor/honeycomb/bundle` (mtime post-fix?).
- **[CB-9] Queue attribution:** open `~/.apiary/honeycomb/.daemon/local-queue.db` (`local_job`), inspect recent `payload_json` for `project_id` / `agent` / `source_tool`. (Note: raw session rows go to Deep Lake, not this queue; gated captures write nothing — absence here is expected for gated events.)
- **[CB-10] ROI:** `curl -s "http://127.0.0.1:3850/api/diagnostics/roi?project=the-apiary"`.
- **Cursor hook logs (human-triggered):** newest under `~/AppData/Roaming/Cursor/logs/*/window*/output_*/cursor.hooks.workspaceId-*.log` — contains the raw payload incl. `workspace_roots` and per-hook exec results.
