---
name: qa-conversation-logs
description: QA audit for Superledger's conversation analysis chain. Verifies conversation ingestion, analysis pipeline (inline state on `conversations`), RPC vs raw consistency, no orphans. Mirrors qa-call-logs but for the text/SMS/web-chat side. Use when the user asks to QA conversation logs or when qa-weekly invokes it.
---

# QA — Conversation Logs

Goal: every conversation that entered Superledger is visible, analyzed (or explicitly skipped), and counted consistently.

**Schema model (verified 2026-06-13 against prod `ugjulsrvvsrlzyaiitdh`):**
There is **no separate analyses table.** The old `conversation_analyses` / `chat_analyses` tables do not exist. Conversation analysis state lives **inline on `public.conversations`**:
- `gap_analyzed_at` (timestamptz) — analysis completed.
- `analysis_skipped_at` + `analysis_skip_reason` — analysis deliberately skipped (mirrors the call-side `analysis_skip_reason` contract; every skip carries a reason).
- A conversation is **pending** when both `gap_analyzed_at` and `analysis_skipped_at` are NULL.
- Other inline fields: `started_at`, `resolution_status` (`resolved_by_ai` / `escalated_to_human`), `channel`, `endpoint_id`, `goal_completion`, `sentiment`.

Real conversation tables: `conversations`, `messages`, `conversation_ingest_jobs`, `conversation_ingest_jobs_dead_letter`, `conversation_sync_state`, `chat_sessions_v`.
Edge fns: `analyze-conversation-gaps`, `conversation-worker`, `backfill-conversation-analysis`, `batch-analyze-conversation-gaps`, `sync-conversations-oauth`.
Dashboard hook: `src/hooks/useConversationDashboardData.ts` → RPC `get_conversation_dashboard_stats`.
UI route: `/monitoring/chat/:conversationId` (`ProductionChatLogs` / `ProductionChatDetail`). Client portal: `/client-portal/chats` (`ClientChatLogs`).

**Sample tenant:** staging was removed; run read-only against prod. As of 2026-06-13 only **one** prod org carries conversations: `4a51c894-9116-4c7e-bd73-5b69fa1772f3`. Re-derive the active org from Step 0 rather than trusting that id — it can change. (Ignore any leftover `metadata->>'synthetic' = 'true'` rows; the former `staging-simulator` synthetic org is gone.)

## Step 0 — Schema discovery (run first, fail-fast)

Tables/columns drift. Discover before asserting.
```sql
-- Confirm the inline-analysis columns still exist.
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'conversations'
  AND column_name IN ('gap_analyzed_at','analysis_skipped_at','analysis_skip_reason',
                      'started_at','endpoint_id','org_id','resolution_status');

-- Identify the active org(s) carrying conversations.
SELECT org_id, COUNT(*) AS convs, MAX(started_at) AS last_started
FROM public.conversations
GROUP BY org_id ORDER BY convs DESC;
```
If `conversations` doesn't exist, mark the skill SKIP with reason `schema: conversations table missing` and stop. If the inline-analysis columns above are missing, the analysis model changed again — SKIP and flag for a fresh schema audit rather than guessing.

## Checks (read-only SQL via Supabase MCP)

### 1. Conversation ingestion freshness
```sql
SELECT org_id, MAX(started_at) AS last_conv, NOW() - MAX(started_at) AS age
FROM public.conversations
GROUP BY org_id
HAVING MAX(started_at) < NOW() - INTERVAL '24 hours';
```
**PASS:** all active orgs have a conversation in last 24h, OR known-quiet orgs only. **FAIL:** active org silent.
(Note: chat ingestion is far lower-volume than calls; a >24h gap on the single active org warrants a look but is not automatically a sync break — corroborate against `conversation_sync_state` / `chat_sync_runs` before declaring FAIL.)

### 2. Orphan conversations (ingested but neither analyzed nor skipped)
Analysis is inline — a conversation is orphaned if it is old enough to have been processed yet has neither `gap_analyzed_at` nor `analysis_skipped_at` set.
```sql
SELECT COUNT(*) AS orphans
FROM public.conversations
WHERE started_at < NOW() - INTERVAL '2 hours'
  AND started_at > NOW() - INTERVAL '7 days'
  AND gap_analyzed_at IS NULL
  AND analysis_skipped_at IS NULL;
```
**PASS:** 0. **FAIL:** conversation analysis worker stuck (check `conversation_ingest_jobs` backlog + the `batch-analyze-conversation-gaps` cron).

### 3. RPC vs raw count parity (THIS WEEK)
The dashboard counts via `get_conversation_dashboard_stats(_endpoint_ids uuid[], _from_ts, _to_ts)`, which filters `endpoint_id = ANY(_endpoint_ids)` AND `started_at BETWEEN _from_ts AND _to_ts`. Replicate with the **same filters** (endpoint set + `started_at`, not `created_at`).
```sql
-- 3a. Endpoint ids for the sample org (feed these to the RPC).
SELECT array_agg(DISTINCT endpoint_id) AS endpoint_ids
FROM public.conversations
WHERE org_id = '<sample_org>' AND endpoint_id IS NOT NULL;

-- 3b. Raw count for this week, matching the RPC's predicates exactly.
SELECT COUNT(*) AS raw_count
FROM public.conversations
WHERE endpoint_id = ANY('<endpoint_ids_from_3a>'::uuid[])
  AND started_at >= date_trunc('week', NOW())
  AND started_at <= NOW();

-- 3c. RPC totalConversations for the same endpoint set + window.
SELECT (public.get_conversation_dashboard_stats(
          '<endpoint_ids_from_3a>'::uuid[],
          date_trunc('week', NOW()),
          NOW()
        ) -> 'stats' ->> 'totalConversations')::int AS rpc_count;
```
**PASS:** 3b `raw_count` == 3c `rpc_count`. **FAIL:** investigate (likely stale bundle, an endpoint missing from the dashboard's selected set, or RPC filter drift). Conversations with `endpoint_id IS NULL` are invisible to the RPC by construction — if 3a shows NULL-endpoint rows, flag them separately, don't treat as parity failure.

### 4. Credit / cost logging alive
**Important:** `api_usage_logs` has **no `metadata` column and no conversation linkage** — its only call/object FK is `call_id` (uuid), which is always NULL for conversation analysis. Per-conversation credit parity is therefore **not verifiable** from `api_usage_logs`. The only thing that can be checked is that conversation analysis is still emitting cost rows at all (function `batch-analyze-conversation-gaps`).
```sql
SELECT function_name, COUNT(*) AS rows_7d, SUM(estimated_cost_usd) AS cost_7d
FROM public.api_usage_logs
WHERE created_at > NOW() - INTERVAL '7 days'
  AND function_name = 'batch-analyze-conversation-gaps'
GROUP BY function_name;
```
**PASS:** at least one row when conversations were analyzed this week (cross-check: rows here > 0 whenever Check-2 window has `gap_analyzed_at` newly set). **FAIL:** conversations analyzed but zero cost rows logged = unbilled analysis.
(Removed the old per-conversation `LEFT JOIN api_usage_logs ON metadata->>'conversation_id'` invariant — that column/key never existed in this schema; the join was unsatisfiable and would have produced a false 100%-unlogged FAIL.)

### 5. Sentry — conversation/chat page errors last 7d
Sentry MCP `search_issues` with query `is:unresolved level:error` filtered to the real routes: `url:*/monitoring/chat*` OR `url:*/client-portal/chats*` last 7d. Flag new.

## Report

```
qa-conversation-logs: PASS|FAIL|SKIP
  schema discovery:    PASS|SKIP — <reason>
  ingestion:           PASS|FAIL
  orphans:             PASS|FAIL — <count>
  RPC/raw parity:      PASS|FAIL — <raw> vs <rpc>
  cost logging alive:  PASS|FAIL — <rows_7d>
  sentry errors:       PASS|FAIL
```
