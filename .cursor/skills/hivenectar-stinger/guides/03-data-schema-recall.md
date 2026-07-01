# 03 — Data Pillar: Schema, Projection, Recall

> **CRITICAL DIRECTIVE: load `knowledge-stinger`, `deeplake-dataset-stinger`, and `retrieval-stinger` before proceeding.** This pillar defines the Deep Lake tables (`deeplake-dataset-stinger`'s domain: ColumnDef schema, FLOAT4[] embeddings, additive heal, BM25/vector/hybrid search), the portable projection (knowledge-stinger), and the recall UNION ALL arm (retrieval-stinger's domain: hybrid lexical+semantic fusion, RRF, BM25 fallback). An unarmed agent working this pillar is a failed dispatch. Read all three Stingers' SKILL.md files in full before touching any corpus doc here.
>
> Resolve the Stingers by their conventional paths. If installed globally: `C:\Users\mario\.agents\skills\{knowledge-stinger,deeplake-dataset-stinger,retrieval-stinger}\SKILL.md`. The beekeeper-suit arming contract applies.

## What this pillar covers

The data pillar owns the **substrate every other component reads and writes**: the two Deep Lake tables, the committed projection that bridges cloud-source-of-truth and offline-fresh-clone, and the recall arm that makes Hivenectar's descriptions surface alongside session and memory hits.

Load this guide when the task touches: the `source_graph` / `source_graph_versions` schema, columns, types, indexing, schema healing, tenancy; the `.honeycomb/nectars.json` projection format, generation, validation, or the projection-not-sidecar invariant; the recall `UNION ALL` arm, RRF fusion, BM25 fallback, or the structural-vs-semantic complementarity.

## The corpus docs in this pillar

| Doc (relative to skill root) | Read it for |
|---|---|
| [`C:/Users/mario/GitHub/hivenectar/library/knowledge/private/data/source-graph-schema.md`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/data/source-graph-schema.md) | The authoritative DDL for both tables, column-by-column rationale, indexing strategy, tenancy, the lazy-schema-heal contract, the v1 non-goals. |
| [`C:/Users/mario/GitHub/hivenectar/library/knowledge/private/data/portable-registry.md`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/data/portable-registry.md) | The `.honeycomb/nectars.json` format, the three generation points, the three projection-invariant enforcement rules, validation-on-load, the commit discipline. |
| [`C:/Users/mario/GitHub/hivenectar/library/knowledge/private/data/recall-integration.md`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/data/recall-integration.md) | The fourth recall arm, the latest-per-nectar subquery, RRF fusion with sessions/memory/memories, graceful BM25 fallback. **Read the FULL file** — it is longer than the first read window. |
| The three `data/*-deep-dive/` folders (5 docs each) | Expanded user-stories, technical-specification, introduction-and-theory, ecosystem-story-arc, conclusion-and-deliverables for each source doc. Cite these for ground-truth specifics. Paths: [`C:/Users/mario/GitHub/hivenectar/library/knowledge/private/data/source-graph-deep-dive/`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/data/source-graph-deep-dive/), [`.../portable-registry-deep-dive/`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/data/portable-registry-deep-dive/), [`.../recall-integration-deep-dive/`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/data/recall-integration-deep-dive/). |

## The load-bearing claims (verify before relying on)

### Schema
- **Two tables, not one.** `source_graph` (identity: nectar PK, kind, created_at, derived_from_nectar, fork_content_hash, tenancy) + `source_graph_versions` (append-only: nectar, content_hash, seq, path, filename, ext, size_bytes, mtime_observed, title, description, concepts, embedding, described_at, describe_model, describe_status, observed_at, tenancy, last_update_date).
- **Composite key on versions:** `(nectar, content_hash)`. `seq` is a BIGINT monotonic per-nectar counter for cheap "latest version" queries.
- **`describe_status` values:** `pending`, `described`, `failed`, `skipped-too-large`, `skipped-binary`.
- **Embedding:** `FLOAT4[]`, **768-dim**, matches `sessions.message_embedding` and `memory.summary_embedding`.
- **No `agent_id`, no `visibility` column** — file identity is cross-agent.
- **Schema healing is additive only**, via `withHeal` against the ColumnDef array. Never hand-roll an `ALTER`.

### Projection
- **File:** `.honeycomb/nectars.json` at project root. A **projection** (regenerable lockfile), NOT a sidecar. Satisfies FR-8.
- **Generated at three points:** end-of-brood, end-of-enricher-cycle, explicit `rebuild-projection`.
- **Three enforcement rules:** (1) Deep Lake writes first, (2) never hand-edited, (3) regenerable from Deep Lake alone byte-identical (modulo `generated_at`).
- **Fresh clone with current projection:** zero LLM calls, zero fuzzy matches.

### Recall
- **Four arms:** sessions, memory, memories, source_graph_versions. (Do NOT drop the `memories` arm — a corpus hallucination did this once and was fixed.)
- **The Hivenectar arm** filters: latest version per nectar, `describe_status = 'described'`, scoped by org/workspace/project.
- **Fusion:** reciprocal rank fusion (RRF). Graceful BM25-only fallback when embeddings are off — no error, no quality cliff.

## The SQL-guard contract (implementation lives in sibling repo)

Every dynamic value in the recall arm must route through the daemon's storage-layer SQL guards (`sqlStr`, `sqlLike`, and siblings) from `src/daemon/storage/sql.ts` — never string-interpolated. The Hivenectar corpus names `sqlStr` and `sqlLike`; the full helper set lives in the sibling Honeycomb daemon. **Do not invent helper names** not present in the corpus (a prior hallucination invented `sqlIdent`; it was removed). See [`00-principles.md`](00-principles.md) § Principle 1.

## Related guides

- [`02-identity-model.md`](02-identity-model.md) — the identity decision forces the two-table split.
- [`04-ai-brooding-enricher.md`](04-ai-brooding-enricher.md) — brooding writes the initial rows; the enricher fills descriptions; the embeddings daemon produces the 768-dim vectors the recall arm scores.

## Procedure

1. **Arm.** Load `knowledge-stinger`, `deeplake-dataset-stinger`, `retrieval-stinger` (per the CRITICAL DIRECTIVE). Confirm [`00-principles.md`](00-principles.md).
2. **For schema work**, read `data/source-graph-schema.md` for the authoritative DDL. The deep-dive `source-graph-technical-specification.md` carries it verbatim with column tables.
3. **For projection work**, read `data/portable-registry.md`. Internalize the projection-vs-sidecar distinction before writing.
4. **For recall work**, read `data/recall-integration.md` IN FULL (it truncates in the first read window). Verify the four-arm count and the RRF mechanics against it.
5. **Verify every column, type, and arm name against the cited source** before asserting it.
6. **Verify cross-links resolve** before declaring done.

## What this pillar does NOT cover

- The identity-model decision that forces the two-table split → [`02-identity-model.md`](02-identity-model.md).
- The brooding/enricher loops that produce the rows and descriptions → [`04-ai-brooding-enricher.md`](04-ai-brooding-enricher.md).
- The embeddings daemon that produces the 768-dim vectors → [`04-ai-brooding-enricher.md`](04-ai-brooding-enricher.md).
