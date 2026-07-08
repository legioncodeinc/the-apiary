# Security Audit Report: PRD-006 Claude Code Plugin Delivery and Auto-Wiring

**Audit date:** 2026-07-08
**Auditor:** security-worker-bee subagent
**Scope:** `git diff main...HEAD` on `feature/prd-006-plugin-delivery` (honeycomb submodule, worktree `C:/Users/mario/GitHub/honeycomb-prd006`). Files reviewed: `package.json`, `scripts/pack-check.mjs`, `src/cli/harness-reconcile.ts`, `src/cli/harness-status.ts`, `src/cli/runtime.ts`, `src/commands/{contracts,dispatch,index,local-handlers,harness-status}.ts`, `src/daemon/runtime/dashboard/harness-api.ts`, and the four new test files. Cross-checked against the pre-existing `src/connectors/plugin-runner.ts` (the actual external-CLI exec site) and the shipped plugin assets (`harnesses/claude-code/{.mcp.json,skills,commands,hooks/hooks.json}`).
**Node version audited:** >= 22.5.0 (ESM, TypeScript strict)
**`npm audit` result:** clean - 0 vulnerabilities (production tree, `--omit=dev`)
**OpenClaw bundle scan:** not applicable to this diff (no OpenClaw bundle change; the diff touches the Claude Code harness only). `npm run audit:sql` green (no daemon storage changes).
**CVE watchlist last refreshed:** not consulted for a dependency change (no dependency added/upgraded in this diff; `npm audit` clean).

---

## Executive Summary

The PRD-006 branch (006a packaging, 006b self-healing reconcile, 006c/d connect/status/repair surface) is a **clean, defensively-written diff with no Critical, High, or Medium findings**. The two attack surfaces that mattered - external-CLI exec (`claude plugin ...`) and status/`--json` responses - are both closed by construction: the production runner uses `spawnSync` with **no `shell: true`** and only fixed argv (`--version`, `plugin list`, and the connector's static registration args), and the user-supplied `harness` arg to `repair`/`connect` never reaches a spawn (it is only a `Map` lookup key). The status/diagnostics responses carry only harness ids, booleans, stable outcome strings, and ISO timestamps - no token, org id, credential, or filesystem path. Widening the published `files` allowlist ships only markdown/JSON plugin assets (verified secret-free), and the `pack-check.mjs` FORBIDDEN secret gate is preserved (strengthened, not weakened). **No code changes were required.** Two Low/informational notes are recorded below; neither warrants a fix and none reopens an AC.

Ordering check: no `*-qa-report.md` exists for this branch, so this audit correctly precedes `quality-worker-bee`.

---

## Scorecard

| Category | Status | Findings |
|---|---|---|
| Credential / Token Exposure | OK | 0 |
| Captured-Trace PII (sessions/memory) | OK | 0 |
| Authentication & Org RBAC / Scope | OK | 0 |
| Injection (command / Deep Lake SQL API) | OK | 0 |
| Dependency & Bundle | OK | 0 |
| Configuration (cred modes, capture opt-out, client hardening) | OK | 0 |
| Pre-Tool-Use Gate & Prompt Injection | OK | 0 |

Legend: **OK** = zero findings · **ATTN** = Medium/Low findings documented · **FAIL** = Critical/High findings (fixed in this session).

---

## Critical Findings (fixed in this session)

None detected.

---

## High Findings (fixed in this session)

None detected.

---

## Medium Findings (follow-up required)

None detected.

---

## Low Findings (documentation only)

- [ ] **Verbose error detail (local-only)** `src/cli/harness-reconcile.ts:232-234`, surfaced via `src/commands/harness-status.ts:139` (`connectStatusLine`) and `src/cli/harness-status.ts:126`. The `error` outcome carries `err.message` into the `detail` field, which the `status`/`connect`/`repair` verbs render to the local user's own stdout. This is **not** a Medium finding: it is scoped to the local user on their own machine (not a daemon HTTP response, not cross-tenant), no credential can appear (the connector shells `claude` with fixed args and an empty `env`, and the plugin runner returns result objects rather than throwing with sensitive content), and the interface contract explicitly forbids tokens/config values in `detail`. Recorded only so future changes to the connector's throw paths keep `detail` free of resolved home-dir paths.
- [ ] **Local self-DoS via repeated repair** `src/commands/harness-status.ts:194` / `src/cli/harness-status.ts:137-145`. Each `harness connect|repair` invocation runs one `reconcileOnce()` (a `claude plugin list` probe, and `claude plugin install` only when not yet enabled). A user scripting the verb in a tight loop could spawn many short-lived `claude` processes. This is user-initiated, local, and bounded per-call (120s `spawnSync` timeout + 130s `withTimeout` wire cap); there is no remote vector. No action required.

---

## Dependency Audit

```text
npm audit --omit=dev
found 0 vulnerabilities
```

No dependency was added or upgraded in this diff.

---

## Surface Integrity Check

| Check | Expected | Observed | Status |
|---|---|---|---|
| **External CLI exec** (`src/connectors/plugin-runner.ts:88`) | `spawnSync` with no `shell: true`; fixed argv only | `spawnSync(binary, args, { windowsHide: true, timeout: 120_000 })`, no shell; args are `["--version"]` / `["plugin","list"]` / static connector registration args | OK |
| **User arg to external CLI** (`repair <harness>`) | never interpolated into a command | `harness` positional is only a `Map` lookup key + echoed in result JSON; never reaches `spawnSync` | OK |
| **Reconcile targets** (`src/cli/harness-reconcile.ts:107`) | fixed harness/plugin ids | `DEFAULT_RECONCILE_HARNESSES=["claude-code"]`, `pluginName=CLAUDE_PLUGIN_NAME` (`honeycomb`) - both constants | OK |
| **Status / `--json` response** (`src/commands/harness-status.ts:53-100`) | only ids/booleans/outcome strings/timestamps | `ConnectSeamResult`/`HarnessConnectionState`/`RepairResult` carry harness id + booleans + `ConnectStatus` + optional non-secret `detail` + ISO timestamp; no token/path/credential field exists | OK |
| **Daemon `pluginEnabled` field** (`src/daemon/runtime/dashboard/harness-api.ts:71,310,339-343`) | plain boolean, no leak via injected seam | `resolvePluginEnabled` returns `ReadonlySet<string>` of harness ids; only `set.has(name)` boolean reaches the response; defaults to empty set (fail-soft `false`); Tier-2 daemon never imports `isPluginEnabled` | OK |
| **Cadence / spawn bounding** (`src/cli/harness-reconcile.ts:257-289`) | idempotent, unref'd, timeout-capped, out of loopback path | `setInterval` guarded by `if (timer !== undefined) return`, `handle.unref()`, per-wire `withTimeout`, fired from `onDaemonUp` (outside daemon request path) | OK |
| **Widened `files` allowlist** (`package.json:34-36`) | ships no secret/credential/unintended file | added `harnesses/claude-code/{.mcp.json,skills,commands}`; `.mcp.json` has empty `env`, skills/commands are markdown - verified secret-free; `pack-check.mjs` FORBIDDEN gate unchanged | OK |
| **pack-check secret gate** (`scripts/pack-check.mjs:22-58`) | FORBIDDEN scan preserved, not weakened | FORBIDDEN array + `hits` gate run unchanged and BEFORE the new declared-component presence checks; new logic only ADDS required-file assertions | OK |
| **Daemon bind** | loopback only (unchanged) | no bind change in diff; endpoint returns JSON over the existing loopback surface | OK |

---

## Files Changed (remediation)

None. No security remediation was required; the diff had no Medium+ findings. No files were modified by this audit.

---

## Recommended Follow-Up (architectural)

None required. The tier-legal separation (daemon Tier 2 never importing `isPluginEnabled`, the connect/status/repair surface built at Tier 4 and injected) is a sound boundary that also keeps the external-CLI exec and any credential access out of the loopback request path. Future work on the `src/connectors` connector `install()` throw paths should keep the `HarnessReconcileResult.detail` string free of resolved filesystem paths (see Low finding 1).

---

## Verification

- `npm run ci` - PASS. 436 test files, 4691 tests passed (13 skipped). `audit:sql` OK (307 files scanned, every SQL interpolation routes through an escaping helper).
- `npm audit --omit=dev` - 0 vulnerabilities.
- New test coverage present in the branch for the security-relevant behavior: `tests/cli/harness-reconcile.test.ts` (fail-soft, timeout, idempotent cadence), `tests/cli/harness-status.test.ts`, `tests/commands/harness-verb.test.ts` (deferred-assembly / no-throw), `tests/daemon/runtime/dashboard/harness-api-plugin-enabled.test.ts` (fail-soft `false`, no leak). No new tests were added by this audit because no fix was needed.
