---
name: qa-call-logs
description: QA audit for Superledger's voice call ingestion + analysis + display chain. Verifies sync→analyze→render consistency: counts on the /monitoring (Calls) page match RPC counts match raw table counts, no orphan calls (ingested but never analyzed), audio_url presence sane vs audio_duration_ms (timing-lag trap), no stale-bundle issues. Use when the user asks to QA call logs or when qa-weekly invokes it.
---

# QA — Call Logs

Goal: every voice call that entered Superledger is visible, analyzed, and counted consistently across UI + RPC + raw tables.

## Checks (read-only SQL via Supabase MCP, plus Sentry MCP)

### 1. Ingestion freshness
Calls enter ONLY via `sync-calls-oauth` (per memory `project_call_ingestion`). Confirm new calls landing within last 6h for each active org.
```sql
SELECT org_id, MAX(created_at) AS last_call, NOW() - MAX(created_at) AS age
FROM public.calls
GROUP BY org_id
HAVING MAX(created_at) < NOW() - INTERVAL '24 hours';
```
**PASS:** all active orgs have a call in last 24h (or are known-quiet — confirm with user). **FAIL:** silent org → check sync-calls-oauth logs.

### 2. Orphan calls (ingested, never analyzed)
There is no `call_analyses` table — analysis state lives on `public.calls` itself.

**DEAD COLUMNS — do NOT use as the completion signal.** `analysis_completed_at`
and `analysis_started_at` were retired in the pipeline refactor and are **NULL for
every row in the table** (verified 2026-06-15: `MAX(analysis_completed_at)` over all
calls = NULL). Keying the orphan check on `analysis_completed_at IS NULL` matches
every analyzed call and produced a 3,400-row phantom backlog (issue #1230) — 99% of
which had full transcripts. Never reintroduce that predicate.

A call is **analyzed** when it carries a real analysis artifact — use
`transcript_text IS NOT NULL` (the core transcription/analysis output; also check
`gap_analyzed_at` / `call_summary_superledger`). An orphan is a call old enough to
have been processed that is neither analyzed nor `analysis_skip_reason`-stamped.
```sql
SELECT COUNT(*) FROM public.calls c
WHERE c.created_at < NOW() - INTERVAL '2 hours'
  AND c.created_at > NOW() - INTERVAL '7 days'
  AND c.analysis_skip_reason IS NULL
  AND c.transcript_text IS NULL
  AND c.gap_analyzed_at IS NULL
  AND c.call_summary_superledger IS NULL;
```
**PASS:** 0. **FAIL:** any orphan >2h old → analysis-worker stuck (see qa-pipeline-health first).
Note: sub-2s / NULL-`duration_ms` hangups legitimately never get a job and surface
here as a small residual — confirm `duration_ms` before calling it a real stall.

### 3. RPC vs raw count parity (THIS WEEK)
The /monitoring (Calls) page shows a total count via the `get_production_call_count`
RPC (args: `_org_id uuid, _from_ts timestamptz, _to_ts timestamptz, …optional filters`).
That RPC reads `production_calls_v`, NOT raw `public.calls` — so it intentionally
EXCLUDES test/illegitimate calls, transfer-without-`hl_call_id` rows, and any call on an
endpoint whose subaccount has `exclude_from_testing_reports`. It also windows on
`started_at`, not `created_at`. A naive raw-`calls`-vs-RPC comparison mismatches by
construction (CLAUDE.md rule 2 + 4). The honest parity check counts the SAME view the
RPC counts.
```sql
-- view-direct count for one org, this week, matching the RPC's source + window
SELECT COUNT(*) FROM public.production_calls_v
WHERE org_id = '<sample_org>'
  AND started_at >= date_trunc('week', NOW());

-- RPC for the identical org + window
SELECT get_production_call_count(
  _org_id  := '<sample_org>',
  _from_ts := date_trunc('week', NOW()),
  _to_ts   := NOW()
);
```
**PASS:** the two equal (same org, same window). **FAIL:** drift → likely stale-bundle (see memory `project_stale_bundle_lazy_chunk_pattern`) OR the RPC body diverged from `production_calls_v` (re-quote `pg_get_functiondef` and `pg_get_viewdef` before concluding). First ask user to test in incognito (per memory `feedback_metric_mismatch_first_ask_incognito`).

### 4. audio_url vs audio_duration_ms timing lag
Per memory `project_audio_signal_timing`: use `audio_url IS NOT NULL` for "has recording", NOT `audio_duration_ms`.
```sql
SELECT
  COUNT(*) FILTER (WHERE audio_url IS NOT NULL) AS has_url,
  COUNT(*) FILTER (WHERE audio_duration_ms IS NOT NULL) AS has_duration,
  COUNT(*) FILTER (WHERE audio_url IS NOT NULL AND audio_duration_ms IS NULL) AS url_no_duration
FROM public.calls
WHERE created_at > NOW() - INTERVAL '24 hours';
```
**PASS:** `url_no_duration` is non-zero (expected — duration lags) AND any UI cards using duration aren't being shown as "has recording". **FAIL:** if UI conflates these, surface to user.

### 5. Sentry — call-page errors last 7d
Use Sentry MCP `search_issues` with query: `is:unresolved level:error url:*monitoring*` in last 7d (the call log lives at `/monitoring`; also try `url:*ProductionMonitoring*`). Flag any new issue not seen in prior week.
**PASS:** 0 new. **FAIL:** any new → spawn fix task with the Sentry issue link.

## Report

```
qa-call-logs: PASS|FAIL
  ingestion freshness:    PASS|FAIL — <orgs flagged>
  orphan calls:           PASS|FAIL — <count>
  RPC/view count parity:  PASS|FAIL — get_production_call_count=X view=Y
  audio timing sanity:    PASS|FAIL
  sentry errors:          PASS|FAIL — <issue links>
```
