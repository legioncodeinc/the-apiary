# Sync Page — Investigation

**Date:** 2026-07-08
**Investigator:** QA agent (diagnose + recommend only — no code changes)
**Area:** hive dashboard **Sync** page (`#/sync`) and its honeycomb-owned daemon backing.

---

## Scope / symptoms

Product owner reported, verbatim:

1. "Same issue as dashboard — looks like it is only looking for `.claude` files and ignoring `.cursor`, `.codex`, etc."
2. "Shouldn't this have local skills/agents + home-dir skills/agents?"
3. "Shouldn't this have tabs for the different IDEs?"

---

## What the Sync page does today (traced)

The Sync page is a **thin client**. It renders one union view-model and POSTs write actions; all filesystem + DeepLake work happens in the **honeycomb** submodule (proxied), not in hive.

Data flow, end to end:

1. **UI** — `hive/src/dashboard/web/pages/sync.tsx:378` `SyncPage`.
   - Reads the union model via `wire.assetsView()` (`sync.tsx:390-394`).
   - Renders a **per-scope summary** (`sync.tsx:322` `ScopeSummary`), a **Skills / Agents tab pair** (`sync.tsx:479-482`), the shared `AssetList` (`sync.tsx:484`), and a sync **activity feed** (`sync.tsx:488`).
   - The only tabs that exist are **Skills vs Agents** (`sync.tsx:398` `useState<AssetKind>`, `TabButton` at `sync.tsx:496`). There is **no per-IDE / per-harness tab**.
   - Detail panel shows `provenance`, `scope`, `source harness`, `tier/style`, `version` (`sync.tsx:189-196`) — so harness + scope data is *present per row* but never used to group or filter.

2. **Wire** — `hive/src/dashboard/web/wire.ts`.
   - `assetsView()` GETs `ENDPOINTS.assets` = `/api/diagnostics/assets` (`wire.ts:102`, `wire.ts:2605-2609`).
   - Row schema `AssetSyncRowSchema` (`wire.ts:434-448`) carries `scope`, `sourceHarness`, `tier`, `style` — one flat list, no per-harness grouping key beyond the free-text `sourceHarness` string.

3. **Proxy** — `/api/diagnostics/assets` is owned by honeycomb and proxy-cached in hive (`hive/src/daemon/proxy-cache.ts:155,234,242`). hive itself has **no** Sync business logic.

4. **Daemon mount** — `honeycomb/src/daemon/runtime/dashboard/sync-mount.ts:110-117`.
   - `GET /assets` → `fetchAssetSyncView(storage, scope, viewerAuthor)`.
   - Note: `scope` here is the **DeepLake tenancy** (org/workspace), *not* a filesystem path.

5. **View builder** — `honeycomb/src/daemon/runtime/dashboard/sync-api.ts:211` `fetchAssetSyncView`.
   - Merges two sources: the DeepLake `synced_assets` substrate rows (`sync-api.ts:217-222`) **∪** the on-disk scan `scanInstalledAssets()` (`sync-api.ts:215,219`).
   - The disk scan is called with **no arguments** (`sync-api.ts:215` default param `scan = scanInstalledAssets`) → all scan defaults apply.

6. **Disk scanner** — `honeycomb/src/daemon/runtime/dashboard/installed-assets.ts:106` `scanInstalledAssets`.
   - Iterates a **static 6-harness list** `HARNESS_ROOTS` (`installed-assets.ts:68-75`): `.claude`, `.cursor`, `.codex`, `.hermes`, `.pi`, `.openclaw`.
   - For **every** harness it looks at `<dotfolder>/skills/<name>/SKILL.md` (`collectSkills`, `installed-assets.ts:191`, `130`) and `<dotfolder>/agents/*.md` (`collectAgents`, `installed-assets.ts:208-211`, `131`).
   - `projectRoot` defaults to `process.cwd()`; `globalRoot` defaults to `os.homedir()`; **`includeGlobal` defaults to `false`** (`installed-assets.ts:108-110`, `118`).
   - Cross-harness dedupe collapses the same-named asset from multiple harnesses into ONE entry with a merged `sourceHarnesses` array (`installed-assets.ts:228-253`).

7. **Union merge** — `unionFor` (`sync-api.ts:243-307`): disk assets become `local`, substrate rows `shared`, and `sourceHarness` on a disk row is the comma-joined harness list (`sync-api.ts:281`).

8. **Write path** — `createSyncActionApi` (`sync-api.ts:501`) + `createFsAssetInstallTarget` (`asset-install-target.ts`). Pull/enable **always** write to `.claude/skills` / `.claude/agents` (`asset-install-target.ts:33-36`, hardcoded `SKILLS_SUBDIR`/`AGENTS_SUBDIR`), regardless of the asset's source harness.

---

## Root-cause findings

### Symptom 1 — ".claude only, ignoring .cursor/.codex"

**Finding: partially incorrect as stated, but a real bug underneath.** The scanner *does* loop over all 6 harness dotfolders (`installed-assets.ts:68-75, 115-117`). What it does **not** do is understand that harnesses other than Claude Code use *different on-disk layouts*. It hardcodes the Claude convention — `skills/<name>/SKILL.md` and `agents/*.md` — for every harness (`installed-assets.ts:130-131, 197, 211`).

Confirmed layout mismatches on this machine:

- **Codex agents are `.toml`, not `.md`.** `~/.codex/agents/` holds 86 `*.toml` files (e.g. `auth-worker-bee.toml`). `collectAgents` only accepts `entry.name.endsWith(".md")` (`installed-assets.ts:211`) → **every Codex agent is invisible**. Codex's top-level `AGENTS.md` is also a single file, not an `agents/` tree.
- **Cursor home skills live in `skills-cursor/`, not `skills/`.** `~/.cursor/skills-cursor/` holds skills (automate, babysit, canvas, …); there is no `~/.cursor/skills`. The scanner looks only for `.cursor/skills` (`installed-assets.ts:130`) → **home Cursor skills are invisible even if home scanning were on**.
- **Write-back is Claude-only too.** `asset-install-target.ts:33-36` hardcodes `.claude/skills` / `.claude/agents`. A pulled Cursor or Codex asset is installed into `.claude/`, never back to its own harness — so the round trip is Claude-centric end to end.

Why it "looks like only `.claude`": at the *project* root the Cursor layout happens to match (see next section), so those rows *do* appear — but they are merged/deduped with Claude and surface only as a free-text `sourceHarness` string with no grouping, so the harness distinction is invisible in the UI (there are no per-IDE tabs — symptom 3). Codex and any non-Claude-layout harness contribute nothing.

- Responsible code: `installed-assets.ts:68-75` (static roots), `installed-assets.ts:208-219` (`.md`-only agent detection), `installed-assets.ts:191-201` (`SKILL.md`-only skill detection), `asset-install-target.ts:33-36` (`.claude`-only write).
- **Confidence: High.** Code + on-disk evidence agree.

### Symptom 2 — "should have local skills/agents + home-dir skills/agents"

**Finding: correct — home-dir assets are never scanned, and there is no local-vs-home split.**

- `fetchAssetSyncView` calls `scanInstalledAssets()` with no options (`sync-api.ts:215`), so `includeGlobal` stays `false` (`installed-assets.ts:110, 118`). The home (`~`) root is **never walked**. `~/.claude/skills` (4 skills on this box), `~/.cursor/skills-cursor`, and `~/.codex/agents` (86) are all silently dropped.
- Even the *design comment* says this is intentional-by-default: "scan the PROJECT root ONLY by default (no `~` walk in a repo dashboard)" (`installed-assets.ts:32-36`). There is no flag plumbed from the daemon or UI to flip it — `MountSyncOptions` (`sync-mount.ts:58-81`) exposes no scan-root or includeGlobal control.
- The scan root is `process.cwd()` of the **daemon** (`installed-assets.ts:108`), **not** the dashboard-selected project. The UI project selector re-scopes only the DeepLake substrate query (`sync-mount.ts:111`, `resolveScopeOrLocalDefault`); the disk scan ignores it. So "local" = wherever the daemon was launched, which may not be the selected project.
- The scanner *does* tag scope (`repository` for project, `user` for global — `installed-assets.ts:116, 120`), and the row carries `scope` (`sync-api.ts:296`), but the page never groups by it. `ScopeSummary` (`sync.tsx:309-333`) summarizes **sync state** (shared/local/pulled), not filesystem origin (local vs home).

- Responsible code: `sync-api.ts:215` (default scan, no `includeGlobal`), `installed-assets.ts:118` (default false), `sync-mount.ts:58-81` (no plumbing), `sync.tsx:309-333` (summary is state-based, not origin-based).
- **Confidence: High.**

### Symptom 3 — "should have tabs for the different IDEs"

**Finding: correct — no per-IDE tabs exist; the only tabs are Skills vs Agents.**

- Tabs are hardcoded to the asset-kind axis (`sync.tsx:398, 479-482`); `TabButton` (`sync.tsx:496-523`) is a bespoke inline pill, not a shared primitive.
- There is **no** reusable Tab/Segmented control in the design system: `primitives.tsx` exports only `Button`, `Badge`, `Input`, `Kpi`, `MemoryCard`; `page-frame.tsx`'s `isTabHidden` is page-visibility, unrelated.
- Harness identity is actively *erased* before it reaches the UI: `scanInstalledAssets` dedupes across harnesses (`installed-assets.ts:228-253`) and `unionFor` joins them into one comma-string (`sync-api.ts:281`). A per-IDE tab layout would need the row to keep a structured harness list, which today it does not.

- Responsible code: `sync.tsx:398, 479-482, 496-523` (kind-only tabs, no primitive), `sync-api.ts:281` (harness flattened to a string).
- **Confidence: High.**

---

## What SHOULD appear vs what does

Actual on-disk inventory on this machine (2026-07-08):

| Location | Path | Contents | Scanned today? |
|---|---|---|---|
| Home | `~/.claude/skills` | 4 skills (`ospry-cursor-hivemind-hooks--mario`, `ospry-enrichment-pipeline--mario`, `ospry-vercel-vrt-ci--mario`, `ospry-workos-magic-link-auth--mario`) | **No** — `includeGlobal=false` |
| Home | `~/.claude/agents` | 0 | n/a |
| Home | `~/.cursor/skills-cursor` | many (automate, babysit, canvas, create-hook, …) | **No** — home not scanned **and** wrong subdir name (`skills-cursor` ≠ `skills`) |
| Home | `~/.cursor/agents` | 0 | n/a |
| Home | `~/.codex/agents` | 86 `*.toml` (worker-bee agents) | **No** — home not scanned **and** `.toml` not `.md` |
| Home | `~/.codex/AGENTS.md` | 1 file | **No** — not an `agents/*.md` file |
| Project | `the-apiary/.claude/skills` | 0 | Yes, but empty |
| Project | `the-apiary/.claude/agents` | 0 | Yes, but empty |
| Project | `the-apiary/.cursor/skills` | **112 skills**, each `<name>/SKILL.md` | **Yes** (matches Claude layout) — but only if daemon cwd = the-apiary root |
| Project | `the-apiary/.cursor/agents` | **86** `*.md` agents | **Yes** — same caveat |
| Project | `the-apiary/.cursor/rules` | 5 `*.mdc` | **No** — rules are not skills/agents (out of scope, but note Cursor's real unit) |

Net: the page can only ever show project-root assets that happen to follow Claude's `skills/<name>/SKILL.md` + `agents/*.md` layout, from the daemon's launch directory. On this machine that surfaces the project `.cursor` skills/agents (because they mirror the Claude tree) but **drops all four home `~/.claude` skills, all home Cursor skills, and all 86 Codex `.toml` agents.** If the daemon's cwd is not the-apiary root, even the project rows vanish — matching the "looks like only `.claude` / mostly empty" impression.

---

## Recommendations (design only — no code changes made)

### A. Multi-harness, layout-aware scanning (fixes symptom 1)

Replace the "same layout for every harness" assumption in `installed-assets.ts` with a **per-harness layout descriptor**. Model it on the existing harness registry rather than a new static list:

- Reuse `CANONICAL_HARNESS_IDS` / `CANONICAL_SHIMS` from `honeycomb/src/daemon/runtime/dashboard/harness-registry.ts` as the single source of the harness set (kills the duplicate `HARNESS_ROOTS` at `installed-assets.ts:68`).
- Give each harness a descriptor: skills dir name, agents dir name, and agent file extension(s). E.g. Claude → `skills/`, `agents/`, `.md`; Cursor (home) → `skills-cursor/`, `agents/`, `.md`; Codex → agents as `.toml` (+ recognize top-level `AGENTS.md`). The per-harness connectors (`honeycomb/src/connectors/{cursor,codex,claude-code}.ts`) already encode these real paths — read them there, don't re-guess.
- Keep the existing fail-soft `readDirSafe`/`readFileSafe` posture (`installed-assets.ts:160-184`).
- Make `createFsAssetInstallTarget` (`asset-install-target.ts:33-36`) harness-aware for write-back too, so a pulled Cursor/Codex asset installs into its own harness dir, not `.claude`.
- **Target files:** `installed-assets.ts` (scanner), `asset-install-target.ts` (writer), reuse `harness-registry.ts` + connectors.

### B. Local vs home split (fixes symptom 2)

- Turn on home scanning: plumb `includeGlobal` (and an explicit scan root) from `mountSyncApi` → `fetchAssetSyncView` → `scanInstalledAssets`. Add the field to `MountSyncOptions` (`sync-mount.ts:58-81`) and pass it at `sync-api.ts:215`. The scanner already supports both roots and tags scope `repository` vs `user` (`installed-assets.ts:114-122`).
- Decide the project root deliberately: pass the **dashboard-selected project path** as `projectRoot` instead of relying on daemon `process.cwd()`, so the "local" list matches the selected project (the project id already reaches the daemon via the `x-honeycomb-project` header / scope resolution).
- Surface the split in the UI: the row already carries `scope` (`wire.ts:439`, `sync-api.ts:296`). Add a **Local vs Home** grouping (a segmented control, or sections within each list), and extend `ScopeSummary` (`sync.tsx:309-333`) to count by filesystem origin in addition to sync state.
- **Target files:** `sync-mount.ts`, `sync-api.ts`, `installed-assets.ts` (already ready), `sync.tsx` (render the split).

### C. Per-IDE tabs (fixes symptom 3)

- Preserve structured harness identity end to end: stop flattening `sourceHarnesses` to a comma string at `sync-api.ts:281`; carry the array (or a per-harness presence set) on `AssetSyncRow` / `AssetSyncRowSchema` (`sync-api.ts:70-97`, `wire.ts:434-448`). Reconsider the cross-harness dedupe at `installed-assets.ts:228-253` so a Cursor-only vs Claude-only asset stays attributable.
- Add an **IDE/harness tab row** above (or beside) the existing Skills/Agents tabs. Reuse the existing `TabButton` pattern (`sync.tsx:496-523`) — or better, promote it to a shared `primitives.tsx` control since none exists today. The home **harness strip** (`hive/src/dashboard/web/harness-strip.tsx`) already renders one chip/tile per harness off `wire.harnesses()` and is the natural visual precedent to mirror.
- Drive the tab set from the same canonical harness list (`CANONICAL_HARNESS_IDS`) and/or `wire.harnesses()` so only installed harnesses show a tab (matching `harness-strip.tsx` behavior).
- Layout suggestion: **IDE tabs (primary axis) × Skills/Agents (secondary) × Local/Home (grouping)** — three orthogonal filters over the one shared `AssetList` component family that already exists.
- **Target files:** `sync.tsx` (tab layout), `primitives.tsx` (extract a reusable Tabs/Segmented control), `wire.ts` + `sync-api.ts` (carry structured harness list), reuse `harness-strip.tsx` as the pattern.

---

## Open questions

1. **Daemon cwd vs selected project.** What is the daemon's `process.cwd()` in production? If it is not the selected project root, the "local" list today is essentially arbitrary. Confirms the need for Recommendation B's explicit `projectRoot` plumbing.
2. **Cursor's real skill unit.** Home Cursor uses `skills-cursor/`; project Cursor uses `skills/`. Is that an intentional divergence or drift? The descriptor in Recommendation A must handle both, and Cursor `rules/*.mdc` may deserve a place too (currently entirely out of scope of the scanner).
3. **Codex agent format.** Codex agents are `.toml` with a top-level `AGENTS.md`. Should the Sync page surface `.toml` agents as first-class, or is Codex agent-sync out of scope for v1? Determines how far Recommendation A extends.
4. **Dedupe semantics with per-IDE tabs.** If the same-named skill exists in `.claude` and `.cursor`, should it be one row shown under multiple tabs, or distinct per-harness rows? Affects both the union key (`sync-api.ts:243-307`) and the scanner dedupe (`installed-assets.ts:228-253`).
5. **Home write-back safety.** Should promote/pull ever write into `~` (home) assets, or is the write surface project-only? `asset-install-target.ts` supports an `install=global` mode already (`asset-install-target.ts:31, 76`) but the action engine hardcodes `"project"` (`sync-api.ts:513, 543, 593, 600`).
