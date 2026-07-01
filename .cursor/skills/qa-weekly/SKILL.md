---
name: qa-weekly
description: Weekly QA orchestrator for Superledger. Runs all per-feature audit skills (qa-call-logs, qa-conversation-logs, qa-alerts, qa-gap-analysis, qa-client-portal, qa-syncing, qa-triage-rx, qa-pipeline-health, qa-action-summary) read-only against prod, then produces a single PASS/FAIL summary with one-line action items per failure. Use when the user asks to run weekly QA, the regression suite, "the audit", or when /schedule fires the weekly cron.
---

# QA Weekly — Superledger Regression Suite

You are the development manager running the weekly sanity sweep. Your job: run every per-feature QA skill, collect their pass/fail signals, and surface only what needs attention.

## How to invoke

The user will say something like "run weekly QA", "/qa-weekly", or it'll be triggered by `/schedule`. Either way, follow the steps below.

## Step 1 — Pre-flight

1. Confirm Supabase MCP connector is attached (UUID `a583a0c2-fc45-40e4-97fa-eee2aec8c0f0`). If not, abort and tell the user.
2. Confirm `gh` is authenticated (`gh auth status`).
3. Environment: run **read-only against prod** (project `ugjulsrvvsrlzyaiitdh`). Staging was removed 2026-06-05 — there is no staging target. Every check in this suite is a read-only SELECT/GET, which is safe on prod; never mutate.
4. Note the run timestamp for the report.

## Step 2 — Run each feature skill

Run these in order. For each skill, capture: PASS / FAIL / SKIP, plus a one-line note.

1. `qa-pipeline-health` — must pass first (downstream signals are noise if pipeline is stalled)
2. `qa-syncing`
3. `qa-call-logs`
4. `qa-conversation-logs`
5. `qa-gap-analysis`
6. `qa-alerts`
7. `qa-action-summary`
8. `qa-client-portal`
9. `qa-triage-rx`
10. `qa-advisors` — Supabase security + performance lints (whole-DB; catches RLS/index drift the per-feature skills miss)

Run them by invoking each skill via the Skill tool. If a skill is missing, mark it SKIP and continue.

## Step 3 — Report

Output exactly this structure:

```
QA Weekly Report — <env> — <date>

PASS:  N    FAIL:  N    SKIP:  N

## Failures (action required)
- qa-<feature>: <one-line failure description> → <one-line next step>
- ...

## Passes
- qa-<feature> — <one-line confirmation>
- ...

## Skipped
- qa-<feature> — <reason>
```

Keep the report under 30 lines. The user reads this in the morning — they want to know "is anything broken" not a wall of metrics.

## Step 4 — Open GitHub issues for each FAIL

For every line in `## Failures`, open or update a GitHub issue so the failure persists past the routine output. The hourly `dev-manager` watches the `qa-fail` label and surfaces these in its digest until they're closed.

**Title format:** `qa-<feature>: <short symptom>` (e.g. `qa-pipeline-health: cron heartbeat stale (3 jobs >24h)`).

**Dedup before creating:**
```bash
existing=$(gh issue list --label qa-fail --state open --search "qa-<feature>: <symptom>" --json number,title --jq '.[] | select(.title == "<full title>") | .number')
if [ -n "$existing" ]; then
  gh issue comment "$existing" --body "Reproduced by qa-weekly run on <date>. Still failing."
else
  gh issue create --label qa-fail --label qa-weekly --title "<title>" --body "<body>"
fi
```

**Body template (markdown):**
```
**Detected by:** qa-weekly run on <date> (env: <env>)
**Skill:** qa-<feature>
**Check:** <which check inside the skill failed>

**What failed:**
<the actual SQL/command and the unexpected result>

**Memory context:**
<any incident-memory file the skill references>

**Suggested first action:**
<the "On failure" guidance from the per-feature skill>

---
Auto-opened by qa-weekly. Close manually once resolved (or commit with `Closes #N`). The dev-manager will keep surfacing this until closed.
```

If the env is **prod** (manual run only), prefix the title with `[PROD]` and add the `priority-high` label.

Do NOT auto-fix. qa-weekly only opens issues; dev-manager only surfaces them. Humans (or spawned sessions) decide.

If `qa-client-portal` flagged a P0 cross-org leak: skip the `gh issue create` flow entirely. Output the leak details directly in the routine summary AND ping the user via the most direct channel available — at minimum, leave the digest as the only output so it's impossible to miss.

## Notes

- **Never run destructive operations** during QA. Read-only SQL only. No `apply_migration`, no `deploy_edge_function`, no `git push`.
- If a skill takes >2 minutes, abort it and mark SKIP with reason "timeout".
- Save the full report (including pass details) to `/tmp/qa-weekly-<env>-<date>.md` so the user can grep it later.
