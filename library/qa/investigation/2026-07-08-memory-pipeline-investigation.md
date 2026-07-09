# Memory Pipeline & Counts — Investigation

**Date:** 2026-07-08
**Investigator:** QA agent (diagnose + recommend; no code changes)
**Submodule:** `honeycomb` (memory/skill engine) + `hive` (dashboard UI)
**Method:** static trace of `honeycomb/src` + live inspection of runtime state (`honeycomb/.daemon`, `.vault`, `.secrets`, `.env.local`, shell env)

> **⚠️ ROOT-CAUSE SUPERSEDED — read [`2026-07-08-live-verification-addendum.md`](2026-07-08-live-verification-addendum.md) first.**
> This report inspected the **orphaned `~/.daemon`** (frozen 07-05) and concluded a "stalled writer / schema-heal `ALTER` failure." **Retracted.** Live daemon interrogation (`~/.apiary/honeycomb/`, `/health`, `/api/diagnostics/kpis`) shows the fleet **healthy and running**; the count is stuck because of **two live code bugs**: (1) `buildInsertMany: row column count 15 != expected 19` — the batched capture INSERT rejects variable-width rows and drops the flush; (2) `memory_controlled_write` dedup probe `query_error` blocks commits. Plus `no_bound_project` gating on unbound repos. The "2,107 from 3,128 turns is EXPECTED" and "table-name mismatch already fixed" findings below **stand**.

---

## Scope / symptoms (verbatim)

1. "Why are there 2,107 memories if we only have 3,128 turns? Surely it is not creating a memory per turn?"
2. "Why has it been stuck at [2,107] for the entire day? Is something in the memory pipeline broken?"
3. "'Memory health' still has not reported anything. If I actually have 2000+ memories surely memory health should display something?"
4. "Is 'Compact' wired up? I haven't tested it."

---

## How a memory is created today (traced pipeline)

Memories are **not** created 1:1 per turn. The path is a multi-stage, confidence- and dedup-gated pipeline that runs OFF the capture write path via a durable job queue.

**Stage 0 — Turn capture (writes `sessions`, not `memories`)**
- Harness hook → `POST /api/hooks/capture` → `capture-handler.ts`. Each accepted turn is written to the `sessions` DeepLake table (this is what the dashboard labels "Turns"). `honeycomb/src/daemon/runtime/dashboard/api.ts:226` — `turnCount` and `sessionCount` are the *same* `COUNT(*) FROM "sessions"`.
- After persisting, capture enqueues ONE pipeline-entry job (never inline): `capture-handler.ts:104-114` (`enqueuePipelineEntry`) and `:361-363`, emitting a `memory_extraction` job onto the durable queue.

**Stage 1 — Extraction** (`pipeline/extraction.ts`)
- Job kind `memory_extraction`. Calls the model: `ModelClient.complete("memory_extraction", …)` (`extraction.ts:284`). Produces up to `maxFacts` candidate facts (default cap, `pipeline/config.ts:132`). A turn with no durable facts yields **zero** candidates. Fans out to `memory_decision` (`pipeline/fan-out.ts:122`).

**Stage 2 — Decision (KEEP/MERGE/SKIP)** (`pipeline/decision.ts`)
- The model is asked for `{action: "add"|"update"|"delete"|"none", target_id, confidence, reason}` (`decision.ts:144`). `none` drops the candidate; `update` supersedes an existing row; `add` proposes a new memory. Dedup is by `content_hash` (SHA-256 over normalized content) — `catalog/memories.ts:204-220` (`contentHash` / `buildDedupCheckSql`). Fans out to `memory_controlled_write` (`fan-out.ts:213-222`).

**Stage 3 — Controlled write** (`pipeline/controlled-writes.ts`)
- The ADD gate: only facts at/above `minFactConfidenceForWrite` (default **0.7**, `pipeline/config.ts:29`) commit. Commit actions are `inserted` / `version_bumped` / `deduped` (`pipeline/memory-formation.ts:33`). This is the ONLY stage that writes the `memories` table (pattern `update-or-insert`, `catalog/memories.ts:181-188`).

**Stage 4 — Graph persist** (`pipeline/graph-persist.ts`) — ontology entities/edges (feeds the memory-graph view), not the count.

### Why 2,107 memories from 3,128 turns is EXPECTED (not a bug)
Every turn passes through extraction → decision → a 0.7-confidence + content-hash-dedup gate. Most turns yield 0–1 durable facts; duplicates collapse; low-confidence and `none`/`skip` candidates are dropped. A ratio of ~0.67 memories/turn is exactly what a gated distillation pipeline should produce. **There is no 1:1 memory-per-turn behavior anywhere in the code.** (Confirmed.)

---

## Root cause: why the count is stuck — THE headline finding

### First, clear the prior hypothesis: the `memory` vs `memories` table-name mismatch is ALREADY FIXED
The known-context "reader queries `memory` (singular) while writes land in `memories`" **was a real historical bug and is now resolved in the current code.** The dashboard KPI count query reads the correct plural table:
- `honeycomb/src/daemon/runtime/dashboard/api.ts:268-270`:
  > "The distilled-fact table is `memories` … not `memory` — a stale singular here silently returned 0 for the Memories KPI against the real backend."
  `const memTbl = sqlIdent("memories");` … `SELECT COUNT(*) AS n FROM "memories"`.

A table-name mismatch would render the count as **0**, not a frozen **2,107**. Since the user sees a real non-zero number that matches the corpus, the count query is reading the right table. **The mismatch is not the current cause.** (Confirmed via code + comment.)

### The count is stuck because the pipeline is not committing NEW memories — the writer is idle/stalled
`2,107` is the true live `COUNT(*) FROM "memories"`. It is frozen because Stage-3 controlled-writes are not landing new rows. Runtime evidence from `honeycomb/.daemon` (this workspace's persisted daemon state):

**Evidence A — the daemon has produced no runtime activity for ~3 days.** (Confirmed, this workspace)
- `logs.db` `request_log`: 47,486 rows, `MAX(time) = 2026-07-05T16:37:01Z`. Newest requests are all `GET /health` heartbeats — no capture/pipeline traffic after July 5.
- `logs.db` `event_log`: 29 rows, last event `2026-07-05T16:34:37Z`.
- `.daemon/local-queue.db` mtime `Jul 5 19:54`; `.daemon/logs.db` mtime `Jul 5 12:37`.

**Evidence B — the local job queue holds ZERO memory-pipeline jobs.** (Confirmed, this workspace)
- `local-queue.db` `local_job` has 8 rows, ALL `document_ingest` / `source_index` (connector jobs), all created `2026-07-05T23:5x`, stuck in `retrying` / `queued`. The `document_ingest` payloads are SSRF probe URLs (`http://169.254.169.254/latest/meta-data/`, `file:///etc/passwd`) with `last_error_class: "document extraction failed"` — i.e., leftover **security-eval** fixtures, not real work.
- There is **not a single** `memory_extraction`, `memory_decision`, or `memory_controlled_write` job in the queue (the pipeline kinds — `pipeline/stage-worker.ts:45`, `fan-out.ts:122/213/245`). The memory pipeline is not enqueuing/draining.

**Evidence C — the last pipeline-relevant events on July 5 were failures.** (Confirmed, this workspace)
- `event_log` id 21: `capture.batch_insert.failed` with kind **`ALTER ADD COLUMN "sessions"."path" failed`** — a **schema-heal failure** on a write path. id 20: `capture.batch_insert.failed` / `query_error`.
- `event_log` ids 14-19 (July 5): `recall.degraded` `{mode:"lexical_fallback", sources:[]}` — recall returned **no sources at all** (earlier June events still listed `["sessions"]`), i.e., reads were also degrading.

**Interpretation (Hypothesis, high confidence):** the memory writer is not running / not committing. The schema-heal `ALTER ADD COLUMN` failure (Evidence C) is the most likely proximate trigger: the `memories` table has had many columns added over time (`key`, `project_id`, `last_reinforced_at`, `access_count`, `ref_status`, `verified_at`, `stale_refs`, `access_compacted_at/_id` — `catalog/memories.ts:49-134`) which rely on `healMissingColumns` performing `ALTER ADD COLUMN`. On July 5 that exact operation was observed failing on the sibling `sessions` table. If the same heal fails on `memories`, controlled-writes cannot insert, and the count freezes while turns (which sometimes still slip through) diverge. This is consistent with turns (3,128) > memories (2,107) and with a hard freeze.

### The daemon exposes the exact confirmation signals — check these on the LIVE daemon
The health detail was purpose-built for this failure mode (`health.ts:203-238`):
- `reasons.memoryFormation.committedSinceBoot` — "is this daemon forming memories?" A **0** on a busy daemon is the loud symptom (`pipeline/memory-formation.ts:22-24`).
- `reasons.memoryQueue` — `local` (healthy) vs `shared` (degraded DeepLake queue). `shared` also emits a boot stderr warning + `queue.shared_pipeline_path_active` event (`assemble.ts:2836-2851`). No such event is present, and the local queue DB exists, so the queue backend is **local** here — the "shared-queue collision" failure mode is NOT active in this workspace.
- `reasons.memory.{enabled,provider}` — pipeline master switch + whether a real inference provider is configured.

### Config verified (rules out several candidates)
- `HONEYCOMB_PIPELINE_ENABLED=true`, `HONEYCOMB_PIPELINE_EXTRACTION_PROVIDER=anthropic`, `ANTHROPIC_API_KEY` present (shell env + `.env.local`). Pipeline is enabled with a provider. (Confirmed.)
- `HONEYCOMB_LOCAL_QUEUE_ENABLED` is **unset**, but the current code defaults it **on** for single-machine/undeclared topology — `hybrid-job-queue.ts:47-59` ("REVERSES PRD-066e's original 'unknown ⇒ shared' default"). So the older "must set the flag or memories collide on a shared queue" guidance is **stale**; default-on is now correct. (Confirmed.)
- Auth token in `.env.local` is a real DeepLake JWT (`name: github_ci`, `exp` in 2027) — not an obvious stub. (Confirmed; runtime reachability not independently re-tested.)

### Important caveat on the evidence (Hypothesis)
`resolveWorkspaceBaseDir()` (`assemble.ts:1956-1976`) makes `.daemon` (logs + local queue) + `agent.yaml` **per-workspace, cwd-relative** (falls back to `process.cwd()`). The `honeycomb/.daemon` I inspected is written when the daemon runs with cwd = this repo (dogfood/dev runs). The user's *live* daemon is launched as a Claude Code plugin (`~/.claude/plugins/cache/honeycomb/honeycomb/0.8.0`) from a different cwd, so its `.daemon` state lives elsewhere and may differ. The pipeline *mechanics* and failure *signatures* above are authoritative; the specific "2,107 stuck all day" instance should be confirmed against the live daemon's `/health` (the three `reasons.*` fields above) and its own `.daemon/local-queue.db`.

---

## Memory health — why empty

"Memory health" is the `LifecycleHealthPanel` on the hive memories page (`hive/src/dashboard/web/pages/lifecycle-panel.tsx:206`, header literally `"Memory health"` at `:270`).

It does **NOT** read the memory count or `committedSinceBoot`. It computes a store-level scalar **`H = A · C · (1 − σ) · κ`** (`lifecycle-panel.tsx:97-103`, `assembleStoreHealth`) from three lifecycle-engine reads (`wire.ts:82-84`):
- `lifecycleConflicts` → `GET /api/memories/conflicts` (058b conflict queue)
- `lifecycleStaleRefs` → `GET /api/memories/stale-refs` (058c stale-reference diagnostic)
- calibration → `GET /api/memories/calibration` (058e ECE/Brier)

**Why it shows nothing (Confirmed by design):** each term degrades to an identity value (1) when its producing engine is dormant (`lifecycle-panel.tsx:256-265`). Those engines are separate maintenance passes (conflict detection, stale-ref diagnostic, calibration) that only populate rows when they run. With no lifecycle passes having executed, the panel renders its **honest empty/inert state** — "no open conflicts", "calibration dormant", `H 1.00` — regardless of how many raw memories exist. So 2,000+ memories can coexist with a blank Memory-health panel: the panel reflects *lifecycle-engine output*, not corpus size. Given the pipeline stall above (no daemon maintenance activity), the lifecycle engines have produced nothing to display. (Confirmed mechanism; whether the engines are merely dormant vs. mis-wired on the live daemon needs a live check of the three endpoints.)

---

## Compact — wired or dead?

**Wired.** (Confirmed.) The hive memories page LifecyclePanel `Compact` button (`hive/src/dashboard/web/pages/memories.tsx:416-476`, `runCompact` at `:445-451`) calls `onCompact` → `wire.compact` → `POST /api/diagnostics/compact` (`wire.ts:78`). The backend handler exists and is mounted: `mountCompactApi` (`honeycomb/src/daemon/runtime/maintenance/compact-api.ts:276-305`), attached in `assemble.ts:105/634`. The `honeycomb maintenance compact` CLI verb hits the same endpoint (`commands/maintenance.ts:41`). It returns a per-table `{ ok, summaries, skippedTables }` and is fail-soft (never 500s).

**But it does NOT compact the `memories` table — an important expectation mismatch.** (Confirmed.) `/api/diagnostics/compact` reaps **version history** of *version-bumped* tables only: `skills`, `rules`, `entity_attributes`, `epistemic_assertions`, `pollinating_state` (`compact-api.ts:105-111`, `COMPACTABLE_VERSION_BUMPED_TABLES`). The `memories` table is `update-or-insert` (`catalog/memories.ts:186`) and is **not** in the allow-list. So clicking "Compact" on the memories page will run, return a summary, and **leave the memory count unchanged** — it will not consolidate/merge/reduce memories. If the user expects "Compact" to consolidate the memory corpus, that expectation is not met by this endpoint; it is a version-history reaper surfaced (somewhat misleadingly) on the memory page.

---

## Recommendations (prioritized; no code changes made)

1. **Confirm the stall on the LIVE daemon (5 minutes).** `GET {daemon}/health` and read `reasons.memoryFormation.committedSinceBoot`, `reasons.memoryQueue`, `reasons.memory.{enabled,provider}`. `committedSinceBoot: 0` on an active daemon confirms the writer stall; `memoryQueue: "shared"` would indicate a different (queue-collision) failure. Also inspect the live daemon's own `.daemon/local-queue.db` for pending/failed `memory_*` jobs. Target: operator action, then `honeycomb/src/daemon/runtime/health.ts`.

2. **Investigate the schema-heal `ALTER ADD COLUMN` failure (likely proximate cause).** Reproduce heal against the DeepLake backend for `memories`/`sessions`; the July-5 `capture.batch_insert.failed: ALTER ADD COLUMN "sessions"."path" failed` event is the strongest lead. If heal fails, controlled-writes to `memories` cannot land. Targets: `honeycomb/src/daemon/storage/heal.ts` (`healMissingColumns`), `honeycomb/src/daemon/storage/schema.ts:160` (`buildAddColumnSql`), `honeycomb/src/daemon/runtime/capture/capture-handler.ts` batch-insert path.

3. **Restart/verify the daemon is actually running and draining.** The inspected workspace state is ~3 days stale with a queue full of only stale eval fixtures. Ensure a live daemon owns the workspace, is not hibernated indefinitely, and is draining `memory_extraction` jobs. Targets: `assemble.ts` (stage-worker wiring), `pipeline/stage-worker.ts`, `services/deeplake-hibernation.ts`.

4. **Purge the stale SSRF eval fixtures from the local queue.** The 8 `document_ingest`/`source_index` rows are leftover security-test payloads stuck retrying; they add noise to any queue diagnostic. Target: `honeycomb/.daemon/local-queue.db` (operator cleanup; retention is governed by `pipeline/retention.ts`).

5. **Make "Memory health" honest when the corpus is non-empty but engines are dormant.** Today an operator with 2,000+ memories sees a blank/`H 1.00` panel with no explanation. Consider surfacing "lifecycle engines dormant — run maintenance" plus the `memoryFormation`/`memoryQueue` health signals on this panel so a stall is glanceable here, not just on `/health`. Targets: `hive/src/dashboard/web/pages/lifecycle-panel.tsx`, `hive .../wire.ts`.

6. **Disambiguate the "Compact" affordance on the memories page.** Relabel/scope it (e.g., "Compact version history") or add memory-corpus consolidation, so users don't expect it to reduce the memory count. Targets: `hive/src/dashboard/web/pages/memories.tsx:416-476`; backend allow-list `honeycomb/src/daemon/runtime/maintenance/compact-api.ts:105-111`.

7. **Update the stale operator memory note.** The prior guidance "memories only form when `HONEYCOMB_LOCAL_QUEUE_ENABLED` is set / else shared-queue collision" is now inverted in code (default-on for single-machine — `hybrid-job-queue.ts:47-59`). Keep the memory doc in sync to avoid mis-diagnosis next time.

---

## Open questions / unverified

- **Live-daemon correlation (Hypothesis).** The inspected `honeycomb/.daemon` is cwd-relative dev state (`assemble.ts:1956`); the "2,107 stuck all day" instance belongs to the plugin daemon whose state lives elsewhere. All runtime evidence (Evidence A–C) is from this workspace and must be confirmed against the live daemon.
- **Heal-failure → write-block causation (Hypothesis).** I did not execute a live `ALTER ADD COLUMN` against the backend to prove it currently fails; the July-5 event is strong but historical. Needs a live reproduction.
- **DeepLake reachability now (Unverified).** The `.env.local` token looks valid (non-stub, 2027 expiry) but I did not run a live `SELECT 1` / row-count against DeepLake (no read-only query path exercised, per "mutate nothing" scope). A live `COUNT(*) FROM "memories"` per workspace/partition would confirm 2,107 and whether writes are the sole blocker.
- **Whether lifecycle engines are dormant vs mis-wired (Unverified).** "Memory health" empty is explained by dormant engines, but I did not confirm the three lifecycle endpoints return `[]`/inert vs erroring on the live daemon.
- **Extraction provider auth at runtime (Unverified).** Config points at Anthropic with a key present; I did not confirm the model actually completes `memory_extraction` calls (a silently-failing provider would also freeze the count with no committed writes).
