---
name: qa-client-portal
description: QA audit for Superledger's Client Portal tier — white-label string scan (HARD RULE no GHL/HighLevel leak), org isolation spot check (no cross-org data), portal renders for sample tenant, portal_users integrity, hostname routing sanity. Use when the user asks to QA client portal or when qa-weekly invokes it.
---

# QA — Client Portal

Goal: Client Portal is brand-safe, tenant-isolated, and renders correctly. Per memory `project_white_label_hard_rule` this is existential — a HighLevel string in client UI breaks the whole white-label promise.

## Checks

### 1. White-label string scan (USER-VISIBLE only)
Per memory `project_white_label_hard_rule`: client-portal **user-visible** strings can NEVER reference HighLevel/GHL. Internal column/sentinel names (`*_highlevel*`, `highlevel_id`, `'highlevel'` in a status enum) are OK — they don't reach the user.

Only flag matches that look user-visible. Heuristic exclusions:
- snake_case identifiers ending in `_highlevel` or starting with `highlevel_`
- string literals inside SQL/RPC calls (`.eq('source', 'highlevel')`, etc.)
- comments (`// ...` lines)
- TypeScript type/interface names

```bash
cd /Users/fer/Documents/Cursor/superledger-app && \
  rg -i "highlevel|ghl|high.level" \
    src/pages/client-portal src/components/client-portal \
    --type tsx --type ts \
    -g '!*.test.*' -g '!*.stories.*' | \
  grep -v -E '_highlevel|highlevel_|'\''highlevel'\''|"highlevel"|^.*//' | \
  grep -v -E 'interface|type [A-Z]|enum'
```
**PASS:** 0 surviving matches. **FAIL:** any match → real user-visible leak; check the line in context. **Note:** if CI's white-label lint already runs, prefer its verdict — this is a backstop.

### 2. Org isolation spot check (HARD RULE per `project_org_id_isolation_invariant`)
The portal is scoped by **reporting org** (`reporting_organizations`), not the raw
account `org_id`. The canonical portal calls RPC is `get_client_calls(_reporting_org_id, _from_ts, _to_ts, …)`;
it gates on `client_can_access_reporting_org(...)` and confines results to that
reporting org's `reporting_sub_accounts` → endpoints → `calls`. The invariant: a
reporting org's portal must NEVER return a call belonging to a different underlying
`org_id`. `get_client_calls` returns `id` = the underlying `public.calls.id`.

Pick one active reporting org. Derive the underlying `org_id`(s) it legitimately
owns via `reporting_sub_accounts`, then confirm the RPC returns ZERO call ids whose
`calls.org_id` is foreign to that set. This is non-circular (RPC output vs. the
source `calls.org_id` it must never cross), and works even with a single reporting org.
```sql
-- Substitute a real reporting org id and a window that covers recent calls.
WITH ro AS (
  SELECT id AS reporting_org_id FROM public.reporting_organizations LIMIT 1
),
legit_orgs AS (  -- org_id(s) this reporting org is allowed to expose
  SELECT DISTINCT rsa.org_id
  FROM public.reporting_sub_accounts rsa, ro
  WHERE rsa.reporting_org_id = ro.reporting_org_id
),
rpc AS (
  SELECT a.id
  FROM ro, LATERAL get_client_calls(
    _reporting_org_id := ro.reporting_org_id,
    _from_ts := now() - interval '90 days',
    _to_ts   := now()
  ) a
)
SELECT COUNT(*) AS cross_org_rows
FROM rpc
JOIN public.calls c ON c.id = rpc.id
WHERE c.org_id NOT IN (SELECT org_id FROM legit_orgs);
```
**PASS:** 0. **FAIL:** ANY non-zero = cross-org leak → P0, halt all other QA, escalate immediately.

### 3. client_portal_users integrity
Portal accounts live in `client_portal_users`, keyed to a reporting org via
`reporting_org_id` (there is no `org_id`/`portal_users` table). Every portal user
must be bound to a reporting org.
```sql
SELECT COUNT(*) AS users_no_reporting_org
FROM public.client_portal_users WHERE reporting_org_id IS NULL;
```
**PASS:** 0. **FAIL:** orphan portal users (a user not scoped to any reporting org).
**Note:** `client_portal_users` may legitimately be empty in prod (0 rows) — that is
a PASS, not a FAIL.

### 4. Hostname routing sanity
Per memory `project_portal_hostname_architecture`: the portal host stays UNBRANDED. Staging was removed 2026-06-05 — run this against a real **prod tenant portal hostname**. Set `PORTAL_HOST` to a known prod tenant portal. If you don't have one, SKIP this check with `qa-client-portal: SKIP hostname — no prod portal host configured` (do NOT mark FAIL).
```bash
PORTAL_HOST="https://<prod-tenant-portal-host>"   # TODO: set to a real prod portal hostname (confirm canonical host before trusting)
curl -sI "$PORTAL_HOST" | head -5
curl -s "$PORTAL_HOST" | grep -iE "highlevel|gohighlevel|ghl" | head -5
```
**PASS:** 200 response, NO HighLevel/GHL references in HTML (the hard-rule leak). **FAIL:** branded leak or 5xx.

### 5. Portal page renders (preview MCP if available)
Navigate to `/client-portal` for a sample tenant, snapshot, confirm:
- Tenant brand visible (not "Superledger" hardcoded)
- No console errors
- Data loads (not perpetual skeleton)

## Report

```
qa-client-portal: PASS|FAIL
  white-label scan:    PASS|FAIL — <matches>
  org isolation:       PASS|FAIL — <leak details if FAIL: P0>
  client_portal_users: PASS|FAIL
  hostname routing:    PASS|FAIL
  portal UI:           PASS|FAIL
```

**Org isolation failure is P0**: stop the run, page the user immediately via spawn_task with title "P0: cross-org data leak in client portal".
