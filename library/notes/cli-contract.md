# Apiary CLI Contract

**Status:** Draft v1 (2026-07-08)
**Scope:** Every command-line tool published under `@legioncodeinc/*` that a human is expected to invoke in a terminal — currently `honeycomb`, `doctor`, `hive`, `nectar`. Future CLIs in the suite MUST conform on day one.
**Companion document:** [`cli-parity-audit.md`](./cli-parity-audit.md) — the source-grounded disparity audit that motivates each rule below.

---

## 1. Purpose

The four Apiary CLIs today disagree on how a user asks "are you healthy?", "how do I update?", "how do I opt out of telemetry?", and even whether `--help` works. This contract exists so that a user who learns one Apiary CLI can predict the rest. It is the rubric every new CLI is measured against, and the target the four existing CLIs are converging toward.

Each rule below names the **canonical implementation** — the existing tool whose behavior is the reference. When in doubt, the canonical implementation wins.

---

## 2. Conformance language

The keywords **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** follow their conventional meanings:

- **MUST** = required for conformance. A CLI that violates a MUST is non-conformant.
- **SHOULD** = strongly recommended; deviations need a documented reason.
- **MAY** = optional.

---

## 3. Definitions

- **CLI** — an `@legioncodeinc/*` package with a `bin` entry that humans invoke in a terminal. A pure library package (`main` only, no `bin`) is out of scope.
- **Verb** — a top-level command word, e.g. `honeycomb recall`, `doctor status`.
- **Subcommand** — a second-level word under a verb, e.g. `honeycomb memory conflicts`.
- **One-shot command** — a verb that runs to completion and exits (e.g. `doctor status`).
- **Long-running command** — a verb that stays attached (e.g. `nectar daemon`, `hive start`).
- **Global flag** — a flag accepted before the verb and parsed centrally (e.g. `--json`), not by an individual handler.
- **Canonical implementation** — the existing tool whose behavior defines the rule. Cited inline as `Canonical: <tool>`.

---

## 4. Required flags

### 4.1 `--help` / `-h` — MUST

Every CLI MUST accept `--help` and `-h` at the top level. They MUST print a usage summary to **stdout** and exit **0**.

- `--help` MUST short-circuit before any command runs, any network call is made, or any daemon is contacted.
- An unknown verb with `--help` (e.g. `tool frobnicate --help`) is a judgment call; this contract RECOMMENDS per-command help (§4.4) over erroring.

**Canonical:** `honeycomb` (`src/commands/dispatch.ts:279-286`), `nectar` (`src/cli.ts:1539`).
**Non-conformant today:** `doctor` (parses `--help` as a boolean flag and silently ignores it; `-h` becomes an unknown command), `hive` (`--help` falls through to the default case, prints usage to **stderr**, exits **1**).

### 4.2 `--version` / `-V` — MUST

Every CLI MUST accept `--version` and `-V`. They MUST print `<slug> v<version>` to **stdout** and exit **0**. The version MUST be single-sourced (esbuild `define`, a generated `version.ts`, or read-once from `package.json`) and MUST NOT be hardcoded in two places.

- `-V` is the short form for version. **`-v` MUST NOT mean version** — it collides with the conventional `--verbose` and should be reserved (§8.3). Doctor's use of `-v` for version today is non-conformant and MUST be migrated.

**Canonical:** `honeycomb` (`src/commands/dispatch.ts:279-282`, prints `${PRODUCT_SLUG} v${HONEYCOMB_VERSION}`).
**Non-conformant today:** `hive`, `nectar` (both treat `--version` as an unknown command); `doctor` (uses `-v`, which §8.3 reserves for verbose).

### 4.3 No-args behavior — MUST

A bare invocation (`tool` with no arguments) MUST print the top-level usage summary to **stdout** and exit **0**. It MUST NOT silently start a long-running daemon, contact a network endpoint, or mutate state.

This is the most-violated rule today: `hive` defaults no-args to `start` and silently boots the daemon (`hive/src/cli.ts:18`); `nectar daemon` is the documented foreground entry instead. Both MUST change. The `npm start` script is the correct place to pin a default verb — not the bare binary.

**Canonical:** `honeycomb`, `nectar` (both print usage on no-args).
**Non-conformant today:** `hive` (silently starts), `doctor` (conforms — no-args prints the banner+menu).

### 4.4 Per-command help — SHOULD

Each verb SHOULD accept `<verb> --help` (and `<verb> -h`) and print that verb's own usage: subcommands, flags, and at least one example. A top-level `--help` that prints global help no matter which verb precedes it (today's behavior in all four) is non-conformant to this SHOULD.

The mechanism is small: each handler already renders its own usage on empty/unknown subcommand — route `<verb> --help` to that same path.

**Canonical:** none today. This is a convergence target, not a preserved behavior.

---

## 5. Health verbs

The suite MUST offer a uniform way to ask "is this thing healthy?" Two distinct verbs, with a sharp boundary between them:

### 5.1 `status` — MUST (read-only state report)

Every CLI MUST provide a `status` verb that reports, without side effects:
- whether the binary can reach its daemon / backing service,
- the authenticated identity (if applicable),
- the resolved scope (org/workspace/project, if applicable),
- the daemon and CLI versions,
- the opt-out flags currently in effect.

`status` MUST NOT take remedial action. It is a snapshot, not a fix. Exit **0** when reachable, **1** when not.

**Canonical:** `honeycomb status` (D1–D5 probes, `src/commands/status.ts`), `doctor status` (`src/cli/dispatch.ts:58-112`).
**Non-conformant today:** `hive` (no `status` verb at all — requires `curl http://127.0.0.1:3853/health`), `nectar status` (reports OS-service state only, not daemon reachability).

### 5.2 `diagnose` — SHOULD (read-only classifier)

Where a CLI has a notion of health classification (degraded, broken, needs-update), it SHOULD provide a `diagnose` verb that:
- classifies the current state into a named category,
- prints the recommended remediation **but does not perform it**,
- exits 0 unconditionally (it is advisory).

The split between `status` (snapshot) and `diagnose` (recommendation) is load-bearing: `status` answers "what is happening?", `diagnose` answers "what should I do about it?".

**Canonical:** `doctor diagnose` (AC-064f.3 — "takes NO action", `src/cli/dispatch.ts:115-137`). This is the model the rest of the suite should adopt.

---

## 6. Update verbs

### 6.1 `update` — MUST (where self-update is supported)

A CLI that can update another component MUST expose `update`:

- `update` with no flags performs the update.
- `update --check` (alias `--dry-run`) is a **read-only preview** that prints the plan and changes nothing. This flag MUST be honored uniformly — never half-wired (today `honeycomb update` works only for `--dry-run`; the live path is "deferred assembly", which is non-conformant).
- `update` targets the component the tool is responsible for, never the tool itself.

### 6.2 `self-update` — MUST (where the tool updates its own package)

A CLI whose own npm package can be updated MUST expose `self-update`, distinct from `update`. The two MUST NOT be conflated, and `update`'s engine MUST be hard-wired so it can never target the tool's own package.

**Canonical:** `doctor` — `update [--check]` for the primary daemon (`@legioncodeinc/honeycomb`), `self-update` for Doctor's own package; engine hard-wired at `src/cli/self-update.ts:7-11`.
**Non-conformant today:** `honeycomb` (live update deferred), `hive` (no update verb at all), `nectar` (no update verb at all).

---

## 7. Telemetry

### 7.1 Opt-out MUST be environment-based and uniform

Every telemetry-emitting CLI MUST honor **all three** of these env vars (any one suffices to opt out):
- `DO_NOT_TRACK=1` (the cross-industry convention)
- `<TOOL>_TELEMETRY=0` (the tool's own var, e.g. `NECTAR_TELEMETRY`, `HONEYCOMB_TELEMETRY`)
- `HONEYCOMB_TELEMETRY=0` (accepted as a shared alias across the suite, for historical reasons)

A CLI MUST NOT invent a fourth unrelated var name. New tools SHOULD default to honoring `DO_NOT_TRACK` plus their own `<TOOL>_TELEMETRY` and the shared `HONEYCOMB_TELEMETRY` alias.

### 7.2 `telemetry --show` — SHOULD (glass-box disclosure)

A CLI that emits telemetry SHOULD provide a `telemetry` verb whose default (or `--show`) action prints exactly what was or would be sent: the event names, the fields, the destination, the opt-out state. This is the discovery mechanism for users who don't read the README.

**Canonical:** `honeycomb telemetry [--show]` (`src/commands/telemetry.ts:57-80`). Doctor and Nectar SHOULD grow an equivalent verb; Hive MAY, given its smaller surface.

### 7.3 No flag-only opt-out

Telemetry opt-out MUST NOT be flag-only (env vars are required for service-mode and scripted use). Conversely, where a CLI has a `telemetry` verb, it MAY also accept a `--no-telemetry` flag for interactive convenience, but the env var is the source of truth.

---

## 8. Global flags and output

### 8.1 `--json` — MUST (global)

Every CLI MUST accept `--json` as a global flag, parsed before the verb. When set, machine-readable output replaces human-readable output for verbs that produce structured results (`status`, `recall`, `list`, `search`, `inspect`, dry-run previews, etc.).

- `--json` MUST imply non-interactive mode: no prompts, no color, no banner.
- A verb that has no structured representation MAY ignore `--json`, but MUST NOT crash.
- `--json` MUST NOT be a per-verb flag only (today Nectar has it on `search`/`projects` but not `status`/`prune`; non-conformant).

**Canonical:** `honeycomb` (`GlobalFlags.json`, `src/commands/contracts.ts:279`).

### 8.2 `--dry-run` — SHOULD (global)

CLIs with mutating verbs SHOULD accept `--dry-run` as a global flag. When set, any write/delete/install action prints its plan and exits **0** without touching state.

**Canonical:** `honeycomb` (`GlobalFlags.dryRun`, `src/commands/contracts.ts:281`). Doctor's `update --check` is a per-verb precedent but SHOULD generalize.

### 8.3 `-v` / `--verbose`, `-q` / `--quiet`, `--debug` — SHOULD

CLIs SHOULD reserve and implement a standard verbosity triple:

- `-v` / `--verbose` — increase log detail (diagnostic info to stderr).
- `-q` / `--quiet` — suppress non-essential stdout (only the final result).
- `--debug` — maximum detail, including internal decisions and redacted network traces.

`-v` is reserved for verbose. Any CLI currently using `-v` for version (Doctor) MUST migrate to `-V` for version and reclaim `-v` for verbose.

**Non-conformant today:** all four CLIs lack any verbosity control. Doctor hardcodes `level: "warn"` (`src/cli/index.ts:120`) with no override.

### 8.4 `--cwd <path>` — MAY

CLIs MAY accept `--cwd` to override the working directory used for project/scope resolution. Not required, but if offered, it MUST be a global flag parsed before the verb. Honeycomb and Nectar currently infer `cwd` from `process.cwd()`/env; offering `--cwd` is a nice-to-have.

---

## 9. Exit codes

Every CLI MUST use this three-tier scheme. It is the single most important convention for scripting and CI.

| Code | Meaning | When |
|:---:|---|---|
| **0** | Success | Command completed its intended action, or a read-only command found a healthy/normal state. |
| **1** | Runtime failure | The command ran but failed: daemon unreachable, network error, permission denied, a mutating action rolled back, or a read-only command found a broken state. |
| **2** | Usage / parse error | The invocation was malformed: unknown verb, bad flag, missing required positional, wrong flag value type. The command never reached its handler. |

Refinements:
- **Declined actions are not failures.** When a user aborts a gated confirmation, the CLI SHOULD exit **0** (the user declined; nothing went wrong). Doctor's `EXIT_DECLINED=2` (`src/cli/dispatch.ts:34`) is reclassified here as **0** — declined ≠ parse error, and surfacing it as `2` would mislead CI into treating it as a usage bug. *(This is a deliberate deviation from Doctor's current `2`; see §12.)*
- Parse errors MUST print a usage hint to **stderr** in addition to exiting `2`.
- Unknown verb MUST exit `2` (not `1`), because the command never ran.

**Canonical for the `0`/`1`/`2` trichotomy:** `nectar` (`src/cli.ts` — parse errors return 2, unknown command returns 1... *except* unknown command is itself a parse error and SHOULD be reclassified to 2).
**Canonical for the "declined = 0" refinement:** none today; this is a contract-level ruling.

---

## 10. Process and exit safety (Windows)

### 10.1 Never `process.exit()` from a one-shot that used `fetch` — MUST

A one-shot command that has used `undici`/`fetch` (keep-alive sockets) MUST NOT call `process.exit()` directly. On Windows this trips a libuv `UV_HANDLE_CLOSING` assertion (exit 127) as the keep-alive teardown races the abrupt exit.

The conformant pattern: close undici's global dispatcher, unref all active handles, set `process.exitCode`, and let the event loop drain naturally — with an unref'd backstop force-exit (e.g. 2000 ms) as a safety net.

**Canonical:** `doctor/src/cli/shutdown.ts:195-242` (the most complete implementation — closes the global dispatcher via `Symbol.for("undici.globalDispatcher.1")`, unrefs handles, backstop timer). Honeycomb has an inline variant at `src/cli/index.ts:70-88` (sets `process.exitCode`, awaits `finalizeCliExit()`); the two SHOULD converge on the Doctor pattern once a shared kit exists.

### 10.2 Long-running commands are exempt

The `run`/`daemon`/`start` watchdogs MAY call `process.exit()` — they own their lifecycle. Doctor correctly excludes `run` from the shutdown path (`shutdown.ts:61-63`).

---

## 11. Output conventions

### 11.1 Color — SHOULD honor `NO_COLOR` / `FORCE_COLOR` / TTY

A CLI that emits color MUST:
- disable color when `NO_COLOR` is set (regardless of value),
- enable color when `FORCE_COLOR` is set,
- disable color when stdout is not a TTY (unless `FORCE_COLOR`),
- disable color when `--json` is set.

Color MUST be implemented without a runtime dependency (the suite's zero-dep constraint is load-bearing for Doctor/Hive/Nectar). Hand-rolled SGR helpers are the conformant path.

**Canonical:** `doctor/src/cli/colors.ts:44-50` — SGR helpers (`bold`, `dim`, `amber`, `cyan`, `green`, `yellow`, `red`), all three env honors, non-TTY degradation. **Honeycomb, Hive, and Nectar currently emit no color at all** and SHOULD adopt the Doctor helpers (or a shared kit derived from them).

### 11.2 Banner / branding — SHOULD

A CLI SHOULD print a compact banner (ASCII-only, no Unicode glyphs that dumb terminals mangle) atop `--help`, no-args, and the `help` verb. The banner MAY be omitted for `--version` and for `--json` output.

**Canonical:** `honeycomb` (plain-ASCII honeycomb art, `src/commands/dispatch.ts:89-95`) and `doctor` (branded color banner, `src/cli/banner.ts`). The two styles are both acceptable; a CLI picks one.

### 11.3 stdout vs stderr — MUST

- **Human-readable intended output** → stdout.
- **Diagnostics, warnings, log lines, usage-on-error** → stderr.
- **`--json` payload** → stdout (and only the payload — no banner, no log lines mixed in).
- **Progress/spinner output** → stderr (so it doesn't pollute piped stdout).

A piped `tool status | jq` MUST yield clean JSON with no log noise. This is a common violation today (Nectar emits JSON-structured log lines to stderr unconditionally at `src/cli.ts:1347`, which is correct for stderr; the rule is that stdout must stay clean).

---

## 12. Verb naming conventions

### 12.1 Service lifecycle — MUST converge on one scheme

The suite MUST standardize service-lifecycle verbs. The current mix (`install` vs `install-service`, `uninstall` meaning different scopes per tool) is the most-cited footgun in the audit.

**Target scheme (noun-grouped subcommands):**

| Concern | Verb |
|---|---|
| Install service unit + register + first-run | `<tool> install` |
| Full surgical removal (stop + service + registry + state dir) | `<tool> uninstall` |
| Service-unit-only install | `<tool> service install` |
| Service-unit-only uninstall | `<tool> service uninstall` |
| Start the daemon | `<tool> start` |
| Stop the daemon | `<tool> stop` |
| Restart the daemon | `<tool> restart` |
| Status of the daemon/service | `<tool> status` (§5.1) |

`install-service` / `uninstall-service` (today's hyphenated top-level form in Doctor and Hive) are deprecated aliases that MUST remain as hidden aliases for one release cycle, then MAY be removed.

### 12.2 Noun-grouped verbs — SHOULD

Multi-word concepts SHOULD be noun-grouped subcommands (`tool service install`), not hyphenated top-level verbs (`tool install-service`). The exception is when a concept genuinely has no sub-actions (e.g. `self-update` is a single action, not a noun group).

### 12.3 Alias discipline — SHOULD

Aliases (e.g. `workspaces` → `workspace list`, `start` → `daemon start`) SHOULD:
- be documented in `--help` as "(alias of X)",
- never diverge in behavior from their target,
- be limited to one or two per verb — three-plus is a smell.

### 12.4 Secrets are write-only — MAY (security posture)

A CLI that manages named secrets MAY refuse to return secret values (`secret get` unsupported; `secret list` returns names only). This is Honeycomb's posture (`src/commands/storage-handlers.ts:124-128`) and is RECOMMENDED for any new secret-handling verb. Document the posture in the verb's help.

---

## 13. What does NOT belong in a CLI

To keep the surface honest, the following MUST NOT ship as reachable-from-`--help` surface:

- **Orphaned command modules.** A fully-implemented, fully-tested handler that is never wired into the dispatcher is non-conformant. Either wire it (add to the verb table + dispatch) or delete it. Honeycomb currently ships three (`keys`, `route`, `ontology` rich-runners) — non-conformant; §14 tracks the fix.
- **Deferred-assembly stubs.** A verb whose non-`--dry-run` path prints "deferred" and does nothing is non-conformant. Either implement it or remove it from `--help`. `honeycomb update` is the current offender.
- **Near-stub verbs that exit 2.** A verb that only recognizes one flag and exits `2` on anything else with a "lands with a later PRD" message is dead surface. Either finish or remove. `nectar project` is the current offender.
- **Internal jargon in `--help`.** PRD IDs, ticket numbers, and internal codenames (`PRD-007`, `OD-4`) MUST NOT appear in user-facing help text. Nectar's USAGE string (`src/cli.ts:114-151`) is non-conformant.

---

## 14. Conformance: current state

This table is the living scorecard. It is updated as each CLI converges. "✅" = conformant, "⚠️" = partial, "❌" = non-conformant.

| Rule | Honeycomb | Doctor | Hive | Nectar |
|---|:---:|:---:|:---:|:---:|
| §4.1 `--help`/`-h` top-level | ✅ | ❌ | ❌ | ✅ |
| §4.2 `--version`/`-V` | ✅ | ⚠️ (`-v`) | ❌ | ❌ |
| §4.3 no-args → usage, exit 0 | ✅ | ✅ | ❌ (starts) | ✅ |
| §4.4 per-command help | ❌ | ❌ | ❌ | ❌ |
| §5.1 `status` | ✅ | ✅ | ❌ | ⚠️ |
| §5.2 `diagnose` | ❌ | ✅ | ❌ | ❌ |
| §6 `update`/`self-update` | ⚠️ | ✅ | ❌ | ❌ |
| §7.1 telemetry opt-out env | ✅ | ✅ | ✅ | ✅ |
| §7.2 `telemetry --show` | ✅ | ❌ | ❌ | ❌ |
| §8.1 global `--json` | ✅ | ❌ | ❌ | ❌ |
| §8.2 global `--dry-run` | ✅ | ❌ | ❌ | ❌ |
| §8.3 `-v`/`-q`/`--debug` | ❌ | ❌ | ❌ | ❌ |
| §9 exit codes (0/1/2) | ⚠️ | ⚠️ (`2`=declined) | ⚠️ | ✅ |
| §10.1 Windows-safe exit | ⚠️ | ✅ | ❌ | ❌ |
| §11.1 color w/ env honors | ❌ | ✅ | ❌ | ❌ |
| §11.3 stdout/stderr discipline | ✅ | ✅ | ⚠️ | ✅ |
| §12.1 service-lifecycle verbs | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| §13 no orphaned/stub surface | ❌ (3 orphaned, 1 deferred) | ✅ | ✅ | ❌ (`project` stub, PRD jargon) |

**Reading the scorecard:** Hive is the lowest-conformance CLI and is the recommended first convergence target. Doctor is the highest but carries two non-conformances (`-v` for version, `2` for declined) that are easy fixes. Honeycomb's orphaned-module problem (§13) is its biggest liability.

---

## 15. How to add a new CLI

When introducing a new `@legioncodeinc/*` CLI, it MUST:

1. Implement every MUST rule above before first public release.
2. Implement every SHOULD rule unless the PRD documents a specific reason not to.
3. Be added to the §14 scorecard with its initial conformance state.
4. Use the shared `cli-kit` (once extracted — see `cli-parity-audit.md` §6.2) for color, shutdown, arg-parsing, and exit codes, rather than re-implementing them.

A new CLI that ships non-conformant on any MUST rule is a release blocker.

---

## 16. Change control

This contract is versioned in place. Material changes (new MUST rules, reclassification of a SHOULD to MUST, changes to exit-code semantics) bump the version banner at the top and are accompanied by a one-line changelog entry here:

- **v1 (2026-07-08):** Initial contract, derived from `cli-parity-audit.md`. Establishes the MUST/SHOULD baseline, the `0/1/2` exit-code scheme (with declined=`0`), the service-lifecycle verb scheme, and the §14 scorecard.

---

*This document is normative for the Apiary CLI suite. Disputes are resolved by the canonical implementations cited inline; where two canonicals disagree, the contract text wins and the offending canonical is migrated.*
