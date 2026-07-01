---
name: qa-syncing
description: QA audit for sync-calls-oauth — the ONLY ingestion path for calls. Verifies sync ran on cadence for connected GHL locations, no sync stalls, no duplicate calls from re-sync, OAuth refresh not silently failing. Use when the user asks to QA syncing or when qa-weekly invokes it.
---

# QA — Syncing (sync-calls-oauth)

Goal: every connected GHL/HighLevel location is syncing on its cadence; no
silent OAuth refresh failures; no duplicate calls.

Per memory `ingestion_dual_path_and_clobber`: calls ingest via sync-calls-oauth
(and historically ghl-webhook); sync-calls-oauth is the canonical OAuth path on PROD.

## Schema notes (verified live 2026-06-13, prod ugjulsrvvsrlzyaiitdh)

- There is **no** `oauth_sync_runs` table and **no** `oauth_tokens` table.
- Per-location sync recency/state lives in **`oauth_sync_state`** (481 rows,
  freshly written). Columns: `location_id`, `org_id`, `hl_location_id`,
  `location_name`, `last_synced_at`, `last_sync_status`, `calls_synced_last_run`,
  `calls_upserted_last_run`, `error_message`, `cadence_tier`, `next_due_at`,
  `consecutive_empty_polls`, `last_call_observed_at`.
- Locations sync on a **cadence tier**, not a flat 24h — `next_due_at` gates the
  next poll. Use `next_due_at < NOW()` for "overdue", NOT a hardcoded 24h window
  (only a handful of busy locations re-poll within any given 24h).
- Run-level history table `call_sync_runs` **stopped being written on
  2026-05-27** (Phase B/C refactor → per-location `oauth_sync_state`). Its
  derived readers `v_sync_runs` / `get_sync_runs` / `get_stuck_sync_runs` and
  the `close_zombie_sync_runs` reaper were **dropped** (mig
  20280119000000) — do NOT reference them. Recency + stuck-detection come from
  `oauth_sync_state` and the freshness/cadence probes below.
- OAuth access/refresh tokens are NOT stored as plain columns. Account-level
  OAuth state is in **`integrations`** (`status` enum, `oauth_metadata` jsonb,
  `last_sync_at`). Token-refresh health is exposed via the RPC
  **`get_oauth_refresh_health()`** — use that for "tokens silently expired".
- Calls dedup keys are **`external_call_id`** and **`hl_call_id`** (NOT
  `external_id`).
- Edge function slug: **`sync-calls-oauth`** (confirmed in `supabase/functions/`).

## Step 0 — Environment detection (run first)

If this env has no real OAuth sync — `oauth_sync_state` empty or missing
(a fresh/sandbox project) — short-circuit. On prod it is populated, so the check
proceeds normally. Detect:

```sql
SELECT
  EXISTS (SELECT 1 FROM information_schema.tables
          WHERE table_schema='public' AND table_name='oauth_sync_state') AS has_sync_state,
  (SELECT COUNT(*) FROM oauth_sync_state) AS sync_state_rows,
  (SELECT COUNT(*) FROM integrations WHERE status = 'connected') AS connected_integrations;
```

If `has_sync_state=false` OR `sync_state_rows=0` OR `connected_integrations=0`:
no OAuth sync to verify (empty/sandbox env). Output:
```
qa-syncing: SKIP — no OAuth sync in this env (empty oauth_sync_state / no connected integration)
```
and exit clean. Do NOT mark FAIL.

## Checks (read-only SQL via Supabase MCP) — only run on prod

### 1. Locations syncing on cadence (no overdue stalls)
Cadence-aware: a location is stalled only when it is past its `next_due_at`.
Gate on `hl_subaccounts.is_active = true` — the dispatcher
(`enqueue_due_ingest_jobs`) only serves active locations, so a Stopped/uninstalled
location is intentionally never dispatched and must NOT read as a stall (CLAUDE.md
rule 17: detector and drainer must agree on the same population). On deactivation
its `next_due_at` is parked to NULL (mig 20280130000000), but the join keeps the
audit correct even if a row ever slips through.
```sql
SELECT s.hl_location_id, s.location_name, s.cadence_tier,
       s.last_synced_at, s.next_due_at,
       NOW() - s.next_due_at AS overdue_by,
       s.consecutive_empty_polls
FROM oauth_sync_state s
JOIN hl_subaccounts hs
  ON hs.org_id = s.org_id AND hs.hl_location_id = s.hl_location_id
WHERE hs.is_active = true
  AND s.next_due_at < NOW() - INTERVAL '2 hours'
ORDER BY s.next_due_at
LIMIT 30;
```
**PASS:** 0 rows (every location polled at or before its due time, allowing a
2h scheduler-jitter grace). **FAIL:** locations overdue → cron-sync-health /
sync-calls-oauth not advancing the cadence, or OAuth broken for that location.

### 2. OAuth refresh not silently failing
There is no token-expiry column to read; the refresh-failure tracker is the RPC.
```sql
SELECT integration_id, org_id, provider,
       refresh_failure_count, last_refresh_failure_at,
       last_refresh_failure_status, last_refresh_failure_message
FROM get_oauth_refresh_health()
ORDER BY refresh_failure_count DESC;
```
**PASS:** 0 rows, or all `refresh_failure_count = 0`. **FAIL:** any integration
with a nonzero/rising `refresh_failure_count` (esp. recent
`last_refresh_failure_at`) → token refresh broken; re-grant likely needed.

### 3. No duplicate calls from re-sync
Dedup is keyed on `external_call_id` (and `hl_call_id`). Check both.
```sql
SELECT external_call_id, COUNT(*)
FROM public.calls
WHERE created_at > NOW() - INTERVAL '7 days'
  AND external_call_id IS NOT NULL
GROUP BY external_call_id HAVING COUNT(*) > 1
LIMIT 20;
```
```sql
SELECT hl_call_id, COUNT(*)
FROM public.calls
WHERE created_at > NOW() - INTERVAL '7 days'
  AND hl_call_id IS NOT NULL
GROUP BY hl_call_id HAVING COUNT(*) > 1
LIMIT 20;
```
**PASS:** 0 rows each. **FAIL:** dupes → upsert key broken.

### 4. Per-location sync error rate
Run-level `call_sync_runs` is dead (stopped 2026-05-27) and its readers were
dropped; use the live per-location status on `oauth_sync_state`.
```sql
SELECT last_sync_status, COUNT(*) AS locations
FROM oauth_sync_state
GROUP BY last_sync_status
ORDER BY 2 DESC;
```
Optionally surface the failing locations:
```sql
SELECT hl_location_id, location_name, last_sync_status, error_message, last_synced_at
FROM oauth_sync_state
WHERE last_sync_status IS DISTINCT FROM 'success'
ORDER BY last_synced_at DESC NULLS LAST
LIMIT 30;
```
**PASS:** non-`success` locations / total < 5%. **FAIL:** elevated non-success
rate → inspect `error_message` and sync-calls-oauth Sentry breadcrumbs.

### 5. Overdue / wedged locations (advisory)
Run-level "stuck run" detection retired with `call_sync_runs`. The live
equivalent is a connected location whose `next_due_at` is well past but whose
`last_synced_at` hasn't advanced — the per-location poll isn't being driven.
```sql
SELECT s.hl_location_id, s.location_name, s.cadence_tier, s.last_sync_status,
       s.next_due_at, s.last_synced_at, s.consecutive_empty_polls
FROM oauth_sync_state s
JOIN hl_subaccounts hs
  ON hs.org_id = s.org_id AND hs.hl_location_id = s.hl_location_id
WHERE hs.is_active = true                 -- only locations the dispatcher serves (rule 17)
  AND s.next_due_at < NOW() - interval '30 minutes'
ORDER BY s.next_due_at ASC
LIMIT 30;
```
**PASS:** 0 rows (or only cold/frozen-tier locations). **FAIL:** hot/warm
locations overdue > 30 min → the scheduler isn't dispatching; check
cron-sync-calls + sync-calls-oauth logs. (Outcome-based detection is also
covered by `get_ingestion_freshness_alerts()` / `get_cadence_sanity()`.)

### 6. Sync edge function recent invocations (Supabase MCP get_logs)
Check `sync-calls-oauth` (and `cron-sync-health`) function logs for last 24h.
Confirm successful invocations exist; no repeated 5xx pattern.

## Report

```
qa-syncing: PASS|FAIL
  cadence recency:     PASS|FAIL — <overdue locations>
  oauth refresh:       PASS|FAIL — <integrations with refresh failures>
  duplicates:          PASS|FAIL — <count external_call_id / hl_call_id>
  error rate:          PASS|FAIL — <non-success %>
  stuck runs:          PASS|FAIL — <count>
  edge fn logs:        PASS|FAIL
```
