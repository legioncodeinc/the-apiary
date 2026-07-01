---
name: post-deploy-verify
description: Confirm a superledger-app prod deploy actually landed — newest main commit is what prod serves (Vercel alias race), the deploy-prod workflow went green for that SHA, and prod migration parity matches the repo. Use right after merging a PR to main, when /schedule fires the post-deploy-verify cron, or when you suspect a silent frontend rollback. Repo: wizardsofsocial-team/superledger-app. Prod DB: ugjulsrvvsrlzyaiitdh.
---

# Post-Deploy Verify — superledger-app

Merge to `main` IS the prod deploy (no staging). Two silent-failure modes this
catches:
- **Vercel prod alias race** — back-to-back merges let an OLDER build finish later
  and steal the prod alias, silently rolling the frontend back.
- **Migration silent-skip** — a duplicate version makes `db push` skip the file;
  the deploy is green but the schema change never applied.

Run the loop once and report. Be terse.

## Step 1 — What SHOULD be live

```
HEAD=$(gh api repos/wizardsofsocial-team/superledger-app/commits/main --jq '.sha')
gh api repos/wizardsofsocial-team/superledger-app/commits/main --jq '.sha[0:8] + "  " + .commit.message' | head -1
```

## Step 2 — Did the deploy workflow go green for that SHA?

```
gh run list --repo wizardsofsocial-team/superledger-app --limit 15 \
  --json databaseId,name,headSha,status,conclusion,createdAt \
  --jq '.[] | select(.name|test("deploy"; "i")) | "\(.conclusion // .status)  \(.headSha[0:8])  \(.name)"'
```
- Confirm the newest `deploy-prod` run for `HEAD` concluded `success`.
- If a run is still `in_progress`, note it and re-check next tick (~3 min full deploy).
- esm.sh 522 / transient network in a deploy log is a known flake — re-run, don't chase.

## Step 3 — Frontend alias race check (prod: https://app.superledgerai.com)

The frontend ships via Vercel independently of the edge/db deploy. The build bakes
the commit SHA into the JS bundle as `VITE_RELEASE_SHA` (see `vite.config.ts` →
`import.meta.env.VITE_RELEASE_SHA`, consumed as the Sentry release in
`src/lib/sentry.ts`). Read it from the LIVE site and compare to `HEAD`:

```
# 1. find the current index chunk (the hashed filename changes every build)
IDX=$(curl -fsSL https://app.superledgerai.com/ | grep -oE '/assets/index-[A-Za-z0-9._-]+\.js' | head -1)
# 2. extract the baked release SHA — the index chunk carries exactly one 40-hex string
PROD_SHA=$(curl -fsSL "https://app.superledgerai.com${IDX}" | grep -oE '[0-9a-f]{40}' | sort -u | head -1)
echo "prod serving: $PROD_SHA   HEAD: $HEAD"
```

- Use the **index** chunk, not `vendor-*` — vendor chunks contain unrelated
  40-hex literals; the index chunk carries only the release SHA. (Verified
  2026-06-13: index chunk → single SHA matching HEAD.)
- `PROD_SHA == HEAD` → alias is current. All good.
- `PROD_SHA` is an OLDER commit than `HEAD` **and** the deploy-prod run for HEAD
  was `success` → a slower older build stole the alias. **Surface to the user**
  (never redeploy / swap the alias autonomously) — title
  `Prod alias rolled back to <sha>`. Re-checking in a few minutes may show it
  self-corrected once the newer build's alias assignment wins.
- Optional cross-check: the latest Sentry release equals this same SHA, so it
  should also equal `HEAD`.

## Step 4 — Migration parity (prod vs repo)

```
REPO_MAX=$(ls supabase/migrations/*.sql | sort | tail -1 | xargs basename | cut -d_ -f1)
```
Then via Supabase MCP `execute_sql` against prod (`ugjulsrvvsrlzyaiitdh`):
```sql
SELECT max(version) AS prod_max FROM supabase_migrations.schema_migrations;
```
- `prod_max` should be `>=` `REPO_MAX`. If `prod_max < REPO_MAX`, a migration did
  not apply (likely a version collision silent-skip) — surface it with the gap.
- Remember: `supabase.rpc()` / a failed query returns `{ error }`, it does not
  throw. Check `error` on every call.

## Step 3.5 — If multiple merges landed close together

List the last few merges to `main` and confirm the alias points at the LAST one,
not an earlier build that finished later:
```
gh api "repos/wizardsofsocial-team/superledger-app/commits?per_page=5&sha=main" \
  --jq '.[] | .sha[0:8] + "  " + (.commit.committer.date) + "  " + (.commit.message|split("\n")[0])'
```

## Output

```
Post-Deploy Verify — <ISO timestamp>
HEAD: <sha8> <subject>
deploy-prod: <success|in_progress|FAILED>
frontend alias: <matches HEAD | ROLLED BACK to <sha> | unknown — URL not configured>
migration parity: <ok prod_max>=repo_max | GAP prod=<x> repo=<y>>
Action: <none | surfaced: ...>
```

## Hard rules
- Never redeploy or force an alias swap autonomously — surface alias rollbacks.
- Never run destructive SQL; read-only parity queries only.
- Never claim "deployed" from a green workflow alone — Step 3 + Step 4 must pass.
