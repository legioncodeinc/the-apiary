# Security Audit Report: PRD-003d global uninstall scripts + install site (branch `feature/smoker-fleet-lifecycle`)

**Audit date:** 2026-07-04
**Auditor:** security-worker-bee subagent
**Scope:** `scripts/install/uninstall.sh`, `scripts/install/uninstall.ps1` (both new/untracked), and the tracked site changes `site/install/_worker.js`, `site/install/_headers`, `site/install/build.mjs`, `site/install/index.template.html`, `site/install/README.md`. Superproject only; submodules (honeycomb, nectar, doctor, hive) NOT audited per instructions.
**Node version audited:** n/a for these files (`build.mjs` is pure Node ESM, no deps; runs on the repo's Node >= 22 toolchain).
**`npm audit` result:** not run - no dependency manifest is in scope (`build.mjs` imports only `node:` built-ins; the uninstall scripts are shell/PowerShell).
**OpenClaw bundle scan:** n/a - no OpenClaw bundle touched on this branch.
**CVE watchlist last refreshed:** n/a for this surface - findings here are logic/deletion-safety defects, not dependency CVEs.

---

## Scope note (surface outside the Stinger's catalog)

This branch's in-scope changes are entirely outside the Hivemind TypeScript/Deeplake stack the `security-stinger` catalogs are tuned for: two internet-piped uninstall scripts (POSIX `sh` and Windows PowerShell) and a Cloudflare Pages install site (`_worker.js`, `_headers`, a Node build step, an HTML template). I audited them against the universal patterns that DO transfer - deletion-safety / arbitrary-tree destruction, attacker-influenceable environment variables, command construction and injection, confirmation-gate spoofing, reflected input, and content-type / supply-chain integrity - and applied the never-downgrade rule to credential destruction. The Hivemind-specific catalog items (Deeplake SQL `sqlIdent`, the pre-tool-use gate, `me|team` scope, captured-trace PII tables) do not apply and are marked n/a rather than silently passed.

## Executive Summary

Two Critical deletion-safety defects and one High defect were found and **fixed in this session**. The dominant finding: the `APIARY_HOME` environment variable was passed straight to `rm -rf` (sh) / `Remove-Item -Recurse -Force` (PowerShell) after only an "is it absolute" check, so `APIARY_HOME=/` produced `rm -rf /` and any absolute value (`/etc`, `/home/victim`, `C:\Users`) wiped that entire tree - a total break of the allow-list-only invariant (parent AC-8, d-AC-7) in a script designed to be `curl | sh`'d from the internet. The related High: the sh script anchored every deletion on `$HOME` with no non-empty/non-root guard, so an empty `HOME` (which `set -u` does NOT catch) redirected deletions to filesystem-root paths (`/.deeplake`, `/Library/LaunchAgents/*.plist`). All Critical/High findings are remediated and re-verified with `bash -n`, the PowerShell AST parse gate, `node site/install/build.mjs`, `sha256sum -c`, and sandboxed dry-run behavior tests. The site surface (worker negotiation, headers, honest checksums, no dynamic prefixing on checksummed routes) is clean.

Ordering: no `*-qa-report.md` exists under `library/qa/` for this branch (the folder did not exist before this audit), so the `security-before-quality` ordering is intact. `quality-worker-bee` may run next.

---

## Scorecard

| Category | Status | Findings |
|---|---|---|
| Deletion Safety / Arbitrary-Tree Destruction | FAIL (fixed) | 3 (2 Critical, 1 High) |
| Attacker-Influenceable Env Vars (HOME / APIARY_HOME / APIARY_UNINSTALL_HOME) | FAIL (fixed) | covered by the 3 above |
| Symlink Handling (link-only, no traversal) | OK | 0 |
| Confirmation Gate (/dev/tty, non-TTY refusal, exact token) | OK | 0 |
| Command Execution (no eval, hardcoded-inventory sudo lines) | OK | 0 |
| Site Worker Negotiation (no reflected input, correct headers) | OK | 0 |
| Site Headers / Checksum Honesty / Supply-Chain Parity | OK | 0 |
| Credential / Token Exposure (Hivemind) | n/a | - |
| Captured-Trace PII / Deeplake SQL / Pre-tool-use gate | n/a | - |

Legend: **OK** = zero findings; **ATTN** = Medium/Low documented; **FAIL** = Critical/High (fixed in this session); **n/a** = surface not present on this branch.

---

## Critical Findings (fixed in this session)

- [x] **Arbitrary-tree destruction via `APIARY_HOME`** `scripts/install/uninstall.sh:433-445` (pre-fix) - `remove_state_dirs` accepted `APIARY_HOME` as a deletion target after only a `case "$x" in /*)` absolute check, then passed it verbatim to `remove_path_allowlisted`, which `rm -rf -- "$path"`s the whole tree. `APIARY_HOME=/` reached the directory branch and would run `rm -rf -- "/"`; `APIARY_HOME=/etc` (or any absolute path) wiped that entire tree, escaping the enumerated allow-list entirely. Proven in a sandbox: `case`/branch selection confirmed `/` and `/etc` reach the `rm -rf` branch. **Fix:** added `is_dangerous_root()` (rejects the filesystem root, any single-segment top-level dir, and `HOME` itself via trailing-slash-normalized segment counting) and gated the `APIARY_HOME` branch on it, warning and skipping instead of deleting. Absolute paths with two or more segments (e.g. `/srv/apiary`) are still honored.

- [x] **Arbitrary-tree destruction via `APIARY_HOME` (PowerShell twin)** `scripts/install/uninstall.ps1:437-445` (pre-fix) - `Remove-StateDirectories` passed `$env:APIARY_HOME` to `Remove-AllowlistedPath` (which does `Remove-Item -Recurse -Force`) after only `Test-IsAbsolutePath`, which returns true for `C:\` and `/`. Same wholesale-tree destruction as the sh defect. **Fix:** added `Test-IsDangerousRoot()` (rejects drive roots `C:`, bare `/`/`\`, single-segment paths, and the resolved home) and gated the `APIARY_HOME` branch on it.

---

## High Findings (fixed in this session)

- [x] **Empty/root `HOME` anchors deletions at filesystem root (sh)** `scripts/install/uninstall.sh` (`remove_state_dirs`, `remove_launchd_label`, `remove_systemd_unit`, all `${HOME}/...` anchors) - `set -u` aborts on an *unset* `HOME` but not on an *empty* one (proven: `HOME="" ; "${HOME}/.apiary"` expands to `/.apiary`; `HOME="/"` expands to `//.apiary`). With an empty `HOME`, deletions retarget `/.apiary`, `/.deeplake`, `/.hivemind`, `/.honeycomb`, and the system path `/Library/LaunchAgents/<label>.plist` - wrong-target deletion including a system-scope launchd path, in a script that destroys shared Deeplake credentials. **Fix:** added `validate_home()` (refuses empty, non-absolute, or filesystem-root `HOME`) and called it first in `main()` before `confirm_destruction`. PowerShell parity: `Invoke-Main` now refuses a resolved home that is empty, non-absolute, or a bare drive/filesystem root.

---

## Medium Findings (follow-up required)

None detected.

---

## Low Findings (documentation only)

- [ ] **`APIARY_UNINSTALL_HOME` / `HOME` precedence in `Get-HomeDirectory`** `scripts/install/uninstall.ps1:185-196` - precedence is `APIARY_UNINSTALL_HOME` > `HOME` > `USERPROFILE` > `$HOME` (the ledger's W3 note). Under real `irm | iex` on Windows, `HOME` is normally unset, so `USERPROFILE` wins as intended; a git-bash-spawned PowerShell has `HOME` set and resolves the git-bash home. This is a deliberate override seam, not an escalation: deletions under any chosen home are bounded to allow-listed *leaf* subpaths (`.apiary`, `.deeplake`, `.hivemind`, `.honeycomb`), so a hostile absolute home can only cause no-op probes of non-existent leaves, and the new `Invoke-Main` guard now rejects a bare-root resolved home. No code change required beyond the guard added above. Informational.
- [ ] **`install.ps1` shares the latent `-File` exit-code pattern** (`scripts/install/install.ps1`) - carried from the ledger's W3 note; explicitly out of scope for this audit (installer, not uninstaller). Note only; recommend a follow-up pass on the installer.

---

## Dependency Audit

Not applicable. No dependency manifest is in scope: `site/install/build.mjs` imports only `node:crypto`, `node:fs/promises`, `node:path`, `node:url`; the uninstall scripts are shell/PowerShell with no package tree.

---

## Surface Integrity Check (adapted to this branch's surface)

| Check | Expected | Observed | Status |
|---|---|---|---|
| **Deletion allow-list (sh)** | every `rm` target an allow-listed path anchored on a validated home | `APIARY_HOME` now dangerous-root-gated; `HOME` validated non-empty/absolute/non-root | OK (post-fix) |
| **Deletion allow-list (ps1)** | every `Remove-Item` target allow-listed, anchored on a validated home | `APIARY_HOME` dangerous-root-gated; resolved home guarded in `Invoke-Main` | OK (post-fix) |
| **Symlink handling** | link-only removal, no target traversal | sh checks `[ -L ]` first, `rm -f` link only; ps1 checks `ReparsePoint`, `Remove-Item -Force` without `-Recurse` | OK |
| **Confirmation gate** | reads `/dev/tty`, refuses non-TTY, exact typed token | sh reads `/dev/tty`, refuses when absent, `[ "$reply" != "uninstall" ]`; ps1 uses `[Console]::IsInputRedirected` + `Read-Host`, `-ne 'uninstall'` | OK |
| **Command execution** | no `eval`; sudo lines from hardcoded inventory only | no `eval`/`iex`; manual sudo/`sc` lines built from frozen hardcoded label constants and printed, never executed | OK |
| **Worker negotiation** (`_worker.js`) | no reflected user input in response; combo prefix never on checksummed routes | `/uninstall` streams `uninstall.sh` verbatim with no reflected input; combo prefixing is confined to `/` (install.sh) and reads a hardcoded preset table, with `escapeForComment`/`escapeForShellDoubleQuotes` defense | OK |
| **Content-type pinning** (`_headers`) | `text/plain` + `nosniff` on `/uninstall`, `/uninstall.sh`, `/uninstall.ps1` | all three present with `Content-Type: text/plain; charset=utf-8` + `X-Content-Type-Options: nosniff` | OK |
| **Honest checksums** (`build.mjs`) | SHA-256 computed from the exact served bytes | key injection (install scripts only) happens before hashing; uninstall scripts hashed as-served; `sha256sum -c` verified all four entries OK | OK |
| **No dynamic prefixing on checksummed routes** | uninstall routes byte-identical to `SHA256SUMS` | combo/env-prefix logic touches only `/`; `/uninstall*` are served unmodified | OK |

---

## Files Changed (remediation)

| File | Change Summary |
|---|---|
| `scripts/install/uninstall.sh` | Added `strip_trailing_slashes`, `is_dangerous_root`, `validate_home` helpers; gated the `APIARY_HOME` deletion branch on `is_dangerous_root`; called `validate_home` first in `main()`. |
| `scripts/install/uninstall.ps1` | Added `Test-IsDangerousRoot`; gated the `APIARY_HOME` deletion branch on it; added a resolved-home safety guard in `Invoke-Main`. |
| `site/install/dist/*` | Regenerated by `node site/install/build.mjs` so published checksums reflect the hardened `uninstall.sh` bytes. `dist/` is gitignored (build output, not committed). |

Diff reviewed and confirmed security-scoped on 2026-07-04. Uninstall scripts are untracked (new files created by the W1-S worker); remediation was applied in place with minimal blast radius. No unrelated edits. Not committed, per instructions.

New published checksums after rebuild:
- `uninstall.sh` `0b967c45080f2cd01b5dcd7071e1c11a5c4b6e44f20179d95e57da96aef3afb7`
- `uninstall.ps1` `3fed6d564dee1382a604e7a0897840b1d9f2a0aa06928b17bf2d40da350b2ed1`

---

## Gate output (re-verified after remediation)

- `bash -n scripts/install/uninstall.sh` -> `BASH_SYNTAX_OK`
- PowerShell AST parse (`[System.Management.Automation.Language.Parser]::ParseFile`) on `uninstall.ps1` -> `PS_PARSE_OK`
- `node site/install/build.mjs` -> build complete; `cd site/install/dist && sha256sum -c SHA256SUMS` -> `install.sh: OK`, `install.ps1: OK`, `uninstall.sh: OK`, `uninstall.ps1: OK`
- Sandboxed dry-run behavior (throwaway `mktemp -d` home, `--dry-run`, never the real home or real services/npm):
  - sh empty `HOME` -> "HOME is unset or empty ... Refusing to run."
  - sh `APIARY_HOME=/` and `=/etc` -> "Ignoring APIARY_HOME because it points at a protected root"
  - sh `APIARY_HOME=<sandbox home>` (home-self) -> "points at a protected root"
  - sh `APIARY_HOME=/srv/apiary` (two segments) -> honored (dry-run no-op on the non-existent path)
  - ps1 `APIARY_HOME=C:\` -> "points at a protected root"; `APIARY_HOME=C:\srv\apiary` -> honored (dry-run no-op)
  - both scripts complete cleanly under a normal sandbox home in dry-run

---

## Recommended Follow-Up (architectural)

- Consider generating the deletion allow-list (state roots + unit/package names) from a single committed manifest consumed by both `doctor purge` (003c) and these scripts, per the PRD-003d open question, so the two can never drift. Not a vulnerability; it would shrink the "someone edits one inventory and not the other" risk surface.
- Recommend a dedicated follow-up audit of `install.sh` / `install.ps1`: the PowerShell `-File` exit-code pattern noted in the ledger is latent there, and the installers were out of scope for this pass.
