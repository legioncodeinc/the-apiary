# QA Report — Fleet Fix Plan, Wave 2 (The value-proof loop)

- **Date:** 2026-07-12
- **Auditor:** quality-worker-bee (quality-stinger)
- **Source plan:** `C:\Users\mario\.claude\plans\sprightly-percolating-lake.md` — "Wave 2" section (Pieces A–D + Wave-2 test list)
- **Schema spec (binding):** scratchpad `wave2-schema-spec.md` (deeplake-dataset-worker-bee advisory; one sanctioned deviation: fragment helpers renamed `projectWhereClause` / `projectClause` for the audit-sql scanner)
- **Delivered:**
  - honeycomb PR **#298** `feat/value-proof-loop` (base `fix/route-and-registry-quick-wins`; commits `756add1`, `0535a96`, `571f3ca`, `a49c170`, `bb96c03` = Pieces A–C; `7a4ea57` = Piece D)
  - hive PR **#25** `feat/value-proof-ui` (base `fix/dashboard-quick-wins`; commits `10a7408`, `2a261fd`, `ebc022b`, `25b3a38`, `0e20af9`)
- **Ordering:** security-worker-bee completed the Wave-2 audit BEFORE this QA pass (PASS — 0 Critical/High; report-only Medium no-retention on `memory_injections`, Low session-header length + NaN clamp). Ordering is correct.
- **Audit method:** ref-only review (`git diff <base>...<head>`, `git show`); no branch switches, no working-tree changes, no test execution locally (see W-2).

## 1. Summary

Wave 2 is delivered **faithfully and completely** across both repos: every plan line of Pieces A–D traces to code, the implementation follows the validated `memory_injections` schema spec exactly (including the one sanctioned rename), the cross-repo seam (daemon labels/fields → hive schemas) is literal-for-literal correct, and the test suites genuinely assert the load-bearing behaviors (response-contract-unchanged, a-AC-8 prime byte-identity, skip-on-zero, fail-soft, zero-fill/startedAt, partial-net matrix, wire back-compat). **No Critical findings.** Two Warnings are process-level: the Aikido Security CI check fails on honeycomb PR #298 (it passes on the base PR #297, so the flag is introduced by this branch), and neither PR shows a typecheck/vitest CI run — the plan's "CI green / `npm run ci`" verification gate has no evidence yet. Verdict: **PASS with conditions** — resolve/waive the Aikido finding and produce a green `npm run ci` in both repos before merge.

## 2. Scorecard

| Axis | Status | Notes |
|---|---|---|
| Completeness | PASS | All Piece A–D plan lines + all 10 Wave-2 test-list items delivered (see §7). |
| Correctness | PASS | SQL guards, COALESCE + toNum, no GROUP BY, clamps, fail-soft, TTL cache tiering, channel gating all verified against the spec's hard rules. |
| Alignment | PASS | A–C commits touch only `src/daemon` + `src/dashboard/contracts.ts`; D commit (`7a4ea57`) touches only `src/hooks` + hook tests. Zero per-shim edits. One benign extension (N-3). |
| Gaps | PASS (2 process Warnings) | No code gaps. CI-green evidence missing (W-1, W-2). |
| Detrimental Patterns | PASS | No scope creep, no fabricated data paths, no silent catches on serving paths (the writer's catch-all is the *documented* fail-soft contract). |

## 3. Critical Issues (must fix)

None.

## 4. Warnings (should fix before merge)

**W-1 — Aikido Security CI check fails on honeycomb PR #298 and passes on the base PR #297.**
Evidence: `gh pr checks 298` → `Aikido Security: check code — fail` (scan 146752002); `gh pr checks 297` → same check `pass` (scan 146738046). The failure is therefore introduced by this branch's diff. security-worker-bee's audit was PASS with report-only Medium/Low items; the Aikido flag may map onto those accepted items (e.g. the `memory_injections` no-retention Medium) or may be a distinct scanner finding. **Action:** triage the Aikido scan; either remediate or explicitly map/waive it against the accepted report-only findings. The plan's Verification section requires CI green per PR before merge.

**W-2 — No typecheck/vitest CI run exists on either branch head.**
Evidence: `gh run list --branch feat/value-proof-loop` and `--branch feat/value-proof-ui` show only "Release gate" and "CLA" workflows; `gh pr checks` shows no test job on #298 or #25. The plan requires "Each PR: `npm run ci` in the owning repo (typecheck + jscpd + vitest)". This audit reviewed the tests by reading them (they are substantive — §7) but did not execute them (ref-only constraint: honeycomb's working tree carries uncommitted `library/` files). **Action:** run `npm run ci` in each repo on the branch head (or trigger the CI workflow) and record green before merge.

## 5. Suggestions (consider improving)

**S-1 — Pluralization nit in the injection notice.** `renderInjectionNotice` always renders "memories" — a single-hit turn reads `🐝 Honeycomb: 1 memories injected (~X tokens)`. The plan text specified the string literally, so this is *not* a plan gap, but a `count === 1 ? "memory" : "memories"` branch would read better. `honeycomb src/hooks/shared/user-prompt-recall.ts:158-162`.

**S-2 — "Response unchanged" tests assert exact key sets + schema parse rather than a byte-level baseline diff.** `Object.keys(json).sort()` equality (recall: `injection-metering.test.ts` "response CONTRACT is unchanged" blocks; prime: same file) plus `PrimeResponseSchema` round-trip is a strong proxy, but a snapshot of the full body against a metering-disabled daemon would make the "byte-identical" claim literal. Low priority — the fire-and-forget `void recordInjection(...)` placement before `c.json(...)` (`memories/api.ts:855-864`) makes divergence structurally impossible today.

**S-3 — `computed:false` branch emits a populated `missingInputs`.** `assembleRoiVew`'s else-branch sets `partial:false` but leaves `missingInputs` populated (`dashboard/api.ts`, netSection else-branch). Hive only reads `missingInputs` when `partial === true` (`roi.tsx:356-360`), so this is inert, but emitting `[]` on the uncomputed branch would keep the field's meaning crisp for future consumers.

## 6. Notes / Observations (not failures)

- **N-1 — End-to-end dogfood deferred (per invoker).** The plan's Wave-2 end-to-end check (live daemon → visible "memories injected" line → counter increments → /dashboard + /roi move) is deferred until merge + deploy. Not audited here.
- **N-2 — Plan-internal tension on `computed:false`, resolved honestly.** The plan says both "compute when savings is ok/partial and cost inputs are confident-or-absent" and "`computed:false` dash retained only when savings itself is absent". These conflict when a cost input is unreachable/unauthenticated. The implementation follows the first (normative) clause: an unreachable/unauthenticated cost input still dashes (`dashboard/api.ts` partial-net block; test "an UNREACHABLE cost input still blocks the net"). This is the honest direction (a known-unread bill would overstate ROI) and is documented in both repos' `RoiNetSection` JSDoc.
- **N-3 — Minor benign extension: KPI tile caption.** The plan says the tile "becomes 'Tokens injected' bound to `injectedTokens`". Hive additionally keeps the corpus estimate visible as a subordinate caption (`corpus ~N tok`) via a new optional `caption` prop on `Kpi` (`hive src/dashboard/web/primitives.tsx:262-323`, `dashboard.tsx:240-248`). Honesty-aligned and additive (absent caption ⇒ unchanged tile); logged as a scope note, not a violation.
- **N-4 — Plan line "hive/src/dashboard/contracts.ts KpisView" is inapplicable.** Hive's `contracts.ts` has no `KpisView` interface; hive's KPI type is `KpisWire = z.infer<typeof KpisSchema>` (`wire.ts:214-221`), which gained `injectedTokens` with `.catch(0)`. Behavior fully covered; the plan assumed a contract mirror that does not exist in hive.
- **N-5 — Harness byte-identity confirmed in practice.** Only the `claude-code` shim maps `UserPromptSubmit → user_prompt_recall` (`src/hooks/claude-code/shim.ts:66`), so Codex/Cursor/Hermes/pi/OpenClaw never receive a `systemMessage` today; `shims-channel.test.ts` additionally proves model-only shims are byte-identical even WITH extras and user-visible shims are byte-identical WITHOUT extras. The Codex-ready append path is in place and tested.
- **N-6 — Prime metering rows carry `sessionId:""`/`projectId:""`** (`prime.ts:138-147`) — consistent with the plan (prime is scope-level, not request-attributed).

## 7. Plan Item Traceability

Legend: ✅ delivered & verified · 🟡 delivered with note · N/A inapplicable.

### Piece A — injected-token metering (honeycomb)

| # | Plan/spec line | Status | Evidence |
|---|---|---|---|
| A-1 | New catalog table `memory_injections`, append-only, agent scope, all NOT NULL with DEFAULTs | ✅ | `src/daemon/storage/catalog/memory-injections.ts:29-63` — 9 columns exactly per spec (id/at/source `DEFAULT 'recall'`/BIGINT hits/tokens/session_id/project_id/agent_id `'default'`/visibility `'global'`); `pattern:"append-only"`, `scope:"agent"`, `embeddingColumns:[]` |
| A-2 | File named `memory-injections.ts` (spec: NOT `injections.ts`) | ✅ | File path as spec'd; plan's earlier `injections.ts`/`injection-ledger.ts` names superseded by the binding spec |
| A-3 | Registered in `catalog/index.ts` (barrel spread + re-exports) for lazy CREATE via heal | ✅ | `catalog/index.ts:28` (import, alphabetical), `:50` (spread after `MEMORY_LIFECYCLE_TABLES`, per spec), `:123-132` (re-export block matches spec list exactly) |
| A-4 | Writer: heal-aware `appendOnlyInsert`, fail-soft (never throws), skips hits/tokens ≤ 0, clamps, closed-taxonomy gate, `recordAccess` model | ✅ | `src/daemon/runtime/telemetry/injection-log.ts:96-127` — `isInjectionSource` gate, `Math.max(0, Math.trunc(...))` clamps, skip-on-zero, `appendOnlyInsert(deps.storage, healTargetFor(MEMORY_INJECTIONS_TABLE), scope, row)`, catch-all → `{appended:false}`; injectable `now`/`newId` seams |
| A-5 | SQL readers: SUM w/ COALESCE + no GROUP BY; range read w/ lexicographic ISO cutoff; `sqlIdent`/`sLiteral` throughout | ✅ | `memory-injections.ts:73-92` — `buildInjectionTokenSumSql` (COALESCE, no GROUP BY), `buildInjectionRangeSql` (`at >=` cutoff, `ORDER BY at ASC`); every identifier `sqlIdent`, every value `sLiteral` |
| A-6 | Sanctioned deviation: `projectWhereClause` / `projectClause` fragment names | ✅ | `memory-injections.ts:66-70` (`projectWhereClause`), `:83` (`projectClause`) — the only deviation from the spec's literal code, exactly as sanctioned (`a49c170`) |
| A-7 | Call site 1: `POST /recall` after `logProjectScopeDegraded`, fire-and-forget, `fast ? 'recall_fast' : 'recall'`, tokens = Σ `estimateTokenCount(hit.text)` | ✅ | `src/daemon/runtime/memories/api.ts:846-865` — `void recordInjection({source: parsed.data.fast === true ? "recall_fast" : "recall", hits: result.hits.length, tokens: result.hits.reduce(...estimateTokenCount...), sessionId: x-honeycomb-session, projectId: bound?...:""})` placed exactly after `logProjectScopeDegraded`, before the unchanged `c.json(recallResponse(...))` |
| A-8 | Call site 2: `buildPrimeForScope` records `source:'prime'` when digest non-empty | ✅ | `src/daemon/runtime/memories/prime.ts:127-150` — gated `!digest.empty && digest.tokens > 0`; hits = recent + durable; tokens = digest estimate; response object unchanged |
| A-9 | Honesty JSDoc: meters tokens *served*; served ≥ injected; source tag separates real injections from dashboard/MCP searches | ✅ | JSDoc at both call sites (`api.ts:849-856`, `prime.ts:130-137`) + writer module doc + `KpisView.injectedTokens` doc |

### Piece B — KPI switch (honeycomb + hive)

| # | Plan line | Status | Evidence |
|---|---|---|---|
| B-1 | `fetchInjectedTokens` (ledger SUM, project-scoped via `projectWhereClause`) | ✅ | `dashboard/api.ts:310-325` — `selectRows(storage, buildInjectionTokenSumSql(projectId), scope)` + `toNum` guard (belt-and-braces per spec rule 2) |
| B-2 | Added to `/kpis` on the short `DIAG_TTL_MS` cache (live counter) | ✅ | `dashboard/api.ts:1244-1247` (`injectedCache = createTtlViewCache<number>(DIAG_TTL_MS)` with rationale comment), `:1265-1274` (Promise.all + response field); test proves cache reuse |
| B-3 | honeycomb `KpisView` gains additive `injectedTokens` | ✅ | `src/dashboard/contracts.ts:64-72` + `EMPTY_DASHBOARD_DATA` zero |
| B-4 | hive `contracts.ts` `KpisView` | N/A | Hive has no `KpisView`; the KPI type is `KpisWire` — see N-4 |
| B-5 | hive `wire.ts` `KpisSchema` `injectedTokens` with `.catch(0)` back-compat | ✅ | `hive src/dashboard/web/wire.ts:217-220` + `EMPTY_KPIS` zero (`:2298`); back-compat proven in `value-proof-wire.test.ts` |
| B-6 | `estimatedSavings` JSDoc rewritten honestly (corpus-mass proxy) | ✅ | honeycomb `contracts.ts:57-63` — "a CORPUS-MASS PROXY, not a measurement … NOT tokens actually injected" |
| B-7 | `dashboard.tsx:271-276` tile becomes "Tokens injected" bound to `injectedTokens` | 🟡 | `hive dashboard.tsx:240-248` — delivered, plus subordinate corpus caption (benign extension, N-3) |

### Piece C — ROI trend + partial net (honeycomb + hive)

| # | Plan line | Status | Evidence |
|---|---|---|---|
| C-1 | Replace `fetchRoiTrendView` stub with real read via `readRoiMetrics` (canonical-deduped/scoped) | ✅ | `dashboard/api.ts:1146-1183` — scope resolution mirrors `fetchRoiView` (isolated-agentid fail-closed), `readRoiMetrics` + project conjunct; honest-empty `EMPTY_ROI_TREND` on empty/error; route threads `?range=` + project header (`:1413-1420`) |
| C-2 | Pure `assembleRoiTrend` fold: UTC-day buckets from `created_at.slice(0,10)` in TS (never SQL GROUP BY) | ✅ | `dashboard/api.ts:1085-1144` — bucketing in TS per spec hard rule 1; injectable `now` |
| C-3 | Zero-day fill across the window | ✅ | `api.ts:1109-1115` labels loop + zero-initialized maps; test asserts `[0,0,0,0,30,0,150]` |
| C-4 | `startedAt` = min `created_at` (pre-cutoff, across ALL rows) | ✅ | `api.ts:1101-1106`; test "drops rows OUTSIDE the window … keeps them in startedAt" |
| C-5 | Exactly two series labeled `measured-savings` (solid) / `modeled-savings` (dashed) matching `roi-chart.tsx:29-34` heuristics | ✅ | `api.ts:1126-1140` (labels + `modeled` flags); seam verified literally: `hive roi-chart.tsx:29-34` `seriesColor` returns green `--verified` / amber `--severity-warning` because neither label contains `net`/`infra`/`cost`; daemon test asserts `label).not.toMatch(/net|infra|cost/)` |
| C-6 | No fabricated infra series | ✅ | Only the two savings series are emitted |
| C-7 | No hive chart change needed | ✅ | hive diff touches no `roi-chart.tsx` source (tests only) |
| C-8 | Partial net: compute when savings ok/partial and cost inputs confident-or-absent; `status:'partial'` + additive `partial` + `missingInputs` | ✅ | `dashboard/api.ts:1000-1050` — exact semantics; `absent` cost contributes 0; unreachable/unauthenticated cost still dashes (N-2); `missingInputs` from any input `!== "ok"` |
| C-9 | Both contracts + wire `.catch` defaults for the net fields | ✅ | honeycomb `contracts.ts:506-533` + `EMPTY_ROI_VIEW`; hive `contracts.ts:142-150` + `EMPTY_ROI_VIEW`; hive `wire.ts:368-375` (`partial: z.boolean().catch(false)`, `missingInputs: z.array(z.string()).catch([])`) + whole-net `.catch` default (`:407`) |
| C-10 | hive `NetHero`: number + amber `partial` badge + "excludes: …" caption | ✅ | `hive roi.tsx:318-361` — renders on `computed && (ok\|partial)`; `data-testid="net-partial-badge"` amber Badge + `excludes: {missingInputs.join(", ")}` caption; `computed:false` dash unchanged |

### Piece D — hook visibility + timeout (honeycomb, commit `7a4ea57`)

| # | Plan line | Status | Evidence |
|---|---|---|---|
| D-1 | `HookResult` gains optional `systemMessage` | ✅ | `src/hooks/shared/contracts.ts:175-184` |
| D-2 | `runUserPromptRecall` sets `🐝 Honeycomb: N memories injected (~X tokens)` on new hits only; local ceil(len/4), no daemon import | ✅ | `src/hooks/shared/user-prompt-recall.ts:118-120` (new-block arm only) + `renderInjectionNotice` `:151-162` (non-empty-hit count, `Math.ceil(block.length / 4)`); deduped/empty/nudge turns carry no notice (tested) |
| D-3 | Single-engine threading: model-only + `contextHookEvent` (Claude Code recall arm) gets top-level `systemMessage`; session-start prime envelope byte-identical (a-AC-8); user-visible channel appends the line (Codex-ready); zero per-shim edits | ✅ | `src/hooks/normalize.ts:147-149` (`renderContext` pass-through) + `renderChannel` `:175-190` (three-arm gating exactly as planned); `contracts.ts:88-96` (`ContextEnvelope.systemMessage` additive) + `:199-210` (`renderContext(block, extras?)` source-compatible); no shim source files touched |
| D-4 | `emitResponse` (`binary.ts:205-210`) passes it through | ✅ | `src/hooks/binary.ts:205-215` — extras object only when `systemMessage !== undefined` (absent ⇒ envelope-identical single-arg semantics) |
| D-5 | Cursor/OpenClaw/pi/Hermes byte-identical | ✅ | `shims-channel.test.ts` (model-only shims byte-identical WITH extras; user-visible shims byte-identical WITHOUT extras) + only `claude-code/shim.ts:66` maps the recall event (N-5) |
| D-6 | `DEFAULT_RECALL_TIMEOUT_MS 4000 → 6000` with rewritten PRD-077b rationale | ✅ | `src/hooks/shared/recall-renderer.ts:50-64` — `6_000`; JSDoc rewritten citing live 3.0–4.6s measurements, p95 aborts, and server-side 3s deadline still firing first |

### Wave-2 test list (plan) — all 10 items

| # | Test-list item | Status | Suite |
|---|---|---|---|
| T-1 | injections catalog/heal test | ✅ | `tests/daemon/storage/catalog/memory-injections.test.ts` — validateColumnDefs, defaults, agent-scope (no org/workspace cols), CATALOG/REGISTRY flow, `healTargetFor` resolution, `primitiveFor === "appendOnlyInsert"` |
| T-2 | ledger writer (skip-on-zero, fail-soft, SQL guards) | ✅ | `tests/daemon/runtime/telemetry/injection-log.test.ts` — column list, clamps, taxonomy gate, skip-on-zero (0 SQL), query_error AND throwing-client fail-soft, default clock/UUID |
| T-3 | recall + prime call-site tests (response bodies unchanged) | ✅ (S-2) | `tests/daemon/runtime/memories/injection-metering.test.ts` — heavy/fast source tags, Σ estimateTokenCount, session/project attribution, exactly-one-append, zero-hit no-append, exact response key-set + `PrimeResponseSchema` round-trip |
| T-4 | `fetchInjectedTokens` | ✅ | `tests/daemon/runtime/dashboard/injected-tokens-kpi.test.ts` — COALESCE SUM, project conjunct, fail-soft 0 (empty/NULL/error), `fetchKpisView` fold, `/kpis` body, short-TTL cache reuse |
| T-5 | `assembleRoiTrend` (bucketing, zero-fill, cutoff, startedAt) | ✅ | `tests/daemon/runtime/dashboard/roi-trend.test.ts` — plus range parsing, exact labels/modeled flags, integer-cents, 1-day clamp, ledger-backed fetch (ok/empty/error/isolated-fail-closed/project conjunct) |
| T-6 | partial-net matrix | ✅ | `tests/daemon/runtime/dashboard/api-roi.test.ts` — ok+partial+absent ⇒ computed partial w/ exact `missingInputs`; savings absent ⇒ dash; unreachable cost ⇒ dash; absent infra ⇒ computed partial contributing 0; all-ok ⇒ clean ok |
| T-7 | systemMessage present on new hits / absent on dedupe+empty+nudge | ✅ | `tests/hooks/shared/user-prompt-recall.test.ts` — exact string w/ N (non-empty only) and ~X; deduped/nudge/throttled-off absent |
| T-8 | normalize envelope gating (prime byte-identical) | ✅ | `tests/hooks/normalize.test.ts` — `JSON.stringify(withExtras) === JSON.stringify(bare)` for the prime arm (a-AC-8); top-level spread on recall arm validates against the pinned Claude Code oracle; user-visible append; no-`undefined`-churn |
| T-9 | binary stdout carries systemMessage | ✅ | `tests/hooks/binary.test.ts` — emitted JSON has `systemMessage` beside unchanged `hookSpecificOutput`; deduped turn emits exactly `{}`; nudge has no `systemMessage` key; capture-mode + malformed-stdin acks byte-identical |
| T-10 | hive wire `.catch` back-compat + tile/NetHero renders (+ chart) | ✅ | `tests/dashboard/value-proof-wire.test.ts`, `dashboard-tokens-injected.test.tsx`, `net-hero-partial.test.tsx` (incl. malformed `partial:true` w/ `computed:false` still dashes), `roi-chart-two-series.test.tsx` (solid/dashed + color language, no NaN on zero-fill, single-day) |

### Spec deviation log

| Deviation | Sanctioned? | Evidence |
|---|---|---|
| `projectConjunct` → `projectWhereClause`; `proj` local → `projectClause` | Yes (explicit) | `memory-injections.ts:66-70,83`; commit `a49c170` message cites the audit:sql convention |
| Writer path `runtime/telemetry/injection-log.ts` vs plan's `runtime/memories/injection-ledger.ts` | Yes (spec supersedes plan; spec names this exact path) | spec §"Writer contract"; delivered file matches |
| Reader names `buildInjectionTokenSumSql`/`buildInjectionRangeSql` vs plan's `buildInjectedTokens*Sql` | Yes (spec supersedes plan) | spec §file listing; delivered matches spec |
| Local `resolveAgentScope` re-implemented in the writer (access-log's is module-private) | Consistent with spec ("modeled byte-for-byte on recordAccess") | `injection-log.ts:80-88`; semantics identical (`'default'`/`'global'` defaults) |
| No other deviations found | — | Column defs, registration order, re-export list, SQL shapes, and writer row order are byte-faithful to the spec |

## 8. Files Changed

### honeycomb `feat/value-proof-loop` (27 files, +1895/−82)

| File | Summary |
|---|---|
| `src/daemon/storage/catalog/memory-injections.ts` | NEW — spec-faithful `memory_injections` catalog group + guarded SUM/range readers |
| `src/daemon/storage/catalog/index.ts` | Registration: import + CATALOG spread + re-export block |
| `src/daemon/runtime/telemetry/injection-log.ts` | NEW — `recordInjection` writer (fail-soft, skip-on-zero, clamps, heal-aware append) |
| `src/daemon/runtime/memories/api.ts` | Recall call site (fire-and-forget meter after `logProjectScopeDegraded`) |
| `src/daemon/runtime/memories/prime.ts` | Prime call site (non-empty digest only) |
| `src/daemon/runtime/dashboard/api.ts` | `fetchInjectedTokens` + KPI wiring on DIAG_TTL_MS; partial-net semantics; `parseTrendRange` + `assembleRoiTrend` + real `fetchRoiTrendView` |
| `src/dashboard/contracts.ts` | `KpisView.injectedTokens`; honest `estimatedSavings` JSDoc; `RoiNetSection.partial`/`missingInputs`; EMPTY updates |
| `src/hooks/shared/contracts.ts` / `shared/index.ts` | `HookResult.systemMessage`; `renderInjectionNotice` export |
| `src/hooks/shared/user-prompt-recall.ts` | Notice on new-hit turns only; `renderInjectionNotice` |
| `src/hooks/shared/recall-renderer.ts` | `DEFAULT_RECALL_TIMEOUT_MS` 4000 → 6000 + rewritten rationale |
| `src/hooks/contracts.ts` / `normalize.ts` / `binary.ts` | Envelope `systemMessage` (additive), single-engine channel gating, stdout pass-through |
| `.changeset/ai-a49c170.md` | Minor changeset |
| 11 test files | See §7 T-1…T-9 |

### hive `feat/value-proof-ui` (9 files, +482/−13)

| File | Summary |
|---|---|
| `src/dashboard/contracts.ts` | `RoiNetSection.partial`/`missingInputs` (additive) + EMPTY update |
| `src/dashboard/web/wire.ts` | `KpisSchema.injectedTokens .catch(0)`; net `partial .catch(false)` / `missingInputs .catch([])`; EMPTY_KPIS |
| `src/dashboard/web/pages/dashboard.tsx` | "Tokens injected" tile bound to `injectedTokens` + subordinate corpus caption |
| `src/dashboard/web/pages/roi.tsx` | `NetHero` partial rendering (amber badge + excludes caption); exported for tests |
| `src/dashboard/web/primitives.tsx` | Optional `Kpi.caption` subline (additive) |
| 4 test files | See §7 T-10 |

## 9. Verdict

**PASS with conditions.** Implementation quality is high and plan/spec fidelity is complete; no code-level Critical or Warning findings. Before merge: (1) triage or formally waive the Aikido Security failure on honeycomb PR #298 (W-1); (2) produce green `npm run ci` evidence for both branch heads (W-2). The plan's end-to-end dogfood check remains deferred until merge + deploy (N-1) and must gate the issue-register status flips per the plan's convention.
