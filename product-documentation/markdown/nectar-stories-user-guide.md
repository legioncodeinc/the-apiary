# Nectar: Stories & User Guide

*The memory layer that helps your agent understand your codebase by meaning, not file names.*

> **The Apiary** by Legion Code Inc., in collaboration with Activeloop.

## Foreword

Ask your agent where you handle logins and it should hand you the right files, even when none of them are named login.ts. That is the job Nectar does. It gives every file a short plain-language description of what it actually does, so your agent matches on meaning instead of names. This guide is the plain-language tour: what Nectar is, a before-and-after walkthrough, the words you will see, how to get started, how to keep it accurate, how to share it with your team, and the questions people ask most.

## What is Nectar?

A 60-second introduction for anyone new to Nectar — what it is, the problem it solves, how it works in plain terms, and what it is not.

### The one-sentence answer

Nectar is a memory layer that helps your AI coding assistant understand your codebase by meaning, not just by file names.

If you ask your agent "where do we handle logins?" it should hand you the right files — even if none of them are named `login.ts`. That is the job Nectar does.

---

### The problem it solves

Modern AI coding tools are good at reading code, but they struggle with one basic task: *finding* the right code to read.

When you ask your agent a question, it usually starts by searching for files whose names or contents match your words. Ask "where do we handle logins?" and the agent hunts for files called `login.ts`, `auth.ts`, or `authenticate.js`. That works when files are named clearly. It breaks down fast in real codebases, where the login logic often lives in a file called `session-refresh.ts` buried three folders deep — a file no search would ever guess.

The result is the same dead end every time: the agent reads the wrong files, gives you a confident-sounding answer about the wrong thing, and you end up doing the search yourself.

Nectar exists to close that gap. It gives every file a short plain-language description of what that file actually does, so your agent can match on *meaning* instead of matching on *names*.

---

### How it works, in one paragraph

Nectar quietly reads each file in your project and writes down what it does in plain language — something like "refreshes login tokens on each authenticated request." It stores that description alongside the file and remembers it from then on. When your agent later searches for "anything about logins," it searches those descriptions, not just the file names. Because the descriptions are written once and kept up to date, the agent finds the right files even when they are poorly named, hidden in an odd folder, or recently moved. You do nothing differently — you just ask your agent the same questions and get noticeably better answers.

A good analogy: Nectar is like the index at the back of a book, but one that has actually read every chapter. A normal index lists words that appear on the page. Nectar lists *what each chapter is about*, so you can look up a topic and land on the right page even when the chapter title never uses the word you searched for.

---

### What Nectar is

- **A memory layer for your codebase.** It remembers what each file is for, in plain language, and keeps that memory current as files change.
- **A helper for your AI coding assistant.** It sits alongside your existing tools and gives your agent better, more relevant files to work with.
- **Team-ready.** Once one person has built up the understanding, the rest of the team gets it for free when they download the project.

---

### What Nectar is NOT

It helps to know the boundaries.

- **It is a memory layer, not a full-text code search engine.** You *can* query it yourself with the `nectar search` command (and the daemon's HTTP endpoint), and the same recall also surfaces automatically through your AI coding assistant via Honeycomb's shared memory, with no search box at all.
- **It is not a replacement for your editor or your AI agent.** It does not write code, and it does not replace the assistant you already use. It makes the assistant you already use smarter about your project.
- **It is not a way to read every line of your code.** Nectar reads enough of each file to describe it accurately. It does not memorize your source code line by line.

---

### What you actually notice

After Nectar has learned your codebase, the change is quiet but real:

- **More relevant file suggestions.** Your agent points you at the file that actually does the work, not just the file that happens to share a name with your question.
- **Fewer dead ends.** The agent stops confidently explaining the wrong file and then having to start over.
- **Less time spent hunting.** You ask the question once, and the answer points at the right place.

The best way to feel the difference is to ask your agent a meaning-shaped question — "where do we handle user authentication?" or "what handles sending emails?" — and notice that the right files come back, regardless of what they are called.

---

### Where to go next

- `how-nectar-helps-your-agent.md` — a before-and-after walkthrough of one real question.
- `nectar-glossary.md` — plain-language definitions of the words you will see.

## How Nectar Helps Your Agent

A before-and-after walkthrough of a single real question — what changes for you and your AI coding assistant when Nectar is turned on.

### The setup

You are working on a project with your AI coding assistant. You did not write most of this code. The folders are not organized the way you would organize them. File names are sometimes clear (`login.ts`) and sometimes not (`session-refresh.ts`, `jwt-helpers.js`).

You want to understand how logins work. So you ask your agent a normal, everyday question:

> *"Where do we handle user authentication?"*

This is the moment where Nectar matters. Here is what happens without it, and what happens with it.

---

### Before Nectar: the agent guesses by name

Without Nectar, your agent searches for files the way a person might scan a folder — by looking for names and words that match your question.

Here is what it finds:

- `src/auth/login.ts` — because the name contains "login."
- `src/api/routes/login.ts` — same reason.

Those are good starting points. But the agent misses the file that actually does most of the work:

- `src/middleware/session-refresh.ts` — this file refreshes your login token on every authenticated request. It is a core part of how logins stay working. But nothing in its name says "login" or "auth," so the search never finds it.

The agent gives you a confident answer built on the two files it found. You read them, think you understand logins, and later discover there was a whole layer you never saw. You hit a bug in the token refresh, have no idea where it comes from, and end up searching the codebase yourself.

This is the dead end Nectar is built to prevent. It is not that your agent is lazy or broken — it simply has no way to know what a file *does* unless the file's name happens to give it away.

---

### After Nectar: the agent knows what each file is for

With Nectar, every file in the project already carries a short plain-language description of what it does. The agent searches those descriptions, not just the file names.

So when you ask the same question — *"Where do we handle user authentication?"* — the agent now finds:

- `src/auth/login.ts` — "checks the username and password and starts a new login session."
- `src/middleware/session-refresh.ts` — "refreshes login tokens on each authenticated request; part of the login session lifecycle."
- `src/lib/jwt.ts` — "creates and checks login tokens; used by login and session-refresh."
- `src/api/routes/logout.ts` — "ends a login session and clears the refresh token."

Notice what happened: the agent found the files that *participate in* logins, not just the files *named for* logins. The critical `session-refresh.ts` file — invisible to a name search — came back because its description matches the meaning of your question.

The difference is not a nicer list. The difference is that you now actually understand how logins work, because the agent handed you the whole system instead of just the obviously-named part of it.

---

### The before-and-after at a glance

| | Without Nectar | With Nectar |
|---|---|---|
| How the agent searches | By file name and exact words | By what each file actually does |
| What it finds | Files whose names match your question | Files whose *purpose* matches your question |
| Files it misses | Anything not obviously named (like `session-refresh.ts`) | Almost nothing relevant |
| Your experience | Partial answers, dead ends, manual hunting | Complete answers on the first try |

---

### Why the descriptions survive everyday chaos

Codebases do not stand still. You rename files, move them between folders, copy them to start a new feature, and edit them constantly. A memory layer that forgets everything every time a file moves would be useless.

Nectar is built so that its understanding survives all of this:

- **If you rename a file**, Nectar still knows what it does. The description follows the file, not the name.
- **If you move a file to a new folder**, the description comes along. Reorganizing your project does not wipe the slate clean.
- **If you copy a file to start something new**, the copy keeps a link to the original — so Nectar understands the new file is related, without confusing it for the old one.
- **If you edit a file**, Nectar notices the change and updates the description when it matters.

In plain terms: **the system remembers what each file is for, even if you completely reorganize your folders.** You never lose the built-up understanding, and you never have to teach it again.

---

### What this means for you, day to day

The value is not in any single search. It is in the accumulation:

- **You trust your agent more.** When it points you somewhere, that somewhere is usually right.
- **You onboard faster.** On a project you have never seen, meaning-based answers get you oriented in minutes instead of hours.
- **You stop fighting your file structure.** Whether the codebase is tidy or a mess, the agent can still find what matters.
- **Your whole team benefits.** Once one person's project has the descriptions, everyone who downloads it gets the same understanding — no setup required.

---

### The takeaway

Nectar does not change how you ask questions. It changes whether the answers are worth trusting.

The next time you ask your agent "where do we handle ___?" — fill in the blank with anything: payments, emails, logins, reporting — the difference is whether the agent hands you the obviously-named file, or the set of files that actually does the work. Nectar is what makes the second outcome the normal one.

---

### Where to go next

- `what-is-nectar.md` — the 60-second overview, if you have not read it.
- `nectar-glossary.md` — the words you will see, defined in plain language.

## Nectar Glossary

Plain-language definitions of the words you will see when reading about Nectar — each with a short note on why it matters to you.

### How to use this glossary

These are the customer-facing terms — the words that describe *what Nectar does for you*, not the engineering underneath. Each entry has a one-sentence definition and a one-sentence "why it matters" note. If a word is not here, it is an internal engineering term you do not need to know to use the product.

---

### Memory layer

**What it is:** The overall thing Nectar provides — a stored understanding of what every file in your project is for, kept up to date as your code changes.

**Why it matters to you:** It is the reason your AI coding assistant gets noticeably better at finding the right files. Without it, the assistant searches by name; with it, the assistant searches by meaning.

---

### Nectar

**What it is:** A file's identity record — the small, stable tag Nectar assigns to a single file so it can keep track of that file forever, even if the file is renamed, moved, or edited.

**Why it matters to you:** It is how Nectar remembers a file across all the chaos of normal development. Because each file has a stable identity, its history and description never get lost when you reorganize your project.

---

### Description

**What it is:** A short, plain-language note that says what a file actually does — for example, "refreshes login tokens on each authenticated request."

**Why it matters to you:** This is the heart of how Nectar helps your agent. When you ask a question by meaning ("where do we handle logins?"), the agent searches these descriptions instead of file names, so it finds files that do the work even when their names give nothing away.

---

### Concepts (tags)

**What it is:** Short labels that link related files together across folders — like tagging a file with "authentication" or "email" so files that share a purpose can be found together.

**Why it matters to you:** They let your agent pull together everything tied to a topic in one go, even when those files live in completely different parts of your project and would never be grouped by name alone.

---

### Fresh-clone inheritance

**What it is:** When a teammate downloads (clones) your project, they automatically receive the same file understanding Nectar already built — no setup, no waiting, no cost.

**Why it matters to you:** One person builds up the understanding once, and the whole team gets it instantly. A new teammate can ask the agent "where do we handle logins?" on their first day and get the same complete answer you get.

---

### Team-share

**What it is:** Nectar's understanding belongs to the whole team working in a project, not to any one person's computer — everyone working in the same project sees the same file descriptions.

**Why it matters to you:** You never have to "teach" the same thing twice. Whatever understanding exists for the project is shared, so every teammate's AI assistant is equally informed.

---

### Brooding

**What it is:** Nectar's first read-through of your project, where it reads every file and writes the initial descriptions. It happens once, usually when you first turn Nectar on.

**Why it matters to you:** It is the one-time setup cost. After brooding finishes, the understanding is in place and only needs light updates as files change — you are not paying for a full re-read every time.

---

### Semantic search

**What it is:** Searching by *what something means* rather than by the exact words or file names it contains — matching the intent of your question to the purpose of each file.

**Why it matters to you:** It is the difference between your agent finding `login.ts` (because the name matches) and finding `session-refresh.ts` (because what it *does* matches). Semantic search is what makes the second find possible.

---

### A word about words you will *not* see here

You may come across terms like "embeddings," "vectors," or other engineering jargon in deeper documentation. You do not need any of them to use Nectar. They describe *how the memory layer works under the hood*; this glossary describes *what it does for you*. If a concept is not in this list, it is internal detail, not something you need to act on.

---

### Where to go next

- `what-is-nectar.md` — start here if you are new.
- `how-nectar-helps-your-agent.md` — see the value in a real before-and-after example.

## Getting Started With Nectar

Walks you through your project's very first scan (what Nectar does on first run, what it costs, and how to know it worked), so you can run `nectar search "where is the login logic"` and get the right files back.

### What happens on your first run

The first time Nectar meets your project, it does not know anything yet. Every file is just a name on disk. To turn that pile of names into something your AI agent can reason about, Nectar reads through your files and writes a short, plain-language description for each one. We call this first pass **the first scan** — internally it is called "brooding," but what it amounts to is: read your files, understand them, and write down what each one is for.

Once the first scan finishes, you can search your codebase in a new way. Instead of only finding files whose names match a search word, `nectar search` understands what each file *does*. Run `nectar search "where is the login logic"` and it can return a file like `src/middleware/session-refresh.ts` (even though that file has no "login" in its name) because Nectar described it as part of the login session lifecycle. The same recall also surfaces directly through your AI coding assistant via Honeycomb's shared memory, so you get the benefit whether you run the `nectar search` command, hit the daemon's HTTP endpoint, or just ask your agent.

The understanding Nectar builds is saved as a small shared file at the root of your project: `.honeycomb/nectars.json`. Think of it as a shared map of your codebase. You do not need to open it or edit it. Nectar maintains it for you, and you commit it to your repo just like any other project file. (For what that shared map makes possible across your team, see the team-share guide.)

---

### Before you brood: prerequisites

The dry-run preview below and `nectar search` work without any extra setup. A real first scan, though, needs two things in place so Nectar can actually describe your files:

- **Deeplake credentials.** The shared `~/.deeplake/credentials.json` file (written when you sign in with `hivemind login`) tells Nectar where to store what it learns.
- **A description model, via Portkey.** Set three environment variables so Nectar can call the model that writes descriptions:
  - `NECTAR_PORTKEY_ENABLED=1`
  - `NECTAR_PORTKEY_API_KEY=`
  - `NECTAR_PORTKEY_CONFIG=`

If either prerequisite is missing, the daemon still starts and serves `/health`, but brooding stays dormant: it describes nothing and tells you why. A startup log line names exactly what is missing, `/health` reports a `brooding.reason`, and on an interactive terminal the daemon prints the exact steps to fix it. Configure both, then start the daemon (or run `nectar brood`) and the first scan proceeds.

---

### Before you run it: preview the cost

The first scan uses an AI model to describe your files, so it carries a small one-time cost. The good news is that cost is predictable, small, and paid only once for the whole project.

A typical project of 2,000 files costs about **three dollars** total for the first scan. A small service with 200 files runs about thirty cents. A very large codebase of 10,000 files runs around fifteen dollars. These are one-time numbers — you will not pay them again unless you delete the shared map and start fresh.

If you want to know the exact cost for *your* project before spending anything, run the preview:

```bash
nectar brood --dry-run
```

This reads your files, counts them, sorts them by size, and prints an estimate of how many descriptions it will write and roughly what they will cost. It does **not** describe anything, does **not** spend money, and does **not** change your project. Use it whenever you want to sanity-check the bill.

---

### Run the first scan

When you are ready, start the first scan:

```bash
nectar brood
```

You will see progress as it works through your files. Here is what it is doing behind the scenes, in plain terms:

1. **It discovers your files.** It looks at the same set of files your version control sees — it respects your ignore rules, so it will not waste effort on dependencies, build output, or anything else you have chosen to skip.
2. **It skips files it cannot or should not describe.** Images, fonts, binaries, and unusually large files are noted but not described. They still get tracked, but Nectar does not spend money trying to summarize a PNG.
3. **It groups the rest into efficient batches.** Many small files are described together in a single pass, which is what keeps the cost low. Larger files are described one at a time so each one gets enough attention.
4. **It writes a description for each described file.** Each description is one to three plain-language sentences: what the file does and what it is for, plus a short title and a few topic tags.
5. **It saves the shared map.** Everything is written to `.honeycomb/nectars.json`, the small committed file at your project root.

You can walk away while it runs. If you close your laptop or quit partway through, nothing is lost — the next time it starts, it picks up exactly where it left off. You never pay to redo work that already finished.

---

### What Nectar never does

Two promises worth stating plainly, because they matter for trust:

**It never modifies your source files.** Not a single character of your code, config, or documentation is ever changed. The only file Nectar writes is the shared map (`.honeycomb/nectars.json`), and even that is something it regenerates from scratch — it is not your code, and it is not a secret second copy of your project.

**It does not send your code to the model forever.** The first scan reads each file once to write its description. After that, Nectar only re-reads a file when that file has *meaningfully* changed — and it is smart enough to ignore cosmetic changes like reformatting. Day-to-day, the cost is essentially zero. (See the freshness guide for exactly how it decides what to re-describe.)

---

### How to know it worked

The simplest test is a `nectar search` query the old name-based search would get wrong. With the daemon running, try something like:

- `nectar search "where is the login logic"`
- `nectar search "everything related to sending email"`
- `nectar search "what handles retry on failed payments"`

If the results include files that do the thing you asked about, regardless of what those files are named, the first scan worked. Semantic recall is live, and it surfaces both through `nectar search` and directly through your AI coding assistant via Honeycomb's shared memory.

You can also check the shared map directly. After a successful first scan, `.honeycomb/nectars.json` exists at your project root and contains one entry per described file, each with a title and a short description. You never need to read it by hand, but it is there, and it is human-readable if you are curious.

---

### What comes next

- **Keep the shared map committed.** Add `.honeycomb/nectars.json` to version control. This is what lets teammates inherit your project's understanding instantly and for free — see sharing understanding with your team.
- **Let it stay fresh as you work.** When the brood prerequisites are configured, the daemon watches for changes and re-describes files as you edit, rename, and reorganize; see keeping descriptions accurate.
- **Re-run with a cost cap if you like.** `nectar brood --limit 100` describes at most 100 files at a time, useful if you added a large batch of new files and want to pace the cost.

That is the entire first-run journey. One scan, a small one-time cost, and your project is ready to answer questions the way a teammate who has been there for years would.

## Keeping Descriptions Accurate

Explains how Nectar keeps every file's description current as you edit, rename, move, and copy-paste — without re-describing on every keystroke, and without losing track of a file when it moves.

### The promise

After the first scan, your project has a description for every file. But code is not static. You edit files, rename them, move them between folders, copy blocks from one place to another, and delete things. If the descriptions stayed frozen at their first-scan wording, they would drift out of sync with reality within a day.

Nectar's job in steady state is to keep descriptions accurate **without hovering over your shoulder**. When the daemon is running with the brood prerequisites configured, it does this with four behaviors, each tuned to a specific kind of change. The guiding principle throughout: only re-describe when something has *meaningfully* changed, so cost stays low and your descriptions stay trustworthy.

---

### Edits — descriptions update after a pause, not on every keystroke

When you save a file, Nectar notices. But it does not rush to re-describe it the instant you press save — and it certainly does not re-describe on every keystroke. That would be wasteful, jumpy, and expensive.

Instead, it waits through a short pause. If you save the same file several times in quick succession (as you almost always do while working), those saves collapse into a single "this file changed" signal. Only after you have stopped editing for a moment does Nectar take a closer look.

Even then, it does not always re-describe. Before spending anything, it asks a simple question: **did the meaning of this file actually change?** It compares the new version of the file to the old one. If the change is purely cosmetic — reformatting, whitespace, a touched-up comment — it quietly keeps the existing description. No AI call is made, no money is spent, and the description does not churn.

Only when the change crosses a meaningful threshold does Nectar write a fresh description. The result is that routine editing costs essentially nothing, and descriptions only change when they genuinely need to.

---

### Renames and moves — the description follows the file

A common worry with any tool that tracks files is: *what happens when I move or rename a file?* Many tools lose track, because they identify a file by its path or name — change the path, and as far as they know, it is a brand-new file.

Nectar does not work that way. It gives each file a stable identity that is **independent of its name or location**. When you rename a file or move it to a different folder, Nectar recognizes that it is the same file in a new place. The description travels with it.

In practice this means:

- **Rename `login.ts` to `auth-handler.ts`** — the description stays attached. You do not lose the understanding Nectar built, and you do not pay to re-build it.
- **Move `utils.ts` from `src/` to `src/lib/legacy/`** — same thing. The file is tracked across the move, description intact.
- **Reorganize a whole directory** — every file you shuffle keeps its description, because each one is tracked by identity, not by where it happens to sit.

This is one of the most important properties of Nectar: **refactoring does not reset understanding.** You are free to rename and reorganize as much as you like.

---

### Copy-paste — the copy remembers where it came from

When you copy a file (or copy a chunk of code into a new file), something interesting happens. The new file is genuinely a new thing — it deserves its own identity and, eventually, its own description. But it is also *derived* from something that already exists, and that relationship is worth remembering.

Nectar handles this by giving the copy a fresh identity **and a link back to the original**. The copy keeps a pointer that says "I came from here." This is useful in two ways:

- **Seeing where code came from.** When you are reading a file that started life as a copy, the link lets you trace it back to its source. This is handy for understanding why a file looks the way it does, or for finding the canonical version of something that has been duplicated.
- **A fresh start with a remembered origin.** The copy is described on its own from its current contents (it does not inherit the original's description), while the link back to the source is preserved so its lineage is never lost. As the copy evolves and diverges, its description reflects what it has become.

So copy-paste is not a confused event (two files claiming to be the same thing) and not a lost event (the relationship forgotten). It is a tracked, recoverable event — the copy stands on its own, but never forgets its origin.

---

### What to do if a description seems wrong

Descriptions are written by an AI model, and no model is perfect. Occasionally you will see a description that is vague, slightly off, or just unhelpful. This is expected, and there is a straightforward way to deal with it.

Most of the time, **the problem fixes itself.** The next time you meaningfully edit that file, Nectar re-describes it from scratch, and the fresh description is often clearer than the original. Patience is a valid strategy. If you want to force the issue, re-describe with a brood rather than waiting for the next edit:

```bash
nectar brood --force
```

`review-matches` is a **different** tool, and it is worth being precise about what it does. It does not repair descriptions. It surfaces low-confidence **identity** matches: the cases where a file moved *and* changed enough that Nectar could not be certain the new file is the same one it tracked before. You confirm, reject, or skip each candidate so a mis-association never silently corrupts a file's history chain:

```bash
nectar review-matches
```

Reach for `review-matches` when you suspect a moved-and-edited file was tracked as a brand-new file (or the reverse), not when a description simply reads poorly.

---

### Why the cost stays low

It is worth restating the reassurance, because "AI describes your files" can sound expensive. The first scan is the only time Nectar describes everything at once, and even that is a small one-time cost (see the getting started guide).

After that, Nectar re-describes a file only when **all** of these are true:

1. The file was meaningfully edited (not just reformatted).
2. The editing settled down past the pause window (not on every save).
3. The change crossed the threshold where the old description no longer fits.

On a typical workday, that filters down to a handful of files at most — often zero. Cosmetic changes, rapid-fire saves, and untouched files all cost nothing. The steady-state bill for keeping descriptions accurate is a small fraction of the one-time first-scan cost, and for many projects it rounds to zero.

---

### Recap

- **Edits** update a description only after a pause and only when the change is meaningful — cosmetic changes and rapid saves cost nothing.
- **Renames and moves** never lose the description, because files are tracked by stable identity, not by name or path.
- **Copy-paste** gives the copy its own identity plus a link back to the original, so you can trace where code came from; the copy starts with its own fresh description, not the original's.
- **Wrong descriptions** usually self-correct on the next meaningful edit or a `nectar brood --force`. `nectar review-matches` is a separate tool for confirming low-confidence identity matches, not for repairing descriptions.
- **Cost stays low** because re-description is rare and selective, not constant.

The result is a project whose descriptions stay accurate as it evolves — quietly, cheaply, and without you having to think about it.

## Sharing Understanding With Your Team

Explains what happens when you commit Nectar's shared map to version control: a teammate who clones the repo gets the same file descriptions instantly, for free, with no re-scan - so everyone shares one understanding of the codebase.

### The idea in one sentence

The first person to run Nectar on a project pays a small, one-time cost to describe every file. After that, those descriptions live in a small shared file at the project root, and **every teammate who clones the repo inherits them for free**.

No re-scan. No new cost. No waiting. The moment your teammate's copy of Nectar starts up, it recognizes the shared map, matches it against the files on disk, and the project's understanding is live — identical to yours.

---

### Why committing the shared map matters

After the first scan, Nectar writes a small file at the root of your project: `.honeycomb/nectars.json`. You can think of it as **a shared map of your codebase** — one entry per file, each carrying a short title and description of what that file does.

This file is meant to be committed, just like `package-lock.json` or any other project artifact your team relies on. Here is why that matters:

- **It is the bridge between "I scanned this" and "we all benefit."** The first scan's results do not help anyone else until the shared map reaches them. Committing it is what turns a single developer's investment into a team asset.
- **It makes descriptions a reviewable artifact.** When a teammate opens a pull request, they can see not only the code you changed but also the description Nectar wrote for any new file — and sanity-check that it reads reasonably. The shared map is human-readable, not an opaque database blob.
- **It works offline.** A teammate on a fresh clone gets the full set of descriptions without any network call, login, or cloud sync. Everything needed is already in the repo.

---

### The team-share journey, step by step

#### Step 1 — Commit the shared map

After your first scan finishes, add the shared map to version control:

```bash
git add .honeycomb/nectars.json
git commit -m "Add Nectar shared map"
```

From this point on, the shared map travels with your repository like any other file. You do not need to think about it again — Nectar updates it automatically as descriptions change (see the freshness guide for how that stays low-churn).

#### Step 2 — A teammate clones the repo

When a teammate runs `git clone`, they get your source files **and** the shared map, in one step. Nothing special is required on their end — a normal clone is enough.

#### Step 3 — Their Nectar recognizes the existing descriptions

The first time your teammate's copy of Nectar starts up in the cloned project, it notices the shared map and does something efficient: it matches every file on disk against the map's records. For each match, it inherits that file's description directly. No new descriptions are written. No AI calls are made.

A current shared map typically produces **zero re-scan work and zero cost** on a fresh clone. Every file's content lines up with a record in the map, so every description carries over. The person who first scanned the project paid the bill; the clone pays nothing.

#### Step 4 - Everyone shares one understanding of the codebase

Once inheritance finishes, your teammate's project is in the same state yours was right after the first scan: every file carries its title and description. They can run `nectar search "where is the login logic"` and get lexical (name and description) matches straight away. Full vector-based semantic recall for the inherited files follows once their daemon (running with the brood prerequisites configured) re-embeds those inherited entries. That recall surfaces both through `nectar search` and directly through an AI coding assistant via Honeycomb's shared memory. There is one shared understanding of the codebase, and you are all working from it.

---

### What happens when descriptions differ

Two teammates may describe the same file differently over time — for example, you edit a file in your branch while a teammate edits a different file in theirs, and both of you commit an updated shared map. This is normal, and Nectar handles it without drama.

When those changes meet (on a merge or a pull), the system **reconciles** them. Each file is tracked independently, so two teammates updating two different files simply produce two independent updates in the shared map — no conflict, because they touch different entries. Even when two people change the *same* file, the resolution is straightforward: each file's description is tied to that file's current content, so the version that matches the file as it exists after the merge is the one that wins. The shared map reflects the merged state of the code, not a separate battle over wording.

The practical effect: merges stay clean, and the shared map always describes the code as it actually is.

---

### What happens on a branch switch

Switching branches can suddenly show or hide a batch of files — a feature branch might add new files, and switching back to `main` removes them again. You might worry that every branch switch throws away understanding and forces a re-scan.

It does not. Nectar gives deleted-or-switched-away files a **grace period**. When a file disappears from disk because you switched branches, its entry in the shared map is kept around for a while rather than dropped immediately. Switch back, and the file returns with its description intact — no re-scan, no cost.

Only after the grace period passes (and the file is still genuinely gone) is the entry cleaned up. This means hopping between branches as part of your normal workflow costs nothing. The understanding you built is sticky.

---

### What happens if the shared map is out of date

Sometimes a teammate clones a repo whose shared map is a few commits behind the files on disk — maybe someone added files but forgot to commit the updated map, or the map is simply old. Nectar handles this gracefully too.

For every file whose content lines up with a record in the map, the description is inherited as usual — free and instant. For files that do **not** line up (new files, or files that changed since the map was last updated), Nectar falls back to its normal tracking: it figures out the best match for each one, mints a fresh record where there is no match, and describes only those unmatched files. The bill in this case is limited to the gap — the files the map did not already cover — not a full re-scan.

So a stale shared map is never a disaster. It just means the teammate pays to describe whatever is new or changed since the map was last refreshed.

---

### A note on choosing not to commit

Some teams prefer not to commit the shared map — perhaps to avoid any extra diff noise in pull requests, or because each developer wants an independent scan. Nectar supports this: if you add `.honeycomb/nectars.json` to your ignore file, Nectar still writes it locally for your own use, but it is not shared.

The tradeoff is simple and worth understanding. Without the shared map in the repo:

- **Every clone pays for its own first scan.** Each teammate re-describes every file from scratch, including the cost.
- **Descriptions may drift between teammates.** Without a shared source, each person's copy can describe the same file with slightly different wording.
- **The team-share story stops working.** No inheritance on clone, no shared semantic index.

The recommendation is to commit it. The diff noise is small (one entry per changed file, written at most once per editing session), and the payoff — instant, free, identical understanding for every teammate — is large.

---

### Recap

- Commit `.honeycomb/nectars.json`. It is the bridge that turns one person's scan into the whole team's asset.
- A fresh clone inherits every description for free, with zero re-scan cost, and works offline.
- Everyone shares one understanding of the codebase, so `nectar search "where is the login logic"` returns the same files across the team; vector recall for inherited files converges once the daemon re-embeds them.
- Merges reconcile cleanly because each file is tracked independently.
- Branch switches are free thanks to a grace period before any cleanup.
- A stale map is not a disaster — only the gap gets re-described.

That is the entire team-share model: understand once, share everywhere.

## Nectar Basics FAQ

The foundational questions a new user asks: what Nectar is, whether it changes how you work, and what it does (and does not) touch in your project.

### Q: What is Nectar?

Nectar is a semantic memory layer for your project. It gives every file a stable identity and a short, plain-language description of what that file is for, so an AI coding assistant can answer a question like *"where is the login logic?"* and get back the right files — even the ones that are not named `login`.

The key idea is matching by **meaning**, not just by name. Regular search can only find a file if you already know part of its name or the exact text inside it. Nectar understands what each file *does*, so it can surface a file like a session-refresh middleware as part of "the login logic," even though the word "login" never appears in it.

It runs quietly in the background while you work. You do not launch it, configure it per query, or think about it day to day. It builds a shared map of your codebase once, keeps it up to date as files change, and feeds that understanding to your AI assistant.

---

### Q: Do I need to change how I write code?

No. You write, name, and organize your code exactly as you do today. Nectar reads your files and builds its understanding from what is already there.

There are no special comments to add, no markers to insert, no naming conventions to follow, and no annotations required. You do not have to tag files, fill out metadata, or describe anything yourself. The whole point is that the descriptions are produced for you, automatically, so you can keep working the way you already do.

Your existing workflow — your editor, your version control, your build — is untouched. Nectar layers on top of it without asking you to adapt to it.

---

### Q: Does it work with my existing AI coding assistant?

Yes. Nectar is designed to feed the assistant you already use, not to replace it. It plugs into the search and memory that your assistant already relies on, so that when your assistant goes looking for relevant code, it draws on Nectar's understanding of what each file means.

Think of it as giving your assistant a shared map of the codebase that it can consult. Your assistant still does the thinking, the editing, and the answering. Nectar just makes sure it is looking in the right places — by meaning, not only by keyword.

Because the understanding lives in a single shared map that is part of your project, every member of your team's assistant benefits from the same map, with no extra setup per person.

---

### Q: Does it modify my source files?

No, never. Nectar only **reads** your source files. It does not edit them, does not insert comments into them, and does not rewrite your license headers or any other line of any file.

The one and only thing it writes is a single separate file at the root of your project — a shared map that records each file's identity and its plain-language description. This file is kept apart from your source code, and it is fully regenerable: it can be deleted and rebuilt from Nectar's memory store at any time, with nothing lost.

This is a deliberate design choice. Mutating source files (for example, stamping an identity number into the first line of every file) was considered and rejected because it would collide with license headers, create merge conflicts, and fail on files that have no comment syntax at all. Nectar keeps identity out of your code entirely.

---

### Q: What kinds of files does it understand?

Nectar looks at the whole project, not just source code. It describes any text file that carries meaning: source files, configuration files, documentation, environment-example files, and more. If a file helps explain how the project works, Nectar can describe it.

A few categories are handled specially. Binary files (images, fonts, compiled assets) and very large files are not given a prose description — there is nothing meaningful for a language model to say about them — but they are still tracked and identified, so they are never invisible to the system.

The practical effect is that Nectar's map covers the parts of your project that matter for understanding it: the code, the configs, and the docs. It does not force everything into the same mold.

---

### Q: Does it replace my editor's search?

No — the two are complementary, and you will likely use both.

Your editor's search (and its "go to symbol" or "find references" features) is structural. It is excellent at precise tasks: jump to this exact function, find everywhere this exact name is used, rename a symbol safely across the codebase. It works because it reads the literal structure of the code.

Nectar is semantic. It answers questions that structural search cannot: *"where do we handle a user logging in,"* *"what files are involved in sending email,"* *"find everything related to the checkout flow."* These questions are about meaning and intent, not exact names.

Use your editor's tools when you know the name. Use Nectar (through your AI assistant) when you know the *idea* but not the name. They cover different ground and do not get in each other's way.

---

### Q: Is it free, and what does it cost to run?

Building the shared map the first time uses a fast, low-cost AI language model to produce the descriptions, so there is a small one-time cost per project. For a typical project of about 2,000 files, the first scan lands at roughly **$3**. It scales predictably with size: a small 200-file service costs about $0.30, and a large 10,000-file codebase around $15.

You can preview the exact cost before spending anything by running the first scan in a dry-run mode, which shows the estimated price without making any calls.

After that, the ongoing cost is minimal. Nectar does not re-describe your whole project on every edit — it only re-describes a file when its contents have meaningfully changed, and it waits for a pause in editing before doing so. Day-to-day refreshing costs pennies or nothing.

There is also a way to make clones of the same project free: the shared map can be committed to your repository, so a teammate who clones the project inherits all the descriptions without any new scanning cost. (See the privacy and cost FAQ for the details.)

## Nectar Comparison FAQ

The "how is this different from what I already use" questions, answered at a user level — honestly and without hype.

### Q: How is Nectar different from regular code search?

Regular search matches **names and text**. Nectar matches **meaning**.

When you use your editor's search (or grep, or "find in files"), you have to already know something about what you are looking for: a function name, a variable, or an exact string that appears in the file. It works by comparing the letters you typed against the letters in your files. It is fast and precise — but it is blind to intent. It cannot find login logic unless the word "login" literally appears somewhere.

Nectar works the other way around. It already knows what each file *is for*, because it has a plain-language description of every file. So you can ask in ordinary language — *"where is the login logic"* — and get back the right files, including ones whose names and contents never contain the word "login" at all.

A concrete example: a file named `session-refresh.ts` that quietly refreshes login tokens is part of your login system, but regular search will not surface it for "login" unless you already know it is there. Nectar will, because its description captures that the file is part of the login session lifecycle.

The two are not in competition. Search is the right tool when you know the name. Nectar is the right tool when you know the idea but not the name.

---

### Q: How is it different from AI tools that index my codebase?

Several AI tools today read your codebase, chop it into pieces, and build a searchable index so an assistant can answer questions about it. This sounds similar to Nectar, and there is real overlap — but three differences matter in practice.

**First, Nectar remembers what files are *for*, and that memory survives moves and renames.** Many indexing tools treat a file's location or its exact contents as its identity. Rename a file, move it to another folder, or copy it, and the tool treats it as something new — it has to re-index and often loses the connection to what came before. Nectar gives each file a stable identity that follows the file itself, so its description and its history survive a rename, a move, or a refactor. The understanding is durable.

**Second, that understanding is shared across the whole team, not rebuilt per person.** Most indexing tools do their work separately on each person's machine. Every teammate's clone re-indexes from scratch, pays the cost again, and builds its own private picture of the codebase. Nectar writes one shared map that can be committed to the repository, so a teammate who clones the project inherits the full set of descriptions instantly and for free. The team builds one shared understanding, once.

**Third, it does not duplicate the structural work your other tools already do.** Many indexers parse your code into fine-grained symbols (functions, classes) and embed each one. That is useful, but it is also the job your editor's "find references" and symbol-navigation features already do well. Nectar deliberately describes files at the level of "what is this file for," and leaves symbol-level precision to the tools that already do it — so it complements your existing setup rather than overlapping it.

The honest summary: Nectar is not the only tool that lets an assistant search your code semantically. Its difference is that the search is backed by **durable, shareable, file-level understanding** that survives the way code actually moves and grows over time.

---

### Q: Does it replace my AI assistant?

No. It makes the assistant you already use **smarter about your codebase**.

Your AI coding assistant is good at reasoning, writing code, and answering questions — but it can only work with what it can find. When it does not know which files are relevant, it guesses, asks you, or searches by keyword and often misses the files that matter. Nectar fixes that last part: it gives your assistant a reliable map of what each file means, so its searches land on the right place the first time.

Think of the division of labor this way. The assistant does the thinking and the doing. Nectar supplies the context — the shared understanding of the codebase that the assistant draws on. Your assistant is still the one answering questions, writing code, and making changes. Nectar just makes sure it is not working in the dark.

Because it feeds the assistant rather than replacing it, you keep whichever assistant you prefer. You are not switching tools; you are upgrading the quality of the context your tool can reach.

---

### Q: Does it conflict with my IDE's symbol navigation?

No. The two are complementary, and there is no overlap or interference between them.

Your IDE's symbol navigation — "go to definition," "find references," "rename symbol" — is **structural**. It reads the literal grammar of your code to know that this name refers to that function, and that these calls point back to it. It is exact, compiler-aware, and irreplaceable for tasks like safely renaming something or tracing a call chain.

Nectar is **semantic**. It knows what a file *means* and *is for*, so it can answer questions of intent — "which files handle authentication" — that structural navigation was never built to answer. It does not parse your code's grammar or try to resolve symbols; it leaves that entirely to your IDE.

Use your IDE's navigation when you want to follow the wiring: jump to a definition, find every caller, refactor a name. Use Nectar, through your assistant, when you want to find things by purpose: locate everything tied to a feature, a concept, or a responsibility. One finds by structure; the other finds by meaning. They answer different questions, and using both gives you the most complete picture of your codebase.

## Nectar Privacy and Cost FAQ

The trust questions: where your code goes, what it costs, how often it runs, and what happens if you stop using it.

### Q: Does my code leave my machine?

When Nectar writes a plain-language description for a file, that description is produced by an AI language model. To produce it, the relevant file contents are sent to the model so it can read them. The important detail is **how** they are sent: the system routes through a gateway that you configure yourself, using the same connection the rest of the tool already trusts.

Here is what happens, in plain terms. Nectar runs as a background service on your machine. It reads your files locally. When a file needs describing, it sends only that file's contents — through your own configured gateway — to the model, receives a short description back, and stores the result. It does not upload your entire project in one go, and it does not send files to an unknown or hard-coded destination.

A few practical points:

- **Identity is local.** The stable identity assigned to each file is created on your machine and stored locally. It never needs to leave.
- **Descriptions are generated, not your code.** What comes back from the model is a one-to-three sentence summary of what the file is for. Your raw source is not kept on the other end.
- **You control the route.** Because requests go through your configured gateway, the same policies, keys, and privacy controls you already trust apply here too.

If your organization requires that no source leave the network at all, that is a gateway-configuration question. Nectar's design makes the routing explicit and yours to control, rather than hiding a fixed endpoint inside the tool.

---

### Q: What does the first scan cost?

The first scan — the one-time process that builds the shared map for a project — uses a fast, low-cost AI model to produce the descriptions, and the cost scales with the number of files. It is a **one-time cost per project**, not a recurring fee.

For a typical project of about 2,000 files, the first scan lands around **$3**. The cost scales predictably with size: a small 200-file service runs about $0.30, and a large 10,000-file codebase around $15. Smaller files are described efficiently several dozen at a time, which keeps the price low; only genuinely large files cost more, one at a time.

Before you spend anything, you can run the first scan in **dry-run mode**. This shows you exactly how many files will be described, how they will be grouped, and the estimated dollar cost — without making any calls. It is the recommended first step on any new project, so there are no surprises.

---

### Q: Subsequent clones of the same project are free — how?

Yes. Once the shared map has been built for a project, it can be committed to your repository — much like a lockfile. When a teammate clones the project, their copy already contains the map, so their Nectar recognizes every file and inherits its description without doing a new scan.

Here is why that works. Nectar records a fingerprint of each file's contents. When a fresh clone is opened, the tool checks each file's fingerprint against the committed map. A match means *"this is the same file someone already described"* — so it simply adopts the existing identity and description. No AI model is called, and no scanning cost is incurred.

The practical effect: one person (or one automated run) pays the one-time cost to build the map; everyone else on the team inherits every file's identity and description for free, instantly, the moment they clone. Lexical recall (by name and description) works right away; full vector-based semantic recall for the inherited files converges once a configured daemon re-embeds them. And because the map is just a committed file, the inherited descriptions work even with no network connection at all.

---

### Q: Does it re-scan on every edit?

No. Re-describing the whole project on every save would be wasteful and slow. Instead, Nectar only re-describes a file when its contents have **meaningfully changed**, and it waits for a natural pause in editing before doing anything.

Two behaviors make this efficient:

- **Identity survives edits.** A file's identity is not derived from its contents, so editing a file does not break the link to its history. The existing description stays attached; only the description itself may need a refresh.
- **Updates are debounced and targeted.** If you are in the middle of a rapid edit session, Nectar waits for you to stop, then refreshes only the files that actually changed — not the entire project. One burst of editing produces one small update, not a flurry of one per keystroke.

The result is that day-to-day cost is minimal: pennies for the occasional file that genuinely changed, and nothing at all for files that did not.

---

### Q: What happens to the descriptions if I stop using Nectar?

Nothing is lost. The descriptions and identities live in a shared map that is stored as part of your project, separate from your source code. If you stop using Nectar, that map simply sits there — it does not vanish, and it does not damage your code.

Because the map is a committed, reviewable file in your repository, it is also portable and durable. It does not depend on a running service or a continued subscription to exist. You can walk away from the tool today and the map is still there tomorrow, intact, for anyone who wants it.

If you ever come back, or a teammate picks it up later, the map is ready and waiting. And because your source files were never modified, removing Nectar leaves your code exactly as it was — there is nothing to clean up, no embedded markers to strip out, no leftover edits to undo.

---

### Q: Does it work offline?

Yes. Because the shared map can be committed to your repository, a clone of the project works without any network connection at all.

When the map is present, Nectar can recognize every file and serve its description purely from what is already on disk, with no calls home and no cloud lookup. This makes the project's descriptions and lexical recall fully usable even on a plane, behind a strict firewall, or during an outage; vector-based semantic recall additionally needs each file's embedding to have been computed.

The one thing that does require a connection is **producing new descriptions** — for a file nobody has described yet. That step calls an AI model through your gateway, so it needs network access. But once a description exists and is saved to the map, it is available offline forever. For an already-described project, offline use is the norm, not a special case.
