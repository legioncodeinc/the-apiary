# 02 — Identity Model Pillar

> **CRITICAL DIRECTIVE: load `knowledge-stinger` and `adr-writing-stinger` before proceeding.** This pillar's source doc is an ADR (Nygard format: Context / Decision / Consequences / Alternatives), so adr-writing-stinger's method governs any edit to it. The deep-dives are narrative knowledge (knowledge-stinger's domain). An unarmed agent working this pillar is a failed dispatch. Read both Stingers' SKILL.md files in full before touching any corpus doc here.
>
> Resolve the Stingers by their conventional paths. If installed globally: `C:\Users\mario\.agents\skills\knowledge-stinger\SKILL.md` and `C:\Users\mario\.agents\skills\adr-writing-stinger\SKILL.md`. The beekeeper-suit arming contract applies.

## What this pillar covers

The identity model is the **least-reversible decision** in the Hivenectar design — the spine of everything. It determines the database schema, the re-association algorithm, the watcher contract, the fresh-clone story, and the team-share path. This pillar owns the decision (ADR-0001) and its consequences.

Load this guide when the task touches: file identity, nectars, ULIDs, re-association, the ladder algorithm, copy-paste provenance, cold catch-up, OR any argument about how identity "should" work. **Read ADR-0001 before arguing about serials-in-source** — the alternatives were considered and rejected for documented reasons.

## The corpus docs in this pillar

| Doc (relative to skill root) | Read it for |
|---|---|
| [`C:/Users/mario/GitHub/hivenectar/library/knowledge/private/architecture/ADR-0001-minted-nectar-over-source-embedded-serial.md`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/architecture/ADR-0001-minted-nectar-over-source-embedded-serial.md) | The authoritative ADR. Context, 7 decision drivers, Options A/B/C/D (+ xattrs, path, symbol-granular) each with appeal + rejection reason, the decision (Option C), positive/negative consequences, reversibility. **This is the source of truth for the identity decision.** |
| [`C:/Users/mario/GitHub/hivenectar/library/knowledge/private/architecture/identity-model/identity-model-introduction-and-theory.md`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/architecture/identity-model/identity-model-introduction-and-theory.md) | The conceptual essay: "a file on disk has no stable identity of its own"; the Aura/Mimir intellectual lineage. |
| [`C:/Users/mario/GitHub/hivenectar/library/knowledge/private/architecture/identity-model/identity-model-technical-specification.md`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/architecture/identity-model/identity-model-technical-specification.md) | Option C's contract: ULID format, minting triggers, the no-source-mutation invariant, universal applicability, FR-8 compliance, fresh-clone portability. |
| [`C:/Users/mario/GitHub/hivenectar/library/knowledge/private/architecture/identity-model/identity-model-user-stories.md`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/architecture/identity-model/identity-model-user-stories.md) | 25 user stories with acceptance criteria derived from the ADR's decision drivers. |
| [`C:/Users/mario/GitHub/hivenectar/library/knowledge/private/architecture/identity-model/identity-model-ecosystem-story-arc.md`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/architecture/identity-model/identity-model-ecosystem-story-arc.md) | How the identity decision cascades: mint → Deep Lake row → ladder → `derived_from` edge → projection → recall. |
| [`C:/Users/mario/GitHub/hivenectar/library/knowledge/private/architecture/identity-model/identity-model-conclusion-and-deliverables.md`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/architecture/identity-model/identity-model-conclusion-and-deliverables.md) | Consequences, reversibility analysis, the one-sentence rejection table for all 6 alternatives. |
| [`C:/Users/mario/GitHub/hivenectar/library/knowledge/private/ai/identity-and-reassociation.md`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/ai/identity-and-reassociation.md) | The re-association ladder algorithm — the operational consequence of the identity decision. Cross-pillar with [`04-ai-brooding-enricher.md`](04-ai-brooding-enricher.md) but the *identity* angle lives here. |
| [`C:/Users/mario/GitHub/hivenectar/library/knowledge/private/architecture/ADR-0002-hivenectar-independent-daemon-supervised-by-hivedoctor.md`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/architecture/ADR-0002-hivenectar-independent-daemon-supervised-by-hivedoctor.md) | The process-topology companion decision. **Refines, does NOT supersede, ADR-0001.** ADR-0001's identity model (ULID, two-table split, ladder) is independent of process topology and stands fully. ADR-0002 only changes where hiveantennae *runs* (independent daemon under hivedoctor, not a Honeycomb worker) — not what it *is*. Read ADR-0002 when a task asks "is this a Honeycomb feature" or "how is Hivenectar deployed." |

## The load-bearing claims (verify before relying on)

- **Option C is chosen:** daemon-minted ULID, never embedded in source. ULID = 26 chars, Crockford base32, uppercase, 48-bit timestamp + 80-bit randomness.
- **Minting happens in exactly two situations:** brooding (first-seen) and copy event. Never elsewhere.
- **The ladder has 5 steps:** (1) path+mtime+size exact, (2) path match + content changed, (3) exact content-hash match to a missing file, (4) fuzzy TLSH match to a missing file, (5) mint new. First match wins.
- **Re-association does not guess.** Low-confidence fuzzy matches are surfaced for human review (`honeycomb hivenectar review-matches`), NEVER auto-claimed. A mis-association is worse than a new nectar because it corrupts the history chain.
- **Nectars are never deleted by the ladder, never reused.** Pruning is a separate, explicit, human-triggered, conservative operation (`prune --confirm`, 30-day grace).
- **Copy-paste sets `derived_from_nectar` + `fork_content_hash`** — the copy is its own identity, permanently linked to its source.
- **No source mutation.** hiveantennae never writes into source files. The only file it writes is `.honeycomb/nectars.json` (a regenerable projection).

**Deliberate spec gaps (do NOT invent values):** the TLSH confidence thresholds are "configurable, default tuned during brooding" with NO number; `review-matches` sub-flag syntax is unspecified. See [`00-principles.md`](00-principles.md) § Principle 3.

## The rejection table (the alternatives — do not re-litigate without reading the ADR)

| Option | One-sentence rejection |
|---|---|
| A — source-embedded serial | Collides with the AGPL header on line 1, makes line 1 conflict-prone, breaks on copy-paste (duplicate-identity ambiguity), no comment syntax for JSON/.env/binaries. |
| B — content hash as identity | Churns per edit — not actually stable; path-as-identity one layer down. |
| D — SQLite sidecar | Violates FR-8 (Deep Lake is the only durable store). |
| xattrs / NTFS ADS | Miserable Windows tooling, git strips them, cross-filesystem copy loses them. |
| Path-as-identity | Paths change on every rename/move — the exact failure mode stable identity exists to solve. |
| Symbol-granular | Deferred to v2; would multiply row counts 10–100× and duplicate the CodeGraph. |

## Related guides

- [`01-overview.md`](01-overview.md) — pillar 1 (stable identity) of the overview is this pillar.
- [`03-data-schema-recall.md`](03-data-schema-recall.md) — the identity decision forces the two-table schema (`source_graph` + `source_graph_versions`).
- [`04-ai-brooding-enricher.md`](04-ai-brooding-enricher.md) — the re-association ladder writes the rows the enricher fills.
- [`05-prior-art.md`](05-prior-art.md) — Aura and Mimir are the intellectual predecessors of this decision.

## Procedure

1. **Arm.** Load `knowledge-stinger` and `adr-writing-stinger` (per the CRITICAL DIRECTIVE). Confirm [`00-principles.md`](00-principles.md).
2. **For any identity argument**, read ADR-0001 end to end first. The decision is recorded; re-litigating without engaging the recorded alternatives wastes effort.
3. **For ADR edits** (e.g. superseding), follow adr-writing-stinger's supersession lifecycle — bidirectional linking, never silent edits.
4. **For the ladder algorithm**, read `ai/identity-and-reassociation.md`; verify any step claim against it.
5. **Verify cross-links resolve** before declaring done.

## What this pillar does NOT cover

- The DDL of the two tables the identity decision forces → [`03-data-schema-recall.md`](03-data-schema-recall.md).
- The brooding/enricher loops that consume the ladder's outputs → [`04-ai-brooding-enricher.md`](04-ai-brooding-enricher.md).
- The projection that carries identity across clones → [`03-data-schema-recall.md`](03-data-schema-recall.md).
