# Example: Extending a Deep-Dive

> Worked example of the citation → load → verify loop when adding a new section to an existing corpus doc. Demonstrates [`../guides/00-principles.md`](../guides/00-principles.md) applied end to end.

## The task (hypothetical)

> "Add a section to the brooding deep-dive covering how brooding handles symlinks."

## Step 1 — Classify the pillar

Symlink handling during file discovery is part of the brooding pipeline → **AI pillar**. Load [`../guides/04-ai-brooding-enricher.md`](../guides/04-ai-brooding-enricher.md).

## Step 2 — Arm the sibling Stingers (CRITICAL DIRECTIVE)

Guide 04 opens with: *load `knowledge-stinger`, `embeddings-runtime-stinger`, `retrieval-stinger`*. Read all three SKILL.md files in full before touching the corpus. knowledge-stinger governs the doc format; the other two govern the technical content the section must be consistent with.

## Step 3 — Read the cited corpus docs

- [`C:/Users/mario/GitHub/hivenectar/library/knowledge/private/ai/brooding-pipeline.md`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/ai/brooding-pipeline.md) — the § "File discovery" subsection says discovery reuses the CodeGraph's `git ls-files --cached --others --exclude-standard -z` logic verbatim, with a manual recursive walk fallback.

## Step 4 — Verify the claim before writing (Principle 1: cite or cut)

The source doc says discovery "reuses the existing CodeGraph discovery logic verbatim" and references "the main corpus's `data/codebase-graph.md`". It does **NOT** mention symlinks. Two honest options:

- **(a) If the sibling CodeGraph doc specifies symlink handling:** cite it (via the brooding doc's reference) and write the section grounded in that citation.
- **(b) If no source specifies symlink handling:** the correct action is to **surface the gap to the user**, NOT to invent behavior. Writing "brooding follows symlinks" without a source is a hallucination (Principle 1). Writing "brooding skips symlinks" is equally a hallucination.

In this hypothetical, the honest output is:

> The corpus does not currently specify symlink handling during brooding discovery. The discovery step reuses the CodeGraph's `git ls-files` logic ([`C:/Users/mario/GitHub/hivenectar/library/knowledge/private/ai/brooding-pipeline.md`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/ai/brooding-pipeline.md) § File discovery), and the CodeGraph's own symlink behavior would need to be checked in the sibling repo before this section can be written. This is a gap to raise with the user, not to fill by assumption.

## Step 5 — Conform to the documentation framework

If the gap is resolved (the user confirms the behavior with a source), the new section must:

- Use the universal header if it's a new doc, or match the existing doc's header style if it's a section.
- Cite the source by relative path.
- Use Mermaid for any diagram (no colors, no click).
- No time-sensitive language.

## Step 6 — Verify cross-links resolve

Run the scan in [`corpus-link-scan.md`](corpus-link-scan.md). Any new link added must resolve.

## The lesson

The citation → load → verify loop caught a gap *before* a hallucination was written. That is the skill working as designed. Most "extensions" turn out to be either well-grounded (the source supports them) or gaps (the source is silent and the user must decide). The skill prevents the third, wrong outcome: invention.
