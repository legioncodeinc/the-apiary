---
name: qa-triage-rx
description: QA audit for TriageRx — the pre-sales manual-upload ROI report (voice + chat). Verifies upload UI, report renders, Whisper minute logging (per pricing followup), no leaked debug paths. TriageRx is unlaunched — expect 0 prod whisper-1 logs (staging removed 2026-06-05; this audit runs read-only against prod). Use when the user asks to QA TriageRx or when qa-weekly invokes it.
---

# QA — TriageRx

Goal: TriageRx (renamed from Whisper 2026-05-01) accepts uploads, generates the ROI report, and logs Whisper minutes correctly when launched.

Per memory `project_whisper_presales_tool`: unlaunched; expect ~0 prod whisper-1 logs.
Per memory `project_pricing_followups_2026_05_03`: TriageRx Whisper minute logging is a deferred item — verify the metering code exists and is wired.

## Checks

### 1. Whisper-1 metering code exists & is wired
Whisper minutes are metered in the shared transcription layer, not in the
report fn. Confirm the `whisper-1` model tag is still emitted by the
transcription paths that feed an `api_usage_logs` row.
```bash
cd /Users/fer/Documents/Cursor/superledger-app && \
  rg -n "whisper-1" \
    supabase/functions/_shared/whisper-stream.ts \
    supabase/functions/process-audio \
    supabase/functions/analyze-audio-metrics \
    supabase/functions/repair-transcript && \
  rg -n "api_usage_logs|model:\s*'whisper-1'" \
    supabase/functions/process-audio supabase/functions/analyze-audio-metrics
```
**PASS:** `whisper-1` literal present in `_shared/whisper-stream.ts` and the
transcription fns, AND an `api_usage_logs` insert tagged `whisper-1` exists
(see `process-audio/index.ts` ~L236-244). **FAIL:** missing — pricing leakage
risk per memory item (3).

Note: the report-generation fn `generate-whisper-report` does NOT itself emit a
`whisper-1` usage row — it builds the ROI report from already-analyzed data and
bills via the credit-links flow (`reference_type='whisper_report'`). Do not
expect a `whisper-1` insert inside that fn.

### 2. Prod whisper-1 log count is sane
```sql
SELECT COUNT(*) FROM api_usage_logs
WHERE model = 'whisper-1' AND created_at > NOW() - INTERVAL '30 days';
```
**PASS:** 0 (TriageRx unlaunched — confirmed 0 in prod) OR matches known
launches. **FAIL:** unexpectedly high → unmetered usage. (Note: this counts ALL
whisper-1 transcription, not just TriageRx; a nonzero value would come from the
main analysis pipeline, so investigate before flagging.)

### 3. Upload UI renders (preview MCP if available)
Navigate to `/triage-rx` (the protected upload entry, `src/pages/TriageRx.tsx`),
snapshot:
- Upload control visible
- No console errors
- Submit button enabled when file selected

The public report renderer lives at `/r/:token` (canonical) and
`/triage-rx/report/:token` (alias) → `TriageRxPublicReport.tsx`, backed by the
`get_whisper_report_by_token` RPC + `whisper_report_links` table.

### 4. ROI report endpoint reachable
The report-generation edge function is `generate-whisper-report` (TriageRx is
the rename of the Whisper presales tool; the edge fn kept the `whisper` name).
`mcp__a583a0c2...__get_logs` with service `edge-function` for last 7d — confirm
0 5xx. (No `triage-rx-process` fn exists.)

### 5. No debug/internal paths leaked in client bundle
```bash
cd /Users/fer/Documents/Cursor/superledger-app && \
  rg -i "internal|debug|admin" \
    src/pages/TriageRx.tsx src/pages/TriageRxPublicReport.tsx \
    src/components/triage-rx
```
**PASS:** no obvious leaks. **FAIL:** review.

## Report

```
qa-triage-rx: PASS|FAIL
  whisper-1 metering code:   PASS|FAIL
  whisper-1 log count:       PASS|FAIL — <count>
  upload UI:                 PASS|FAIL
  edge fn (generate-whisper-report) 5xx: PASS|FAIL
  no debug leaks:            PASS|FAIL
```

## Note

This skill should be **lightly enforced** while TriageRx is pre-launch. Mark as SKIP rather than FAIL if the feature isn't deployed to the env being audited.
