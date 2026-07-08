# PRD-006: Reliable Claude Code Plugin Delivery and Auto-Wiring

> **Status:** Backlog
> **Priority:** P0 (a fresh fleet install does not surface Honeycomb's Claude Code plugin, its `honeycomb-memory` skill, its `/recall` `/remember` `/forget` commands, or its MCP server; the memory product is invisible in Claude Code for the two most common install paths)
> **Effort:** L (1-3d) across four sub-PRDs; sub-PRD A alone is S (< 1d) and urgent.
> **Schema changes:** None to any Deeplake catalog. Adds one npm packaging change, a durable pack-check assertion, a daemon-side reconcile loop, one honeycomb-side onboarding seam consumed by hive, and one dashboard status field.

---

## Overview

A user installs the Apiary fleet and expects Honeycomb's memory to show up inside Claude Code: the `honeycomb` plugin registered, the `honeycomb-memory` skill available, the `/recall` `/remember` `/forget` slash commands present, and a `honeycomb` MCP server serving `memory_search` / `hivemind_search` / `hivemind_read` / `memory_store`. In the field, none of it appears on a normal install. The recall arms and the plugin's skill, commands, and MCP registration were built and merged in honeycomb ([`PRD-075`](../../../../honeycomb/library/requirements/completed/prd-075-on-demand-recall-command-surface/prd-075-on-demand-recall-command-surface-index.md) + [`PRD-076`](../../../../honeycomb/library/requirements/completed/prd-076-always-on-recall-and-plugin-packaging/prd-076-always-on-recall-and-plugin-packaging-index.md)), and every test, security review, and QA pass went green. The integration still does not reach users because the tests and CI assert those components exist *in the repo* and parse, never that they are present in the *published npm tarball* or that anything *runs the registration* on the primary install paths.

There are two independent root causes, and this PRD fixes both so the integration reliably appears:

1. **Packaging incompleteness (root cause A, the immediate bug).** The npm `files` allowlist in [`honeycomb/package.json`](../../../../honeycomb/package.json) (lines 23-49) ships the plugin's `bundle`, `.claude-plugin` (plugin.json), `hooks`, and `mcp/bundle` (the MCP server binary), but omits the three components that carry the new surface: `harnesses/claude-code/.mcp.json` (the MCP registration file, PRD-076b), `harnesses/claude-code/skills/` (the `honeycomb-memory` skill, PRD-076c), and `harnesses/claude-code/commands/` (`/recall` `/remember` `/forget`, PRD-076c). Because Claude Code installs the plugin from the npm package's marketplace source dir (`marketplace add <packageRoot>` in [`honeycomb/src/connectors/claude-code.ts`](../../../../honeycomb/src/connectors/claude-code.ts)), files omitted from the tarball are simply not there to install. So even a correctly-registered plugin cannot expose the skill, commands, or MCP server.

2. **The plugin is never auto-wired (root cause B, the timing and path gap).** The plugin is not installed by npm; it is registered by driving the first-party `claude plugin` CLI through the connector (`marketplace add` + `plugin install honeycomb@honeycomb` + `enable`). `honeycomb install` runs that connector best-effort at the very end ([`runInstallSetupStep`](../../../../honeycomb/src/commands/install.ts), install.ts:462, called at install.ts:541). It reliably fails to register when the `claude` CLI is not on PATH at install time (fail-soft writes a settings.json fallback and registers no marketplace plugin), when `~/.claude` does not exist yet (Claude Code has never run), or when the fleet installer took the **portal path**, where a bare `install.ps1` / `install.sh` invocation installs Hive and opens onboarding but never calls `honeycomb install`, so the connector never runs at all. It is a one-shot at the moment the `claude` dependency is least likely to be present, and it is skipped entirely on the primary onboarding flow. Running `honeycomb setup` by hand later fixes it (confirmed working), which proves the connector is correct: the gap is that nothing runs it reliably.

This PRD adds a layered, self-healing design. Sub-PRD A makes the published package complete and adds a durable guard so a declared-but-unshipped plugin component fails the build, not the user's install. Sub-PRD B is the primary backstop: a daemon-side idempotent reconcile that detects a present agent whose plugin is not yet enabled and runs the connector, covering both install paths and the ordering race with zero user action. Sub-PRDs C and D add the human-in-the-loop and the visibility: a Hive onboarding "Connect your coding assistant" step for the one case automation cannot cover (Claude Code not installed at all), and a Hive dashboard harness-status card that reports the reconcile outcome and offers a manual repair.

The doc lives in the-apiary because this is a fleet-level concern spanning honeycomb (packaging, connector, daemon), hive (onboarding, dashboard), and the fleet installer (`scripts/install/`). The implementation is in the submodules.

## Priority framing (read this first)

- **A is the urgent hotfix.** The merged PRD-075/076 work currently does not ship: the skill, commands, and MCP registration are absent from the tarball. A must land and be re-released before any of the plugin surface can reach a single user, regardless of B, C, or D.
- **B is the primary automatic backstop.** Once the package is complete, the reconcile is what makes the plugin reliably appear on both install paths and after out-of-order installs, with no user action.
- **C and D add the human-in-the-loop and visibility.** C handles the one case automation cannot (Claude Code not installed at all). D surfaces state and a manual repair.

---

## Code-grounded current state

Every row is verified against the honeycomb submodule at its current pin (the PRD-075 + PRD-076 merge) and the fleet installer at repo root.

| Area | Where | Today | Gap |
|---|---|---|---|
| npm packaging allowlist | [`honeycomb/package.json`](../../../../honeycomb/package.json):23-49 | Ships `harnesses/claude-code/bundle` (:31), `.claude-plugin` (:32), `hooks` (:33), `mcp/bundle` (:34). | Omits `harnesses/claude-code/.mcp.json`, `harnesses/claude-code/skills`, and `harnesses/claude-code/commands`. Those files exist in the repo but never reach the published tarball. |
| Publish gate assertions | [`honeycomb/scripts/pack-check.mjs`](../../../../honeycomb/scripts/pack-check.mjs):49-57 | `REQUIRED` asserts the MCP server bundle `harnesses/claude-code/mcp/bundle/server.js` (:52) plus the CLI, daemon entry, and assets are in `npm pack --dry-run`. | Asserts nothing about `.mcp.json`, `skills/`, or `commands/`. A future `files` regression that drops any declared plugin component passes the gate silently. |
| MCP registration file | [`honeycomb/harnesses/claude-code/.mcp.json`](../../../../honeycomb/harnesses/claude-code/.mcp.json) | Declares the `honeycomb` MCP server pointing at `${CLAUDE_PLUGIN_ROOT}/mcp/bundle/server.js`. | Exists in the repo, not in the `files` allowlist, so it is absent from the installed plugin. |
| Skill | [`honeycomb/harnesses/claude-code/skills/honeycomb-memory/SKILL.md`](../../../../honeycomb/harnesses/claude-code/skills/honeycomb-memory/SKILL.md) | The `honeycomb-memory` skill (search-before-task, cite-and-zoom, store-with-type). | Same: exists, not shipped. |
| Slash commands | [`honeycomb/harnesses/claude-code/commands/`](../../../../honeycomb/harnesses/claude-code/commands/) (`recall.md`, `remember.md`, `forget.md`) | The `/recall` `/remember` `/forget` commands. | Same: exist, not shipped. |
| Plugin manifest + hooks | [`honeycomb/harnesses/claude-code/.claude-plugin/plugin.json`](../../../../honeycomb/harnesses/claude-code/.claude-plugin/plugin.json), [`hooks/hooks.json`](../../../../honeycomb/harnesses/claude-code/hooks/hooks.json) | `plugin.json` carries name/description/version; `hooks.json` declares 7 lifecycle hooks. Skills, commands, and `.mcp.json` are auto-discovered by directory convention (not listed in plugin.json). | The plugin declares its surface by convention, so the guard in A must check the conventional paths, not parse a manifest list. |
| Marketplace source | [`honeycomb/.claude-plugin/marketplace.json`](../../../../honeycomb/.claude-plugin/marketplace.json):15 | Declares the `honeycomb` plugin with `"source": "./harnesses/claude-code"`, so the plugin is installed from the npm package dir. | Confirms A: only files inside the packaged `harnesses/claude-code` tree reach the installed plugin. |
| Connector registration | [`honeycomb/src/connectors/claude-code.ts`](../../../../honeycomb/src/connectors/claude-code.ts):137-165 | `install()` migrates, then `marketplace add <pkgRoot>` (:151), `marketplace update` (:152), `plugin install honeycomb@honeycomb` (:153), `plugin enable` (:155). Idempotent. | Correct; nothing runs it reliably (see below). |
| Connector fail-soft | [`honeycomb/src/connectors/claude-code.ts`](../../../../honeycomb/src/connectors/claude-code.ts):203-211 | When `claude` is not on PATH, `failSoftInstall()` writes an absolute-path `~/.claude/settings.json` hooks fallback and registers NO marketplace plugin. | On a machine without the `claude` CLI at install time, no plugin is ever registered. |
| Plugin runner probes | [`honeycomb/src/connectors/plugin-runner.ts`](../../../../honeycomb/src/connectors/plugin-runner.ts):45,52,111 | `available()` probes `claude --version` (:104); `isPluginEnabled(name)` parses `claude plugin list` (:111) and returns false when `claude` is absent or the plugin is missing/disabled. | These are exactly the cheap capability checks a reconcile needs to gate on. |
| Install-time wiring | [`honeycomb/src/commands/install.ts`](../../../../honeycomb/src/commands/install.ts):462,541 | `runInstallSetupStep` runs the connector best-effort at the end of `honeycomb install`, fail-soft. | One-shot, at the moment `claude` is least likely present; never re-attempted. |
| Real connector binding | [`honeycomb/src/cli/connector-runner.ts`](../../../../honeycomb/src/cli/connector-runner.ts):57-70,91 and [`honeycomb/src/cli/runtime.ts`](../../../../honeycomb/src/cli/runtime.ts):647,664 | `buildConnectorRunner()` builds the real `ClaudeCodeConnector` with `createClaudePluginRunner()` + `packageRoot()`; `buildRuntimeDeps` binds `connector: buildConnectorRunner()`. | The real connector is wired into the CLI runtime; a daemon-side reconcile needs the same connector composition. |
| Harness auto-wire engine | [`honeycomb/src/notifications/auto-wiring.ts`](../../../../honeycomb/src/notifications/auto-wiring.ts):38-48 | `createAutoWiring({ connector })` exposes `wire()` (delegates to `connector.install()`, idempotent) and `unwire()`. Described as the health-driven auto-wire for PRD-020d. | Already the right seam for a reconcile to call; it just needs a trigger and a gate. |
| Harness detection | [`honeycomb/src/daemon/runtime/dashboard/harness-detect.ts`](../../../../honeycomb/src/daemon/runtime/dashboard/harness-detect.ts):69-72,131 | `detectInstalledHarnesses()` reports claude-code present when `~/.claude/settings.json` OR `~/.claude/plugins/honeycomb` exists. | Detects the agent's presence but not whether the plugin is enabled; the reconcile combines this with `isPluginEnabled`. |
| Harness status API | [`honeycomb/src/daemon/runtime/dashboard/harness-api.ts`](../../../../honeycomb/src/daemon/runtime/dashboard/harness-api.ts):296 | `mountHarnessApi` serves `GET /api/diagnostics/harnesses` with an `installed` flag per harness (PRD-039a). | Reports "installed" (agent present) but not the plugin's enabled state or a repair affordance. |
| Fleet installer routing (Windows) | [`scripts/install/install.ps1`](../../../../scripts/install/install.ps1):1187-1192,927 | `Invoke-Main` routes a bare invocation (no selection) to `Invoke-PortalMain` (:927), which installs Hive, runs `hive install-service`, and opens onboarding. Only `Invoke-LegacyMain` (`--products` given) hands off to `honeycomb install` (:1156). | On the primary portal path, `honeycomb install` (and therefore the connector) never runs. |
| Fleet installer routing (POSIX) | [`scripts/install/install.sh`](../../../../scripts/install/install.sh):1323-1338,1088 | `main()` routes a bare invocation to `run_portal_path()` (:1088), which installs Hive and opens onboarding. Only `legacy_main()` (:1194) hands off to `honeycomb install` (:1283). | Same portal gap as Windows. |
| Release-gate history | [`honeycomb/library/ledger/EXECUTION_LEDGER-prd-075-076.md`](../../../../honeycomb/library/ledger/EXECUTION_LEDGER-prd-075-076.md) (F-1, lines 147, 171-173) | The prior packaging fix (F-1, commit eeb9400) added only `harnesses/claude-code/mcp/bundle` to `files` and a matching `pack-check` assertion. Its QA note assumed `.mcp.json` / skills / commands "ship via the marketplace source dir". | That assumption is the bug: the marketplace source dir is the npm package dir, whose contents are governed by the `files` allowlist, which omits those three paths. |

---

## Sub-features

| Sub-PRD | Scope | Priority | Status |
|---|---|---|---|
| [`prd-006a-...-packaging-completeness`](./prd-006a-claude-code-plugin-delivery-and-auto-wiring-packaging-completeness.md) | Add `.mcp.json`, `skills`, and `commands` to `honeycomb/package.json` `files`; extend `pack-check.mjs` to assert every declared plugin component (hooks handlers, the MCP server bundle the `.mcp.json` references, the skills dir, the commands dir) is in the pack. The urgent hotfix + regression guard. | P0 urgent | Backlog |
| [`prd-006b-...-self-healing-reconcile`](./prd-006b-claude-code-plugin-delivery-and-auto-wiring-self-healing-reconcile.md) | A daemon-side (or Doctor-side) idempotent reconcile that, on start and on an idle cadence, wires any harness whose agent is present but whose plugin is not enabled, gated so steady state is a cheap no-op. The primary automatic backstop. | P0 | Backlog |
| [`prd-006c-...-onboarding-connect-step`](./prd-006c-claude-code-plugin-delivery-and-auto-wiring-onboarding-connect-step.md) | A Hive onboarding "Connect your coding assistant" step that triggers the reconcile and shows status, including the "Install Claude Code, then Retry" case automation cannot cover. Scopes the honeycomb-side seam; hive owns the UI. | P1 | Backlog |
| [`prd-006d-...-harness-status-card`](./prd-006d-claude-code-plugin-delivery-and-auto-wiring-harness-status-card.md) | Extend the harness-status surface with per-harness connection state (agent present? plugin enabled?) and a "Reconnect / Repair" button that re-runs setup. Where B reports its outcome and the manual fallback lives. | P1 | Backlog |

---

## Acceptance criteria (module-level)

| ID | Criterion |
|---|---|
| AC-1 | The published `@legioncodeinc/honeycomb` tarball contains `harnesses/claude-code/.mcp.json`, `harnesses/claude-code/skills/honeycomb-memory/SKILL.md`, and `harnesses/claude-code/commands/{recall,remember,forget}.md`, verified by `npm pack --dry-run`. |
| AC-2 | `pack-check` fails the build if any component declared by the plugin (a hooks handler, the MCP server bundle the `.mcp.json` references, the skills dir, or the commands dir) is missing from the pack, so a declared-but-unshipped component breaks the build, not the user's install. |
| AC-3 | After a re-release and a plugin install, a Claude Code session exposes the `honeycomb-memory` skill, the `/recall` `/remember` `/forget` commands, and a registered `honeycomb` MCP server whose tools appear in the tool list. |
| AC-4 | On both install paths (portal and `--products`), if the `claude` agent is present but the Honeycomb plugin is not enabled, the plugin becomes enabled with no user action, via the reconcile, within one reconcile cycle. |
| AC-5 | The ordering race is covered: installing Claude Code after Honeycomb results in the plugin being wired at the next reconcile, with no re-install by the user. |
| AC-6 | Steady state is a cheap no-op: when the plugin is already enabled (or `claude` is absent), the reconcile does not invoke `claude plugin install` and performs no repeated registration work. |
| AC-7 | Hive onboarding presents an explicit "Connect your coding assistant" step that reports "Claude Code connected" on success and, when `claude` is absent, a plain-language "Install Claude Code, then Retry" affordance. |
| AC-8 | The Hive dashboard shows, per harness, whether the agent is present and whether the plugin is enabled, and offers a "Reconnect / Repair" action that re-runs setup and updates the shown state. |
| AC-9 | No flow regresses install: a reconcile, onboarding step, or repair that cannot complete degrades to a clear message and never fails or blocks the install or the daemon. |

---

## Data model changes

No Deeplake catalog changes. Persistent and behavioral effects:

- **npm packaging:** three paths added to the `files` allowlist (A). No new runtime data.
- **Reconcile bookkeeping (B):** the reconcile is idempotent and derives its decision live from `detectInstalledHarnesses` + `isPluginEnabled`; any cadence timestamp or last-outcome it keeps is daemon-local status, not Deeplake state (final placement is an open question below).
- **Dashboard status (D):** one added per-harness field (plugin-enabled) surfaced through the existing harness API; read-only, derived, not stored in Deeplake.

---

## API and configuration changes

- **Packaging (A):** `honeycomb/package.json` `files` gains `harnesses/claude-code/.mcp.json`, `harnesses/claude-code/skills`, `harnesses/claude-code/commands`; `scripts/pack-check.mjs` gains component assertions.
- **Reconcile (B):** a daemon-side reconcile that reuses `createAutoWiring` over the real connector composition (`buildConnectorRunner` / `createConnectorRegistry`), gated on `isPluginEnabled('honeycomb') === false` and `available() === true`.
- **Onboarding seam (C):** a honeycomb-side trigger the Hive onboarding step calls to run the reconcile and return a status the UI renders. Hive owns the step UI; this PRD scopes the seam.
- **Harness status (D):** the harness API (`GET /api/diagnostics/harnesses`) gains a per-harness plugin-enabled field, and a repair action re-runs setup.

---

## Open questions

- [ ] **Reconcile host: daemon vs Doctor.** Lean daemon, since `auto-wiring.ts` is already the health-driven auto-wire seam (PRD-020d) and the daemon already runs `detectInstalledHarnesses`. Counter-argument for Doctor: it keeps the external-CLI side effect (`claude plugin ...`) out of the loopback daemon's request path. Decide the host and whether the cadence is daemon-start-only, periodic, idle-triggered, or a combination.
- [ ] **Cadence and backoff.** How often the reconcile runs, and how it avoids churn (for example, once at start plus an idle interval), so a persistently absent `claude` never spins.
- [ ] **Which harnesses.** The connector registry today builds claude-code, codex, and cursor. Does the reconcile cover all connectored harnesses, or claude-code first with the others following the same shape?
- [ ] **`isPluginEnabled` parsing durability.** It parses `claude plugin list` text output; pin the format assumption and decide the fail-soft behavior if the CLI output shape changes.
- [ ] **Onboarding step placement in Hive.** Where the "Connect your coding assistant" step sits in the existing onboarding flow, and whether it blocks completion or is skippable with a later dashboard repair.
- [ ] **Re-release mechanics for A.** A depends on a honeycomb publish plus the fleet installer resolving the new pinned version; confirm the release train and the version the installer resolves so the fix actually reaches users.

---

## Out of scope

- **Changing the recall behavior itself.** PRD-075/076 own the recall arms, the skill body, the command semantics, and the MCP tool surface; this PRD makes their delivery reliable, it does not alter them.
- **Non-Claude-Code harnesses' feature parity.** Wiring codex/cursor/hermes/pi/openclaw plugins to the same level is adjacent; this PRD's reconcile shape should generalize, but the acceptance surface here is Claude Code.
- **The MCP server implementation and its tools.** Owned by honeycomb's MCP work; this PRD only ensures the registration file ships and the server bundle is present.
- **Fleet install product selection and telemetry.** Owned by [`PRD-002`](../../completed/prd-002-installer-product-loading-and-phone-home/prd-002-installer-product-loading-and-phone-home-index.md); this PRD only observes that the portal path does not run `honeycomb install`.
- **Login and uninstall lifecycle.** Owned by [`PRD-003`](../../completed/prd-003-fleet-lifecycle-login-and-uninstall/prd-003-fleet-lifecycle-login-and-uninstall-index.md).

---

## Prior art

- [`PRD-002` One-Line Installer Product Loading and Install-Time Telemetry](../../completed/prd-002-installer-product-loading-and-phone-home/prd-002-installer-product-loading-and-phone-home-index.md) - the fleet install model and the solo-vs-fleet/portal path split this PRD's root cause B depends on.
- [`PRD-003` Fleet Lifecycle, Login Deferral, and One-Command Uninstall](../../completed/prd-003-fleet-lifecycle-login-and-uninstall/prd-003-fleet-lifecycle-login-and-uninstall-index.md) - the portal path routing (Hive owns onboarding) that explains why the connector never runs on the primary flow.
- [`PRD-005` Desktop Shell](../../in-work/prd-005-desktop-shell/prd-005-desktop-shell-index.md) - adjacent fleet-supervision surface (the desktop shell that will host these flows over time).
- honeycomb [`PRD-050` Quick Install and Guided Setup](../../../../honeycomb/library/requirements/completed/prd-050-quick-install-and-guided-setup/prd-050-quick-install-and-guided-setup-index.md) - the `honeycomb install` verb that runs the connector best-effort.
- honeycomb [`PRD-020d` Notifications and Health](../../../../honeycomb/library/requirements/completed/prd-020-surfaces/prd-020d-surfaces-notifications-health.md) - the health-driven auto-wiring engine (`auto-wiring.ts`) sub-PRD B reuses.
- honeycomb [`PRD-039a` Harnesses Page Registry and Telemetry](../../../../honeycomb/library/requirements/completed/prd-039-harnesses-page/prd-039a-harnesses-page-registry-telemetry.md) - `harness-detect.ts` + `mountHarnessApi`, the detection and status surface B and D extend.
- honeycomb [`PRD-019a` Harness Integrations Connector Base](../../../../honeycomb/library/requirements/completed/prd-019-harness-integrations/prd-019a-harness-integrations-connector-base.md) - the connector base the Claude Code connector subclasses.
- honeycomb [`PRD-075` On-Demand Recall Command Surface](../../../../honeycomb/library/requirements/completed/prd-075-on-demand-recall-command-surface/prd-075-on-demand-recall-command-surface-index.md) and [`PRD-076` Always-On Recall and Plugin Packaging](../../../../honeycomb/library/requirements/completed/prd-076-always-on-recall-and-plugin-packaging/prd-076-always-on-recall-and-plugin-packaging-index.md) - the recall arms and the plugin skill/commands/MCP registration whose delivery this PRD makes reliable.
- honeycomb [`EXECUTION_LEDGER-prd-075-076.md`](../../../../honeycomb/library/ledger/EXECUTION_LEDGER-prd-075-076.md) (F-1) - the prior partial packaging fix that shipped only `mcp/bundle` and its assertion, leaving `.mcp.json`, skills, and commands unshipped.
