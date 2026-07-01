# Hivenectar Worker Bee - Beekeeper-Suit's Guide

The Beekeeper-Suit routing skill's record of when to invoke `hivenectar-worker-bee`. Use this guide to decide whether a user request belongs to this Bee.

**Bee:** `C:\Users\mario\GitHub\hivenectar\agents\hivenectar-worker-bee.md` *(in the Hivenectar repo — see "Repo scoping" below)*
**Stinger:** `C:\Users\mario\.agents\skills\hivenectar-stinger\` *(global, so the Skill tool can load it)*
**Command Brief:** none — this Bee was forged directly from the Hivenectar knowledge corpus (the corpus IS the brief). See the Bee file's footer.
**Trigger policy:** proactive

> **Repo scoping note.** This Bee's artifacts are **split across two locations**: the Stinger lives at the standard global skills path (`~/.agents/skills/hivenectar-stinger/`) so the Skill tool can index and load it, while the agent file lives in the Hivenectar repo (`C:\Users\mario\GitHub\hivenectar\agents\`) alongside the corpus it owns. The Stinger references the corpus by absolute path (`C:\Users\mario\GitHub\hivenectar\library\knowledge\...`) to bridge the two locations. If the repo moves, the agent path AND every absolute corpus reference in the Stinger need updating. The beekeeper-suit arming line applies: dispatch with "You are `hivenectar-worker-bee`. Before doing anything else, read your paired Stinger at `C:\Users\mario\.agents\skills\hivenectar-stinger\SKILL.md` in full..."

---

## Domain

`hivenectar-worker-bee` owns the **Hivenectar design corpus**: the 63-document specification (9 source docs + 45 deep-dive expansions + 9 customer-facing public docs) at `library/knowledge/` in the Hivenectar repo. Hivenectar is a semantic memory layer over a source tree — it gives every file a stable identity (a daemon-minted ULID "nectar") and an LLM-minted description, served through hybrid recall. There is no source code in the repo; the documents ARE the spec (README-driven development). This Bee authors new docs, extends existing deep-dives, audits claims against their cited sources, and translates private engineering docs into public customer-facing docs — all while enforcing corpus integrity (cite-or-cut, preserve deliberate gaps, never duplicate, honor the documentation framework).

This is a **domain-knowledge Bee**, not an implementation Bee. It owns the spec, not the code.

## Trigger phrases

Route to `hivenectar-worker-bee` when the user says any of:

- "work on Hivenectar"
- "extend the Hivenectar spec" / "add a deep-dive to Hivenectar"
- "audit a Hivenectar claim" / "verify this against the Hivenectar corpus"
- "translate this to public docs" / "write the customer-facing version"
- "update the Hivenectar knowledge base"
- "how does Hivenectar handle X" (when the answer should be sourced/edited in the corpus)

Or when the request implicitly involves the `library/knowledge/` tree in the Hivenectar repo.

## Do NOT route when

- **Hivemind TypeScript/Node implementation work** — that's `typescript-node-worker-bee` and the Hivemind-specific Bees. This Bee owns the Hivenectar *spec*, not the Honeycomb daemon *code*.
- **Deep Lake schema work in the Hivemind repo** — `deeplake-dataset-worker-bee`. This Bee's data-pillar guide *cites* the Hivenectar schema doc but does not edit Hivemind's `src/deeplake-schema.ts`.
- **Generic documentation in another repo** — `knowledge-worker-bee` or `library-worker-bee`. This Bee scopes to the Hivenectar corpus in THIS repo only.
- **Product PRDs or issue IRDs** — `library-worker-bee`. The Hivenectar corpus's `-user-stories.md` files are engineering/operator scope, not features.

If a request straddles Hivenectar spec work and Hivemind implementation, route this Bee for the spec side and hand off to the implementation Bee for the code side.

## Inputs the Bee needs

Before invoking, ensure the user has provided (or you can infer):

- **The pillar(s) in scope** — overview, identity-model, data, AI, or prior-art. If unclear, the Bee classifies from the task description (Step 1 of its procedure).
- **The specific doc or claim** to extend/audit, OR confirmation that a full-corpus pass is wanted.
- **For public translations**, confirmation that customer-facing register is intended (the public docs strip all engineering internals).
- **Which ADR(s) a decision-shaping task engages** — the corpus has two load-bearing ADRs: **ADR-0001** (identity model: daemon-minted ULID, the two-table split) and **ADR-0002** (process topology: Hivenectar is an independent daemon supervised by hivedoctor, NOT a worker inside the Honeycomb daemon; independence is process-layer only, data layer unchanged). If a task touches deployment, process boundaries, or "is this part of Honeycomb," ADR-0002 governs; if it touches identity/nectars/re-association, ADR-0001 governs. The Stinger's SKILL.md § "Cross-cutting: the two ADRs" routes in detail.

If the task is ambiguous between pillars, the Bee loads SKILL.md and routes itself — no need to pre-classify for the user.

## Outputs the Bee produces

- **Extended or new corpus docs** under `library/knowledge/private/<domain>/` (conforming to the documentation framework: universal header, Mermaid-only diagrams, relative-path links, no time-sensitive language).
- **Public translations** under `library/knowledge/public/{overview,guides,faqs}/`.
- **Audit findings** (when invoked to verify claims) — a report quoting both the deep-dive claim and the source-doc ground truth, classifying each as confirmed/contradiction/invention/gap.
- **A clean link scan** — the Bee runs `examples/corpus-link-scan.md` and reports 0 broken links before declaring done.

## Multi-Bee sequences this Bee participates in

- **Hivenectar spec → Hivemind implementation** — this Bee produces/updates the spec; `typescript-node-worker-bee` (and the Hivemind data/AI Bees) implement against it. The corpus is the contract the implementation conforms to.
- **Hivenectar spec → public docs** — this Bee owns both sides of the private→public translation (no second Bee needed; the public docs are this Bee's output surface).

## Critical directives the orchestrator should respect

- **Arm the pillar's sibling Stingers before dispatch** — each guide's CRITICAL DIRECTIVE block names them (e.g. `deeplake-dataset-stinger` + `retrieval-stinger` for the data pillar). The beekeeper-suit arming contract applies; an unarmed Bee is a failed dispatch.
- **Do not ask this Bee to invent values for deliberate spec gaps** — the TLSH thresholds, symbol/directory nectars, and `review-matches` sub-flags are unspecified on purpose. If a task seems to need them, the Bee surfaces the gap; the orchestrator should not pressure a value.
- **The corpus wins over memory** — if this Bee's output conflicts with a claim you remember from training data, the corpus is authoritative. Hivenectar is a novel composition; do not generalize from generic code-indexing-tool knowledge.

(Full list lives in the Bee file's `## Critical directives` section.)

---

*Part of Beekeeper-Suit's roster. See [`../SKILL.md`](../SKILL.md) for the full Army. This is the first Bee scoped to a documentation corpus rather than the Hivemind codebase — the Army's Hivemind-tuning preamble (SKILL.md line 11) does not apply to this Bee; its scope is the Hivenectar repo.*
