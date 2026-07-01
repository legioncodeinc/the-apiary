# 01 — Overview Pillar

> **CRITICAL DIRECTIVE: load `knowledge-stinger` and `readme-writing-stinger` before proceeding.** This pillar is narrative knowledge documentation (knowledge-stinger's domain) and includes the repo's public README (readme-writing-stinger's domain). An unarmed agent working this pillar is a failed dispatch. Read both Stingers' SKILL.md files in full before touching any corpus doc in this pillar.
>
> Resolve the Stingers by their conventional paths. If installed globally: `C:\Users\mario\.agents\skills\knowledge-stinger\SKILL.md` and `C:\Users\mario\.agents\skills\readme-writing-stinger\SKILL.md`. The beekeeper-suit arming contract applies.

## What this pillar covers

The overview pillar is the **entry point** to the entire Hivenectar corpus. It defines what Hivenectar is, the problem it solves, the three design pillars, the hiveantennae worker's four operating modes, and the structural-vs-semantic two-layer thesis. Every other pillar derives from this one.

Load this guide when the task is: orienting to Hivenectar for the first time; writing or editing the overview docs; explaining Hivenectar to a new reader; updating the reading guide; or any task where you need the 30-second thesis before going deep.

## The corpus docs in this pillar

| Doc (relative to skill root) | Read it for |
|---|---|
| [`C:/Users/mario/GitHub/hivenectar/library/knowledge/private/overview.md`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/overview.md) | The canonical overview — three pillars, four worker modes, two-layer complementarity, reading guide. The authoritative source. |
| [`C:/Users/mario/GitHub/hivenectar/library/knowledge/private/overview/overview-introduction-and-theory.md`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/overview/overview-introduction-and-theory.md) | The conceptual on-ramp: the structural-vs-semantic gap, the hive/antennae/nectar metaphor, why Hivenectar is complementary to (not a replacement for) the CodeGraph. |
| [`C:/Users/mario/GitHub/hivenectar/library/knowledge/private/overview/overview-technical-specification.md`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/overview/overview-technical-specification.md) | The four operating modes as trigger→action→post-condition tables; the recall arm contract; the independent-daemon topology (per ADR-0002). |
| [`C:/Users/mario/GitHub/hivenectar/library/knowledge/private/overview/overview-user-stories.md`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/overview/overview-user-stories.md) | 27 engineering/operator user stories with acceptance criteria. |
| [`C:/Users/mario/GitHub/hivenectar/library/knowledge/private/overview/overview-ecosystem-story-arc.md`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/overview/overview-ecosystem-story-arc.md) | How Hivenectar composes with the CodeGraph, recall, embeddings daemon, Portkey, and daemon lifecycle. |
| [`C:/Users/mario/GitHub/hivenectar/library/knowledge/private/overview/overview-conclusion-and-deliverables.md`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/overview/overview-conclusion-and-deliverables.md) | The four concrete outcomes, the non-goals as contract boundary, the "what success looks like" measurable properties. |
| [`C:/Users/mario/GitHub/hivenectar/library/knowledge/private/architecture/ADR-0002-hivenectar-independent-daemon-supervised-by-hivedoctor.md`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/architecture/ADR-0002-hivenectar-independent-daemon-supervised-by-hivedoctor.md) | The process-topology decision: Hivenectar is an independent daemon supervised by **hivedoctor**, NOT a worker inside the Honeycomb daemon. Independence is process-layer only — the data layer (Deep Lake, recall union, Portkey, embeddings) is unchanged. Cross-cutting; referenced from overview, data, AI, and prior-art docs. |

## The load-bearing claims (verify before relying on)

- **The three pillars:** (1) stable identity via daemon-minted ULID, (2) lazy LLM description via Gemini 2.5 Flash, (3) durable state in Deep Lake with a portable projection.
- **The two-layer thesis:** structural (CodeGraph, AST, deterministic) and semantic (Hivenectar, LLM, probabilistic) are **independent and complementary**. Both ship. Hivenectar does NOT replace the CodeGraph.
- **The four worker modes:** Brooding (first run), Live watch (chokidar), Cold catch-up (daemon boot after offline changes), Projection sync (regenerate `.honeycomb/nectars.json`).
- **The daemon is the Hivenectar daemon (`hiveantennae`)**, an independent OS process supervised by **hivedoctor** — NOT a worker inside the Honeycomb daemon (per ADR-0002). It owns its own Deep Lake client, auth, scoping, observability within hivedoctor's lifecycle. It is parallel to (not a phase of) the Honeycomb daemon's codebase-graph worker. **Independence is process-layer only**: the data layer (same Deep Lake tables, same recall union, same Portkey/embeddings/CodeGraph consumption) is unchanged.
- **Fresh-clone thesis:** a clone with a current committed projection achieves zero LLM calls and zero fuzzy matches.

If any work in this pillar asserts something beyond these, verify against `overview.md` first — it is the authoritative source the deep-dives derive from.

## Related guides

- [`02-identity-model.md`](02-identity-model.md) — the identity pillar is the spine of the overview's pillar 1.
- [`03-data-schema-recall.md`](03-data-schema-recall.md) — pillar 3 (Deep Lake + projection) and the recall arm live here.
- [`04-ai-brooding-enricher.md`](04-ai-brooding-enricher.md) — pillar 2 (LLM description) lives here.
- [`05-prior-art.md`](05-prior-art.md) — the honest novelty claim referenced in the overview's conclusion.

## Procedure

1. **Arm.** Load `knowledge-stinger` and `readme-writing-stinger` (per the CRITICAL DIRECTIVE above). Confirm [`00-principles.md`](00-principles.md).
2. **Read `overview.md`.** It is short and authoritative. Do not rely on memory of it — re-read before editing.
3. **For extension work**, follow [`../examples/extend-a-deep-dive.md`](../examples/extend-a-deep-dive.md).
4. **For claim verification**, follow [`../examples/audit-a-claim.md`](../examples/audit-a-claim.md).
5. **Conform to the documentation framework** ([`C:/Users/mario/GitHub/hivenectar/library/knowledge/private/standards/documentation-framework.md`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/standards/documentation-framework.md)) for any authored doc.
6. **Verify cross-links resolve** before declaring done.

## What this pillar does NOT cover

- The identity decision's rationale and alternatives → [`02-identity-model.md`](02-identity-model.md).
- The DDL, the projection format, the recall SQL → [`03-data-schema-recall.md`](03-data-schema-recall.md).
- The brooding/enricher algorithms, the model choice, the embeddings daemon → [`04-ai-brooding-enricher.md`](04-ai-brooding-enricher.md).
- Prior-art comparison and the novelty claim → [`05-prior-art.md`](05-prior-art.md).
