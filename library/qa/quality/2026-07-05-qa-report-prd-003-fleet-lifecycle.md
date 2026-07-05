# QA Report: PRD-003 Fleet Lifecycle, Login Deferral, and One-Command Uninstall (superproject scope + module coherence)

**Plan documents:** `library/requirements/backlog/prd-003-fleet-lifecycle-login-and-uninstall/prd-003d-fleet-lifecycle-login-and-uninstall-global-uninstall-script.md` (Part A) and `.../prd-003-fleet-lifecycle-login-and-uninstall-index.md` module AC-1..9 (Part B, cross-surface coherence)
**Execution ledger:** `library/ledger/EXECUTION_LEDGER-fleet-lifecycle.md`
**Audit date:** 2026-07-05
**Base branch:** `main`
**Head:** `feature/smoker-fleet-lifecycle` (uncommitted superproject working tree)
**Auditor:** quality-worker-bee

**Ordering check:** `security-worker-bee` ran first and remediated in place (report: `library/qa/security/2026-07-04-security-audit-prd-003-uninstall-scripts.md`; 2 Critical + 1 High fixed: dangerous-root guards on `APIARY_HOME` in both scripts, empty-HOME refusal in sh, resolved-home guard in ps1). Ordering is correct; this audit proceeds.

## Summary

**PASS with two Warnings, both remediated in place during this audit.** All seven d-AC rows and the four in-scope module ACs (AC-6/7/8/9) trace to implementation with fresh sandboxed evidence; the security wave's root guards did not regress any legitimate path (custom multi-segment `APIARY_HOME` still honored and removed, normal sandbox-home runs remove exactly the allow-list, dry-run provably deletes nothing); the coverage lists in both scripts match the ledger's frozen inventory verbatim after every fix cycle. The two remediated Warnings: (W-1) the documented download-and-verify flow on the inspect page and README exited 1 because it downloads only the two sh scripts while `SHA256SUMS` now carries four entries (fixed with `--ignore-missing` plus explanatory copy); (W-2) two stale `functions/index.js` references in `README.md` and `_headers` contradicted the shipped `_worker.js` architecture (fixed). Part B module coherence is clean: the doctor purge inventory, both scripts, and the ledger's frozen table agree verbatim; all four products expose `start`/`stop`/`uninstall` with the 003b aliases intact; the fleet-detection S3 win32 divergence is now resolved in honeycomb's working tree (details below). All gates re-ran green after remediation.

## Scorecard

| Category      | Status | Notes |
|---------------|--------|-------|
| Completeness  | ✅ | All d-AC-1..7 and module AC-6/7/8/9 traced; d-AC-5/6 live halves are tag-time by design (documented evidence path) |
| Correctness   | ✅ | Sandboxed smokes prove removal, refusal, dry-run, npm-broken, legacy-only, and no-op behavior; guards verified non-regressive |
| Alignment     | ⚠️ | Two stale doc references (W-2) contradicted the `_worker.js` architecture; fixed in place. Non-goals honored (installers and deploy workflow untouched) |
| Gaps          | ⚠️ | Documented verify flow exited 1 on partial download (W-1); fixed in place with `--ignore-missing` |
| Detrimental   | ✅ | No regressions: combo/env-prefix logic untouched on checksummed routes; `replaceToken` split/join fixes a latent `$`-sequence hazard `replaceAll` had; no leftover debug output |

## Critical Issues (must fix)

None.

## Warnings (should fix) - both REMEDIATED IN PLACE during this audit

- [x] **W-1: Documented verify flow failed with exit 1**, `site/install/index.template.html:141-151` (pre-fix), `site/install/README.md:142-146` (pre-fix)

  The inspect page's "Verify before you run" block and the README's "Verify after deploy" block instruct downloading `install.sh`, `uninstall.sh`, and `SHA256SUMS`, then running `sha256sum -c SHA256SUMS`. With the two `.ps1` entries now in `SHA256SUMS`, that exact command exits 1 with `FAILED open or read` for the two files the copy never downloads (reproduced in a sandbox: `EXIT=1`, `WARNING: 2 listed files could not be read`). A user following the advertised trust-building flow sees a failure. This is an implied-expectation break introduced by this branch (the pre-branch copy downloaded one script and listed two entries, already latent; the branch's own copy edit doubled the mismatch and named an expected output plain `-c` cannot produce cleanly).

  **Remediation applied:** both blocks now use `sha256sum -c --ignore-missing SHA256SUMS` with copy explaining that `--ignore-missing` skips the entries for scripts not downloaded (the PowerShell twins), and the macOS `shasum -a 256 -c` variant got the same flag. Re-verified: partial-download verify now exits 0 with `install.sh: OK, uninstall.sh: OK`; the full four-file `sha256sum -c` in `dist/` still passes all four. Site rebuilt; checksums unchanged (`uninstall.sh 0b967c…`, `uninstall.ps1 3fed6d…`, matching the security report's published values).

- [x] **W-2: Stale `functions/index.js` references contradicted the shipped worker architecture**, `site/install/README.md:182` (pre-fix), `site/install/_headers:63` (pre-fix)

  The audit scope requires the inspect page, `_headers`, `_worker.js`, and README to be mutually consistent about the uninstall routes. The branch migrated negotiation from a Pages Function (`functions/index.js`, which no longer exists; confirmed absent from both the working tree and `git ls-tree HEAD site/install/`) to `_worker.js`, and updated most references, but the README's combo-sugar section still linked `[functions/index.js](./functions/index.js)` (a dead link) and the `_headers` comment still said the bare "/" is served by `functions/index.js`.

  **Remediation applied:** both references now name `_worker.js`; the `_headers` comment's "(Pages Functions don't inherit _headers)" rationale updated to "(worker responses don't inherit _headers)". All other cross-references checked and consistent: template links `/uninstall`, `/uninstall.sh`, `/uninstall.ps1` and inlines both uninstall sources and checksums; `_headers` pins `text/plain` + `nosniff` on all three routes; `_worker.js` negotiates `/uninstall` and passes the explicit filenames to assets + `_headers`; the README route table lists all five script routes.

## Suggestions (consider improving) - report only, not applied

- [ ] **S-1: Dry-run summary skips the aggregated manual-followup preview**, `scripts/install/uninstall.sh:530-534`

  `print_summary` returns before `print_manual_followups` when `DRY_RUN=1`, so a dry run that detected system-scope units warns per-unit but never prints the aggregated "Run these commands" block a real run would end with. Same shape in `uninstall.ps1:488-492`. Cosmetic: the per-unit warnings still surface everything.

- [ ] **S-2: Generated shared inventory manifest**, `scripts/install/uninstall.sh:23-58`, `doctor/src/purge/inventory.ts:51-125`

  Echoing the security report's architectural follow-up and PRD-003d's open question: the frozen inventory is hand-mirrored in three places (ledger, both scripts, doctor). Verified verbatim-identical today, but a single generated manifest would close the future-drift surface. The ledger's orchestrator decision 8 ("mirrored, never imported") governs this run; noting for a follow-up PRD.

## Plan Item Traceability

### Part A: PRD-003d (superproject scripts + site)

| # | Plan Requirement | Status | Implementation Location | Evidence / Notes |
|---|---|---|---|---|
| d-AC-1 | `curl \| sh` removes every unit, package, and state dir in the coverage table and reports removals | ✅ | `scripts/install/uninstall.sh:385-511` | Sandboxed smoke (temp home, stubbed npm/launchctl/systemctl/schtasks/sc): all 4 state roots removed, decoy `.keepme` survived, per-item `[ok]` lines + summary counts printed, exit 0 |
| d-AC-2 | PowerShell variant achieves the same on Windows incl. scheduled tasks | ✅ | `scripts/install/uninstall.ps1:387-470` | Sandboxed smoke (`APIARY_UNINSTALL_HOME` temp home, empty PATH): 4 state roots removed, decoy survived, task/service removal guarded by `Test-Have` so nothing real touched; exit 0 |
| d-AC-3 | Legacy-only machine: removes all legacy artifacts | ✅ | `scripts/install/uninstall.sh:35-58,264-437` | Sandboxed smoke with planted `com.hivenectar.daemon.plist`, `hivedoctor.service`, `thehive.service`, `~/.hivemind`: all removed; every legacy task/service name (incl. `HoneycombDaemon`) attempted via stubs |
| d-AC-4 | Node/npm broken: units + state dirs still removed; unremovable packages reported with the one finishing command | ✅ | `uninstall.sh:447-459,513-518`; `uninstall.ps1:416-423,472-477` | Both scripts smoked with broken/absent npm: state dirs removed, exact `npm uninstall -g <all five>` line printed |
| d-AC-5 | Three routes serve `text/plain` + `nosniff`; `SHA256SUMS` carries both scripts; `sha256sum -c` verifies | ✅ | `site/install/_headers:20-33`, `site/install/_worker.js:63-74`, `site/install/build.mjs:35,128-129` | `_headers` pins all three routes; worker streams `/uninstall` as text/plain; local `sha256sum -c` all four OK. Live-serving half is tag-time by design (evidence path: `curl -I` the three routes + `sha256sum -c` against served bytes after the `v*` tag) |
| d-AC-6 | Built by `build.mjs` from `scripts/install/`, deployed by existing `deploy-install-site.yaml` on `v*` tag, inspect page shows checksums | ✅ | `build.mjs:35,116-129,170-187`; `index.template.html:131-137,153-164,202-209` | Build green; rendered page carries both uninstall checksums, both one-liners, both inlined sources, zero unexpanded `{{tokens}}`; workflow untouched (`git diff` empty for `.github/`) |
| d-AC-7 | Interactive confirmation names the destruction incl. `~/.deeplake`; `--yes`/`-Yes` only bypass; allow-list-only deletion | ✅ | `uninstall.sh:171-210,183-192`; `uninstall.ps1:176-201,188-193` | Confirmation copy names `~/.deeplake` with the shared-credentials warning ("also used by standalone @deeplake/hivemind") in both scripts; piped-without-`--yes` hard-refuses exit 1 deleting nothing; typed token is exactly `uninstall`; deletion targets are the frozen lists + validated-home anchors only |
| NG: no product selection | ✅ | whole scripts | All-or-nothing; no `--products` style flags |
| NG: no site architecture change beyond routes | ✅ | `_worker.js` diff | Combo/alias logic untouched; `/uninstall*` never dynamically prefixed, stays inside the `SHA256SUMS` guarantee |
| NG: installers not modified | ✅ | `git diff` | `install.sh` / `install.ps1` byte-identical to HEAD |

### Part A: security-guard non-regression (the specific re-checks requested)

| Check | Status | Evidence |
|---|---|---|
| Custom absolute multi-segment `APIARY_HOME` honored | ✅ | sh: `/tmp/…/srv/apiary/custom-fleet` removed in a real sandboxed run; ps1: `C:\…\srv\apiary\custom` reached the dry-run would-remove line |
| Dangerous roots refused | ✅ | sh: `/`, `/etc`, and `$HOME` itself all warn `points at a protected root` and skip; ps1: `C:\` refused |
| Empty HOME refused | ✅ | sh exits 1 with the actionable `HOME is unset or empty` message before any deletion |
| Normal home run intact | ✅ | Sandboxed full runs (both scripts) removed exactly the four allow-list roots and nothing else |
| Dry-run still safe | ✅ | `--yes --dry-run` (sh) and `-Yes -DryRun` (ps1) preserved all planted markers; only `[dry-run]` lines printed |
| ps1 flag parenthesization (W2-Sfix) holds | ✅ | `-Yes`, `-DryRun`, `-h` all live (`Get-ArgumentStatus`, `uninstall.ps1:134-162`) |
| ps1 `-File` exit codes (W2-Sfix) hold | ✅ | help exit 0, refusal exit 1, unknown flag exit 1, all proven from an outer shell |
| Coverage lists match the ledger frozen inventory after all fix cycles | ✅ | `uninstall.sh:24-58` and `uninstall.ps1:25-62` versus ledger table: npm (5), launchd (4+4), systemd (4+4), Windows tasks (4+4 incl. `HoneycombDaemon`), state dirs (4 + `APIARY_HOME`), verbatim |

### Part B: module coherence (module AC-1..9 + settled open questions) - REPORT ONLY

| # | Check | Status | Notes |
|---|---|---|---|
| B-1 | Doctor purge inventory vs scripts vs ledger, verbatim agreement | ✅ | `doctor/src/purge/inventory.ts:51-125` (OTHER_PRODUCTS literals + `DOCTOR_UNIT_NAMES` imported from `doctor/src/service/platform.ts:44-59`) resolves to exactly the ledger table; both scripts carry the same names (see above). State dirs agree: `.deeplake`/`.hivemind`/`.honeycomb` (`inventory.ts:118-125`) + the live fleet root (`APIARY_HOME`-aware in both doctor and the scripts). No drift found; submodules untouched by this audit |
| B-2 | Verb parity per 003b: `start`/`stop`/`uninstall` + aliases on all four products | ✅ | honeycomb: bare `start`/`stop` alias `daemon start\|stop` (`honeycomb/src/commands/dispatch.ts:247-253`, `contracts.ts:207-219`), full `uninstall` (`runtime.ts:555,669`); nectar: `login`/`start`/`stop`/`uninstall` + `status`/`service-status` alias + `daemon` kept (`nectar/src/cli.ts:1492-1518`); doctor: `start`/`stop`/`uninstall`/`purge` + `install-service`/`uninstall-service` kept (`doctor/src/cli/command-table.ts:18-73`, `dispatch.ts:420-426`); hive: `start`/`stop`/`uninstall` + `install-service`/`uninstall-service` (`hive/src/cli.ts:22-40`) |
| B-3 | Fleet-detection contract parity (three signals, any=>fleet, signals logged) | ✅ (see note) | `honeycomb/src/shared/fleet-detection.ts` and `nectar/src/fleet-detection.ts` mirror the same contract: S1 fleet+legacy registry read, S2 750ms 3853 probe, S3 npm-global probe, ANY=>FLEET (`classifyFleet`, both files), fired signals logged via identical `fleetSignalLine`. **S3 win32 divergence: RESOLVED at code level.** During this audit window honeycomb's working tree adopted the same `shell: win32` fix nectar's security wave landed (`honeycomb/src/shared/fleet-detection.ts:172-206` now sets `shell: win32` on the constant-argv `npm.cmd` probe, with an `ExecFileLike` test seam and a comment naming behavior parity with nectar's mirror; `tests/shared/fleet-detection.test.ts` added). This closes the cross-repo item the nectar quality report (`nectar/library/qa/quality/2026-07-05-qa-report-prd-003-fleet-lifecycle.md:52`) had ruled honeycomb should adopt. Residual: the honeycomb-side quality report and `npm run ci` confirmation had not yet landed at this audit's snapshot time; final closure rides honeycomb's own gate |
| B-4 | Settled open questions reflected in what shipped | ✅ | Verb spelling (bare + aliases, decision 4): confirmed in B-2. Route spelling (all three routes, decision 12): confirmed in d-AC-5. Non-TTY hard refuse (decision 11): both scripts refuse with instructions, `/dev/tty` read when available. Script self-containment, no `doctor purge` delegation (decision 10): both script headers state it, no doctor invocation anywhere. sudo/system-scope report-only (decision 13): both scripts detect and print the exact sudo/`sc` commands, never escalate (`uninstall.sh:290-293,323-326`; `uninstall.ps1:298-301,330-333`). Legacy Windows task inventory (index open question): answered `HoneycombDaemon` from `honeycomb/src/cli/daemon-service.ts:66`, present in both scripts. Windows self-removal fallback (decision 9): the script is self-contained, satisfying the documented-fallback role. ADR-0004 (decision 14): deferred out of this run per the ledger; no AC depends on it |
| AC-6 | Script covers all historical names without pre-installed tooling | ✅ | Coverage lists verbatim-frozen (above); zero Node/doctor dependency in either script (pure sh / PowerShell) |
| AC-7 | Served like the installer: pinning, checksums, tag deploy | ✅ | = d-AC-5/6 |
| AC-8 | Allow-list-only deletion; clean machine exits 0 as a no-op | ✅ | Clean-machine sh run prints `No Apiary assets found. Nothing to remove.` exit 0; ps1 with broken npm prints the run-complete + finishing-command variant exit 0 (correct per d-AC-4); dangerous-root and empty-home guards fail closed |
| AC-9 | Every flow terminates with a clear message or actionable error | ✅ | Refusals exit 1 with instructions; help exits 0; no interactive read without a TTY; `-File` and piped exit codes proven |

Module AC-1..5 (login deferral, per-product verbs' runtime behavior, doctor purge execution) were verified per-repo by W2 and the per-repo security/quality passes recorded in the ledger; this audit checked only their cross-surface coherence per its scope.

## Files Changed (superproject scope of this branch)

- `library/ledger/EXECUTION_LEDGER-fleet-lifecycle.md` (A), run ledger: decisions, frozen inventory, AC ledger, run log
- `library/qa/security/2026-07-04-security-audit-prd-003-uninstall-scripts.md` (A), security wave report (pre-existing input to this audit)
- `scripts/install/uninstall.ps1` (A), Windows one-command uninstall: frozen inventory, confirmation gate, dangerous-root + resolved-home guards, dry-run, npm-broken reporting, `-File` exit-code propagation
- `scripts/install/uninstall.sh` (A), POSIX one-command uninstall: frozen inventory, `/dev/tty` confirmation, `validate_home` + `is_dangerous_root` guards, dry-run, npm-broken reporting, system-scope report-only
- `site/install/README.md` (M), uninstall routes + worker migration documented; **QA remediation:** `--ignore-missing` verify flow, stale `functions/index.js` link fixed
- `site/install/_headers` (M), `text/plain` + `nosniff` stanzas for `/uninstall`, `/uninstall.sh`, `/uninstall.ps1`; **QA remediation:** stale worker comment fixed
- `site/install/_worker.js` (M), `/uninstall` shell-vs-browser negotiation added; combo logic untouched
- `site/install/build.mjs` (M), SCRIPTS array extended to four; per-script checksum/source template tokens; `replaceToken` split/join hardening
- `site/install/index.template.html` (M), uninstall section, checksums, sources, route links; **QA remediation:** `--ignore-missing` verify flow copy
- `doctor`, `hive`, `honeycomb`, `nectar` (M), submodule pointers on their `feature/fleet-lifecycle` branches (READ-ONLY for this audit; Part B findings report-only)

## Gate output (re-run after remediation)

- `bash -n scripts/install/uninstall.sh` -> `BASH_SYNTAX_OK`
- PowerShell AST parse (`[System.Management.Automation.Language.Parser]::ParseFile`) on `uninstall.ps1` -> `PS_PARSE_OK`
- `node site/install/build.mjs` -> build complete; `cd site/install/dist && sha256sum -c SHA256SUMS` -> all four `OK` (`install.sh 28dab4…`, `install.ps1 62abae…`, `uninstall.sh 0b967c…`, `uninstall.ps1 3fed6d…`; uninstall hashes match the security report's published values, i.e. the QA edits touched only docs/template copy, never script bytes)
- Partial-download verify (the documented flow, post-fix): `sha256sum -c --ignore-missing SHA256SUMS` -> exit 0, `install.sh: OK`, `uninstall.sh: OK`
- Sandboxed smokes (throwaway `mktemp -d` homes, stubbed or empty-PATH service/npm tools; never the real home, never real npm/services):
  - sh full-fleet state-dir run: 4 roots removed, decoy survived, exit 0
  - sh legacy-only run: planted legacy plist/units/dirs all removed
  - sh npm-broken run: state dirs removed, finishing command printed
  - sh clean machine: `No Apiary assets found.` exit 0
  - sh guards: empty HOME exit 1; `APIARY_HOME=/`, `/etc`, `$HOME` refused; `/srv/…` honored; dry-run non-destructive; piped refusal exit 1
  - ps1 full run: 4 roots removed, decoy survived, npm-broken finishing command printed, exit 0
  - ps1 guards: `APIARY_HOME=C:\` refused; multi-segment honored (dry-run); `-DryRun -Yes` non-destructive; refusal/help/unknown-flag exit codes 1/0/1 under `-File`
