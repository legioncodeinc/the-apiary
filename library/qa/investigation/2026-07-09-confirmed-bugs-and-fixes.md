# The Apiary — Confirmed Bugs & Fixes Register

**Date:** 2026-07-09
**Source:** The dashboard QA investigation (six area reports + [live-verification addendum](2026-07-08-live-verification-addendum.md)), with every "live-verified" item confirmed by querying the running fleet daemons and the live log DB, and every "code-grounded" item traced to `file:line`.
**Status legend:** 🔴 open · 🟡 stopgap applied (permanent fix pending) · 🟢 fixed · ⚪ config/ops (no code change)
**Verification legend:** **LIVE** = confirmed against running daemon/logs · **CODE** = traced to source · **PROVEN** = reproduced in isolation

This register is the actionable companion to the narrative reports. Each entry is self-contained: symptom → root cause (file:line) → evidence → fix → how to verify.

---

## Severity summary

| ID | Title | Component | Sev | Status | Confidence |
|----|-------|-----------|-----|--------|------------|
| [BUG-01](#bug-01) | Cursor `hooks.json` written without required numeric `version` | honeycomb | Critical | 🟡 stopgap | LIVE+CODE+PROVEN |
| [BUG-02](#bug-02) | Cursor `/c:/…` `workspace_roots` not normalized → captures gated | honeycomb | Critical | 🔴 open | LIVE+CODE+PROVEN |
| [BUG-03](#bug-03) | Variable-width batch INSERT drops captures (`15 != 19`) | honeycomb | Critical | 🟢 fixed (PR #291) | LIVE+CODE |
| [BUG-04](#bug-04) | `memory_controlled_write` dedup probe `query_error` | honeycomb | High | 🔴 open | LIVE |
| [BUG-17](#bug-17) | **Harness memory injection dead** — recall ~40s avg vs 2.5s per-turn budget (dashboard OK; corpus healthy) | honeycomb | **Critical** | 🟢 fixed (PR #281 + #283) | LIVE+PROVEN |
| [BUG-05](#bug-05) | Skills/Sync hardcode Claude layout; miss Codex/Cursor + home dir | honeycomb | High | 🔴 open | CODE |
| [BUG-06](#bug-06) | ROI net can't compute; trend is a hardcoded stub | honeycomb | High | 🔴 open | LIVE+CODE |
| [BUG-07](#bug-07) | Projects "Open" is a silent no-op | hive | High | 🔴 open | CODE |
| [BUG-08](#bug-08) | Memories search yields non-clickable sessions+memories | hive | High | 🔴 open | CODE |
| [BUG-09](#bug-09) | Duplicate live log on dashboard | hive | Med | 🔴 open | CODE |
| [BUG-10](#bug-10) | Remove Sessions panel (KEEP Turns KPI) | hive | Med | 🔴 open | CODE |
| [BUG-11](#bug-11) | Hive Graph "brooding enabled" vs "not wired" contradiction | hive/nectar | Med | 🔴 open | LIVE+CODE |
| [BUG-12](#bug-12) | Memory Graph empty (pipeline flags unset) | honeycomb | Med | ⚪ config | LIVE+CODE |
| [BUG-13](#bug-13) | Code Graph inert in search; orphaned dashboard UI | honeycomb/hive | Low | 🔴 decision | CODE |
| [BUG-14](#bug-14) | "plugin" label + `pluginEnabled` misleading for Cursor | honeycomb/hive | Low | 🔴 open | CODE |
| [BUG-15](#bug-15) | "Compact" mislabeled (reaps version history, not memories) | hive | Low | 🔴 open | CODE |
| [BUG-16](#bug-16) | Plaintext Deep Lake JWT + Anthropic key in `.env.local` | honeycomb | High (sec) | 🔴 open | LIVE |
| [BUG-18](#bug-18) | Dashboard **Notifications endpoint 400s on 100% of calls** (org-scope resolution mismatch) | honeycomb/hive | Med | 🔴 open | LIVE |
| [BUG-19](#bug-19) | Dashboard **hangs under daemon latency** — data calls never resolve, workspace switch stuck; aggressive polling saturates the browser connection pool | hive | High | 🔴 open | LIVE (load caveat) |
| [OPS-01](#ops-01) | Orphaned `~/.daemon` + repo `.daemon` (frozen 07-05) | fleet | — | 🔴 cleanup | LIVE |
| [OPS-02](#ops-02) | doctor unresolved hive escalation (`unverified-got-0.7.0`) | doctor/hive | — | 🔴 open | LIVE |
| [OPS-03](#ops-03) | nectar idle: brooding off, watch stopped (`no-credentials`) | nectar | — | ⚪ ops | LIVE |

---

## Cursor capture (the "installed but not reporting" chain)

<a id="bug-01"></a>
### BUG-01 — Cursor `hooks.json` written without a numeric `version` 🟡
**Component:** honeycomb · **Severity:** Critical · **Confidence:** LIVE + CODE + PROVEN

- **Symptom:** Cursor shows a "Configuration Errors" banner: *"Invalid user config: Config version must be a number."* No honeycomb hook fires.
- **Root cause:** honeycomb's Cursor connector writes `~/.cursor/hooks.json` as `{ "hooks": {…} }` with **no top-level `version`**, and its own contract schema marks it optional — [`references/cursor/hooks-schema.ts:118`](../../honeycomb/references/cursor/hooks-schema.ts:118) `version: z.number().optional()`. Real Cursor 1.7+/3.9.16 **requires** a numeric `version` and rejects the whole config, disabling every hook.
- **Evidence:** Cursor's Configuration Errors panel (operator screenshot); the on-disk `~/.cursor/hooks.json` lacked `version`.
- **Fix:** (1) Cursor connector ([`src/connectors/cursor.ts`](../../honeycomb/src/connectors/cursor.ts)) must emit `"version": 1` at the top of `hooks.json`. (2) Make the schema required (`version: z.number()`). (3) Regression test asserting the written file carries a numeric `version`.
- **Stopgap applied 2026-07-08:** `"version": 1` added to the live `~/.cursor/hooks.json`. **Confirmed working** — Cursor's hook log then showed `beforeSubmitPromptHook`/`postToolUse` spans executing honeycomb's `capture.js`. Will be overwritten on the next `honeycomb setup` until the connector fix lands.
- **Verify:** after the connector fix + `honeycomb setup`, `~/.cursor/hooks.json` contains `"version": 1` and Cursor shows no config error.

<a id="bug-02"></a>
### BUG-02 — Cursor's `/c:/…` `workspace_roots` is never normalized → captures gated 🔴
**Component:** honeycomb · **Severity:** Critical · **Confidence:** LIVE + CODE + PROVEN

- **Symptom:** With BUG-01 stopgapped, Cursor's hooks fire, but `turnsCaptured` stays **0** and captures are gated `no_bound_project` even though Cursor is open on the bound folder.
- **Root cause:** Cursor v3.9.16 sends `"workspace_roots": ["/c:/Users/mario/GitHub/the-apiary"]` — a POSIX-style path (leading slash, lowercase drive). The Cursor shim uses `workspace_roots[0]` **verbatim** as cwd ([`src/hooks/cursor/shim.ts:69-71`](../../honeycomb/src/hooks/cursor/shim.ts:69)); `normalizePath` → `path.win32.resolve("/c:/…")` → **`C:\c:\Users\mario\GitHub\the-apiary`**, which does not match the binding `C:\Users\mario\GitHub\the-apiary`. `bound:false` → `no_bound_project` gate ([`capture-handler.ts:672`](../../honeycomb/src/daemon/runtime/capture/capture-handler.ts:672)) → capture dropped. A secondary drive-letter-case mismatch also applies (`c:` vs `C:`; the prefix match is case-sensitive, [`project-resolver.ts:535`](../../honeycomb/src/hooks/shared/project-resolver.ts:535)).
- **Evidence (LIVE):** raw payload from Cursor's own hook log (`~/AppData/Roaming/Cursor/logs/…/cursor.hooks.*.log`): `"cursor_version":"3.9.16","workspace_roots":["/c:/Users/mario/GitHub/the-apiary"]`.
- **Evidence (PROVEN):** `path.win32.resolve("/c:/Users/mario/GitHub/the-apiary")` = `C:\c:\Users\mario\GitHub\the-apiary` (no match). Stripping the leading `/` before `<drive>:/` and uppercasing the drive → `C:\Users\mario\GitHub\the-apiary` (matches).
- **Fix:** in `cursorDeriveMeta` ([`shim.ts:68`](../../honeycomb/src/hooks/cursor/shim.ts:68)) or centrally in `normalizePath` ([`project-resolver.ts:515`](../../honeycomb/src/hooks/shared/project-resolver.ts:515)): convert a leading-slash drive path (`/c:/…` → `c:/…`) before resolve, and make the drive-letter/prefix comparison case-insensitive on Windows. Add a Windows unit test: `workspace_roots:["/c:/…"]` under a bound path asserts `bound:true`.
- **Verify:** after fix + bundle rebuild + reinstall, run one Cursor Agent turn in a bound repo → `GET :3850/api/diagnostics/harnesses` shows `cursor.turnsCaptured > 0` and `no_bound_project` stops climbing for Cursor turns.

---

## Memory formation (the "stuck at 2,107" chain)

<a id="bug-03"></a>
### BUG-03 — Variable-width batched INSERT drops captures (`row column count 15 != expected 19`) 🟢
**Component:** honeycomb · **Severity:** Critical · **Confidence:** LIVE + CODE

- **Symptom:** Memory/session count effectively frozen (2,107 → 2,108 all day); `capture.flush.failed` / `capture.batch_insert.failed` firing live (incl. for the active Claude Code session).
- **Root cause:** `buildRow` emits a **15-column base** then appends **0–4 optional usage columns** via `usageColumns` — `[]` for user/tool turns, and each of `input_tokens`/`output_tokens`/`cache_read_input_tokens`/`cache_creation_input_tokens` only when present ([`capture-handler.ts:571-615,826`](../../honeycomb/src/daemon/runtime/capture/capture-handler.ts:826)). So a row is **15–19 columns**. The batched flush ([`capture-handler.ts:495`](../../honeycomb/src/daemon/runtime/capture/capture-handler.ts:495) → `groupRowsByScope` → `appendOnlyInsertMany`) hands mixed-width rows to `buildInsertMany`, which takes the first row as the header and **rejects the whole batch** on any width mismatch ([`writes.ts:147-150`](../../honeycomb/src/daemon/storage/writes.ts:147)). The single-row path survives; only the multi-row flush fails — hence the slow creep instead of proper growth.
- **Evidence (LIVE):** `event_log`: `capture.flush.failed {"reason":"buildInsertMany: row column count 15 != expected 19"}` (70×), `capture.batch_insert.failed` (29×), latest firing minutes before capture, session id matching the active transcript.
- **Fix:** make the batched INSERT tolerate heterogeneous rows — **(a)** pad every row to the full sessions column set (write explicit NULL/DEFAULT for absent usage columns → all rows 19-wide), or **(b)** sub-group the flush by column shape and emit one `buildInsertMany` per shape. Option (a) is simpler and matches the nullable-usage-column schema. Add a regression test that flushes a mixed batch (user turn + assistant-with-usage turn) in one scope group.
- **Verify:** after fix, `capture.flush.failed` with the `15 != 19` reason stops appearing in `event_log`; `sessionCount` and `memoryCount` grow normally.
- **FIXED 2026-07-11 (PR #291, honeycomb):** took option **(b)** — `groupBufferedRows` (`capture-handler.ts`) now sub-groups each scope by **column signature** (the ordered column-name list) so every `appendOnlyInsertMany` is uniform; absent-usage rows group together and keep those columns omitted (→ SQL NULL, preserving PRD-060a a-AC-6), while same-shape same-scope turns still coalesce into one write. This mirrors the scope+signature grouping PRD-079c added for the outbox drain, applied to the PRIMARY flush. `flushBatch` also hardened to continue-then-throw (a per-group failure defers that group to the durable outbox, PRD-079a, without stranding the others). Regression tests: a mixed user + assistant-with-usage window flushes as two uniform appends (both persisted, no drop); same-shape rows still coalesce into one. Note: since PR #287 the failed batch was already caught by the durable outbox rather than lost — this fixes the root so the primary flush succeeds instead of failing-then-recovering.

<a id="bug-04"></a>
### BUG-04 — `memory_controlled_write` dedup probe fails with `query_error` 🔴
**Component:** honeycomb · **Severity:** High · **Confidence:** LIVE

- **Symptom:** Even when extraction succeeds, distilled memories don't commit; `memoryCount` flat.
- **Root cause:** the `memory_controlled_write` stage's dedup probe query errors and is retried 5× then dropped. Extraction itself runs fine (`extraction.result` firing with facts/entities).
- **Evidence (LIVE):** `event_log`: `stage.failed {"kind":"memory_controlled_write","attempt":5,"reason":"controlled-write dedup probe failed: query_error"}` (505×).
- **Fix:** capture the exact failing query first (the log fields only say `query_error`) — add the query text / underlying error to the event, then fix the dedup-probe query. Likely related to scope/column mismatch on the `memories` table probe.
- **Verify:** `stage.failed` for `memory_controlled_write` stops; `memoryFormation.committedSinceBoot` climbs after extractions.

---

<a id="bug-17"></a>
### BUG-17 — Harness memory injection is dead: recall latency (avg ~40s) far exceeds the 2.5s per-turn budget 🟢
**Component:** honeycomb · **Severity:** Critical · **Confidence:** LIVE + PROVEN

- **Symptom (the owner's actual complaint):** memory recall *into the agent/harness session* "feels useless" — nothing useful is injected. The **dashboard Memories search works** (it is project-scoped and returns memories); the **harness injection path** is what's dead.
- **Evidence (LIVE, 2026-07-09):**
  - Every harness recall-session record injects nothing: `~/.honeycomb/recall-sessions/<id>.json` = `{ injectedRefs: [], turns: 21, lastNudgeTurn: 21 }` — and every recent session file is the same empty 47-byte shape. `lastNudgeTurn == turns` means the "recall returned nothing → nudge" branch fired ([`user-prompt-recall.ts:122-126`](../../honeycomb/src/hooks/shared/user-prompt-recall.ts:122)).
  - The per-turn recall renderer aborts at **`DEFAULT_RECALL_TIMEOUT_MS = 2_500`** (2.5s) ([`recall-renderer.ts:55`](../../honeycomb/src/hooks/shared/recall-renderer.ts:55)).
  - The daemon recall is pathologically slow: `request_log` `/api/memories/recall` (status 200, n=123) → **min 2,299ms, avg 40,343ms (~40s), max 1,539,771ms (25 min)**. So the renderer's 2.5s budget is blown virtually every turn → the fetch aborts → 0 hits → nudge → `injectedRefs:[]`.
- **ROOT CAUSE:** recall latency (~40s avg) >> the per-turn injection budget (2.5s), so the harness aborts before recall answers and injects nothing. The **dashboard has no 2.5s budget** — it waits out the 10–40s and shows results, which is why it "works." One slow recall, two outcomes — exactly the owner's report.
- **PROFILE (measured 2026-07-09, each component timed directly):**
  - Embed a query (`:3851/embed`): **13ms** — negligible.
  - A *single* Deep Lake query: **~1.3–1.8s** each (server exec ~30ms; the rest is **remote round-trip to `api.deeplake.ai`** — the workspace is cloud-hosted). This ~1.5s is the floor cost of *every* round-trip.
  - Per-arm timings: memories `<#>` 1,776ms · sessions `<#>` 1,473ms (only **18** rows carry `message_embedding`) · memory `<#>` 1,558ms (**0** rows) · memories ILIKE 1,269ms · sessions ILIKE 1,552ms.
  - **Root of the ~40s = chattiness × cloud latency × contention.** One recall makes **~10–15 sequential-ish round-trips**: 4 tables × (vectorSearch-for-ids **+** a separate hydrate query [recall.ts:1089] = 2 per semantic arm) + lexical arms + the dedup embedding fetch + lifecycle stages — each ~1.5s. Arms parallelize (`Promise.all`) but through a **process-wide `Semaphore(6)` shared across ALL concurrent recalls** ([recall.ts:115-122](../../honeycomb/src/daemon/runtime/memories/recall.ts:115)). On a quiet box that's ~5–8s; under real load (dashboard polling + a recall on **every** harness turn) the shared 6-slot pool saturates → queueing → **~40s avg**. The **25-min max** is that backlog compounded by the 429/5xx transient-retry layer (`RETRY_ATTEMPTS=4`, backoff ≤1s — bounded per query, but N queued queries each retrying stacks up).
  - **Wasted work:** it queries `memory.summary_embedding` (0 embedded rows) and `sessions.message_embedding` (only 18) on every recall, and does IDs-then-hydrate as **two** round-trips per semantic arm when the vector query could return content in one.
- **Highest-leverage fix — collapse recall to ~1 round-trip:** a single project-scoped hybrid query (native `deeplake_hybrid_record` BM25+vector) that **returns content directly** (no IDs-then-hydrate), skips empty-embedding tables, and skips dedup/rerank/lifecycle on the **per-turn** path. That takes recall from ~40s to ~1.5s — under the 2.5s budget. Secondary: give per-turn harness recall its own concurrency lane so it isn't starved by the shared pool.
- **`prime` (session-start digest) is also unhealthy:** `/api/memories/prime` avg 4,864ms (budget 5s → routinely on the edge), max 96,304ms, and **404 fifty-seven times** — the once-per-session blind digest frequently fails too.
- **The data + vector search are HEALTHY (not the problem):** direct Deep Lake — `memories` total 2,108, embedded 2,002 (distinct 768-dim vectors), `project_id` the-apiary:2,107 / __unsorted__:1; honeycomb's own `<#>` SQL returns distinct, relevant hits (0.81–0.85) in <1s.
- **RETRACTED:** earlier framings that "the dashboard degrades to the `__unsorted__` inbox" and "only ~1 memory is embedded" were **synthetic-request / hypothesis artifacts and are wrong** — the dashboard is project-scoped and works; embeddings are present. (The inbox fallback for a cwd-less caller and the non-tokenized lexical arm are real *secondary* issues, but not the harness-injection cause.)
- **Fix:** profile and drive recall to **sub-second** (fewer arms / parallelize instead of `Semaphore(6)` serialize, pass the query vector out-of-band rather than a giant inline literal, skip the dedup embedding refetch, cap over-fetch), and hunt the 25-minute tail (retry storm). The 2.5s per-turn budget is reasonable — recall must be fast enough to meet it. Then injection works.
- **Impact:** the entire memory-injection value prop is inert in every harness session despite a healthy, well-embedded corpus. Highest-impact functional bug found.
- **FIXED 2026-07-10/11 (PR #281 + #283, honeycomb):** two stacked PRDs. **PRD-077** (#281) added a dedicated single-round-trip `recallFast` hot lane — a read/write `StorageClient` split (recall no longer starved by capture writes / dashboard polls) + a server-side deadline race so per-turn recall is BOUNDED (`armsMs` dropped 73,273 → ~3,012ms) and fail-soft instead of hanging. That made recall bounded but it still returned 0 hits, because the `<#>` semantic scan is a ~2.6s brute-force full-column scan (Deeplake has no vector index) that overran the ~3s budget. **PRD-078** (#283) closed that with an in-daemon **local ANN index** (`InMemoryLocalVectorIndex`, cold-built on boot, content inline): the `memories` semantic arm answers from RAM (flat cosine, sub-100ms, cloud-independent) with the `<#>` SQL as fail-soft fallback, preserving the verbatim `((1+cos)/2)` norm + 049b project scope so RRF/recency are byte-identical. Dogfooded live: the local index returns the identical top-5 ranking to Deeplake's `<#>`, sub-100ms, and produced the **first real non-empty per-turn injection** of the session (`injectedRefs` non-empty). Related follow-ups shipped after: **PRD-079 a/b/c** (durable capture outbox + dead-letter/caps, PRs #287/#289) so the corpus is complete despite Deeplake degraded-window write drops, and **PR #285** home-anchored the memory-pipeline local queue. Still open as separate items: the `prime` session-start digest health, index freshness/eviction (078b/c), and the `sessions.message_embedding` arm.

## Skills / Sync / harness surface

<a id="bug-05"></a>
### BUG-05 — Skills/Sync hardcode Claude's layout; miss Codex/Cursor assets and the home dir 🔴
**Component:** honeycomb · **Severity:** High · **Confidence:** CODE

- **Symptom:** Skills page doesn't show `.cursor`/`.codex` assets; Sync only reflects `.claude`.
- **Root cause:** `scanInstalledAssets` loops all six harnesses but hardcodes Claude's `skills/<name>/SKILL.md` + `agents/*.md` layout for every one ([`installed-assets.ts:68-75`](../../honeycomb/src/daemon/runtime/dashboard/installed-assets.ts:68)), so Codex `.toml` agents (86 on disk) and Cursor's `skills-cursor/` are invisible; enable/pull always writes back to `.claude` ([`asset-install-target.ts:33-36`](../../honeycomb/src/daemon/runtime/dashboard/asset-install-target.ts:33)). It also scans with `includeGlobal:false` and the daemon `cwd`, so home-dir assets (`~/.claude`, `~/.cursor`, `~/.codex`) and the selected project are never scanned.
- **Fix:** per-harness layout descriptors (reuse the connectors' real paths); scan `includeGlobal:true` for a local-vs-home split; scan the selected project, not `cwd`; add per-IDE tabs on the Sync page. See [sync-page report](2026-07-08-sync-page-investigation.md) and [harness-detection report](2026-07-08-harness-detection-investigation.md).
- **Verify:** Skills/Sync show Codex `.toml` agents, Cursor `skills-cursor/`, and both local + home assets.

---

## ROI

<a id="bug-06"></a>
### BUG-06 — ROI net hero can't compute; trend chart is a hardcoded stub 🔴
**Component:** honeycomb · **Severity:** High · **Confidence:** LIVE + CODE

- **Symptom:** ROI page reads "completely not functional"; net + trend blank.
- **Root cause:** the daemon composition root mounts the dashboard **without `roiUsage`** (and `roiInfra`), so pollination falls back to `emptyUsageSource` → `pollination:absent` → `net.computed:false` ([`assemble.ts:1315-1320`](../../honeycomb/src/daemon/runtime/assemble.ts:1315)); **no live usage meter exists** (PRD-060d seam never implemented). `fetchRoiTrendView` ignores inputs and always returns `EMPTY_ROI_TREND` ([`api.ts:1039-1051`](../../honeycomb/src/daemon/runtime/dashboard/api.ts:1039)).
- **Evidence (LIVE):** `GET :3850/api/diagnostics/roi` → `savings.measuredCents:90947` ($909, real data), `pollination.status:"absent"`, `net.computed:false`, all rollups empty.
- **Fix:** thread `roiUsage` + `roiInfra` into `assemble.ts`; build the live Haiku usage meter; implement `fetchRoiTrendView`; verify billing entitlement. See [ROI report](2026-07-08-roi-investigation.md).
- **Verify:** net computes; trend chart populates; rollups non-empty.
- **Architecture note:** ROI is served by **honeycomb**, not nectar (nectar has zero ROI code). Confirmed via [`daemon-routing.ts:11-15`](../../hive/src/shared/daemon-routing.ts:11).

---

## Dashboard / Projects / Memories UX (hive)

<a id="bug-07"></a>
### BUG-07 — Projects "Open" is a silent no-op 🔴
**Component:** hive · **Severity:** High · **Confidence:** CODE
- **Root cause:** `onOpen` ([`projects.tsx:582-587`](../../hive/src/dashboard/web/pages/projects.tsx:582)) only calls `setScope(...)` — no navigation, no detail view; no `/projects/:id` route exists in `registry.tsx`; rows are inert `<div>`s (only Open + Unbind are interactive).
- **Fix:** add a project detail route/view and wire "Open" to it; make rows clickable.

<a id="bug-08"></a>
### BUG-08 — Memories search returns a non-clickable sessions+memories surface 🔴
**Component:** hive · **Severity:** High · **Confidence:** CODE
- **Root cause:** browse renders clickable `MemoryRow` → `openDetail` (Edit/Forget); search swaps to the presentational `MemoryCard` div ([`memories.tsx:817-826`](../../hive/src/dashboard/web/pages/memories.tsx:817)) fed by the fused `recall` endpoint returning both `kind:"memory"` and `kind:"session"` ([`wire.ts:495-514`](../../hive/src/dashboard/web/wire.ts:495)).
- **Fix:** filter search hits to `kind==="memory"` and render clickable rows into `openDetail`; keep Edit/Forget on search results.

<a id="bug-09"></a>
### BUG-09 — Duplicate live log on the dashboard 🔴
**Component:** hive · **Severity:** Med · **Confidence:** CODE
- **Root cause:** a `<LiveLog>` is embedded in the harness strip ([`harness-strip.tsx:133`](../../hive/src/dashboard/web/harness-strip.tsx:133)) in addition to the bottom feed ([`dashboard.tsx:335`](../../hive/src/dashboard/web/pages/dashboard.tsx:335)).
- **Fix:** remove the top `<LiveLog>` (and its `streamLines` plumbing); keep the bottom one.

<a id="bug-10"></a>
### BUG-10 — Remove the Sessions panel; KEEP the Turns KPI 🔴
**Component:** hive · **Severity:** Med · **Confidence:** CODE
- **Owner correction:** the Turns KPI ([`dashboard.tsx:273`](../../hive/src/dashboard/web/pages/dashboard.tsx:273)) **stays**. Remove the `SessionsPanel` in the 2-col grid ([`dashboard.tsx:319-332`](../../hive/src/dashboard/web/pages/dashboard.tsx:319)) — that is the "data vomit." See the [dashboard-ux report](2026-07-08-dashboard-ux-investigation.md) for the full redesign recommendation (status board + launchpad; Net-ROI sparkline is near-free via existing `RoiChart` + `wire.roiTrend`).

---

## Graphs

<a id="bug-11"></a>
### BUG-11 — Hive Graph shows "brooding enabled" above "brood pipeline not wired" 🔴
**Component:** hive / nectar · **Severity:** Med · **Confidence:** LIVE + CODE
- **Root cause:** two independent signals never reconciled — the badge reads nectar's per-project brooding **toggle** (`effectiveBrooding`, [`nectar active-projects.ts:163`](../../nectar/src/…/active-projects.ts:163)), while "not wired" is the build endpoint's **501 capability** check requiring Portkey ([`nectar hive-graph-api.ts:254`](../../nectar/src/…/hive-graph-api.ts:254)).
- **Evidence (LIVE):** `GET :3854/health` → `brooding.active:false, reason:"portkey_disabled"`, `portkey.enabled:false`.
- **Fix:** reconcile the two in `hive-graph.tsx` (show capability state, not just toggle intent).

<a id="bug-12"></a>
### BUG-12 — Memory Graph empty (pipeline flags unset) ⚪
**Component:** honeycomb · **Severity:** Med · **Confidence:** LIVE + CODE
- **Root cause:** the graph is fully implemented ([`graph.tsx`], backend [`api.ts:525-547`](../../honeycomb/src/daemon/runtime/dashboard/api.ts:525) reading `entities`/`entity_dependencies`); the ontology tables have no rows because the `memory_graph_persist` pipeline flags (`HONEYCOMB_PIPELINE_ENABLED` + `HONEYCOMB_PIPELINE_GRAPH_ENABLED`) aren't set. Not a code bug.
- **Fix:** set the flags if the graph should populate.

<a id="bug-13"></a>
### BUG-13 — Code Graph is inert in search; dashboard viewer orphaned 🔴 (decision)
**Component:** honeycomb / hive · **Severity:** Low · **Confidence:** CODE
- **Finding:** the tree-sitter code graph still rebuilds on a timer ([`runtime/codebase/`], [`assemble.ts:3410-3441`](../../honeycomb/src/daemon/runtime/assemble.ts:3410)) but in search is only a staleness oracle with posture `observe`, exponent `s=0` ([`lifecycle-config.ts:337`](../../honeycomb/src/daemon/runtime/…/lifecycle-config.ts:337)) — it never changes ranking by default. Its dashboard viewer was removed in PRD-041, leaving `GraphCanvas`/`BuildGraphButton`/`wire.graph()` orphaned.
- **Decision needed:** activate (`execute` posture) so it earns its keep, or keep observe-only and delete the orphaned UI + fix stale docs.

---

## Labels / minor

<a id="bug-14"></a>
### BUG-14 — "plugin" label + `pluginEnabled` are misleading for Cursor 🔴
**Component:** honeycomb / hive · **Severity:** Low · **Confidence:** CODE
- **Root cause:** the registry marks Cursor `runtimePath:"plugin (extension)"` ([`harness-registry.ts:107`](../../honeycomb/src/daemon/runtime/dashboard/harness-registry.ts:107)) and an extension source exists at `harnesses/cursor/extension/`, but honeycomb **does not install a Cursor extension** — capture is via `hooks.json` + `~/.cursor/honeycomb/bundle/`. `pluginEnabled` is a Claude-only signal (`claude plugin list`, [`harness-plugin-status.ts`](../../honeycomb/src/daemon/runtime/dashboard/harness-plugin-status.ts)) and defaults `false` for Cursor.
- **Fix:** don't surface "plugin"/`pluginEnabled` for Cursor; show the real hooks-wired state.

<a id="bug-15"></a>
### BUG-15 — "Compact" is mislabeled 🔴
**Component:** hive · **Severity:** Low · **Confidence:** CODE
- **Root cause:** Compact is wired (`memories.tsx` → `POST /api/diagnostics/compact`) but reaps **version history** of version-bumped tables (skills/rules), not the `memories` corpus — clicking it never changes the memory count.
- **Fix:** relabel to set the right expectation.

---

## Dashboard live-UI audit (Group G)

<a id="bug-18"></a>
### BUG-18 — Dashboard Notifications endpoint 400s on every call 🔴
**Component:** honeycomb / hive · **Severity:** Med · **Confidence:** LIVE
- **Symptom:** the dashboard Notifications feature never loads.
- **Evidence (LIVE):** `request_log` — `/api/diagnostics/notifications` = **400 ×113, 200 ×0** (100% failure) today. Direct probe: no org header → `400 {"error":"bad_request","reason":"request carries no resolvable org scope"}`; **with** `x-honeycomb-org` → succeeds. Sibling endpoints on the same group (`/kpis`, `/harnesses`) return 200 header-less because they fall back to the **local-mode default scope** ([`resolveScopeOrLocalDefault`, api.ts:1092-1116](../../honeycomb/src/daemon/runtime/dashboard/api.ts:1092)).
- **Root cause:** the notifications handler uses a **stricter (header-only) org resolution** than its siblings — it does not apply the local-default fallback — while the dashboard's notifications poll doesn't attach `x-honeycomb-org`. Mismatch → permanent 400.
- **Fix:** route notifications through the same `resolveScopeOrLocalDefault` the other diagnostics handlers use (preferred — one consistent scope path), **or** have the hive notifications client send the org header like its other calls.
- **Other endpoint health (Group G / AC-G2):** `/api/memories/prime` 404 ×57 (session-start digest — ties to BUG-17); `/api/memories/conflicts` & `/stale-refs` 404 ×4 each (lifecycle endpoints not mounted — dormant engines, likely by design; confirm). All other dashboard APIs (`/kpis`, `/harnesses` ×1217, `/roi`, `/skills`, `/rules`, `/sessions`, `/memory-graph`, `/scope/*`, `/logs` ×2378, `/auth/status`, `/setup/*`) are healthy 200.

<a id="bug-19"></a>
### BUG-19 — Dashboard hangs under daemon latency; aggressive polling saturates the browser connection pool 🔴
**Component:** hive · **Severity:** High · **Confidence:** LIVE (with a load caveat — see below)
- **Symptom (observed live in Chrome against `:3853`):** on load the dashboard's one-shot data calls — `/api/diagnostics/kpis`, `sessions`, `rules`, `skills`, `harnesses` — stayed **`[pending]` indefinitely**; `/setup/tenancy` and `/api/diagnostics/scope/projects` returned **`net::ERR_ABORTED`**; selecting the `apiary` workspace got **stuck on "switching workspace…"** and never completed; the dashboard stayed on the empty **"No active projects? Pick a folder to start"** state.
- **Mechanism:** the SPA re-polls **`/health`, `/api/diagnostics/harnesses`, `/api/hive-graph/status`, `/api/logs?limit=8` every ~1–2s**; each is a slow daemon call (harnesses/kpis are DeepLake `COUNT`s ≈1.5s; recall/others far worse per BUG-17). A browser caps ~6 concurrent connections per origin, so the fast-cadence polls **saturate the pool and starve the one-shot data/scope calls**, which never get a socket → permanent pending → the dashboard never populates and the workspace switch can't finish.
- **⚠️ Load caveat:** during this audit the daemon was under heavy load from the investigation's own DeepLake probing, which aggravates the pending pile-up. The owner reports the dashboard normally populates — so this is a **fragility that bites whenever the daemon is slow** (which BUG-17 proves it is), not necessarily a permanent hang under light load. It should be reproduced on an idle daemon to grade severity precisely.
- **Also observed:** a fresh browser loads with **ORG "local (unresolved)" and WORKSPACE "default"** (not the authed `apiary`), showing the empty state until switched — first-load should default to the authed scope. Health rail resolves correctly (hive/honeycomb/nectar → active/green). No JS console errors (one minor a11y warning: form fields missing `id`/`name`).
- **Fix:** cap/stagger the health/harness/hive-graph/log poll cadence and coalesce them (one multiplexed status poll, or SSE — which [doctor ADR-0001] already prescribes for health) so polling can't starve data calls; make one-shot data calls resilient to a saturated pool (priority/abort-and-retry); default first-load scope to the authed org/workspace. Fixing BUG-17's recall/daemon latency also relieves this.
- **PARTIALLY RELIEVED 2026-07-11:** BUG-17 is now fixed (PR #281 + #283), so the primary latency trigger (~40s recall / saturated read pool on every turn) is gone — the daemon is far less likely to be slow enough to pile up pending polls. The client-side ROOT (aggressive uncoalesced poll cadence saturating the browser connection pool; first-load scope defaulting to `local (unresolved)`) is UNTOUCHED, so the fragility remains under any future daemon-slow window. Kept 🔴 pending the poll-coalescing / SSE work.

## Security

<a id="bug-16"></a>
### BUG-16 — Plaintext Deep Lake JWT + Anthropic key in `honeycomb/.env.local` 🔴
**Component:** honeycomb · **Severity:** High (security) · **Confidence:** LIVE
- **Finding:** `honeycomb/.env.local` contains a plaintext Deep Lake JWT and Anthropic API key. A spin-off task was created to rotate them, check git history, and move to non-plaintext storage (honeycomb has `.vault`/`.secrets`).

---

## Operational / environment

<a id="ops-01"></a>
### OPS-01 — Orphaned `~/.daemon` + repo `.daemon` (frozen 07-05) 🔴 cleanup
The live state root is `~/.apiary/` (ADR-0003, migration complete). `~/.daemon` (home) and `the-apiary/.daemon` (repo) are stale legacy state that **caused the initial mis-diagnosis** ("stalled since 07-05"). Recommend deleting both.

<a id="ops-02"></a>
### OPS-02 — doctor holds an unresolved hive escalation 🔴
`GET :3852/status.json` → hive escalation: `reinstall-primary` → `failed:"unverified-got-0.7.0"` → `recommendedAction:"manual-intervention"` (2026-07-08T11:43, `resolved:false`). A version/lifecycle issue to run down separately.

<a id="ops-03"></a>
### OPS-03 — nectar idle: brooding off, watch stopped (`no-credentials`) ⚪
`GET :3854/health` → `watch.running:false reason:"no-credentials"`, `activeProjects.count:0`, `portkey.enabled:false`, `projection.lastWriteAt:null`. Explains empty Memory Graph + Hive Graph "not wired" + ROI pollination absent. Decide whether credentials/Portkey should be provisioned.

---

## Architecture clarifications (grounded, for the record)

- **Telemetry funnel through doctor — YES, and it is built and running** (correcting the [initiative doc](../initiatives/portal-and-telemetry-realignment.md) "implementation not started"). Split per [doctor ADR-0001](../../doctor/library/knowledge/private/architecture/ADR-0001-hive-telemetry-transport-and-single-source-of-truth.md): **fleet health/telemetry/live-logs** flow services → SQLite → doctor (SoT) → **one SSE** → hive; **workload data** (KPIs, ROI, memories, harnesses, sync, graphs) flow hive-BFF → honeycomb/nectar directly (hive ADR-0002 / nectar ADR-0004). Confirmed live: hive `/api/fleet-status` consumes doctor.
- **Every captured turn is Claude Code (3,342).** Cursor and Codex have captured 0 (see BUG-01/02). `turnsCaptured`/`lastSeen` derive from `sessions` COUNT/MAX by `agent` ([`harness-api.ts:16-17`](../../honeycomb/src/daemon/runtime/dashboard/harness-api.ts:16)).
- **State root is `~/.apiary/`** (per-product subdirs; ADR-0003), resolved from `os.homedir()` via `APIARY_HOME`.

---

## Progress (as of 2026-07-11)

- 🟢 **BUG-17** (Critical) — harness memory injection, fixed via PRD-077 (#281) + PRD-078 (#283). Related: PRD-079 a/b/c (#287/#289) capture durability, PR #285 queue home-anchoring.
- 🟢 **BUG-03** (Critical) — mixed-width batched INSERT drop, fixed via PR #291.
- 🟡 **BUG-19** (High) — partially relieved by the BUG-17 latency fix; client-side poll-coalescing root still open.
- 🔴 Still open (next-most-impactful): **BUG-02** (Cursor `/c:/…` captures gated) + **BUG-04** (memories not committing — `memory_controlled_write` dedup probe `query_error`), then the ROI/dashboard/skills/ops items below.

## Suggested fix order

1. **BUG-02 + BUG-01** — the Cursor path-normalization + `version` fixes (honeycomb branch, rebuild bundle, reinstall). Gets Cursor reporting.
2. ✅ **BUG-03** — the batched-insert width fix (DONE — PR #291). Unfreezes the memory/session count for all harnesses.
3. **BUG-04** — instrument then fix the dedup-probe query.
4. **BUG-06** — thread `roiUsage`/`roiInfra` + build the usage meter. Unblocks ROI.
5. **BUG-05** — de-Claude-centric the Skills/Sync scan (fixes both pages at once).
6. **BUG-07…BUG-10** — hive UX quick wins.
7. **BUG-11…BUG-15**, **BUG-16 (rotate now)**, **OPS-01…03**.
