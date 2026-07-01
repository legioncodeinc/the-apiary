# Example: Auditing a Claim

> Worked example of verifying a deep-dive claim against its source doc. This is the procedure that caught the 5 corpus hallucinations during the re-ingest pass. Demonstrates [`../guides/00-principles.md`](../guides/00-principles.md) § Principle 1.

## The task (real, from the corpus audit)

> "A deep-dive claims the TLSH fuzzy-match high-confidence threshold is `>= 0.75`. Verify it."

## Step 1 — Classify the pillar

TLSH confidence is part of the re-association ladder → spans the **identity-model** and **AI** pillars. Load [`../guides/02-identity-model.md`](../guides/02-identity-model.md) and [`../guides/04-ai-brooding-enricher.md`](../guides/04-ai-brooding-enricher.md).

## Step 2 — Arm the sibling Stingers

Both guides' CRITICAL DIRECTIVE blocks require `knowledge-stinger`; guide 04 also requires `embeddings-runtime-stinger` and `retrieval-stinger`. Read them before proceeding.

## Step 3 — Locate the authoritative source

The ladder algorithm's authoritative source is [`C:/Users/mario/GitHub/hivenectar/library/knowledge/private/ai/identity-and-reassociation.md`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/ai/identity-and-reassociation.md). The deep-dive that made the claim is at `ai/identity-deep-dive/reassociation-technical-specification.md`.

## Step 4 — Quote both sides and compare

Open the source doc and find the relevant passage. Grep for "confidence" / "threshold":

**Source says** (identity-and-reassociation.md, the ladder § Step 4):
> "If confidence is below a 'high' band **(configurable, default tuned during brooding)**, the daemon does not silently claim the nectar..."

**Deep-dive claims** (reassociation-technical-specification.md):
> "| High confidence | `confidence >= 0.75` (tunable) |"

## Step 5 — Apply Principle 1 (cite or cut) + Principle 3 (preserve gaps)

The source **deliberately specifies no number** — "default tuned during brooding" means the value is determined empirically at runtime, not fixed in the spec. The deep-dive's `0.75` (and a companion `0.4`) appear nowhere in the source. This is a **CONFIRMED hallucination** of type *invention*.

The correct fix is NOT to substitute a different number — it's to restore the source's deliberate hedge: "above the configurable high band (default tuned during brooding), no concrete value committed by the spec."

## Step 6 — Record and fix

The audit found 5 such hallucinations total (the two confidence numbers, a dropped `memories` recall arm, invented `--accept`/`--reject` CLI flags, and a `sqlIdent` helper propagated from a miswritten AGENTS.md). Each was fixed by restoring the source's actual wording or removing the invented specific.

## The lessons (why this procedure matters)

1. **The source wins.** When a deep-dive and its source conflict, the source is authoritative — the deep-dives are derived.
2. **Deliberate gaps are not invitations.** A spec that says "tuned during brooding" is silent on purpose; filling the silence with a plausible number is still a hallucination.
3. **Auditors hallucinate too.** During the real audit, three auditor agents flagged 5 *correct* claims as "possible inventions" because they hadn't been given the enricher/brooding source docs. Personal verification against the source caught both the real hallucinations AND the auditor false-positives. Never trust an audit finding you haven't personally verified by opening the source.
4. **The verification is mechanical.** Grep the source for the claim's key terms. If the source is silent, the claim is a gap or a hallucination — there is no third option.

This procedure is the single most valuable output of the corpus construction. Run it on any factual claim before relying on it.
