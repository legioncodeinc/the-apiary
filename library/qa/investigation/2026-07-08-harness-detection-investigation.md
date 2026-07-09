# Harness Detection & Reporting — Investigation

**Date:** 2026-07-08
**Investigator:** QA agent (diagnose + recommend only — NO code changes made)
**Repos in scope:** `honeycomb` (memory/skill engine + daemon), `hive` (Electron dashboard + BFF daemon)

> **⚠️ SUPERSEDED IN PART — read [`2026-07-08-live-verification-addendum.md`](2026-07-08-live-verification-addendum.md) first.**
> This report was written from static code + the **orphaned `~/.daemon`** (frozen 07-05) and got two things wrong, corrected by live daemon interrogation:
> 1. **"Cursor not reporting" is NOT project-scope staleness.** Root cause is two proven honeycomb bugs: (a) `~/.cursor/hooks.json` written without the required numeric `version` → Cursor rejected the config; (b) Cursor's `/c:/…` `workspace_roots` is not normalized → captures gate as `no_bound_project`. Cursor has captured **0** turns; all 3,342 captures are Claude Code.
> 2. **"installed" detection:** the marker check is real, but `installed:true` proves only a file exists, not that the harness fires — Cursor read `installed:true` while never capturing.
> The `.claude`-centric Skills/Sync findings below **stand** (confirmed).

---

## Scope / symptoms

Product-owner report, verbatim:

1. *"Dashboard → Skills is not reporting from the .cursor directory. Is it only checking .claude for the bound folder? How does it handle Claude, Codex, Cursor, etc.?"*
2. *"Harnesses page shows Cursor installed, Cursor not reporting. I've been using Cursor all day."*

---

## How harness detection works today

There are **three independent data surfaces** that all say "harness" but derive from different sources. Conflating them is the root of the confusion.

### Surface A — `GET /api/diagnostics/harnesses` (the Harnesses page + home strip)
Served by `honeycomb/src/daemon/runtime/dashboard/harness-api.ts` (`mountHarnessApi`, line 332). For each of the canonical six harnesses it returns:

| field | meaning | source |
|---|---|---|
| `installed` | harness is *wired* on disk | `detectInstalledHarnesses()` — `existsSync` of per-harness markers, **re-run per request** (`harness-api.ts:356`, `resolveInstalled` seam) |
| `active` | `turnsCaptured > 0` | derived (`harness-api.ts:312`) |
| `turnsCaptured` | `COUNT(*)` of `sessions` rows for `agent = <harness>` | DeepLake, scope-bound (`buildHarnessActivitySql`, `harness-api.ts:274`) |
| `lastSeen` | `MAX(creation_date)` of those rows | DeepLake, scope-bound |
| `pluginEnabled` | plugin toggle on | injected seam, empty in pure daemon → `false` |

- **"installed"** = marker path exists. Cursor markers: `~/.cursor/hooks.json` **or** `~/.cursor/honeycomb` (`harness-detect.ts:76`).
- **"reporting"** (what the user calls it) = the `active` / `turnsCaptured` / `lastSeen` columns, i.e. **at least one `sessions` row exists whose `agent` column equals `cursor`, within the dashboard's currently-resolved tenancy scope.**
- The `sessions` query is `SELECT agent, COUNT(*), MAX(creation_date) FROM "sessions" GROUP BY agent` with **no WHERE clause in the SQL** — scoping is applied by `storage.query(sql, scope)` (`harness-api.ts:361`), where `scope` comes from the `x-honeycomb-org` header → local-mode default (`resolveScopeOrLocalDefault`, `harness-api.ts:349`).

### Surface B — `GET /api/diagnostics/harness-connect-status` ("Coding assistants" card, PRD-006d)
`hive/src/daemon/harness/honeycomb-cli.ts` + `routes.ts`. Hive **shells** `honeycomb harness status --json` and renders `agentPresent` / `pluginEnabled` / `connected` (`harness-connect-card.tsx:93-98`). This is a *different* authoritative surface, not the one the "installed/active" matrix reads.

### Surface C — `GET /api/diagnostics/skills` (the Skills panel)
`honeycomb/src/daemon/runtime/dashboard/api.ts` `fetchSkillSyncView` (line 631). It **unions**:
1. team-synced skills from the DeepLake `skills` table (scope-bound), and
2. **local disk skills** from `scanInstalledAssets()` (`installed-assets.ts:106`).

The capture stamps the `agent` column with the harness id: `honeycomb/src/hooks/normalize.ts:141` → `meta: { ...fullMeta, agent: spec.harness, ... }`. For Cursor `spec.harness === "cursor"` (`hooks/cursor/shim.ts` `createCursorShim`), so **captured cursor turns are correctly tagged `agent='cursor'`** — an agent-id mismatch is *ruled out*.

---

## Root-cause findings

### Symptom 1 — Skills panel shows nothing from `.cursor` — **Confirmed (two compounding bugs)**

The local skill scanner **is** multi-harness (not hardcoded to `.claude`): `HARNESS_ROOTS` in `honeycomb/src/daemon/runtime/dashboard/installed-assets.ts:68-75` lists all six harness dotfolders (`.claude`, `.cursor`, `.codex`, `.hermes`, `.pi`, `.openclaw`). So the premise "is it only checking .claude" is *almost* right in spirit but wrong in detail — the real defects are:

**Bug 1 — the scan only walks the BOUND PROJECT FOLDER, never the user's home (`~`).** `scanInstalledAssets` defaults `includeGlobal` to `false` (`installed-assets.ts:110`) and the dashboard calls it with **no options** (`api.ts:1305`, `const value = await scanInstalledAssets();`). Docblock confirms: *"project-root only by default, D-1"* (`api.ts:1296`). So the scan roots are `<process.cwd()>/.claude/skills`, `<process.cwd()>/.cursor/skills`, … — i.e. the bound repo folder. The user's actual Cursor skills live in the **global** home `~/.cursor/…`, which is never walked.

**Bug 2 — even a global scan would look in the wrong directory for Cursor.** The scanner walks `<root>/.cursor/skills` (`installed-assets.ts:130`, `join(root.base, "skills")`). But on this machine the real Cursor skills sit in **`~/.cursor/skills-cursor/`** (verified on disk: 20+ skill dirs + a `.sync-manifest.json` last written 2026-07-08 20:21). There is **no** `~/.cursor/skills/` directory at all.

There is an internal naming contradiction confirming the bug:
- `honeycomb/src/connectors/cursor.ts:124` (`skillLinkTargets`) links skills into `~/.cursor/skills`.
- `honeycomb/src/connectors/contracts.ts:193` documents the link dir as *"e.g. `~/.cursor/skills-cursor/`"*.
- `installed-assets.ts:130` scans `~/.cursor/skills`.
- The **actual synced dir on disk is `~/.cursor/skills-cursor`** (Cursor's own convention, since bare `~/.cursor/skills` collides with Cursor's built-ins).

So the Skills panel would miss `.cursor` skills on **both** counts: wrong scope (project vs. home) AND wrong dir name (`skills` vs. `skills-cursor`). Claude Code is less affected because `~/.claude/skills` is the correct dir name — but it too is only found when the daemon's `cwd` is a project that has a `.claude/skills`, not from `~`.

*Answer to the user's question:* it is **not** hardcoded to `.claude`, but it is (a) scoped to the bound project folder only, and (b) using the wrong sub-directory name for Cursor. Both must be fixed for `.cursor` skills to appear.

### Symptom 2 — Cursor "installed" but "not reporting" despite all-day use

**Part A — why "installed" is TRUE — Confirmed.** `~/.cursor/hooks.json` exists on disk (verified; last written 2026-07-08 05:21) and is a valid Honeycomb-patched hooks file pointing at `~/.cursor/honeycomb/bundle/{capture,session-start,session-end,pre-tool-use}.js` (all four bundle files present, last written 2026-07-08 19:48). `detectInstalledHarnesses` reports `installed: true` on the very first marker (`harness-detect.ts:76,138`). This is read **live per request** (`harness-api.ts:340,356`; production wires `resolveInstalled: resolveInstalledHarnesses` at `assemble.ts:1755`, which resolves to `detectInstalledHarnesses()` for the real daemon at `assemble.ts:3141-3142`). **So `installed` is NOT a boot-frozen snapshot — the prior "boot-snapshot staleness" root cause does NOT apply to the `installed` flag.**

**Part B — why "reporting" is FALSE.** "Reporting" = `turnsCaptured > 0`, i.e. `sessions` rows with `agent='cursor'` visible under the dashboard's resolved scope. Given the agent stamp is correct (`normalize.ts:141`), the turns are zero for one of these reasons:

1. **Tenancy/scope mismatch — Likely.** The `sessions` GROUP-BY is scope-bound (`harness-api.ts:361`, `storage.query(sql, scope)`; scope derived at `:349`). If Cursor's captured turns landed under a different `org` / `workspace` / `project_id` than the scope the dashboard currently resolves to (header `x-honeycomb-org` → the daemon's **boot-time default tenancy**), the COUNT is 0 even though rows exist. This is exactly where the known "daemons snapshot credentials/projects/scope at boot and never refresh" failure mode bites — it survives on the **reporting** path (tenancy) even though it was fixed on the **installed** path (per-request re-probe). `scope-clause.ts` confirms `sessions`/memory recall is filtered by `agent_id`/`project_id`/`visibility` columns.

2. **Capture never reached the `sessions` store — Likely.** The hooks fire `node capture.js`, which enqueues to the local queue → daemon → DeepLake `sessions`. Runtime evidence: `honeycomb/.daemon/local-queue.db` and `logs.db` were **last modified 2026-07-05**, three days before the reported all-day usage on 07-08. If the daemon serving the dashboard is this repo-local instance, the capture pipeline was not writing during the usage window. (Caveat: the live capture may target a different `APIARY_HOME`/`~/.deeplake`; I could not directly query the live DeepLake `sessions` table, so this is inferential.) The prior memory note — *"memories only form with `HONEYCOMB_LOCAL_QUEUE_ENABLED`; shared DeepLake queue collides; rows land in `memories` not `memory`"* — is the analogous risk for the sessions write path and should be checked (queue enabled? writes landing in `sessions`?).

3. **Agent-id mismatch — Ruled out.** `normalize.ts:141` stamps `agent: spec.harness` = `cursor`.

4. **DeepLake read-replica under-count — Unlikely as sole cause.** `harness-api.ts` already mitigates with poll-max convergence (`selectRowsConverged`, `:218`), which only ever *raises* the count. It could delay a low count but not zero an all-day count.

**Confidence:** installed=true mechanism **Confirmed**; "reporting" being scope-bound and agent-stamp-correct **Confirmed**; which of (1) vs (2) is the operative cause is **Likely/Hypothesis** pending a live `sessions` query.

---

## Multi-harness handling — is it truly Claude/Codex/Cursor/… or `.claude`-centric?

**Genuinely multi-harness (data-driven, not `.claude`-only):**
- Canonical six derived from the real shim set, asserted by test (`harness-registry.ts:56-70`).
- Install detection has markers for all six (`harness-detect.ts:67-104`).
- Local skill scan lists all six dotfolders (`installed-assets.ts:68-75`).
- The Harnesses page/home strip render `installed.map(...)` with **no hardcoded harness array** (`harness-strip.tsx:108,119`; `harnesses.tsx:198`).

**`.claude`-centric assumptions / gaps that hurt Cursor specifically:**
- Only `claude-code`, `codex`, `cursor` have real connectors; `hermes`/`pi`/`openclaw` markers are aspirational (`harness-detect.ts:84-103`) and marked `in-progress` (`harness-registry.ts:147`).
- Cursor skills dir name is inconsistent across the codebase (`skills` vs `skills-cursor`) — see Symptom 1, Bug 2.
- The skill scan's own docblock frames the problem as *"~27 skills sit on disk under `.claude/skills/`"* (`installed-assets.ts:8-9`) — the feature was designed/tested Claude-first; Cursor's home-dir + `skills-cursor` reality was not wired through.
- Skill scan is project-cwd-only by default, which mostly surfaces Claude project skills and never the home-dir skills that Cursor uses.

---

## Recommendations (prioritized — no code changes made)

1. **[P0] Fix the Cursor skills directory name.** Reconcile `installed-assets.ts:130`, `connectors/cursor.ts:124`, and `connectors/contracts.ts:193` onto the **actual** dir `~/.cursor/skills-cursor`. Make the scanner's per-harness skills sub-dir data-driven (a field on `HARNESS_ASSET_ROOT`) instead of the hardcoded literal `"skills"`. Target: `honeycomb/src/daemon/runtime/dashboard/installed-assets.ts`.

2. **[P0] Scan the global home for skills, not just the bound project folder.** Have the dashboard call `scanInstalledAssets({ includeGlobal: true })` (or union project + `~`) so `~/.cursor/skills-cursor` and `~/.claude/skills` are surfaced. Target: `honeycomb/src/daemon/runtime/dashboard/api.ts:1305` (and the `fetchSkillSyncView` default at `:634`). Watch the scope/dedupe semantics (`installed-assets.ts:110-122`).

3. **[P0] Verify the reporting/tenancy scope for `sessions`.** Confirm the dashboard's resolved scope (`x-honeycomb-org` → boot default, `harness-api.ts:349`) matches the org/workspace/project under which Cursor turns were captured. Run `SELECT agent, project_id, COUNT(*) FROM "sessions" GROUP BY agent, project_id` against the live DeepLake and compare against the dashboard's active scope. If the daemon's default tenancy is boot-snapshotted, apply the same per-request-refresh treatment that already fixed `installed`. Targets: `harness-api.ts:349-361`, `daemon/runtime/scope.ts`, `recall/scope-clause.ts`.

4. **[P1] Verify the capture→sessions write path is live.** Check `HONEYCOMB_LOCAL_QUEUE_ENABLED`, that the daemon serving the dashboard is the one the Cursor hooks enqueue to, and that rows land in `sessions` (not a mis-named table, per the prior `memory`/`memories` gotcha). Inspect `honeycomb/.daemon/local-queue.db` freshness vs. actual usage (currently stale at 07-05). Targets: capture pipeline (`hooks/*/capture`), local-queue writer, `assemble.ts` queue wiring.

5. **[P1] Disambiguate "installed" vs "reporting" in the UI.** The matrix (`harnesses.tsx:156-181`) shows `installed`/`active`/`turns`/`last seen` but never explains that "active" needs captured turns in the *current scope*. Add a tooltip/empty-state ("installed but 0 turns in this project/org — check scope or capture pipeline") so a wired-but-scope-mismatched harness reads as a diagnosable state, not a silent "—".

6. **[P2] Add a scope indicator to the Harnesses page.** Surface the resolved org/workspace/project the counts are filtered by, so "0 turns" is obviously scope-relative.

7. **[P2] Reconcile the two "harness status" surfaces.** Surface A (`/api/diagnostics/harnesses`, telemetry) and Surface B (`/api/diagnostics/harness-connect-status`, plugin wiring) can disagree (installed-but-not-connected vs installed-but-not-reporting). Consider cross-linking them on the page so an operator sees agent-present + plugin-enabled + turns-captured together.

---

## Open questions / what I couldn't verify

- **Live `sessions` contents.** I could not directly query the DeepLake `sessions` table, so I could not confirm whether cursor rows exist under a *different* scope (Recommendation 3) vs. do not exist at all (Recommendation 4). This is the single most important next step and decides which P0 fix resolves Symptom 2.
- **Which daemon/home is live.** The stale `honeycomb/.daemon/local-queue.db` (07-05) is the *repo-local* instance; the running daemon may use a different `APIARY_HOME`/`~/.deeplake`. The prior trailing-space `APIARY_HOME` gotcha could point the dashboard daemon and the capture pipeline at different homes — worth confirming they agree.
- **Boot-snapshot on tenancy.** Confirmed `installed` is per-request live; did **not** fully trace whether the default *tenancy scope* used for the `sessions` COUNT is refreshed per-request or frozen at daemon boot. `harness-api.ts:349` reads `daemon.config.mode` + `options.defaultScope` — if `defaultScope` is captured once at assembly, a project bound *after* boot would under-report. Needs a trace through `assemble.ts` `defaultScope`/`scope` wiring.
- **Whether Cursor actually invokes the hooks.** hooks.json + bundle are present and recent, but I did not observe Cursor firing them at runtime (would need a live capture trace / daemon request log during a Cursor turn).
