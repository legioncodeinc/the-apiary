---
name: cost-anomaly-diagnosis
description: "Systematic methodology for investigating cost spikes in production LLM pipelines, identifying root causes (concurrent dispatch, weak guards), quantifying blast radius, and designing atomic single-flight fixes."
trigger: "When a call costs N× more than expected, or cost metrics show unexplained spikes across a time window."
author: hello
source_sessions:
  - hello_hello's Organization_default_4aef2bde-b28d-4d40-aa8c-b54b0f565741
contributors:
  - hello
version: 1
created_by_agent: claude_code
created_at: 2026-06-13T19:10:47.644Z
updated_at: 2026-06-13T19:10:47.644Z
---

# Cost Anomaly Diagnosis & Single-Flight Fix Pattern

## When to use

A user reports:
- A single call's cost is 10x+ the expected baseline (e.g., $0.165 vs ~$0.01)
- Cost metrics spike unexpectedly across a time window
- Cost variance is high for similar operations
- They suspect duplicate/concurrent work is driving spend

## Workflow

### 1. Isolate the call and count concurrent runs

Get the call ID, timestamp, and operation name (e.g., `analyze-human-portion`). Query prod logs for all invocations of that operation against that call in a tight window (typically 30s for webhook/retry races, 5m for cron races).

Typical signature: 5–7 independent dispatchers (webhook, sync-calls-oauth, scheduled jobs, retries, force-reanalyze) all read a NULL guard (e.g., `analyzed_at IS NULL`) within the window.

### 2. Measure cost per run and compute the multiplier

From logs/RPC data, extract the cost of a *single* run. Divide actual cost by baseline to get multiplier (e.g., 13×). The multiplier typically = (concurrent run count) − 1 + margin for retries.

### 3. Quantify blast radius

Determine the time range: typically 7d, or since the last deploy. Query the source table (e.g., `calls`) for all rows matching the condition that triggered concurrent runs (e.g., `has_human_transfer = true AND analyzed_at IS NULL`). Count affected calls and compute cumulative cost impact. Express as percentage of 7d category spend.

**Example:** 66 calls over 7d with ~13× runcount on each = ~$28 of $43 7d human-portion spend (66%).

### 4. Diagnose the guard failure

Identify what was supposed to prevent concurrency (e.g., `WHERE analyzed_at IS NULL`). Pinpoint the failure:
- **Weak check-then-act:** multiple readers all see NULL, write concurrently → no mutual exclusion.
- **No persistence:** check doesn't cross a database transaction boundary.
- **Timeout/retry collision:** re-read happens before first write completes.

This is a gap in dispatch *design*, not a bug in one PR.

### 5. Design the atomic fix

Introduce **atomic single-flight at the database layer:**
- Add a claim column: `calls.human_portion_claimed_at TIMESTAMP`.
- Create an RPC returning early if the column is set: `try_claim_human_portion()` (mirrors `try_claim_alert_slot` pattern).
- Lock down grants: `REVOKE FROM anon, authenticated` — `service_role` only.
- Callers invoke the RPC *before* the expensive operation. Losers (concurrent re-attempts) get `false` and back off immediately.
- **Fail-open:** if the RPC errors transiently, proceed anyway to avoid cascading outages.

### 6. Verify on prod

After deploy, run a live test on a call matching the original condition:
- Verify operation ran exactly once (not 13×).
- Verify cost dropped to baseline (~1¢).
- Verify output quality (e.g., analysis grade is real, not an error stub).
- Flag pre-existing related leaks (e.g., `call_id=NULL` from earlier backfill loops, stuck retries).

## Anti-patterns

- Don't assume the user ran it manually 13 times. Timestamps in a 30s window point to concurrent dispatch.
- Don't stop at "we fixed a check in PR #123." If the check was already there and still raced, the check is broken (weak guard design).
- Don't blame infrastructure or database contention. Cost storms are almost always application-layer concurrent dispatch.
- Don't skip the blast radius calculation. A cost anomaly on one call hints at a systemic leak affecting dozens or hundreds of calls.
- Don't leave old data behind. After shipping the atomic claim, backfill/re-analyze affected calls so historical data is consistent (real grades instead of error stubs).

## Superledger example (June 2026)

**Symptom:** Call `49b54b8b` cost $0.165 (vs ~$0.01 baseline). Human-call analysis card showed blank.

**Diagnosis:** `analyze-human-portion` dispatched 13× in 30s (webhook, sync-calls-oauth, retries, etc.). All read `analyzed_at IS NULL` before writing, so no mutual exclusion. Long audio (~436s) triggered ASR truncation on some runs → blank error stub.

**Blast radius:** 66 calls over 7d, ~$28 of $43 7d spend (66%). Pattern: any transfer call re-triggered before `analyzed_at` was written.

**Fix:** `try_claim_human_portion()` RPC + `calls.human_portion_claimed_at` column; ASR salvage for long audio (PR #1114).

**Verification:** Call `49b54b8b` re-analyzed in 1 pass, $0.0107 cost, real grade (A, 9/10).
