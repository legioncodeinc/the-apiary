# Template: New 5-Doc Deep-Dive

> Stub for expanding a source doc into the canonical 5-document deep-dive. Copy this template, fill the placeholders, and conform to [`C:/Users/mario/GitHub/hivenectar/library/knowledge/private/standards/documentation-framework.md`](C:/Users/mario/GitHub/hivenectar/library/knowledge/private/standards/documentation-framework.md). Before authoring, load the pillar guide that owns the source doc and arm its CRITICAL DIRECTIVE Stingers.

## When to use this template

A source doc (one of the canonical 9 under `library/knowledge/private/`) earns a 5-doc deep-dive when:
- It is referenced often enough that a single doc forces readers to scroll for the part they need.
- It has distinct audiences (operator wants user-stories; implementer wants the spec; new reader wants the theory).
- The 5-facet split (user-stories, technical-specification, introduction-and-theory, ecosystem-story-arc, conclusion-and-deliverables) would each carry meaningful content.

Do NOT use this template to pad — if a source doc is simple, a single expanded doc is better than five thin ones.

## Folder + naming

```
library/knowledge/private/<domain>/<source-slug>-deep-dive/
├── <source-slug>-user-stories.md
├── <source-slug>-technical-specification.md
├── <source-slug>-introduction-and-theory.md
├── <source-slug>-ecosystem-story-arc.md
└── <source-slug>-conclusion-and-deliverables.md
```

`<source-slug>` matches the source doc's filename without `.md` (e.g. `source-graph-schema` → `source-graph-...`). The folder lives alongside the source doc's domain folder.

## The universal header (every file starts with this)

```markdown
# <Title>

> Category: <Domain> | Version: 1.0 | Date: <Month YYYY> | Status: Draft

<One-sentence description of who should read this and what it covers.>

**Related:**
- [`../<source-doc>.md`](../<source-doc>.md)
- [`<source-slug>-<other-type>.md`](<source-slug>-<other-type>.md)
- <other sibling docs>
```

`<Domain>` matches the domain folder name, capitalized: Overview, Architecture, AI, Data, Reference, Standards. Status is `Draft` for new docs; promote to `Active` once reviewed.

## The 5 files — what each contains

### `<source-slug>-user-stories.md`
Engineering/operator scope only (NOT product features). Personas: the daemon, the operator, the teammate, the reviewer, the implementer. Format each story:
```
**US-<PREFIX>-NNN** — As a <persona>, I want <capability>, so that <value>.
**Acceptance criteria:** (a) ... (b) ... (c) ...
```
15–25 stories. Derive from the source doc's contracts and decision drivers.

### `<source-slug>-technical-specification.md`
Ground-truth specifics carried verbatim from the source: DDL, algorithms, thresholds, command surfaces, formulas, tables. Annotate each with its rationale. This is the reference a future implementer reads for exact values. **Verify every number/type/flag against the source** (Principle 1).

### `<source-slug>-introduction-and-theory.md`
The conceptual "why" essay. Open with the problem the source doc solves. Explain the rationale at a conceptual level. This is the orientation a new reader reads before the spec. Narrative prose, not bullet soup.

### `<source-slug>-ecosystem-story-arc.md`
How the component composes with its siblings. Trace a request/row/event through the system. Mermaid diagrams (flowchart TD or sequenceDiagram). Show the inputs and outputs at each boundary.

### `<source-slug>-conclusion-and-deliverables.md`
Synthesis: what the component delivers, restated as concrete outcomes. The hard contracts / non-goals as a boundary. Forward pointers to the rest of the corpus. Short — this is the summary.

## Procedure

1. **Load the pillar guide** that owns the source doc; arm its CRITICAL DIRECTIVE Stingers.
2. **Read the source doc end to end.** It is authoritative; the deep-dives derive from it.
3. **Create the folder + 5 stub files** from this template.
4. **Author each file** citing the source doc by relative path for every factual claim.
5. **Cross-link the 5 files to each other** and to the source doc.
6. **Run the link scan** ([`../examples/corpus-link-scan.md`](../examples/corpus-link-scan.md)) — expect 0 broken links.
7. **Update the pillar guide** and [`../research/index.md`](../research/index.md) if the new folder changes the corpus map.

## Anti-patterns

- **Inventing values for deliberate gaps** (Principle 3). If the source is silent, the deep-dive is silent too.
- **Copying the source verbatim into all 5 files.** The technical-specification carries the DDL/tables; the others paraphrase or reference.
- **Mixing product PRD scope into user-stories.** The stories are engineering/operator scope, not features.
- **Time-sensitive language.** Present tense, README-driven, no "currently"/"recently"/"as of".
