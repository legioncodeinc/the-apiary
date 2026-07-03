# Honeycomb: Stories & User Guide

*Shared, lasting memory for your AI coding agents, explained in plain language.*

> **The Apiary** by Legion Code Inc., in collaboration with Activeloop.

## Foreword

AI coding assistants are brilliant in the moment and forgetful the next. Close the window and the context is gone. Honeycomb gives every one of your agents a single shared memory that survives sessions, travels across tools, and gets sharper over time. This guide is the plain-language tour: what Honeycomb is, how it works, how to get started, how it behaves day to day, how teams share it, and the questions people ask most. No SQL, no servers, no configuration rituals.

## What is Honeycomb?

The plain-language introduction to Honeycomb: what it is, the problem it solves, and who it is for. Start here if you are new.

### The problem: your AI agents forget

AI coding assistants are brilliant in the moment and forgetful the next. Close the window and the context is gone. Open a different tool tomorrow and it has never heard of your project. The decision you reached with one assistant at midnight is invisible to a different assistant the next morning. So you re-explain your conventions, re-discover the fix that already worked, and repeat yourself to a machine that should have remembered.

### The idea: one shared memory for all of them

Honeycomb gives your AI coding agents a single, shared, lasting memory. A small program runs quietly on your machine, notices what happens as you work, distills it into clean notes, and hands those notes back to any assistant that asks. Learn something once, and it is there everywhere: the next session, a different tool, another laptop, and (if you want) the rest of your team.

Think of it as a shared brain your assistants read from and write to on every turn, instead of starting cold each time.

### What you actually get

- **Memory that survives.** What you figured out yesterday is waiting for you today, already summarized.
- **Memory that travels across tools.** A note written while using one assistant is recalled by another. Honeycomb plugs underneath the coding assistants you already use (Claude Code, Cursor, and Codex today, with three more in progress).
- **Skills that spread.** When you (or a teammate) solve something reusable, Honeycomb can turn it into a shareable "skill" that shows up automatically for everyone, no copy-paste.
- **A memory that gets sharper, not noisier.** Honeycomb periodically tidies its own notes: merging duplicates, dropping junk, and keeping the current version of a fact instead of letting stale ones pile up.
- **A friendly dashboard.** A simple local web page shows what has been remembered, how your tools are wired, and the health of everything. No database knowledge required.

### Who it is for

**Vibe coders.** If you live inside an AI coding assistant and just want it to *remember your project*, Honeycomb is the missing memory. One command to install, a dashboard that opens itself, and no SQL, servers, or configuration rituals. Stop re-explaining yourself every morning.

**Teams and enterprises.** If many developers, devices, and tools need to share what they learn, Honeycomb is one brain across all of them. A discovery by one engineer reaches the whole team on their next session. Your data stays in your own store, separated cleanly by team and project, and everything is versioned and inspectable.

### Where it comes from

Honeycomb is a collaboration. **Activeloop** provides [Deep Lake](https://deeplake.ai), the database for AI that Honeycomb's memory lives in, and [Hivemind](https://github.com/activeloopai/hivemind), the open-source agent-memory project Honeycomb is built on. **Legion Code** adds the multi-tier memory system, the skill sharing, the self-tidying loop, and the local daemon that ties it all together. Neither half stands alone: Deep Lake gives the memories somewhere durable to live, and Legion Code gives every assistant one consistent way to use them.

### Next steps

- See the shape of it in How Honeycomb works.
- Learn the words in the Glossary.
- ## How Honeycomb works

A plain-language tour of how Honeycomb captures, distills, and recalls memory, and why it gets sharper over time. No technical background needed.

### One quiet helper in the background

When you install Honeycomb, it runs a small, always-on helper on your machine (we call it the **daemon**). It is the only part that talks to your memory store, which keeps everything in one safe place. Your coding assistants do not connect to the store themselves; they just talk to this local helper.

Everything Honeycomb does follows one simple loop: **capture, distill, recall, and compound.**

```mermaid
flowchart LR
    work["You work with an AI assistant"] --> capture["Capture: notice what happened"]
    capture --> distill["Distill: turn it into clean notes"]
    distill --> store["Store it safely"]
    store --> recall["Recall: hand the right notes back next time"]
    recall --> work
    store --> tidy["Tidy up over time"]
    tidy --> store
```

### Capture: notice what happened

As you and your assistant work, Honeycomb quietly records the important moments: what you asked, what the assistant did, and what came back. This recording is cheap and instant, and it never gets in the way. If anything ever goes wrong while recording, your assistant keeps working normally. Nothing is lost.

### Distill: turn it into clean notes

Raw transcripts are long and noisy. Honeycomb distills them into short, useful notes: a one-line headline ("the index"), a longer summary, and the full original if you ever need to dig in. This is the **three-tier memory**: skim the headline, open the summary if it looks relevant, and only read the full detail when you truly need it. It is how a person remembers, a gist first, then the details on demand.

### Recall: hand the right notes back

When you start a new session, Honeycomb gives your assistant a small, tidy "here is what I already know about this project" briefing so it starts informed instead of blank. During your work, the assistant can also ask for more whenever it needs it. You do not have to manage any of this; it happens for you.

Honeycomb finds the right notes two ways at once: by matching the words you used, and (optionally) by matching the *meaning* even when the words are different. That second kind is called semantic search, and it is what lets Honeycomb surface the right memory even when you would not have known the exact term to look for.

### Compound: it gets sharper over time

Most note piles get messier as they grow. Honeycomb does the opposite. Every so often it runs a tidy-up pass that merges duplicate notes, drops the junk, and replaces stale facts with their current version, while keeping a full history so nothing is truly lost. The result is that the more you use Honeycomb, the *sharper* its memory gets, not the noisier.

### Your data stays yours

Honeycomb keeps your memories in a store you control (powered by [Deep Lake](https://deeplake.ai)), separated cleanly so different teams and projects never see each other's notes. The local helper is the only thing that connects to it, and on a single machine it only listens to your own computer. Secrets like API keys are handled separately and are never shown to the assistant.

### In one sentence

Honeycomb watches your work, writes clean notes, hands the right ones back to any assistant on any device, and keeps tidying itself so your project's memory only gets better.

## Glossary

Plain-language definitions of the words you will see around Honeycomb. Each entry says what the thing is and why it matters to you.

**Honeycomb**: A shared, lasting memory for your AI coding assistants. It remembers what you and your assistants do so the knowledge is there next time, in any tool, on any device.

**Agent / assistant / harness**: All three words point at the same thing: the AI coding tool you actually use (for example Claude Code, Cursor, or Codex). "Harness" is just the technical word for "the tool Honeycomb plugs underneath." Honeycomb supports three today (Claude Code, Cursor, Codex), with three more (Hermes, pi, OpenClaw) in progress.

**Daemon**: The small helper program that runs quietly in the background on your machine. It is the only part of Honeycomb that touches your memory store, which keeps everything in one safe, consistent place. You rarely interact with it directly; it starts itself when needed.

**Doctor**: A tiny separate watchdog that keeps the daemon healthy. It quietly checks that the background helper is running and, if something goes wrong, tries to fix it (restart, reinstall, and so on) before you ever notice. If it cannot fix the problem on its own, it shows you a local status page and (unless you opt out) sends home a scrubbed report so the makers can help. The one-command installer sets it up automatically; skip it with `--no-doctor`. Its reports never include your credentials, tokens, or code.

**Capture**: The act of quietly recording what happened as you work (your prompts, the tool's actions, the results). Capture is the raw material Honeycomb later distills into clean notes.

**Recall**: Asking Honeycomb for the right notes at the right moment. It happens automatically at the start of a session, and your assistant can also ask for more whenever it needs to.

**Memory**: A clean, distilled note Honeycomb keeps about your work: a decision, a fix, a convention, a gotcha. Memories are what get recalled.

**The three tiers (key, summary, raw)**: The same memory kept at three levels of detail so you can zoom in only as far as you need. The **key** is a one-line headline, the **summary** is a short recap, and the **raw** is the full original. Skim the headlines, open a summary if it looks useful, read the full detail only when you must.

**Priming / the prime**: The short "here is what I already know about this project" briefing Honeycomb hands your assistant at the start of a session, so it begins informed instead of blank. It is small on purpose, just the headlines, so it never clutters the conversation.

**Skill**: A reusable lesson, written once and shared. When you solve something worth keeping (a migration trick, a debugging routine), Honeycomb can turn it into a skill that automatically appears for you and your teammates.

**Skillify**: The automatic process that watches your sessions and turns the genuinely reusable patterns into skills. It is picky on purpose: it would rather miss a so-so skill than create a noisy one.

**The pollinating loop**: Honeycomb's self-tidying pass. Every so often it merges duplicate notes, removes junk, and replaces stale facts with their current version, so the memory gets sharper as it grows instead of messier. (It is off by default and you turn it on when you want it.)

**Knowledge graph**: Honeycomb's map of the things in your work (people, projects, tools, decisions) and how they connect. It is what lets memory answer "what is true about this right now, and what does it depend on," not just "what did I say about it."

**Codebase graph**: A map of your actual code: its files, functions, and how they call and import each other. It lets an assistant answer questions like "what would changing this break?" grounded in your real project.

**Deep Lake**: The database for AI, made by Activeloop, where Honeycomb's memories are stored. It is good at both exact lookups and meaning-based search, it keeps a full version history, and it can live in your own cloud. See [deeplake.ai](https://deeplake.ai).

**Hivemind**: Activeloop's open-source agent-memory project that Honeycomb is built on. See [the Hivemind repository](https://github.com/activeloopai/hivemind).

**Embeddings / semantic search**: The optional ability to find memories by *meaning* rather than exact words. Turn it on and Honeycomb can surface the right note even when you would not have guessed the exact term. Turn it off and recall still works by matching words; it simply finds fewer of the "I didn't know to search for that" cases.

**Org, workspace, and project**: How Honeycomb keeps memory in the right lane for a team. An **org** is your company, a **workspace** is a team within it, and a **project** is the specific repository or folder you are working in. Notes are kept separate across these so the right people see the right memory and nothing bleeds across.

**Dashboard**: The simple local web page Honeycomb serves on your own machine. It shows your memories, how your tools are wired, your team's shared skills, and the health of everything. It is also where first-time setup happens. No database skills required.

**ROI**: The dashboard page that answers "is this saving me money?" It nets what Honeycomb saves you (from reused context and fewer back-and-forths) against what it costs to run, in plain dollars. It carefully labels which numbers are **measured** (real, billed facts) and which are **estimates** (projections), and shows a dash rather than a made-up number when something cannot be measured yet. See Your ROI dashboard.

**Measured vs estimated savings**: Honeycomb's honesty rule on the ROI page. A *measured* number is arithmetic over your real billed usage, trust it like a receipt. An *estimated* number is a model of what would otherwise have happened, useful but a projection, and it is always flagged with an "est." marker so the two are never confused.

**MCP**: A standard way for AI tools to call external helpers. Honeycomb offers an MCP "server" so assistants t

## Getting started

Install Honeycomb, connect it, and save your first memory. Written for anyone, no prior setup or database knowledge required.

### 1. Install with one command

Open a terminal and paste the line for your system. You do not need to have Node, npm, or anything else set up first; the installer takes care of it.

**macOS or Linux**

```bash
curl -fsSL https://get.theapiary.sh | sh
```

**Windows (PowerShell)**

```powershell
irm https://get.theapiary.sh/install.ps1 | iex
```

The terminal shows a short progress log, and when it finishes it **opens a dashboard in your browser**. That dashboard is the real starting point; the terminal was just the doorway.

> Prefer to read the script before running it? Visit [get.theapiary.sh](https://get.theapiary.sh) in a browser, where you can inspect it and check the published checksums first.

> The installer also sets up **Doctor**, a tiny watchdog that keeps the background helper healthy and quietly repairs it if anything breaks. You do not need to do anything with it. Don't want it? Add `--no-doctor` to the install command. See the Glossary for more.

### 2. Click "First time setup"

On the dashboard you will see a **First time setup** button. Click it. Honeycomb runs the sign-in for you: it shows a short code right on the page and opens a tab where you approve it (and create a free Deep Lake account if you do not have one). No copying codes out of a terminal.

When you approve, the same dashboard lights up its connected views. You are ready. Nothing to restart.

> Already using Hivemind? The dashboard will notice and offer to move you over cleanly. Running both at once is not supported, so let Honeycomb handle the switch.

### 3. Save your first memory

Now teach it something and ask for it back. In your terminal:

```bash
honeycomb remember "we deploy from the release branch, never from main"
honeycomb recall "how do we deploy"
```

That note is now saved. Write it while using one assistant, and a different assistant will recall it tomorrow, even on another laptop. That is the whole point.

### 4. Wire up your coding assistants

Let Honeycomb plug underneath the AI coding tools you already use, so it remembers automatically as you work:

```bash
honeycomb setup
```

This finds the assistants you have installed and connects each one. It is safe to run again any time, for example after you install a new tool. To check that everything is healthy:

```bash
honeycomb status
```

### 5. Explore the dashboard

Browse back to the dashboard any time to see what Honeycomb knows:

```bash
honeycomb dashboard
```

You will find your memories, the state of each connected assistant, your team's shared skills, a map of your codebase, and the overall health of the system, all in one local page.

### What next

- Learn the day-to-day flow in Everyday use.
- Sharing across a team? See Honeycomb for teams.
- Curious about a word? Check the Glossary.

## Everyday use

How Honeycomb fits into a normal day of coding: remembering and recalling, letting it work on its own, reading the dashboard, and the skills that travel with you.

### It mostly works on its own

The best thing about Honeycomb day to day is how little you have to think about it. Once your assistants are wired (`honeycomb setup`), it captures the useful moments as you work and hands the right notes back at the start of your next session. You do not have to remember to save anything for the basics to work.

What you *will* notice is that a fresh session starts informed: your assistant already knows your project's recent decisions and durable conventions, instead of asking you to re-explain them.

### Remembering on purpose

Sometimes you want to pin something down yourself. Two simple commands do it:

```bash
honeycomb remember "the staging database resets every night at 2am UTC"
honeycomb recall "staging database schedule"
```

`remember` saves a note. `recall` pulls back whatever is relevant to your question. Recall matches both the words you used and, when enabled, the *meaning*, so you can find a note even if you would not have guessed its exact wording.

### Reading the dashboard

Run `honeycomb dashboard` (or just keep the tab open) to see everything in one place:

- **Home** gives you the at-a-glance picture: how much has been remembered, how things are trending, overall health.
- **Harnesses** shows each AI assistant Honeycomb is connected to and whether its wiring is healthy.
- **Memories** is your captured knowledge, browsable.
- **Graph** is the map of your codebase you can explore.
- **Sync** shows the skills and assets being shared, mined, and pulled.
- **Logs** is a live view of what the helper is doing.
- **Settings** holds your preferences and sign-in status, and lets you do the housekeeping actions right from the page: sign out, turn memory-meaning matching (embeddings) on or off, restart the helper, or remove Honeycomb, without dropping back to the terminal.

If something ever looks off, the dashboard tells you plainly what is degraded and what to do, rather than showing a green light that is not telling the truth.

### Skills that travel

When you solve something genuinely reusable, Honeycomb can capture it as a **skill**, a short, reusable lesson. Skills you (or teammates) create show up automatically in your assistants at the start of a session. You do not copy files around; Honeycomb places them where each tool looks for them.

You can also manage skills directly:

```bash
honeycomb skill pull        # fetch the latest shared skills now
honeycomb skill scope team --users alice,bob   # also learn from these teammates
```

### Working across tools and devices

Because every assistant talks to the same local helper and the same store, a memory written from one tool is recalled by another, and a memory captured on one machine is available on another (as long as you are signed in to the same account). Switch from one assistant to a different one mid-project and the context comes with you.

### Turning things up (optional)

Two capabilities are off by default so nothing surprising happens on day one. Turn them on when you want them:

- **Semantic search** (finding memories by meaning) becomes available once the small language model that powers it has downloaded and warmed up. Until then, recall still works by matching words.
- **The self-tidying loop** (which merges duplicates and prunes stale notes over time) is opt-in, because it uses an AI model and you should decide when to spend that.

### Pausing capture

If you are working on something sensitive and do not want it recorded for a session, you can put Honeycomb in read-only mode (recall still works, but nothing new is written). Your assistant keeps working normally either way.

### What next

- Sharing with others? See Honeycomb for teams.
- Want the mental model? Read How Honeycomb works.

## Honeycomb for teams

How a team shares memory and skills with Honeycomb, what stays private versus shared, and how work in different projects stays in its own lane.

### One brain for the whole team

On your own, Honeycomb remembers your work across sessions and tools. On a team, it does something more valuable: what one person learns can reach everyone. A teammate solves a tricky migration on Monday; the reusable lesson is available to the whole team's assistants by their next session, without anyone passing around a file.

### Org, workspace, project: keeping memory in the right lane

Teams need memory to be shared *and* separated at the same time. Honeycomb organizes it in three nested levels:

- **Org** is your company. It is the outer boundary; two different companies never see each other's anything.
- **Workspace** is a team within the company. Two teams keep separate memory, enforced where the data is stored, not just in the app.
- **Project** is the specific repository or folder you are working in. Within a team, memory is scoped to the project you are actually in, so a note from one repo does not surface while you work in another.

You do not have to manage the project level by hand. Honeycomb figures out which project a session belongs to from the folder you are working in, even when you have several open at once across different tools.

### What is shared and what is private

Inside a workspace, what an assistant can see depends on a simple policy:

- **Private lane**: an assistant sees only its own memories. Good for a personal or a CI assistant that should not mix into the shared pool.
- **Shared**: an assistant sees the team's shared memories plus its own. This is the "one brain" setting.
- **Group**: an assistant shares with a named group of teammates, plus its own.

The default leans private and safe: when in doubt, Honeycomb shows less, not more. You widen sharing on purpose, never by accident.

### Skills spread automatically

Shared **skills** (reusable lessons) are the most visible team benefit. When a skill is published to the team, every teammate's assistants pick it up at the start of their next session. Skills carry who wrote them, so credit and history are clear, and two people can have a skill with the same name without clobbering each other.

Promoting something from "just mine" to "the whole team's" is always a deliberate, recorded action, so nothing private gets shared by surprise.

### Switching between projects, teams, and companies

Because Honeycomb scopes to the folder you are in, **moving between repositories needs no manual switch at all**, just open the other project in your assistant and Honeycomb follows. What stays a deliberate choice is moving between the teams and companies you belong to:

```bash
honeycomb org list           # companies you belong to
honeycomb workspace list     # teams in the current company
honeycomb project list       # projects you are bound to
honeycomb org switch acme    # change company
honeycomb workspace use backend
```

The dashboard offers the same switches in a menu, showing only the orgs, workspaces, and projects you actually have access to.

### Your data, your store

A team's memory lives in your own Deep Lake store, with each team and project separated at the storage layer. You can even keep that storage in your own cloud account. Sensitive credentials (like API keys) are never stored alongside memory and are never shown to an assistant. For decision-makers: memory is versioned and inspectable, sharing is opt-in by design, and nothing leaves your store except the sign-in traffic and, only if you allow it, anonymous product-usage counts.

### What next

- New here? Start with Getting started.
- Want the day-to-day flow? See Everyday use.

## Your ROI dashboard

Honeycomb has a page that answers the obvious question: *is this saving me money?* The **ROI** page on your dashboard shows what the memory layer saves you against what it costs to run, in plain dollars, and it is careful to tell you which numbers are measured and which are estimates.

### What the page shows

At the top is the headline: **Net ROI**, the one number that nets everything out.

```
Net ROI = what you saved − what it cost to run
```

Underneath, that splits into the pieces it is made of:

- **What you saved** comes in two flavors:
  - **Measured cache savings** (the green headline). When your assistant reuses context it has already sent, that reused part is billed at a small fraction of the normal rate. Honeycomb reads the real token counts from your sessions and prices them, so this is an actual, billed saving, not a guess.
  - **Estimated memory savings** (clearly labeled as an estimate). When Honeycomb hands your assistant the right notes up front, it can reach an answer in fewer back-and-forths. We *model* what that would have cost you otherwise. It is shown next to the measured number but always marked as an estimate, never mixed in as if it were a hard fact.
- **What it cost to run** is Honeycomb's own running cost: the cloud compute behind storing and recalling your memory, plus the small amount of AI work Honeycomb does in the background to distill your sessions into clean notes.

### Measured vs estimated: why we split them

This is the most important thing about the page. Honeycomb deliberately keeps two kinds of number apart:

- A **measured** number is arithmetic over your real, billed usage. You can trust it like a receipt.
- An **estimated** number is a model of what *would* have happened. It is useful, but it is a projection, and we label it so.

Any total that includes an estimate inherits an **"est."** marker, so you always know when you are looking at a projection rather than a billed fact. We would rather show you an honest estimate clearly flagged than dress a guess up as a guarantee.

### When a number is missing

The page never invents a number to fill a gap. If something cannot be measured right now, you will see a **dash**, not a misleading `$0.00`:

- **Just getting started?** Until Honeycomb has captured a few sessions with token detail, the savings section shows dashes. A measured `$0` and an "unknown yet" are shown differently on purpose.
- **Token detail is captured for Claude Code first.** If you are mostly on Claude Code you will see the richest numbers; other tools are being added, and the page marks where data is partial.
- **If the cost service is unreachable**, the affected line shows a dash and offers a retry, rather than guessing.

A small **"rates as of"** date on the page tells you how current the pricing behind the math is.

### A negative number is not a bug

If you barely use the memory features, it is possible for the running cost to be higher than what you have saved so far, a negative net. That is honest, not broken: the value compounds the more you use it. The page shows this plainly and never colors a rising cost as if it were good news.

### Teams

ROI adds up **across your devices**, and if your workspace is organized into teams, it can roll up per team as well. Per-person breakdowns are intentionally switched off until a verified sign-in exists, Honeycomb will not guess who you are from your machine or your git email. Until then you will see a clear "needs verified login" note instead of a fabricated per-person figure. See Honeycomb for teams for how team rollups work.

### Where to find it

Open your Honeycomb dashboard and choose **ROI** from the left navigation. The page runs locally on your own machine and reads only your own workspace's numbers.

## Self-hosting the storage backend

Run Honeycomb against your own storage backend instead of Activeloop's hosted Deep Lake. The backend is Activeloop's open-source `pg_deeplake` Postgres extension, and Honeycomb can point at it either through an HTTP gateway or directly over a Postgres connection.

### What you get, and the one limitation

Honeycomb's storage layer is pluggable. The daemon is the only process that talks to storage, so pointing it at a self-hosted backend is a single decision made at login time. Everything above storage (capture, recall, the dashboard, the harnesses) is unchanged.

The one honest limitation: only the storage path is self-hostable today. `honeycomb login` (the device and headless flows) and `honeycomb org switch` still call `api.deeplake.ai` for authentication and token re-mint. The `honeycomb login --endpoint` path documented below avoids that call by writing the credential directly, so a fully self-hosted deployment should establish its credential with `--endpoint` and avoid the auth-server verbs until a self-hosted auth issuer exists. This is an open question raised for the maintainers.

---

### 1. Run pg_deeplake

`pg_deeplake` is Activeloop's open-source Postgres extension. It speaks Honeycomb's SQL dialect natively, so Honeycomb talks to it with no translation layer.

```bash
docker run -d --name pg-deeplake \
  -e POSTGRES_PASSWORD=deeplake \
  -p 5432:5432 \
  quay.io/activeloopai/pg-deeplake:18
```

That gives you a Postgres 18 server with the extension loaded, reachable at `postgres://postgres:deeplake@localhost:5432/postgres`.

---

### 2. Point Honeycomb at it

There are two ways in, both established with one command. Neither touches `api.deeplake.ai`.

#### Direct Postgres (recommended for a single box)

Point Honeycomb straight at the Postgres URL. The daemon connects directly, with no HTTP gateway in the middle.

```bash
honeycomb login --endpoint "postgres://postgres:deeplake@localhost:5432/postgres"
```

When the endpoint starts with `postgres://` (or `postgresql://`), Honeycomb selects the direct Postgres transport automatically.

#### HTTP gateway

If you front `pg_deeplake` with an HTTP gateway that exposes the Deep Lake query API, point at that URL instead.

```bash
honeycomb login --endpoint "https://deeplake.internal.example.com"
```

Any endpoint that does not start with `postgres://` or `postgresql://` uses the HTTP transport.

#### Flags

```
honeycomb login --endpoint <url> [--token <tok>] [--org <o>] [--workspace <w>]
```

- `--endpoint` selects the self-hosted path. This is the trigger: with it set, the device flow and the `GET /me` validation are skipped and the credential is written directly with `apiUrl = `.
- `--token` is optional. If you omit it, Honeycomb mints a local, verifiable token bound to your org and workspace, so a self-hoster needs no Activeloop token at all.
- `--org` defaults to `local`.
- `--workspace` defaults to `default`.

The credential is written to the shared `~/.deeplake/credentials.json` at mode `0600`, exactly like every other login. The token is never printed.

---

### 3. The contract a backend must honor

If you write or front your own backend rather than using `pg_deeplake` as shipped, two behaviors are load-bearing. Both were reverse-engineered and proved end to end; getting either wrong breaks Honeycomb quietly.

#### A workspace is a Postgres schema

Honeycomb introspects a workspace's columns with `information_schema.columns WHERE table_schema = ''` and then issues statements with UNqualified table names (for example `memory`, not `.memory`). A backend MUST therefore map each workspace to its own Postgres schema and `SET search_path` to that schema so the unqualified names resolve inside it. The direct Postgres transport does this for you: it runs `CREATE SCHEMA IF NOT EXISTS ""` and sets the search path on every connection checkout.

#### Return RAW error text, never JSON-wrapped

Honeycomb's schema-heal engine classifies failures by regex-matching the RAW Postgres error message, for example `relation "memory" does not exist`. A backend MUST return that text unmodified. If you wrap the error in JSON, `JSON.stringify` escapes the quotes (`relation \"memory\" does not exist`) and the heal regexes stop matching, so tables and columns silently stop self-healing. Pass the database error message through verbatim.

#### Why pg_deeplake is a pure passthrough

`pg_deeplake` speaks Honeycomb's SQL dialect natively: `USING deeplake` table storage, `float4[768]` embedding columns, the `` cosine-distance operator, and `deeplake_index` BM25 indexes. Because the dialect matches, the transport forwards every statement verbatim and returns the result rows as-is. There is no query rewriting to maintain.

---

### 4. Verify

```bash
honeycomb status
honeycomb remember "self-hosted backend is live"
honeycomb recall "self hosted"
```

If `recall` returns the memory you just wrote, the daemon is reading and writing your self-hosted backend.

## Frequently asked questions

Short, plain answers to the questions people ask most about Honeycomb.

### The basics

**What is Honeycomb in one sentence?**
A shared, lasting memory for your AI coding assistants, so what one of them learns is remembered by all of them, across sessions, tools, devices, and (if you want) your team.

**Do I need to know about databases or SQL?**
No. You install with one command, click a button, and use plain commands like `remember` and `recall`. The technical machinery is hidden behind a friendly dashboard.

**Which AI coding assistants work with it?**
Three are supported today: Claude Code, Cursor, and Codex. Three more, Hermes, pi, and OpenClaw, are in progress. Honeycomb plugs underneath whichever supported ones you have installed, and a memory written from one is recalled by the others.

**Who makes Honeycomb?**
It is a collaboration between Legion Code and Activeloop. Activeloop provides [Deep Lake](https://deeplake.ai) (the database for AI it stores memory in) and [Hivemind](https://github.com/activeloopai/hivemind) (the open-source project it builds on). Legion Code adds the multi-tier memory, skill sharing, the self-tidying loop, and the local helper that ties it together.

### Privacy and data

**Where does my data live?**
In your own Deep Lake store, which you control and can even host in your own cloud account. The small helper on your machine is the only thing that connects to it.

**Can other people or teams see my memories?**
No, unless you choose to share. Different companies, teams, and projects are kept separate at the storage layer, and within a team the default leans private. You widen sharing on purpose, never by accident.

**Are my API keys and secrets safe?**
Yes. Secrets are stored separately from memory, encrypted, tied to your machine, and they are never shown to an assistant. An assistant can *use* a secret (for example to call a service) without ever seeing its value.

**Does Honeycomb send my code or prompts anywhere?**
The only outbound traffic is the sign-in with Deep Lake and, optionally, anonymous product-usage counts to help the makers understand adoption. That usage signal never includes your code, prompts, memories, file paths, or names, and you can turn it off entirely. Your actual memories go only to the store you control.

**Can I stop it from recording?**
Yes. You can put Honeycomb in read-only mode for a session (recall still works, nothing new is written), which is handy when you are working with sensitive material.

### Cost and performance

**Does it slow my assistant down?**
No. Recording is cheap and happens out of the way, and if anything ever hiccups, your assistant keeps working normally. The start-of-session briefing it adds is deliberately small.

**Does it cost money in AI model usage?**
The everyday memory features (capturing, recalling, the briefing) do not require their own AI model or API key. Two optional extras can use a model: turning sessions into summaries and skills, and the periodic self-tidying loop. Both are opt-in, so you decide when to spend.

**What happens when I stop working for a while?**
Honeycomb notices when nothing is happening and quietly goes to sleep: after a couple of idle minutes it stops all its background chatter with your storage, which lets the hosted storage wind down so an idle setup costs next to nothing. It still captures anything new the moment you start again. The only thing you might notice is that the very first action after a long idle stretch can take a few extra seconds while storage wakes back up; after that it is full speed. This is on by default and nothing is ever lost while it sleeps.

**Do I need an internet connection?**
You need to be signed in to reach your store. The optional "search by meaning" feature uses a small language model that runs locally on your own machine (downloaded once), not a cloud service.

### How it compares

**How is this different from a regular vector database or "RAG"?**
A plain vector database can store text and hand back similar text. Honeycomb does that and more: it keeps memory at three levels of detail so an assistant can skim then zoom, it tidies itself over time so it gets sharper instead of noisier, it turns lessons into shareable skills, and it works across many tools and your whole team. The storage underneath (Deep Lake) is built for both exact lookups and meaning-based search in one place, with full version history.

**What is "search by meaning" (semantic search) and do I need it?**
It is the ability to find a memory by what it *means*, even if you used different words. It is optional. With it on, Honeycomb catches more of the "I didn't know the exact term to search for" cases. With it off, recall still works by matching words.

### Setup and switching

**I already use Hivemind. What happens?**
Honeycomb and Hivemind are siblings and share one sign-in, but running both at once is not supported. When you set up Honeycomb, the dashboard notices an existing Hivemind install and offers to move you over cleanly, usually without even needing to sign in again.

**Can I use it across multiple machines?**
Yes. Sign in on each machine with the same account, and a memory captured on one is available on the others.

**How do I see what it knows?**
Open the dashboard (`honeycomb dashboard`). It shows your memories, your connected tools, your shared skills, a map of your codebase, and overall health.

**What keeps Honeycomb running if it crashes?**
A tiny built-in watchdog called **Doctor**. The one-command installer sets it up alongside Honeycomb. It quietly checks that the background helper is healthy and, if something breaks, repairs it for you (restart, reinstall, and so on) so you usually never notice. If it cannot fix the problem on its own, it shows a local status page and, unless you opt out, sends home a scrubbed report so the makers can help proactively. That report never includes your credentials, tokens, or code, and you can turn it off (`DO_NOT_TRACK=1`, `HONEYCOMB_TELEMETRY=0`, or the dashboard). Don't want the watchdog at all? Add `--no-doct
