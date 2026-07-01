# Research Index — Hivenectar Knowledge Corpus

> This folder does NOT copy the corpus. It indexes it by relative path. The corpus at [`C:/Users/mario/GitHub/hivenectar/library/knowledge/private/`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/) is the single source of truth; this manifest is a navigational map. Any edit to the corpus propagates automatically. Do not duplicate corpus files here — duplication drifts (the corpus itself documents why at `data/portable-registry.md`).

## How to use this index

Each guide under `../guides/` cites specific corpus files. Use this index to (a) see the full corpus shape at a glance, (b) resolve a citation, or (c) find the right doc for a new task. **Corpus paths in this skill are absolute** (`C:/Users/mario/GitHub/hivenectar/library/knowledge/...`) because the skill lives in the global skills dir while the corpus lives in the repo; internal skill references (guides/, examples/) remain relative.

## The corpus map

The corpus is organized as **9 source documents**, each expanded into a **5-document deep-dive** (user-stories, technical-specification, introduction-and-theory, ecosystem-story-arc, conclusion-and-deliverables). Customer-facing translations live under `public/`. Total: 9 source + 45 deep-dive + 9 public = 63 documents.

### Source documents (the canonical 9)

| Pillar | Source doc (relative to skill root) | Deep-dive folder |
|---|---|---|
| Overview | [`C:/Users/mario/GitHub/hivenectar/library/knowledge/private/overview.md`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/overview.md) | `overview/` |
| Architecture — identity | [`C:/Users/mario/GitHub/hivenectar/library/knowledge/private/architecture/ADR-0001-minted-nectar-over-source-embedded-serial.md`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/architecture/ADR-0001-minted-nectar-over-source-embedded-serial.md) | `architecture/identity-model/` |
| Architecture — topology | [`C:/Users/mario/GitHub/hivenectar/library/knowledge/private/architecture/ADR-0002-hivenectar-independent-daemon-supervised-by-hivedoctor.md`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/architecture/ADR-0002-hivenectar-independent-daemon-supervised-by-hivedoctor.md) | (no deep-dive yet; cross-cutting — referenced from overview, data, AI, prior-art) |
| AI — identity | [`C:/Users/mario/GitHub/hivenectar/library/knowledge/private/ai/identity-and-reassociation.md`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/ai/identity-and-reassociation.md) | `ai/identity-deep-dive/` |
| AI — brooding | [`C:/Users/mario/GitHub/hivenectar/library/knowledge/private/ai/brooding-pipeline.md`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/ai/brooding-pipeline.md) | `ai/brooding-deep-dive/` |
| AI — enricher | [`C:/Users/mario/GitHub/hivenectar/library/knowledge/private/ai/enricher-and-llm-model.md`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/ai/enricher-and-llm-model.md) | `ai/enricher-deep-dive/` |
| Data — schema | [`C:/Users/mario/GitHub/hivenectar/library/knowledge/private/data/source-graph-schema.md`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/data/source-graph-schema.md) | `data/source-graph-deep-dive/` |
| Data — projection | [`C:/Users/mario/GitHub/hivenectar/library/knowledge/private/data/portable-registry.md`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/data/portable-registry.md) | `data/portable-registry-deep-dive/` |
| Data — recall | [`C:/Users/mario/GitHub/hivenectar/library/knowledge/private/data/recall-integration.md`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/data/recall-integration.md) | `data/recall-integration-deep-dive/` |
| Reference | [`C:/Users/mario/GitHub/hivenectar/library/knowledge/private/reference/prior-art-crosswalk.md`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/reference/prior-art-crosswalk.md) | `reference/prior-art-deep-dive/` |

### Deep-dive folder convention

Every deep-dive folder under `C:/Users/mario/GitHub/hivenectar/library/knowledge/private/<domain>/` contains exactly five files, named `<slug>-<type>.md` where `<type>` is one of:

| Type | What it is | Read it when... |
|---|---|---|
| `-user-stories.md` | Engineering/operator user stories with acceptance criteria | you need the testable contract / scope |
| `-technical-specification.md` | DDL, algorithms, thresholds, command surfaces | you need ground-truth specifics |
| `-introduction-and-theory.md` | The conceptual "why" essay | you need to understand the rationale |
| `-ecosystem-story-arc.md` | How the component composes with siblings | you need the integration story |
| `-conclusion-and-deliverables.md` | Synthesis, hard contracts, forward pointers | you need the summary / non-goals |

### Customer-facing translations

Nine plain-language docs under [`C:/Users/mario/GitHub/hivenectar/library/knowledge/public/`](C:/Users/mario/GitHub/hivenectar/library/knowledge/public/): `overview/` (what-is, how-it-helps, glossary), `guides/` (getting-started, team-share, keeping-accurate), `faqs/` (basics, privacy-and-cost, comparison). These are NOT engineering references — they are the user-facing surface. The skill guides cite the private corpus for facts and the public docs only when the task is user-facing communication.

### Standards

The repo's documentation framework — the rule every corpus doc conforms to — lives at [`C:/Users/mario/GitHub/hivenectar/library/knowledge/private/standards/documentation-framework.md`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/standards/documentation-framework.md). Read it before authoring or editing any corpus doc.

## Verification anchors

The corpus was audited against a set of anchor facts (ULID spec, the two-table DDL, the brooding cost math, the model-comparison table, the five-pillar novelty claim). When a guide cites a number, type, or attribution, it is traceable to one of the source docs above. If you find a guide claim that contradicts its cited source, the source wins — flag the guide for correction.
