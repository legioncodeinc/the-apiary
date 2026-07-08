# PRD-006a: Packaging Completeness and a Durable Pack-Check Guard

> **Parent:** [PRD-006](./prd-006-claude-code-plugin-delivery-and-auto-wiring-index.md)
> **Status:** Backlog
> **Priority:** P0 (urgent hotfix; the merged PRD-075/076 plugin surface does not currently ship)
> **Effort:** S (< 1d)
> **Schema changes:** None. Adds three entries to the npm `files` allowlist and new assertions to the publish gate.

---

## Overview

This is the immediate bug and the immediate fix. The `honeycomb-memory` skill, the `/recall` `/remember` `/forget` commands, and the `honeycomb` MCP registration were built and merged (PRD-076b/c), but they are absent from the published npm tarball because the `files` allowlist in [`honeycomb/package.json`](../../../../honeycomb/package.json):23-49 does not list them. Claude Code installs the plugin from the npm package's marketplace source dir ([`honeycomb/.claude-plugin/marketplace.json`](../../../../honeycomb/.claude-plugin/marketplace.json):15 declares `"source": "./harnesses/claude-code"`), so a file omitted from the tarball is simply not present to install. The immediate fix is to add the three missing paths. The durable fix is to make the publish gate assert that every component the plugin declares is actually in the pack, so a future `files` regression fails the build instead of shipping a broken plugin.

The prior packaging fix (F-1 in [`EXECUTION_LEDGER-prd-075-076.md`](../../../../honeycomb/library/ledger/EXECUTION_LEDGER-prd-075-076.md), commit eeb9400) added only `harnesses/claude-code/mcp/bundle` to `files` and a single matching assertion, and its QA note assumed the other components "ship via the marketplace source dir." That assumption is exactly the defect: the marketplace source dir is the npm package dir, and its contents are governed by the `files` allowlist. This sub-PRD closes that gap and guards it.

## Goals

- Ship the three missing plugin components in the published tarball: `harnesses/claude-code/.mcp.json`, `harnesses/claude-code/skills`, `harnesses/claude-code/commands`.
- Extend the publish gate ([`honeycomb/scripts/pack-check.mjs`](../../../../honeycomb/scripts/pack-check.mjs):49-57) so it asserts every component the plugin declares is in `npm pack --dry-run`: each hooks handler, the MCP server bundle the `.mcp.json` `args` reference, the skills dir, and the commands dir.
- Make the guard derive its checklist from the plugin's own declarations (the conventional plugin paths + the `.mcp.json` server path) rather than a hand-maintained literal list, so adding a future plugin component is protected automatically.
- Re-release honeycomb so the fix reaches users, and confirm the fleet installer resolves the re-released version.

## Non-Goals

- Wiring or running the connector (that is 006b).
- Changing the skill body, command semantics, hooks, or the MCP tool surface (PRD-075/076 own those).
- Altering the `mcp/bundle` build placement, which F-1 already fixed (the server bundle ships at `harnesses/claude-code/mcp/bundle`, asserted at pack-check.mjs:52).

## Code-grounded current state

| Where | Today | Change |
|---|---|---|
| [`honeycomb/package.json`](../../../../honeycomb/package.json):31-34 | `files` lists `harnesses/claude-code/bundle`, `.claude-plugin`, `hooks`, `mcp/bundle`. | Add `harnesses/claude-code/.mcp.json`, `harnesses/claude-code/skills`, `harnesses/claude-code/commands`. |
| [`honeycomb/scripts/pack-check.mjs`](../../../../honeycomb/scripts/pack-check.mjs):49-57 | `REQUIRED` asserts `harnesses/claude-code/mcp/bundle/server.js` (:52) and the CLI/daemon/assets. | Add assertions for `.mcp.json`, `skills/honeycomb-memory/SKILL.md`, and each of `commands/{recall,remember,forget}.md`; ideally derive the MCP-server assertion from the `.mcp.json` `args` path and the hooks assertions from `hooks/hooks.json`. |
| [`honeycomb/harnesses/claude-code/.mcp.json`](../../../../honeycomb/harnesses/claude-code/.mcp.json) | Server `honeycomb` -> `${CLAUDE_PLUGIN_ROOT}/mcp/bundle/server.js`. | Now shipped; the guard reads its `args` to know which bundle to require. |
| [`honeycomb/harnesses/claude-code/skills/honeycomb-memory/SKILL.md`](../../../../honeycomb/harnesses/claude-code/skills/honeycomb-memory/SKILL.md), [`commands/`](../../../../honeycomb/harnesses/claude-code/commands/) | Exist in repo, absent from tarball. | Now shipped and asserted. |
| [`honeycomb/harnesses/claude-code/hooks/hooks.json`](../../../../honeycomb/harnesses/claude-code/hooks/hooks.json) | Declares 7 lifecycle hooks referencing `${CLAUDE_PLUGIN_ROOT}/bundle/index.js`. | The guard confirms the referenced bundle handler ships (already covered by the `bundle` entry, now asserted explicitly). |

## Acceptance criteria

| ID | Criterion |
|---|---|
| a-AC-1 | `honeycomb/package.json` `files` includes `harnesses/claude-code/.mcp.json`, `harnesses/claude-code/skills`, and `harnesses/claude-code/commands` (parent AC-1). |
| a-AC-2 | `npm pack --dry-run` for `@legioncodeinc/honeycomb` lists `.mcp.json`, `skills/honeycomb-memory/SKILL.md`, and `commands/{recall,remember,forget}.md` under `harnesses/claude-code/` (parent AC-1). |
| a-AC-3 | `pack-check.mjs` fails with a clear message if the pack is missing any declared plugin component: a hooks handler, the MCP server bundle named in `.mcp.json`, the skills dir, or the commands dir (parent AC-2). |
| a-AC-4 | The guard's checklist is derived from the plugin's own declarations (the conventional skill/command dirs and the `.mcp.json` server path), so a new declared component is protected without editing a separate literal list (parent AC-2). |
| a-AC-5 | After a re-release, an installed plugin exposes the `honeycomb-memory` skill, the three slash commands, and a registered `honeycomb` MCP server (parent AC-3). |
| a-AC-6 | `npm run ci` and `npm run pack:check` pass on the change; no forbidden files are introduced by widening `files`. |

## Implementation notes

- **Additive `files` edit.** Insert the three paths beside the existing `harnesses/claude-code/*` entries (package.json:31-34) so the plugin tree ships whole. Widening `files` must not pull in anything the `FORBIDDEN` scan (pack-check.mjs:17-27) rejects.
- **Derive, do not duplicate.** Read `harnesses/claude-code/.mcp.json` in the guard and assert the file at its server `args` path (stripping `${CLAUDE_PLUGIN_ROOT}/`) is in the pack; read `hooks/hooks.json` and assert each referenced handler is in the pack; assert the skills and commands dirs are non-empty in the pack. This keeps the guard honest as the plugin grows.
- **Keep the existing positive checks.** The current `REQUIRED` entries (CLI bin, daemon entry, assets, mcp/bundle server) stay; this adds to them.
- **Re-release is part of done.** The fix only reaches users after a honeycomb publish and the fleet installer resolving that version; coordinate with the release train (see the parent's open question on re-release mechanics).

## Open questions

- [ ] Should the guard fail on an empty `skills/` or `commands/` dir specifically (present but empty), not just an absent one?
- [ ] Is there value in a distribution smoke that actually installs the packed tarball and asserts the plugin surface loads, beyond the pack-listing assertion?

## Related

- [PRD-006 index](./prd-006-claude-code-plugin-delivery-and-auto-wiring-index.md)
- honeycomb [`PRD-076b` Register the MCP Server in the Plugin](../../../../honeycomb/library/requirements/completed/prd-076-always-on-recall-and-plugin-packaging/prd-076b-register-mcp-server-in-plugin.md) and [`PRD-076c` Bundle a Memory Skill and Slash Commands](../../../../honeycomb/library/requirements/completed/prd-076-always-on-recall-and-plugin-packaging/prd-076c-bundle-memory-skill-and-slash-commands.md) - the components this sub-PRD ships.
- honeycomb [`EXECUTION_LEDGER-prd-075-076.md`](../../../../honeycomb/library/ledger/EXECUTION_LEDGER-prd-075-076.md) (F-1) - the partial prior fix.
- [`honeycomb/package.json`](../../../../honeycomb/package.json) and [`honeycomb/scripts/pack-check.mjs`](../../../../honeycomb/scripts/pack-check.mjs) - the two files this sub-PRD edits.
