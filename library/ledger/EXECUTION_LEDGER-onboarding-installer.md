# Execution Ledger: Onboarding Installer Run (PRD-009 + PRD-001 remnants + PRD-002)

Single source of truth for the `/the-smoker` run over **hive PRD-009 (onboarding installer)**, weaving in **hive PRD-001** open items and **hive PRD-002 (portal readiness splash)**. Status legend: OPEN / IN PROGRESS / DONE / VERIFIED / BLOCKED.

**Branches:**
- hive: `feature/prd-009-onboarding-installer`
- honeycomb: `feature/move-install-surface-to-apiary`
- the-apiary: `feature/install-surface-and-fleet-onboarding`

**User decisions (locked, 2026-07-03):**
1. Hero animation: staggered entrances anchored by the Hive mark (product logos rise/fade in one by one on a spring curve, Hive mark settles center last, buttons fade in after).
2. Advanced picker: product cards with checkboxes, logo + one-line purpose each, "Recommended" badge on Doctor, warning note if Doctor is deselected.
3. Benefit copy: drafted by the run from each product's README voice (headline + two supporting lines), user edits after.
4. Manifest cadence: fetch once at onboarding start, build-time bundled snapshot fallback, no background timer.
5. PRD-001 m-AC-5: verify NOW on the evidence of the shipped ci.yaml + release.yaml and the 0.2.1 publish.
6. PRD-004 dependency (doctor `daemons[]`): treat as landed; Wave 0 verifies the contract shape against doctor source.
7. Install surface (site/install + scripts/install) MOVES from the honeycomb repo into the-apiary superproject; the deploy workflow builds from local superproject source; honeycomb drops its copy. PRD-009d implements against the moved location.

**Baseline (2026-07-03):** hive `npm run typecheck` clean; `npm test` 33 files / 244 tests green. PRD-009 folder moved `backlog/` -> `in-work/` in hive.

---

## Wave 0: contract verification (main thread)

| ID | Source | Criterion | Owner | Status | Evidence |
|---|---|---|---|---|---|
| W0-1 | nectar PRD-004b / hive PRD-002 dep | Doctor `/status.json` serves `daemons[]` of `{name, health, escalation}` matching the PRD-002 contract | orchestrator | VERIFIED | `doctor/src/status-page/server.ts:45-56` `StatusJsonDaemon {name, health, escalation: NeedsAttentionFile\|null}`, `StatusJson.daemons`; wired in `compose/index.ts` |
| W0-2 | hive PRD-001 m-AC-5 | Independent release train: hive-only deploy surface | orchestrator | VERIFIED | `hive/.github/workflows/{ci.yaml,release.yaml}` exist; `@legioncodeinc/hive@0.2.0` and `0.2.1` published today via release.yaml (OIDC provenance), runs 28673803613 / 28674152844 both success; no other repo released to ship it |

## PRD-002 audit map (implemented-as-evolved; Wave 0/2 verification)

PRD-002's `ReadinessSplash` client wrapper was superseded by the shipped server-side gate (`src/daemon/gate.ts`) + `/buzzing` screen (`src/dashboard/web/buzzing-screen.tsx`); `main.tsx` documents the retirement. Intent-level ACs verify against the current architecture; letter-level ACs that name the retired component are marked SUPERSEDED with the equivalent evidence.

| ID | Source | Criterion (abridged) | Owner | Status | Evidence |
|---|---|---|---|---|---|
| fs-AC-1 | prd-002a | `GET /api/fleet-status` proxies doctor status.json server-side | wave-2B | VERIFIED (ac-verification-map-2026-07-03.md) |
| fs-AC-2 | prd-002a | doctor origin hard-coded loopback | wave-2B | VERIFIED (ac-verification-map-2026-07-03.md) |
| fs-AC-3 | prd-002a | doctor down -> `{supervisor:"unreachable",daemons:[]}` 200 | wave-2B | VERIFIED (ac-verification-map-2026-07-03.md) |
| fs-AC-4 | prd-002a | malformed body -> fail-soft, no throw | wave-2B | VERIFIED (ac-verification-map-2026-07-03.md) |
| fs-AC-5 | prd-002a | reachable pass-through `{supervisor:"reachable",health,daemons,asOf}` | wave-2B | VERIFIED (ac-verification-map-2026-07-03.md) |
| fs-AC-6 | prd-002a | `isFleetReady()` single shared rule | wave-2B | VERIFIED (ac-verification-map-2026-07-03.md) |
| fs-AC-7 | prd-002a | `degraded` never ready | wave-2B | VERIFIED (ac-verification-map-2026-07-03.md) |
| fs-AC-8 | prd-002a | required peer missing from `daemons[]` -> not ready | wave-2B | VERIFIED (ac-verification-map-2026-07-03.md) |
| fs-AC-9 | prd-002a | fetch target validated `isLoopbackBaseUrl()` | wave-2B | VERIFIED (ac-verification-map-2026-07-03.md) |
| fs-AC-10 | prd-002a | no upstream error detail leaks to client body | wave-2B | VERIFIED (ac-verification-map-2026-07-03.md) |
| rs-AC-1..3 | prd-002b | splash renders before SetupGate / setup-state poll | wave-2 verifier | VERIFIED or SUPERSEDED per ac-verification-map-2026-07-03.md |
| rs-AC-4 | prd-002b | poll interval 1000-2000ms | wave-2 verifier | VERIFIED or SUPERSEDED per ac-verification-map-2026-07-03.md |
| rs-AC-5 | prd-002b | per-daemon grid with mapped states | wave-2 verifier | VERIFIED or SUPERSEDED per ac-verification-map-2026-07-03.md |
| rs-AC-6 | prd-002b | supervisor-unreachable distinct state | wave-2 verifier | VERIFIED or SUPERSEDED per ac-verification-map-2026-07-03.md |
| rs-AC-7 | prd-002b | ready -> dismiss, polling stops | wave-2 verifier | VERIFIED or SUPERSEDED per ac-verification-map-2026-07-03.md |
| rs-AC-8 | prd-002b | fresh install reaches GuidedSetup once fleet ok | wave-2 verifier | VERIFIED or SUPERSEDED per ac-verification-map-2026-07-03.md |
| rs-AC-9 | prd-002b | post-mount flap does not unmount session | wave-2 verifier | VERIFIED or SUPERSEDED per ac-verification-map-2026-07-03.md |
| ac-AC-1..8 | prd-002c | consolidated acceptance table | wave-2 verifier | VERIFIED (map: 19 VERIFIED / 16 SUPERSEDED / 0 OPEN) |
| P1-W1 | PRD-001 QA Warning 1 | daemonUp gate per-daemon | wave-2B | DONE (route-daemon-owner.ts + app.tsx per-owner gate, shell-connectivity-gate.test.tsx) | `hive/src/dashboard/web/app.tsx` |
| P1-S1 | PRD-001 QA Suggestion 1 | stale honeycomb CONVENTIONS.md seam reference | wave-1C | DONE (replaced with pointer to hive dashboard host) |
| P1-S2 | PRD-001 QA Suggestion 2 | two-daemon isolation tests | wave-2B | DONE (fail-soft.test.ts + shell-connectivity-gate.test.tsx) | nectar-owned hive-graph page shipped (nectar PRD-015); test now actionable |

## PRD-009 index module ACs (verified at close-out from sub-ACs)

| ID | Criterion (abridged) | Status |
|---|---|---|
| m-1 (DONE via bs-AC-1..8 DONE) | bootstrap installs only hive pinned, opens browser, prints exact fallback line, zero prompts | DONE (roll-up; VERIFIED at close-out) |
| m-2 (DONE via is-AC-1/2 + ob-AC-1/2/3 DONE) | `/onboarding` gate-exempt, detects fleet pre-doctor, short-circuits when healthy | DONE (roll-up; VERIFIED at close-out) |
| m-3 (DONE via ob-AC-4/5 DONE) | hero animates brand SVGs, exactly two verbatim buttons | DONE (roll-up; VERIFIED at close-out) |
| m-4 (DONE via ob-AC-8..11 DONE) | cards: ~30s min dwell, staged progress, no percent bar, provenance copy | DONE (roll-up; VERIFIED at close-out) |
| m-5 (DONE via is-AC-3..10 DONE) | allowlist + server-side version resolution + Origin/Host + token + argv npm | DONE (roll-up; VERIFIED at close-out) |
| m-6 (DONE via is-AC-11..14 DONE) | SSE progress per telemetry-proxy pattern; per-product registration verbs | DONE (roll-up; VERIFIED at close-out) |
| m-7 (DONE via ob-AC-13..15 DONE) | health check -> device-code display -> dashboard | DONE (roll-up; VERIFIED at close-out) |
| m-8 (DONE via tm-AC-1..6 DONE) | full funnel event list, fleet telemetry posture | DONE (roll-up; VERIFIED at close-out) |
| m-9 (DONE via is-AC-15..17 + ob-AC-12/16/17 DONE) | failure honesty + resumability, no re-run of completed installs | DONE (roll-up; VERIFIED at close-out) |

## PRD-009a: installer service and security (Wave 1A, hive daemon)

| ID | Criterion (abridged) | Owner | Status |
|---|---|---|---|
| is-AC-1 | detection works pre-doctor; hive-only fresh machine reported correctly | wave-1A | DONE (45/45 installer tests pass, orchestrator re-ran) |
| is-AC-2 | closed per-product state set + version, from local evidence | wave-1A | DONE (45/45 installer tests pass, orchestrator re-ran) |
| is-AC-3 | non-allowlisted slug -> 4xx, no spawn | wave-1A | DONE (45/45 installer tests pass, orchestrator re-ran) |
| is-AC-4 | `packageName@version` resolved server-side from hive-release.json only | wave-1A | DONE (45/45 installer tests pass, orchestrator re-ran) |
| is-AC-5 | `published:false` or unresolvable manifest -> refuse, never `@latest` | wave-1A | DONE (45/45 installer tests pass, orchestrator re-ran) |
| is-AC-6 | argv-array spawn, shell disabled, no request data in command | wave-1A | DONE (45/45 installer tests pass, orchestrator re-ran) |
| is-AC-7 | Origin validation (403; missing Origin on non-GET rejected) | wave-1A | DONE (45/45 installer tests pass, orchestrator re-ran) |
| is-AC-8 | Host validation (DNS-rebinding defense) | wave-1A | DONE (45/45 installer tests pass, orchestrator re-ran) |
| is-AC-9 | one-time token required (401), constant-time compare, single-session | wave-1A | DONE (45/45 installer tests pass, orchestrator re-ran) |
| is-AC-10 | token invalidated at completion; state-changing endpoints refuse after | wave-1A | DONE (45/45 installer tests pass, orchestrator re-ran) |
| is-AC-11 | SSE progress, telemetry-proxy relay discipline, closed stage set | wave-1A | DONE (45/45 installer tests pass, orchestrator re-ran) |
| is-AC-12 | no fabricated percentages; stages from observable signals | wave-1A | DONE (45/45 installer tests pass, orchestrator re-ran) |
| is-AC-13 | per-product registration verbs; registration failure = install failed | wave-1A | DONE (45/45 installer tests pass, orchestrator re-ran) |
| is-AC-14 | install survives SSE disconnect; re-subscribe gets current stage | wave-1A | DONE (45/45 installer tests pass, orchestrator re-ran) |
| is-AC-15 | already-installed at pinned version -> short-circuit completed | wave-1A | DONE (45/45 installer tests pass, orchestrator re-ran) |
| is-AC-16 | concurrent duplicate requests -> one child process | wave-1A | DONE (45/45 installer tests pass, orchestrator re-ran) |
| is-AC-17 | failure carries stage + truthful bounded error; retry permitted | wave-1A | DONE (45/45 installer tests pass, orchestrator re-ran) |
| is-AC-18 | health check reuses fetchFleetStatus/isFleetReady | wave-1A | DONE (45/45 installer tests pass, orchestrator re-ran) |
| is-AC-19 | login via existing proxied /setup/login + /setup/state; no credential in hive | wave-1A | DONE (45/45 installer tests pass, orchestrator re-ran) |

## PRD-009b: onboarding route and guided flow (Wave 1B, hive UI)

| ID | Criterion (abridged) | Owner | Status |
|---|---|---|---|
| ob-AC-1 | `/onboarding` renders pre-health/pre-auth (gate-exempt) | wave-1B | DONE (316/316 integrated tests pass, orchestrator re-ran) |
| ob-AC-2 | UI reflects daemon detection, never assumes client-side | wave-1B | DONE (316/316 integrated tests pass, orchestrator re-ran) |
| ob-AC-3 | fully-installed healthy machine short-circuits to dashboard | wave-1B | DONE (316/316 integrated tests pass, orchestrator re-ran) |
| ob-AC-4 | hero: animated brand-SVG entrance (staggered, Hive-mark anchored per decision 1) | wave-1B | DONE (316/316 integrated tests pass, orchestrator re-ran) |
| ob-AC-5 | exactly two buttons, verbatim copy | wave-1B | DONE (316/316 integrated tests pass, orchestrator re-ran) |
| ob-AC-6 | Standard installs Doctor, Honeycomb, Nectar in fixed order, no questions | wave-1B | DONE (316/316 integrated tests pass, orchestrator re-ran) |
| ob-AC-7 | Advanced: card-checkbox picker (decision 2) -> same guided flow | wave-1B | DONE (316/316 integrated tests pass, orchestrator re-ran) |
| ob-AC-8 | full-screen card: logo, title, benefit copy (decision 3) | wave-1B | DONE (316/316 integrated tests pass, orchestrator re-ran) |
| ob-AC-9 | staged progress rendering, never a percentage bar | wave-1B | DONE (316/316 integrated tests pass, orchestrator re-ran) |
| ob-AC-10 | npm-safety copy (signed + provenance-verified, checkably true) | wave-1B | DONE (316/316 integrated tests pass, orchestrator re-ran) |
| ob-AC-11 | ~30s minimum dwell; failure may surface early | wave-1B | DONE (316/316 integrated tests pass, orchestrator re-ran) |
| ob-AC-12 | failure shows truthful error + retry, never fake success | wave-1B | DONE (316/316 integrated tests pass, orchestrator re-ran) |
| ob-AC-13 | green-light per-daemon health view; advances only when ready | wave-1B | DONE (316/316 integrated tests pass, orchestrator re-ran) |
| ob-AC-14 | device-code (`user_code`) + verification link displayed, hard requirement | wave-1B | DONE (316/316 integrated tests pass, orchestrator re-ran) |
| ob-AC-15 | login completion -> hard navigation to `/` | wave-1B | DONE (316/316 integrated tests pass, orchestrator re-ran) |
| ob-AC-16 | re-entry reconstructs true state; resumes from first incomplete step | wave-1B | DONE (316/316 integrated tests pass, orchestrator re-ran) |
| ob-AC-17 | mid-install refresh re-attaches to stream, no duplicate install | wave-1B | DONE (316/316 integrated tests pass, orchestrator re-ran) |

## PRD-009c: onboarding telemetry (Wave 2A, hive daemon)

| ID | Criterion (abridged) | Owner | Status |
|---|---|---|---|
| tm-AC-1 | full funnel event list at correct transitions | wave-2A | DONE (funnel-telemetry.test.ts, 345/345 per 2A) |
| tm-AC-2 | retry may re-emit product pair; session milestones once each | wave-2A | DONE (funnel-telemetry.test.ts, 345/345 per 2A) |
| tm-AC-3 | single daemon-side chokepoint (src/telemetry/emit.ts discipline) | wave-2A | DONE (funnel-telemetry.test.ts, 345/345 per 2A) |
| tm-AC-4 | closed property allow-list; anonymous distinct_id | wave-2A | DONE (funnel-telemetry.test.ts, 345/345 per 2A) |
| tm-AC-5 | token never in any event/property/log | wave-2A | DONE (funnel-telemetry.test.ts, 345/345 per 2A) |
| tm-AC-6 | human vs headless paths distinguishable, shared install id | wave-2A | DONE (funnel-telemetry.test.ts, 345/345 per 2A) |

## PRD-009d: thin bootstrap (Wave 1C, the-apiary after the move)

| ID | Criterion (abridged) | Owner | Status |
|---|---|---|---|
| MV-1 | (user decision 7) `site/install/` + `scripts/install/` move honeycomb -> the-apiary; deploy-install-site.yaml builds from superproject source; honeycomb copy removed on its branch | wave-1C | DONE (site/install + scripts/install created at root, workflow builds local source, honeycomb `git rm` + doc updates, build.mjs emits full dist, honeycomb typecheck passes) |
| MV-2 | NEW (orchestrator finding): raw.githubusercontent manifest URL returns 404 (repo not public); portal path fails hard on it by design, so the manifest must be published via the install site (build.mjs copies hive-release.json into dist; install.sh, install.ps1, and the hive daemon installer default to https://get.theapiary.sh/hive-release.json) | wave-2C | DONE (site serves dist/hive-release.json byte-identical + _headers; both scripts default to get.theapiary.sh with one-shot GitHub fallback; hive daemon repointed by 2A; NOTE: gap closes in production at the first tag deploy) |
| bs-AC-1 | human path: Node, hive-only pinned install, daemon start, browser open, fallback line | wave-1C | DONE (blocked at runtime by MV-2 until manifest is reachable; dry-run verified) |
| bs-AC-2 | no stdin read / prompt anywhere on the piped human path | wave-1C | DONE |
| bs-AC-3 | exact fallback line printed (clean URL; token only in opened URL) | wave-1C | DONE (verified verbatim in both dialects) |
| bs-AC-4 | browser-open failure still prints line + exit 0 | wave-1C | DONE |
| bs-AC-5 | token minted, handed via `~/.honeycomb/hive/` file mode 0600, embedded in URL | wave-1C | DONE |
| bs-AC-6 | token never echoed/logged/telemetered | wave-1C | DONE |
| bs-AC-7 | flag/env/config selection path preserved byte-for-byte behavior | wave-1C | DONE (orchestrator verified: bare dry-run routes portal, --products= dry-run routes legacy) |
| bs-AC-8 | install.ps1 mirrors the human-path contract | wave-1C | DONE (Windows PowerShell parse check; pwsh unavailable) |

## Wave plan

| Wave | Worker (Bee) | Model | Scope + boundaries | Exit criteria |
|---|---|---|---|---|
| 0 | orchestrator | n/a | W0-1, W0-2 contract/evidence verification | both VERIFIED (done) |
| 1A | typescript-node-worker-bee | claude-opus-4-8-thinking-high-fast (deep multi-file daemon work, security-critical; matrix rule 2) | hive daemon: is-AC-1..19. Owns `src/daemon/installer/**` (new), edits `src/daemon/server.ts`, `src/daemon/gate.ts`, `src/cli-commands.ts` if needed; tests under `tests/daemon/installer/` | typecheck + tests green, all is-ACs implemented with tests |
| 1B | react-worker-bee | claude-sonnet-5-thinking-high (balanced, strong instruction-following for verbatim copy + presentation; matrix rule 4) | hive UI: ob-AC-1..17. Owns `src/dashboard/web/onboarding/**` (new), route registration in the SPA, brand asset wiring; does NOT edit gate.ts/server.ts (1A owns) | typecheck + tests green, all ob-ACs implemented with tests |
| 1C | devops-worker-bee | gpt-5.3-codex-high-fast (shell/CI/release specialist; matrix rule 7) | MV-1 + bs-AC-1..8 + P1-S1. the-apiary: new `site/install/`, `scripts/install/`, workflow update. honeycomb branch: remove moved trees, fix stale references incl. CONVENTIONS.md | shellcheck-clean scripts, workflow builds locally via `node site/install/build.mjs`, honeycomb typecheck/test unaffected |
| 2A | typescript-node-worker-bee | composer-2.5-fast (tight-loop TS on established seams; matrix rule 1) | tm-AC-1..6 on top of 1A's state transitions | typecheck + tests green |
| 2B | react-worker-bee | composer-2.5-fast (scoped fixes; matrix rule 1) | P1-W1 per-daemon gate fix, P1-S2 isolation test, PRD-002 fs/rs/ac verification map + gap closure + supersession notes | tests proving each fs/rs AC or documented supersession |
| close-out 1 | security-worker-bee | gpt-5.5-medium-fast (broad audit, highest hallucination resistance; matrix rule 3) | full-branch security audit, remediate Critical/High/Medium | clean at medium+ |
| close-out 2 | quality-worker-bee | claude-sonnet-5-thinking-high (verification against plan docs) | QA vs PRD-009/001/002 + this ledger | PASS at medium+ |
| ship | orchestrator | n/a | commit, push, PRs (hive, the-apiary, honeycomb), CI watch | PRs open, CI green |

## Log

- 2026-07-03: Ledger initialized. Wave 0 verified (W0-1, W0-2). PRD-009 moved to in-work. Branches created. Baseline green (hive: 244 tests).
- 2026-07-03: Wave 1C complete (bootstrap + install-surface move). Orchestrator verified dry-run routing seams and verbatim fallback line. Finding MV-2 logged: raw.githubusercontent manifest URL 404s (private repo); integration wave must serve hive-release.json from get.theapiary.sh and repoint defaults in install.sh, install.ps1, and hive src/daemon/installer/manifest.ts.
- 2026-07-03: Wave 2C complete (manifest served by install site, script defaults repointed, fallback demoted). Wave 2 CLOSED: zero OPEN implementation rows. Entering close-out: security first, then quality.
- 2026-07-03: Wave 2B complete (P1-W1 per-owner gate, P1-S2 isolation tests, PRD-002 verification map 19 VERIFIED / 16 SUPERSEDED / 0 OPEN, 409 refusal copy). Orchestrator re-verified integrated hive tree after 2A+2B: typecheck clean, 346/346 tests.
- 2026-07-03: Wave 2A complete (telemetry funnel). All nine events emit daemon-side through the emit.ts chokepoint; session dedupe via token-hash ledger; MV-2 hive side done (primary get.theapiary.sh, GitHub fallback, snapshot last). 29 new tests. Orchestrator will re-verify the full suite after 2B lands (2B edits hive concurrently).
- 2026-07-03: Wave 1B complete (onboarding UI). Integrated tree green: typecheck clean, 316/316 tests (orchestrator re-ran). 1B OPEN item 1 (SSE event name) resolved by inspection: daemon emits default unnamed data frames, matching the client. Remaining integration: MV-2 manifest repoint (hive config.ts MANIFEST_URL + apiary install scripts + site build), 409 refusal-specific UI message (1B OPEN item 3), resume-subset heuristic accepted as documented behavior (no server-side memory of the Advanced subset by design).
- 2026-07-03: Wave 1A complete (installer service). Orchestrator re-ran tests/daemon/installer/: 45/45 pass. Integration items for Wave 2: (a) reconcile 1B's local onboarding contracts to src/shared/onboarding-types.ts (1B carries a literal-type bug in contracts.ts per 1A's report), (b) tests/dashboard/copy-map.test.ts file-count expectation vs new onboarding files, (c) MV-2 manifest URL repoint in manifest.ts.

## Close-out: security (2026-07-03)

- security-worker-bee audited all three repos. Result: 0 Critical, 1 High (FIXED), 1 Medium (deferred with rationale).
- HIGH (FIXED): hive src/daemon/installer/security.ts accepted `?t=<token>` on every guarded route, widening token exposure for state-changing APIs. Restricted query-token acceptance to the SSE route (GET /api/onboarding/install/:product/events) only; header token required elsewhere. Regression test added. Full suite re-run: 347/347 green.
- MEDIUM (DEFERRED, not remediated, rationale): the LEGACY flagged install path in scripts/install/install.sh + install.ps1 can still fall back to <package>@latest when the manifest is unresolved. This is PRE-EXISTING behavior that PRD-009 explicitly preserves (bs-AC-7 "flag/env/config selection path preserved byte-for-byte") and lists as a NON-GOAL ("No changes to CI/headless flag installs"). The NEW zero-question portal path fails closed correctly (never @latest). Remediating the legacy fallback would violate bs-AC-7 and the stated non-goal, and the resilience tradeoff (admin installs surviving a transient manifest outage) was a deliberate original choice. Surfaced to the user for a separate pinning-policy decision rather than churned inside this scope.

## Close-out: quality (2026-07-03)

- quality-worker-bee independently verified against all four PRD-009 sub-plans, PRD-001 close-out items, and a 10-row sample of the PRD-002 verification map. Verdict: PASS with Warnings (0 Critical, 2 Warnings, 3 Suggestions). Report: hive/library/requirements/in-work/prd-009-onboarding-installer/qa/qa-report-prd-009-onboarding-installer.md.
- Warning 1 (Advanced resume could silently reinstall a deselected product) REMEDIATED by orchestrator: onboarding-selection-store.ts persists the chosen subset in sessionStorage; contracts.ts buildResumeQueue intersects remaining products with the persisted selection (falls back to only mid-flight/failed products when intent is unknown); onboarding-screen wires persist on mode/advanced choice and clear on terminal state. New test: tests/dashboard/onboarding/resume-subset.test.tsx (4 cases). 
- Warning 2 (stale doc claiming hive awaits first npm publish) REMEDIATED: hive/library/knowledge/private/infrastructure/release-train-and-manifest.md now states hive is published (0.2.1, published:true).
- Suggestions (honeycomb production-ready doc framing outside sub-PRD scope; contracts.ts type duplication as documented interim; stale path comments in honeycomb src/commands/install.ts) accepted as non-blocking, left for a follow-up.
- Final hive verification: typecheck clean, 351/351 tests (52 suites). Ledger fully VERIFIED. Shippable.
