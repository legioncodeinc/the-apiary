# 04 — AI Pillar: Brooding, Enricher, Embeddings

> **CRITICAL DIRECTIVE: load `knowledge-stinger`, `embeddings-runtime-stinger`, and `retrieval-stinger` before proceeding.** This pillar owns the LLM description pipeline (knowledge-stinger's narrative domain), the embeddings daemon that produces the 768-dim vectors (`embeddings-runtime-stinger`'s domain: nomic-embed-text-v1.5, q8, dim-must-match-schema), and the hybrid recall that consumes the descriptions (`retrieval-stinger`'s domain). An unarmed agent working this pillar is a failed dispatch. Read all three Stingers' SKILL.md files in full before touching any corpus doc here.
>
> Resolve the Stingers by their conventional paths. If installed globally: `C:\Users\mario\.agents\skills\{knowledge-stinger,embeddings-runtime-stinger,retrieval-stinger}\SKILL.md`. The beekeeper-suit arming contract applies.

## What this pillar covers

The AI pillar owns the **description lifecycle**: brooding (the one-time full-scan bootstrap that mints identity and produces the first descriptions), the enricher (the steady-state loop that keeps descriptions fresh), and the embeddings layer (the 768-dim vectors that feed semantic recall). It also owns the model choice (Gemini 2.5 Flash) and its rationale.

Load this guide when the task touches: file description generation, brooding batches/thresholds/cost, the enricher's debounce/meaningful-change heuristic, model selection or swap, the embeddings daemon, BM25 fallback, or the re-association ladder's algorithmic details (the ladder is owned by [`02-identity-model.md`](02-identity-model.md) conceptually but its mechanics live in this pillar's `ai/identity-and-reassociation.md`).

## The corpus docs in this pillar

| Doc (relative to skill root) | Read it for |
|---|---|
| [`C:/Users/mario/GitHub/hivenectar/library/knowledge/private/ai/brooding-pipeline.md`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/ai/brooding-pipeline.md) | The brooding pipeline: discovery, the four buckets, the batch/solo call shapes, the cost math (~$3.05 for 2000 files), resumability, CLI flags. |
| [`C:/Users/mario/GitHub/hivenectar/library/knowledge/private/ai/enricher-and-llm-model.md`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/ai/enricher-and-llm-model.md) | The enricher loop, the Gemini 2.5 Flash rationale, the model-comparison table, the meaningful-change heuristic (Jaccard, REDESCRIBE_THRESHOLD 0.85), debounce (2000 ms watcher, 30 s enricher), failure handling. **Read the FULL file** — it is long and the first read window truncates. |
| [`C:/Users/mario/GitHub/hivenectar/library/knowledge/private/ai/identity-and-reassociation.md`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/ai/identity-and-reassociation.md) | The 5-step re-association ladder. Cross-pillar with [`02-identity-model.md`](02-identity-model.md); the *algorithm* lives here. |
| The three `ai/*-deep-dive/` folders (5 docs each) | Expanded docs for brooding, enricher, and re-association. Paths: [`C:/Users/mario/GitHub/hivenectar/library/knowledge/private/ai/brooding-deep-dive/`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/ai/brooding-deep-dive/), [`.../enricher-deep-dive/`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/ai/enricher-deep-dive/), [`.../identity-deep-dive/`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/ai/identity-deep-dive/). |

## The load-bearing claims (verify before relying on)

### Brooding
- **Four buckets:** skip-binary (NUL bytes in first 8KB or binary ext), skip-too-large (>256 KB), batch (≤4 KB/file, ≤100 KB/batch, 30–50 files/call), solo (>4 KB, ≤256 KB, 1 file/call).
- **Cost math (2000-file repo):** ~$3.05 total = $0.65 input + $2.40 output; ~2.15M input tokens; ~318 calls. 10k-file monorepo ~$15; 200-file microservice ~$0.30.
- **Batch output:** title (≤80 chars) + 1–3 sentence description + 1–5 concepts. Solo output: richer prompt, 3–5 sentence description, asks for "primary symbol".
- **CLI flags (on `brood` only):** `--force`, `--limit N`, `--dry-run`. (Do NOT apply `--limit`/`--dry-run` to the enricher — a corpus hallucination did this once and was fixed.)
- **Resumable** via `describe_status`; no lockfile. Does NOT block daemon readiness.

### Enricher
- **Canonical model:** Gemini 2.5 Flash via Portkey. Context: 1M tokens (the load-bearing property, not raw cheapness). Configurable via `agent.yaml` / Portkey, NOT hardcoded.
- **Model comparison table:** Gemini 2.5 Flash $3.05 (1M); Haiku 4.5 $7.00 (200K); GPT-4.1 $11.50 (1M); GPT-4o-mini $3.00 (128K, quality risk).
- **Time-lazy AND change-lazy.** Watcher intake debounce 2000 ms; enricher poll 30 s. Meaningful-change heuristic: Jaccard similarity ≥ `REDESCRIBE_THRESHOLD` (default 0.85) → inherit prior description, set `describe_model = inherited-from:<prev_content_hash>`.
- **Model swap:** NOT automatic. Operator runs `honeycomb hivenectar brood --force --model <new>` to force re-description.
- **`describe_model`** column records which model produced each description (auditable).

### Embeddings
- **Model:** nomic-embed-text-v1.5, q8 quantization, **768-dim**, local daemon (Unix-socket NDJSON IPC).
- **Dim must match schema** (FLOAT4[768] columns). Changing the dim is a schema event.
- **Graceful fallback:** embeddings off → embedding NULL → recall silently falls back to BM25 over title/description. No error, no quality cliff.

## The cost-math trap

The brooding cost table and the model-comparison table are the highest-risk hallucination surface in the corpus. Every number ($3.05, $0.65, $2.40, 318, 2.15M, $7.00, $11.50, $3.00) was verified during the audit and is correct. **If you assert any cost figure, verify it against `brooding-pipeline.md` or `enricher-and-llm-model.md` first.** Do not round, do not paraphrase the numbers, do not invent new ones.

## Related guides

- [`01-overview.md`](01-overview.md) — pillar 2 (lazy LLM description) of the overview is this pillar.
- [`02-identity-model.md`](02-identity-model.md) — the re-association ladder writes the rows the enricher fills.
- [`03-data-schema-recall.md`](03-data-schema-recall.md) — the descriptions and embeddings land in `source_graph_versions`; recall reads them.

## Procedure

1. **Arm.** Load `knowledge-stinger`, `embeddings-runtime-stinger`, `retrieval-stinger` (per the CRITICAL DIRECTIVE). Confirm [`00-principles.md`](00-principles.md).
2. **For brooding work**, read `ai/brooding-pipeline.md` for the pipeline + cost math. Verify every number against it.
3. **For enricher/model work**, read `ai/enricher-and-llm-model.md` IN FULL (truncates in first read). The model comparison table and the meaningful-change heuristic are both past the first window.
4. **For embeddings work**, confirm the 768-dim matches the schema before any change — embeddings-runtime-stinger owns the dim-must-match rule.
5. **Verify every cost, threshold, and model name against the cited source** before asserting it.
6. **Verify cross-links resolve** before declaring done.

## What this pillar does NOT cover

- The identity-model decision that the ladder serves → [`02-identity-model.md`](02-identity-model.md).
- The DDL the enricher writes to → [`03-data-schema-recall.md`](03-data-schema-recall.md).
- The projection the brood bootstraps → [`03-data-schema-recall.md`](03-data-schema-recall.md).
