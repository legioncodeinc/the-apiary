---
name: qa-pipeline-health
description: QA audit for Superledger's analysis pipeline — cron heartbeats, worker pool, advisory locks, DLQ depth, api_usage_logs completeness. Use when the user asks to check pipeline health, when qa-weekly invokes it, or when investigating "is anything stalled?". Past incidents: worker-pool stall (2026-04-27), gap pipeline silent (2026-04-30).
---

# QA — Pipeline Health

Goal: confirm the analysis/transcription/gap pipeline is processing on cadence and no silent stalls.

All checks are READ-ONLY (SELECT only) via the Supabase MCP `execute_sql`
against prod project `ugjulsrvvsrlzyaiitdh`. Never mutate, apply migrations, or
deploy from this skill.

> Schema note (verified 2026-06-13 against live prod): pg_cron jobs live in the
> `cron` schema (`cron.job` / `cron.job_run_details`), not in any public table.
> The legacy `cron_definitions` / `cron_runs` / `analysis_queue` /
> `dead_letter_queue` tables no longer exist. The pipeline is now driven by the
> `analysis_jobs` / `ingest_jobs` queue tables and surfaced through a family of
> SECURITY DEFINER RPCs (`get_cron_job_status`, `get_analysis_queue_stats`,
> `get_dead_letter_depth`, `get_ingest_dead_letter_depth`,
> `get_pipeline_health_24h`, `get_pipeline_stage_snapshot`). Always read through
> these RPCs.

## Checks (read-only SQL via Supabase MCP)

### 1. Cron heartbeat (last 24h)
Every active cron should have run successfully in the last 24h.
`get_cron_job_status()` reads the live `cron.job` + `cron.job_run_details`
schema and returns the last run per job.
```sql
SELECT jobname, last_run_status, last_run_start,
       NOW() - last_run_start AS age
FROM get_cron_job_status()
WHERE active = true
  AND (last_run_start IS NULL
       OR last_run_start < NOW() - INTERVAL '24 hours'
       OR last_run_status <> 'succeeded');
```
**PASS:** 0 rows (or only known-low-frequency jobs e.g. `send-monthly-reports`,
`cron-refresh-audio-unavailable` whose cadence is intentionally >24h —
cross-check schedule via `get_cron_definitions()` before failing on those).
**FAIL:** any high-frequency pipeline cron silent >24h or last status not
`succeeded`.

### 2. Worker pool — no stuck jobs
`get_analysis_queue_stats()` returns one row per status with backlog ages.
```sql
SELECT status, cnt, oldest_age_min, newest_age_min
FROM get_analysis_queue_stats();
```
Then check for jobs claimed but never finished (the worker-pool stall shape):
```sql
SELECT COUNT(*) AS stuck_claimed
FROM analysis_jobs
WHERE status = 'processing'
  AND claimed_at < NOW() - INTERVAL '30 minutes'
  AND (heartbeat_at IS NULL OR heartbeat_at < NOW() - INTERVAL '30 minutes');
```
**PASS:** `failed` < 5% of total; no `processing`/claimed rows stale >30 min.
**FAIL:** stuck-claimed rows >0 (likely worker-pool stall like the 2026-04-27
verify_jwt incident) or failed share ≥5%.

### 3. DLQ depth (analysis + ingest)
Both dead-letter queues now have dedicated depth RPCs.
```sql
SELECT 'analysis' AS dlq, * FROM get_dead_letter_depth()
UNION ALL
SELECT 'ingest'   AS dlq, * FROM get_ingest_dead_letter_depth();
```
`total_parked` = currently parked (not yet replayed); `total_ever` = cumulative;
`oldest_parked_at` = age of the oldest unreplayed row.
**PASS:** `total_parked` flat or down vs prior week; no old `oldest_parked_at`.
**FAIL:** sudden `total_parked` growth, or an `oldest_parked_at` aging for days.

### 4. api_usage_logs completeness
Per memory `project_usage_logging_gaps`: gateway/duration NULL rate must be <5%.
(`gateway` and `duration_ms` columns confirmed live on `api_usage_logs`.)
```sql
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE gateway IS NULL) AS null_gateway,
  COUNT(*) FILTER (WHERE duration_ms IS NULL) AS null_duration
FROM api_usage_logs
WHERE created_at > NOW() - INTERVAL '7 days';
```
**PASS:** both NULL counts <5% of total. **FAIL:** ≥5% — logging regression,
check shared LLM helper.

### 5. Advisory locks not stuck
```sql
SELECT classid, objid, granted, COUNT(*)
FROM pg_locks WHERE locktype = 'advisory'
GROUP BY classid, objid, granted;
```
**PASS:** no `granted=true` rows older than the longest legitimate batch. **FAIL:** orphan lock (chain-lock stall — see project_analysis_pipeline_failure_modes).

### 6. Pipeline throughput + stage backlog (corroborating signal)
`get_pipeline_health_24h()` summarizes the last-24h pipeline in one row;
`get_pipeline_stage_snapshot()` lists per-stage backlog + SLA violations.
```sql
SELECT * FROM get_pipeline_health_24h();
SELECT * FROM get_pipeline_stage_snapshot();
```
**PASS:** `pipeline_stale = false`, `analysis_coverage_pct` healthy (≈99%+),
no stage with a large/aging `sla_violated_count`.
**FAIL:** `pipeline_stale = true`, coverage drop, or an SLA-violated backlog
climbing across runs.

## Report

```
qa-pipeline-health: PASS|FAIL
  cron heartbeat:    PASS|FAIL — <details if fail>
  worker pool:       PASS|FAIL
  dlq depth:         PASS|FAIL — analysis parked X, ingest parked Y
  usage_logs nulls:  PASS|FAIL — gateway X%, duration Y%
  advisory locks:    PASS|FAIL
  pipeline 24h:      PASS|FAIL — stale=?, coverage Z%
```

## On failure

Spawn a task with:
- Failing check name
- Suspect file: `supabase/functions/analysis-worker/`,
  `supabase/functions/cron-analysis-dispatcher/`,
  `supabase/functions/batch-analyze-gaps/`,
  `supabase/functions/ingest-worker/`, or shared LLM helper depending on which
  check failed
- Reference the matching incident memory for context
