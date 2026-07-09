# The Apiary — Dashboard & Fleet Investigation

**Date:** 2026-07-08
**Trigger:** Product-owner QA pass flagging issues across Dashboard, ROI, Projects, Harnesses, Memories, Memory Graph, Hive Graph, and Sync.
**Method:** Six parallel investigative agents (code + local runtime/logs), diagnose-and-recommend only — **no code was changed**.
**Submodules in scope:** `hive` (dashboard UI + daemon), `honeycomb` (memory/skill/graph engine), `nectar` (codebase-graph enricher), `doctor` (not implicated by any reported issue).

Individual reports live alongside this index:

| # | Report | Area |
|---|---|---|
| 1 | [harness-detection-investigation.md](2026-07-08-harness-detection-investigation.md) | Harness install/report + skills reporting |
| 2 | [sync-page-investigation.md](2026-07-08-sync-page-investigation.md) | Sync page scanning + IDE tabs |
| 3 | [memory-pipeline-investigation.md](2026-07-08-memory-pipeline-investigation.md) | Memory count, health, compact |
| 4 | [dashboard-ux-investigation.md](2026-07-08-dashboard-ux-investigation.md) | Dashboard layout, Projects, Memories UX |
| 5 | [graphs-investigation.md](2026-07-08-graphs-investigation.md) | Memory Graph, Hive Graph, Code Graph |
| 6 | [roi-investigation.md](2026-07-08-roi-investigation.md) | ROI feature end-to-end |
| ★ | [**live-verification-addendum.md**](2026-07-08-live-verification-addendum.md) | **Live daemon interrogation — CORRECTS reports 1 & 3** |
| ✅ | [**2026-07-09-confirmed-bugs-and-fixes.md**](2026-07-09-confirmed-bugs-and-fixes.md) | **START HERE for action — every confirmed bug with root cause (file:line), evidence, fix, and verify step** |
| ☑️ | [**2026-07-09-investigation-plan.md**](2026-07-09-investigation-plan.md) | **Pass/fail checklist for the OPEN threads — AC groups with AI + human troubleshooting steps** |

> **★ READ THE ADDENDUM + BUG REGISTER FIRST.** Reports 1 (harness) and 3 (memory) were written against the **orphaned `~/.daemon`** (frozen 07-05) and concluded the pipeline "stalled / schema-heal ALTER failure." That is **retracted.** The live fleet under `~/.apiary/` is **healthy and running**. The real, code-grounded root causes:
> - **Memory count stuck** → [BUG-03](2026-07-09-confirmed-bugs-and-fixes.md#bug-03) (variable-width batch INSERT `15 != 19`) + [BUG-04](2026-07-09-confirmed-bugs-and-fixes.md#bug-04) (dedup-probe `query_error`); binding-gating is tertiary.
> - **Cursor installed but not reporting** → [BUG-01](2026-07-09-confirmed-bugs-and-fixes.md#bug-01) (`hooks.json` missing numeric `version`; Cursor rejected the config — stopgapped) + [BUG-02](2026-07-09-confirmed-bugs-and-fixes.md#bug-02) (Cursor's `/c:/…` `workspace_roots` not normalized → captures gated). Every captured turn is Claude Code.
>
> **Investigation timeline (why the corrections):** (1) six agents did static + `.daemon` analysis; (2) owner flagged the doctor telemetry architecture + the home-dir daemon → live daemon interrogation moved the root cause from "gating" to the batch-INSERT bug; (3) owner's Cursor config-error screenshot + a captured Cursor hook payload proved the two Cursor bugs. The [addendum](2026-07-08-live-verification-addendum.md) and [bug register](2026-07-09-confirmed-bugs-and-fixes.md) carry the final, verified truth.

---

## The one thing to fix first (LIVE-VERIFIED, CODE-GROUNDED)

The **"memory count stuck all day"** is a **live, reproducing bug in honeycomb's capture write path** — confirmed against the live daemon log DB and the source. The fleet is **healthy and running**; there is no stall and no schema-heal `ALTER` failure (that was misread from the orphaned `~/.daemon`, now retracted). See the [addendum](2026-07-08-live-verification-addendum.md) for the full trace.

**Defect 1 (PRIMARY) — variable-width batch INSERT drops captures.** Live: `capture.flush.failed` / `capture.batch_insert.failed` = `buildInsertMany: row column count 15 != expected 19`, firing minutes ago (incl. this session). `buildRow` emits **15–19 columns** per turn (0–4 optional usage columns via `usageColumns`, [`capture-handler.ts:826`](../../honeycomb/src/daemon/runtime/capture/capture-handler.ts:826)); the **batched flush** ([`:495`](../../honeycomb/src/daemon/runtime/capture/capture-handler.ts:495)) hands mixed-width rows to `buildInsertMany`, which **rejects the whole batch** on any width mismatch ([`writes.ts:147`](../../honeycomb/src/daemon/storage/writes.ts:147)). Fix: pad rows to the full column set (NULL usage cols) or sub-group the flush by column shape; add a mixed-batch regression test.

**Defect 2 (SECONDARY) — memory commits blocked.** `stage.failed` = `memory_controlled_write … controlled-write dedup probe failed: query_error` (505×, retried 5× then dropped). Extraction runs fine (`extraction.result` firing); the **dedup-probe query errors**, so distilled memories never commit. Needs its own query-level root-cause.

**Tertiary — project-binding gating.** `capture.gated.no_bound_project: 105`. Only `C:\Users\mario\GitHub\the-apiary` is bound in `~/.deeplake/projects.json`; captures from **other repos opened in Claude Code** are gated. (NOT Cursor — Cursor has captured nothing, see below.) Real, but a smaller drain than Defects 1–2.

Live counts: `memoryCount 2108, sessionCount 3323` (`/api/diagnostics/kpis`). The `memory`-vs-`memories` table mismatch from a prior session is **confirmed not the cause** (KPI reads `memories` → 2,108; a mismatch would show 0).

---

## Cross-cutting themes

1. **"Broken" is often "unwired config," not a code bug.** The Memory Graph is fully built but its pipeline flags (`HONEYCOMB_PIPELINE_ENABLED` + `HONEYCOMB_PIPELINE_GRAPH_ENABLED`) are unset; ROI's net + infra surfaces are dead because `roiUsage`/`roiInfra` are never threaded into the daemon composition root (`assemble.ts`). These are wiring/config gaps with honest empty states, not crashes.
2. **`.claude`-centrism.** Both harness detection and Sync loop all six harnesses but hardcode Claude's on-disk layout, so **86 Codex `.toml` agents** and Cursor's real `skills-cursor/` folder are invisible, and enable/pull always writes back to `.claude`. Neither scans the user's home directory (`includeGlobal:false`).
3. **Orphaned / dead-end UI.** Projects "Open" only calls `setScope()` (no navigation, no detail view, no route); Memories search swaps to a non-clickable presentational card; the Code Graph's dashboard viewer was removed in PRD-041 leaving `GraphCanvas`/`BuildGraphButton`/`wire.graph()` orphaned; the top live-log box duplicates the bottom one.
4. **Signals that never reconcile.** The Hive Graph shows "brooding enabled" (nectar per-project toggle) directly above "brood pipeline not wired" (a 501 capability check requiring Portkey) — two independent truths the UI never merges.

---

## Findings ranked by severity

### P0 — Core value broken

| Finding | Where | Report |
|---|---|---|
| **Defect 1 — variable-width batch INSERT drops captures** (`buildInsertMany: row column count 15 != expected 19`, live). Root of the stuck count. | `capture-handler.ts:495,826` + `writes.ts:147` | ★ |
| **Defect 2 — memory commits blocked** (`memory_controlled_write` dedup probe `query_error`, 505×). | `honeycomb` controlled-write path | ★ |
| Tertiary — `no_bound_project:105` gating drops other-repo (Claude Code) captures; only `the-apiary` is bound | `~/.deeplake/projects.json` | 1, 3, ★ |
| **Cursor has captured 0 turns ever** — hooks wired (`~/.cursor/hooks.json`) but never fired; "installed" is a marker-only check. All 3,342 captures are Claude Code. | `harness-detect.ts` + `connectors/cursor.ts` | 1, ★ |
| ROI Net hero can never compute — `roiUsage` never mounted → pollination always `absent` → net always dashes; **no live usage meter exists** (PRD-060d seam never built) | `honeycomb/.../assemble.ts:1315-1320` | 6 |
| ROI Trend chart is a hardcoded stub — `fetchRoiTrendView` ignores inputs, always returns `EMPTY_ROI_TREND` → permanent "No trend history yet" | `honeycomb/.../api.ts:1039-1051` | 6 |

### P1 — Feature visibly wrong / interaction dead

| Finding | Where | Report |
|---|---|---|
| Skills/Sync miss Codex `.toml` agents + Cursor `skills-cursor/`; hardcodes Claude layout for all harnesses | `honeycomb/.../installed-assets.ts`, `asset-install-target.ts` | 1, 2 |
| Home-dir assets never scanned (`~/.claude`, `~/.cursor`, `~/.codex`) — `includeGlobal:false`; scans daemon `cwd`, not selected project | `installed-assets.ts:110/118`, `sync-api.ts:215` | 1, 2 |
| Projects "Open" is a silent no-op — `onOpen` only `setScope()`; no `/projects/:id` route or detail view; rows are inert `<div>`s | `hive/.../pages/projects.tsx:125-127,582-587` | 4 |
| Memories **search** renders non-clickable `MemoryCard` from a fused memory+session endpoint; browse's Edit/Forget affordances lost | `hive/.../pages/memories.tsx:817-826`, `wire.ts:495-514` | 4 |
| ROI Infra cost un-wired at root (`roiInfra` not passed); rebuilds billing per request, dashes without billing creds | `honeycomb/.../assemble.ts` | 6 |

### P2 — Layout, contradictions, product decisions

| Finding | Where | Report |
|---|---|---|
| Duplicate live log — remove the top box in the harness strip, keep the bottom feed | `harness-strip.tsx:133` vs `dashboard.tsx:335` | 4 |
| Remove the **Sessions panel** (owner correction: **keep** the Turns KPI) | `dashboard.tsx:319-332` | 4 |
| Dashboard redesign → status board + launchpad (health line, 4 trend KPIs incl. Turns, Net-ROI sparkline, harness strip, top-actions row, one log); drop the Sessions/Rules/SkillSync grid | `dashboard.tsx:319-332` | 4 |
| Hive Graph: reconcile brooding **toggle** badge with pipeline **capability** (501/Portkey) | `hive/.../pages/hive-graph.tsx`; `nectar/.../hive-graph-api.ts:254` | 5 |
| Memory Graph empty — set pipeline flags if it should populate | `honeycomb/.env.local`, `api.ts:525-547` | 5 |
| Code Graph is inert in search (posture `observe`, `s=0`) — decide: activate `execute` or keep observe-only and delete orphaned UI + fix stale docs | `honeycomb/.../lifecycle-config.ts:337`, `runtime/codebase/` | 5 |
| "Compact" is wired but reaps version-history of skills/rules tables — does **not** touch `memories`; relabel to fix expectation | `hive/.../memories.tsx` → `/api/diagnostics/compact` | 3 |
| Memory Health empty by design when lifecycle engines dormant (computes from conflict/stale-ref/calibration, not corpus size) | `honeycomb` health panel | 3 |

### Security (surfaced in passing, out of original scope)

| Finding | Where | Report |
|---|---|---|
| Plaintext Deep Lake JWT + Anthropic API key committed/stored in `honeycomb/.env.local` | `honeycomb/.env.local` | 5 |

---

## Answers to the specific questions asked

- **"Is Skills only checking `.claude`?"** — It loops all six harnesses but hardcodes Claude's layout, so effectively yes for anything non-Claude. Codex `.toml` and Cursor `skills-cursor/` are dropped.
- **"Why 2,107 memories from 3,128 turns?"** — Expected. Memory creation is a gated distillation (~0.63/session), not one-per-turn. Live count is now 2,108 / 3,323 sessions.
- **"Why stuck all day?"** — **CODE-GROUNDED:** a live bug — the batched capture INSERT rejects mixed-width rows (`row column count 15 != expected 19`), dropping captures; the memory-write dedup probe errors (`query_error`); and unbound-repo captures are gated. Not a stall. See [addendum](2026-07-08-live-verification-addendum.md).
- **"How is Cursor working with no hooks?"** — It has `~/.cursor/hooks.json` (fully honeycomb-wired) — but it has **never fired**: `turnsCaptured:0`, `lastSeen:null`, zero Cursor rows in the live log DB. **Every captured turn is Claude Code (3,342).** "Cursor installed" is a file-existence marker, not proof it runs. So Cursor contributes nothing today, and was never the cause of the stuck count.
- **"Is Memory Graph implemented?"** — Yes, fully. It's empty because the ontology tables have no rows (pipeline flags unset).
- **"Hive Graph says both enabled and not enabled?"** — Two different signals: per-project brooding *toggle* (on) vs build *capability* check requiring Portkey (off). Never reconciled in UI.
- **"Where did the Code Graph go? Is Honeycomb using it in search?"** — Still present and rebuilding on a timer; used in search only as an inert staleness oracle (never changes ranking by default); its dashboard viewer was removed in PRD-041.
- **"Is Compact wired?"** — Yes, but it compacts version history, not the memory corpus.
- **"Is ROI's engine nectar?"** — No. ROI is served by honeycomb (`/api/diagnostics/roi`); nectar is a codebase-graph enricher with zero ROI code. Live ROI **does** return measured savings ($909) but `net.computed:false` (pollination absent).
- **"Isn't telemetry funneled through doctor?"** — **Yes, and it's built and running** — but only for **fleet health/telemetry/live-logs** (services → doctor SoT → one SSE → hive, per [doctor ADR-0001](../../doctor/library/knowledge/private/architecture/ADR-0001-hive-telemetry-transport-and-single-source-of-truth.md)). **Workload/product data** (memory count, ROI, memories, harnesses, sync, graphs) intentionally does **not** go through doctor — it goes hive-BFF → honeycomb/nectar directly (hive ADR-0002 / nectar ADR-0004). So both are true at once; see the [addendum](2026-07-08-live-verification-addendum.md).
- **"Is `.daemon` in the home dir?"** — The **live** state root is `~/.apiary/` (migrated; ADR-0003). The `~/.daemon` and repo `.daemon` are **orphaned legacy** (frozen 07-05) — reading them caused the retracted stall diagnosis. Recommend deleting them.

---

## Recommended sequence

1. **Fix Defect 1** (the variable-width batch INSERT in `capture-handler.ts`/`writes.ts`) — this is the P0; it's dropping bound captures live. Then **Defect 2** (dedup-probe `query_error`). Then **bind the other repos** you work in (`~/.deeplake/projects.json` has only `the-apiary`) to stop the `no_bound_project` gating. *(All three live-verified & code-grounded; see addendum.)*
2. **Thread `roiUsage` + `roiInfra` into `assemble.ts`** and build the missing live usage meter — unblocks the entire ROI page (report 6).
3. **Fix the `.claude`-centrism** (per-harness layouts + `includeGlobal` + home-dir scan) — one change fixes both Skills reporting and Sync (reports 1, 2).
4. **Quick UX wins** (report 4): delete the duplicate log, remove Turns, filter Memories search to `kind==="memory"` with clickable rows, and wire Projects "Open" to a real detail view/route.
5. **Reconcile the Hive Graph signals** and **make the Code Graph keep/cut decision** (report 5).
6. **Rotate the leaked `.env.local` credentials** and move them out of plaintext.

The dashboard-redesign recommendation (report 4) is the one item that needs your product judgment before build — it proposes a specific "quick overview" layout rather than a bug fix.
