# Research Summary — Hivenectar Knowledge Corpus

> **Depth:** full corpus (9 source + 45 deep-dive + 9 public documents). **Coverage:** complete as of the corpus audit pass. **No external research** — this skill's foundation is the repo's own knowledge corpus, which IS the research. This file is the `scripture-historian`-style manifest `stinger-forge` consumes before forging guides.

## What this skill is built on

The Hivenectar repo at `C:\Users\mario\GitHub\hivenectar` is a **design/specification corpus** for a semantic memory layer over a source tree. There is no source code — the documents are the spec. The corpus was authored, expanded into 5-doc deep-dives per pillar, audited for hallucinations, and corrected. It is the authoritative foundation for any agent working on Hivenectar.

This skill does not re-research the domain. It **indexes and operationalizes** the existing corpus: each guide distills one pillar and cross-references the relevant Bee-Army Stingers an agent must load to do work in that pillar's domain.

## The six most load-bearing sources

1. [`C:/Users/mario/GitHub/hivenectar/library/knowledge/private/overview.md`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/overview.md) — the entry point. Defines the three design pillars, the hiveantennae worker's four modes, the two-layer (structural/semantic) complementarity, and contains the reading guide. Every other doc derives from this.

2. [`C:/Users/mario/GitHub/hivenectar/library/knowledge/private/architecture/ADR-0001-minted-nectar-over-source-embedded-serial.md`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/architecture/ADR-0001-minted-nectar-over-source-embedded-serial.md) — the least-reversible decision (daemon-minted ULID identity). The spine of the design. Read before arguing about identity.

3. [`C:/Users/mario/GitHub/hivenectar/library/knowledge/private/architecture/ADR-0002-hivenectar-independent-daemon-supervised-by-hivedoctor.md`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/architecture/ADR-0002-hivenectar-independent-daemon-supervised-by-hivedoctor.md) — the process-topology decision: Hivenectar is an independent daemon supervised by hivedoctor, NOT a worker inside the Honeycomb daemon. **Independence is process-layer only** — the data layer (Deep Lake tables, recall union, Portkey, embeddings) is unchanged. Read before any "how is Hivenectar deployed/run" or "is this part of Honeycomb" question. Refines ADR-0001's implicit colocation assumption without superseding the identity decision.

4. [`C:/Users/mario/GitHub/hivenectar/library/knowledge/private/data/source-graph-schema.md`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/data/source-graph-schema.md) — the two-table DDL (`source_graph` + `source_graph_versions`), column-by-column rationale, indexing, tenancy, schema-heal contract. The substrate every other component reads/writes.

5. [`C:/Users/mario/GitHub/hivenectar/library/knowledge/private/ai/identity-and-reassociation.md`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/ai/identity-and-reassociation.md) — the five-step re-association ladder (the hardest algorithm in the system), copy-paste-as-provenance, live-watch vs cold-catch-up.

6. [`C:/Users/mario/GitHub/hivenectar/library/knowledge/private/reference/prior-art-crosswalk.md`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/reference/prior-art-crosswalk.md) — the honest novelty accounting. Maps Hivenectar against 12 prior systems across 5 pillars; defines the narrow, defensible novelty claim. Read before claiming originality.

## Open questions (none blocking)

The corpus audit found and fixed 5 hallucinations; no open questions remain that block guide authorship. The corpus is internally consistent (0 broken links post-fix). The following are **deliberate spec gaps**, not defects — guides must preserve them as gaps, not invent values:

- The TLSH fuzzy-match confidence thresholds are **deliberately unspecified** ("configurable, default tuned during brooding"). No guide may commit a numeric threshold.
- Symbol-level and directory-level nectars are **deferred to v2**. No guide may describe them as shipped.
- The exact `review-matches` sub-flag syntax is **unspecified** (only the bare command is named). No guide may invent `--accept`/`--reject` flags.

## Pillar → guide → Stinger mapping

This is the map `stinger-forge` uses to assign mandatory skill loads. Each pillar guide opens with `> CRITICAL DIRECTIVE` blocks naming the Stingers an agent MUST load before doing work in that pillar.

| Pillar | Guide | Mandatory Stingers (load before proceeding) |
|---|---|---|
| Overview | `guides/01-overview.md` | `knowledge-stinger`, `readme-writing-stinger` |
| Identity model | `guides/02-identity-model.md` | `knowledge-stinger`, `adr-writing-stinger` |
| Data: schema + projection + recall | `guides/03-data-schema-recall.md` | `knowledge-stinger`, `deeplake-dataset-stinger`, `retrieval-stinger` |
| AI: brooding + enricher + embeddings | `guides/04-ai-brooding-enricher.md` | `knowledge-stinger`, `embeddings-runtime-stinger`, `retrieval-stinger` |
| Prior art + novelty | `guides/05-prior-art.md` | `knowledge-stinger`, `adr-writing-stinger` |

The mapping rationale: the corpus is *narrative knowledge documentation* (knowledge-stinger's domain, always relevant). Identity-model decisions are ADRs (adr-writing-stinger). The data layer is Deep Lake tables + hybrid recall (deeplake-dataset-stinger + retrieval-stinger). The AI layer depends on the embeddings daemon (embeddings-runtime-stinger). Prior-art work records decisions (adr-writing-stinger).

## How this skill relates to the Bee Army

This Stinger is paired with **`hivenectar-worker-bee`** (agent at `C:/Users/mario/GitHub/hivenectar/agents/hivenectar-worker-bee.md`, registered in the beekeeper-suit roster). It is a **domain-knowledge Stinger**: the Bee is a persona that enforces corpus integrity, and this Stinger is its procedural arsenal — the corpus map plus the mandatory sibling-skill loads each pillar requires. Unlike the Hivemind Bees (whose agents live in `.cursor/agents/` and Stingers in `.cursor/skills/`), this Bee's artifacts live **in the Hivenectar repo** alongside the corpus it owns, because the corpus is its foundation. The beekeeper-suit arming contract still applies: dispatch with "You are `hivenectar-worker-bee`. Before doing anything else, read your paired Stinger at `skills/hivenectar-stinger/SKILL.md` in full..."
