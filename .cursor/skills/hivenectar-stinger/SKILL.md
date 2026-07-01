---
name: hivenectar-stinger
description: Domain-knowledge Stinger for the Hivenectar semantic-memory-layer design corpus. Loads the corpus map and mandatory sibling-skill directives so any agent doing Hivenectar work (authoring docs, extending the spec, planning implementation, auditing claims) grounds itself in the canonical 63-document corpus and arms the right Bee-Army Stingers first. Use when the user says "work on Hivenectar", "extend the Hivenectar spec", "audit a Hivenectar claim", "add a deep-dive", or any task touching the library/knowledge/private/ Hivenectar corpus.
---

# Hivenectar Stinger

You are working on **Hivenectar** — a semantic memory layer over a source tree that gives every file a stable identity (a daemon-minted ULID "nectar") and an LLM-minted description, then serves both through hybrid recall so an agent can answer *"where is the login logic"* rather than only *"find symbol X."* The design corpus lives at [`library/knowledge/private/`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/) in this repo and is the **single source of truth**. There is no source code in this repo — the documents are the spec.

This skill is your **map of that corpus and your load order for the sibling skills** each pillar requires. It does not re-teach the domain — it routes you to the right corpus docs and arms you with the right Stingers before you do work.

## When to use

Invoke this skill when the task touches Hivenectar in any way:

- Authoring, editing, or extending a document under `library/knowledge/private/` or `library/knowledge/public/`.
- Auditing a claim against the corpus (verifying a number, attribution, or capability).
- Planning or scaffolding the implementation (the corpus is the contract the implementation must conform to).
- Answering "how does Hivenectar handle X" from the corpus.
- Reviewing a PR that touches the corpus or the planned implementation.

Do NOT use this skill for work unrelated to Hivenectar, even if it involves Deep Lake, embeddings, or recall in another repo — those have their own Stingers.

## The corpus (your reference material)

The corpus is organized as **9 source documents**, each expanded into a **5-document deep-dive**, plus **9 customer-facing public docs**. Full map: [`research/index.md`](research/index.md). Load-order summary: [`research/research-summary.md`](research/research-summary.md).

**Read [`research/index.md`](research/index.md) before any corpus work.** It resolves every citation path and prevents drift (the corpus is the source of truth — never copy it).

## The pillar guides (load the one matching your task)

Each guide distills one corpus pillar and opens with **CRITICAL DIRECTIVE** blocks naming the sibling Stingers you MUST load before proceeding. The reinforcement is deliberate: you are told twice (here in SKILL.md, again at the top of the guide) so the load is not skipped.

| Pillar | Guide | Load this guide when... |
|---|---|---|
| Overview | [`guides/01-overview.md`](guides/01-overview.md) **(MUST LOAD → also loads `knowledge-stinger`, `readme-writing-stinger`)** | you need the 30-second thesis, the three pillars, the worker's four modes, or you're orienting |
| Identity model | [`guides/02-identity-model.md`](guides/02-identity-model.md) **(MUST LOAD → also loads `knowledge-stinger`, `adr-writing-stinger`)** | the task touches identity, nectars, ULIDs, re-association, or ADR-0001 |
| Data: schema + projection + recall | [`guides/03-data-schema-recall.md`](guides/03-data-schema-recall.md) **(MUST LOAD → also loads `knowledge-stinger`, `deeplake-dataset-stinger`, `retrieval-stinger`)** | the task touches the Deep Lake tables, the projection, or the recall arm |
| AI: brooding + enricher + embeddings | [`guides/04-ai-brooding-enricher.md`](guides/04-ai-brooding-enricher.md) **(MUST LOAD → also loads `knowledge-stinger`, `embeddings-runtime-stinger`, `retrieval-stinger`)** | the task touches description generation, Gemini/Portkey, batching, or the embeddings daemon |
| Prior art + novelty | [`guides/05-prior-art.md`](guides/05-prior-art.md) **(MUST LOAD → also loads `knowledge-stinger`, `adr-writing-stinger`)** | you're comparing Hivenectar to another tool or making a novelty claim |

If a task spans pillars, load every matching guide. The guides are mutually referential — each links to the others where their domains meet.

### Cross-cutting: the two ADRs

Two architecture decisions are load-bearing across pillars, not contained in any single one. Load the relevant ADR before any task that touches its domain:

- **[ADR-0001](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/architecture/ADR-0001-minted-nectar-over-source-embedded-serial.md)** — the identity model (daemon-minted ULID, the two-table split, the re-association ladder). The least-reversible decision; the spine of the design. Read before arguing about identity. Detailed routing in [`guides/02-identity-model.md`](guides/02-identity-model.md).
- **[ADR-0002](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/architecture/ADR-0002-hivenectar-independent-daemon-supervised-by-hivedoctor.md)** — the process topology (Hivenectar is an independent daemon supervised by **hivedoctor**, NOT a worker inside the Honeycomb daemon). **Independence is process-layer only** — the data layer (Deep Lake tables, recall union, Portkey, embeddings) is unchanged. Refines ADR-0001's implicit colocation assumption without superseding the identity decision. Read before any "how is Hivenectar deployed/run" or "is this part of Honeycomb" question. 13 corpus sites reference it.

## Critical directives (apply to ALL Hivenectar work)

These are non-negotiable. They exist because agents have violated each one in the past and corrupted the corpus.

1. **Ground every factual claim in a cited corpus doc.** A number, column type, threshold, command, or attribution that is not traceable to a source doc is a hallucination. When in doubt, open the cited doc and verify. See [`guides/00-principles.md`](guides/00-principles.md).

2. **Never copy corpus files into the skill.** The skill's `research/` folder is a manifest that points at the corpus by relative path. Duplication drifts. The corpus itself documents why at `library/knowledge/private/data/portable-registry.md` (the projection-not-sidecar principle).

3. **Preserve deliberate spec gaps.** Three values are unspecified on purpose: TLSH confidence thresholds ("tuned during brooding", no number), symbol/directory nectars (deferred to v2), and `review-matches` sub-flag syntax. Do not invent values for any of these. See [`research/research-summary.md`](research/research-summary.md) § Open questions.

4. **Load the sibling Stingers named in the guide's CRITICAL DIRECTIVE block before doing the work.** The beekeeper-suit arming contract requires it; an unarmed agent is a failed dispatch. The directives are reinforced twice (SKILL.md + guide) for a reason.

5. **Write in present tense.** The corpus is README-driven-development: the docs describe the system as if it exists because they ARE the spec. No "will", "coming soon", or future tense.

6. **Never write a PRD or IRD into the knowledge corpus.** The corpus is narrative knowledge + ADRs + standards. Product requirements live in `library/requirements/`; issues in `library/issues/`. `knowledge-stinger` owns the knowledge tree; `library-stinger` owns requirements. Do not cross the streams.

7. **Conform to the documentation framework.** Every corpus doc follows the universal header (`> Category: <X> | Version: <Y> | Date: <Month YYYY> | Status: <Z>`), relative-path cross-links, Mermaid-only diagrams (no colors, no click), and no time-sensitive language. Read [`C:/Users/mario/GitHub/hivenectar/library/knowledge/private/standards/documentation-framework.md`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/standards/documentation-framework.md) before authoring.

## Procedure (the shape of Hivenectar work)

1. **Classify the task.** Which pillar does it touch? Load the matching guide(s) above. The guide tells you which corpus docs to read and which sibling Stingers to arm.
2. **Arm the sibling Stingers.** Each guide opens with `> CRITICAL DIRECTIVE: load <stinger>` blocks. Load them before reading the corpus — the Stinger tells you *how* to do the work; the corpus tells you *what* the work is.
3. **Read the cited corpus docs.** Verify every claim you're about to make or depend on against the cited source. The deep-dive `-technical-specification.md` files hold the ground-truth specifics.
4. **Do the work** following the guide's procedure and the loaded Stinger's method.
5. **Verify.** Cross-links resolve (run the link scan in `examples/corpus-link-scan.md`); claims trace to source; no invented values; documentation-framework conformance holds.

## Examples and templates

- [`examples/extend-a-deep-dive.md`](examples/extend-a-deep-dive.md) — worked example: adding a new section to an existing deep-dive, showing the citation + load + verify loop.
- [`examples/audit-a-claim.md`](examples/audit-a-claim.md) — worked example: auditing a deep-dive claim against its source doc (the procedure that caught the 5 corpus hallucinations).
- [`templates/new-deep-dive.md`](templates/new-deep-dive.md) — stub for authoring a new 5-doc deep-dive expansion of a source doc.

## What this skill is NOT

- **Paired with `hivenectar-worker-bee`.** This Stinger is the procedural arsenal for the `hivenectar-worker-bee` agent (at [`C:/Users/mario/GitHub/hivenectar/agents/hivenectar-worker-bee.md`](C:/Users/mario/GitHub/hivenectar/agents/hivenectar-worker-bee.md), registered in the beekeeper-suit roster). The Bee enforces corpus integrity; this Stinger provides the corpus map and the mandatory sibling-skill loads.
- **Not a re-teaching of the domain.** The corpus teaches the domain. This skill routes you to it.
- **Not a substitute for the sibling Stingers.** It tells you WHICH to load; it does not inline their content. An agent that reads only this SKILL.md and skips the CRITICAL DIRECTIVE loads is doing it wrong.
- **Not for non-Hivenectar work.** Deep Lake, embeddings, and recall work in other repos have their own Stingers; this one scopes to the Hivenectar corpus in THIS repo.

---

*Forged by `stinger-forge` from the Hivenectar knowledge corpus. The corpus is the foundation; this skill is the map and the load order. Always cite, never duplicate, never invent.*
