---
name: rpc-error-lint
description: Audit superledger-app source for supabase.rpc() / .from() calls that ignore the returned `error` field — the silent-failure trap (CLAUDE.md #13) where a failed RPC returns { error } instead of throwing, so a broken call dies quietly (an alert type was dead for weeks). Use when the user asks to lint RPC error handling, before merging code that adds .rpc() calls, or as a periodic audit. Scan set MUST include consumer surfaces: src/hooks, src/components, src/pages, supabase/functions.
---

# RPC Error-Handling Lint — superledger-app

`supabase.rpc()` (and `.from().select/insert/update/delete`) **do not throw** on
failure — they resolve to `{ data, error }`. A call that never inspects `error`
fails silently. This audit finds those call sites for human review.

## Scope (state it, then cover the consumer surface)

Scan these — not just changed files (CLAUDE.md rule #1, audits must reach consumers):
```
src/hooks  src/components  src/pages  src/lib  supabase/functions
```

## Step 1 — Enumerate every Supabase call site

```
cd /Users/fer/Documents/Cursor/superledger-app
grep -rnE '\.(rpc|from)\(' src supabase/functions \
  --include='*.ts' --include='*.tsx' \
  | grep -vE '/(node_modules|dist|build)/'
```

## Step 2 — Flag the ones that ignore `error`

For each hit, read a ~6-line window after the call and classify. A call is
**SUSPECT** (report it) when none of these appear in its result handling:
- destructures `error` — `const { data, error } = await ...`
- references `.error` on the awaited result
- is wrapped so the `error` is checked/thrown downstream (e.g. a shared
  `throwOnError` helper, or `.throwOnError()` chained)

Quick first-pass to narrow the list (call sites NOT destructuring error):
```
grep -rnE 'await .*\.(rpc|from)\(' src supabase/functions \
  --include='*.ts' --include='*.tsx' \
  | grep -vE 'error' \
  | grep -vE '/(node_modules|dist|build)/'
```
This is a heuristic (the destructure may be on the next line) — **read each hit**
before reporting; do not report from the grep alone.

## Step 3 — Report

Group by file. For each suspect:
```
src/hooks/useFoo.ts:42   supabase.rpc('get_bar', …)   — result not error-checked
```
Do NOT auto-fix. Surface the list; error handling shape is call-specific (toast
vs throw vs silent-ok-with-fallback) and needs human judgment. If invoked with an
explicit "fix" instruction, add `if (error) { … }` matching the file's existing
error convention (look at a neighboring handled call first).

## Known-correct exceptions (don't flag)
- Calls that chain `.throwOnError()` — error surfaces as a throw.
- Calls routed through a shared wrapper that already checks `error` (grep the
  wrapper to confirm before excluding).

## Why this matters
CLAUDE.md #13: an alert type was dead for weeks because a CHECK constraint
rejected every insert and the ignored `{ error }` meant nothing surfaced — not in
the UI, not in Sentry, not in the watchdog.
