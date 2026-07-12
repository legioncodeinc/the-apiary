# QA Report — Fleet Fix Plan, Wave 3 (Reliability class fixes)

- **Date:** 2026-07-12
- **Auditor:** quality-worker-bee (quality-stinger)
- **Source plan:** `C:\Users\mario\.claude\plans\sprightly-percolating-lake.md` — "Wave 3 — Reliability class fixes", items 1–12, plus the hive model-required companion (item 5)
- **Audit method:** diff-by-refs only (no branch switches; honeycomb main checkout untouched)
- **Audit ranges:**
  - honeycomb #300 (MERGED, squash `d9fa41d`): `9bf4ce7..d9fa41d`
  - honeycomb #301 (MERGED, squash `27e34de`; branch `fix/embed-liveness` tip `dbb2703` is tree-identical to `origin/main` — the squash includes the Aikido queued-cap fix): `d9fa41d..27e34de`
  - honeycomb #304 (OPEN, branch `fix/live-config-reload` tip `2bde8d7`): `origin/main...origin/fix/live-config-reload`
  - hive #26 (MERGED, merge `7daf349`): `4c9dc29..7daf349`
- **Ordering:** `security-worker-bee` completed the Wave-3 audit first (PASS, 0 Critical/High). Post-audit fixes M-304-1 and the Aikido appliedLive finding (both on #304) and the Aikido queued-cap finding (on #301) were verified landed in this pass. Ordering contract respected.

## 1. Summary

Wave 3 is delivered and correct on the honeycomb daemon side: all twelve plan items trace to code with strong, behavior-pinning test coverage, and all three post-security-audit fixes are verified in place with dedicated regression tests. The cross-PR composition risk (#301 vs #304, both touching `assemble.ts`/health) is already resolved — #301 merged to main first and #304 merged main into its branch (`2bde8d7`) with green CI, so #304 merges cleanly next with no conflict work remaining. Verdict: **PASS with 3 Warnings**, all on the hive consumer side — the hive dashboard renders none of the new health surface (plan item 4's hive half, explicitly deferred by the #300 Bee, remains open), its zod catch folds the daemon's new `suspect` and `no_model` states to *healthy-looking* values, and its memory-toggle UI still tells users to restart after #304 makes the toggle live.

## 2. Scorecard

| Axis | Status | Notes |
|---|---|---|
| Completeness | PASS (1 open item) | 12/12 daemon items + hive companion delivered; plan item 4's "hive HealthStrip" half not delivered (known deferral — see W-1) |
| Correctness | PASS | All five focal behaviors are asserted by tests: no_model fail-closed matrix, wedge→respawn→warming cycle, queued-only capacity boundary (EMBED_QUEUE_MAX + 1), persist-honesty ack matrix, reload serialization interleaving |
| Alignment | PASS | One justified deviation: `appliesOnRestart` kept in the memory-toggle ack as `false` (wire back-compat) rather than removed outright (see Traceability item 10) |
| Gaps | 3 Warnings | All hive-side consumer gaps (W-1..W-3); no daemon-side gaps found |
| Detrimental patterns | PASS | Fail-closed/fail-soft postures consistent; error strings capped (200 chars) and key-free; counters bounded; timers unref'd; no secret in any new wire field |

## 3. Critical issues (must fix)

None.

## 4. Warnings (should fix)

### W-1 — Plan item 4's hive half is undelivered: no hive surface renders the new #300 health fields (open plan item)

Plan item 4 reads "`extractionErrorsSinceBoot` counter beside `committedSinceBoot` in health **+ hive HealthStrip**". The daemon half is complete; the hive half is absent:

- `hive/src/dashboard/web/wire.ts` — `HealthReasonsSchema` (lines ~1153–1181) parses no `memoryFormation` block at all; `extractionErrorsSinceBoot`, `lastExtractionError`, and `committedSinceBoot` are dropped at the wire boundary. A repo-wide grep of hive `src/` finds zero references.
- `hive/src/dashboard/web/wire.ts:1180` — `portkey: z.enum(["off", "ok", "unconfigured", "unreachable"]).catch("off")`: the daemon's new `no_model` state (plan item 2) folds to `"off"` — a misconfigured gateway (enabled, no model) renders in hive as "Portkey not in force", which is exactly the false-healthy reading ISS-005 set out to kill. `portkeyUnreachableStatus` (plan item 3) is likewise never parsed or shown.

The #300 Bee explicitly deferred this as a follow-up; per invoker instructions this is flagged as an **open plan item**, not fixed here. Remediation: a hive PR adding `memoryFormation` (with `extractionErrorsSinceBoot`/`lastExtractionError`) to `HealthReasonsSchema` + a HealthStrip cell, extending the portkey enum with `"no_model"` (degraded rendering), and surfacing `portkeyUnreachableStatus` beside `unreachable`.

### W-2 — hive parses the daemon's new `suspect` state as healthy `"on"`; the honeycomb JSDoc's claim about hive's `.catch` behavior is wrong

After #301 the daemon's **coarse** `reasons.embeddings` field carries the full enum (`off|warming|on|suspect|failed`) and `embeddingsState` gains `suspect`. On the hive side:

- `hive/src/dashboard/web/wire.ts:1156` — `embeddings: z.enum(["on", "off"]).catch("on")`: an unknown coarse value (`suspect`, `warming`, `failed` when `embeddingsState` also fails to parse) catches to **`"on"`** — the healthiest possible reading.
- `hive/src/dashboard/web/wire.ts:1161` — `embeddingsState: z.enum(["off", "warming", "on", "failed"]).optional().catch(undefined)`: `suspect` is not in the enum → `undefined`.
- `hive/src/dashboard/web/pages/dashboard.tsx:117` — `degraded: (r) => (r.embeddingsState ?? r.embeddings) !== "on"`: with `embeddingsState` undefined and coarse caught to `"on"`, a daemon reporting `suspect` renders as **healthy** in the HealthStrip — precisely during the wedge-suspicion window.

The window is short (`livenessRetryMs` default 1s before the wedge is confirmed and the state becomes `warming` via respawn, which hive does parse), so impact is bounded — but the honeycomb documentation makes a false claim about this consumer: `honeycomb/src/daemon/runtime/health.ts` (ISS-008 JSDoc on `HealthReasons.embeddings`, post-#301) states hive's "zod `.catch` folds unknown coarse values back to the legacy reading rather than erroring" — the actual catch value is `"on"`, not a legacy-honest reading. Remediation: add `"suspect"` to both hive enums and change the coarse catch to a non-healthy fallback (or fix the honeycomb JSDoc if hive is updated first).

### W-3 — hive memory-toggle UI will contradict the #304 live toggle: hardcoded "applies on next daemon restart" narrative

#304 makes the memory toggle actuate live (`appliedLive: true`, `appliesOnRestart: false` in the ack — `honeycomb/src/daemon/runtime/dashboard/actions-api.ts:293-307`). Hive neither reads `appliedLive` nor branches on `appliesOnRestart`:

- `hive/src/dashboard/web/wire.ts:1124` — `appliesOnRestart: z.boolean().catch(true)` is parsed but the section below ignores it; `appliedLive` is not in the schema.
- `hive/src/dashboard/web/pages/settings.tsx:673-696` — `MemoryFormationSection` hardcodes the "applies on next daemon restart" note and sets a `pendingRestart` affordance after every successful toggle ("Restart now" prompt), plus stale JSDoc at `wire.ts:172-173` and `wire.ts:2161`/`2922`.

Once #304 merges, hive will tell users a restart is required for a change that is already live within ~1s. Not a blocker for merging #304 (the daemon ack is honest and back-compatible) but a hive follow-up should consume `appliedLive` and drop the restart prompt when true.

## 5. Suggestions (consider improving)

### S-1 — Correct the cross-repo consumer claims in honeycomb health JSDoc

`honeycomb/src/daemon/runtime/health.ts` (ISS-008 comments on `EmbeddingsHealth` and `HealthReasons.embeddings`) and the `no_model` note on `PortkeyHealth` ("an older consumer that only special-cases `unconfigured`/`unreachable` simply renders it as a non-degraded string") assert consumer behaviors that hive's zod layer does not actually exhibit (it catches to `"on"` / `"off"`, it does not pass strings through). When the W-1/W-2 hive PR lands, sync these comments to the real consumer contract; documentation that claims a consumer is safe when it is not will mislead the next auditor.

### S-2 — hive stale wire commentary sweep

`hive/src/dashboard/web/wire.ts:172-173`, `:1113-1117`, `:2161`, `:2922` all narrate the pre-#304 "persists only, takes effect on next restart" contract. Fold this cleanup into the W-3 fix so the wire file's documentation matches the daemon it fronts.

## 6. Plan item traceability

| # | Plan item (Wave 3) | PR | Status | Evidence |
|---|---|---|---|---|
| 1 | Vault API: `portkey.enabled=true` requires non-empty `activeModel` | #300 | DONE | `src/daemon/runtime/vault/api.ts:292-304` (enable-time guard) and `:263-275` (clear-under-enabled guard, empty-model never storable). Tests: `tests/daemon/runtime/vault/settings-api.test.ts:331-392` — reject enable w/o model, reject whitespace model, accept after model stored, disable never requires model, reject clearing under enabled gateway, reject empty model even with gateway off |
| 2 | `readPortkeySelection` fail-closed: `no_model` typed state, never POST `model:""` | #300 | DONE | `src/daemon/runtime/assemble.ts:2231-2263` (`"no_model"` sentinel, exported reader) + `:3909-3930` (sentinel → no Portkey target + typed health); final transport guard `src/daemon/runtime/inference/transport-portkey.ts:243-251` (ProviderError(400) with **no network call** and deliberately **no** false `unreachable` signal); enum extended `src/daemon/runtime/health.ts` (`PortkeyHealth` + `no_model`). Tests: `tests/daemon/runtime/assemble-portkey-selection.test.ts` (full matrix: routable / missing / empty+whitespace / gateway-off / empty-config / throwing-vault) and `tests/daemon/runtime/inference/transport-portkey.test.ts:243-284` (no fetch, no unreachable signal, key-free message, stream path identical) |
| 3 | `recordPortkeyUnreachable` keeps HTTP status; health reports `unreachable(401)` | #300 | DONE | `src/daemon/runtime/assemble.ts:3207-3221` (status captured) + `src/daemon/runtime/health.ts` (`portkeyUnreachableStatus`, emitted only while `unreachable`, normalized non-negative int). Tests: `tests/daemon/runtime/inference/transport-portkey.test.ts:207-223` (503 vs 401 signals; success/malformed-body fire none) + `tests/daemon/runtime/health.test.ts` additions |
| 4 | `extractionErrorsSinceBoot` beside `committedSinceBoot` in health **+ hive HealthStrip** | #300 / hive | **PARTIAL — daemon DONE, hive half OPEN** | Daemon: `src/daemon/runtime/pipeline/memory-formation.ts:41-151` (counter, capped 200-char key-free `lastExtractionError`, `withExtractionErrorTracking` total wrapper) wired at `assemble.ts:2747-2760`; health passthrough with always-emitted normalized counter (`health.ts`, `buildHealthDetail`). Tests: `memory-formation.test.ts`, `health.test.ts:195-227` (373-count passthrough, NaN→0). Hive: **nothing renders it** — see W-1 |
| 5 | hive: model required when Portkey is active provider | hive #26 | DONE | `hive/src/dashboard/web/panels.tsx` (merge `7daf349`): proactive "model required — set one in Settings above" badge, daemon-rejection note, model-row hint. Tests: `hive/tests/dashboard/portkey-model-required.test.tsx` (4 cases: proactive badge, badge hidden with model, rejection surfaced on 400, no note on success) |
| 6 | Embed supervisor: periodic bounded liveness probe; on failure mark not-warm + respawn | #301 | DONE | `src/daemon/runtime/services/embed-supervisor.ts`: probe armed only post-warm (`waitForLive` warm branch), 30s unref'd scheduler seam, 1-miss→`suspect` / 2-miss→kill+respawn via existing bounded machinery, `warming` first-class state absorbing the ~40s respawn tail, non-reentrant `probing` guard, `checkNow()` on-demand hook, cancellation on stop/restart/crash/fresh-spawn. Tests: `tests/daemon/runtime/services/embed-supervisor.test.ts:566-736` (wedge→respawn→**warming→warm** cycle, suspect-recovery without respawn, no probe while warming, checkNow warm/not-warm, stop cancels pending tick) |
| 7 | `/health` derives embeddings state from live probe, not the assembly latch | #301 | DONE | `src/daemon/runtime/health.ts`: coarse `embeddings` now mirrors the fine-grained live state (`EmbeddingsHealth` + `suspect`); precedence off→failed→suspect→on→warming; legacy no-signal callers byte-identical. Wired live per health call in `assemble.ts:3239-3247` (`embeddingsSuspect` from supervisor). Tests: `tests/daemon/runtime/health.test.ts:138-175` (coarse never `on` while not warm; failed beats suspect; legacy mirror). Doctor un-blinding: doctor parses `reasons.embeddings` as a plain string — no doctor change needed. Hive parsing caveat: see W-2 |
| 8 | Embed daemon: `/health` answers unconditionally; bounded queued-only FIFO | #301 (incl. `dbb2703`) | DONE | `embeddings/src/index.ts`: `/health` handled first from in-memory flags (never enters the queue), `enqueueEmbed` FIFO concurrency-1 with `setImmediate` yield, `EMBED_QUEUE_MAX = 32` counted on **queued waiters only** (running inference does not consume capacity → effective capacity exactly 33), overflow 503 "embed queue full" (client's NULL-column path), counters reset in `__resetForTest`. **Aikido queued-cap Critical fix verified in merged main** (branch tip `dbb2703` is tree-identical to `origin/main`). Tests: `tests/embeddings/embed-daemon.test.ts:326-385+` — `/health` 200 with `busy/queueDepth` while an embed blocks; shed boundary re-pinned to `EMBED_QUEUE_MAX + 1` admitted |
| 9 | Recall: skip embed when liveness stale; distinct degraded reasons | #301 | DONE | `src/daemon/runtime/memories/recall.ts`: `EmbedLivenessGate` honored in both lanes (heavy `runSemanticArms`, fast `recallFast`), closed reason enum `embed_not_ready`/`embed_timeout`/`embed_unavailable`, `boundedEmbed` distinguishes burned deadline from fast failure, timeout kicks `reportTimeout()` → supervisor `checkNow`; gate wired in `assemble.ts:1556-1580` (`ready()` = disabled ∥ no-state fake ∥ `warm`); reason forwarded into `recall.degraded` event (`memories/api.ts`). Tests: `tests/daemon/runtime/memories/recall-embed-gate.test.ts` (skip <100ms no embed call, ready-gate untouched, timeout+probe-kick once, fast-failure no kick, heavy-lane parity, keyword mode not degraded) |
| 10 | Reload seam on secrets/vault writes; memory toggle live; `appliesOnRestart` killed | #304 | DONE (minor deviation) | `src/daemon/runtime/pipeline/reload.ts` (debounced ~1s trailing-edge, late-bound, **serialized** chain — M-304-1); triggers: `secrets/api.ts:254-282` (POST/DELETE, post-persist only), `vault/api.ts:109-131,230-240` (`PIPELINE_WATCHED_SETTING_KEYS`, unwatched keys silent), `dashboard/actions-api.ts:293-307` (memory toggle). Reload closure `assemble.ts` (`buildPipelineWorker` → `PipelineWorkerBuild.reload`): re-resolves vault-first enabled against the pristine env, re-reads Portkey via the SAME fail-closed reader (no_model preserved), rebuilds + `LiveModelClient.swap` (build failure → noop client, fail-closed), refreshes gate credential names + invalidates TTL, republishes health/feature cells; bound in `start()` post-worker-build. **Deviation:** plan says "remove `appliesOnRestart: true`"; implementation keeps the field as `false` when live (hive wire back-compat — `z.boolean().catch(true)`), `true` only on honest seam-less/persist-only mounts. Judged aligned with plan intent (the dishonest restart claim is gone). Tests: `reload.test.ts` (debounce/coalesce/late-bind/last-bind-wins/fail-soft + **two M-304-1 interleaving tests**: slow-A blocks B until settled with publish order asserted, and rejecting-A releases the chain), `secrets/reload-trigger.test.ts`, `vault/settings-reload-trigger.test.ts` (incl. ISS-005 clear-model-under-gateway stays 400+silent), `actions-api.test.ts:203-268` (**persist-honesty ack matrix**: no-store→nothing claims to apply; **failed persist → never `appliedLive`, seam never fired** (Aikido #304); seam wired → `appliedLive` no restart; rejected body → no seam) |
| 11 | Stop collapsing `'auto'`→`'none'` at boot; per-job live extraction gate | #304 | DONE | `pipeline/config.ts` (boot collapse removed from the worker path; helper retained for pure-config callers with explanatory JSDoc), `pipeline/extraction.ts:268-285` (per-job `isExtractionEnabled(effectiveConfig, gate.providerConfigured())`; gate-less callers unchanged), `reload.ts` `createLiveExtractionGate` (TTL ~1s names-only probe, fail-closed on throw/empty set), `inference/model-client-factory.ts:271-299` (`resolveCredentialSecretNames`: PORTKEY_API_KEY when gateway on, else account `${SECRET_REF}` names, `[]` fail-closed). Tests: `extraction-live-gate.test.ts` (explicit provider honored, explicit `'none'` opts out even with key, `'auto'`+no-key fail-closed, `'auto'`+key runs, gate-less unchanged, live enabled flip, **end-to-end "'auto' turns on ~1s after the key lands, no restart, no handler rebuild"**) |
| 12 | `mountOnboardingApi` reads tenancy live at request time | #304 | DONE | `assemble.ts:3779-3793` (getters over the daemon's live mtime-gated `scope`), `projects/onboarding-api.ts:126-141` (contract documented: read per request, plain strings still valid for unit mounts). Tests: `onboarding-live-tenancy.test.ts` (bind after simulated workspace switch lands under NEW workspace; org switch likewise) |

## 7. Cross-PR composition (#301 × #304)

The concern was that #301 and #304 both branch from main and both touch `assemble.ts` and the health surfaces. Resolved in practice:

- **Merge order settled:** #301 is already merged (`27e34de`). #304's branch merged main into itself at `2bde8d7`, so its tree composes both changes; its `assemble.ts` diff applies on top of #301's assemble blob (`b92edbf → bac1223`).
- **No semantic clashes found:** #301 owns the embeddings health fields (`embeddings`/`embeddingsState`/`embeddingsSuspect` + the recall `embedGate`); #304 owns the pipeline reload (`pipelineReload` seam, `portkeyDeps.readSelection/onHealth` republishing `portkeyHealth`). The touched health enums are disjoint; #304's reload re-derives Portkey health through the same `readPortkeySelection`/`resolvePortkeyAssemblyStatus` pair #300 introduced, preserving `no_model` fail-closed semantics on the reload path (asserted in the reload JSDoc and exercised by `settings-reload-trigger.test.ts:135`).
- **CI:** #304 is `MERGEABLE`; Quality gate (Node 22.x, 24.x), CodeQL, Aikido, Secret gate, CodeRabbit all SUCCESS; Windows smoke was still IN_PROGRESS at audit time. **Recommendation: merge #304 as soon as Windows smoke completes; no further conflict work is required.**

## 8. Files changed

**honeycomb #300 (`9bf4ce7..d9fa41d`)** — `vault/api.ts` (enable/clear guards), `assemble.ts` (`no_model` sentinel + status capture + tracker wiring), `health.ts` (enum + status + memoryFormation passthrough), `inference/transport-portkey.ts` (final empty-model guard), `pipeline/memory-formation.ts` (+`pipeline/index.ts` exports), 5 test files (+375 test lines), version-bump/changelog noise.

**honeycomb #301 (`d9fa41d..27e34de`, incl. `dbb2703`)** — `services/embed-supervisor.ts` (liveness state machine +210), `embeddings/src/index.ts` (health-first + bounded FIFO +93), `health.ts` (coarse mirror + suspect), `memories/recall.ts` (gate + reasons +150), `memories/api.ts` (gate threading + event reason), `assemble.ts` (gate wiring + live suspect), 4 test files (+686 test lines), version noise.

**honeycomb #304 (`origin/main...fix/live-config-reload`)** — `pipeline/reload.ts` (new, 287), `assemble.ts` (+226: seam creation/binding, buildModel hoist, LiveModelClient/gate wiring, onboarding getters, portkey reload deps), `dashboard/actions-api.ts` (live toggle + honest ack), `secrets/api.ts` + `vault/api.ts` (triggers), `pipeline/config.ts`/`extraction.ts`/`index.ts` (per-job gate), `inference/model-client-factory.ts` (`resolveCredentialSecretNames`), `projects/onboarding-api.ts` (contract docs), 6 test files (+936 test lines), changeset.

**hive #26 (`4c9dc29..7daf349`)** — `src/dashboard/web/panels.tsx` (+45: badge/rejection/hint), `tests/dashboard/portkey-model-required.test.tsx` (new, 73), version noise.

## 9. Verdict

**PASS with warnings.** All Wave-3 daemon work is complete, correct, aligned, and regression-tested; the three post-security fixes are verified. Merge #304 once Windows smoke is green. Open follow-ups (hive repo, not blocking): render the #300 health surface (W-1), add `suspect`/honest catch values to the health wire schema (W-2), consume `appliedLive` in the memory toggle UI (W-3), and sync the honeycomb health JSDoc consumer claims (S-1).
