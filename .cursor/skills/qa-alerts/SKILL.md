---
name: qa-alerts
description: QA audit for Superledger's alerting system — alert rules active, no resolved-status dedup trap (open-unique index intact), alert checks firing on cadence, no_activity batching sane, /alerts page renders. Past incidents: dedup trap silenced alerts for weeks (2026-05-03), 4a fanout parked since 2026-05. Use when the user asks to QA alerts or when qa-weekly invokes it.
---

# QA — Alerts

Goal: every alert rule that should fire is firing, no silent dedup masking, no parked critical rules.

Read-only audit. All queries below are SELECT-only against prod
(`ugjulsrvvsrlzyaiitdh`) via the Supabase SQL tool. Never mutate.

## Schema reality (verified 2026-06-13 against live prod)

The alert system has two main tables with **different shapes** than older
versions of this skill assumed. Verify Step 0 before trusting anything below —
columns drift.

- `alert_rules` — the rule registry. Key columns: `rule_type` (NOT
  `alert_type`), `pattern_id` (nullable), `tier` (text, e.g. `T2`), `status`
  (text: `active` / paused), `last_triggered_at` (NOT `last_run_at`),
  `severity`, `scope_type`, `scope_id`. There is **no** `active` boolean and
  **no** `alert_type` column — use `status='active'` and `rule_type`.
  Live state: all rules are `tier='T2'`. There are no `T1` rows in
  `alert_rules`; "T1 always-live" alerts are emitted inline by edge functions
  (e.g. `human_call_f_grade`, `critical_human_call`), not gated through
  `alert_rules`.
- `production_alerts` — the fired-alert ledger. Key columns: `alert_type`
  (severity label: `WARNING` / `DEGRADATION` / `OUTAGE` — NOT a rule name),
  `pattern_id` (the real rule identity, e.g. `early_hangup`, `volume_drop`,
  `human_call_f_grade`), `category`, `severity_tier` (`LOW` / `HIGH` /
  `CRITICAL`), `status` (`active` / `resolved` — `acknowledged` is a column
  state via `acknowledged_at`/`acknowledged_by`, not a `status` value),
  `scope_type`, `scope_id` (text), `created_at`, `first_detected_at`,
  `snoozed_until`, `flap_suppressed`. There is **no** `fingerprint` and **no**
  `tier` column. Dedup identity = `(org_id, pattern_id, scope_type, scope_id)`.

The dedup uniqueness is enforced by a partial unique index:
`production_alerts_open_unique` on
`(org_id, pattern_id, scope_type, COALESCE(scope_id,''))  WHERE status <> 'resolved'`.
That index — not a `fingerprint` column — is what prevents the acknowledged-dedup
trap.

## Cadence & dispatch (verified)

The alert-check cadence is driven by **one** cron + edge function:

- cron `check-alert-thresholds-cron` (`7,22,37,52 * * * *`, ~every 15 min) →
  edge fn `check-alert-thresholds`. This is THE driver.
- cron `cron-send-alert-digest` (`5 * * * *`) → edge fn `send-alert-digest`.
- cron `recompute-alert-dow-baselines` (`0 3 * * *`) → RPC
  `recompute_alert_dow_baselines()`.
- Slack delivery: edge fn `send-slack-alert`. Regression harness:
  `run-alert-regression`.

The old `dispatch-alert-checks-cron` and `process-alert-check-drain-cron`
no longer exist (removed; the dispatch/drain split was collapsed into the
single `check-alert-thresholds-cron`). Do not look for them.

## Step 0 — Schema discovery (run first)

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'production_alerts'
ORDER BY ordinal_position;

SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'alert_rules'
ORDER BY ordinal_position;
```
If a column referenced below is absent, mark that check SKIP with reason
`schema: <col> column missing` rather than crashing.

## Checks (read-only SQL)

### 1. Critical alert rules are active and firing on cadence
```sql
SELECT rule_type, tier, status, last_triggered_at,
       NOW() - last_triggered_at AS age
FROM alert_rules
WHERE rule_type IN (
  'no_activity', 'gap_severity_surge', 'high_frequency_caller',
  'action_value_drop', 'agent_config_quality_drop', 'volume_drop',
  'llm_cost_anomaly', 'client_engagement_drop', 'early_hangup',
  'sync_ingestion_stall', 'oauth_integration_failed'
)
ORDER BY status, last_triggered_at NULLS FIRST;
```
**PASS:** all `status='active'`. The check cron runs ~every 15 min, so a
healthy system should show at least one rule with
`last_triggered_at` within the last hour (a rule only stamps
`last_triggered_at` when it actually fires, so a quiet-but-healthy window can
leave individual rules stale — judge cadence from the cron run history, not a
single rule's age). **FAIL:** any listed rule is paused/`status<>'active'`.

To confirm the cron itself is live (independent of any single rule firing):
```sql
SELECT MAX(last_triggered_at) AS most_recent_any_rule_trigger
FROM alert_rules;
```
**PASS:** within last few hours. **FAIL:** stale > 1 day → cron driver
(`check-alert-thresholds-cron`) likely down; check `cron.job` for that job's
`active` flag and recent `cron.job_run_details`.

### 2. No resolved-status dedup trap (open-unique index intact)
Per the 2026-05-03 incident, duplicate open alerts for the same logical
issue can mask new ones. The fix is the partial unique index
`production_alerts_open_unique` keyed on
`(org_id, pattern_id, scope_type, COALESCE(scope_id,''))  WHERE status <> 'resolved'`.

Confirm the index still exists:
```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'production_alerts'
  AND indexname = 'production_alerts_open_unique';
```
**PASS:** one row returned with the partial `WHERE (status <> 'resolved')`
predicate. **FAIL:** index missing or predicate changed → dedup guarantee gone.

Then confirm no duplicate OPEN alerts slipped through (any non-resolved status,
which covers `active` and acknowledged-but-open):
```sql
SELECT pattern_id, scope_type, COALESCE(scope_id,'') AS scope, COUNT(*)
FROM production_alerts
WHERE status <> 'resolved'
GROUP BY pattern_id, scope_type, COALESCE(scope_id,'')
HAVING COUNT(*) > 1;
```
**PASS:** 0 rows (the index should make this structurally impossible).
**FAIL:** any rows → the partial-unique index is missing or was bypassed.

### 3. Fired-alert recency by pattern
`pattern_id` is the real alert identity in `production_alerts`. Confirm the
patterns you expect to be live have fired recently. Live patterns observed:
`human_call_f_grade`, `critical_human_call`, `early_hangup`, `volume_drop`,
`spam_surge`, `agent_loop`, `capture_failure`, `pipeline_backlog_growing`,
`oauth_integration_failed`, `client_at_risk_composite`, `caller_blocked`.
```sql
SELECT pattern_id, category, MAX(created_at) AS last_fired, COUNT(*) AS n_30d
FROM production_alerts
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY pattern_id, category
ORDER BY last_fired DESC;
```
**PASS:** the high-volume always-on patterns (`human_call_f_grade`,
`critical_human_call`) have fired within the last 7d on tenants with activity.
**FAIL:** an always-on pattern silent > 7d while the tenant has live calls →
inline emitter likely broken (these fire from `analyze-human-portion`, not the
threshold cron). **SKIP:** if no qualifying tenant activity in the window.

### 4. no_activity not flooding
The `no_activity` rule can flood when many scopes go quiet at once. Note: in
`alert_rules` the rule is `rule_type='no_activity'`; check how it lands in
`production_alerts` (it surfaces via its own pattern/category — confirm the
landed `pattern_id` from check 3's output before filtering).
```sql
-- Adjust the pattern_id filter to whatever no_activity lands as in
-- production_alerts (per check 3). If it has not fired at all, this check is
-- SKIP "no_activity has not fired in window".
SELECT created_at::date AS day, COUNT(*) AS n
FROM production_alerts
WHERE pattern_id = 'no_activity'        -- confirm against check 3 output
  AND created_at > NOW() - INTERVAL '14 days'
GROUP BY day ORDER BY day;
```
**PASS:** day count steady (no spike > 3x baseline). **FAIL:** flood day →
batching logic regression. **SKIP:** pattern absent in window.

### 5. /alerts page UI sanity
If a browser/preview tool is connected, navigate to `/alerts`, snapshot,
confirm:
- Alert rows/pills render
- No "no data" empty state when `production_alerts` has recent non-resolved rows
  (cross-check with: `SELECT COUNT(*) FROM production_alerts WHERE status='active';`)
- No console errors

## Report

```
qa-alerts: PASS|FAIL|SKIP
  schema discovery:     PASS|SKIP — <missing cols>
  active rules:         PASS|FAIL — <paused rule_types>
  cron cadence:         PASS|FAIL — <most_recent_any_rule_trigger>
  dedup index intact:   PASS|FAIL — <open_unique present?>
  no dup open alerts:   PASS|FAIL
  pattern recency:      PASS|FAIL|SKIP
  no_activity flood:    PASS|FAIL|SKIP
  /alerts UI:           PASS|FAIL|SKIP
```
