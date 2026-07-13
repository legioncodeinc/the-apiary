# Issue Register

Living register of user-reported issues across the Apiary fleet (hive, honeycomb, doctor, desktop).
Each entry is grounded in code before it is accepted: symptom → root-cause chain with `file:line`
evidence → proposed fix. Keep appending; move entries to **Resolved** only after the fix is
verified end-to-end (not merely merged).

Conventions:

- IDs are sequential (`ISS-001`, `ISS-002`, …) and never reused.
- Paths are relative to the repo that owns them (`honeycomb/…`, `hive/…`).
- Status: `open` | `fix-proposed` | `in-progress` | `resolved` | `wontfix`.
- If a root cause turns out to be a recurrence of a systemic pattern, tag it (see Systemic Patterns
  at the bottom) instead of re-explaining it.

---

## Delivery log (2026-07-12 fix campaign — plan: waves 0-3)

- **Wave 0 (ops, this machine): done.** Portkey `activeModel` set, vault `memory.enabled`
  persisted, stale `HONEYCOMB_PIPELINE_*` HKCU vars removed (`POLLINATING_ENABLED` +
  `TOKEN_THRESHOLD` deliberately retained until the vault-threading fix lands), daemon restarted
  vault-driven. Memories form (8+ committed), semantic recall healthy after embed respawn.
- **Wave 1 PRs (security-cleared, QA "pass with warnings"):**
  honeycomb#297 `fix/route-and-registry-quick-wins` → ISS-012, ISS-021 (code), ISS-017, ISS-013
  (ack slice); hive#24 `fix/dashboard-quick-wins` → ISS-007 (display), ISS-019, ISS-009, ISS-013
  (UI slice). QA report: `library/qa/fleet-fix-waves/2026-07-12-wave1-qa-report.md`.
- **Wave 2 PRs (security PASS 0 Crit/High; QA in progress):** honeycomb#298
  `feat/value-proof-loop` (stacked on #297) → ISS-010, ISS-011, ISS-022 (memory_injections
  ledger, injectedTokens KPI, real ROI trend, partial net, 🐝 systemMessage, timeout 6s);
  hive#25 `feat/value-proof-ui` (stacked on #24) → UI side of the same.
- **Wave 3 (security PASS 0 Crit/High; QA PASS 0 Critical, 3 hive warnings):** honeycomb#300
  (Portkey fail-closed, MERGED), honeycomb#301 (embed liveness + queued-only cap after the Aikido
  Critical fix, MERGED), honeycomb#304 (live-config reload + appliedLive persist-honesty +
  serialized reloads after Aikido/M-304-1 fixes, awaiting Windows smoke), hive#26 (model-required
  UX, MERGED). QA report: `library/qa/fleet-fix-waves/2026-07-12-wave3-qa-report.md`.
- **Scanner findings resolved along the way:** CodeRabbit #297 Major (pollinating mount-time
  config guard) + Minor (deterministic dedupe winner); Aikido #298 (SQL-shape allowlists),
  #301 Critical (queued-only cap), #304 Critical (appliedLive honesty); security-audit M-304-1
  (reload serialization). Report-only accepted: memory_injections retention (follow-up),
  DEP0190 spawn shape (chip), L-304-2 local-mode origin guard on settings/secrets writes
  (follow-up recommended).
- **Wave-3 QA warnings W-1/W-2/W-3** (hive masks the daemon's new health truth — `no_model`
  →"off", unknown embeddings→"on" during the wedge window, stale restart copy) + plan item 4's
  hive half: being fixed in hive branch `fix/health-surface-honesty`.
- **ISS-021 physical rows: CLEANED 2026-07-12** (user-authorized). Direct DeepLake SQL via the
  daemon's own transport shape: per project, capture-canonical → DELETE → re-INSERT → verify
  count=1. Registry 6 rows → 2; live API verified one entry per project post-restart.
- **DEPLOYED 2026-07-12:** honeycomb 0.17.0 (main = #297+#298+#300+#301+#304) and hive 0.8.1
  (main = #24+#25+#26) installed globally + daemons restarted on this machine.
- **Dogfood verification (0.17.0/0.8.1):** formation live (committedSinceBoot 2 within minutes,
  extractionErrorsSinceBoot 0); lifecycle routes 200×3; pollinate ack honest
  (below-threshold, tokens 0/threshold 500); projects deduped; cursor D4 ok (logged in);
  `injectedTokens` live and climbing (2,036 → 3,054 within the session); recall semantic arm
  running (embedMs 23-44, annHits 3) — the coarse `degraded` flag now honestly reports the
  `memories`-table arm's lexical fallback (older corpus rows lack embeddings; backfill is a
  follow-up, not a regression); roi/trend honestly `absent` until roi_metrics rows accrue;
  🐝 systemMessage ships in the deployed hook bundle (visible from the next Claude Code session).
- All campaign PRs merged: honeycomb #297/#298/#300/#301/#304, hive #24/#25/#26. Open:
  hive `fix/health-surface-honesty` (QA W-1/2/3, in flight).

---

## ISS-001 — Adding a provider key requires a daemon restart before memories form

- **Status:** resolved 2026-07-12 (honeycomb#304 live-config reload, deployed 0.17.0: per-job live gate + reload seam on secrets/settings writes)
- **Reported:** 2026-07-12
- **Repo:** honeycomb
- **Systemic pattern:** SP-1 (boot-time snapshot of live state)

### Symptom

User adds an AI provider API key (for memory extraction/summarization). No memories are created
until the Honeycomb daemon is fully restarted.

### Root cause

The key **value** is read fresh per model call — that path is fine. What is frozen is the
boot-time decision about whether a provider exists at all:

1. At daemon boot, `buildPipelineWorker` checks provider-key presence once
   (`honeycomb/src/daemon/runtime/assemble.ts:2657-2692`) via a names-only secrets listing
   (`honeycomb/src/daemon/runtime/inference/model-client-factory.ts:258-269`). No network probe —
   just "does a secret with this name exist right now."
2. `resolveEffectiveExtractionProvider` then **collapses the `'auto'` extraction setting to a
   concrete value at that instant** — no key → `'auto'` is rewritten to `'none'`
   (`honeycomb/src/daemon/runtime/pipeline/config.ts:354-363`). The doc comment is explicit:
   "the worker calls this once, at boot" (`config.ts:337-338`).
3. The frozen config is captured in the pipeline stage handlers' closure
   (`honeycomb/src/daemon/runtime/assemble.ts:2729-2733`), so `isExtractionEnabled`
   short-circuits on `'none'` forever (`config.ts:329-334`) and extraction returns empty with no
   model call.
4. The secret-write handler (`POST /api/secrets/:name`,
   `honeycomb/src/daemon/runtime/secrets/api.ts:229-246` →
   `honeycomb/src/daemon/runtime/secrets/store.ts:255-278`) just writes the file and an audit
   line. It emits **no reload signal** and rebuilds nothing. `buildPipelineWorker` has exactly one
   call site — `start()` (`assemble.ts:3952-3984`).

Aggravating factors:

- The daemon already has a live-reload primitive built for exactly this class of bug —
  `honeycomb/src/daemon/storage/live-reload.ts:1-27` exists so `honeycomb login` / `project bind`
  are picked up without restart — but it is wired only to tenancy/storage config, never to the
  provider gate.
- The same boot-freeze applies to the vault `memory.enabled` toggle
  (`assemble.ts:2630-2632`) and the vault `activeProvider`/`activeModel` override
  (`assemble.ts:2462, 2191`): flipping memory on or picking a provider from the dashboard also
  requires a restart.
- The vault settings API (`honeycomb/src/daemon/runtime/vault/api.ts:40-113`) likewise persists
  without notifying the running worker.

### Proposed fix

Preferred (small, low-risk): stop collapsing `'auto'` at boot. Remove the
`resolveEffectiveExtractionProvider(...)` snapshot at `assemble.ts:2692` and have the extraction
stage evaluate `isExtractionEnabled(config, providerConfiguredNow)` per job, where
`providerConfiguredNow` is a live `secretsStore.listSecretNames(scope)` presence check (names
only, no decrypt) wrapped in the existing `live-reload.ts` mtime/TTL debounce keyed on the
`.secrets/<scope>` dir. The `RouterModelClient` already resolves the key value per call, so
extraction starts on the next captured turn after the key is added.

Additionally (fixes the parallel dashboard-toggle freezes): have `POST /api/secrets/:name` and the
`/api/settings` writes for `activeProvider` / `memory.enabled` fire an in-process reload seam that
re-runs the gate / rebuilds the model client.

---

## ISS-002 — Memory Graph view never populates

- **Status:** in-progress 2026-07-12 (product decision approved: graph persistence follows the memory switch; honeycomb `feat/memory-graph-default-on` + hive `feat/graph-page-honesty` in flight)
- **Reported:** 2026-07-12 (recurring; previously logged as BUG-12 in
  `library/qa/investigation/2026-07-09-confirmed-bugs-and-fixes.md:182-186` and
  `library/qa/investigation/2026-07-08-graphs-investigation.md:17-44`)
- **Repos:** hive (renderer), honeycomb (data)
- **Systemic patterns:** SP-2 (default-off feature behind stacked env flags), SP-3 (silent
  empty-state degradation)

### Symptom

The Memory Graph page in the hive dashboard shows the empty state even though memories exist.

### Root cause

The view is implemented and wired correctly end-to-end; its **source tables are simply never
written**.

Data path (verified working):

- UI: `hive/src/dashboard/web/pages/graph.tsx:449-511` fetches `wire.memoryGraph(project)` on a
  poll interval; `!graph.built` → empty state.
- Client: `hive/src/dashboard/web/wire.ts:2389-2394` → `GET /api/diagnostics/memory-graph`.
- Server: `honeycomb/src/daemon/runtime/dashboard/api.ts:1190-1195` →
  `fetchMemoryGraphView` (`api.ts:525-547`), which reads `entities` (nodes) and
  `entity_dependencies` (edges) — `api.ts:555-575`. Zero entity rows → `{ built: false }`
  (`api.ts:532`).

Note: the graph reads **neither** the `memories` nor the `memory` table, so the previously
suspected `memory`/`memories` table-name mismatch is a red herring **for this view** (it remains a
real naming hazard elsewhere — see `honeycomb/src/daemon/storage/catalog/memories.ts:183` vs
`catalog/sessions-summaries.ts:146`).

Why the tables are empty — the writer stage is quadruple-gated, all default off:

1. `HONEYCOMB_PIPELINE_GRAPH_ENABLED` — default `false`
   (`honeycomb/src/daemon/runtime/pipeline/config.ts:120-125`, env mapping `config.ts:272-275`).
2. `HONEYCOMB_PIPELINE_GRAPH_EXTRACTION_WRITES` — default `false`, same location. **This second
   flag is the easy-to-miss trap**: the vault/dashboard memory toggle overrides only the master
   `enabled` (`assemble.ts:2630-2632`), not the graph sub-gates. Both must be on or
   `graph-persist` returns early (`honeycomb/src/daemon/runtime/pipeline/graph-persist.ts:433`).
3. Upstream prerequisite: `HONEYCOMB_LOCAL_QUEUE_ENABLED` must be on for pipeline jobs to process
   at all (`assemble.ts:2979-2984` warns "memories may not form").
4. Upstream prerequisite: a working extraction provider (see ISS-001). Graph jobs are only
   enqueued for committed memories that carried entity triples
   (`honeycomb/src/daemon/runtime/pipeline/fan-out.ts:240-243`).

No env file in the repo sets any of these (only `honeycomb/.env.local.bak` exists, containing
Deep Lake creds + an Anthropic key).

Silent-failure aggravator — every layer degrades to an indistinguishable empty graph:

- `selectRows` returns `[]` on query error (`dashboard/api.ts:198-201`).
- Client falls back to `EMPTY_GRAPH` on any HTTP/parse failure (`wire.ts:2280, 2393`).
- The write handler catches all storage errors and logs non-fatally
  (`graph-persist.ts:530-538`); gate-off logs only an info-level `graph_persist.gated_off`
  (`graph-persist.ts:433-436`).

Latent secondary risk (verify after enabling): writes stamp scope from the pipeline job
(`graph-persist.ts:444`, `fan-out.ts:247`) while the dashboard read resolves scope per request —
a partition mismatch would also read empty. Check with a direct
`SELECT count(*) FROM "entities"` under the dashboard's scope once the gates are on.

### Proposed fix

1. Product decision: graph persistence should be on by default when memory is enabled, or at
   minimum surfaced as a Settings toggle — not buried behind two undocumented env vars.
2. Collapse the two graph gates into one user-facing switch; have the vault memory toggle imply
   it (or expose it beside it).
3. Make the graph page report *why* it is empty (gates off / no memories yet / query error)
   instead of a generic empty state — the server knows which condition holds.

---

## ISS-003 — Hive "Project" switcher binds nothing; `honeycomb status` shows `__unsorted__`

- **Status:** partially resolved 2026-07-12 (#304 fixed the boot-tenancy capture — binds land under request-time workspace; the switcher-as-bind UX redesign remains open)
- **Reported:** 2026-07-12
- **Repos:** hive (UI), honeycomb (binding store + secondary bug)
- **Systemic patterns:** SP-4 (UI misrepresents system state), SP-1 (boot-time snapshot — see
  secondary bug)

### Symptom

User selected a project via the hive dashboard's "Projects" tab / "Project" switcher, then ran
`honeycomb status` in the project directory: binding showed `__unsorted__`. Memories would land in
the inbox until the project is bound with the CLI.

### Root cause

Hive has **two project UI elements that look like they bind, and only one does**:

**The Project switcher dropdown is a pure view filter — it persists nothing the daemon reads.**

- Selection calls `selectProject` → `commitScope` → `persistScope`, which writes **only**
  `localStorage["honeycomb.dashboard.scope"]`
  (`hive/src/dashboard/web/scope-context.tsx:448-454, 286-293, 201-209`).
- The module doc says outright: "there is NO write to `projects.json` anywhere in this module"
  (`scope-context.tsx:19-24`).
- Its only server effect is the `x-honeycomb-project` read header that scopes what is *displayed*
  (`hive/src/dashboard/web/wire.ts:186-191`). A small "view filter" hint exists in the UI
  (`scope-context.tsx:609-627`) but does not prevent the misread.

**`honeycomb status` resolves against `~/.deeplake/projects.json`, which the switcher never
touches.**

- Resolution precedence: longest-prefix folder binding → git-remote match → `__unsorted__` inbox
  fallback (`honeycomb/src/hooks/shared/project-resolver.ts:564-609`); status output at
  `honeycomb/src/commands/status.ts:163-186`.
- The CLI bind path writes `bindings[]` via `bindFolderToProject` → `saveProjectsCache`
  (`project-resolver.ts:387-420, 319-327`; CLI entry `honeycomb/src/cli/project.ts:242-274`).

**The Projects tab's `+ Add → New folder` picker IS wired for real** — it is the dashboard path
that works:

- `hive/src/dashboard/web/pages/projects.tsx:612-617` → `FolderPicker.confirm`
  (`hive/src/dashboard/web/folder-picker.tsx:153-168`) → `wire.bindProject`
  (`wire.ts:3013-3021`) → hive BFF proxy (`hive/src/daemon/proxy.ts`,
  `hive/src/shared/daemon-routing.ts:11-14`) → honeycomb
  `POST /projects/bind` (`honeycomb/src/daemon/runtime/projects/onboarding-api.ts:325-347`) →
  `writeBind` (`onboarding-api.ts:450-474`) → the **same** `bindFolderToProject` writer the CLI
  uses.

So "binding only works via the CLI" is almost true: it also works via the Projects-tab folder
picker, but not via the switcher — which is what a user naturally reaches for.

**Secondary bug (real even on the working path):** `mountOnboardingApi` dereferences
`scope.org` / `scope.workspace` into plain strings at boot
(`honeycomb/src/daemon/runtime/assemble.ts:3574-3582`), even though `scope` is otherwise a live
re-resolving object (`assemble.ts:2898-2910`). A dashboard bind performed after a login/workspace
switch is written under stale tenancy, and the read-side tenancy guard
(`project-resolver.ts:709-712`) then discards the whole cache → `__unsorted__` even when the user
did everything right, until the daemon restarts.

### Proposed fix

1. Make the switcher either (a) trigger/offer a real bind for the relevant folder, or (b) be
   visually demoted to an explicit filter with a "Bind this folder…" CTA that routes into the
   Projects-tab bind flow. The current tiny hint text is insufficient.
2. Fix the boot-tenancy capture: `mountOnboardingApi` should read `scope.org` /
   `scope.workspace` live at request time instead of capturing strings at mount
   (`assemble.ts:3574-3582`).
3. After binding via dashboard, surface the resulting binding state (e.g. echo what
   `honeycomb status` would report) so the user gets confirmation the bind is real.

---

## ISS-004 — Overall hive implementation quality (meta-finding)

- **Status:** open (tracked via the systemic patterns below)
- **Reported:** 2026-07-12

The plumbing is mostly not broken — ISS-001..003 all trace to recurring systemic patterns rather
than missing code. Hive dashboard: ~109 TS/TSX files, ~27.6k lines, 81 test files; the former
`ComingSoon` placeholder slots (logs, settings, sync) have been replaced with real pages. The
issues are architectural habits, catalogued below so future entries can tag them instead of
re-explaining.

## ISS-005 — Fresh install + Portkey key: memories never form

- **Status:** resolved 2026-07-12 (#300 fail-closed + #304 reload, deployed 0.17.0; formation verified live, `extractionErrorsSinceBoot` in /health, D4-class honesty)
- **Repos:** honeycomb (daemon), hive (settings UI)
- **Systemic patterns:** SP-1, SP-3, SP-5

### Symptom

Fresh install, memory formation enabled, Portkey config + key added — zero memories form.
Requirement: install → turn memories on → memories form.

### Root cause (live-verified on this install)

The pipeline is fully enabled and running. **All 373 extraction jobs reached the Portkey gateway
and were rejected because the daemon sends `"model": ""` on every call.** Chain:

1. `readPortkeySelection` reads `portkey.enabled`, `portkey.config`, and `activeModel` — a
   missing `activeModel` silently becomes `model: ""` with no validation
   (`honeycomb/src/daemon/runtime/assemble.ts:2227-2248`, esp. 2239-2240).
2. `activeModel` was never saved: hive's Portkey model field is optional free-form text
   (`hive/src/dashboard/web/panels.tsx:640-668`; catalog `models: []`,
   `catalog.ts:84-92`), and the settings validation requires `portkey.config` but never
   `activeModel` (`honeycomb/src/daemon/runtime/vault/api.ts:283-299`).
3. `toPortkeyBody` sends the empty model verbatim
   (`honeycomb/src/daemon/runtime/inference/transport-portkey.ts:192-202`); the gateway rejects;
   `recordPortkeyUnreachable` discards the HTTP status (`assemble.ts:3185-3187`) so health shows
   the misleading `portkey: "unreachable"` (network is fine — gateway answers in 0.13s).
4. `RoutingExhaustedError` is swallowed by extraction (`extraction.ts:283-288`): logs
   `extraction.model_error` (213 occurrences in `event_log`), returns `EMPTY_RESULT`, and the job
   completes **"done"** — 373/373 jobs "succeeded" with zero facts. No retry, no dead-letter, no
   health counter (`memoryFormation.committedSinceBoot: 0` is the only tell).
5. The dashboard memory toggle acks `appliesOnRestart: true`
   (`honeycomb/src/daemon/runtime/actions-api.ts:256-286`) — boot-only, no reload seam (SP-1).
6. This machine additionally has stale HKCU user env vars from prior debugging
   (`HONEYCOMB_PIPELINE_ENABLED`, `HONEYCOMB_PIPELINE_EXTRACTION_PROVIDER=anthropic`,
   `HONEYCOMB_POLLINATING_*`) that override vault-first semantics.

Notes: Portkey **is** a fully supported provider (PRD-063). The old `HONEYCOMB_LOCAL_QUEUE_ENABLED`
concern is resolved — local queue is default-on in current code
(`hybrid-job-queue.ts:46-65`, confirmed live).

### Proposed fix

1. Validate/require `activeModel` when `portkey.enabled=true` (vault API write + hive field
   required + fail-closed in `readPortkeySelection` with a typed `portkey: "no_model"` health
   state). Never POST `model: ""`.
2. Persist the HTTP status in `recordPortkeyUnreachable`; surface `unreachable(401)` vs `(400)`.
3. Add `extractionErrorsSinceBoot` beside `committedSinceBoot` so "213 errors / 0 commits" is
   visible instead of green.
4. Reload seam on writes to `portkey.*` / `activeProvider` / `activeModel` / `memory.enabled` /
   `PORTKEY_API_KEY` (kills `appliesOnRestart`; also fixes ISS-001's boot collapse).
5. This machine: remove stale HKCU `HONEYCOMB_PIPELINE_*` / `HONEYCOMB_POLLINATING_*` env vars,
   set a Portkey model in Settings, restart once.

---

## ISS-006 — Search does not return the memories the /memories list shows

- **Status:** in-progress 2026-07-12 (revised acceptance criteria: actionability parity primary, corpus parity secondary; honeycomb `fix/search-list-corpus-parity` + hive `fix/search-result-card-parity` in flight)
- **Repos:** honeycomb (recall SQL + scope), hive (add-memory form)
- **Systemic patterns:** SP-3

### Symptom

/memories shows clickable memories before searching; typing a search fails to return those same
memories.

**User clarification 2026-07-12 (the ACTUAL complaint): search returns a different RESULT TYPE
than the list.** Browsing /memories renders interactive memory cards — clickable, nicely
presented, with **edit** and **forget** actions. Searching renders inert recall hits (text +
score) that cannot be clicked, edited, or forgotten. Same page, two object types.

**Acceptance criteria (revised):**
1. **Presentation parity (primary):** a memory returned by search renders as the SAME interactive
   card as the pre-search list — clickable, edit, forget — which requires recall hits to carry
   actionable memory identity (id/source) end to end.
2. **Corpus parity (secondary, still real):** any memory visible in the pre-search list must be
   findable by search when the query matches its content — same table, same scope semantics,
   tokenized matching on top.

### Root cause (two independent divergences, both live-proven)

**1. Whole-phrase ILIKE fallback.** The list is a plain
`SELECT … FROM "memories" ORDER BY created_at DESC` (`reads.ts:190-202` via
`honeycomb/src/daemon/runtime/memories/api.ts:871-895`). Search's lexical arm matches
`content ILIKE '%<ENTIRE QUERY STRING>%'` — the query is never tokenized
(`buildMemoriesArmSql`, `honeycomb/src/daemon/runtime/memories/recall.ts:416-434`). Live proof:
a 5-word query whose every word appears in a listed memory → 0 hits; an exact substring → 1 hit.
With semantic search silently dead (ISS-007), every natural-language search runs *only* this
substring match. Despite comments saying "BM25 fallback", there is no BM25.

**2. Project-scope asymmetry + orphaned inbox rows.** With no project header/cwd,
`GET /api/memories` treats degraded resolution as **no filter** (shows everything,
`api.ts:877-888`) while `POST /recall` treats it as **inbox-only**
(`scope.ts:116-118`, project clause `scope-clause.ts:360-400`). Opposite fallbacks for the same
input. Additionally, rows stored without cwd (MCP `memory_store`, and hive's Add form —
`wire.ts` `addMemory` sends neither cwd nor project header) land in `__unsorted__` and are
invisible to any project-scoped list *and* search (live-proven with
`mem_mrhxs5hh_491kqe1b`).

### Proposed fix

1. Tokenize the lexical fallback (per-term ILIKE conjuncts or the Deep Lake BM25 index) in
   `buildMemoriesArmSql` and siblings.
2. Make the degraded-project fallback identical for list and recall.
3. Stamp the selected project (or cwd) on hive's `addMemory` POST.

---

## ISS-007 — All search scores show 0.00 / semantic search silently dead

- **Status:** resolved 2026-07-12 (hive#24 score precision + honeycomb#301 liveness state machine, both deployed; wedge class eliminated — NEW observation: `memories`-table semantic arm falls back lexically pending embedding backfill of the older corpus, tracked as follow-up)
- **Repos:** hive (display), honeycomb (embed supervisor + embed daemon)
- **Systemic patterns:** SP-3, SP-5

### Symptom

Every search result shows score 0.00; behavior suggests lexical fallback despite embeddings on.

### Root cause (two independent bugs, live-verified)

**1. Display truncation.** The server returns real, honest scores — but they are RRF-fused values
scaled by `weight/(60+rank)` (max ≈ 1/61 ≈ 0.0164) times a recency-activation factor; live values
run 0.0008–0.05 (`fuseHits` RRF_K=60, `recall.ts:238, 592-653`). The UI renders
`score.toFixed(2)` (`hive/src/dashboard/web/primitives.tsx:425`) → everything prints "0.00".

**2. Wedged embed daemon + stale health latch.** The embeddings child (port 3851) is **wedged —
accepts TCP, never replies** (live: `POST /embed` and even `GET /health` hang 30s). Recall's
`boundedEmbed` times out at 3s (`recall.ts:1357-1375`,
`recallHeavyEmbedDeadlineMs=3000`, `amplification-config.ts:87`) → semantic arms return null →
every response is `degraded: true`. Meanwhile `/health` reports `embeddings: "on"` because the
supervisor's `warm` flag is a one-shot latch set at warmup with no liveness probe
(`embed-supervisor.ts:362-373`). `recall.degraded` / `embed.failed` events go to a ring buffer
with no HTTP surface (`logger.ts:136`). Underlying wedge: `embed-daemon.js:68` runs
transformers.js inference on the event loop inside a plain `createServer` handler, so a
backlogged inference blocks even `/health`.

### Why doctor doesn't heal this (fleet-level addendum, 2026-07-12)

Doctor's only sensor for honeycomb is `GET http://127.0.0.1:3850/health`
(`doctor/src/health-probe.ts:1-23`). The probe itself is well built for wedge detection — it
distinguishes `unreachable-refused` (down → restart) from `unreachable-timeout` (socket accepted,
never answered → wedged), and it parses a per-subsystem `reasons.embeddings` field specifically
so "a degraded with a specific subsystem reason routes to the matching rung rather than a blind
restart" (`doctor/src/supervisor.ts:16-18`). Doctor is ready to receive exactly this signal.

It never receives it, because honeycomb's `/health` reports the embeddings field as **"the
embed-seam state KNOWN AT ASSEMBLY"** — its own doc says so
(`honeycomb/src/daemon/runtime/health.ts:24`) — i.e. the same one-shot boot latch
(`embed-supervisor.ts:362-373`). The wedged child (:3851) accepts TCP, honeycomb's main daemon
answers 200 `status: ok`, doctor classifies `kind: "ok"`, and no remediation rung ever fires.
Doctor never probes :3851 directly (no reference to the embed port anywhere in `doctor/src`),
and its Wave-0 ladder has only whole-service restart anyway (`supervisor.ts:16-18` — "rungs 2+
are later-wave"). Meanwhile the daemon's own `recall.degraded`/`embed.failed` events go to a ring
buffer with no HTTP surface (`logger.ts:136`), so no layer of the fleet — daemon health, hive
dashboard, doctor, or the user — ever sees the outage. Three systemic patterns compounding:
SP-1 (latch), SP-3 (silent degradation), SP-5 (fail-soft).

### Proposed fix

1. UI: render 3 significant digits or normalize to the top hit (`primitives.tsx:425`).
2. Supervisor: periodic health probe with timeout → mark failed + respawn (respawn machinery
   exists; only wedge *detection* is missing). This is the primary heal — honeycomb owns its
   child.
3. Honeycomb `/health`: derive `reasons.embeddings`/`embeddingsState` from the live liveness
   probe result, not the assembly-time latch. Doctor then gets the degraded signal for free and
   its existing ladder becomes the backstop (restart daemon → supervisor respawns child).
4. Embed daemon: move inference off the event loop (worker) or answer `/health` unconditionally.
5. Now: kill the wedged embed child so the supervisor respawns it.

---

## ISS-008 — Memory search from hive takes 40-70s

- **Status:** resolved 2026-07-12 (#301 deployed: fast-skip when not warm, live embedMs 23-44ms, bounded deadlines)
- **Repos:** honeycomb
- **Systemic patterns:** SP-5

### Symptom

Searching from the hive dashboard takes 40-70 seconds.

### Root cause (measured live)

- Hive proxy overhead is negligible (+0.3s measured; `hive/src/daemon/proxy.ts` streams).
- Every search pays a **flat 3s penalty** from the wedged embed daemon (ISS-007): it accepts the
  connection and never replies, so `boundedEmbed` always burns the full 3000ms deadline (a *down*
  embedder would fail instantly — wedged-but-listening is the worst case).
- Variable 2-15s from 4 lexical arms + rerank/dedup fetches through the `Semaphore(5)` transport
  with retry; cold Deep Lake segments measured at 17.4s first-run → 7.4s → 2.0s warm. Current
  ceiling ≈ 3s + `recallHeavyDeadlineMs=15000` ≈ 18s (`amplification-config.ts:78`).
- The 40-70s class matches the **pre-deadline behavior documented in the code itself**
  ("the measured 25-minute tail", `recall.ts:1346-1352, 2501-2508`), fixed in the deployed
  0.13.0 bundle (verified by grep). If 40-70s recurs, suspect a stale daemon process from before
  the update or stacked sequential searches.

### Proposed fix

Restart the embed child (removes the flat 3s); skip the embed attempt when the supervisor hasn't
confirmed liveness recently; optionally use `fast: true` for the dashboard search like the
per-turn hook does. Residual cold-Deep-Lake tail is already deadline-bounded.

---

## ISS-009 — Live-logs panels on too many pages

- **Status:** resolved 2026-07-12 (hive#24, deployed 0.8.1)
- **Repo:** hive

Live logs should exist only on /logs. Current mounts of `LiveLog`
(`hive/src/dashboard/web/panels.tsx:413`) and variants:

| Page | Mount | Note |
|---|---|---|
| /dashboard (full log) | `pages/dashboard.tsx:335` | polls /api/logs at 2.5s |
| /dashboard (5-line tail) | `harness-strip.tsx:133` via `dashboard.tsx:315` | second instance, same data |
| /harnesses | `pages/harnesses.tsx:369, 400` | own poll |
| /sync | `pages/sync.tsx:488` (SSE tail, :416) | |
| /health | `pages/health.tsx:283` (`LiveLogTail`, :227) | fleet telemetry, not /api/logs |
| /memories | `pages/memories.tsx:537-543, 604-621` | opt-in "Watch" panel |
| /logs | `pages/logs.tsx` | canonical home — keep |

Fix: remove/prune the dashboard ×2, harnesses, sync, health mounts (memories "Watch" is opt-in —
user call).

---

## ISS-010 — /roi page: estimated-savings needle never moves

- **Status:** resolved 2026-07-12 (#298 real trend + partial net, deployed; trend honestly reports `absent` until roi_metrics rows accrue)
- **Repos:** honeycomb (stub endpoints), hive (renders payload faithfully)
- **Systemic patterns:** SP-3, SP-6

### Root cause (live-curled)

`GET /api/diagnostics/roi` actually returns moving savings data (measured $2,001.46 /
modeled $120). The two things that literally never move:

1. **Trend chart is a hardcoded stub**: `fetchRoiTrendView` ignores storage/scope/range and
   unconditionally returns `EMPTY_ROI_TREND`
   (`honeycomb/src/daemon/runtime/dashboard/api.ts:1039-1051`; route :1275-1282). The UI then
   shows "No trend history yet" forever (`hive/src/dashboard/web/pages/roi.tsx:725-737`,
   `roi-chart.tsx:119-127`).
2. **Net-ROI hero can never compute**: `assembleRoiView` requires savings AND infra AND
   pollination all `"ok"` before `computed:true` (`api.ts:985-1008`). Live: infra `"partial"`,
   pollination permanently `"absent"` (no skillify usage data — see ISS-015; `emptyUsageSource`
   default `api.ts:895`) → `computed:false` forever.

### Proposed fix

Implement the trend read off the `roi_metrics`/`roi_sessions` ledger (`roi-session-writer.ts`
already persists per-session token buckets + cents); let net compute with `partial` inputs behind
an honest badge. UI components are pure functions of the payload and will move when data does.

---

## ISS-011 — /dashboard "EST. SAVINGS" should be tokens injected via recall

- **Status:** resolved 2026-07-12 (#298/hive#25 deployed: memory_injections ledger + Tokens-injected tile; live counter at 3,054 tok and climbing)
- **Repos:** honeycomb, hive

Current formula is corpus mass, not injections: `SUM(LENGTH(content))` over the entire `memories`
table ÷ `CHARS_PER_TOKEN = 4`
(`fetchEstimatedSavings`, `honeycomb/src/daemon/runtime/dashboard/api.ts:294-317, 218`; rendered
`hive/src/dashboard/web/pages/dashboard.tsx:274`).

What exists toward injected-token tracking:

- `memory_access` table records one `(at, usefulness, kind='recall')` row per access — **no token
  count** (`memories/access-log.ts`, `catalog/memory-lifecycle.ts:69-90`).
- The prime digest computes a per-response token estimate but never persists it
  (`memories/prime.ts:92-93, 131`).
- `sessions` rows carry real captured token columns (total LLM usage, not injection-specific).

Fix: persist the token estimate at the two injection points (recall response assembly + prime
digest) — a `tokens` column on `memory_access` or a counter row — then point
`fetchEstimatedSavings` at its SUM.

---

## ISS-012 — `GET /api/memories/conflicts` and `/stale-refs` 404

- **Status:** resolved 2026-07-12 (#297 deployed: all three lifecycle routes 200 verified live)
- **Repo:** honeycomb
- **Systemic patterns:** SP-7 (route shadowing — recurrence of documented bug #255)

### Root cause (live-localized)

Not a proxy issue (hive proxy returns byte-identical 404s to direct curls). The 404 body is
`{"error":"not_found","id":"conflicts"}` — i.e. the **`GET /api/memories/:id` handler** ate the
request. `mountMemoriesApi` registers parametric `/:id`
(`honeycomb/src/daemon/runtime/memories/api.ts:974`, assemble step 7) **before**
`mountLifecycleApi` registers the literal `/conflicts`, `/stale-refs`, `/history`
(`assemble.ts:1605-1607` → `lifecycle-api.ts:309, 319, 328`). The literal routes that work
(`/resolve`, `/calibration`, `/prime`) were explicitly moved before `/:id` for exactly this
reason (`api.ts:899-958` comments). Callers: `hive/src/dashboard/web/pages/lifecycle-panel.tsx:214-219`,
endpoints `wire.ts:82-85`, fetchers `wire.ts:2491-2530`.

Fix: register the three lifecycle literal GETs before `/:id` (same pattern as the `/prime` fix).
`/history` is silently broken the same way — fix all three.

---

## ISS-013 — `skipped (absent): skills, rules, entity_attributes, epistemic_assertions, pollinating_state`

- **Status:** partially resolved 2026-07-12 (ack + UI honesty deployed — below-threshold with tokens/threshold shown; pollination itself still dormant: counter increments only land on summary writes, vault-first threading of the trigger remains open)
- **Repo:** honeycomb (+ hive renders the line)
- **Systemic patterns:** SP-6

The line is rendered by hive's Memories page after Compact
(`hive/src/dashboard/web/pages/memories.tsx:507`; CLI twin `commands/maintenance.ts:140`). The
compact API probes each of `COMPACTABLE_VERSION_BUMPED_TABLES`
(`storage/compaction.ts:214-216`) with `tableExists` and skips absent ones
(`maintenance/compact-api.ts:250-302`). The skip is benign; the **absence is the finding**: there
is no boot-time schema creation — tables are created lazily on first heal-aware write
(`withHeal`, `heal.ts:11-17`; the session-start `ensureTables` seam is a production no-op,
`session-start-seams.ts:125`). A table exists iff its writer ever ran, and none of these five
writers has ever run (live-confirmed absent, along with `goals`, `kpis`, `entities`,
`entity_aspects`, `memory_entity_mentions`):

- `skills` → skillify producer never fires (ISS-015).
- `rules` → no write path exists in the product at all (ISS-014).
- `entity_attributes` / `epistemic_assertions` / `pollinating_state` → pollination has never run
  a single pass (next entry).

**Pollinating "does nothing" (user bullet, same root):** the consolidation loop increments a
token counter only on fresh session-summary writes
(`summaries/worker.ts:686-693` → `trigger.ts:310-320`) toward a **100,000-token threshold**
(`pollinating/config.ts:35`). Only 4 summary rows exist ever, `pollinating_state` was never even
created (increments silently swallowed, `worker.ts:690-692`), so the counter is effectively 0 —
below-threshold forever. Live: `POST /api/diagnostics/pollinate` →
`reason: "below-threshold"`, which `ackFor` maps to `status:"running"`
(`pollinating/api.ts:186-198`) and hive renders as **"already running"**
(`memories.tsx:462-463`) — nothing is running. Even if a pass ran, Portkey is rejecting calls
(ISS-005) with `fallbackToProvider:false` → zero-mutation passes. Latent config split: vault
`pollinating.enabled` is honored only by the worker gate (`assemble.ts:2436-2450`); the shared
trigger and pollinate API resolve env-only config (`assemble.ts:3068-3079`,
`pollinating/api.ts:259-260`).

Fix: show `tokens/100000` honestly in hive + a force/bypass mode on the button; thread vault-first
enabled into trigger + API; log (don't swallow) counter-increment failures; fix ISS-005 first.

---

## ISS-014 — Honeycomb rules/goals entirely missing from hive

- **Status:** open (gap confirmed definitively)
- **Repos:** honeycomb (rules has no writer), hive (no consumer)
- **Systemic patterns:** SP-6

Honeycomb exposes full routes: `GET/POST /api/goals` (`goals/api.ts:44-53`), `GET/POST /api/kpis`
(`kpis/api.ts`), read-only `GET /api/rules` + `GET /api/skills` (`product/api.ts:259-311`); MCP
tools `honeycomb_goal_add`/`honeycomb_kpi_add` POST to them (`mcp/src/handlers.ts:283-286`).
Rules/goals are rendered into session-start context via `/api/hooks/context`.

Findings:

1. **Hive consumes none of it** — zero references to `/api/goals` or `/api/kpis` in `hive/src`
   (grep: no matches). Hive's "KPIs" is `/api/diagnostics/kpis` (memory/session counts), a
   different thing. The only rules surface is `RulesPanel` fed by `/api/diagnostics/rules`
   (`panels.tsx:194-201`), which shows "No rules defined." forever because—
2. **The `rules` table has no writer anywhere in the product** — no POST route, no CLI verb, no
   MCP tool (only reads at `product/api.ts:261`, `dashboard/api.ts:579`). It can never be
   populated as shipped.
3. Live: `/api/goals`, `/api/kpis`, `/api/rules`, `/api/skills` all return empty; `goals`/`kpis`
   tables don't exist (nobody has successfully called goal_add/kpi_add).

Fix: hive pages consuming `GET /api/goals` + `/api/kpis`; a rules write path
(`POST /api/rules` + UI editor) — the read surfaces already exist end-to-end.

---

## ISS-015 — Skills: capture is dead for ALL harnesses; no markers; no content dedupe

- **Status:** open (fix proposed)
- **Repos:** honeycomb
- **Systemic patterns:** SP-6

### Root cause (decisive)

The skillify **producer never fires for any harness** — not a Cursor/Codex-only gap:

1. The only producer is the stop-counter, gated on `meta.isTurnTerminating`
   (`capture/capture-handler.ts:823-832`); the field defaults false
   (`capture/event-contract.ts:174`) and **no shim ever sets it** (`HookSessionMeta` doesn't
   carry the field, `hooks/shared/contracts.ts:113-128`; Claude Code's Stop/SubagentStop map to
   plain `assistant_message`, `hooks/claude-code/shim.ts:52-53`).
2. Session-end sends `intents: ["mark-ended","record-usage","skillify"]`
   (`hooks/shared/session-end.ts:112`) but the daemon handler **ignores intents** and enqueues
   only a summary job (`capture/attach.ts:198-295`).
3. Live: zero `skillify` jobs ever; `teamSkillCount: 0`; `skills` table absent.

Against the user's three asks:

- **Capture from all harnesses:** the miner is already harness-agnostic — it mines the shared
  `sessions` table with no `source_tool` filter (`skillify/miner.ts:153-194`) and sessions carry
  markers live (claude-code 5434, codex 46, **cursor 0** — Cursor capture is landing zero
  sessions at all; separate hooks-install issue to verify, cross-ref ISS-022). Missing piece is
  purely the producer trigger. Caveat: the gate shells out to the `claude` CLI specifically
  (`skillify/worker.ts:231-236`).
- **Harness markers:** missing — `SKILLS_COLUMNS` has no source column
  (`catalog/product.ts:83-108`). Additive heal-compatible `source_tools` column stamped from the
  mined sessions.
- **Dedupe:** partial — KEEP/MERGE/SKIP gate (`miner.ts:18-27`) + `mergeSkill`
  (`skillify/skills-write.ts:309-480`) exist, but MERGE resolves by name only; same-content
  skills from different harnesses need a content-similarity/hash check before `writeNewSkill`.
- **Install roots:** mined skills install only under `.claude/skills/`
  (`skillify/install-target.ts:26, 43-67`); no Cursor/Codex install target on the mine path.

Fix: stamp `isTurnTerminating` in shims (or derive daemon-side from `hookEventName`), and/or
honor the `skillify` intent in session-end; add `source_tools` column + content dedupe; per-harness
install roots (team-pull path already has per-harness root resolution to reuse,
`daemon-client/skillify/install.ts`).

---

## ISS-016 — /dashboard doesn't feel like a dashboard (overhaul)

- **Status:** open (design task; factual inventory done)
- **Repo:** hive

Current render (`hive/src/dashboard/web/pages/dashboard.tsx`): (1) kpi-band — `HealthStrip`
chips + four `Kpi` tiles (Memories / Turns / Est. savings / Team skills) (:266-276);
(2) recall-area — `RecallBar`, lexical-fallback badge, result cards (:280-304);
(3) harness-area — `HarnessStrip` + tiles + 5-line log tail, `SessionsPanel` + `RulesPanel` +
`SkillSyncPanel`, full `LiveLog` (:310-335); (4) `HarnessConnectCard` (:343).

No ROI/net figure, no memory-graph teaser, no trend chart, no lifecycle health; two of four zones
are logs/harness plumbing — hence "KPIs + harnesses". Overhaul inputs: ISS-009 (remove logs),
ISS-010/011 (real savings + trend), ISS-014 (goals/KPIs panels), memory-graph teaser (ISS-002).

---

## ISS-017 — `honeycomb status` says cursor-agent not installed

- **Status:** resolved 2026-07-12 (#297 deployed: `D4 ok cursor-agent login (logged in as mario@legioncodeinc.com)` verified live)
- **Repo:** honeycomb

Live: cursor-agent IS installed (`C:\Users\mario\AppData\Local\cursor-agent\cursor-agent.cmd`,
version 2026.05.01, logged in) and **detection D3 actually passes** —
`probeCursorAgent` correctly uses `where` on win32 (`src/cli/health-probes.ts:48-58`), which
matches the `.cmd` shim.

What the user is seeing is **D4**: `D4 FAIL cursor-agent login ("login state unknown")`.
`probeCursorLogin` (`health-probes.ts:61-69`) is a hardcoded stub — it never runs
`cursor-agent status`, only checks `existsSync(~/.cursor)`, and returns `ok:false` on **both**
branches. A fully logged-in cursor-agent shows a permanent red FAIL.

Fix: implement D4 as a real probe — `spawnSync("cursor-agent", ["status"])` parsing the
"Logged in" line. Windows trap: it's a `.cmd`, so Node ≥22 needs `shell: true`
(CVE-2024-27980 hardening); the repo already documents this pattern for `npm.cmd` in
`src/shared/fleet-detection.ts:172-177`.

---

## ISS-018 — Multi-project simultaneous support

- **Status:** verified working as designed (no code change needed; failure vectors documented)
- **Repo:** honeycomb

Live-verified: `honeycomb status` from two different bound folders resolves each independently
(the-apiary / inter-city-yacht-club, same workspace). The daemon holds no single "current
project": every captured event resolves its project per-event from the session cwd
(`capture-handler.ts:354, 732-756` → `resolveScopeFromDisk({ cwd: meta.cwd, … })`, stamped at
:687). `resolveScopeFromDisk` re-reads projects.json from disk on every call
(`project-resolver.ts:707`) — a new bind takes effect on the next captured event, no restart.
Longest-prefix matching over all bindings (`project-resolver.ts:564-608`) means the-apiary's
binding correctly covers its submodule dirs.

Real failure vectors (things that make it *look* broken):

1. Harness shim not passing cwd → straight to inbox (`capture-handler.ts:743`).
2. Tenancy guard discards the whole cache if cache workspace ≠ daemon's boot-snapshotted
   workspace (`project-resolver.ts:709-712`) — SP-1 recurrence.

---

## ISS-019 — Sidebar doesn't show a newly bound project until page refresh

- **Status:** resolved 2026-07-12 (hive#24 refreshProjects bridge, deployed 0.8.1; QA-verified)
- **Repo:** hive

The sidebar project list and the /projects page list are **two unconnected caches**. Sidebar =
plain React state in `ScopeProvider` (`scope-context.tsx:277`), populated by `loadProjects()`
only on mount (:336) and workspace switch (:427). The bind flow revalidates only the page's
separate SWR cache (`pages/projects.tsx:565-574`, also `needs-project.tsx:84`,
`hive-graph.tsx:137`). `ScopeSwitcherValue` exposes no `refreshProjects`
(`scope-context.tsx:92-142`); nothing bridges bind → provider state. Daemon side is fine
(server view cache invalidated at `onboarding-api.ts:345`).

Fix: expose `refreshProjects: loadProjects` from the provider (memo at :457-472) and call it from
the three onBound sites — or convert the provider's list to SWR on the same key so the existing
`mutateProjects()` propagates.

---

## ISS-020 — /projects "Open" is just the view filter; should open project details

- **Status:** open (feature; data inventory done)
- **Repo:** hive

Confirmed: Open (`pages/projects.tsx:125`, handler :582-587) calls `setScope({...project})` —
identical to the sidebar dropdown's localStorage view filter (`scope-context.tsx:448-454`).
Redundant, no detail surface.

A detail view can be assembled entirely from existing endpoints (all already thread
`scope.project`): name/remote/paths + memory/session counts + lastCapture
(`/api/diagnostics/scope/projects`, `scope-enumeration-api.ts:79-121` + `project-counts.ts`),
scoped memories/recall (`/api/memories*` + `x-honeycomb-project`), sessions/KPIs/rules/skills
(`/api/diagnostics/*`, cf. `dashboard.tsx:179-194`), ROI (`roi.tsx:674` pattern), graphs
(`/api/graph`, `/api/diagnostics/memory-graph`), sync state (`/api/diagnostics/assets`), logs
(`/api/logs` filterable). Route `#/projects/<id>` reusing the same wire calls.

---

## ISS-021 — Second project bind → every project listed twice

- **Status:** resolved 2026-07-12 (#297 dedupe backstop + heal-skip deployed; physical registry rows cleaned 6→2 with per-project count=1 verified through the live API)
- **Repo:** honeycomb
- **Systemic patterns:** SP-5

### Root cause (live-verified)

The duplication originates in the **DeepLake `projects` registry table** — two physical rows per
`project_id` (live: `projects.json` `projects[]` and `GET /api/diagnostics/scope/projects` both
show byte-identical doubles, incl. identical live aggregates; `bindings[]` is clean).

Chain: `updateOrInsertByKey` is a non-transactional SELECT→UPDATE-or-INSERT
(`storage/writes.ts:292-322`; its doc admits the race). Two concurrent upsert callers exist at
bind time: the bind handler (`onboarding-api.ts:343` → `upsertProjectRow`,
`registry-write.ts:87-127`) and the sync-heal (`registry-sync.ts:155-163`), which the bind
handler itself triggers via cache invalidation (`onboarding-api.ts:345`) → immediate dashboard
refetch → `syncRegistryToCache`. With DeepLake read-after-write lag, both INSERT → two rows.
Once doubled, the UPDATE branch (`writes.ts:316`, no LIMIT) updates both rows identically
forever. No dedupe anywhere downstream: `registry-sync.ts:134-138` pushes every registry row;
`buildListProjectsSql` has no DISTINCT (`catalog/projects.ts:279-284`); the API maps 1:1
(`scope-enumeration-api.ts:324`).

### Proposed fix

1. Backstop (one line): build `registryProjects` via `Map<projectId, …>` in
   `registry-sync.ts:134-138`.
2. Root: skip sync-heal for freshly bound projects, or have `upsertProjectRow` verify + delete
   extras (pattern exists in `writes.ts:345+` for `codebase`).
3. One-time cleanup of the existing duplicate registry rows.

---

## ISS-022 — No visibility into recall/injection working per harness

- **Status:** resolved 2026-07-12 (#298 deployed: 🐝 systemMessage on recall turns, 6s timeout, metering live; REMAINING GAP tracked separately: Cursor has no per-turn recall wired — deferred item)
- **Repos:** honeycomb (hooks, shims), hive (optional surface)
- **Systemic patterns:** SP-3

### Live finding: injection IS working — silently

Daemon logs show recall firing per prompt with hits (`event_log` `recall.timing`:
`"semanticRan":true,"hits":5` etc.); hook-side `~/.honeycomb/recall-sessions/<session>.json`
records 5 injected refs into today's session. Pipeline works end-to-end; there is simply zero
user-visible feedback (channel is model-only `additionalContext`;
`renderChannel`, `hooks/normalize.ts:166-179`; nothing sets Claude Code's user-visible
`systemMessage` field).

Two real defects surfaced alongside:

1. **4s hook budget vs 3-4.6s daemon latency**: `DEFAULT_RECALL_TIMEOUT_MS = 4000`
   (`hooks/shared/recall-renderer.ts:60`) — daemon 200s at 3.0-4.6s (log-verified) are silently
   discarded by the hook. Tied to ISS-007/008 latency (wedged embedder adds ~1.5s embedMs and
   `lexical_fallback` turns with `hits:0`).
2. **Cursor has no per-turn recall at all**: `~/.cursor/hooks.json` wires `beforeSubmitPrompt` →
   capture only; Cursor gets only the session-start block. Codex's `user-visible` channel is
   deliberately stripped to a login-state line (`hooks/codex/shim.ts:44, 77`).

### Proposed fix

- **Claude Code** (smallest, highest value): add
  `systemMessage: "Honeycomb: N memories injected"` when hits > 0 (return count from
  `runUserPromptRecall`, `hooks/shared/user-prompt-recall.ts:89-132`; emit in the claude-code
  shim — unknown-key pass-through is the documented posture).
- **Cursor**: (1) wire per-turn recall (`beforeSubmitPrompt` entry mirroring
  `--honeycomb-recall`; shim already supports `additional_context`, `hooks/cursor/shim.ts:51`);
  (2) visibility via the first-party extension status bar (`harnesses/cursor/extension/`) — the
  hooks protocol has no user-visible field.
- **Codex**: extend `codexRenderUserVisible` to append the injected count.
- **Cross-harness, zero protocol risk**: a `honeycomb recall log --tail` verb reading
  `event_log` `recall.timing`/`recall.degraded` + `recall-sessions/*.json` — the exact stores
  this investigation used.
- Also raise `DEFAULT_RECALL_TIMEOUT_MS` (or speed the fast lane) so 3-4.6s responses aren't
  discarded.

---

## Systemic Patterns

### SP-1 — Boot-time snapshots of live state

Daemons capture credentials/config/tenancy once at startup and never re-read, so any change made
while running silently doesn't apply until restart. Known instances:

- Provider-key presence gate + `'auto'` collapse (ISS-001, `assemble.ts:2657-2692, 2692`).
- Vault `memory.enabled` and `activeProvider`/`activeModel` reads (ISS-001,
  `assemble.ts:2630-2632, 2462, 2191`); memory toggle acks `appliesOnRestart: true` (ISS-005).
- `mountOnboardingApi` org/workspace string capture (ISS-003, `assemble.ts:3574-3582`).
- Tenancy guard vs boot-snapshotted workspace can invalidate the whole projects cache (ISS-018,
  `project-resolver.ts:709-712`).
- Embed supervisor `warm` flag is a one-shot latch with no liveness re-check (ISS-007,
  `embed-supervisor.ts:362-373`).
- Historical: tenancy snapshot fixed via `live-reload.ts` — the fix pattern exists; it was never
  applied as a class.

**Class fix direction:** one live-scope/live-config seam (extend `live-reload.ts` usage) + reload
notifications from every settings/secrets write path. Stop fixing instances one at a time.

### SP-2 — Features shipped default-off behind stacked env flags with no surfacing

Memory graph needs four independent switches (`HONEYCOMB_PIPELINE_GRAPH_ENABLED`,
`HONEYCOMB_PIPELINE_GRAPH_EXTRACTION_WRITES`, `HONEYCOMB_LOCAL_QUEUE_ENABLED`, a provider) before
one row is written, none documented in-product, none controllable from the dashboard.

### SP-3 — Silent empty-state degradation

Every failure mode in a read path collapses to the same empty UI (`?? EMPTY_GRAPH`,
`isOk ? rows : []`, catch-all non-fatal write handlers). The user cannot distinguish "off",
"broken", and "no data yet". New pages must render *why* a state is empty.

### SP-4 — UI that misrepresents system state

Controls that look like they perform a durable action but only mutate local view state (Project
switcher, ISS-003; /projects "Open", ISS-020). UI copy that inverts reality:
pollinate "already running" when nothing is running (ISS-013); health `embeddings: on` while the
embedder is wedged (ISS-007); `portkey: "unreachable"` when the gateway is rejecting (ISS-005).
Any control whose effect is view-only must be visually distinct from controls with server-side
effects; status strings must come from live probes, not latches or remapped error codes.

### SP-5 — Fail-soft paths that convert failure into success

Errors are caught, logged at info level (or not at all), and the operation reports success:
extraction model errors → jobs complete "done" with zero facts, 373/373 (ISS-005,
`extraction.ts:283-288`); pollination counter increments silently swallowed (ISS-013,
`summaries/worker.ts:690-692`); recall responses over the 4s hook budget silently discarded
(ISS-022); non-transactional upsert race "accepts the rare drop" and instead produces duplicates
(ISS-021, `writes.ts:292-322`); wedged embedder burns a 3s deadline on every search (ISS-008).
Fail-soft is fine at the UX edge; it must never erase the failure from health/metrics.

### SP-6 — Dead-end features: read surfaces or schemas with no working producer

Tables/routes/pages exist but nothing can ever populate them: `rules` table has read routes and a
hive panel but no write path anywhere (ISS-014); skillify consumer runs but its producer never
fires on any harness (ISS-015); ROI trend endpoint is a hardcoded empty stub (ISS-010); the five
"absent" tables are lazily created by writers that never ran (ISS-013); `goals`/`kpis` routes
exist with no hive consumer (ISS-014). Ship features producer-first, or gate the read surface
until the producer exists.

### SP-7 — Route shadowing: parametric `/:id` registered before literal siblings

`GET /api/memories/:id` eats `/conflicts`, `/stale-refs`, `/history` (ISS-012) — a recurrence of
documented bug #255, previously fixed for `/resolve`, `/calibration`, `/prime` by moving them
before `/:id`. Rule: literal routes register before parametric ones in the same group, enforced
by a test.

---

## Resolved

*(none yet)*
