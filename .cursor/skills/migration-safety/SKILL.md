---
name: migration-safety
description: Safe migration authoring + hand-apply protocol for superledger-app (prod project ugjulsrvvsrlzyaiitdh). Encodes the hard-won rules that caused repeated fleet-wide deploy meltdowns — version numbering, idempotent DDL, exact-version stamping, never MCP apply_migration for repo migrations, parity gates, and verify-effect-live. Use when authoring, renumbering, hand-applying, or debugging a Supabase migration, or when a deploy is blocked at the migration/parity step.
---

# Migration Safety — superledger-app

Prod DB project: `ugjulsrvvsrlzyaiitdh`. There is **no staging** — merge to `main`
is the prod deploy. Migrations are the single largest source of fleet-wide deploy
outages in this repo. Follow this protocol exactly.

## 0. Before you write anything

1. **Find the latest migration that touches the object** — never trust memory:
   ```
   grep -l <object_name> supabase/migrations/*.sql | sort | tail
   ```
   Functions/views are redefined by later migrations; the creation file is never
   authoritative after the first drift-repair landed.

2. **Get both maxima** — the new file's version must be greater than BOTH:
   - Repo max: `ls supabase/migrations/*.sql | sort | tail -1`
   - Prod max: `SELECT max(version) FROM supabase_migrations.schema_migrations;`
     (run via the Supabase MCP `execute_sql` against prod)

   The prod max can move under you while you work (parallel sessions). Re-check
   immediately before you finalize the version.

## 1. Authoring rules

- **Version = strictly above repo max AND prod max.** A duplicate version makes
  `supabase db push` **silently skip** the file — a green deploy does NOT prove
  the migration ran. Collisions also throw 23505 on the stamp insert.
- **All DDL must be idempotent.** Unguarded `CREATE POLICY` / `CREATE INDEX` /
  `CREATE TRIGGER` blocked the whole fleet on 2026-06-13. Use:
  - `DROP POLICY IF EXISTS ... ;` then `CREATE POLICY ...`
  - `CREATE INDEX IF NOT EXISTS ...` (CONCURRENTLY cannot run in a txn — split it)
  - `CREATE OR REPLACE FUNCTION ...`
  - `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...`
- **Functions: drift-repair is verbatim.** When repairing drift, paste the live
  `pg_get_functiondef` output verbatim plus its helper deps — do not hand-rewrite.
- **Keep RPC behavior gated.** Re-check every `WHERE` / `NOT EXISTS` clause from
  the live body survives (see CLAUDE.md rule #2). A dropped filter looks like a
  data bug later.

## 2. Hand-applying a repo migration (when db push is blocked)

**Never use MCP `apply_migration` for a repo migration** — it stamps its OWN
timestamp version, which diverges from the repo file and creates dupe-pairs.

Instead:
1. Execute the migration SQL directly via `execute_sql` (DDL is accepted).
2. Stamp the **exact repo file version** into the ledger:
   ```sql
   INSERT INTO supabase_migrations.schema_migrations (version, name)
   VALUES ('<exact_repo_version>', '<name>')
   ON CONFLICT (version) DO NOTHING;
   ```
3. **Merge the migration file promptly.** A hand-applied migration whose file is
   not yet merged blocks **ALL** deploys at the migration-parity check —
   including other sessions' unrelated PRs. Expect fleet-wide deploy failures
   until it lands.

## 3. Parity model (why deploys block)

- The **deploy gate** matches migrations by **NAME**.
- `supabase db push` matches by **VERSION**.
  A file can satisfy one and fail the other. When debugging a stuck deploy,
  check which check is red before blaming a PR.

## 4. Verify effect LIVE (a green deploy is not proof)

After deploy, confirm the change actually took on prod:
- For a function/view: diff live `pg_get_functiondef` / `pg_get_viewdef` against
  the migration body.
- For a column: `\d <table>` (or information_schema) shows it.
- For data: run two **independent** counts against source tables (CLAUDE.md
  rule #4 — never verify a derived value against its own inputs).

## Hard rules

1. Never `apply_migration` (MCP) for a repo migration — execute SQL + stamp exact version.
2. Never reuse or guess a version — compute it above repo AND prod max, live.
3. Never ship non-idempotent DDL.
4. Never claim "migration ran" from a green deploy alone — verify live.
5. `supabase.rpc()` does not throw — any verification RPC call must check `error`.
