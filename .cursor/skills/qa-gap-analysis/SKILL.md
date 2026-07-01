---
name: qa-gap-analysis
description: QA audit for Superledger's gap analysis pipeline. Verifies batch-analyze-gaps is processing (not stamping nulls — see PR #136), gap counts on UI match raw table, gap_severity distribution sane, gaps tied to real calls. Past incident: gap pipeline silent ~10h on 2026-04-30. Use when the user asks to QA gap analysis or when qa-weekly invokes it.
---

# QA — Gap Analysis

Goal: gap pipeline is producing real gaps, no null-stamping, UI matches data.

## Checks (read-only SQL via Supabase MCP)

### 1. Pipeline freshness (no null-stamping)
Per memory `project_incident_2026_04_30_gap_pipeline_silent`: batch-analyze-gaps used to stamp on null LLM results, hiding stalls. PR #136 fixed this. Confirm gaps are being CREATED, not just stamped.
```sql
SELECT
  date_trunc('hour', created_at) AS hour,
  COUNT(*) AS gaps_created,
  COUNT(*) FILTER (WHERE gap_severity IS NULL) AS null_gap_severity,
  COUNT(*) FILTER (WHERE root_cause IS NULL) AS null_root_cause
FROM gaps
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY hour ORDER BY hour DESC LIMIT 24;
```
**PASS:** gaps created each hour during business hours; `null_gap_severity` and `null_root_cause` are 0 (or near-0). **FAIL:** large NULL counts → null-stamping regression.

### 2. Gaps tied to real calls (no orphans)
```sql
SELECT COUNT(*) FROM gaps g
LEFT JOIN public.calls c ON c.id = g.call_id
WHERE g.created_at > NOW() - INTERVAL '7 days'
  AND c.id IS NULL;
```
**PASS:** 0. **FAIL:** orphan gaps → call deleted but gap retained.

### 3. Severity distribution sane
```sql
SELECT gap_severity, COUNT(*)
FROM gaps
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY gap_severity ORDER BY COUNT(*) DESC;
```
**PASS:** spread across severities (not 100% on one bucket). **FAIL:** all rows one gap_severity → LLM scoring stuck.

### 4. RPC vs raw count parity for recent gaps
There is no dedicated "Gaps This Week" count RPC. The dashboard's trend/series
data comes from `get_gap_trends(_org_id, _window_days)` (confirmed live). Run a
raw windowed count and reconcile it against the totals that RPC returns for the
same org + window.
```sql
SELECT COUNT(*) FROM gaps
WHERE created_at >= NOW() - INTERVAL '30 days' AND org_id = '<sample_org>';
-- compare against: SELECT * FROM get_gap_trends('<sample_org>', 30);
```
**PASS:** raw count reconciles with the RPC's per-day totals (summed). **FAIL:** investigate filter drift.

### 5. Gap Severity Surge alert rule active
Per memory `project_alerts_v3_backlog`: Gap Severity Surge is shipped (PR #252).
NOTE: `gap_severity_surge` is a value of `alert_rules.rule_type` (the rule
engine), NOT of `production_alerts.alert_type` — that column only holds
`DEGRADATION`/`OUTAGE`/`WARNING`, so the old query against `production_alerts`
was always empty. The surge logic is evaluated by the live RPC
`alert_threshold_gap_severity_surge(p_org_id, p_pct_increase_threshold, …)`;
the rule's wiring + last-fire state live on `alert_rules`.
```sql
SELECT status, last_triggered_at, trigger_count
FROM alert_rules
WHERE rule_type = 'gap_severity_surge';
```
**PASS:** at least one rule exists with `status = 'active'` (it is evaluated on
cadence whether or not it has fired recently). **FAIL:** no row, or every
matching rule is disabled → the surge alert is not wired.

### 6. Analysis content completeness
Catches the regression where the LLM ran but returned null for body fields and the deferral logic (PR #136) didn't kick in. The earlier "null_gap_severity / null_root_cause" check catches it at insertion; this check catches stale rows that survived past the deferral window.
```sql
SELECT COUNT(*) AS analyzed_but_blank
FROM gaps
WHERE created_at < NOW() - INTERVAL '30 minutes'
  AND created_at > NOW() - INTERVAL '7 days'
  AND (root_cause IS NULL OR fix_recommendation_category IS NULL);
```
**PASS:** 0. **FAIL:** non-zero — gap was created but key analysis fields are blank past the 30-min retry window. This is the user-visible "I drilled into a gap and it shows blank" symptom.

### 7. cron-analyze-gaps actually succeeding (not just running)
qa-pipeline-health checks heartbeat. This check catches a cron that runs but
partially fails inside (silent no-op). Run history lives in the pg_cron native
table `cron.job_run_details` (there is no `cron_runs` table); join it to
`cron.job` by `jobid` to filter on the job name. pg_cron statuses are
`succeeded` / `failed` (no `completed_at` column — use `end_time`).
```sql
SELECT
  MAX(d.end_time) FILTER (WHERE d.status = 'succeeded') AS last_success,
  COUNT(*) FILTER (WHERE d.status = 'failed') AS recent_failures,
  COUNT(*) AS total_runs
FROM cron.job_run_details d
JOIN cron.job j ON j.jobid = d.jobid
WHERE j.jobname = 'cron-analyze-gaps'
  AND d.start_time > NOW() - INTERVAL '6 hours';
```
**PASS:** `recent_failures / total_runs < 0.5` AND `last_success` within last 30 min. **FAIL:** failure rate >50% over last 6h, OR no successful run in last 30 min while runs are happening.

### 8. Triage backlog (informational — never FAIL)
`pending` is a triage state, not a pipeline state. Open backlog growth is product feedback, not a bug. Surface as a note, do NOT open an issue.
```sql
SELECT
  COUNT(*) FILTER (WHERE status = 'pending' AND created_at < NOW() - INTERVAL '24 hours') AS pending_over_24h,
  COUNT(*) FILTER (WHERE status = 'pending' AND created_at < NOW() - INTERVAL '7 days') AS pending_over_7d,
  COUNT(*) FILTER (WHERE status = 'pending') AS total_pending
FROM gaps;
```
Output as informational line in the report. If `pending_over_7d > 100`, mention "consider product fix: rename pending to 'open' or surface backlog in UI." Do not mark FAIL or create issues — by-design state, not a bug.

## Report

```
qa-gap-analysis: PASS|FAIL
  pipeline freshness:    PASS|FAIL — null gap_severity %
  orphan gaps:           PASS|FAIL — <count>
  gap_severity spread:   PASS|FAIL
  RPC/raw parity:        PASS|FAIL
  gap_severity_surge:    PASS|FAIL
  analyzed-but-blank:    PASS|FAIL — <count>
  cron-analyze-gaps fn:  PASS|FAIL — <failure rate>
  triage backlog:        INFO — <X pending >24h, Y pending >7d>
```
