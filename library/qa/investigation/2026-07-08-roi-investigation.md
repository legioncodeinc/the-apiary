# ROI — Investigation

**Date:** 2026-07-08
**Investigator:** QA agent (diagnose + recommend only — no code changed)
**Area:** ROI (Return-on-Investment) dashboard feature — PRD-060e
**Submodules touched:** `hive` (dashboard UI + BFF proxy), `honeycomb` (the ROI data engine), `nectar` (ruled out as the ROI source)

---

## Scope / symptom

Product owner, verbatim:

> "ROI — Completely not functional."

The task hypothesized that **nectar** is the ROI/telemetry/enrichment engine. That hypothesis is **false** (see "Is nectar the ROI engine?"). The ROI engine is **honeycomb**. The feature is not missing — it is largely built — but three separate wiring/stub gaps leave the flagship surfaces (the Net-ROI hero and the Trend chart) dead in every real deployment.

---

## What ROI is intended to do (inferred from code + JSDoc)

The `/roi` page is a **Net-ROI ledger** — "saved − (infra + pollination)" — with a deliberate "measured vs modeled" honesty language. It is a **pure function** of a composite `RoiView` the daemon assembles; the page does no compute (`hive/src/dashboard/web/pages/roi.tsx:1-33`, `672-754`).

Sections it renders:
- **Net ROI hero** — the headline dollar figure = savings − (infra + pollination), shown only when fully computed (`roi.tsx:314-359`).
- **Savings** — a *measured* cache-savings headline + a subordinate *modeled* memory-injection estimate + a blended `$/Mtok` rate (`roi.tsx:374-415`).
- **Cost** — infra cost + itemized pollination cost (Haiku-skillify + DeepLake GPU), with a cost-rising-is-not-green delta rule (`roi.tsx:459-500`).
- **Trend** — an inline-SVG line chart over time, solid = measured / dashed = modeled (`roi-chart.tsx`, whole file).
- **Rollups** — org / team / agent / project GROUP-BYs with per-user gating (`roi.tsx:536-627`).

Money is integer cents end-to-end; dollars are formatted only at the render edge (`roi.tsx:84-105`). So ROI is meant to show **dollar value saved, token spend, memory-reuse savings, skill/pollination cost, and net dollars**, sliced by dimension and over time.

---

## Data flow, end to end

1. **Page → wire.** `RoiPage` hydrates via SWR from `wire.roi(projectId)` and `wire.roiTrend(range, projectId)` (`roi.tsx:683-691`). On any failure it degrades to `EMPTY_ROI_VIEW` / `EMPTY_ROI_TREND`.
2. **Wire → hive endpoints.** `GET /api/diagnostics/roi` and `/api/diagnostics/roi/trend` (`hive/src/dashboard/web/wire.ts:162-163`, `2399-2406`).
3. **hive BFF proxy → owning daemon.** hive proxies all `/api/*` over loopback to the daemon that "owns" the path (`hive/src/daemon/proxy.ts:146-189`). Ownership is resolved by `resolveEndpointOwner` — **only `/api/hive-graph*` goes to nectar; everything else (including `/api/diagnostics/roi`) goes to honeycomb** (`hive/src/shared/daemon-routing.ts:11-15`). **Confirmed.**
4. **honeycomb serves it.** `/roi` + `/roi/trend` are mounted on the diagnostics group and call `fetchRoiView` / `fetchRoiTrendView` (`honeycomb/src/daemon/runtime/dashboard/api.ts:1268-1282`).
5. **honeycomb assembles the view.** `fetchRoiView` fans out (fail-soft) to: savings over the `sessions` token columns (060b), infra over the billing read-model (060c), pollination via the skillify usage meter (060d), and the `roi_metrics` ledger rollups (060f), then folds them in `assembleRoiView` (`api.ts:883-1010`).

**Where the chain breaks:** the chain reaches honeycomb fine. It breaks **inside honeycomb's assembly**, at three points below.

---

## Precise failure mode

From a product owner looking at the page, "completely not functional" = an all-dashes hero, an empty trend, and empty cost/pollination. Three independent, confirmed causes:

### 1. The Net-ROI hero can NEVER compute (structural). **Confirmed.**
The net is emitted only when **all three** of savings, infra, AND pollination are status `ok`:
```
netComputable = savingsPresent && infraConfident && pollinationConfident   // api.ts:985-988
```
Pollination confidence requires a **live Haiku-skillify usage meter** (`roiUsage`). But:
- The daemon composition root mounts the dashboard **without** `roiInfra` or `roiUsage` (`honeycomb/src/daemon/runtime/assemble.ts:1315-1320` — the options object passes only `storage`, `defaultScope`, `orgName`, `captureDroppedEvents`).
- With `roiUsage` absent, `fetchRoiView` falls back to `emptyUsageSource` (`api.ts:895`; `roi-skillify-meter.ts:210`).
- An empty usage snapshot makes the Haiku contribution status `absent` (`roi-pollination.ts:218-230`), so `composePollinationCost` is never `ok`.
- Therefore `pollinationConfident` is **always false** → `netComputable` is **always false** → the hero renders the dash + "net not computed yet" **in every deployment**, regardless of data.

Compounding this: **no live `SkillifyUsageSource` meter exists anywhere in the codebase.** A search for a production meter (`createSkillifyUsageMeter`/`UsageMeter`/a `.record(...)` accumulator) returns nothing under `src/daemon/runtime/skillify` — the only sources are `snapshotSource` (test helper) and `emptyUsageSource`. PRD-060d's "live meter" seam was left unimplemented, so even wiring `roiUsage` at the root has nothing to wire. **Confirmed.**

### 2. The Trend chart is a hard-coded stub. **Confirmed.**
`fetchRoiTrendView` ignores storage/scope/range and unconditionally returns `EMPTY_ROI_TREND`:
```
void storage; void scope;
return EMPTY_ROI_TREND;                                   // api.ts:1039-1051
```
The Trend panel therefore always renders "No trend history yet." The comment concedes it: "the real history read folds in here without a route/wire change."

### 3. Infra cost is un-wired at the root (degrades to dash). **Confirmed wiring gap; runtime status Hypothesis.**
Because `roiInfra` is not passed at the root (`assemble.ts:1315-1320`), `fetchRoiView` builds a **fresh** `createInfraCostReadModel()` per request (`api.ts:894`). That fresh model reads disk billing creds and calls the DeepLake billing API (`roi-billing.ts:343-400`). Consequences:
- If billing creds/endpoint are not provisioned for this workspace, infra is `unauthenticated`/`unreachable` → the Infra KPI shows a dash. (`~/.deeplake/credentials.json` exists locally, but whether it carries a working billing entitlement is unverified — **Hypothesis**.)
- The intended shared cache/singleton (the "daemon = sole billing egress" design in `api.ts:98-104`) is lost; every ROI poll re-hits billing.
- Even if infra reads `ok`, the hero still can't compute because of cause #1.

### What CAN show data (so the page is not 100% blank)
- **Savings** reads the `sessions` token columns directly (`api.ts:783-802`), which capture populates for Claude Code assistant turns carrying a `usage` block (`capture-handler.ts:826-833`; schema `sessions-summaries.ts:66-69`). So the measured cache-savings line shows real numbers for Claude Code usage; other harnesses trigger the "Claude Code only" partial badge.
- **Rollups** read `roi_metrics`, which the skillify worker appends once per session at completion (`skillify/worker.ts:369-390`; `roi-ledger.ts:260`) — but with `cost_basis:'none'`, `user_id:''`, and infra un-allocated, so rollup rows show savings with net ≈ savings and no real cost attribution. Rollups are empty until skillify has actually run.

**Net effect:** the two headline surfaces the product owner judges the feature by — the **Net ROI number** and the **Trend** — are dead by construction, and cost/pollination are dashes. That reads as "completely not functional" even though savings/rollups can carry partial data.

**Default/echo state:** if the honeycomb daemon is down or the endpoint 502s, the wire returns `EMPTY_ROI_VIEW` — every section `absent` (`hive/src/dashboard/contracts.ts:260-275`) → an all-dash page (not the auth gate, since `savings.status` is `absent`, not `unauthenticated`).

---

## Is nectar the ROI engine?

**No. Confirmed.**
- A full-text search of `nectar/src` for `roi|ROI|Roi` returns **zero** matches.
- nectar's own README describes it as a **file-identity / codebase-meaning enrichment engine** ("Every file in your repo gets a stable identity and a meaning your agents can recall"), and its runtime modules are `apiary-yield-model`, `hive-graph`, `enricher`, `projection`, `embeddings`, `brooding` — repo-graph enrichment, not dollar ROI.
- nectar is integrated with the dashboard **only** for the codebase graph: hive routes just `/api/hive-graph*` to nectar (`daemon-routing.ts:11-15`). The ROI page never touches nectar.
- nectar's "yield" vocabulary (`apiary-yield-model.ts`) is enrichment throughput, not the ROI ledger. Do not conflate them.

The ROI engine is **honeycomb** (`honeycomb/src/daemon/runtime/dashboard/roi-*.ts` — billing, ledger, savings, pollination, rates, skillify-meter, session-writer, honesty-contract).

---

## What it would take to make ROI real

Inputs an honest Net-ROI needs, and whether they're captured today:

| Input | Captured? | Where |
|---|---|---|
| Per-turn token/cache counts (savings) | **Yes**, for Claude Code | `sessions` columns via capture (`capture-handler.ts:826-833`) |
| Model/provider per turn (correct pricing) | **Yes** | `rowToCapturedTurn` (`api.ts:759-772`) |
| Per-session ROI ledger rows | **Yes**, when skillify runs | `roi_metrics` via `roiWriter` (`skillify/worker.ts:369-390`) |
| Infra/billing cost | **Partially** — model exists, not wired at root | `roi-billing.ts` |
| Pollination / own-inference (Haiku) usage | **No live meter exists** | only `emptyUsageSource` |
| Trend history series | **No** — read is a stub | `fetchRoiTrendView` (`api.ts:1039-1051`) |

Prioritized implementation path (no code changed here — targets only):

1. **[P0] Wire `roiInfra` + `roiUsage` into the composition root.** Pass both into `seams.mountDashboard(daemon, {...})` at `honeycomb/src/daemon/runtime/assemble.ts:1315-1320`. `roiInfra` should be the daemon's singleton `createInfraCostReadModel()` (restores the shared-cache "sole billing egress" design). This alone un-dashes infra and is the prerequisite for the net.
2. **[P0] Build the live Haiku-skillify usage meter (PRD-060d seam).** Implement a real `SkillifyUsageSource` that accumulates own-inference calls (the skillify gate model spend) and expose it as the singleton passed as `roiUsage`. Without this, `pollinationConfident` is永 false and the hero can never compute. Target: new meter under `honeycomb/src/daemon/runtime/skillify/` + `roi-skillify-meter.ts`; instantiate in `assemble.ts` and thread through. **This is the single biggest blocker to the headline number.**
3. **[P1] Implement `fetchRoiTrendView`.** Replace the stub (`api.ts:1039-1051`) with a real time-bucketed read over `roi_metrics` (and/or `sessions` token history) honoring `range` (7d/30d/90d) and `readPolicy`/`projectId`. The route, wire, and chart are already built and waiting.
4. **[P1] Verify billing entitlement end-to-end.** Confirm `~/.deeplake/credentials.json` carries a working billing scope so infra resolves `ok` rather than `unauthenticated`; otherwise infra (and thus net) stays dashed even after step 1.
5. **[P2] Cost attribution in the ledger.** The skillify writer records `cost_basis:'none'` and un-allocated infra, so rollup nets are savings-only. Decide the allocation model (measured vs allocated split) so per-team/agent/project nets mean something.
6. **[P2] Regression coverage.** Add a test asserting the composition root actually threads `roiInfra`/`roiUsage` (today nothing catches that they're dropped), and an integration test that a fully-populated fixture yields `net.computed === true`.

After steps 1–2, the hero computes; after step 3, the trend renders; steps 4–6 make the numbers trustworthy.

---

## Open questions / unverified

- **Billing entitlement (Hypothesis).** `~/.deeplake/credentials.json` exists, but I did not confirm it grants a working compute-usage/billing scope. If not, infra stays `unauthenticated` regardless of wiring.
- **Live `roi_metrics` population (unverified).** I did not query the DeepLake `roi_metrics` table directly to confirm rows exist for this workspace. Rollups depend on the skillify worker having actually run and completed sessions. (Note the memory: rows can land in `memories` vs `memory` under `HONEYCOMB_LOCAL_QUEUE_ENABLED`; a similar table-name/queue subtlety could affect whether `roi_metrics` is written where the read looks.)
- **Was `roiUsage`/`roiInfra` ever wired and later dropped?** Worth a `git blame` on `assemble.ts:1315-1320` to see whether the threading regressed vs never landed.
- **Trend "startedAt".** Even the stub trend could show "Savings tracked from {startedAt}" if `startedAt` were populated; it returns `""`, so it always shows the generic "No trend history yet."
- I did not drive the running dashboard in a browser to capture the exact `X-Hive-Cache` disposition / HTTP status of a live `/api/diagnostics/roi` call; findings are from code + local-state inspection.
