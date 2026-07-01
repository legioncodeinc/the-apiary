# hivenectar-stinger

A domain-knowledge Stinger for the Hivenectar design corpus. It does not re-teach the domain — it maps the 63-document corpus at [`library/knowledge/`](C:/Users/mario/GitHub/hivenectar/library/knowledge/) and routes any agent doing Hivenectar work to the right corpus docs plus the mandatory sibling-skill (Stinger) loads each pillar requires.

**Built from:** the Hivenectar knowledge corpus in the Hivenectar repo at `C:\Users\mario\GitHub\hivenectar\` (no external research). The corpus is the foundation; this skill is the map and the load order. The skill itself lives in the global skills dir (`~/.agents/skills/hivenectar-stinger/`) so the Skill tool can load it; it references the corpus by absolute path to bridge the two locations.

## What it does

When a task touches Hivenectar, this skill:

1. Identifies which of the 5 corpus pillars the task belongs to (overview, identity-model, data, AI, prior-art).
2. Names the sibling Stingers the agent MUST load before proceeding (e.g. `deeplake-dataset-stinger` + `retrieval-stinger` for the data pillar), stated as CRITICAL DIRECTIVE blocks reinforced twice (in SKILL.md and again at the guide head).
3. Points at the exact corpus docs to read for ground-truth specifics.
4. Enforces the corpus-integrity principles (cite or cut; never duplicate; preserve deliberate spec gaps; README-driven present tense).

## Folder layout

```
hivenectar-stinger/
├── SKILL.md          the primary document: corpus map + (MUST LOAD) reference links + critical directives
├── README.md         this file
├── guides/           00-principles + 5 pillar guides (each with CRITICAL DIRECTIVE blocks)
├── research/         index.md + research-summary.md — manifest pointing at the corpus by absolute path (no copying)
├── examples/         worked examples of corpus extension + claim auditing
└── templates/        stub for authoring a new 5-doc deep-dive
```

## How to use it

1. The orchestrator loads this skill when a task matches the description's trigger phrases ("work on Hivenectar", "extend the spec", "audit a Hivenectar claim", etc.).
2. SKILL.md routes the task to the matching pillar guide.
3. The guide's CRITICAL DIRECTIVE block names the sibling Stingers to load first.
4. The agent reads the cited corpus docs, does the work, and verifies per the guide's procedure.

See [`SKILL.md`](SKILL.md) for the full corpus map and the seven critical directives.
