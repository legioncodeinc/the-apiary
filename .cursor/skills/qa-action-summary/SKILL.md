---
name: qa-action-summary
description: QA audit for the Action Summary / ROI attribution system. Verifies get_action_summary / get_portal_action_summary RPC output is internally coherent — event counts tie back to attributed calls (calls.actions_triggered) and ROI dollars tie back to per-action value settings. Use when the user asks to QA action summary or ROI attribution, or when qa-weekly invokes it.
---

# QA — Action Summary

Goal: ROI attribution numbers are internally coherent. The RPC output's
`event_count` and `total_value` per action reconcile against the underlying
production calls and the configured per-action dollar values.

**Read-only against prod** (project `ugjulsrvvsrlzyaiitdh`). Staging was removed
2026-06-05, so all checks run read-only against prod. Use a **real prod client
portal** as the sample tenant.

## How the system actually works (verified live 2026-06-13)

The skill's original model (per-call rows in `action_items` with
`estimated_value_usd` / `visibility_flag` columns) was wrong — none of those
objects exist. The real topology:

- **`actions_master`** — catalog/dimension of action *definitions*, scoped by
  `client_portal_id`. Columns: `action_key`, `action_label`, `action_category`,
  `icon`, `is_active`. It holds NO per-event rows, no `created_at`-volume, no
  `call_id`, no value column. Do not count rows here for "volume".
- **Attribution source = `calls.actions_triggered`** (a `text[]`). An action is
  "counted" when `am.action_key = ANY(calls.actions_triggered)` for a
  production call in the window. This — not `action_events` — is what the
  summary RPC aggregates.
- **`action_value_settings`** — ROI dollars. `value_per_action numeric`, joined
  by `action_type = action_key` and `client_portal_id`.
- **`action_groups`** — roll-up groups (`action_keys text[]`, `dollar_value`,
  `is_promoted`, `display_percentage`).
- **`client_action_visibility`** (cav) — the visibility model. Columns
  `visible_in_dashboard`, `visible_in_portal`, `visible_in_kpi` (plus
  `visible_in_exports`, `custom_label`, `display_order`,
  `display_as_percentage`). These are the "3 visibility flags."
- **`action_events`** exists but is NOT read by the summary RPCs.

RPC chain (both used by the frontend, both verified live):
- `get_action_summary(_reporting_org_id, _from_ts, _to_ts, _location_name DEFAULT NULL)`
  → auth-gates via `client_can_access_reporting_org`, resolves portal id via
  `_portal_id_for_reporting_org`, then delegates to `get_portal_action_summary`.
  Called from `src/pages/client-portal/ClientCallLogs.tsx`.
- `get_portal_action_summary(_client_portal_id, _from_ts, _to_ts, _location_name DEFAULT NULL)`
  → the real engine. Called from `DynamicActionCards/Chart` and
  `PromotedActionMetrics`. Returns a **jsonb array**; each element has
  `event_count int`, `value_per_action numeric`, `total_value numeric`,
  `visible_in_dashboard/portal/kpi`, `is_group`.

`client_can_access_reporting_org` returns true for `service_role` (the MCP SQL
role), so calling `get_action_summary` directly from MCP works. If it ever
returns NULL, call `get_portal_action_summary` with the portal id instead.

`supabase.rpc()` does NOT throw — a failed RPC returns `{ error }`. The audit
runs SQL directly, but when reasoning about the consumer remember the read path
checks `error` (ClientCallLogs does `if (error) throw error`).

## Step 0 — Schema + population discovery (run first)

```sql
-- Confirm the catalog table and RPCs still exist.
SELECT table_name FROM information_schema.tables
WHERE table_schema='public'
  AND table_name IN ('actions_master','action_value_settings',
                     'client_action_visibility','action_groups');

SELECT routine_name FROM information_schema.routines
WHERE routine_schema='public'
  AND routine_name IN ('get_action_summary','get_portal_action_summary');

-- Population snapshot — this feature is largely unlaunched in prod.
SELECT
  (SELECT COUNT(*) FROM actions_master WHERE is_active)        AS active_actions,
  (SELECT COUNT(*) FROM action_value_settings)                AS value_settings,
  (SELECT COUNT(*) FROM client_action_visibility)             AS visibility_rows,
  (SELECT COUNT(*) FROM action_groups)                        AS groups,
  (SELECT COUNT(*) FROM client_portals WHERE is_active)       AS active_portals;
```
- If `actions_master` / the RPCs are missing → SKIP the whole skill with that
  reason.
- **If `active_actions = 0`** (current prod state as of 2026-06-13 — all action
  tables are empty) → the feature is unpopulated, not broken. Report
  **SKIP — "action catalog empty in prod; feature not yet configured"** for the
  data checks. This is the expected baseline; do NOT report FAIL.

## Pick a sample tenant

```sql
-- Portals that actually have active actions configured.
SELECT cp.id AS client_portal_id, cp.reporting_org_id,
       COUNT(*) FILTER (WHERE am.is_active) AS active_actions
FROM client_portals cp
JOIN actions_master am ON am.client_portal_id = cp.id
WHERE cp.is_active = true
GROUP BY cp.id, cp.reporting_org_id
ORDER BY active_actions DESC
LIMIT 5;
```
Use the top `client_portal_id` / `reporting_org_id` for the checks below. If
this returns no rows, the data checks SKIP per Step 0.

## Checks (read-only SQL via Supabase MCP)

### 1. RPC runs and returns a coherent shape
```sql
SELECT jsonb_array_length(
  get_action_summary(
    '<sample_reporting_org_id>'::uuid,
    date_trunc('week', NOW()),
    NOW()
  )
) AS row_count;
```
**PASS:** returns a non-negative integer (array, possibly empty for a quiet
week). **FAIL:** NULL (auth gate refused even as service_role) or error.
If NULL, retry via `get_portal_action_summary('<portal_id>'::uuid, …)`.

### 2. event_count reconciles against attributed calls
The RPC counts DISTINCT production calls whose `actions_triggered` contains the
action_key. Replicate the live filter set independently for one action and
confirm it matches the RPC's `event_count`. (Every WHERE clause below is copied
from the live `get_portal_action_summary` body — keep them all; dropping one
inflates the count.)

```sql
-- Independent count for one action_key over the window.
WITH resolved_endpoints AS (
  SELECT e.id AS endpoint_id
  FROM reporting_sub_accounts rsa
  JOIN hl_subaccounts hs
    ON (rsa.highlevel_location_id = hs.id::text
        OR rsa.highlevel_location_id = hs.hl_location_id)
  JOIN endpoints e ON e.hl_subaccount_id = hs.id
  WHERE rsa.client_portal_id = '<portal_id>'::uuid
    AND COALESCE(hs.exclude_from_testing_reports, false) = false
)
SELECT COUNT(DISTINCT c.id) AS independent_count
FROM calls c
WHERE c.endpoint_id IN (SELECT endpoint_id FROM resolved_endpoints)
  AND c.started_at >= date_trunc('week', NOW())
  AND c.started_at <  NOW()
  AND '<action_key>' = ANY(c.actions_triggered)
  AND c.source = 'production'
  AND c.is_test_call IS NOT TRUE
  AND c.call_engaged = true
  AND c.early_termination IS NOT TRUE
  AND NOT (c.tags @> ARRAY['spam']::text[])
  AND NOT (c.tags @> ARRAY['excluded']::text[])
  AND NOT (c.tags @> ARRAY['robocall']::text[])
  AND NOT (c.tags @> ARRAY['ghost_ping']::text[])
  AND NOT (c.hl_call_id IS NULL AND c.duration_ms IS NULL AND c.transfer_type IS NULL);
-- Compare to the matching element's event_count from the RPC array in check 1.
```
**PASS:** `independent_count` equals the RPC `event_count` for that action_key.
**FAIL:** mismatch → filter drift between this skill and the live RPC; re-quote
`pg_get_functiondef('get_portal_action_summary')` and align before trusting the
number. **SKIP:** no active actions / no attributed calls in window.

### 3. ROI dollars reconcile (total_value = event_count × value_per_action)
The RPC computes `total_value = event_count * COALESCE(value_per_action, 0)`,
where `value_per_action` comes from `action_value_settings` (per-action) or
`action_groups.dollar_value` (group rows). Confirm the multiplication holds and
the rate is sane.

```sql
SELECT action_type, value_per_action
FROM action_value_settings
WHERE client_portal_id = '<portal_id>'::uuid
ORDER BY value_per_action DESC;
```
**PASS:** for each non-group RPC row, `total_value = event_count *
value_per_action` (exact, by construction — confirm the RPC isn't returning a
divergent precomputed number), and every `value_per_action` is non-negative and
plausible (not $1M/action). **FAIL:** negative rate, or `total_value` that
doesn't equal `event_count * value_per_action`. **SKIP:** no value settings
configured.

Note (CLAUDE.md rule 5): any hardcoded dollar/rate literal in the action ROI
read path outside `action_value_settings` / `action_groups.dollar_value` is a
defect — flag it even if out of scope.

### 4. Visibility model coherence
The 3 flags (`visible_in_dashboard`, `visible_in_portal`, `visible_in_kpi`) are
independent booleans per action, defaulted in the RPC (dashboard/portal default
true, kpi default false). Confirm rows aren't all collapsed into one bucket and
the table has no nonsense.

```sql
SELECT
  COUNT(*) AS rows,
  COUNT(*) FILTER (WHERE visible_in_dashboard) AS in_dashboard,
  COUNT(*) FILTER (WHERE visible_in_portal)    AS in_portal,
  COUNT(*) FILTER (WHERE visible_in_kpi)       AS in_kpi
FROM client_action_visibility
WHERE client_portal_id = '<portal_id>'::uuid;
```
**PASS:** flags vary (not 100% identical across all rows for an actively
configured portal). **SKIP:** no visibility rows — the RPC then applies its
defaults, which is valid; mark "visibility unconfigured, RPC defaults apply".

### 5. Recent attribution volume sanity
Confirm production calls are still being stamped with actions (the enrichment
pipeline is alive), independent of any portal config.

```sql
SELECT COUNT(*) AS calls_with_actions_24h
FROM calls
WHERE started_at > NOW() - INTERVAL '24 hours'
  AND source = 'production'
  AND actions_triggered IS NOT NULL
  AND array_length(actions_triggered, 1) > 0;
```
**PASS:** non-zero on an active fleet. **FAIL:** zero across 24h despite active
production calls suggests action enrichment is silent (cross-check
`count_calls_needing_action_enrichment` if needed). **SKIP:** acceptable to note
low-volume if the fleet itself is quiet.

## Removed checks (and why)

- **Old "RPC total vs raw actions_master COUNT(*)"** — removed. `actions_master`
  is a catalog, not an event log; counting its rows measures nothing about
  attribution. Replaced by check 2 (RPC `event_count` vs attributed `calls`).
- **Old `estimated_value_usd` SUM on actions_master** — removed; that column
  never existed. ROI lives in `action_value_settings.value_per_action` and is
  RPC-computed as `event_count * value_per_action` (check 3).
- **Old `actions_master.call_id` orphan join to `public.calls`** — removed; no
  such FK exists. Attribution is via the `calls.actions_triggered` array, so an
  "orphan action row" is not a possible failure mode here.

## Report

```
qa-action-summary: PASS|FAIL|SKIP
  schema + population:   PASS|SKIP — <missing or "catalog empty, unlaunched">
  RPC shape:             PASS|FAIL|SKIP
  event_count vs calls:  PASS|FAIL|SKIP
  ROI value reconcile:   PASS|FAIL|SKIP — $X rate range
  visibility coherence:  PASS|SKIP
  attribution volume:    PASS|FAIL|SKIP — <count> calls/24h
```
