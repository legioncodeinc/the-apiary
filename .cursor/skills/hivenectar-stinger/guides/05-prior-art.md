# 05 — Prior Art & Novelty Pillar

> **CRITICAL DIRECTIVE: load `knowledge-stinger` and `adr-writing-stinger` before proceeding.** This pillar is a reference survey (knowledge-stinger's domain) that feeds an architectural-decision context (adr-writing-stinger's domain). Any novelty claim or "how is this different from X" answer is a decision-shaping assertion and must be made honestly. An unarmed agent working this pillar is a failed dispatch. Read both Stingers' SKILL.md files in full before touching any corpus doc here.
>
> Resolve the Stingers by their conventional paths. If installed globally: `C:\Users\mario\.agents\skills\knowledge-stinger\SKILL.md` and `C:\Users\mario\.agents\skills\adr-writing-stinger\SKILL.md`. The beekeeper-suit arming contract applies.

## What this pillar covers

The prior-art pillar owns the **honest novelty accounting**. It maps Hivenectar against 12 surveyed systems across 5 pillars, credits what is borrowed, identifies where Hivenectar diverges, and states the narrow, defensible novelty claim. This is the pillar that prevents both reinventing wheels and overclaiming originality.

Load this guide when the task is: comparing Hivenectar to another tool; making a novelty claim; evaluating "should we build X or is it prior art"; writing a competitive or integrations doc; or any external communication that touches Hivenectar's originality.

## The corpus docs in this pillar

| Doc (relative to skill root) | Read it for |
|---|---|
| [`C:/Users/mario/GitHub/hivenectar/library/knowledge/private/reference/prior-art-crosswalk.md`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/reference/prior-art-crosswalk.md) | The authoritative survey. The 5-pillar matrix (12 systems), the borrow-credit table, the divergence table, the verbatim novelty claim, the source links. |
| [`C:/Users/mario/GitHub/hivenectar/library/knowledge/private/reference/prior-art-deep-dive/prior-art-technical-specification.md`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/reference/prior-art-deep-dive/prior-art-technical-specification.md) | The pillar matrix, borrow table, and divergence table carried verbatim with annotations. |
| The other 4 deep-dive docs in [`C:/Users/mario/GitHub/hivenectar/library/knowledge/private/reference/prior-art-deep-dive/`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/reference/prior-art-deep-dive/) | introduction-and-theory, user-stories, ecosystem-story-arc, conclusion-and-deliverables. |

## The load-bearing claims (verify before relying on)

- **The 5 pillars:** stable identity, LLM description, semantic store, watcher-driven, daemon-minted. Hivenectar is the only surveyed system combining all five.
- **The 12 surveyed systems:** Hivenectar, Aura, Orbit, Cartog, Grove, Mimir, Smith, synrepo, CodeRAG, Codebase Cortex, Context+, NeuralMind. (codeindex is also discussed in text but not in the pillar matrix.)
- **The verbatim novelty claim** (cite word-for-word; do not paraphrase): *"the first system to combine daemon-minted file identity, LLM file description, Deep Lake persistence, and union-recall with conversation memory, in a single daemon that already serves a multi-harness AI coding memory system."*
- **Closest single system:** Smith — covers the description pillar and the committed-cache pillar partially, but lacks minted identity, Deep Lake persistence, and union-recall integration entirely.
- **Key attributions (do not transpose):**
  - Aura = function-granular, identity anchor + content hash, VCS (shadow branch).
  - Mimir = symbol-granular, Roslyn-style `SymbolId`, "identity is explicit not heuristic."
  - Smith = per-file `.meta`, NO stable identity, source-mutating (`CLAUDE.md`/`constitution.md`), N=10 approval batching.
  - Grove = `{filePath}::{qualifiedName}@{contentSHA}`, SQLite `.grove/grove.db`.
  - Cartog = Merkle tree of content hashes, `--debounce`.
  - CodeRAG family (CodeRAG, Cortex, Context+, cba) = AST-chunk enrichment, per-symbol embeddings.

## The honesty contract

This pillar exists to prevent overclaiming. Two rules govern any novelty assertion:

1. **Credit before claim.** Before stating what Hivenectar does first, state what it borrows (from Aura: the two-table split; from Mimir: minted identity as first-class; from Smith: lazy description with staleness tracking; from Grove/Cartog: delta indexing). The borrow-credit table in `prior-art-crosswalk.md` is the canonical source.

2. **Narrow over broad.** The broad claim ("first codebase semantic search") is false and must not be made. The narrow claim (the verbatim sentence above) is defensible. When in doubt, cite the narrow claim verbatim and let the reader generalize — do not generalize for them.

## Related guides

- [`01-overview.md`](01-overview.md) — the overview's conclusion references the novelty claim.
- [`02-identity-model.md`](02-identity-model.md) — ADR-0001 cites Aura and Mimir as intellectual predecessors; this pillar is the full survey behind those citations.

## Procedure

1. **Arm.** Load `knowledge-stinger` and `adr-writing-stinger` (per the CRITICAL DIRECTIVE). Confirm [`00-principles.md`](00-principles.md).
2. **For any comparison**, read `reference/prior-art-crosswalk.md` first. The pillar matrix is the authoritative map.
3. **For any novelty claim**, locate the verbatim claim in `prior-art-crosswalk.md` (and reproduced in `prior-art-deep-dive/prior-art-conclusion-and-deliverables.md`). Cite it word-for-word; do not paraphrase.
4. **For attributions**, verify the system → pillar mapping against the pillar matrix. Do not transpose a property to the wrong system.
5. **For new tools** not in the survey, classify against the 5 pillars and write a one-paragraph closest-system comparison (the procedure is codified as US-PA-021 in the deep-dive user-stories).
6. **Verify cross-links resolve** before declaring done.

## What this pillar does NOT cover

- The identity-model decision itself (only its prior-art context) → [`02-identity-model.md`](02-identity-model.md).
- The implementation details of any surveyed system — this pillar is a survey, not an integration guide.
- The full borrow rationale for each predecessor → that lives inline in the relevant deep-dives of the other pillars.
