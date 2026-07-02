# The Apiary

The Bee Army designed for Claude Cowork. One plugin, the whole hive.

## Components

| Component | Count | What it is |
|-----------|-------|------------|
| Skills (Stingers) | 111 | Deep specialist knowledge bases: ADR writing, auth, payments, DeepLake datasets, embeddings, retrieval, SEO/AEO, security, QA suites, and the rest of the arsenal. Each Stinger ships its guides, examples, templates, and research. |
| Agents (Worker Bees) | 86 | Specialist subagents, each paired with its Stinger. The Bee reads its Stinger's SKILL.md before working. Includes the-queen and scripture-historian. |
| Commands | 2 | `/the-beekeeper` routes tasks through the roster and dispatches armed Bees. `/the-smoker` is its counterpart. |
| Hooks | 1 | No-em-dashes enforcement on every response (Stop hook). |
| Extras | 1 | `model-comparison-matrix.md` at the plugin root, referenced by the orchestrators. |

## How it works

- Ask for specialist work in plain language. Stinger descriptions carry trigger phrases, so the right skill loads on its own.
- Run `/the-beekeeper <task>` to have the orchestrator route a task to the right Worker Bee, armed with its paired Stinger.
- Worker Bees reference their Stingers via `${CLAUDE_PLUGIN_ROOT}/skills/...`, so everything resolves inside the plugin no matter where it is installed.

No environment variables or external services required. Install the `.plugin` file and go.
