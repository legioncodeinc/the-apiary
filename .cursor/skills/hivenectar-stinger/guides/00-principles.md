# 00 — Principles: Corpus Integrity

> The Hivenectar knowledge corpus is the single source of truth for the design. These principles govern every interaction with it. They exist because each one was violated at least once during the corpus's own construction, and each violation had to be found and undone.

## Principle 1 — Cite or cut

Every factual claim in corpus work must trace to a cited source doc. A number, column type, threshold, command, formula, or attribution that is not traceable is a hallucination until proven otherwise.

- The corpus was audited and 5 hallucinations were removed (invented confidence thresholds, a dropped recall arm, invented CLI flags, a misattributed helper, flags applied to the wrong command).
- When you make a claim, cite the source doc by relative path. When you read a claim, open the cited doc and verify.
- The deep-dive `-technical-specification.md` files hold ground-truth specifics. The source docs (the canonical 9) hold the authoritative wording. When they conflict, the source doc wins.
- See [`examples/audit-a-claim.md`](../examples/audit-a-claim.md) for the verification procedure that caught the 5 hallucinations.

## Principle 2 — Never duplicate the corpus

The skill's [`research/index.md`](../research/index.md) points at the corpus by relative path. Do not copy corpus files into the skill, into another doc, or into a response. Duplication drifts; the next edit to one copy desynchronizes the other.

This is the same principle the corpus itself documents at `C:/Users/mario/GitHub/hivenectar/library/knowledge/private/data/portable-registry.md`: a projection points at the source of truth, it does not become a second source of truth. Quote excerpts only when verifying a specific claim, and always cite the path.

## Principle 3 — Preserve deliberate spec gaps

Three values in the corpus are unspecified **on purpose**. Inventing values for them is a hallucination, even if the invented value "seems reasonable."

| Gap | Where | Why it's a gap | What NOT to do |
|---|---|---|---|
| TLSH confidence thresholds | `ai/identity-and-reassociation.md` | "configurable, default tuned during brooding" — determined empirically at runtime | Do not commit a numeric threshold (no `0.75`, no `0.4`) |
| Symbol-level & directory nectars | ADR-0001 § non-goals | deferred to v2; file-granular in v1 | Do not describe them as shipped |
| `review-matches` sub-flag syntax | `ai/identity-and-reassociation.md` | only the bare command is named | Do not invent `--accept`/`--reject` flags |

If a task seems to require one of these values, the correct response is to surface the gap to the user, not to fill it.

## Principle 4 — The corpus is README-driven

The documents describe the system **in present tense as if it exists**, because they ARE the spec. There is no source code in this repo; the implementation target is the sibling Honeycomb daemon. Write "Hivenectar does X", never "Hivenectar will do X" or "coming soon". If you cannot write it in present tense, you have not decided to build it.

## Principle 5 — The documentation framework is binding

Every corpus doc conforms to [`C:/Users/mario/GitHub/hivenectar/library/knowledge/private/standards/documentation-framework.md`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/standards/documentation-framework.md). Before authoring or editing any corpus doc, confirm you can satisfy:

- Universal header: `# Title` → `> Category: <X> | Version: <Y> | Date: <Month YYYY> | Status: <Active|Draft|Archived|Canonical>` → one-sentence description → `**Related:**` relative-link list.
- Mermaid-only diagrams; no explicit colors (breaks dark mode), no `click` events, no spaces in node IDs.
- Relative-path cross-links; no duplication of prose that lives elsewhere.
- No time-sensitive language ("currently", "recently", "as of"). Use explicit dates.
- One topic per document; split if a doc exceeds ~500 lines.

A doc that violates the framework is defective regardless of its content quality.

## Principle 6 — Load order is mandatory

The sibling Stingers named in each guide's `> CRITICAL DIRECTIVE` block are not optional. An agent doing Hivenectar work without its pillar's Stingers loaded is operating without its method — like a carpenter showing up without tools. The directives are reinforced twice (in SKILL.md and again at the guide's head) because agents have skipped them when stated once.

When `command-center` or the beekeeper-suit arms a Bee, the arming line requires the Stinger be read first. The same discipline applies here: read the CRITICAL DIRECTIVE, load the named Stinger, then proceed.

## Principle 7 — Do not cross the requirements boundary

The knowledge corpus (`library/knowledge/`) holds narrative knowledge, ADRs, and standards. Product requirements (`library/requirements/`) holds PRDs. Issues (`library/issues/`) holds IRDs. `knowledge-stinger` owns the knowledge tree; `library-stinger` owns requirements. A Hivenectar deep-dive is **not** a PRD — the `-user-stories.md` files are engineering/operator scope (daemon, enricher, teammate, reviewer), not product features. Do not author feature PRDs into the knowledge corpus, and do not write knowledge docs into the requirements tree.
