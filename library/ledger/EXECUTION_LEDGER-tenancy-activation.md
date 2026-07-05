# Execution Ledger: Tenancy Selection + Dormant-by-Default Capture (honeycomb PRD-073, hive PRD-011)

Single source of truth for the /the-smoker run over **honeycomb PRD-073** (dormant-capture-and-explicit-tenancy) and **hive PRD-011** (onboarding-tenancy-selection). Status legend: OPEN / IN PROGRESS / DONE / VERIFIED / BLOCKED.

**Branches:** honeycomb `feature/prd-073-dormant-capture-tenancy`; hive `feature/prd-011-onboarding-tenancy`; superproject `feature/smoker-tenancy-activation` (this ledger).

**Canonical API contract:** honeycomb PRD-073c owns it (`GET /setup/tenancy`, `GET /setup/tenancy/orgs`, `GET /setup/tenancy/workspaces?org=`, `POST /setup/tenancy/select` body `{orgId, workspaceId}`, flagged `POST /setup/tenancy/workspaces`); hive PRD-011 mirrors it field-for-field. Reconciled by the orchestrator at authoring time; any change lands in 073c first.

**Orchestrator decisions (user-authorized "decisions that improve the UX and product", 2026-07-04 18:40):**
1. All PRD-flagged defaults are ADOPTED as flagged (inbox capture opt-in default OFF via `HONEYCOMB_INBOX_CAPTURE`; historical `__unsorted__` rows untouched; legacy credentials grandfathered as confirmed with header visibility as the mitigation; `tenancyConfirmedAt` marker on `~/.deeplake/credentials.json`; skillify mines bound-project sessions only; session-start table-ensure gated by the same ladder; tenancy display in the shell header; canonical routes as reconciled).
2. Workspace creation (`POST /setup/tenancy/workspaces`): the W1-H worker probes the live Deeplake API for creation support and reports; `canCreate` gates the UI either way, so the picker degrades honestly if unsupported. Ship it only if the API supports it.
3. The DOGFOOD (both PRDs' primary acceptance path) requires the product owner at the keyboard (device-code approval in a browser); it runs as the FINAL verification step after close-out, coordinated with the user. Parked as a user-gated step, not skipped.

## Wave plan

| Wave | Worker | Scope | Model (per `.cursor/model-comparison-matrix.md`) | Exit criteria |
|---|---|---|---|---|
| W1-H | honeycomb implementation worker | PRD-073a/b/c/d (capture gate ladder, dormancy surfacing, two-phase link + selection API, CLI explicitness) | `claude-opus-4-8-thinking-high-fast`: auth-flow + capture-pipeline surgery across the daemon; deep-reasoning multi-file work routes to Opus | All 073 ACs DONE; `npm run ci` green |
| W1-V | hive implementation worker | PRD-011a/b/c (tenancy onboarding phase, header visibility, gate coherence) | `composer-2.5-fast`: React onboarding state machine + wire additions in established idioms | All 011 ACs DONE; typecheck + tests green |
| W2 | `security-worker-bee` then `quality-worker-bee`, per repo (armed per the beekeeper contract) | both branches | as dispatched | No Critical/High; QA clean at medium+ |
| W3 | ship | commit, push, PR, CI loop | main thread | All checks green |
| W4 | DOGFOOD with the user | fresh-install protocol on this Windows machine (clear `.apiary`/`.honeycomb`/`.deeplake`/`.nectar`, get.theapiary.sh, tenancy picker, zero-writes proof, bind, verify) | user + orchestrator | Every dogfood observation matches the PRDs |

Routing note: the beekeeper roster's implementation Bees are Hivemind-scoped; per the roster's no-improvised-Bees rule, implementation workers run as general-purpose agents armed with each repo's AGENTS.md + PRD set (honeycomb's worker follows the `typescript-node-worker-bee` profile). Close-out uses the real `security-worker-bee`/`quality-worker-bee`.

**W2 quality results:**
- hive: SHIP-READY (2026-07-04 20:13). Final polish landed: W-4 reload loop bounded by a per-tab lap counter to a terminal manual-retry state; N-1 funnel events recorded on the tokenless resume cohort via a new `"optional"` token mode (presented tokens still validate, token-bearing behavior intact); N-2 probe now has a self-contained fail-closed `.catch`. Orchestrator independently re-verified: typecheck clean, 62 files / 451 tests green, home canary clean. Only tracked-elsewhere items remain (F-1 honeycomb#231, F-3 honeycomb zod, W4 dogfood).
- hive: RE-AUDIT PASS WITH WARNINGS (2026-07-04 20:02); C-1 genuinely closed (re-auditor re-attacked all four tokenless routes; tg-AC-8, ts-AC-10, ts-AC-5, ts-AC-12 all pass with real tests; confirmedBy contract-safe, no XSS). Ship bar met (no Critical/High/Medium). One final product-improving polish cycle dispatched for the three below-bar-but-cheap items (authorized "improve the product"): W-4 fault-mode reload LOOP (user-facing, bound the retry), N-1 funnel undercount on the resume cohort (event route tokenless-tolerant), N-2 probe .catch self-containment. Then ship. Deferred/tracked: F-1 CSRF (honeycomb#231), F-3 name length (honeycomb zod), dogfood (W4 manual).
- hive: fix landed, RE-AUDIT dispatched (2026-07-04 19:55). C-1 fixed (tokenless mount probes /setup/state + /setup/tenancy, resumes at the tenancy step for authenticated+unselected, fails closed to the expired notice otherwise; 4 new tg-AC-8/ts-AC-10 tests). Reconciliation done: `autoSelected` dropped, `confirmedBy` added fail-soft with a grandfathered header hint. Warnings W-1/W-2/W-3 + suggestions S-1/S-3/S-4/S-5 closed. Orchestrator independently re-verified: typecheck clean, 62 files / 446 tests green (up from 428), home canary clean, `autoSelected` gone from live code. Re-audit in flight (Critical requires it).
- hive (first audit): BLOCKED -> fix cycle (2026-07-04 19:42). One Critical C-1: the gate 302s an unconfirmed operator to `/onboarding`, but a tokenless nav dead-ends at the "link expired" terminal instead of resuming the tenancy step (breaks tg-AC-8, makes ts-AC-10 reachable only via full bootstrap re-run). Server-side enforcement holds (dashboard never served unselected), so it is a resume-UX gap, not a data-safety one. Security F-4 (funnel events) was FIXED in-repo by the QA worker (428/428). Contract matches 073c exactly. Fix cycle dispatched: C-1 (tokenless mount probes /setup/state + /setup/tenancy and enters the tenancy phase directly) + the honeycomb reconciliation (drop dead `autoSelected`, add `confirmedBy`) + warnings W-1/W-2/W-3 + trivial suggestions. WILL BE RE-AUDITED (Critical). Report: hive/.../prd-011-.../qa/2026-07-04-qa-report-prd-011-onboarding-tenancy.md.

- honeycomb: PASS WITH WARNINGS (2026-07-04 19:33), later fully closed at 4186 tests after the warning-fix cycle (dead `autoSelected` removed, 073d-AC-1.2 + TTL-expiry tests added); independently re-verified `npm run ci` green, home canary clean. SHIP-READY. All index AC-1..10 + 073a/b/c/d sub-ACs traced to AC-named passing tests; security Low-1 workspace-create guard applied with its test; orchestrator independently re-ran `npm run ci` exit 0 (4184 passed, SQL audit OK, home canary clean). 3 Warnings dispatched to a fix cycle: (1) dead `autoSelected` contract field -> REMOVE fleet-wide (honeycomb + doc now, hive mirror to follow), (2) missing 073d-AC-1.2 test, (3) untested pending-link TTL branch. Report: honeycomb/.../prd-073-.../qa/2026-07-04-qa-report-prd-073-dormant-capture-tenancy.md.

**W2 security results:**
- honeycomb: CLEAN (2026-07-04 19:17). No Critical/High; zero code changes. Token discipline holds end to end (header-only, never body/log/URL); local-mode 404 self-gate on every new route; pending window single-slot + TTL + cleared-on-select; select validates strictly against enumerated lists; grandfather not forgeable via empty orgId; fail-open on the capture-gate seam verified NOT attacker-inducible. 3 Lows documented: (1) workspace-create route lacks the same org-enumeration guard select has (one-line defense-in-depth; hand to the quality-fix cycle as a trivial add), (2) pre-existing non-atomic credential write (future hardening PRD), (3) documented fail-open (verified safe). `npm run ci` green. Report: honeycomb/library/qa/security/2026-07-04-security-audit-prd-073-dormant-capture-tenancy.md. Ready for quality.

- hive: CLEAN (2026-07-04 19:21). No Critical/High; zero code changes. XSS-safe (remote org/workspace names render as React text; no dangerouslySetInnerHTML/eval), gate redirects are fixed literals that fail closed and cannot loop, BFF leg unwidened with no token in bodies, telemetry carries only bucketed counts (stricter than posture). Findings: F-1 Medium (CSRF posture on the two new tenancy POSTs, SAME systemic pre-existing item as PRD-010 F-4, now filed as honeycomb#231 for a dedicated hardening change, NOT this branch); F-2/F-3 Low documented (fault-mode reload resilience; workspace-name upper length bound belongs in honeycomb's zod first); F-4 Info FUNCTIONAL GAP for quality: the daemon's closed funnel-event schema rejects `tenancy_shown`/`tenancy_selected`/`workspace_created` (400, swallowed), so ts-AC-13's events never land. Gates green (typecheck, 423/423). Report: hive/library/qa/security/2026-07-04-security-audit-prd-011-onboarding-tenancy.md. Ready for quality.

**Carried into the W2 quality-fix cycle (medium+ bar + AC-invalidating):**
- hive F-4 (AC-invalidating): register the three tenancy funnel events in the daemon's onboarding-event schema so ts-AC-13 actually fires; without this the AC is only nominally met.
- honeycomb sec-Low-1 (trivial defense-in-depth): add the org-against-enumeration guard to the workspace-create route matching `select`.
- Deferred to honeycomb#231 (NOT this run, systemic, below the block bar): the BFF/daemon Origin CSRF check.

## AC ledger (all OPEN at run start; sub-PRD AC text lives in the source PRDs)

| PRD | ACs | Owner | Status |
|---|---|---|---|
| honeycomb 073 index | module AC-1..AC-10 (incl. the dogfood path) | W1-H | DONE (2026-07-04 19:07: implementation + the grandfathered-`selected` reconciliation fix complete. `selected` now mirrors the one effective-confirmation predicate the capture gate consumes (`resolveTenancyConfirmation`), with additive `confirmedBy: "selection"|"grandfathered"`, a capture-gate-agreement test, and the canonical 073c doc updated. Orchestrator independently re-ran `npm run ci` exit 0 twice (4183 passed / 12 skipped, SQL audit OK), home canary clean. Workspace creation: SUPPORTED per Deeplake OpenAPI docs, canCreate:true + create route shipped. 073b's /api/status mention correctly surfaced on /health + /api/diagnostics/health (server.ts is a do-not-edit seam). Code-side dogfood ACs remain for W4.) |
| honeycomb 073a | AC-073a.* | W1-H | DONE (capture-bound-project-gate tests; separate opt-in boundProjectGate keeps all 059a tests green) |
| honeycomb 073b | AC-073b.* | W1-H | DONE (health-dormancy, capture-gated-reason, session-bind-notice tests; reason-partitioned gated counter) |
| honeycomb 073c | AC-073c.* | W1-H | DONE (tenancy-selection + setup-tenancy tests incl. the grandfathered-agreement case; canonical contract doc carries the effective-confirmation rule) |
| honeycomb 073d | AC-073d.* | W1-H | DONE (auth-tenancy tests: TTY prompt, non-TTY refusal + flags, auto-select/pin surfacing) |
| hive 011 index | module checklist (incl. the dogfood path) | W1-V | DONE (2026-07-04 18:48: worker per-AC report; orchestrator independently re-ran typecheck exit 0 + 60 files / 423 tests green, home canary clean. Code-side dogfood ACs remain for W4.) |
| hive 011a | ts-AC-1..13 | W1-V | DONE (tenancy-step/login-step-tenancy/tenancy-step tests; frozen zod contracts in tenancy-contracts.ts mirroring 073c) |
| hive 011b | tv-AC-1..8 | W1-V | DONE (ActiveTenancyDisplay in shell chrome; nectar panel tenancy line; lenient OPTIONAL tenancy fields added to NectarProjectsBodyWire, a forward hook nectar may serve later, absent = fleet-credential fallback) |
| hive 011c | tg-AC-1..10 | W1-V | DONE (gate precedence health -> auth -> tenancy; fixed redirect literals; injectable setupTenancyFetch seam; buzzing/fleet-readiness untouched) |
| DOGFOOD | both PRDs' numbered fresh-install protocols | W4 (user-gated) | OPEN |

## W3 SHIPPED + RELEASED (2026-07-04 20:30)

- Both PRs merged (honeycomb#232, hive#13; CI green on the merits per the ci-watcher; the lone honeycomb Aikido red is the re-keyed false-positive tracked as honeycomb#231, CodeQL + audit:sql clean).
- Fleet release 0.5.0 cut: honeycomb 0.4.0 + hive 0.5.0 published to npm; doctor 0.3.0 + nectar 0.2.0 unchanged. Superproject manifest 0.5.0, PR#10 merged, tag v0.5.0 pushed; Manifest Validate + Release Train + install-site deploy all SUCCESS. get.theapiary.sh now serves the tenancy-activation fleet.

## W4 DOGFOOD (staged, user-gated, in progress)

- Backups: ~/.dogfood-backup-20260704-202824-.deeplake and -.honeycomb (recoverable). .apiary/.nectar were absent.
- Fleet task HivenectarDaemon stopped + disabled.
- apiary_ci baseline for the zero-writes-before-bind proof: hive_graph=13, hive_graph_versions=17.
- PAUSED before the irreversible wipe+install, awaiting the user's go + the apiary-ci browser device login. Protocol: wipe the 4 dirs -> get.theapiary.sh -> device approve -> verify the tenancy step BLOCKS the dashboard + lists orgs/workspaces -> pick apiary-ci/apiary_ci -> verify counts still 13/17 (no write before bind) + header shows tenancy + honeycomb dormant until a folder is bound -> bind -> verify writes land only in apiary_ci -> restore backup or keep the fresh apiary-ci login.
