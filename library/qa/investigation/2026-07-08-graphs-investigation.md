# Graphs (Memory / Hive / Code) — Investigation

**Date:** 2026-07-08
**Investigator:** QA agent (diagnose + recommend only — no code changes)
**Submodules in scope:** `hive` (dashboard UI), `honeycomb` (memory/graph/recall engine), `nectar` (file-provenance / brooding engine, reached by hive via proxy)

---

## Scope / symptoms (verbatim)

1. **Memory Graph:** "Does not appear to show anything. Is it implemented?"
2. **Hive Graph:** "Says 'brooding pipeline not enabled' but brooding says enabled right above it?" (a contradiction on the same page)
3. **General / Code Graph:** "Where did the Code Graph that was implemented in Hivemind go? Is that gone completely? Is it even being used by Honeycomb in the searches? Is there a purpose behind having it?"

---

## Memory Graph — implemented, but reading empty ontology tables

**Verdict: IMPLEMENTED end-to-end (renderer + backend query). It renders empty because its data source — the `entities` / `entity_dependencies` ontology tables — is empty, not because of an unimplemented renderer or a broken query. `built:false` is an honest empty state, by design.** (Confirmed.)

### Renderer (frontend)
- `hive/src/dashboard/web/pages/graph.tsx` — full-page interactive memory graph (pan/zoom, kind filters, search-to-node, detail panel). Fully built. **Confirmed.**
- Data fetch: `graph.tsx:449-454` calls `wire.memoryGraph(project)` on an 8 s SWR poll.
- Empty path: `graph.tsx:510-511` — when `!graph.built`, renders `GraphEmptyState` ("No memory graph yet for this workspace… populated automatically as memories and entities accrue"). `graph.tsx:385-409`. **This is exactly what the user is seeing.**

### Data source (backend), traced
- Wire method: `hive/src/dashboard/web/wire.ts:2389-2393` → `GET /api/diagnostics/memory-graph` (`ENDPOINTS.memoryGraph`, `wire.ts:72`). Degrades to `EMPTY_GRAPH = { built:false, nodes:[], edges:[] }` (`wire.ts:2280`) on any failure.
- Daemon handler: `honeycomb/src/daemon/runtime/dashboard/api.ts:1190-1192` mounts `GET /api/diagnostics/memory-graph` → `fetchMemoryGraphView` (`api.ts:525-547`).
- The query reads two ontology tables (`api.ts:555-575`):
  - `entities` → nodes (`id`, `label=name`, `kind=type`)
  - `entity_dependencies` → edges (`from=source_entity_id`, `to=target_entity_id`, `kind=type`)
- **`built:false` is returned iff `entityRows.length === 0`** (`api.ts:532`). A missing/absent table fails soft to `[]` (never throws), so an unpopulated ontology yields the honest empty graph. `built:true` only when ≥1 real entity row exists — never a stub. **Confirmed.**

### Why it is empty (root cause)
The `entities` / `entity_dependencies` tables are populated by the **`memory_graph_persist` pipeline job** (PRD-008), enqueued in the memory fan-out:
- `honeycomb/src/daemon/runtime/pipeline/fan-out.ts:232-245` enqueues `memory_graph_persist`.
- Handler registered at `honeycomb/src/daemon/runtime/pipeline/handlers.ts:56`.
- Gated by the pipeline master switch **and** the graph sub-gate `HONEYCOMB_PIPELINE_GRAPH_ENABLED` (`honeycomb/src/daemon/runtime/pipeline/config.ts:273`; master gate `config.ts:262`, `HONEYCOMB_PIPELINE_ENABLED`).

**Runtime evidence (Confirmed):** `honeycomb/.env.local` sets only `HONEYCOMB_DEEPLAKE_*` + `ANTHROPIC_API_KEY`. It does **not** set `HONEYCOMB_PIPELINE_ENABLED`, `HONEYCOMB_PIPELINE_GRAPH_ENABLED`, or `HONEYCOMB_LOCAL_QUEUE_ENABLED`. Per the operator's own memory note, memories only form with `HONEYCOMB_LOCAL_QUEUE_ENABLED`; without the pipeline + graph-persist gates on, no entity rows are written, so `entities` stays empty and the page correctly shows "No memory graph yet."

**Confidence: High.** The empty state is a *data/config* condition, not a code defect. If entities were present the page would render them.

> Side note (Hypothesis, out of scope): the operator's memory note "rows land in `memories` table not `memory`" concerns memory summaries, a different table from the ontology `entities` table this page reads. Even a populated `memories` table would not fill the memory *graph* unless `memory_graph_persist` runs.

---

## Hive Graph — the brooding contradiction

**Verdict: The two messages read TWO INDEPENDENT signals — a per-project brooding *toggle state* (nectar) vs. the build endpoint's *pipeline-wired capability* (Portkey creds). A project can be toggled "brooding: active" while the brood pipeline is unwired, producing the exact contradiction the user saw.** (Confirmed.)

Both live on `hive/src/dashboard/web/pages/hive-graph.tsx`.

### Signal A — the green "brooding" badge ("enabled right above it")
- Rendered: `hive-graph.tsx:215-217` — `<Badge tone={broodingBadgeTone(project.brooding)}>` with label from `broodingLabel(project.brooding)`.
- `broodingLabel` (`hive-graph.tsx:68-81`): `"active"` → **"brooding"**; `broodingBadgeTone` (`hive-graph.tsx:83-96`): `"active"` → **"verified"** (green).
- Data: `wire.nectarProjects()` → `GET /api/hive-graph/projects` (`hive-graph.tsx:103-107`).
- Source of truth (nectar): `nectar/src/hive-graph/active-projects.ts:163` — `brooding: effectiveBrooding(broodingState, projectId)`. This is **nectar's own per-project brooding toggle/binding state** (folder bound + not globally paused). **It reflects user *intent*; it does NOT check whether an LLM/describe transport is actually configured.** **Confirmed.**

### Signal B — "brooding pipeline not enabled" (the contradicting message)
- Exact backend string: **"the brood pipeline is not wired on this daemon"** — `nectar/src/api/hive-graph-api.ts:254`, returned as HTTP **501 `build_unavailable`**.
- Surfaced to UI: `wire.ts:2765-2767` maps `501 + error:"build_unavailable"` → `{ state:"unavailable", message: reason }`; rendered by `HiveGraphBuildButton` ack at `hive-graph.tsx:463-474` (the "Build Hive Graph" button under the **Pipeline status** panel, `hive-graph.tsx:573`).
- When it fires (the gate): `nectar/src/api/daemon-api-wiring.ts:180` — `resolveLiveBrood` returns `undefined` when `brood === undefined || !brood.portkey.enabled`, leaving the `/build` handler at its honest 501. **"Enabled" for the pipeline actually requires Portkey**: `NECTAR_PORTKEY_ENABLED` + `NECTAR_PORTKEY_API_KEY` + `NECTAR_PORTKEY_CONFIG` (`nectar/src/brood-prereqs.ts:55-58`, `nectar/src/portkey/config.ts:56-70`) **plus** Deep Lake credentials (`nectar/src/brood-prereqs.ts:5-6`). **Confirmed.**

### The precise contradiction
- **Badge (Signal A)** = nectar's persisted brooding *toggle* for the project = "active" → shows "brooding" / green.
- **Message (Signal B)** = the daemon's *runtime brood capability* = is Portkey wired? If not → 501 "the brood pipeline is not wired on this daemon."
- These never consult each other. A user who has toggled brooding on for a folder, on a daemon where Portkey is unconfigured, sees **"brooding" (green) directly above "brood pipeline not wired."** Both are individually truthful; together they read as a self-contradiction because the UI never reconciles *intent* (toggle) with *capability* (Portkey).

**What "brooding" actually is:** nectar's background pipeline that walks a git repo, LLM-describes files (via Portkey), embeds them, and writes `hive_graph_versions` rows (the file-provenance graph). Definitions: `nectar/src/brooding/pipeline.ts`, `pipeline-async.ts`; prereqs `nectar/src/brood-prereqs.ts`; async build wiring `nectar/src/api/daemon-api-wiring.ts:11-19, 166-203`.

**Confidence: High.**

---

## Code Graph (the tree-sitter codebase graph) — present, still built, near-dormant in search, no UI viewer

**Verdict: NOT gone. It still exists and the daemon still builds it on a timer. In recall it is used ONLY as an optional staleness oracle (σ) that is INERT by default (posture `observe`, exponent s=0). Its dashboard viewer was deliberately removed; the remaining UI hooks (`GraphCanvas` panel, `BuildGraphButton`, `wire.graph()`) are now ORPHANED.** (Confirmed.)

### Present / where it lives
- Module: `honeycomb/src/daemon/runtime/codebase/` — tree-sitter extractors and graph builder (`api.ts`, `extract.ts`, `extractors/ts-js.ts`, `extractors/structural.ts`, `walk.ts`, `resolve.ts`, `snapshot.ts`, `query.ts`, `degrees.ts`). **Confirmed.** (Note: no `src/graph/` dir — it lives under `runtime/codebase/`.)
- Actively rebuilt: `honeycomb/src/daemon/runtime/assemble.ts:3410-3441` — `rebuildCodebaseGraph()` on `DEFAULT_GRAPH_BUILD_INTERVAL_MS` (also `assemble.ts:3561`). This matches the `graph.tsx:8-13` comment: "the daemon keeps building it in the background… so the stale-ref / σ(m,t) diagnostic stays fed — it simply no longer has a viewer here." **Confirmed.**
- History: the codebase graph is PRD-014 (`honeycomb/library/requirements/completed/prd-014-codebase-graph/`), superseded as a UI by PRD-041 (memory-only full-page graph).

### Is it USED in Honeycomb search? (traced)
**Only indirectly, and inertly by default.** The recall path does NOT join the code graph as a search arm. Instead:
1. A periodic **stale-ref diagnostic** resolves each memory's indexed code references against the current codebase-graph snapshot and stamps a verdict (`ref_status` ∈ fresh/stale/unknown, plus `stale_refs`) onto `memories` rows. Trigger: `assemble.ts:1619-1636`, `honeycomb/src/daemon/runtime/maintenance/stale-ref-*.ts`, `stale-ref-diagnostic.ts`.
2. Recall reads that verdict as a staleness probability **σ(m,t)** and applies a `(1 − σ)^s` demotion multiplier: `honeycomb/src/daemon/runtime/memories/recall.ts:261-283` (the `staleness` / `refStatus` / `staleRefs` hit fields).
3. **The exponent `s` is posture-gated and defaults to 0** — `effectiveStalenessExponent` returns 0 unless posture is `execute` (`honeycomb/src/daemon/runtime/memories/lifecycle-config.ts:337-338`); default posture is `observe` (`lifecycle-config.ts:100-101`; assemble default noted `assemble.ts:1449, 155`). Wired at `assemble.ts:1458, 1476, 1504-1505`.

**Net:** with the shipped default (`observe`), the code graph's σ signal is **computed and visible** (dashboard/agent can see WHY a memory is stale) but **does NOT change ranking**. It only affects search order if an operator flips the stale-ref posture to `execute`. **Confirmed.** Note: the "Hive Graph" file descriptions (`hive_graph_versions`, nectar) ARE a live recall arm (`recall.ts:421-472, 999-1008`) — that is a *different* graph from the tree-sitter code graph.

### Dashboard exposure
- **No viewer.** `graph.tsx:8-13` removed the Codebase↔Memory toggle; the page now calls only `wire.memoryGraph()`.
- Orphaned remnants (Confirmed dead UI): the codebase `GraphCanvas` panel (`hive/src/dashboard/web/panels.tsx:314-411`, "Codebase graph" title) is **not rendered anywhere** (no `<GraphCanvas>` call site found). `BuildGraphButton` (`hive/src/dashboard/web/build-graph-button.tsx`) is imported only into that dead panel (`panels.tsx:19, 338`). `wire.graph()` → `GET /api/graph` (`wire.ts:2385-2387`, `ENDPOINTS.graph` `wire.ts:55`) and `POST /api/graph/build` (`wire.ts:59`) are still served by the daemon (RBAC group) but have no live UI consumer. `build-graph-button.tsx:4-7` doc still claims "two places show the codebase-graph empty state (graph.tsx and home)" — **stale after PRD-041**.

### Purpose / recommendation
- **Purpose today:** feed the stale-reference lifecycle diagnostic (σ) so memories that cite code that has since moved/been deleted can be down-ranked — a memory-hygiene signal, not a browsable artifact. It is intentionally headless.
- **Recommendation: KEEP the engine, but decide its posture and clean up the dead UI.** It is not "gone" and it has a real (if dormant) purpose. Two honest options:
  1. **Activate the value:** flip stale-ref posture to `execute` (with a tuned `s`) so the graph the daemon is already building actually improves recall — otherwise the CPU spent on `rebuildCodebaseGraph` buys only the currently-inert σ display.
  2. **Or explicitly keep it observe-only** and remove/delete the orphaned `GraphCanvas` panel + `BuildGraphButton` + fix the stale `build-graph-button.tsx` doc so the codebase graph isn't half-present in the UI.

---

## Recommendations (prioritized, no code changes made)

1. **Hive Graph contradiction (highest user-visible confusion).** Reconcile the two signals in `hive/src/dashboard/web/pages/hive-graph.tsx`. The brooding badge (`hive-graph.tsx:215-217`) should be qualified by pipeline capability: when the daemon's brood pipeline is unwired (Portkey off), show the badge as "brooding (paused — pipeline not wired)" or surface the Portkey/creds prerequisite inline, rather than a green "brooding" beside "brood pipeline not wired." Consider proactively reading a capability signal (nectar already exposes a Portkey/dormancy reason — `nectar/src/brood-prereqs.ts:19` `BroodDormancyReason`, `nectar/src/health.ts:36`; the wire status schema already has a `portkey` enum at `hive/src/dashboard/web/wire.ts:1156`) so the page can say "brooding is ON but dormant: Portkey not configured" as a single coherent state. Target files: `hive-graph.tsx`, `wire.ts` (status schema), nectar `/api/hive-graph/projects` (add effective-capability field if not already surfaced).

2. **Memory Graph emptiness (config, not code).** Confirm the intended default: if the memory graph is meant to populate, ensure `HONEYCOMB_PIPELINE_ENABLED` + `HONEYCOMB_PIPELINE_GRAPH_ENABLED` (+ local queue) are set for this daemon (`honeycomb/.env.local` / vault `memory.enabled`) so `memory_graph_persist` runs and writes `entities`. If it is expected to be empty until PRD-008 fully lands, the current empty-state copy is already honest — no code change needed. Optionally enrich the empty state with the actual gate ("memory graph builds when the pipeline + graph persist are enabled") for operator clarity. Target: `honeycomb/src/daemon/runtime/pipeline/config.ts`, env/vault; copy in `graph.tsx:385-409`.

3. **Code Graph posture decision.** Choose option 1 or 2 from the Code Graph section above. If keeping observe-only, remove the orphaned `GraphCanvas` panel + `BuildGraphButton` and fix the stale doc in `build-graph-button.tsx:4-7`. Target files: `hive/src/dashboard/web/panels.tsx:314-411`, `build-graph-button.tsx`, `honeycomb` lifecycle posture config.

4. **Docs drift (low).** `build-graph-button.tsx` header still describes a two-viewer world that PRD-041 collapsed; realign with reality.

---

## Open questions / unverified

- **Live DB state (unverified):** I did not query Deep Lake, so I cannot confirm the `entities` / `hive_graph_versions` row counts directly — the "empty" conclusion is inferred from the `built:false` contract + absent pipeline flags in `.env.local`. A `SELECT count(*)` on `entities` (via the daemon's storage) would confirm. **Hypothesis (High confidence).**
- **Does the message appear on page-load or only after clicking "Build Hive Graph"?** The "brood pipeline is not wired" string is a *build-ack* (`hive-graph.tsx:463-474`), so strictly it renders after the build attempt. If the user reports it appearing without clicking, there may be an auto-build or a second surface (e.g. status `degraded`) also emitting it — worth a UI repro. **Unverified.**
- **Actual brooding toggle vs. Portkey state for the user's project (unverified):** confirming the contradiction end-to-end needs the live `/api/hive-graph/projects` response (brooding=active?) alongside the daemon's Portkey config (`NECTAR_PORTKEY_ENABLED`). Not set in any env file I could read for nectar.
- **Security aside (out of scope, flagged):** `honeycomb/.env.local` contains a live-looking Deep Lake JWT and an `ANTHROPIC_API_KEY` in plaintext. Not a graphs issue, but worth rotating/ignoring if this file is tracked.
