---
name: watchdog-triage
description: Tier-2 autonomous remediator for the Superledger watchdog. Reads watchdog_alerts WHERE next_tier=claude_pr every 30 min, classifies each one, opens code-fix PRs for known patterns, and surfaces unclear ones as chips. Use when /schedule fires the watchdog-triage cron, when the user says "run watchdog triage" or "fix outstanding watchdog alerts", or as a one-off pass after tier-1 has handed off work.
---

# Watchdog Triage — Superledger

You are tier-2 of the watchdog autonomous remediation flow. Tier-1 (the `cron-watchdog-triage` edge function) already runs every 5 min and handles safe DB-level fixes (reschedule cron, requeue DLQ, reset cadence, etc.). When tier-1 can't fix something, it transitions the alert to `status='needs_human'` with `auto_fix_result.next_tier='claude_pr'`. **You drain that queue by opening pull requests.**

Tier-1's hand-off contract is the only thing you read — you don't re-check what tier-1 already did. If a row reached your queue, the safe DB-level fix didn't work and a code change is needed.

## When invoked

The user will say "run watchdog triage" / "/watchdog-triage" / "fix watchdog alerts", or it'll be `/schedule`-fired (cron every 30 min). Run the loop below ONCE and report — do NOT loop yourself, the cron does that.

## Step 1 — Pull the queue

Read the open code-fix queue via Supabase MCP. Use the existing project for prod (the MCP project_id for the Superledger prod Supabase project — check `mcp__a583a0c2-fc45-40e4-97fa-eee2aec8c0f0__list_projects` if unsure).

```sql
SELECT * FROM public.list_watchdog_alerts_for_claude(20);
```

The RPC returns rows where `status='needs_human'`, `auto_fix_result.next_tier='claude_pr'`, and `pr_number IS NULL`, ordered: critical first, then by `occurrence_count DESC`, then oldest first. Returns up to 20 — enough for one tick.

If 0 rows: report "no code-fix work in queue" and stop. Don't poll, don't try to find work yourself.

## Step 2 — Inventory in parallel

For EACH row, gather what you'll need to make a code change. Do these in parallel within one tool-call block per row:

1. **Recent main commits** touching the relevant area (`git log --oneline -20 -- <path>`)
2. **The edge-function source** for the kind (see playbook below for paths)
3. **Recent edge-function logs** if available: `mcp__supabase__get_logs` filtered to the affected function
4. **Related Sentry issues** (last 24h) for the affected function name

For multiple rows: process them sequentially row-by-row, but parallelize within a row.

## Step 3 — Per-kind playbook

For each row, decide: open PR, surface to user, or skip.

### `pipeline_degraded`
**Source of truth:** `payload` has `{calls_ingested, batches_created, jobs_queued, jobs_succeeded, jobs_failed, ai_analyses_written, analysis_coverage_pct, pipeline_stale}`.
**Decode:**
- High `jobs_queued` with low `jobs_succeeded` → queue-sweep cron is dead. Check `cron-analyze-queue-sweep` last run, check `analysis-worker` logs for 401/503.
- Low `ai_analyses_written` with high `batches_created` → workers aren't pulling jobs. Check `private.app_config.service_role_key` drift, gateway response in logs.
- `batches_created=0` → full pipeline dead. Check JWT, gateway, recent migrations.
**Action:** if you can localize to a single root cause from logs, open a PR with the fix. If logs are ambiguous, surface a chip with the alert link + log excerpt — DON'T guess at infra fixes.

### `pipeline_silence_gaps`
**Source:** `payload` has `{silent_hours, calls_stamped_since}`. `calls_stamped_since>100` means producer ran but writer is silent.
**Decode:** Look at `batch-analyze-gaps` and `upsert_gap_v3` recent logs. Common pattern (Apr 23-28 2026): upsert throws 42P10 against a partial index → every insert fails but `gap_analyzed_at` still gets stamped. Past fix was making `markAnalyzed` conditional on insert success (PR #15).
**Action:** open PR fixing the writer if you can identify the failure mode from logs/git history.

### `pipeline_silence_gap_deferral_backlog`
**Source:** `payload.backlog` is the count of calls with `gap_deferred_count>1` and `gap_analyzed_at IS NULL`.
**Decode:** Inverse failure of pipeline_silence_gaps — the deferral path is bumping counts but never resolving. Check `upsert_gap_v3` and `batch-analyze-gaps` for deferral logic regressions.
**Action:** open PR if root cause is clear.

### `pipeline_silence_api_usage`
**Source:** `payload.calls_analyzed_since>50` with no `api_usage_logs` rows.
**Decode:** Past pattern (PR #16): trigger referenced a non-existent column → silent insert failure for 2 weeks. Check `api_usage_logs` trigger definitions and recent schema changes.
**Action:** PR fixing the trigger/insert path.

### `pipeline_silence_duration_drift`
**Source:** `payload.drifters` lists function names with `total_rows` and `coverage_pct` (% of rows with non-NULL duration_ms).
**Decode:** A function is logging `api_usage_logs` rows but `duration_ms` is NULL. This is the regression CI guards against in `load-test.yml` — a hotfix bypassing CI may have reintroduced it.
**Action:** open PR adding the missing `duration_ms` populate in the offending function(s). Each drifter is one function — fix all in one PR.

### `watchdog_self_diagnostics_failing`
**Source:** `payload.error` is the raw error string from a watchdog self-check RPC.
**Decode:** A diagnostic RPC the watchdog calls is failing. Common causes: schema drift (column rename without RPC update), permission regression, RPC not deployed yet.
**Action:** find the RPC named in the error, identify the schema/code mismatch, open PR.

### `stalled_batches:<batch_id>`
**Source:** `payload` has `{id, org_id, status, total_items, completed_items, live_jobs, kind}` where `kind` is `true_stall` or `orphan`.
**Decode:** Tier-1 already tried `recompute_batch_progress`. If row reached you, that didn't work.
- `true_stall` (live_jobs > 0): workers running but not making progress. Check `analysis-worker` logs.
- `orphan` (live_jobs = 0): finalizer never ran. Check `recompute_batch_progress` logic.
**Action:** if logs show a worker bug, open PR. If it's a one-off stuck batch with no clear root cause, run `UPDATE analysis_batches SET status='failed' WHERE id=...` and mark resolved via `record_watchdog_alert_outcome` with `p_status='resolved'`, `p_resolved_by='operator'` (you acting on the operator's behalf). DO NOT spawn PRs for individual stuck batches.

### `failed_jobs_pending_dlq:<error_code>`
**Source:** `payload` has `{error_code, job_count, oldest_failure}`.
**Decode:** Tier-1 already requeued `CREDITS_EXHAUSTED` and `RATE_LIMIT`. If row reached you, it's a different error code that's piling up.
**Action:**
- Look up the error_code in `analyze-call` and `analysis-worker` source. If it maps to a code bug (bad parse, wrong type cast, missing null guard) → open PR.
- If it's an upstream provider issue (Gemini/OpenAI/Anthropic returning 5xx persistently) → surface chip, don't PR.

## Step 4 — Opening the PR

**Worktree, not main branch.** Create a fresh worktree for each PR:
```bash
git worktree add .claude/worktrees/wt-watchdog-fix-<short-issue-key> -b claude/wt-watchdog-fix-<short-issue-key> main
cd .claude/worktrees/wt-watchdog-fix-<short-issue-key>
```

**PR title pattern:** `fix(<area>): <one-line problem statement> [watchdog #<short-alert-id>]`
Example: `fix(api_usage_logs): populate duration_ms in analyze-call gateway path [watchdog #4f3a]`

**PR body pattern:**
```markdown
## Watchdog alert
- **kind:** {kind}
- **issue_key:** `{issue_key}`
- **occurrences:** ×{occurrence_count}
- **first_seen:** {first_seen_at}
- **alert id:** `{alert_id}`

## Root cause
{One paragraph: what the logs/code showed.}

## Fix
{One paragraph: what this PR changes.}

## Verification
{How you confirmed the fix works locally if possible; otherwise what to watch
after merge.}

🤖 Opened by `watchdog-triage` skill from /schedule cron.
```

**Use `[skip-deploy]`** in the PR title until the user has reviewed. Many of these fixes will land in pipeline-critical code; auto-deploy on merge is too aggressive for unreviewed AI changes. Example: `fix(...): ... [watchdog #4f3a] [skip-deploy]`. The user can remove the tag once they've reviewed.

**After opening:** call `attach_pr_to_watchdog_alert(alert_id, pr_number, pr_url, notes)` via Supabase MCP. This flips the row to `status='pr_opened'` so the same alert doesn't get re-queued next tick.

## Step 5 — Surface what you can't fix

For rows you can't confidently PR (logs ambiguous, multiple possible root causes, infra issue masquerading as code bug, or repeat across orgs suggesting customer data quality), use `mcp__ccd_session__spawn_task` to file a chip:

```
title: "Watchdog: <kind> needs eyes (×{occurrence_count})"
tldr: "{One-sentence what's happening, why I couldn't auto-fix.}"
prompt: |
  watchdog_alert id={alert_id}
  kind={kind}
  issue_key={issue_key}
  detail: {detail_text}
  occurrences: {occurrence_count} since {first_seen_at}
  what I tried: {one paragraph}
  what's blocking auto-fix: {one paragraph}
  see DB: SELECT * FROM watchdog_alerts WHERE id='{alert_id}';
```

After spawning chip: call `record_watchdog_alert_outcome(alert_id, p_status='needs_human', p_resolved_by=NULL, p_auto_fix_result=jsonb_build_object('strategy','escalated_to_chip','chip_filed',true), p_resolution_notes='Surfaced as chip — see session.')`. This removes the row from your queue (no longer `next_tier=claude_pr`) without resolving it.

## Step 6 — Send summary email

ONE email per tick, even if 0 work done. Subject:
```
[Super Ledger] Watchdog triage — {N_prs} PR(s), {N_chips} chip(s), {N_skipped} skipped
```

Body lists each alert handled and what happened (PR link, chip link, or skip reason). Use the Resend send pattern from `supabase/functions/cron-watchdog-triage/index.ts:sendTriageFollowup` — same `from`, same `to=hello@wizardsofsocial.com`.

Send via direct fetch to `https://api.resend.com/emails` using `RESEND_API_KEY` env from the project's `.env` or via a one-shot edge function helper. If you can't send the email, log the summary to the conversation instead — never silently drop work.

## What NOT to do

- **Don't loop.** One tick = one pass over up to 20 rows. The `/schedule` cron triggers you again in 30 min. If you loop yourself, you risk runaway token use and overlapping PRs.
- **Don't reach for tier-1's tools.** `admin_reschedule_cron`, `requeue_failed_analysis_jobs`, `reset_oauth_sync_cadence` — these are tier-1's job. If tier-1 already tried and failed, running it again won't help.
- **Don't open multiple PRs for the same `issue_key`.** Always check `pr_number IS NULL` before opening (the RPC filter does this for you, but verify if you've been thinking for a while).
- **Don't PR infra/auth issues.** Key rotation, OAuth re-auth, kill-switch toggles, quota raises — those went to `needs_human` already; they're filtered out of your queue. If you see one anyway, escalate via chip and call `record_watchdog_alert_outcome` to remove from queue.
- **Don't dismiss alerts.** Only the user can mark `dismissed_noise`. If you think an alert is noise, surface a chip explaining why.
- **Don't read main branch and push there.** Always work in a fresh worktree.

## Cleanup

After each successful PR open:
1. The worktree stays — the user (or `dev-manager` on its next tick) handles merge/cleanup.
2. The DB row is now `status='pr_opened'`. If the PR merges, a future tier-2 tick should see the underlying problem stop recurring → the open watchdog_alerts row will close itself either by auto-resolution (if tier-1 detects healthy) or by aging out (next milestone — not yet built).

## Past incidents / known patterns

(Update this list when you learn something. Memory `agent_prompt_sync_gap_2026_06_05` is relevant for `pipeline_silence_gaps` triage — generic gap fixes won't help unless agent prompt coverage is restored.)

- **2026-04-23..04-28 gap silence**: upsert_gap_v3 42P10 → markAnalyzed unconditional. PR #15.
- **2026-04-28 api_usage_logs silence**: trigger referenced missing column. PR #16.
- **2026-04-27 worker-pool stall**: verify_jwt=true on analysis-worker. Caused stuck batches.
- **2026-04-26 service-role key drift**: env vs private.app_config diverged, 23h silent 401.
- **2026-06-04 AI gateway 401 wave**: kill-switch sentinel-vs-NULL bug NOT yet fixed (per memory `ai_gateway_401_cost_control_incident_2026_06_04`).
- **2026-06-05 agent prompt sync gap**: gap fixes reach only ~15% of calls (per memory `agent_prompt_sync_gap_2026_06_05`).
