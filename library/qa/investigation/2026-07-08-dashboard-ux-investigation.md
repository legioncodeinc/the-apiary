# Dashboard, Projects & Memories UX — Investigation

**Date:** 2026-07-08
**Investigator:** QA agent (diagnose + recommend only — NO code changes made)
**Submodule:** `hive` (Electron dashboard UI) @ `10116dc`
**Area:** Dashboard layout · Projects page · Memories page UI/UX

All paths below are relative to `C:\Users\mario\GitHub\the-apiary\hive\`.

---

## Scope / symptoms (verbatim from the product owner)

1. "Live log is listed twice. Remove the box at the top, leave the live log at the bottom."
2. "Turns doesn't show anything valuable. Remove from dashboard."

> **⚠️ OWNER CORRECTION (2026-07-08):** Symptom 2 was mis-stated. The **Turns KPI STAYS.** The owner meant the **`SessionsPanel` box below the KPI row** (`dashboard.tsx:319-332`), not the Turns KPI. All recommendations below that said "remove Turns" are corrected: **keep the Turns KPI; remove the Sessions panel** (which this report already flagged as "data vomit").

3. "Overall, the dashboard (aside from KPIs, the quick harness view, and live logs at the bottom) doesn't show anything interesting or valuable. What should we surface on the dashboard? Graphs? ROI? More actions? The dashboard should be where I go for my quick overview — not a vomiting of data. I should be able to check that everything is working and drill down in other nav pages."
4. Projects page: "'Open' doesn't do anything. I can't view project details, nothing is clickable except unbind and 'open' which doesn't work."
5. Memories page: "When I search memories, instead of giving me a clickable surface like the one listed BEFORE you search, it gives me a search of sessions + memories and nothing is clickable. It should be memories only, and be the surface I can click to edit/forget/etc."

---

## Dashboard layout findings

### A. The live log renders twice (symptom 1)

There are **two `<LiveLog>` instances** mounted on the home page:

| Instance | Location | Feed | Verdict |
|---|---|---|---|
| **TOP box** (remove) | `src/dashboard/web/harness-strip.tsx:133` — `<LiveLog lines={streamLines} />` inside `HarnessStrip` | `streamLines` (short 5-line tail) | **Duplicate — remove** |
| **BOTTOM log** (keep) | `src/dashboard/web/pages/dashboard.tsx:335` — `<LiveLog lines={feed} />` | `feed` (8-line merged notes + daemon log) | **Keep** |

The "box at the top" the owner sees is the short-tail stream baked into the harness strip. Its data plumbing:
- `MAX_STREAM_LINES = 5` — `dashboard.tsx:55`
- `streamLines` memo — `dashboard.tsx:261` (`logLines.slice(0, MAX_STREAM_LINES)`)
- passed into the strip — `dashboard.tsx:315` (`<HarnessStrip harnesses={harnesses} streamLines={streamLines} />`)
- consumed — `harness-strip.tsx:98` (prop), `harness-strip.tsx:106` (destructure), `harness-strip.tsx:132-133` (render)

**To remove trivially:** delete `harness-strip.tsx:132-133` (the `<LiveLog>` + comment); drop the `streamLines` prop from `HarnessStripProps` (`harness-strip.tsx:97-99`) and the destructure (`harness-strip.tsx:106`); then clean the now-dead plumbing in `dashboard.tsx` (line 55 const, line 261 memo, and the `streamLines={streamLines}` arg at line 315). Both `LiveLog` instances share the same `wire.logs` poll, so removing the top one loses no data — the bottom log at `dashboard.tsx:335` already shows the same (longer) feed.

### B. The "Turns" KPI (symptom 2)

- Rendered at **`src/dashboard/web/pages/dashboard.tsx:273`**:
  `<Kpi label="Turns" value={kpis.turnCount || kpis.sessionCount} accent="neutral" />`
- It sits in the 4-up KPI row (`dashboard.tsx:271-276`, class `kpirow`). "Turns" is just the raw captured-turn count (`kpis.turnCount`, same value as `sessionCount` — see `wire.ts:210-212`). It carries no rate, no trend, no context — hence "shows nothing valuable."

**To remove trivially:** delete line 273. The row then renders 3 KPIs (Memories, Est. savings, Team skills). Check the `.kpirow` grid rule in `styles.css` — if it hard-codes 4 columns it should flex/auto-fit to 3 (low risk; most kit grids here use `repeat(auto-fit, …)`).

### C. Current dashboard inventory (what the home surfaces today)

Read top-to-bottom from `dashboard.tsx`. Assessed for "quick-overview" value:

| # | Item | Location | Quick-overview value |
|---|---|---|---|
| 1 | **Subsystem HealthStrip** (storage / semantic / schema / portkey chips) | `dashboard.tsx:268` (impl 144-162) | **High** — literal "is everything working" glance. Keep. |
| 2 | KPI: **Memories** | `dashboard.tsx:272` | **High.** Keep. |
| 3 | KPI: **Turns** | `dashboard.tsx:273` | **KEEP** (owner correction — Turns stays; the `SessionsPanel` goes instead). |
| 4 | KPI: **Est. savings** | `dashboard.tsx:274` | **High** (this is the ROI hook). Keep + add trend. |
| 5 | KPI: **Team skills** | `dashboard.tsx:275` | **Medium.** Keep. |
| 6 | **Recall bar + recalled cards** (center hero) | `dashboard.tsx:280-305` | **Medium** — signature action, but duplicates the Memories page search. Keep as hero OR demote to a quick-action. |
| 7 | **HarnessStrip** — chips + per-harness tiles ("quick harness view") | `dashboard.tsx:315` (impl `harness-strip.tsx:106`) | **High** — owner explicitly values this. Keep (minus its embedded log, item B/A). |
| 8 | **2-col grid**: `SessionsPanel` + `RulesPanel` (col 1), `SkillSyncPanel` (col 2) | `dashboard.tsx:319-332` | **Low — the "data vomit."** These are detail tables that belong on their own nav pages. Remove from home. |
| 9 | **LiveLog** (full, bottom) | `dashboard.tsx:335` | **Medium/High** — owner wants it kept. Keep. |
| 10 | **HarnessConnectCard** (connect/repair, self-hides when empty) | `dashboard.tsx:344` | **Situational.** Keep (it null-renders when nothing to report). |

The owner's instinct is correct: items 1, 2/4/5, 7, and 9 are the keepers; item 8 is the noise; item 3 goes.

---

## Projects findings (symptom 4)

### "Open" is wired, but it is a silent no-op from the user's point of view

- **Open button:** `src/dashboard/web/pages/projects.tsx:125-127` — `<Button … onClick={() => onOpen(project.projectId)} data-testid="project-open">Open</Button>`.
- **`onOpen` handler:** `projects.tsx:582-587`:
  ```
  setScope({ org: scope.org, workspace: scope.workspace, project: projectId });
  ```

That is the entire effect. Clicking **Open only mutates the shared scope context** (PRD-049e view scope). It does **not**:
- navigate anywhere (no `usePathRoute().navigate` call),
- open a project-detail view,
- render any toast/confirmation, or
- visibly change anything on the Projects page itself.

The scope change silently re-scopes *other* pages (Memories / Graph / Sync read `scope.project`), so to the user standing on the Projects page, "Open" appears to do nothing. It "works" only in the sense that if you then manually navigate to Memories, it's now filtered to that project.

### There is no project-detail view/route

`registry.tsx:214-244` lists every route. There is a `/projects` entry (`registry.tsx:219`, `PROJECTS_ROUTE`) but **no `/projects/:id` or project-detail route**. `matchRoute` (`registry.tsx:256-266`) would resolve any `/projects/<id>` deep path back to the parent Projects page. So a detail view does not exist — it was never built.

### Nothing else is clickable

Each row (`ProjectRow`, `projects.tsx:91-163`) is a plain `<div>` (`projects.tsx:116`) — not a button/link. The only interactive elements are the two `<Button>`s: **Open** (`:125`) and **Unbind** (`:128`). The metadata cells (bound path, git remote, last capture, counts — `:137-140`) are inert text. So the owner's "nothing is clickable except unbind and open" is literally accurate.

**Fix direction (no change made):** either (a) make **Open** navigate — after `setScope`, call `navigate("/memories")` (or a new detail route) so the click has a visible destination; and/or (b) build a real **project-detail** view (its data already exists on `ScopeProjectWire`: bound paths, remote, lastCapture, memoryCount, sessionCount) reachable by making the whole row clickable. Option (a) is the minimal honest fix for "Open does nothing."

---

## Memories findings (symptom 5)

### The pre-search surface IS the interactive one; search swaps it for a dead one

**Before search (clickable, correct):**
- Browse rows render via **`MemoryRow`** — `src/dashboard/web/pages/memories.tsx:114-146`, mounted at `memories.tsx:836-838`.
- `MemoryRow` is a real `<button>` (`:116`) → `onClick={() => onOpen(record.id)}` (`:120`) → `openDetail(id)` (`memories.tsx:648-661`) → renders **`DetailView`** (`memories.tsx:809-810`) which carries the **Edit** and **Forget** controls (`memories.tsx:289-311`).
- Edit/Forget wiring: `onEdit` → `wire.modifyMemory(id, {content, reason})` (`memories.tsx:689-707`); `onForget` → `wire.forgetMemory(id, {reason})` (`memories.tsx:710-720`). These hit the daemon HTTP routes (`POST /api/memories/:id/modify`, forget) — the same operations the MCP tools `memory_modify` / `memory_forget` expose, just via the local daemon wire, not the MCP surface directly.

**After search (non-clickable, wrong):**
- The `searchActive` branch renders **`MemoryCard`**, not `MemoryRow` — `memories.tsx:817-826`:
  ```
  hits.map((m, i) => (<MemoryCard key={m.memoryKey} {...m} pollinating={…} />))
  ```
- **`MemoryCard`** (`src/dashboard/web/primitives.tsx:336-…`) is a **plain `<div>` with no `onClick`/`onOpen`** (`primitives.tsx:351`). It is purely presentational — there is no path from a card to `openDetail`, so Edit/Forget are unreachable after a search.

### Why it becomes "sessions + memories"

Search calls a **different endpoint with a different shape** than browse:
- Browse: `wire.listMemories(limit, project)` → `GET /api/memories` → `MemoryRecordWire` rows that each carry a stable `.id` (editable memory rows).
- Search: `runSearch` (`memories.tsx:624-639`) → `wire.recall(q, project)` → `POST /api/memories/recall`. This is the fused UNION-ALL grep recall over **both** the `memory` summaries table **and** the raw `sessions` table. The returned `RecalledMemory` hits carry `kind: "memory" | "session"` (`wire.ts:495, 505-514`), and `MemoryCard` even renders a "session" tag for the raw ones (`primitives.tsx:397-399`). That is the "sessions + memories" the owner sees.
- The recall hit shape has `memoryKey` + `score` + `kind`, and for hits with no id the key degrades to `hit-N` (`wire.ts:2428`). A `kind: "session"` hit has **no editable memory id at all** — so even if the card were clickable, session hits could not open an editable detail.

**Root cause summary:** the search path was designed as a *relevance recall* (the dashboard's signature "recall" experience, reused from the home page) rather than a *filtered view of the editable memory list*. It intentionally renders ranked cards including session drill-downs, which is the opposite of what a memory-management search should do.

**Fix direction (no change made):**
1. Make search **memories-only** — filter `hits` to `kind === "memory"` (drop session rows) in `runSearch`/render (`memories.tsx:817-826`), or better, query a memories-only endpoint so session turns never enter this surface.
2. Render each memory hit as a **clickable row** (reuse `MemoryRow` semantics) that calls `openDetail(memoryKey)` — so the searched surface has the same edit/forget affordance as the browse list. `MemoryCard` should not be the search-result component on this page.

---

## Product recommendation — "what should the dashboard surface?"

**Design principle (matches the owner's ask):** the home is a **status board + launchpad**, not a data table. Every panel answers one of two questions — *"Is everything working?"* or *"Is this paying off?"* — and every detail table drills down to its own nav page. Nothing on the home should be a browsable list.

All data below is **already fetched by existing wire methods** — this is a re-layout, not new backend work.

### Available data (feasibility)
- **KPIs** — `wire.kpis(project)` → `memoryCount, turnCount, estimatedSavings, teamSkillCount` (`wire.ts:208-216`).
- **Health reasons** — already passed down (`healthReasons`), drives the subsystem strip (`dashboard.tsx:268`).
- **Harness telemetry** — `wire.harnesses()` → per-harness `installed / active / turnsCaptured / lastSeen` (drives the strip).
- **ROI** — `wire.roiView(...)` (savings / infra / pollination / **net** + org/team/agent/project rollups) and `wire.roiTrend(range, project)` → time-series points in cents (`wire.ts:404-417, 1905-1910`). **A ready-made, dependency-free SVG sparkline component already exists** — `RoiChart` in `src/dashboard/web/pages/roi-chart.tsx` (pure function of `RoiTrendView`). Dropping a net-ROI sparkline on the home is trivial.
- **Projects** — `wire.scopeProjects()` → bound projects with `memoryCount / sessionCount / lastCapture` (for a "capture freshness" glance).

### Proposed layout (top → bottom)

1. **Health-at-a-glance band** *(keep + elevate).*
   Keep the subsystem strip (`storage / semantic / schema / portkey`). Add a single derived headline — "All systems nominal" (verified) vs "N subsystems degraded" (critical) — so the answer to "is it working?" is one line, with the chips as the detail. The daemon pill already lives in the sidebar footer.

2. **4 headline KPIs with trend** *(keep Turns).*
   Turns · Memories · Est. savings · Team skills. **Turns stays** (owner correction). Give **Est. savings** a mini sparkline/delta from `roiTrend` ("+X tok this week"). This is the single most motivating number on the page.

3. **Net-ROI sparkline** *(new, high value — directly answers the owner's "ROI? Graphs?").*
   Reuse `RoiChart` with `wire.roiTrend`. One line: net ROI over time, with a "View ROI →" drill-down to `/roi`. This is the "is Honeycomb paying off" glance the home is missing today.

4. **Quick harness view** *(keep as-is, minus its embedded log).*
   The `HarnessStrip` chips + per-harness tiles (`dashboard.tsx:315`). Owner explicitly values this. Add "View harnesses →" to `/harnesses`.

5. **Top actions row** *(new — the "more actions" the owner asked about).*
   A compact button row: **Pollinate now** (already honest-acked on Memories/Settings), **Recall** (deep-link or inline), **Add memory** (→ `/memories`), **Add project** (→ `/projects`). Turns the home into a launchpad.

6. **Live log** *(keep — the single one, at the bottom).* `dashboard.tsx:335`, with "View logs →" to `/logs`.

**Removed from home:** the 2-col grid (`SessionsPanel` / `RulesPanel` / `SkillSyncPanel`, `dashboard.tsx:319-332`) — Sessions → the Logs/Turns page, Rules → its own surface, Skill-sync → `/sync`. Also the **top duplicate log** (symptom 1).

**Judgment call — the Recall hero (`dashboard.tsx:280-305`):** it duplicates the Memories-page search. Recommend **demoting** it to a compact quick-action in row 5 (or a slim inline bar) rather than the page centerpiece, freeing the vertical space for the ROI sparkline. If the owner wants recall to stay the signature hero, keep it — but then it should be the *only* memory surface on the home (no card list dump below it).

### Net effect
Home becomes: **health line → 3 trending KPIs → ROI sparkline → harness strip → action buttons → live log.** Every heavy table moves to its nav page with a "View →" affordance. That is "check everything is working + drill down elsewhere," not a data dump.

---

## Prioritized fix list (target files — NO code changes made)

| Pri | Fix | Target file(s) & lines |
|---|---|---|
| **P0** | Remove the duplicate top live log | `harness-strip.tsx:132-133` (render), `:97-99`/`:106` (prop); dead plumbing in `dashboard.tsx:55, 261, 315` |
| **P0** | Remove the **Sessions panel** (keep the Turns KPI) | `dashboard.tsx:319-332` (the `SessionsPanel`) |
| **P0** | Memories search → memories-only + clickable | `memories.tsx:817-826` (render), `:624-639` (`runSearch` — filter `kind==="memory"`); reuse `MemoryRow` (`:114-146`) → `openDetail` instead of non-clickable `MemoryCard` |
| **P1** | Projects "Open" gets a visible effect | `projects.tsx:582-587` (`onOpen` — add `navigate(...)` after `setScope`); wire a router `navigate` into the page |
| **P1** | Remove the 2-col data grid from home | `dashboard.tsx:319-332` |
| **P2** | Add Net-ROI sparkline to home | new use of `RoiChart` (`pages/roi-chart.tsx`) + `wire.roiTrend` in `dashboard.tsx` |
| **P2** | Add Est.-savings trend/delta to KPI | `dashboard.tsx:274` + `wire.roiTrend` |
| **P2** | Add "Top actions" row + per-panel "View →" drill-downs | `dashboard.tsx` (new row; harness/log/ROI drill-downs) |
| **P3** | Build a real Projects detail view + clickable rows | new route in `registry.tsx:214-244`; `ProjectRow` (`projects.tsx:91-163`) made clickable (data already on `ScopeProjectWire`) |

---

## Open questions

1. **KPI trend data:** `roiTrend` gives a savings/ROI time series, but there is **no count-over-time endpoint** for Memories or Team-skills. A "+N this week" delta on those two KPIs would need a new daemon aggregate (or a client-side snapshot diff). Confirm whether a trend is wanted on all KPIs or just savings/ROI.
2. **Recall hero vs Memories search:** should the home keep the Recall hero at all, given it overlaps the (to-be-fixed) Memories search? Owner's call — recommendation is to demote it.
3. **Projects "Open" target:** should Open navigate to `/memories` (scoped), or to a new project-detail page? Detail page is more work but is what "view project details" literally asks for.
4. **Memories search endpoint:** is a **memories-only search** route available/desired, or should the client just filter the existing `recall` hits to `kind==="memory"`? Filtering is the zero-backend fix; a dedicated endpoint is cleaner (session rows never cross the wire).
5. **Session drill-downs:** the raw `sessions` hits currently surfaced in Memories search are genuinely useful *somewhere* — should they move to the Logs/Turns page rather than being dropped entirely?
