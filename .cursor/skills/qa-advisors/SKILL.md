---
name: qa-advisors
description: QA audit running Supabase's built-in security + performance advisors (whole-DB lints) against superledger-app prod. Catches new RLS gaps, exposed/SECURITY DEFINER objects, missing FK indexes, and auth misconfig that the per-feature QA skills miss — they check the diff, this scans the whole live schema. Use when the user asks to run advisors / DB lints, or when qa-weekly invokes it. Prod: ugjulsrvvsrlzyaiitdh.
---

# QA — Supabase Advisors (security + performance lints)

Your CI gates check the **diff**; this scans the **whole live DB** for drift. This
is the standing guard for the recurring RLS/anon-bypass incident class (anon
bypass, dropped RLS policies, REVOKE-insufficient). Read-only.

## Run

Call the Supabase MCP advisors tool for BOTH types (project `ugjulsrvvsrlzyaiitdh`):
- `mcp__a583a0c2-fc45-40e4-97fa-eee2aec8c0f0__get_advisors` with `type: "security"`
- same tool with `type: "performance"`

(If the MCP advisors tool isn't available, SKIP with that reason — do not hand-roll.)

## Triage

**Security advisors — these are the ones that matter most here:**
- `rls_disabled_in_public` / RLS-disabled on a table exposed to `anon`/`authenticated` → **FAIL** (this is the exact anon-bypass class that's bitten before).
- `security_definer_view` / function search_path mutable / exposed auth → **FAIL**, name the object.
- `policy_exists_rls_disabled`, `rls_enabled_no_policy` → **FAIL**.
- Anything new vs. the last run → surface.

**Performance advisors — advisory, not blocking:**
- `unindexed_foreign_keys`, `unused_index`, `multiple_permissive_policies` → note as **WARN**, list top offenders. Don't FAIL the suite on perf lints alone.

## Report

```
qa-advisors: PASS|FAIL|SKIP
  security:    PASS|FAIL — <N criticals: object names>
  performance: WARN — <N lints: top 3>
```
- **PASS:** 0 security criticals.
- **FAIL:** any security advisor at ERROR level (RLS-off on an exposed table, exposed SECURITY DEFINER, mutable search_path on a SECURITY DEFINER fn). Name the object and the advisor `name`/`lint` so it's actionable.
- **SKIP:** advisors tool unavailable.

## Notes
- Read-only: `get_advisors` only reads catalog metadata; never apply a suggested fix from this skill — surface it.
- Cross-reference a flagged object against memory `production_calls_v_anon_bypass_fixed` / `supabase_revoke_public_insufficient` before assuming it's new — some are known-and-handled.
