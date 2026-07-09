# Live Verification Addendum — corrects the memory & harness reports

**Date:** 2026-07-08 (evening, live fleet interrogation)
**Status:** **Supersedes** the "pipeline stalled since 07-05 / schema-heal `ALTER` failure" conclusion in [memory-pipeline](2026-07-08-memory-pipeline-investigation.md) and [harness-detection](2026-07-08-harness-detection-investigation.md). Those two reports read the **wrong directory** — the orphaned `~/.daemon` (and the repo-local `.daemon`), both frozen at 07-05. The **live** fleet state lives under `~/.apiary/` and was verified by querying the running daemons directly.

---

## ★★ CONFIRMED ROOT CAUSE (code + live logs) — variable-width batch INSERT drops captures ★★

The memory/session count is stuck because of a **live, reproducing bug in the capture write path** — confirmed by reading the live daemon log DB (`~/.apiary/honeycomb/.daemon/logs.db`, active 07-08 20:57) and the source. This is the real answer; the project-binding gating (below) is a real but **secondary** effect.

**Live evidence** (events firing minutes ago, including for *this* Claude Code session `sess-d0dc38d3…`):
```
capture.flush.failed         {"reason":"buildInsertMany: row column count 15 != expected 19"}   (70×)
capture.batch_insert.failed  {"kind":"buildInsertMany: row column count 15 != expected 19"}      (29×, latest 00:54–00:55)
stage.failed                 {"kind":"memory_controlled_write","attempt":5,
                              "reason":"controlled-write dedup probe failed: query_error"}         (505×)
```

**Defect 1 — variable-width session rows rejected by the batched INSERT (PRIMARY).**
- `buildRow` ([`capture-handler.ts:571-615`](../../honeycomb/src/daemon/runtime/capture/capture-handler.ts:571)) emits a **fixed 15-column base**, then appends **0–4 usage columns** via `usageColumns` ([`:826`](../../honeycomb/src/daemon/runtime/capture/capture-handler.ts:826)): `[]` for user/tool turns, and for assistant turns each of `input_tokens`/`output_tokens`/`cache_read_input_tokens`/`cache_creation_input_tokens` **only when present**. So a row is **15–19 columns** depending on the turn.
- The batched flush ([`:495`](../../honeycomb/src/daemon/runtime/capture/capture-handler.ts:495) → `groupRowsByScope` → `appendOnlyInsertMany`) hands the mixed-width rows to `buildInsertMany`, which takes the **first row** as the header and **throws on any row of a different width** ([`writes.ts:147-150`](../../honeycomb/src/daemon/storage/writes.ts:147)). A batch that mixes (e.g.) an assistant-with-usage turn and a user turn fails **entirely** — every capture in that flush is dropped.
- The single-row append path (`[row]`, [`:350`](../../honeycomb/src/daemon/runtime/capture/capture-handler.ts:350)) is uniform and does NOT fail; only the **multi-row batched flush** does. This is why some captures survive and the count creeps (2107→2108) while most are lost.

**Defect 2 — memory commit blocked by a failing dedup probe (SECONDARY).**
- Even when extraction succeeds (`extraction.result` is firing, e.g. 00:58 facts:7), the `memory_controlled_write` stage fails its **dedup probe with `query_error`**, retries 5×, and drops the write ([505 `stage.failed`]). So distilled memories don't commit. This is a distinct query bug in the controlled-write path and needs its own root-cause (the exact failing query wasn't captured in the log fields — next step: enable query-error detail or reproduce).

**Recommended fix for Defect 1:** make the batched INSERT tolerate heterogeneous rows — either (a) pad every row to the full sessions column set (write explicit NULL/DEFAULT for absent usage columns so all rows are 19-wide), or (b) sub-group the flush by column-shape and emit one `buildInsertMany` per shape. Option (a) is simpler and matches the append-only schema (nullable usage columns already default to NULL). Add a regression test that flushes a mixed batch (user turn + assistant-with-usage turn) in one scope group.

---

## What was actually done

The full fleet is **running** (ports all `LISTENING`): honeycomb `:3850`, embeddings `:3851`, doctor `:3852`, hive `:3853`, nectar `:3854`. I queried their live HTTP endpoints and read the live state root `~/.apiary/`.

## Corrected root cause — the memory count and "Cursor not reporting" are the SAME bug, and it is **project-binding gating**, not a broken pipeline

Live `GET http://127.0.0.1:3850/health` (honeycomb):

```json
{ "status":"ok", "version":"0.8.0", "pipeline":"ok",
  "reasons":{ "storage":"reachable", "embeddings":"on", "schema":"ok", "portkey":"ok",
    "capture":{ "droppedEvents":28, "gated":{ "no_bound_project":105, "tenancy_unconfirmed":0 } },
    "memoryFormation":{ "committedSinceBoot":0 },
    "memoryQueue":"local", "memory":{ "enabled":true, "provider":"configured" } } }
```

Live `GET /api/diagnostics/kpis` (same value direct from honeycomb and via the hive BFF):

```json
{ "memoryCount":2108, "sessionCount":3323, "turnCount":3323,
  "teamSkillCount":0, "estimatedSavings":46499, "extra":{ "captureDroppedEvents":28 } }
```

**The pipeline is healthy** — `schema:ok`, `pipeline:ok`, `storage:reachable`, writer alive, embeddings on. There is **no `ALTER`/schema-heal failure** on the live daemon. The earlier report saw that error in the stale `~/.daemon/logs.db` from a 07-05 dogfood run; it is not the live state.

What is actually happening:

1. **`capture.gated.no_bound_project: 105`.** honeycomb gates every capture whose working directory is not a **bound project**. The gate is on ([`assemble.ts:1295` `boundProjectGate:true`](../../honeycomb/src/daemon/runtime/assemble.ts:1295); [`capture-handler.ts:672`](../../honeycomb/src/daemon/runtime/capture/capture-handler.ts:672)) — a `bound:false` scope returns `"no_bound_project"`, writes **no row and enqueues no job**.

2. **Only ONE path is bound.** `~/.deeplake/projects.json` binds exactly `C:\Users\mario\GitHub\the-apiary` → `the-apiary` (longest-prefix match with separator boundary, [`project-resolver.ts:536`](../../honeycomb/src/hooks/shared/project-resolver.ts:536), so subfolders are bound). The 105 gated captures came from **other repositories opened in Claude Code** — **NOT Cursor** (Cursor has captured nothing; see the harness-truth section). Gating is a **secondary** drain, layered on Defect 1 which drops even *bound* the-apiary captures.

**Net:** the prior "stalled writer / ALTER failure" story is retracted. The count is stuck **primarily** because of the variable-width batch-INSERT bug (Defect 1) dropping bound captures, **plus** the dedup-probe `query_error` (Defect 2) blocking memory commits, with project-binding gating a **secondary** drain on other-repo captures. All three run on a **healthy, running** daemon — no crash, no stall.

## Harness truth — grounded in the live harness API + on-disk wiring

`GET /api/diagnostics/harnesses` (live, honeycomb `:3850`):

| harness | installed | pluginEnabled | active | turnsCaptured | lastSeen |
|---|---|---|---|---|---|
| **claude-code** | true | true | **true** | **3342** | live |
| codex | true | false | false | 0 | null |
| **cursor** | true | false | **false** | **0** | **null** |
| hermes / pi / openclaw | false | — | — | 0 | — |

- **Every captured turn in the system is Claude Code (3,342).** codex and cursor have captured **zero**, ever.
- **Cursor IS hook-wired** (correcting the earlier reports AND the initial "no hooks" assumption): `~/.cursor/hooks.json` exists (1,302 B, all six Cursor-native events, each `_honeycomb:true` → `node ~/.cursor/honeycomb/bundle/<handler>.js`), handlers rebuilt 07-08 19:48, written by [`src/connectors/cursor.ts`](../../honeycomb/src/connectors/cursor.ts) (whose `configPath()` IS `~/.cursor/hooks.json`). *(What was likely checked before: `the-apiary/.cursor` — correctly none — and the `~/.cursor/hooks/` **directory**, not the `hooks.json` **file**.)*
- **Yet honeycomb has received zero Cursor events** — `turnsCaptured:0`, `lastSeen:null`, and **no "cursor" anywhere** in the live log DB (0 of 10,839 `event_log`, 0 of 100,134 `request_log`). The hooks are installed but **Cursor has never fired them.** `installed:true` is a pure `existsSync` marker ([`harness-detect.ts`](../../honeycomb/src/daemon/runtime/dashboard/harness-detect.ts)) — it proves a file exists, not that Cursor runs it. THAT is "Cursor installed but not reporting": present marker, never-fired hook.
- **CONFIRMED (Cursor side) — the hooks file is malformed and Cursor rejects it.** Cursor's Configuration Errors panel reports: *"Invalid hooks.json found… User hooks.json at `c:\Users\mario\.cursor\hooks.json`: Invalid user config: **Config version must be a number**."* honeycomb writes `hooks.json` **without a top-level `version`**, and its own contract schema wrongly marks it optional — [`references/cursor/hooks-schema.ts:118`](../../honeycomb/references/cursor/hooks-schema.ts:118) `version: z.number().optional()`. Real Cursor 1.7+ **requires** a numeric `version`, so it rejects the whole config and **disables every hook** → `turnsCaptured:0`. **This is the root cause of "Cursor installed but not reporting."**
  - **Fix (connector):** honeycomb's Cursor connector ([`src/connectors/cursor.ts`](../../honeycomb/src/connectors/cursor.ts)) must emit `"version": 1` at the top of `hooks.json`, and `references/cursor/hooks-schema.ts` should make `version` **required** (`z.number()`), with a regression test asserting the written file carries a numeric version. Until then any `honeycomb setup` re-run reintroduces the bug.
  - **Stopgap applied 2026-07-08:** `"version": 1` was added to the live `~/.cursor/hooks.json`. **This worked** — Cursor's own hook log (`~/AppData/Roaming/Cursor/logs/…/cursor.hooks.*.log`) then showed `beforeSubmitPromptHook`/`postToolUse` spans executing honeycomb's `capture.js`. But it exposed a SECOND bug (below). The stopgap is overwritten on the next `honeycomb setup`.
- **CONFIRMED Bug #2 (Windows) — Cursor's `/c:/…` workspace-root is never normalized, so every capture is gated.** Cursor v3.9.16 sends (verbatim, from its live hook log): `"workspace_roots": ["/c:/Users/mario/GitHub/the-apiary"]` — a POSIX-style path with a leading slash and lowercase drive. The Cursor shim uses `workspace_roots[0]` verbatim as cwd ([`shim.ts:69-71`](../../honeycomb/src/hooks/cursor/shim.ts:69)); `normalizePath` → `path.win32.resolve("/c:/…")` → **`C:\c:\Users\mario\GitHub\the-apiary`** (bogus `C:\c:\`), which does not match the binding `C:\Users\mario\GitHub\the-apiary`. Result: `bound:false` → **`no_bound_project` gate** → capture dropped, `turnsCaptured:0`, even though Cursor is open on the bound folder. *(A secondary drive-letter-case mismatch also applies: Cursor sends `c:`, the binding is `C:`, and the prefix match is case-sensitive.)*
  - **Proven:** `path.win32.resolve("/c:/Users/mario/GitHub/the-apiary")` = `C:\c:\Users\mario\GitHub\the-apiary` (no match). With the fix (strip a leading `/` before `<drive>:/`, then uppercase the drive) it resolves to `C:\Users\mario\GitHub\the-apiary` (matches).
  - **Fix (shim):** in `cursorDeriveMeta` ([`src/hooks/cursor/shim.ts:68`](../../honeycomb/src/hooks/cursor/shim.ts:68)) — or centrally in `normalizePath` ([`project-resolver.ts:515`](../../honeycomb/src/hooks/shared/project-resolver.ts:515)) — convert Cursor's `/c:/…` form to a native Windows path and canonicalize drive-letter case (Windows paths are case-insensitive; the whole prefix match should be case-insensitive on Windows). Add a Windows unit test with `workspace_roots:["/c:/…"]` asserting `bound:true`.
- **Net for Cursor:** two honeycomb bugs, both proven — (1) missing `version` (config rejected; stopgapped) and (2) unnormalized `/c:/` workspace-root (captures gated). #2 is the live blocker. Neither is a user-config problem.
- **"plugin" label is misleading.** The registry marks Cursor `runtimePath:"plugin (extension)"` ([`harness-registry.ts:107`](../../honeycomb/src/daemon/runtime/dashboard/harness-registry.ts:107)) and an extension source exists at `harnesses/cursor/extension/`, but honeycomb **does not install a Cursor extension** — capture is delivered via `hooks.json` + `~/.cursor/honeycomb/bundle/`. No plugin appears in Cursor's UI because none is installed. The dashboard's "plugin" wording and the Claude-specific `pluginEnabled` flag should not be shown for Cursor.

### Confirmed unchanged from the original memory report

- 2,108 memories from 3,323 sessions (~0.63/session) is the **expected** distillation ratio, not one-per-turn. ✔
- The `memory` vs `memories` table-name mismatch is **not** the cause (KPI reads the right table; a mismatch would show 0, not 2,108). ✔
- "Memory Health" empties when lifecycle engines are dormant; "Compact" reaps version history, not the memory corpus. ✔ (unchanged)

## nectar is idle — this is why the graphs and ROI enrichment are empty

Live `GET http://127.0.0.1:3854/health` (nectar):

```json
{ "status":"ok",
  "brooding":{ "active":false, "reason":"portkey_disabled" },
  "portkey":{ "enabled":false },
  "activeProjects":{ "count":0, "reason":"no-active-projects" },
  "watch":{ "running":false, "reason":"no-credentials", "state":"stopped" },
  "projection":{ "lastWriteAt":null } }
```

- **Brooding is off because Portkey is disabled** — this is the ground truth behind the Hive Graph "brood pipeline not wired" 501 (the graphs report's Portkey-gate finding, **confirmed live**).
- **nectar's watch is stopped for "no-credentials"** and there are **no active projects**, so nothing is being enriched or projected (`projection.lastWriteAt:null`). That is why the **Memory Graph has no `entities` rows** and why ROI **pollination is `absent`**.

## ROI: the data layer is NOT blank — the hero just can't compute

Live `GET /api/diagnostics/roi?project=the-apiary`:

```json
{ "savings":{ "status":"ok", "measuredCents":90947, "modeledCents":7975, "assumption":{ "signedOff":false } },
  "infra":{ "status":"partial", "cents":0 },
  "pollination":{ "status":"absent", "cents":0 },
  "net":{ "status":"partial", "computed":false, "netCents":0 },
  "rollups":[ /* org/team/agent/project all empty */ ] }
```

There *is* measured savings ($909.47), but `signedOff:false` (placeholder assumption) and `pollination:absent` → `net.computed:false`. So the ROI report's core finding stands (net can never compute without the usage/pollination meter), with the nuance that **savings has real data** — the page is not blank at the source, the **net hero** is what's dead.

## Architecture reconciliation — is telemetry funneled through doctor?

**Yes, for fleet health/telemetry — and it IS built and running** (correcting the initiative doc's stale "implementation not started"):

- Live `GET http://127.0.0.1:3852/status.json` returns per-daemon health, and hive's `GET /api/fleet-status` **consumes doctor** and lists doctor as `kind:"supervisor"`. Per-service state files exist at `~/.apiary/doctor/state-{hive,honeycomb,nectar}.json`. This is exactly [doctor ADR-0001](../../doctor/library/knowledge/private/architecture/ADR-0001-hive-telemetry-transport-and-single-source-of-truth.md): services write local SQLite → doctor polls + is SoT → one SSE to hive.

**But — by design — workload/product data does NOT funnel through doctor.** Per [hive ADR-0002] (BFF proxy) and nectar ADR-0004 ("hive holds no Deep Lake client; aggregates from daemon APIs"), the split is:

| Data | Path |
|---|---|
| Fleet health, health rail, buzzing screen, **live logs** | services → **doctor** (poll+SoT) → **one SSE** → hive |
| Memory count / KPIs, ROI, memories list, harnesses, sync, graphs | hive **BFF proxy** → honeycomb `:3850` / nectar `:3854` directly |

So the owner's mental model ("all telemetry through doctor, one connection to hive") is **correct for fleet health/telemetry/logs**, and intentionally **not** the path for product/workload data. The ROI report's "hive → honeycomb directly" was therefore correct for workload data, not a divergence from spec.

Two live health observations worth noting:
- doctor is holding an **unresolved escalation on hive**: `reinstall-primary` → `failed: "unverified-got-0.7.0"` → `recommendedAction:"manual-intervention"` (2026-07-08T11:43, `resolved:false`). A fleet-lifecycle/version issue to run down separately.
- `~/.daemon` (home) and `the-apiary/.daemon` (repo) are **orphaned legacy state** frozen at 07-05. Worth deleting to avoid future mis-diagnosis like the one this addendum corrects.

## Open questions (decisive, still unverified)

1. **Which repos were the 105 gated captures from?** Confirm the owner used Cursor in folders other than `C:\Users\mario\GitHub\the-apiary` today. If so, the fix is **binding those projects** (or a broader default-bind / inbox-capture policy), not a code change.
2. **Why is `memoryFormation.committedSinceBoot` 0 for the bound the-apiary sessions?** Is formation a scheduled/batched job that hasn't fired, is it error-gated, or have recent sessions simply not crossed the KEEP threshold? Watch `committedSinceBoot` over the next formation interval and check for a scheduled formation worker.
3. **Is `no-credentials` on nectar's watch expected?** nectar needs credentials to watch/enrich; determine whether that's a provisioning gap or intentional (Portkey disabled).
