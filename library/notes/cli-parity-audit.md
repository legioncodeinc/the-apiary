# CLI Parity Audit — Honeycomb, Doctor, Hive, Nectar

**Date:** 2026-07-08
**Scope:** Command surface, UX affordances, and dispatch architecture of the four CLIs in `the-apiary`.
**Method:** Source-driven audit. Every claim below is grounded in the actual files; `file:line` references are included throughout.

---

## TL;DR — The Disparity in One Table

| Capability | Honeycomb | Doctor | Hive | Nectar |
|---|:---:|:---:|:---:|:---:|
| **Version** (`package.json`) | 0.6.1 | 0.4.3 | 0.6.9 | 0.3.3 |
| **Runtime dependencies** | several | **0** | **0** | **0** |
| **Top-level commands** | 34 | 17 | 6 | 16 |
| **Subcommand depth** | 2 levels | flat | flat | flat |
| **`--help` / `-h`** | ✅ | ⚠️ partial | ❌ | ✅ |
| **`--version` / `-V`** | ✅ | ✅ | ❌ | ❌ |
| **Per-command help** | ❌ | ❌ | ❌ | ❌ |
| **Banner / branding** | ✅ ASCII | ✅ color | ❌ | minimal |
| **Color output** | ❌ | ✅ | ❌ | ❌ |
| **Global `--json`** | ✅ | ❌ | ❌ | ❌ (per-cmd only) |
| **Global `--dry-run`** | ✅ | ❌ | ❌ | ❌ (per-cmd only) |
| **Self-diagnostic verb** | ⚠️ `status` only | ✅ `diagnose` | ❌ | ❌ |
| **Self-update** | ⚠️ dry-run only | ✅ dual path | ❌ | ❌ |
| **Telemetry opt-out flag** | env + `telemetry --show` | env + flag | env only | env only |
| **Shell completion** | ❌ | ❌ | ❌ | ❌ |
| **Verbose/quiet/debug** | ❌ | ❌ | ❌ | ❌ |
| **Interactive prompts** | auth only | confirm + token | ❌ | login + review |
| **Command framework** | custom verb-table | custom command-table | 6-case `switch` | `if/else` chain |
| **Tests cover dispatcher** | ✅ | ✅ | ❌ (runners only) | ⚠️ |

**Headline finding:** Honeycomb and Doctor are the two real, feature-bearing CLIs. Hive and Nectar are *daemon bootstraps* wearing a thin CLI costume. The gap between Doctor (zero-dep, 17 polished verbs, colors, dual update paths) and Hive (6 verbs, no `--help`, no `--version`, no status) is the widest in the suite. Doctor is, surprisingly, the most UX-mature CLI of the four despite being the "watchdog" tool — it is the only one with color, branded banners, and a read-only diagnostic.

---

## 1. Architecture Per CLI

### 1.1 Honeycomb — the flagship, two-layer custom dispatcher

- **Bin:** `bundle/cli.js` ← `src/cli/index.ts` (`honeycomb/package.json:13-15`).
- **Dispatch:** hand-rolled, **no framework** (no commander/yargs/cac). Two layers:
  - **Entry/route** — `src/cli/index.ts`, `src/commands/dispatch.ts`, `src/commands/contracts.ts`.
  - **Handlers** — `src/commands/*.ts` (16 handler modules).
- **Source of truth:** `VERB_TABLE` (`contracts.ts:104-220`) — a frozen array mapping each of **34 verbs** to a `VerbClass` (`storage` / `auth` / `local`) **and** a `VerbGroup` (the help-section axis). A verb whose group is not in `VERB_GROUPS` fails the build (`contracts.ts:64-70`) — a nice structural guard against commands vanishing from help.
- **Subcommand parsing:** re-implemented per handler (`parseMemoryCliArgs`, `parseAssetCliArgs`, `parseSettingsCliArgs`, …). Explicitly flagged as a jscpd concern in `src/commands/CONVENTIONS.md:108`, mitigated by routing generic storage verbs through one `runStorageVerb`.
- **Composition root:** `src/cli/runtime.ts:647-672` binds the scaffold to real DaemonClient/auth/telemetry.
- **Exit discipline:** does **not** call `process.exit()`; sets `process.exitCode` and lets the loop drain (Windows libuv `UV_HANDLE_CLOSING` fix, `index.ts:70-88`).

### 1.2 Doctor — zero-dependency, flat command table

- **Bin:** `bundle/cli.js` ← `src/cli/bin.ts` (`doctor/package.json:15-17`).
- **Zero runtime deps** (`package.json:34-40`) — the "can't-crash watchdog" constraint. This is load-bearing and shapes everything: no chalk, no commander, no fetch-deps beyond node built-ins.
- **Dispatch:** 5-layer chain — `bin.ts` → `index.ts:runCli` → `dispatch.ts:route` (a `switch` over the closed `CommandName` union with a TypeScript `never` exhaustiveness guard, `dispatch.ts:438-442`).
- **Source of truth:** `command-table.ts` — `CommandName` union (17 members) + `COMMAND_MENU` array. Both dispatcher **and** banner menu read it, so help "cannot drift" from dispatch.
- **Dependency injection:** every command runs against an injected `CliContext` (`context.ts:210-231`), making the whole surface hermetic and unit-testable without process spawning.
- **Exit discipline:** handlers return exit codes; three named constants `EXIT_OK=0` / `EXIT_ERROR=1` / `EXIT_DECLINED=2` (`dispatch.ts:32-34`). `EXIT_DECLINED` is used when a user aborts a gated confirm — a genuinely nice touch none of the other three have.

### 1.3 Hive — a daemon bootstrap, not really a CLI

- **Bin:** `dist/cli.js` ← `src/cli.ts` (`hive/package.json:20-22`). 62 lines total.
- **Dispatch:** a single `switch (process.argv[2] ?? "start")` over **6 cases** (`cli.ts:17-45`). No framework, no flags, no parser. `argv[3+]` is never read.
- **No `src/cli/` directory** — just two flat files `cli.ts` + `cli-commands.ts`. The runners were split out purely for **test-injectability** (`cli-commands.ts:2-3`), not extensibility.
- **The README is honest about this:** *"The `hive` binary keeps a deliberately small surface. It's a portal daemon, not a Swiss Army knife"* (`README.md:156`), *"That's the whole list, on purpose"* (`README.md:167`).
- **No-args default = `start`** (`cli.ts:18`), which silently boots the long-running daemon. This contradicts normal CLI convention (no-args → help).

### 1.4 Nectar — single-file fat dispatcher

- **Bin:** `dist/cli.js` ← `src/cli.ts` (1646 lines, `nectar/package.json:19-21`).
- **Dispatch:** `main(argv)` (`cli.ts:1536-1618`) — a hand-rolled **`if/else` chain** on `argv[0]`. No framework, no command table. Each verb has its own bespoke flag parser, re-implemented 5 separate times.
- **No `src/cli/` directory** — the entire CLI is one file. Supporting logic lives in domain submodules (`brooding/cli.ts`, `registration/prune-cli.ts`, …).
- **Dual-purpose package:** it's both an importable library (`main` → `dist/index.js`) and a CLI — the only one of the four with that shape.
- **Requires `--experimental-sqlite`** at runtime (`package.json:28-36`).

---

## 2. Complete Command Inventory

### 2.1 Honeycomb — 34 verbs (grouped as `--help` renders them)

**Memory & recall**
- `remember [text...]` — write a memory (`--type fact|convention|preference|decision|gotcha|reference`)
- `recall [query]` — hybrid-ranked recall
- `memory <conflicts|stale-refs|inspect>` — lifecycle mgmt (`--status`, `--verdict`, `--winner`, `--reason`, `--lifecycle`)
- `sessions <list|prune>` — captured sessions (`--before`, `--session-id`)
- `pollinate trigger` — consolidation pass (`--compact`)
- `maintenance compact` — version-history compaction (`--table`)

**Knowledge & skills**
- `skill <scope|pull|unpull|force|promote>` — skillify lifecycle
- `skillify` — alias routed identically to `skill`
- `asset <register|promote|demote|style|list|device>` — tier×style lattice
- `ontology <sub>` — ontology control plane
- `graph <sub>` — codebase graph (generic dispatch)
- `sources <sub>` — connect/index/purge sources
- `goal <sub>` — manage goals/KPIs

**Agents, routing & config**
- `agent <sub>` — run an agent turn
- `route <sub>` — manage inference routes
- `secret <set|rm|list>` — write-only named secrets
- `settings <list|get|set|provider>` — vault + provider→model selector (`--model`)

**Account & workspaces** (auth passthrough)
- `login` — device flow (RFC-8628); `--token`, `--endpoint`, `--org`, `--workspace`
- `logout` — remove shared + legacy credentials
- `whoami` — authenticated identity
- `org <list|switch>`
- `workspace <list|switch|use>` (and `workspaces` alias)
- `project <list|bind|use|status>` — per-folder binding

**Setup & system**
- `setup` — detect harnesses, wire hooks, bring up daemon
- `install` — health-gated daemon-up + dashboard (`--ref`, `--home`)
- `status` — D1–D5 connectivity/login/scope diagnostic
- `start` / `stop` — bare aliases of `daemon start`/`stop`
- `daemon <start|stop|status>`
- `dashboard` — launch the daemon-served dashboard
- `hook wire` — inspect/wire harness hooks
- `telemetry [--show]` — glass-box telemetry disclosure
- `update [--dry-run]` — self-update (**live path deferred**; only `--dry-run` works)
- `uninstall [<harness>]` — reverse Honeycomb's changes (fleet-aware)

### 2.2 Doctor — 17 flat verbs

`run` · `status` · `diagnose` · `heal (--yes)` · `restart (--yes)` · `reinstall (--yes)` · `uninstall-hivemind (--yes)` · `update (--check)` · `self-update` · `install-service` · `uninstall-service` · `start` · `stop` · `uninstall` · `purge (--yes, requires typing "purge")` · `logs (--lines, --daemon)` · `help`

Notable: **no per-command source files** — `status`, `diagnose`, `heal`, the rung verbs, service verbs, `uninstall`, `purge`, `logs`, `help` all live inline as functions in `dispatch.ts`. Only `self-update` logic has its own file.

### 2.3 Hive — 6 verbs, zero flags each

`start` (default) · `stop` · `install-service` · `uninstall-service` · `uninstall` · `register`

That is the entire surface. The README mentions "hive graph" / "hive state" / "hive dashboard" but those are **dashboard pages, not CLI commands**.

### 2.4 Nectar — 16 verbs

`daemon` · `login (--org, --workspace)` · `install` · `start` · `stop` · `uninstall` · `status` (alias `service-status`) · `brood (--force, --limit, --dry-run, --model)` · `search (<query>, --limit, --json)` · `projects (--json)` · `brooding (<on|off>, --project, --all, --global-pause, --global-resume)` · `prune (--confirm)` · `review-matches` (interactive) · `rebuild-projection` · `project --rebuild-projection` (near-stub) · `help` / `--help` / `-h`

---

## 3. UX Feature Matrix — Detailed

### Help systems
- **Honeycomb:** ✅ `--help`/`-h`/no-args → grouped `usageText()` (`dispatch.ts:104-123`). ❌ **no per-command help** — `honeycomb recall --help` prints *global* help because `--help` short-circuits before the verb is routed (`dispatch.ts:283-286`).
- **Doctor:** ⚠️ **No `--help`/`-h` flag handling at all.** Only bare invocation, the `help` verb, and unknown-command trigger the banner. `doctor status --help` parses `--help` as a boolean flag and **silently ignores it** — status runs anyway. `-h` would be treated as an unknown command (`dispatch.ts:457` only catches `-v`/`-V`).
- **Hive:** ❌ `hive --help` falls into the `default` case, prints usage to **stderr**, exits **1** — i.e. it looks like an error.
- **Nectar:** ✅ `--help`/`-h`/`help`/no-args all print USAGE. ❌ **no subcommand help** — `nectar brood --help` is rejected as `unknown brood flag: --help` → exit 2.

**Verdict:** None of the four has per-command help. Honeycomb and Nectar have top-level help. Doctor and Hive have broken/absent help-flag handling. This is a suite-wide gap.

### Version flags
- **Honeycomb:** ✅ `--version`/`-V` (`dispatch.ts:279-282`).
- **Doctor:** ✅ `--version`, `-v`, `-V` (`dispatch.ts:457-460`). **Unconventional:** `-v` means version (not verbose).
- **Hive:** ❌ `--version` is an unknown command → usage to stderr, exit 1. Odd because `HIVE_VERSION` is right there in `constants.ts:6`.
- **Nectar:** ❌ `--version` is an unknown command → exit 1. Also odd because `readPackageVersion` already exists in `telemetry-usage/emit.ts`.

### Banners & color
- **Honeycomb:** plain-ASCII banner (`dispatch.ts:89-95`), **deliberately no color/Unicode** ("a dumb terminal would mangle"). No color library is a dependency.
- **Doctor:** ✅ **branded color banner** ("Legion Code Inc. × Activeloop, powered by deeplake.ai"), amber accent (SGR `38;5;214`), honors `NO_COLOR`/`FORCE_COLOR`, degrades on non-TTY (`colors.ts:44-50`). **The only CLI with color.**
- **Hive:** ❌ no banner, no color.
- **Nectar:** ❌ minimal one-line startup message, no color.

### Diagnostic / "doctor" verb
- **Honeycomb:** ⚠️ `status` is a D1–D5 self-check (CLI, daemon, cursor-agent, cursor-login, hooks). No standalone `doctor` verb. (`route doctor` exists only in the **orphaned** `src/cli/route.ts`.)
- **Doctor:** ✅ `diagnose` is the read-only classifier — prints the recommended remediation rung, **takes no action** (AC-064f.3). The gold standard for this pattern.
- **Hive:** ❌ none. Fleet diagnostics are Doctor's job.
- **Nectar:** ❌ none — despite being tightly coupled to Doctor (it registers *with* Doctor).

### Update mechanisms
- **Honeycomb:** ⚠️ `update --dry-run` works; the real self-update is **deferred assembly** — the bin prints that it's deferred.
- **Doctor:** ✅ **dual path** — `update [--check]` for the primary daemon (`@legioncodeinc/honeycomb`), `self-update` for Doctor's own package. Hard-wired so the auto-update engine can never target Doctor (`self-update.ts:7-11`).
- **Hive:** ❌ no self-update; detects reinstall passively via telemetry version-diff.
- **Nectar:** ❌ none; README routes users to an external `get.theapiary.sh` installer.

### Telemetry & opt-out
- **Honeycomb:** ✅ tiered (Tier-1 opt-out / Tier-2 opt-in), env-gated (`HONEYCOMB_TELEMETRY=0`, `DO_NOT_TRACK=1`), **plus a glass-box `telemetry --show` verb** that shows exactly what was/would be sent. Best-in-class.
- **Doctor:** ✅ env-gated + status reports *which layer* disabled it. Lifecycle events `doctor_installed`/`_uninstalled`.
- **Hive:** ⚠️ env-only (`HONEYCOMB_TELEMETRY=0`/`DO_NOT_TRACK`); no flag, no `--help` to discover it, on by default.
- **Nectar:** ⚠️ env-only (`NECTAR_TELEMETRY=0`/`HONEYCOMB_TELEMETRY=0`/`DO_NOT_TRACK`); no flag, no verb.

### Global flags
- **Honeycomb:** ✅ `--json`, `--dry-run`. ❌ no `--cwd`, no `--verbose`/`--quiet`/`--debug`.
- **Doctor:** ❌ no `--json` (despite `hasFlag` JSDoc at `arg-parse.ts:73` naming `--json` as an example — dead doc), no `--cwd`, no verbosity.
- **Hive:** ❌ none. `argv[3+]` is never parsed.
- **Nectar:** ❌ no globals; `--json` exists only on `search` and `projects` (parsed locally).

### Interactive prompts
- **Honeycomb:** auth org/workspace numbered picker via `node:readline` (TTY-only, refuses non-TTY with actionable error).
- **Doctor:** ✅ `confirm` (y/N) for gated rungs + `confirmToken` (exact typed-token match) for `purge` only.
- **Hive:** ❌ none.
- **Nectar:** login readline prompt + `review-matches` interactive accept/reject/skip (non-TTY defaults to skip).

### Shell completion — **absent from all four.**

### Verbose/quiet/debug — **absent from all four.**

---

## 4. Notable Per-CLI Findings

### 4.1 Honeycomb
1. **Three orphaned command modules** — fully implemented, fully tested, but **unreachable from the bin**:
   - `src/cli/keys.ts` — `key create/revoke/list` (PRD-011d). Not in `VERB_TABLE`; `keysMain` imported nowhere live. Its own docstring admits the bin "is not yet extended to dispatch here" (`keys.ts:27-31`).
   - `src/cli/route.ts` — rich `route` runner (7 subcommands incl. `route doctor`). `route` IS in the verb table but dispatches **generically** to `POST /api/inference/routes`, never through `runRouteCommand`.
   - `src/cli/ontology.ts` — same pattern; bespoke `runOntologyCommand` is orphaned while `ontology` dispatches generically.
2. **`update` is a live no-op** beyond `--dry-run`.
3. **Three credential/runtime roots** in play: `~/.deeplake`, legacy `~/.honeycomb`, and `~/.apiary/honeycomb` (ADR-0003 / PRD-072a) — a migration-in-progress surface.
4. **`secret get` deliberately unsupported** — write-only by design; `list` returns names only. Good security posture, worth documenting.
5. **`daemon restart` exists on the lifecycle seam** (`daemon.ts:73`) but is **not exposed** as `honeycomb daemon restart`.
6. **`route`/`graph`/`sources`/`goal`/`agent`** have no documented per-verb subcommands — they rely on an implicit read-shape heuristic (`list`/`get`/`show`/`status`/none = GET, else POST).

### 4.2 Doctor
1. **No `--help`/`-h` flag** — the most glaring gap. `doctor status --help` silently ignores the flag.
2. **`-h` is not wired** while `-v`/`-V` are — `-h` becomes an unknown command. Inconsistent.
3. **`update --check` is the only dry-run-like convention.** No general `--dry-run` across `heal`/`reinstall`/`uninstall-hivemind`/`purge`.
4. **`clear-credentials` deliberately absent** (deferred, OD-4 / AC-064f.4) — only ever *recommended* via escalation, never offered.
5. **Two overlapping `uninstall` verbs** — `uninstall-service` (legacy, service-unit-only) vs `uninstall` (PRD-003b, service + registry + state dir). Documented but a confusion point.
6. **`serviceState` sync seam is dead production code** — always returns `"unknown"`; real path is `serviceStateAsync`. Test-only wart (`index.ts:318-323`).

### 4.3 Hive
1. **No `--help`/`--version`.** The two flags every user tries first both look like errors (stderr, exit 1).
2. **No-args silently starts the daemon** — contradicts CLI convention.
3. **The dispatcher (`cli.ts`) has zero test coverage** — only the 6 runners in `cli-commands.ts` are tested.
4. **No host/port override** — pinned to `127.0.0.1:3853` at compile time (`constants.ts:4-5`); only programmatic injection.
5. **Telemetry on by default, no flag opt-out, no `--help` to discover the env vars.**
6. **`uninstall` vs `uninstall-service` overlap** is a documented footgun (`README.md:172`).
7. **No `status` verb** — can't ask "is the daemon up?" without `curl` or the browser.

### 4.4 Nectar
1. **No `--version`/`-V`** — `readPackageVersion` already exists; trivial to wire.
2. **The `project` command is a near-stub** — only `--rebuild-projection` works; bare `nectar project` exits 2 admitting "The broader project verb surface lands with a later PRD."
3. **Inconsistent `--limit` semantics** — `brood --limit` allows 0 (`brooding/cli.ts:66`), `search --limit` requires ≥1 (`cli.ts:961`). Same flag, different grammar, in the same binary. This is the symptom of re-implementing the parser 5 times.
4. **USAGE string is littered with internal PRD tags** (`PRD-007`, `PRD-008b`, `PRD-019`, …) at `cli.ts:114-151` — internal jargon that means nothing to end users.
5. **`status` vs `service-status` canonical-name disagreement** — README says `service-status` is canonical (`README.md:161`), USAGE says `status` is (`cli.ts:125-126`).
6. **No global `--json`** — `status`, `brood --dry-run`, `prune`, `rebuild-projection` are human-text-only despite being natural CI/scripting targets.

---

## 5. Cross-Cutting Inconsistencies (The Real Parity Problems)

These are the patterns where the four CLIs actively disagree with each other, and where convergence would pay off most.

### 5.1 "How do I see if this thing is healthy?"
| Tool | Answer |
|---|---|
| Honeycomb | `honeycomb status` (D1–D5) |
| Doctor | `doctor status` + `doctor diagnose` (read-only) |
| Hive | `curl http://127.0.0.1:3853/health` or open the browser |
| Nectar | `nectar status` (service state only) + daemon `/health` |

**There is no shared verb.** A user juggling all four tools has to remember four different health-check incantations.

### 5.2 "How do I update?"
| Tool | Answer |
|---|---|
| Honeycomb | `honeycomb update --dry-run` (real path deferred) |
| Doctor | `doctor self-update` (Doctor) + `doctor update` (primary daemon) |
| Hive | (nothing — reinstall externally) |
| Nectar | (nothing — external installer) |

### 5.3 "How do I opt out of telemetry?"
| Tool | Answer |
|---|---|
| Honeycomb | env **or** `honeycomb telemetry --show` |
| Doctor | env **or** flag, surfaced in `status` |
| Hive | env only (no flag, no help to discover it) |
| Nectar | env only (no flag, no help to discover it) |

Three different env-var names are honored across the suite: `HONEYCOMB_TELEMETRY`, `NECTAR_TELEMETRY`, `DO_NOT_TRACK`. At least `DO_NOT_TRACK` is shared.

### 5.4 Help/version flag handling
| Tool | `--help` | `-h` | `--version` | `-V` |
|---|:---:|:---:|:---:|:---:|
| Honeycomb | ✅ | ✅ | ✅ | ✅ |
| Doctor | ❌ ignored | ❌ unknown | ✅ | ✅ (`-v` too) |
| Hive | ❌ error | ❌ error | ❌ error | ❌ error |
| Nectar | ✅ | ✅ | ❌ | ❌ |

### 5.5 Exit-code conventions
- Honeycomb: sets `process.exitCode`, lets loop drain (no `process.exit`).
- Doctor: returns codes; `0`/`1`/`2` (declined).
- Hive: assigns `process.exitCode` from runners.
- Nectar: **`2` for parse errors**, `1` for unknown command / runtime failure, `0` success. **The only one distinguishing parse errors from runtime errors** — a convention the others should adopt.

### 5.6 Service-lifecycle verb naming
| Concern | Honeycomb | Doctor | Hive | Nectar |
|---|---|---|---|---|
| Start daemon | `daemon start` / `start` | `start` | `start` | `start` / `daemon` |
| Stop daemon | `daemon stop` / `stop` | `stop` | `stop` | `stop` |
| Install service | `install` | `install-service` | `install-service` | `install` |
| Uninstall service | `uninstall` | `uninstall-service` | `uninstall-service` | `uninstall` |
| Full purge | `uninstall [<harness>]` | `uninstall` / `purge` | `uninstall` | `uninstall` |

`install-service` vs `install`, and `uninstall` meaning different scopes per tool, is a real footgun across the suite.

---

## 6. What I Would Do Differently

Ordered by impact-to-effort ratio. The guiding principle: **Honeycomb's verb-table + Doctor's UX polish should become the shared bar**, and Hive/Nectar should be lifted to it.

### 6.1 Define a shared CLI contract (highest leverage)
Write a short `library/notes/cli-contract.md` that pins, for every Apiary CLI:
- `--help`/`-h` (top-level **and** per-command), `--version`/`-V`, no-args → help.
- A canonical health verb: **`status`** (read-only state) and, where applicable, **`diagnose`** (read-only classifier that recommends but does not act). Doctor's split here is the model.
- A canonical self-update verb: **`update`** (with `--check`/`--dry-run`) and **`self-update`** where the tool updates its own package. Doctor's dual-path is the model.
- A canonical telemetry verb: **`telemetry --show`** plus env opt-out. Honeycomb's glass-box is the model.
- Exit codes: `0` ok, `1` runtime failure, `2` parse error (Nectar's convention, generalized).
- One shared telemetry env var name across the suite (today: three different ones).

This contract becomes the rubric every new CLI is measured against.

### 6.2 Extract a tiny shared CLI kit (`@legioncodeinc/cli-kit`)
The zero-dependency constraint (Doctor/Hive/Nectar) is valuable and should be preserved. But each of the three re-implements: a banner, a color helper, an arg parser, a usage renderer, a Windows-safe exit. Doctor already has the best implementations of all of these (`banner.ts`, `colors.ts`, `arg-parse.ts`, `shutdown.ts`).

- Promote Doctor's `colors.ts` (SGR helpers, `NO_COLOR`/`FORCE_COLOR`-aware, non-TTY degradation) into a shared zero-dep kit and adopt it in Honeycomb (which today has **no color at all**), Hive, and Nectar.
- Promote Doctor's `shutdown.ts` (the undici-global-dispatcher + unref + backstop pattern) so Honeycomb and Hive stop re-inventing the Windows-exit fix. (Honeycomb has a different inline fix at `index.ts:70-88`; Nectar appears to rely on node defaults.)
- Promote Nectar's exit-code-`2`-for-parse-errors convention into the kit's default parser.

This is not "add commander" — it's "stop writing the same 40-line arg parser four times."

### 6.3 Fix Hive first (it's the most user-hostile)
Hive is the widest gap. Concretely:
1. Add `--help`/`-h` (top-level, printing the 6 verbs with one-line summaries) and `--version`/`-V`.
2. Make no-args print help, not silently start the daemon. (Adjust the `npm start` script to call `hive start` explicitly.)
3. Add a `status` verb (is the daemon up? what port? what version?) — every other tool has one.
4. Move the telemetry opt-out env vars into `--help` output.
5. Add tests for `cli.ts` itself (today only the runners are tested).

### 6.4 Give Nectar `--version`, global `--json`, and a real `project` verb
- Wire `--version` (the function already exists).
- Promote `--json` from per-command to global; add it to `status`, `brood --dry-run`, `prune`.
- Either finish or remove the `project` near-stub; an exit-2 "later PRD" message is dead surface.
- Strip the internal `PRD-xxx` tags from the USAGE string.
- Reconcile the `status` vs `service-status` canonical-name disagreement between README and USAGE.
- Fix the `--limit` inconsistency (decide: 0 allowed or not) by sharing one parser.

### 6.5 Close Honeycomb's orphaned-command gap
Either wire `keys`, `route` (the rich runner), and `ontology` (the rich runner) into `VERB_TABLE` and dispatch, or delete the orphaned modules. Shipping tested-but-unreachable code is a maintenance and security liability — `src/cli/route.ts` even has a `route doctor` subcommand that users would want but can't reach.

### 6.6 Add per-command help everywhere
None of the four supports `honeycomb recall --help` showing recall-specific help. This is the single biggest discoverability gap after Hive's missing `--help`. The fix is small: each handler already prints its own usage on empty/unknown subcommand — route `verb --help` to that same path.

### 6.7 Standardize service-lifecycle verbs
Pick one naming scheme across the suite. Recommendation:
- `<tool> install` → install service + register + first-run
- `<tool> uninstall` → full surgical removal (the "more" verb)
- `<tool> service install` / `<tool> service uninstall` → service-unit-only (the "less" verb), as a noun-grouped subcommand instead of a hyphenated top-level verb.

This dissolves the `install` vs `install-service` and the overlapping-`uninstall` footguns in one move.

### 6.8 Add a suite-wide self-diagnostic
Doctor already diagnoses the *other* tools. Give each tool a `doctor`-style read-only verb (Honeycomb's `status` is close; Nectar has none; Hive has none) so the experience is uniform: any tool can be asked "are you healthy?" with the same verb.

---

## 7. Quick-Reference: What Exists vs What Doesn't

| Feature | Exists in | Missing from |
|---|---|---|
| `--help` top-level | Honeycomb, Nectar | Doctor (flag ignored), Hive (error) |
| `-h` short | Honeycomb, Nectar | Doctor (unknown cmd), Hive (error) |
| `--version` | Honeycomb, Doctor | Hive, Nectar |
| Per-command help | — | **all four** |
| Color | Doctor | Honeycomb, Hive, Nectar |
| Branded banner | Honeycomb, Doctor | Hive, Nectar |
| `status` verb | Honeycomb, Doctor, Nectar | Hive |
| `diagnose` verb | Doctor | Honeycomb, Hive, Nectar |
| Self-update | Doctor (dual) | Hive, Nectar; Honeycomb (dry-run only) |
| Telemetry glass-box verb | Honeycomb | Doctor, Hive, Nectar |
| Global `--json` | Honeycomb | Doctor, Hive, Nectar |
| Global `--dry-run` | Honeycomb | Doctor, Hive, Nectar |
| `--cwd` | — | **all four** |
| Verbose/quiet/debug | — | **all four** |
| Shell completion | — | **all four** |
| Exit code `2` for parse err | Nectar | Honeycomb, Doctor, Hive |
| Windows-safe exit | Honeycomb, Doctor | Hive, Nectar (unclear) |

---

*End of report. Findings are source-grounded; see `file:line` references throughout. No files outside `library/notes/` were modified.*
