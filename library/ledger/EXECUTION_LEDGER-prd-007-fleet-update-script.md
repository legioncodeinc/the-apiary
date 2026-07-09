# Execution Ledger — PRD-007 One-Command Fleet Update Script

> **Driver:** `/the-apiary:the-smoker` · **Branch:** `legion/apiary-update-script-4f89bb` · **Started:** 2026-07-08
> Single source of truth for every acceptance criterion. Status: OPEN / IN PROGRESS / DONE / VERIFIED / BLOCKED.
> A criterion is DONE only when fully implemented and proven; VERIFIED only after an independent pass (close-out) confirms it.

## Owners & files

| Owner (Bee) | Model | Scope | Files |
|---|---|---|---|
| `terminal-bash-worker-bee` (Scripts) | opus | 007a + 007b + script-side telemetry seam | `scripts/install/update.sh`, `scripts/install/update.ps1` |
| `ci-release-worker-bee` (Site) | opus | 007c site delivery + telemetry event wiring | `site/install/_worker.js`, `site/install/build.mjs`, `site/install/_headers`, `site/install/index.template.html`, `site/install/README.md` |
| `security-worker-bee` | opus | Close-out 1: OWASP/PII/injection over new shell + worker | (audit) |
| `quality-worker-bee` | sonnet | Close-out 2: implementation vs PRD-007 | (audit) |

**Cross-owner contract:** the Scripts bee MUST emit the verbatim anchor lines `HONEYCOMB_INSTALL_POSTHOG_KEY=""` (update.sh) and `$HoneycombInstallPosthogKey = ''` (update.ps1); the Site bee registers both in `build.mjs` `POSTHOG_KEY_PATTERNS`. Event names shared by both: `update_started`, `update_completed`, `update_failed`, `product_updated`.

## AC Ledger

| ID | Source | Criterion (abbrev) | Owner | Status |
|---|---|---|---|---|
| AC-1 | index | `/update` moves installed pkgs to blessed, logs old→new, never `@latest` unless `--latest` | Scripts | VERIFIED |
| AC-1b | index | `--latest` targets npm `latest` + warning; default always blessed | Scripts | VERIFIED |
| AC-2 | index | After update, each product's service converged+restarted, daemon serves new version | Scripts | VERIFIED |
| AC-3 | index | Idempotent: already-blessed → no npm, no restart, "already up to date", exit 0 | Scripts | VERIFIED |
| AC-4 | index | Only installed products touched (update, not install) | Scripts | VERIFIED |
| AC-5 | index | Reports harnesses; Claude Code plugin newest installed + refreshed; else prints instruction | Scripts | VERIFIED |
| AC-6 | index | PowerShell twin achieves AC-1..5 on Windows incl. task/service restart | Scripts | VERIFIED |
| AC-7 | index | `update_started` first; exactly one completed/failed; one `product_updated`/move; same channel/shape; no PII/license/code | Scripts+Site | VERIFIED |
| AC-8 | index | `/update`,`/update.sh`,`/update.ps1` text/plain+nosniff; SHA256SUMS entries; `sha256sum -c` verifies; inspect page shows both | Site | VERIFIED |
| AC-9 | index | No step destructive/blocking on failure; degrades to clear message; never removes/deletes/leaves-stopped silently | Scripts | VERIFIED |
| AC-10 | index | Needs no pre-installed Apiary tooling beyond Node/npm+curl; never assumes `honeycomb` on PATH pre-resolve | Scripts | VERIFIED |
| a-AC-1 | 007a | Older → `npm i -g pkg@blessed`, log old→new | Scripts | VERIFIED |
| a-AC-2 | 007a | installed==blessed → skip "already current", no npm install | Scripts | VERIFIED |
| a-AC-3 | 007a | not installed → neither installed nor mentioned | Scripts | VERIFIED |
| a-AC-4 | 007a | published:false/unreachable → skip+note, continue, never `@latest` fallback, never fail run | Scripts | VERIFIED |
| a-AC-1b-1 | 007a | `--latest` → `pkg@latest`, one-line warning | Scripts | VERIFIED |
| a-AC-1b-2 | 007a | `--latest`, installed==npm latest → skip already current | Scripts | VERIFIED |
| a-AC-1b-3 | 007a | no flag → blessed default; `--latest` strictly opt-in | Scripts | VERIFIED |
| a-AC-5 | 007a | moved → service converged, daemon new version confirmed or note names command | Scripts | VERIFIED |
| a-AC-6 | 007a | recycle verifies live node before signal; converge before kill (Doctor race) | Scripts | VERIFIED |
| a-AC-7 | 007a | unmoved product → service untouched | Scripts | VERIFIED |
| a-AC-8 | 007a | whole fleet blessed → no npm, no restart, "already up to date", exit 0 | Scripts | VERIFIED |
| a-AC-9 | 007a | Node/npm absent/broken → plain report + one command, exit non-zero, touch nothing | Scripts | VERIFIED |
| a-AC-10 | 007a | `--dry-run` → resolve+print, mutate nothing, preview (not send) telemetry | Scripts | VERIFIED |
| b-AC-1 | 007b | Prints each detected harness (via honeycomb detection), "no coding assistants detected" when none | Scripts | VERIFIED (verb fix confirmed by QA re-pass) |
| b-AC-2 | 007b | honeycomb moved + Claude Code enabled → newest plugin reinstalled+enabled, idempotent, "refreshed" | Scripts | VERIFIED |
| b-AC-3 | 007b | `claude` not on PATH → plain instruction, never fails update | Scripts | VERIFIED |
| b-AC-4 | 007b | plugin reinstalled but running session → "restart Claude Code to load the updated plugin" | Scripts | VERIFIED |
| b-AC-5 | 007b | refresh can't complete → clear message, update still reports pkg/service, exits on package result | Scripts | VERIFIED |
| b-AC-6 | 007b | no harness → clean no-op "no coding assistants to refresh" | Scripts | VERIFIED (verb fix confirmed by QA re-pass) |
| c-AC-1 | 007c | `GET /update` shell→update.sh text/plain+nosniff; browser→inspect page | Site | VERIFIED |
| c-AC-2 | 007c | `/update.sh`+`/update.ps1` text/plain+nosniff via `_headers`; SHA256SUMS entries; `sha256sum -c` verifies | Site | VERIFIED |
| c-AC-3 | 007c | build.mjs copies + SHA + anchored key inject + renders checksums+source tokens | Site | VERIFIED |
| c-AC-4 | 007c | Deploy via existing `deploy-install-site.yaml` on `v*` unchanged shape; only un-prefixed routes checksummed | Site | VERIFIED |
| c-AC-5 | 007c | `update_started` first, curl-only, anonymous install-id distinct_id | Scripts+Site | VERIFIED |
| c-AC-6 | 007c | exactly one completed/failed via single `finish()` funnel, incl. failure before honeycomb CLI | Scripts | VERIFIED |
| c-AC-7 | 007c | one `product_updated` per moved product (never skipped/absent), reuse event + product field | Scripts | VERIFIED |
| c-AC-8 | 007c | allow-listed payload, no PII/license/code; empty key → silent no-op; `--dry-run` previews only | Scripts+Site | VERIFIED |

## Wave log

- **Wave 1 (parallel):** Scripts bee + Site bee — disjoint file sets. → dispatched.
- **Wave 2:** integration verify (`node site/install/build.mjs`, `sha256sum -c`, shell `-n`/dry-run smoke).
- **Wave 3 (close-out):** security-worker-bee → quality-worker-bee.
- **Wave 4 (ship):** commit `2782faf` → pushed → PR #19 (https://github.com/legioncodeinc/the-apiary/pull/19). CI: no PR-triggered workflow matches these paths (installer/site/library); the only gate is the `v*`-tag install-site deploy, which runs `node site/install/build.mjs` — pre-validated locally (clean build, `sha256sum -c` 6/6). Nothing red. **SHIPPED.**

## Terminations / decompositions

- **2026-07-08 QA FIX-FIRST (round 1):** QA (36/38 PASS) found b-AC-1 + b-AC-6 FAIL — `update.sh`/`update.ps1` call non-existent verb `honeycomb harnesses`; real verb is `honeycomb harness status` (verified live). Plus a PS1 `-File` exit-code propagation gap (uninstall.ps1 solved it with an `IsTopLevelFileInvocation` check that update.ps1 didn't mirror). Routed back to Scripts owner (resumed with context). Security posture unchanged (literal verb string + exit-code only, no new surface). Also flag the wrong verb in PRD-007b's impl notes to fix.

## Blockers

(none yet)
