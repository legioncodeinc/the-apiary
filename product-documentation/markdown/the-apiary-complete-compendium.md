# The Apiary: Complete Product Compendium

*Stories, user guides, technical manuals, and specifications for the full Apiary stack.*

> **The Apiary** by Legion Code Inc., in collaboration with Activeloop.

## About this compendium

The Apiary is a stack of small, sharp programs that give your AI coding agents one shared, lasting memory on hardware you control. Five products carry the load. Honeycomb is the memory. Nectar is the understanding layer that lets an agent find code by meaning. Hive is the one portal you open. Doctor is the watchdog that keeps the whole thing alive. Queen is the cloud orchestrator for when the stack outgrows a single machine.

This document collects every public-facing document for all five, split into two registers per product: a plain-language Stories and User Guide for the people who run it, and a Technical Manual and Specification for the people who build on or audit it. Read the part you need. Skip the rest.

# Part 1: Doctor, the Watchdog

## Doctor: Stories & User Guide

*The watchdog that keeps your memory stack alive, explained for the people who run it.*

### Foreword

Your coding agent's memory runs on daemons on your own machine. When one of them dies quietly at 2am, you pay for it the next morning: a session that forgot everything, and twenty minutes re-explaining a codebase your agent knew yesterday. Doctor exists so that never happens. It watches the stack, heals what breaks, stays quiet when things are fine, and speaks up plainly when it needs you. This guide is written for the person who installs it and lives with it, not the person who builds it.

### Doctor Overview

What Doctor is, what it does for you, and how to get it running, written for people who use The Apiary rather than people who build it.

#### What Doctor is

Doctor is the watchdog for The Apiary stack. Your coding agents' memory runs on local daemons (honeycomb, hive, nectar), and a daemon that quietly dies at 2am costs you the next morning: sessions with the memory of a goldfish and twenty minutes re-explaining a codebase your agent knew yesterday. Doctor exists so that never happens. It was built by Mario Aldayuz to fix exactly that failure, after watching it happen to real installs with nobody the wiser.

It is deliberately tiny and deliberately boring: zero dependencies, Node built-ins only, built to be harder to kill than anything it watches. Your operating system supervises Doctor (launchd on macOS, systemd on Linux, a Scheduled Task on Windows), so it survives crashes and reboots on its own. Doctor, in turn, supervises everything else.

Doctor is production ready and tested in live scenarios. Everything below is shipped: multi-daemon registry supervision, the repair ladder with backoff, OS service registration on all three platforms, the blessed-update gate with rollback, the loopback status page and its JSON feed, the per-service telemetry ingestion loop, and the single live health stream the Hive portal renders.

#### What it does for you

**Watches.** Every 30 seconds it probes each daemon's health endpoint. It does not just learn that something is wrong; it learns what kind of wrong: down, wedged, or degraded in a specific subsystem.

**Heals.** When a daemon is sick, Doctor climbs a repair ladder the way a careful operator would: restart it, and if three restarts in a row fail, reinstall it; remove a conflicting package if one is detected; back off exponentially between attempts; stop the instant health returns. A daemon you kill on purpose is typically back inside one probe interval, without you touching anything.

**Stays quiet when things are fine.** A healthy probe is a debug log line. Doctor does not nag, notify, or update anything on the happy path.

**Speaks up when it cannot fix something.** If the ladder runs out, Doctor writes a structured "needs attention" report: what it diagnosed, every step it tried, what happened, and what it recommends you do. That report lands on your local status page first, on your machine.

**Keeps the stack current, safely.** Doctor auto-updates the memory daemon only behind a "blessed release" gate: a version has to be explicitly approved for rollout, the update is verified healthy afterward, and a failed verify rolls back to the version that worked. A bad release cannot spread itself. Doctor never auto-updates its own package; `doctor self-update` is the only way that happens.

**Never touches your credentials.** If Doctor suspects a credential problem, it tells you and stops. There is no code in it that can read or delete your credentials file. Full stop.

#### Install

The Apiary installer sets Doctor up automatically, including the OS service registration:

```bash
# macOS / Linux
curl -fsSL https://get.theapiary.sh | sh
```

```powershell
# Windows (PowerShell)
irm https://get.theapiary.sh/install.ps1 | iex
```

Standalone install or update:

```bash
npm install -g @legioncodeinc/doctor
doctor install-service
```

That second command registers Doctor with your OS so it restarts on crash and starts on boot. `doctor uninstall-service` removes it cleanly.

#### The status page

Open `http://127.0.0.1:3852` in a browser. It is served by Doctor itself, on your machine only (loopback; nothing is exposed to the network), so it works even when everything else is down, which is precisely when you need it. You get every daemon's health at a glance, the latest escalation if there is one, and copy-pasteable commands to fix what is fixable. The same data is machine-readable at `/status.json` if you want to script against it. The richer dashboard lives in the Hive portal at `http://127.0.0.1:3853`, rendered live from the telemetry feed Doctor maintains.

#### The CLI in thirty seconds

```bash
doctor status      # health, versions, last heal, one screen
doctor diagnose    # what is wrong and what Doctor would do; takes no action
doctor heal        # run the repair ladder once (risky steps ask first)
doctor logs        # what happened, episode by episode
doctor update      # update the memory daemon via the blessed gate (--check to preview)
```

Run `doctor` bare for the full menu.

#### Try to break it

Do not take the pitch on faith:

```bash
pkill -f honeycomb   # kill the memory daemon on purpose
# wait ~30 seconds
doctor status        # back to ok, with a fresh "last heal"
```

The failure happened, the fix happened, and you were never on the hook for either.

#### Quick answers

**Does it need admin rights?** No. Doctor registers per-user by default on all three platforms: a LaunchAgent on macOS, a `systemctl --user` unit on Linux, a per-user Scheduled Task on Windows. No sudo, no UAC prompt.

**What if Doctor itself crashes?** Your OS restarts it. That is the entire point of the design: Doctor is supervised by launchd, systemd, or Task Scheduler, not by anything in the stack it watches.

**Will it update things behind my back?** Only the memory daemon, only behind the blessed gate, and only if you have not opted out (`doctor run --no-auto-update`, the `HONEYCOMB_NO_AUTO_UPDATE=1` env var, or a pinned version all disable it). Doctor never updates its own package automatically, ever.

**Can it break my install worse than it found it?** The risky repairs are gated. Reinstalls are serialized behind a lock, verified afterward, and rolled back on a failed verify. The one genuinely destructive action (removing a conflicting package) writes an audit record first and never touches your data directories.

**How do I turn it off?** `doctor uninstall-service` removes the OS registration cleanly. The stack keeps running; you are just back to being your own on-call.

#### Privacy

When Doctor genuinely cannot heal an install, it can phone home a scrubbed diagnosis (step outcomes and version numbers, never credentials, tokens, file contents, or your code) so problems get fixed before you file a ticket

## Doctor: Technical Manual & Specification

*Architecture, supervision model, health classification, and trust boundaries for the Apiary watchdog.*

### Foreword

Doctor is deliberately small and deliberately boring: zero dependencies, Node built-ins only, harder to kill than anything it watches. This manual is the engineering account of how that holds together. It covers the design principles, the supervision and remediation ladder, how health is probed and classified, the registry and state model, and where the trust boundaries are drawn. If you are extending Doctor or auditing it, start here.

### Doctor: Overview & Quickstart

#### What makes Doctor different

Most watchdogs are either a cron job with delusions or a monitoring platform that needs its own monitoring. Doctor picked a harder lane:

- **Zero runtime dependencies.** Node built-ins only. There is no supply chain to compromise and no dependency that can take the watchdog down with it.
- **OS-supervised, not self-supervised.** launchd / systemd / Windows Scheduled Task restart it on crash and start it on boot. It never depends on the daemons it watches to stay alive, and they never depend on it.
- **An escalating repair ladder, not a blind restart loop.** It climbs restart, reinstall, remove-conflict, escalate, with exponential backoff between rungs, and stops the instant health returns.
- **Silent when healthy.** A green probe is a debug line. An unhealable install is a high-signal escalation. Nothing in between wastes your attention.
- **Never touches your credentials.** If it suspects a credential fault, it escalates instead of touching them. Full stop.

#### Features

- ** Watches and heals.** Probes each daemon's `/health` on a fixed interval, reads per-subsystem detail, and repairs what it can without waking you up.
- ** Repair ladder with backoff.** Restart, then reinstall, then remove a conflicting `@deeplake/hivemind` global (the package only, never your `~/.deeplake/` data), then escalate. Exponential backoff between rungs; stops the moment health returns.
- ** Multi-daemon registry.** Supervises the whole fleet from a static registry at `~/.honeycomb/doctor.daemons.json`: honeycomb, hive, and nectar. A daemon that is down is still supervised, because "should exist" survives independently of "is running."
- ** Status endpoint on `:3852`.** A loopback status page plus machine-readable `/status.json`, so you can see the whole fleet's health in one place.
- ** Blessed-release auto-update with rollback.** Keeps daemons current behind a blessed-version gate: verify health after the update, roll back on failure.
- ** Opt-out scrubbed telemetry.** When it genuinely cannot heal, it phones home a scrubbed diagnosis so problems get fixed proactively. Never credentials, tokens, or your code. Opt out with `DO_NOT_TRACK=1`, `HONEYCOMB_TELEMETRY=0`, or the dashboard.

#### Install (one command)

You almost never install Doctor by hand. The Apiary stack installer sets it up and registers its OS service automatically (opt out with `--no-doctor`):

```bash
# macOS / Linux
curl -fsSL https://get.theapiary.sh | sh
```

```powershell
# Windows (PowerShell)
irm https://get.theapiary.sh/install.ps1 | iex
```

To install or update it on its own:

```bash
npm install -g @legioncodeinc/doctor
doctor install-service   # register the OS service (restart-on-crash, start-on-boot)
```

Prefer to build from source?

```bash
git clone https://github.com/legioncodeinc/doctor.git
cd doctor
npm install            # dev deps only; the shipped package has zero runtime deps
npm run typecheck
npm run test
npm run build          # tsc + esbuild -> the single-file bin at bundle/cli.js
```

`npm run ci` runs the typecheck + test gate. `npm run pack:check` verifies the publish payload before a cut.

#### Using the dashboard

The dashboard is **Hive portal at `http://127.0.0.1:3853`**: fleet health lives there, rendered from the data Doctor feeds it. Behind it, Doctor serves its own raw status surface on loopback at **`http://127.0.0.1:3852`**, the authoritative source of truth: every registered daemon's state (`ok`, `degraded`, `unreachable`, or `unknown`), what Doctor last did about it, and whether anything needs your attention. The same data is machine-readable at **`/status.json`**. When something is unhealable, the "needs attention" report surfaces here first, on your machine, before anything leaves it.

#### Using the CLI

Run `doctor` with no arguments for the banner and menu. The full surface:

| Command | What it does |
|---|---|
| `doctor status` | daemon health, service state, versions, last heal, opt-out flags |
| `doctor diagnose` | classify health and print the recommended fix, taking **no** action |
| `doctor heal` | run the remediation ladder once (gated steps confirm first) |
| `doctor restart` | restart the primary daemon (rung 1) |
| `doctor reinstall` | reinstall the primary daemon (rung 2) |
| `doctor uninstall-hivemind` | remove a conflicting `@deeplake/hivemind` global (rung 3, confirms) |
| `doctor update [--check]` | update the primary daemon via the blessed gate |
| `doctor self-update` | update Doctor's own package (the **only** thing that does) |
| `doctor install-service` / `uninstall-service` | register or remove the OS service |
| `doctor logs` | tail incident logs for all daemons, or one via `--daemon ` |

Doctor never updates itself in the background. `self-update` is the single, explicit way to bump it, and there is deliberately no `clear-credentials` command: credential purges are only ever recommended via escalation, never automated.

#### Kill it. Watch it come back.

Do not take our word for it. Shoot the daemon and watch:

```bash
# Kill the honeycomb daemon on purpose…
pkill -f honeycomb

# …give the doctor one probe interval, then check
doctor status
# honeycomb    ok    healed 12s ago (rung 1: restart)
```

That is the whole pitch: the failure happened, the fix happened, and you were never on the hook for either.

#### How it works

The OS supervises the doctor; the doctor supervises everything else. Health flows in through probes, repairs flow out through the ladder, and nothing shares a failure domain with what it watches.

```mermaid
flowchart TD
    os["OS supervisor<br/>launchd / systemd / Scheduled Task"] -->|"restart on crash · start on boot"| doc["doctor<br/>status page :3852"]
    doc -->|"health probes"| hc["honeycomb :3850"]
    doc -->|"health probes"| th["hive :3853"]
    doc -->|"health probes"| hn["nectar :3854"]
    doc --> ladder{"unhealthy?"}
    ladder -->|"rung 1"| r1["restart"]
    r1 -->|"still failing"| r2["reinstall"]
    r2 -->|"conflict detected"| r3["remove conflicting Hivemind"]
    r3 -->|"ladder exhausted"| r4["escalate + report home"]
```

Per-daemon supervision knobs (probe interval, startup grace, restart give-up threshold, cooldown) live in the registry, and every probe URL is pinned to loopback as defense in depth. Repairs back off exponentially and stop the instant health returns.

#### Why this matters

A daemon you cannot see is a daemon you cannot trust. Your agents' memory is infrastructure now, and the difference between a demo and infrastructure is not the happy path. It is what happens when it breaks at 2am with nobody watching.

Trust is not a feeling here, it is a mechanism. You trust the stack because something dumber, smaller, and tougher than the stack is standing watch over it, because that something is restarted by your operating system rather than by hope, and because when it fails to heal a machine it says so loudly instead of quietly rotting. Doctor is built to be boring in exactly the way load-bearing things should be boring.

And when it truly cannot fix something, it does not shrug. It writes a structured report, surfaces it on the local status page, and (unless you opt out) sends the scrubbed diagnosis to the maintainers, so the fix ships before the support thread starts.

#### Other interfaces

- **Status page.** `http://127.0.0.1:3852` on loopback, human-readable fleet health at a glance.
- **`GET /status.json`.** The same fleet model as JSON, for scripts and anything else that wants machine-readable truth.
- **SSE telemetry feed.** Doctor is the single source of truth for fleet health and telemetry: it polls each service's local SQLite telemetry (read-only, via Node's built-in `node:sqlite`) plus `/health`, merges the results, and streams one Server-Sent-Events feed to [hive](https://theapiary.sh) portal, which renders the live health rail and readiness screens.

No MCP server, no SDK, no inbound ports beyond the loopback status page. That is by design: the watchdog's attack surface stays as small as its dependency tree.

 Status & Roadmap

Doctor is **production ready (v0.2.x)** and versions independently of the rest of the stack. Its full PRD program has shipped and been tested in live scenarios: multi-daemon registry supervision, the repair ladder with exponential backoff, OS service registration on macOS, Linux, and Windows, the blessed-update gate with verify-and-rollback, the `:3852` status page plus machine-readable `/status.json`, and scrubbed escalation telemetry. The richer telemetry pipeline is shipped too: per-service SQLite ingestion with the poll-and-merge loop, and the single SSE feed the Hive portal renders as its live health rail. Vote on what comes next at **[ideas.theapiary.sh](https://ideas.theapiary.sh)**.

#### Development

Self-contained: its own `tsconfig.json` and `vitest.config.ts`, independent of the repo-root gates.

```bash
npm install          # dev deps only
npm run typecheck    # tsc --noEmit
npm run test         # vitest run
npm run ci           # typecheck + test, the gate every change must pass
npm run build        # tsc + esbuild -> the single-file bin at bundle/cli.js
npm run pack:check   # verify the publish payload
```

The build inlines the package version at bundle time: esbuild reads `package.json` and defines `__DOCTOR_VERSION__`, so the shipped binary always reports exactly what was cut. One manifest is the single source of truth; there is no cross-manifest sync to run.

#### Credits

- **[Activeloop](https://activeloop.ai/)** brings **[Deeplake](https://deeplake.ai/)** (the versioned, multi-modal database for AI with native vector + columnar indexing and hybrid search) and **[Hivemind](https://github.com/activeloopai/hivemind)**, the open-source agent-memory project Honeycomb is built upon.
- **[Legion Code Inc](https://github.com/legioncodeinc)** brings the **multi-tier memory system** (Tier 1 / 2 / 3 keys, summaries, raw), **code base atlas memory architecture**, **auto healing service**, **session priming**, **automatic skill development & propagation**, the **pollinating loop**, the **knowledge graph**, **cross device cross repository cross team skill sharing**, and the daemon architecture that turns Deeplake into a shared brain your coding agents read and write on every turn.

#### License

Doctor is licensed under the **GNU Affero General Public License v3.0 or later** (AGPL-3.0-or-later).

Use it commercially or privately, free of charge. In return: keep the copyright and license notices intact, and if you modify it, your changes ship under the same AGPL license with source available. The "Affero" part is the point: run a modified version as a network service and you owe its source to the users who interact with it. No locking a fork behind a SaaS wall.

© 2026 Legion Code Inc.

  Built by Legion Code Inc · Powered by <a href="https://deep

### System Overview: Why Doctor Exists

Read this first if you are new to the doctor repo: it explains why the watchdog exists, the four principles every module obeys, the fleet it supervises, and where the code came from.

#### The problem: who restarts the restarter

The Apiary's memory daemon dies at 2am and nothing notices. The user finds out the next morning, one session in, when their agent has forgotten a codebase it knew yesterday. Honeycomb already had internal supervision (its embed-supervisor restarts the embeddings child), but nothing supervised honeycomb itself, and nothing supervised the supervisor either. Every self-monitoring scheme eventually hits the same wall: the monitor shares a failure domain with the thing it monitors.

Doctor is the answer to that wall, and it is deliberate about where it draws the line. Doctor supervises the workload fleet. The operating system supervises doctor. launchd, systemd, or a Windows Scheduled Task restarts doctor on crash and starts it on boot, so doctor never depends on anything it watches to stay alive, and nothing it watches depends on doctor to run. Doctor is Mario Aldayuz's answer to that specific design problem in The Apiary: the stack needed one process dumber, smaller, and tougher than everything else, standing outside every failure domain it observes.

#### The four design principles

Every module in `src/` cites these by number in its header comments. They are not aspirations; they are enforced shapes.

**1. Incapable of crashing.** The runtime is Node built-ins only, zero npm dependencies (`package.json` declares none; `esbuild.config.mjs` externalizes only `node:*`). There is no zod, no HTTP client, no CLI framework. Every external action sits behind an injected seam that resolves a value instead of throwing. Failures are values: a failed probe is a classification, a failed write is a logged loss, a thrown rung is a failed `RungResult`. `installCrashNet` in `src/supervisor.ts` adds the last-resort `uncaughtException` and `unhandledRejection` net on top. Losing an incident line is strictly better than crashing the watchdog that is trying to heal the box.

**2. OS-supervised, never self-supervised.** `src/service/` registers doctor with the platform's native service manager (`com.legioncode.doctor`), user scope by default, with restart-on-crash and start-on-boot encoded in the unit templates. Doctor does not have a "restart myself" code path; it does not need one.

**3. Targeted repair, not a blind restart loop.** The health probe classifies into four kinds (`ok`, `degraded` with per-subsystem reasons, `unreachable-refused`, `unreachable-timeout`), and the remediation ladder climbs restart, reinstall, remove-conflicting-package, escalate, with geometric backoff between attempts and a hard stop the moment health returns. A green probe is a debug log line. An unhealable install is a high-signal escalation. Nothing in between wastes attention.

**4. Never touch credentials, and be honest about telemetry.** There is no code path anywhere in doctor that reads, writes, or deletes `~/.deeplake/credentials.json`. A suspected credential fault escalates with `recommendedAction: "clear-credentials"` and a `wouldHaveTaken` note describing the action doctor deliberately did not take. All outbound telemetry flows through one chokepoint (`src/telemetry/emit.ts`) with allow-list scrubbing and layered opt-out gates (`DO_NOT_TRACK=1`, `HONEYCOMB_TELEMETRY=0`).

#### Fleet topology

Doctor reads a static registry at `~/.honeycomb/doctor.daemons.json` and spawns one independent supervisor per entry. The known workload daemons are honeycomb (`:3850`), hive (`:3853`), and nectar (`:3854`). The embeddings child (`:3851`) is honeycomb's own supervised process; doctor observes it indirectly through honeycomb's `/health` reasons and heals it by healing honeycomb. Doctor serves its own loopback status page on `:3852`, which also carries the single SSE telemetry stream hive renders.

```mermaid
flowchart TD
    osSupervisor["OS supervisor: launchd / systemd / Scheduled Task"] -->|"restart on crash, start on boot"| doctorProc["doctor (status page + SSE on :3852)"]
    doctorProc -->|"probe /health + supervise"| honeycombDaemon["honeycomb :3850"]
    doctorProc -->|"probe /health + supervise"| hiveDaemon["hive :3853"]
    doctorProc -->|"probe /health + supervise"| nectarDaemon["nectar :3854"]
    honeycombDaemon -->|"embed-supervisor (honeycomb's own)"| embeddingsChild["embeddings :3851"]
    doctorProc -.->|"heals indirectly via honeycomb /health reasons"| embeddingsChild
    doctorProc -->|"one fleet-telemetry SSE stream"| hiveDaemon
```

A daemon that is down is still supervised: the static "should exist" entry survives independently of "is running", which is the whole point of the two-layer registration model in ADR-0002. When the registry file is absent, doctor falls back to supervising the honeycomb primary at built-in defaults. When the file is present but malformed, doctor does not crash-loop; it falls back to the honeycomb primary, logs `registry.malformed_fallback`, and records a needs-attention banner so an operator fixes the file instead of running silently degraded (`resolveDaemons` in `src/compose/index.ts`).

#### What runs inside the process

`createDoctor()` in `src/compose/index.ts` is the composition root. One process arms:

- one supervisor watch loop per registered daemon (probe, classify, heal via the ladder, persist per-daemon state shards),
- the telemetry poll-and-merge loop (about once per second, read-only SQLite plus `/health`, per ADR-0001),
- the single SSE producer mounted at `GET /events` on the status page,
- the 30-minute jittered auto-update poll loop for the primary daemon, behind the blessed-version gate,
- the hourly install-health telemetry heartbeat,
- the loopback status page on `:3852`.

Everything is armed fail-soft: `start()` never throws, a bind conflict on `:3852` is swallowed and logged, and `stop()` disarms every loop idempotently.

#### The zero-dependency commitment

The commitment is structural, not stylistic. A watchdog with a supply chain can be taken down by its supply chain, and a dependency that crashes takes the can't-crash process with it. So:

- HTTP probing is `node:http` (`src/health-probe.ts`), not fetch wrappers or clients.
- SQLite reads are `node:sqlite`'s `DatabaseSync` (`src/telemetry/sqlite-reader.ts`), the same built-in honeycomb already relies on, opened read-only.
- Validation is hand-rolled defensive coercion in `src/config.ts`, `src/registry.ts`, and `src/state.ts`. A malformed env var or registry field falls back to its default; it never throws.
- The CLI is a hand-rolled dispatcher over a single-sourced command table (`src/cli/command-table.ts`).
- Shell-outs go through `execFile` with argv arrays, never a shell (`src/rungs/command-runner.ts`).

The published package's `dependencies` field does not exist. `devDependencies` (TypeScript, esbuild, vitest) never ship.

#### Module map

Where each responsibility lives, so you land in the right file first:

| Area | Files |
|---|---|
| Config resolution and defaults | `src/config.ts` |
| Daemon registry parse + containment | `src/registry.ts`, `src/safe-path.ts` |
| Health probe + classification | `src/health-probe.ts` |
| Watch loop + crash net | `src/supervisor.ts` |
| Repair ladder + rung 1 | `src/remediation.ts` |
| Rungs 2/3 + escalation + command runner | `src/rungs/` |
| Backoff machine | `src/backoff.ts` |
| Durable state + incidents | `src/state.ts`, `src/incidents.ts` |
| Escalation stores and hosted sink | `src/escalation/` |
| Telemetry ingestion (poll loop, SSE) | `src/ingestion/`, `src/telemetry/schema.ts`, `src/telemetry/sqlite-reader.ts` |
| Outbound telemetry chokepoint | `src/telemetry/emit.ts`, `src/telemetry/otlp-serializer.ts` |
| Status page | `src/status-page/server.ts` |
| Auto-update engine + blessed channel | `src/update/` |
| OS service registration | `src/service/` |
| CLI | `src/cli/` |
| Production assembly | `src/compose/index.ts` |

#### Provenance

Doctor was designed and built by Mario Aldayuz. It started life as an embedded `doctor/` folder inside the honeycomb repository, specced by honeycomb's PRD-064 program ("Doctor: Self-Healing Watchdog Daemon", still tracked in honeycomb's `library/requirements/in-work/prd-064-doctor-self-healing-watchdog/` with follow-ups PRD-065 go-live and PRD-067 boot-grace in honeycomb's backlog). It was extracted into this standalone repository as its own npm package, `@legioncodeinc/doctor`, versioned independently of the honeycomb package (PRD-063 OD-6). In July 2026, fleet-wide naming decision #32 (2026-07-02, recorded in nectar's `library/requirements/PRD-DECISIONS-AND-DEFAULTS.md`) renamed the product from hivedoctor to doctor: the OS service label is `com.legioncode.doctor`, the systemd unit is `doctor.service`, and the Windows task is `doctor`. Every install best-effort deregisters the legacy `com.legioncode.hivedoctor`, `hivedoctor.service`, and `HiveDoctor` units so a migrated box never runs two watchdogs racing over one daemon (`src/service/platform.ts`, `src/service/argv.ts`).

The registry-driven multi-daemon supervision arrived via nectar's PRD-004a, and the telemetry single-source-of-truth role arrived via this repo's own ADR-0001/ADR-0002 and PRD-001/PRD-002, pinned as fleet-wide Contracts A, B, and C in the-apiary's `library/ledger/EXECUTION_LEDGER.md`.

#### Where to go next

- How the watch loop, ladder, and backoff actually behave: supervision-and-remediation.md, then the deep dives on health probe classification, backoff and restart policy, and the remediation rungs
- How the whole process is assembled from one function: composition-root.md
- The engineering patterns that make can't-crash possible: ../standards/zero-dependency-engineering.md
- How telemetry flows from services through doctor to hive: telemetry-single-source-of-truth.md, then the ingestion pipeline, the SSE producer, and outbound telemetry and privacy
- The give-up surface and the auto-update engine: escalation and needs-attention and the auto-update engine
- Every on-disk file doctor reads or writes, with full schemas: ../data/registry-and-state.md
- Operating it day to day: ../operations/status-page-and-cli.md and ../operations/os-service-registration.md
- How it builds, ships, and updates: ../infrastructure/build-and-release.md
- What it trusts and what it refuses to: ../security/trust-boundaries.md

### Supervision And Remediation

For engineers working on the watch loop, health classification, the repair ladder, backoff, or incident records: this is how doctor decides a daemon is sick and what it does about it. The whole path is shipped and exercised in live scenarios; kill a daemon and it is typically back inside one probe interval.

#### One supervisor per daemon

`createDoctor()` builds one fully independent supervisor per registry entry (`buildDaemon` in `src/compose/index.ts`). Each daemon gets its own probe bound to its `healthUrl`, its own restart rung reading its own `pidPath` with an entry-local cooldown clock, its own backoff machine, its own ladder with its own `restartGiveUpThreshold`, and its own state and incident shards (`state-.json`, `incidents-.ndjson`). Nothing about nectar's crash loop can contaminate honeycomb's remediation state.

The loop cadence and windows come from the registry entry, defaulting to the values in `src/config.ts` `DEFAULTS`: probe every 30s (`probeIntervalMs: 30_000`), 2s per-probe timeout (`probeTimeoutMs: 2_000`), 60s startup grace (`startupGraceMs: 60_000`), give up on restarts after 3 consecutive failures (`restartGiveUpThreshold: 3`), 5s post-restart cooldown (`restartCooldownMs: 5_000`), backoff floor 1s and ceiling 30s (`backoffFloorMs` / `backoffCeilingMs`).

#### The tick

`Supervisor.tick()` in `src/supervisor.ts` is the whole algorithm: probe, classify, and either rest or heal. The clock and every I/O action are injected, so tests step the loop deterministically with fake timers.

```mermaid
stateDiagram-v2
    [*] --> probing
    probing --> healthy: "kind = ok"
    probing --> booting: "unhealthy + grace window active"
    probing --> unhealthy: "unhealthy + grace expired"
    healthy --> probing: "sleep probeIntervalMs (debug log only)"
    booting --> probing: "log tick.booting, take no action"
    unhealthy --> rungOne: "failures < restartGiveUpThreshold"
    unhealthy --> rungTwo: "failures >= threshold (advance)"
    rungOne --> probing: "kicked / skipped, incident step recorded"
    rungTwo --> escalate: "rung 2 genuinely failed"
    rungTwo --> probing: "rung 2 succeeded or skipped"
    escalate --> probing: "EscalationRecord handed to hook"
```

On a healthy tick the loop logs `tick.healthy` at debug and, only if there is something to reset (a non-zero failure count, a non-zero backoff rung, or a previous non-ok health), writes state back with `consecutiveRestartFailures: 0`, `backoffRung: 0`, `currentRung: 1`, and a fresh `lastHealAt`. Reset-on-healthy is what makes the ladder stop the instant health returns.

On an unhealthy tick past the grace window, the loop opens an incident episode, asks the ladder to decide a rung, runs it, records the step, persists state, and writes the episode. The whole tick sits inside try/catch: a thrown heal path logs `tick.heal_threw`, routes to the error-telemetry seam, and the loop survives to the next tick.

#### The four health kinds

`probeHealth` in `src/health-probe.ts` issues one bounded `GET` over `node:http` and never throws. It resolves exactly one of four classifications:

```typescript
export type HealthClassification =
	| { readonly kind: "ok" }
	| { readonly kind: "degraded"; readonly reasons: ProbeHealthReasons }
	| { readonly kind: "unreachable-refused"; readonly detail: string }
	| { readonly kind: "unreachable-timeout" };
```

- `ok`: HTTP 200 with a JSON body whose top-level `status` is `"ok"`.
- `degraded`: the daemon answered but not cleanly (non-200, or 200 with a non-ok status). Carries the per-subsystem `reasons` (`storage`, `embeddings`, `schema`) parsed defensively from the body; a non-JSON body still classifies degraded, just without detail.
- `unreachable-refused`: the connection was refused, reset, or failed DNS. The daemon is down. Restart it.
- `unreachable-timeout`: the socket accepted but never answered within `probeTimeoutMs`. The daemon is wedged, which is a different disease than dead (the memory_jobs-backlog failure mode PRD-064a exists to fix).

The refused-versus-timeout distinction is load-bearing: it flows into the incident trigger (`unreachable` vs `timeout` via `triggerForClassification` in `src/incidents.ts`) and into what an operator reads on the status page. The response body is buffered to a hard cap (256 chunks) so a misbehaving endpoint streaming megabytes cannot exhaust memory.

#### Startup grace

A daemon that was just started deserves time to boot before the watchdog judges it. Each supervisor arms a grace window of `startupGraceMs` (default 60s) at construction, at `start()`, and again whenever rung 1 kicks a restart. During the window an unhealthy probe logs `tick.booting` with the remaining ms and takes no action. The auto-update engine also re-arms the primary supervisor's grace after a successful post-update restart (PRD-067), so a fresh binary is never punished for a slow boot.

#### The repair ladder

`createRemediationLadder` in `src/remediation.ts` holds the rung registry and the pure `decide()` function: fewer than `restartGiveUpThreshold` consecutive failed restarts means rung 1; at or past the threshold it advances to rung 2. The composition root registers rungs 1, 2, and 3 for every daemon's ladder (`rungs: [entryRestartRung, reinstallRung, uninstallRung]` in `src/compose/index.ts`). Escalation is the terminal hand-off, not a numbered rung.

**Rung 1: restart (`src/remediation.ts` `createRestartRung`).** Two guards run before anything happens. Guard one: if doctor restarted this daemon within `restartCooldownMs` (default 5s), skip with `detail: "cooldown"`, so doctor never fights the daemon's own restart helper. Guard two: if the PID/lock file names a process and `/health` answers, skip with `detail: "lock-held-and-healthy"`, because starting a second daemon would just hit the single-instance lock and exit. Otherwise run the injected `RestartFn` and start the cooldown. A deliberate skip never counts toward the give-up threshold; a genuine failure increments `consecutiveRestartFailures` and advances backoff. The production composition injects the OS-service restart into this seam, so a killed daemon is kicked back to life through the same launchd, systemd, or Scheduled Task registration doctor installed. The default fallback (used only by a bare assembly with no restart function injected, as in tests) logs `compose.restart_no_os_service` and returns `false`, an honest failure that drives the ladder toward escalation rather than a fake success.

**Rung 2: reinstall the primary (`src/rungs/reinstall.ts`).** Fires after 3 consecutive failed restarts. It resolves the blessed version fail-soft (live channel first, static fallback, empty string tolerated), short-circuits to a skip if the installed version already matches the blessed one, acquires the shared install lock so it can never race the auto-update engine, then runs `npm install -g @legioncodeinc/honeycomb` through the execFile runner and verifies against the globally-installed package version (not `/health`, which cannot be trusted while the daemon is sick). With no blessed version known it still reinstalls but reports `unverified-no-blessed` instead of failing: a missing CDN object never blocks a repair.

**Rung 3: uninstall a conflicting Hivemind global (`src/rungs/uninstall-hivemind.ts`).** Honeycomb and `@deeplake/hivemind` cannot run side by side. Detection first (`npm ls -g @deeplake/hivemind --depth 0`); nothing detected means a safe idempotent skip. Before removal it appends a timestamped backup record to `removed-packages.ndjson` in doctor's workspace; if that record cannot be written, the destructive step is skipped rather than performed unrecorded. The one hard boundary: rung 3 removes the npm package only and has literally no code path that touches `~/.deeplake/`. In the automated loop `decide()` only ever selects rungs 1 and 2; rung 3 runs when targeted directly (the `doctor uninstall-hivemind` CLI verb, or `heal` when the decision routes there).

**Escalation (terminal, `src/rungs/escalation.ts`).** When an advanced rung genuinely fails (not a skip, not a success), the supervisor builds an `EscalationRecord`: a plain-language diagnosis, the ordered steps attempted with outcomes, a `recommendedAction`, and, for deferred actions, a `wouldHaveTaken` note. The record goes to the injected escalation hook crash-safely; a throwing sink becomes a failed step, never a process death. For the honeycomb primary the hook writes `needs-attention.json` (the dashboard read seam) and emits to the hosted PostHog sink; for every other daemon the escalation lives in its own incident shard plus the hosted sink, deliberately not the shared file, so nectar's give-up can never overwrite honeycomb's banner. `clear-credentials` is only ever a recommendation; there is no purge code anywhere.

#### Backoff

`createBackoff` in `src/backoff.ts` is a pure state machine: delay is `floorMs * 2^rung`, clamped to `ceilingMs` before jitter, then multiplied by a symmetric jitter factor in `[0.8, 1.2]` (jitter 0.2 by default) so a fleet that flapped together does not stampede the daemon in lockstep. Defaults: floor 1s, ceiling 30s. The backoff rung (geometric step count) is distinct from the remediation rung (which repair runs) and is persisted to the state shard, so a reboot does not reset a crash loop's memory. A confirmed healthy tick resets it to zero.

#### Incident episodes

Every unhealthy tick past grace produces one `Incident` line in the daemon's incident shard (`src/incidents.ts`): a UUID id, `openedAt`/`closedAt`, the trigger (`unreachable` | `timeout` | `degraded` | `unknown`), the health kind and degraded reasons at trigger time, the ordered steps with outcomes (`succeeded` | `failed` | `skipped`), and `resolved`. The file is append-only NDJSON, capped at 5 MiB with a single-generation rotation to `.ndjson.1`. A failed append is swallowed and logged: the healing matters more than the record of it.

#### A worked incident

Kill honeycomb (`pkill -f honeycomb`) and watch one episode end to end:

1. Next tick (within 30s): the probe's socket is refused. Classification `unreachable-refused`, grace long expired, log `tick.unhealthy`.
2. The loop opens an incident with trigger `unreachable` and asks the ladder: 0 consecutive failures, so rung 1.
3. Rung 1 guards pass (no recent restart, no live lock), the restart fn kicks the OS service, `markRestarted` starts the 5s cooldown, the grace window re-arms for 60s, and the step `{ rung: 1, action: "restart-daemon", outcome: "succeeded" }` is recorded. State persists `lastRestartAt`; the episode is written.
4. Next tick: the daemon is still booting, probe says refused, but grace is active, so the loop logs `tick.booting` and does nothing. No incident, no double restart.
5. Two ticks later: `/health` answers `{ status: "ok" }`. The loop resets failures and backoff to zero, stamps `lastHealAt`, and goes quiet. `doctor status` now shows the heal; the status page shows `ok`.

Had the restart failed three ticks running, `decide()` would have advanced to rung 2, the reinstall would have run under the install lock, and a genuine rung 2 failure would have produced an escalation record on the status page, in `needs-attention.json`, and (unless opted out) at the hosted sink.

#### Invariants for contributors

Touching this path means preserving these, and the test suite asserts most of them:

- A rung MUST resolve a `RungResult`, never throw; the ladder wraps it anyway, but a throw is a bug.
- A deliberate skip never counts toward the give-up threshold. Only a genuine failed restart increments `consecutiveRestartFailures`.
- Health is confirmed on the NEXT probe, never assumed from a kicked restart; failure counters reset only on a confirmed `ok`.
- Every timer and clock is injected. New time-dependent behavior takes a `clock`/`now` seam or it will be untestable and flaky.
- The error-telemetry seam (`onError`) is fire-and-forget and fail-soft; it must ne

### Health Probe Classification

For engineers working on `src/health-probe.ts` or anything that reads a probe result: this is how doctor turns one HTTP GET into exactly one of four classifications, why the four kinds exist, and how both the supervisor and the telemetry poll loop consume them.

#### Why four kinds and not a boolean

A watchdog that only knows "up" or "down" restarts everything the same way, which is the blind-restart loop doctor's third design principle exists to reject. The information that makes remediation targeted lives in the difference between the failure modes: a daemon that refused the connection is a different disease than one that accepted the socket and then went silent, and both differ from one that answered with a specific subsystem broken. `probeHealth` in `src/health-probe.ts` preserves that difference by resolving one of four mutually exclusive classifications:

```typescript
export type HealthClassification =
	| { readonly kind: "ok" }
	| { readonly kind: "degraded"; readonly reasons: ProbeHealthReasons }
	| { readonly kind: "unreachable-refused"; readonly detail: string }
	| { readonly kind: "unreachable-timeout" };
```

The type is the contract. Every downstream consumer (the supervisor's `tick`, the incident trigger mapping, the telemetry poll loop's health merge, the status page) reads `classification.kind` and nothing else has to guess.

#### The probe never throws

`probeHealth` is a total function: every input, including a hard transport failure, maps to a classification. This is what lets the watch loop always make a decision and continue. The design principle is stated in the module header itself:

> The probe NEVER throws - any error resolves to a classification, so the loop can always continue.

That totality is load-bearing for crash-safety. The supervisor still wraps the call in try/catch (`tick.probe_threw` routes to the error-telemetry seam), but that guard is defense in depth against a test seam override, not the primary defense. In production `probeHealth` cannot throw, because every path inside it either resolves a classification or is caught.

#### Node built-ins only: the transport

The probe issues one bounded `GET` over `node:http`'s `request`, not `fetch`, not an HTTP client, not a wrapper. This is design principle 1 (zero runtime dependencies) made concrete at the transport layer. `rawGet` builds the request, buffers the response, and resolves a small `RawResponse`:

```typescript
interface RawResponse {
	readonly statusCode: number;
	readonly body: string;
}
```

Two hardening details ride on `rawGet`, and both matter more than they look:

**Bounded body buffering.** The response body is accumulated chunk by chunk, but the accumulator refuses to grow past a hard cap:

```typescript
if (chunks.length < 256) chunks.push(chunk);
```

A `/health` endpoint that starts streaming megabytes (whether by bug or by malice) cannot exhaust memory in the process whose entire job is to not crash. The comment on that line reads "64 KiB is far more than /health needs", and it is: a health body is a few hundred bytes.

**A tagged timeout.** The distinction between refused and wedged (see below) depends on being able to tell a socket-level failure from a never-answered socket. `rawGet` arms `req.setTimeout` and, when it fires, destroys the request with an error carrying a stable code:

```typescript
req.setTimeout(timeoutMs, () => {
	req.destroy(Object.assign(new Error("probe_timeout"), { code: "DOCTOR_TIMEOUT" }));
});
```

The classifier keys off `code === "DOCTOR_TIMEOUT"` to route to `unreachable-timeout`, so a wedged socket is never mistaken for a refused connection.

#### The classification decision

`probeHealth` awaits `rawGet` and applies a small total mapping:

```mermaid
flowchart TD
    start["probeHealth(options)"] --> rawget["rawGet over node:http"]
    rawget -->|"resolved response"| answered{"200 AND status:ok?"}
    rawget -->|"rejected"| errclass{"code === DOCTOR_TIMEOUT?"}
    answered -->|"yes"| okKind["kind: ok"]
    answered -->|"no (non-200, or 200 non-ok)"| degradedKind["kind: degraded + parseReasons(body)"]
    errclass -->|"yes"| timeoutKind["kind: unreachable-timeout"]
    errclass -->|"no"| refusedKind["kind: unreachable-refused + detail"]
```

- **`ok`** requires both HTTP 200 and a JSON body whose top-level `status` field reads `"ok"` (`isStatusOk`). A 200 with any other status is not ok.
- **`degraded`** is the answered-but-not-clean bucket: a non-200 response, or a 200 whose `status` is not `"ok"`. It carries `reasons` parsed defensively from the body. A body that is not JSON, or is JSON without a `reasons` object, still classifies degraded, just with an empty reasons object: the daemon answered, so it is not unreachable, but it is not clean either.
- **`unreachable-timeout`** is the tagged-abort path: the socket was accepted but no response arrived within `timeoutMs`. The daemon is alive but wedged.
- **`unreachable-refused`** is every other transport failure (connection refused, reset, DNS failure). It carries a `detail` string, preferring the error's `code` when present so an operator sees `ECONNREFUSED` rather than a message.

#### Parsing subsystem reasons, defensively

When the daemon answers degraded, the body may carry per-subsystem detail mirroring the daemon's own `HealthReasons` shape:

```typescript
export interface ProbeHealthReasons {
	readonly storage?: string;
	readonly embeddings?: string;
	readonly schema?: string;
}
```

`parseReasons` extracts these three fields and nothing else. It is deliberately paranoid: a `null` parse, a non-object body, a missing `reasons` key, or a non-object `reasons` value all resolve to `{}` rather than throwing. Only string-typed subsystem values survive; anything else becomes `undefined`. The three subsystems are the daemon's `storage` (Deeplake reachability), `embeddings` (the embed seam state), and `schema` (required-table presence). These are the same three subsystems the status page and incident records surface, and they are what a `degraded` incident carries in its `healthReasons` field so an operator reading `doctor logs` sees which subsystem opened the episode.

#### How the two loops consume a classification

The classification feeds two independent consumers, and it means slightly different things to each.

**The supervisor** (`src/supervisor.ts`) maps the kind to a coarse persisted health via `coarseHealth` (`ok` stays `ok`, `degraded` stays `degraded`, both `unreachable-*` collapse to `unreachable`) and to an incident trigger via `triggerForClassification` in `src/incidents.ts`:

| Classification kind | Incident trigger | Coarse state |
|---|---|---|
| `ok` | (never opens an incident) | `ok` |
| `degraded` | `degraded` | `degraded` |
| `unreachable-refused` | `unreachable` | `unreachable` |
| `unreachable-timeout` | `timeout` | `unreachable` |

The refused-versus-timeout distinction survives all the way into the incident trigger, so `doctor logs` shows `timeout` for a wedged daemon and `unreachable` for a dead one. That trigger is the operator's hint that the box hit a backlog wedge rather than a crash. The full remediation flow that follows is in supervision-and-remediation.md.

**The telemetry poll loop** (`src/ingestion/poll-loop.ts`) calls the same probe per entry through its injected `probe` seam and collapses the classification into the fleet-visible vocabulary with `classifyProbe`: `ok` to `ok`, `degraded` to `degraded`, and both unreachable kinds to `unreachable`. That coarse health then merges with the service's own SQLite `service_status.health` and its `last_seen` staleness to produce one `FleetHealth` per service. The poll loop's own re-catch (`poll-loop.probe_threw`) is, again, defense in depth against an injected seam that throws, since the real `probeHealth` cannot. The merge rules are documented in telemetry-single-source-of-truth.md.

#### The probe is injected everywhere it is used

Nothing in doctor calls `probeHealth` on a hard-coded URL in the hot path. The composition root builds a per-entry probe bound to each daemon's `healthUrl` and `config.probeTimeoutMs`, and passes it as a seam to both the supervisor and the telemetry loop (`buildDaemon` and `telemetryProbe` in `src/compose/index.ts`). A single injected `options.probe` overrides both at once, which is how the whole assembly stays hermetic under test: no test ever opens a real socket. The `healthUrl` itself is not trusted input; it is coerced to a loopback host at registry-parse time (`coerceHealthUrl`), the SSRF gate documented in ../security/trust-boundaries.md.

#### Invariants for contributors

- `probeHealth` MUST remain total: every new failure path resolves a classification, never throws.
- The body buffer cap MUST stay bounded. A new parse path that reads the whole body without a cap reintroduces the memory-exhaustion vector.
- The timeout MUST stay tagged (`DOCTOR_TIMEOUT`) so the refused-versus-timeout distinction survives. Removing the tag collapses two failure modes into one and blinds the incident trigger.
- `parseReasons` MUST stay defensive: a hostile or malformed body degrades to an empty reasons object, never a throw.
- New consumers read `classification.kind`; they do not re-probe or re-derive health from raw HTTP.

### Backoff And Restart Policy

For engineers touching `src/backoff.ts`, the restart rung, or the give-up-and-advance logic: this is the geometric backoff machine, how startup grace interacts with it, and the exact counters that carry a crash loop's memory across doctor's own restarts.

#### Two rungs that are easy to confuse

There are two independent counters in doctor's remediation, and keeping them separate is the first thing to understand. The **remediation rung** is which repair action runs: rung 1 is restart, rung 2 is reinstall, rung 3 is uninstall-conflicting-package. The **backoff rung** is a geometric step count that governs how long doctor waits between attempts. They live in different modules (`src/remediation.ts` versus `src/backoff.ts`), advance on different events, and are persisted as different fields (`currentRung` and `consecutiveRestartFailures` versus `backoffRung` in `src/state.ts`). This doc is about the backoff rung and the restart policy that drives it; the remediation rungs are in remediation-rungs-deep-dive.md.

#### The backoff machine is pure

`createBackoff` in `src/backoff.ts` is a pure value object: no timers, no I/O, no clock. It computes the next delay and advances or resets an integer rung. The supervisor owns the actual sleeping and the persistence; the machine only does arithmetic, which is what makes it trivially testable with a seeded RNG.

```typescript
export interface Backoff {
	readonly rung: number;
	delayMs(): number;
	advance(): number;
	reset(): void;
}
```

The delay for the current rung is `floorMs * 2^rung`, clamped to `ceilingMs` before jitter, then multiplied by a symmetric jitter factor:

```typescript
const factor = rung >= 30 ? ceiling / floor : 2 ** rung;
const base = clamp(floor * factor, floor, ceiling);
const jittered = base * (1 - jitter + random() * (2 * jitter));
return Math.round(clamp(jittered, floor, ceiling));
```

Three details are deliberate:

- **The `rung >= 30` guard** prevents `2 ** rung` from overflowing into a meaningless huge number on a box that has been crash-looping for a very long time. Past rung 30 the base is simply pinned at the ceiling ratio, which is where the clamp would land it anyway.
- **The clamp happens before jitter**, so the jitter band is centered on the clamped value rather than on an unclamped exponential that would then be truncated. A rung at the ceiling still jitters symmetrically around the ceiling, not below it.
- **Jitter is symmetric and multiplicative**, a factor in `[1 - jitter, 1 + jitter]` (default jitter 0.2, so `[0.8, 1.2]`). This is the anti-stampede: a fleet of boxes that all flapped at the same moment do not retry in lockstep and hammer the daemon (or npm, at higher rungs) simultaneously.

The defaults come from `src/config.ts` `DEFAULTS`: floor 1s (`backoffFloorMs`), ceiling 30s (`backoffCeilingMs`). Config resolution normalizes an inverted pair (a ceiling below the floor clamps up to the floor) so a fat-fingered `DOCTOR_BACKOFF_CEILING_MS` can never produce a negative or inverted delay.

#### The rung survives a reboot

The backoff rung is persisted to the daemon's state shard (`backoffRung` in `state-.json`) precisely so that doctor restarting does not reset a crash loop's memory. The machine rehydrates from `initialRung` at construction. This is the difference between doctor's backoff and the daemon's own embed-supervisor, which uses a fixed in-memory `restartBackoffMs`: doctor generalizes it to a geometric schedule with a persisted rung, so a box that has failed to restart honeycomb ten times in a row does not forget that history when doctor itself is restarted by launchd.

A confirmed healthy tick resets the rung to zero. That reset is what makes the ladder and the backoff stop the instant health returns.

#### The restart give-up counter

Separate from the backoff rung is `consecutiveRestartFailures`, the counter that decides when the ladder advances off rung 1. It is not a backoff concept; it is the remediation ladder's give-up threshold. But the two advance together on a genuine failed restart, so they are worth reading side by side. From `heal` in `src/supervisor.ts`, on a restart that genuinely failed (not a skip, not a success):

```typescript
deps.backoff.advance();
return {
	...state,
	consecutiveRestartFailures: state.consecutiveRestartFailures + 1,
	backoffRung: deps.backoff.rung,
};
```

Both increment on the same event. `consecutiveRestartFailures` drives the ladder's `decide()`: at or past `restartGiveUpThreshold` (default 3, per-daemon `restartGiveUpThreshold`), the ladder advances to rung 2. `backoffRung` drives how long the next attempt waits. A deliberate skip (cooldown, or lock-held-and-healthy) increments neither: only a genuine failed restart counts toward the give-up threshold, which is the rule that keeps doctor from advancing to a reinstall just because it correctly declined to double-restart a daemon that was already fine.

#### Startup grace: the window before judgment

A daemon that was just started deserves time to boot before the watchdog judges it dead. Each supervisor arms a grace window of `startupGraceMs` (default 60s) at three moments, tracked as an absolute deadline `graceUntilMs` in `src/supervisor.ts`:

1. at construction (`armStartupGrace()` runs once in the factory),
2. at every `start()`,
3. whenever rung 1 kicks a restart (the `heal` path calls `armStartupGrace(now)` on a successful restart).

During the window an unhealthy probe logs `tick.booting` with the remaining ms and takes no action at all: no incident, no restart, no backoff advance.

```mermaid
stateDiagram-v2
    [*] --> graceArmed: "construct / start / restart"
    graceArmed --> booting: "unhealthy probe, now < graceUntilMs"
    booting --> graceArmed: "log tick.booting, no action, sleep"
    graceArmed --> judged: "grace expired (now >= graceUntilMs)"
    judged --> healing: "unhealthy: open incident + run ladder"
    judged --> healthy: "ok: reset counters + backoff"
    healthy --> graceArmed: "stays armed until re-armed"
    healing --> graceArmed: "restart re-arms grace"
```

There is a fourth arming point that lives outside the supervisor: the auto-update engine re-arms the primary supervisor's grace after a successful post-update restart (`restartDaemon` in `src/compose/index.ts` calls `primary.supervisor.armStartupGrace()`). A freshly installed binary is never punished for a slow first boot, which is the boot-grace concern honeycomb's PRD-067 exists to cover.

#### The full restart-attempt lifecycle

Putting the counters and the grace window together, one restart attempt over the ladder and backoff looks like this:

1. **Probe unhealthy, grace expired.** The loop opens an incident and asks the ladder for a rung. With `consecutiveRestartFailures` below threshold, that is rung 1 (restart).
2. **Rung 1 guards.** If doctor restarted this daemon within `restartCooldownMs` (default 5s), or if the PID lock is held and `/health` answers, rung 1 skips. A skip touches no counter and advances no backoff. Otherwise it runs the injected restart.
3. **Genuine failure.** `consecutiveRestartFailures` and `backoffRung` both increment. The persisted state carries both across doctor restarts.
4. **Next tick.** After the probe-interval sleep, the loop probes again. Health is confirmed on the next probe, never assumed from a kicked restart.
5. **Threshold reached.** Once `consecutiveRestartFailures` hits `restartGiveUpThreshold`, `decide()` advances to rung 2 (reinstall), and a genuine rung-2 failure escalates.
6. **Health returns.** A confirmed `ok` tick resets `consecutiveRestartFailures` to 0, `backoffRung` to 0, `currentRung` to 1, and stamps `lastHealAt`. Both memories are wiped together.

Note that the backoff `delayMs()` is a computed value the supervisor can consult, but the primary loop cadence between healthy ticks is the fixed `probeIntervalMs` (default 30s); the geometric delay governs the spacing of failed restart retries, and the persisted `backoffRung` is what makes that spacing survive a reboot rather than resetting to the floor.

#### Invariants for contributors

- The backoff machine stays pure. New time-dependent behavior takes a clock/RNG seam or it is untestable.
- The `rung >= 30` overflow guard stays. Removing it lets `2 ** rung` produce `Infinity` on a long crash loop.
- Clamp before jitter. Jittering an unclamped exponential and then clamping loses the symmetric band.
- A deliberate skip increments neither `consecutiveRestartFailures` nor `backoffRung`. Only a genuine failed restart does.
- Both counters reset only on a confirmed `ok` probe, never on a kicked restart.
- Startup grace is per-daemon and absolute-deadline based. New restart paths that start a daemon must re-arm the grace, or the very next tick will judge the booting daemon dead.

### The Composition Root

For engineers reading `src/compose/index.ts`: this is how `createDoctor()` assembles the whole watchdog from wave-built primitives, the fallback ladder that resolves which daemons to supervise, why every external action is an injected seam, and how `start()` and `stop()` stay fail-soft.

#### One function builds the whole process

`createDoctor()` in `src/compose/index.ts` is the composition root: the single place every collaborator is constructed and wired together, returning a `{ start, stop }` handle the OS service execs. Everything the running process does is armed here. One `createDoctor()` call builds:

- one independent supervisor watch loop per registered daemon (probe, classify, heal via the ladder, persist per-daemon state and incident shards),
- the escalation hook wired to both the local needs-attention store and the hosted PostHog sink,
- the telemetry poll-and-merge loop feeding the `/events` SSE stream,
- the auto-update poll loop, gated on the resolved opt-out precedence,
- the hourly install-health telemetry heartbeat,
- the loopback status page on `:3852`.

The reason a single composition root exists, rather than each subsystem wiring itself, is testability and fail-soft discipline: every external action lives behind an injected seam with a production default, so the smoke test drives the entire assembly hermetically (no real sockets, no real npm, no real network), and every seam that could throw is replaced by one that resolves a value.

#### Resolving which daemons to supervise

The first real decision `createDoctor()` makes is which daemons to supervise, and it is a three-step fallback ladder (`resolveDaemons`) that never crashes the boot path:

```mermaid
flowchart TD
    start["resolveDaemons(options, config, home)"] --> injected{"options.daemons provided?"}
    injected -->|"yes (tests)"| useInjected["use the injected list"]
    injected -->|"no"| readFile["readRegistryFile(~/.honeycomb/doctor.daemons.json)"]
    readFile -->|"file present + valid"| useFile["one supervisor per entry"]
    readFile -->|"file absent (null)"| primary["honeycombEntryFromConfig(config)"]
    readFile -->|"file malformed (throws)"| fallback["honeycomb primary + registryProblem set"]
    fallback --> surface["log registry.malformed_fallback + record needs-attention banner"]
```

The three postures are all deliberate:

- **File absent.** `readRegistryFile` returns `null` and the root falls back to a single honeycomb entry derived from the resolved config, which preserves any `DOCTOR_*` env overrides (`honeycombEntryFromConfig`) rather than dropping to bare defaults.
- **File present and valid.** One supervisor per entry, in registry order, with the honeycomb primary listed first.
- **File present but malformed.** `readRegistryFile` throws `RegistryError`; `resolveDaemons` catches it, falls back to the honeycomb primary, and returns a `registryProblem` string. The root surfaces that as a loud `registry.malformed_fallback` log plus a needs-attention banner recommending manual intervention.

The malformed-file case is the load-bearing one. Throwing out of `createDoctor()` would exit the process, and the OS service unit's restart policy (launchd `KeepAlive`, systemd `Restart=always`) would restart doctor straight back into the same parse failure: a crash loop. The fallback refuses to hand the OS supervisor that crash loop.

#### One supervisor per daemon, fully independent

`buildDaemon` constructs one fully independent supervisor per entry. Each daemon gets its own probe bound to its `healthUrl`, its own state and incident shards keyed by name (`state-.json`, `incidents-.ndjson`), its own restart rung reading its own `pidPath` with an entry-local `lastRestartAt` clock, its own backoff, and its own ladder with its own `restartGiveUpThreshold`. Nothing about one daemon's crash loop can contaminate another's remediation state:

```typescript
let entryLastRestartAt: number | null = null;
const entryRestartRung = createRestartRung({
	restart,
	readDaemonPid: () => readDaemonPid(entry.pidPath),
	isHealthy: entryIsHealthy,
	cooldownMs: entry.restartCooldownMs,
	clock,
	lastRestartAt: () => entryLastRestartAt,
	markRestarted: (at: number) => { entryLastRestartAt = at; },
});
```

The higher rungs (reinstall, uninstall) act on the primary honeycomb package regardless of which daemon triggered them, so they are stateless factories built once and shared across every entry's ladder. Only rung 1 is per-daemon, because only rung 1 reads a daemon-specific PID path and cooldown.

The primary (the first entry) backs the process-global surfaces: the exposed `supervisor`/`ladder`, the status page's top-level health, the install-health snapshot, and the auto-update restart re-arm. The exposed `supervisors` and `ladders` arrays let a test step each daemon's loop independently.

#### Why every external action is injectable

`CreateDoctorOptions` is a long list of optional seams, and the pattern is uniform: each has a production default, and each can be overridden. The reason is stated plainly in the module header: "all I/O behind seams so the smoke test drives the whole assembly hermetic." The seams that matter most:

| Seam | Production default | Why it is injectable |
|---|---|---|
| `probe` | `probeHealth` over `config.healthUrl` | one override governs both supervisor and telemetry health |
| `restart` | the OS-service restart wired via the service integration | a bare assembly falls back to a logged no-op returning `false` |
| `runner` | `createExecFileRunner` (execFile, no shell) | rungs 2/3 and auto-update never touch real npm in tests |
| `readDaemonPid` | reads the pid file from disk | tests assert the lock-held guard against a recorded path |
| `blessedChannel` | the real CDN fetch over global fetch | tests pass a recorder fetch so no real HTTP runs |
| `openTelemetryDb` | the real read-only `node:sqlite` reader | tests inject a fixture reader |
| `emitDeps` | the build-injected PostHog key + global fetch | tests inject a recorder so nothing is posted |
| `clock` | the real wall-clock (timers + `Date.now`) | tests step time deterministically |

The `restart` seam deserves note: in production it kicks the daemon back to life through the OS service registration doctor installed, so a killed daemon returns without an operator. When no restart function is injected (a bare assembly, as in tests), it falls back to a logged no-op that returns `false` (`compose.restart_no_os_service`), an honest failure that drives the ladder toward escalation rather than a fake success. That same `restart` seam is forwarded to the update engine's `restartDaemon`, which re-arms the primary supervisor's startup grace on a successful restart.

#### The self-update boundary is sacred here

The composition wires the auto-update engine hard-coded to the primary daemon package, `@legioncodeinc/honeycomb`. There is no code path in `createDoctor()` that installs `@legioncodeinc/doctor`; doctor updating itself is reachable only through the explicit CLI `self-update` command. This is enforced by construction, not by convention: the composition simply never constructs a self-update seam. See ../operations/auto-update-engine.md.

#### The escalation hook and per-daemon isolation

The escalation hook the ladder calls on give-up is built per entry by `buildEscalationHookFor`, and it encodes a subtle isolation rule:

```typescript
const buildEscalationHookFor = (entryName: string): EscalationHook => {
	return async (record): Promise<void> => {
		if (entryName === "honeycomb") {
			needsAttention.record(record);
		}
		await hostedEscalation(record);
	};
};
```

Only the honeycomb primary writes the shared `needs-attention.json` file (the honeycomb dashboard's read seam). Every other daemon's escalation is durably recorded in its own `incidents-.ndjson` shard, read back by `readPerDaemonEscalation` for the status page row. If every entry wrote the shared file, one daemon giving up (say nectar) would overwrite honeycomb's dashboard banner. The hosted PostHog sink fires for every entry regardless, because a give-up on any daemon is useful signal. The full escalation surface is in ../operations/escalation-and-needs-attention.md.

#### Fail-soft start and idempotent stop

`start()` arms everything and never throws. The order matters: the crash net is installed first, so anything thrown during wiring or boot is caught. Then the status page starts best-effort (a bind failure is swallowed inside `start()` already). Then each loop's `start()` is called but not awaited, because each loop's promise resolves only when stopped; the root holds the promises and lets `stop()` resolve them. Every held promise gets a `void run.catch(...)` that logs an unexpected rejection without rethrowing.

```typescript
supervisorRuns = built.map((b) => b.supervisor.start());
pollRun = pollLoop.start();
telemetryPollRun = telemetryPollLoop.start();
installHealthStopped = false;
installHealthRun = runInstallHealthLoop();
```

`stop()` is idempotent and disarms everything: every supervisor loop, the update poll loop, the telemetry poll loop (plus `telemetryPollLoop.close()` to release every open SQLite handle so a stopped watchdog never holds a service's database file open), the install-health heartbeat, and the status page. It then `Promise.allSettled`s every held run promise so the loops unwind their final iteration, and removes the crash net last. The install-health loop is the one loop the composition owns directly rather than delegating: it emits one snapshot immediately on arm, then every `installHealthIntervalMs`, each emit fail-soft so a telemetry heartbeat can never wedge the loop.

#### The shared install lock and device id

Two process-global resources are built once and shared. The install lock (`src/install-lock.ts`) serializes rung 2's reinstall against the auto-update engine so two `npm i -g` operations never interleave. The device id (`safeResolveDeviceId` wrapping `resolveDeviceId`) is the shared per-install UUID read from or minted into `~/.honeycomb/device.json`, stamped on every telemetry record and escalation so doctor and the daemon correlate to one install. Both resolve fail-soft: the lock returns `null` when held rather than throwing, and the device-id resolution has an `"unknown-device"` last-resort net for the impossible case that resolution throws.

#### Invariants for contributors

- `createDoctor()` never throws. A new subsystem that can fail on construction gets a fail-soft wrapper or an injected default.
- `resolveDaemons` never throws out of boot. A malformed registry falls back and surfaces a banner; it does not crash-loop.
- Per-daemon state stays in per-daemon shards. Only the honeycomb primary writes the shared `needs-attention.json`.
- The auto-update engine stays hard-wired to the primary package. Nothing in the composition installs `@legioncodeinc/doctor`.
- `stop()` releases

### Registry And State: Every File Doctor Reads Or Writes

The complete on-disk data reference: the daemon registry schema with every field, default, and coercion rule, doctor's own state files, the incident streams, and the full telemetry SQLite DDL.

#### The filesystem map

Everything lives under `~/.honeycomb/`:

| Path | Writer | Reader | Purpose |
|---|---|---|---|
| `~/.honeycomb/doctor.daemons.json` | installer | doctor | Static supervision registry (Contract A) |
| `~/.honeycomb/daemon.pid` | honeycomb daemon | doctor | Primary PID/lock file rung 1 respects |
| `~/.honeycomb/telemetry/.sqlite` | each service | doctor (read-only) | Runtime telemetry (Contract B) |
| `~/.honeycomb/doctor/state.json` | doctor | doctor | Legacy/process-global state (lifecycle dedupe markers) |
| `~/.honeycomb/doctor/state-.json` | doctor | doctor | Per-daemon remediation state shard |
| `~/.honeycomb/doctor/incidents.ndjson` | doctor | doctor, `doctor logs` | Process-global incident/escalation stream |
| `~/.honeycomb/doctor/incidents-.ndjson` | doctor | doctor, `doctor logs --daemon` | Per-daemon incident shard |
| `~/.honeycomb/doctor/needs-attention.json` | doctor | honeycomb dashboard, status page | Latest primary escalation (read seam) |
| `~/.honeycomb/doctor/removed-packages.ndjson` | doctor (rung 3) | humans | Backup record of removed conflicting packages |
| `~/.honeycomb/doctor/launchd.out.log`, `launchd.err.log` | launchd | humans | macOS service stdout/stderr |

The workspace dir defaults to `~/.honeycomb/doctor` and is overridable with `DOCTOR_WORKSPACE_DIR`. Every fixed filename is joined under the workspace through `resolveInBase` (`src/safe-path.ts`) so no composed path can escape it.

#### doctor.daemons.json

The root shape is a JSON object with a non-empty `daemons` array. Parsed by `readRegistryFile` in `src/registry.ts`, hand-validated with built-ins only.

```json
{
  "daemons": [
    {
      "name": "honeycomb",
      "healthUrl": "http://127.0.0.1:3850/health",
      "pidPath": "~/.honeycomb/daemon.pid",
      "probeIntervalMs": 30000,
      "startupGraceMs": 60000,
      "restartGiveUpThreshold": 3,
      "restartCooldownMs": 5000,
      "telemetryDbPath": "~/.honeycomb/telemetry/honeycomb.sqlite"
    }
  ]
}
```

##### Field-by-field rules

| Field | Type | Required | Default | Coercion rule |
|---|---|---|---|---|
| `name` | string | YES | none | Must match `/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/` (filename-safe; it keys the state and incident shards). Missing or garbage name throws `RegistryError`: fail loud, this is the one non-defaultable field. |
| `healthUrl` | string | no | `http://127.0.0.1:3850/health` | Must parse as http/https AND resolve to a loopback host (`127.0.0.1`, `localhost`, `::1`, `[::1]`). Anything else, including a perfectly valid non-loopback URL, silently falls back to the default. This is the SSRF gate. |
| `pidPath` | string | no | `~/.honeycomb/daemon.pid` | Non-empty string, leading `~` expanded to the home dir. Garbage falls back. |
| `probeIntervalMs` | integer | no | `30000` | Positive integer or the default. |
| `startupGraceMs` | integer | no | `60000` | Positive integer or the default. |
| `restartGiveUpThreshold` | integer | no | `3` | Positive integer or the default. |
| `restartCooldownMs` | integer | no | `5000` | Non-negative integer (0 is legal) or the default. |
| `telemetryDbPath` | string | optional | absent | `~` expanded, must be ABSOLUTE post-expansion (a relative path is rejected outright because it would anchor to whatever cwd the process happens to have), then resolved and asserted to live under `~/.honeycomb/telemetry/` via `assertWithinBase`. Any escape, relative path, or garbage degrades to absent, which means health-probe-only. Never a crash, never a silently honored escape. |

The known daemon names are `honeycomb`, `hive`, and `nectar` (`KNOWN_DAEMON_NAMES`), but parsing is permissive: any filename-safe token loads.

##### Failure postures, both deliberate

- **File absent:** `readRegistryFile` returns `null`; `loadRegistry`/`resolveDaemons` falls back to a single honeycomb entry. The compose-root fallback (`honeycombEntryFromConfig`) preserves env overrides from `resolveConfig`, so a missing registry does not drop your `DOCTOR_*` tuning.
- **File present but malformed** (unparseable JSON, wrong root shape, empty `daemons`, bad `name`): the parser throws `RegistryError`, and the composition root catches it (`resolveDaemons` in `src/compose/index.ts`), falls back to the honeycomb primary, logs `registry.malformed_fallback`, and records a needs-attention escalation recommending manual intervention. Throwing out of boot would hand the OS supervisor a crash loop; this path refuses to.

The `telemetryDbPath` containment is the fix from the security review of the telemetry ingestion work (commit `ad2174a`): without it, a poisoned registry could point doctor's read-only poller at any user-readable SQLite file and leak Contract-B-shaped contents over the unauthenticated loopback `/events` stream.

#### state.json and state-\.json

`src/state.ts`. One shard per supervised daemon (`state-honeycomb.json`, `state-nectar.json`, ...); the un-suffixed `state.json` remains as the process-global store used for lifecycle telemetry dedupe markers.

```typescript
export interface DoctorState {
	readonly version: 1;
	readonly lastKnownHealth: "ok" | "degraded" | "unreachable" | "unknown";
	readonly currentRung: number;                 // 1 = restart
	readonly consecutiveRestartFailures: number;  // drives the give-up-after-3 advance
	readonly backoffRung: number;                 // geometric step count, survives reboots
	readonly lastHealAt: string | null;           // ISO-8601 of last confirmed return to healthy
	readonly lastRestartAt: string | null;        // ISO-8601 of last doctor-performed restart (cooldown)
	readonly installedEventReported?: boolean;            // doctor_installed dedupe marker
	readonly updatedEventReportedVersion?: string;        // doctor_updated per-version dedupe marker
}
```

Defaults (`DEFAULT_STATE`): `lastKnownHealth: "unknown"`, `currentRung: 1`, counters 0, timestamps null. Reads are total: a missing file, unreadable dir, or garbage JSON yields `DEFAULT_STATE`, and a partially valid object is hand-merged field by field over the defaults (`mergeState`), so a corrupt file degrades to a coherent state instead of propagating junk into the loop. Writes are atomic: serialize to a random-suffixed `.tmp` in the same dir, then `renameSync` over the target; any failure is swallowed and logged as `state.write_failed`.

#### incidents.ndjson and incidents-\.ndjson

`src/incidents.ts`. Append-only NDJSON, one `Incident` per line:

```typescript
export interface Incident {
	readonly id: string;                       // UUID
	readonly openedAt: string;                 // ISO-8601
	readonly trigger: "unreachable" | "timeout" | "degraded" | "unknown";
	readonly healthKind: HealthClassification["kind"];
	readonly healthReasons?: ProbeHealthReasons;   // degraded only: storage/embeddings/schema
	readonly steps: readonly IncidentStep[];       // ordered, each { rung, action, outcome, detail?, at }
	readonly resolved: boolean;
	readonly closedAt: string;
}
```

Step outcomes are `succeeded`, `failed`, or `skipped`. The file caps at 5 MiB (`DEFAULT_MAX_BYTES`); at or past the cap it rotates once to `.1`, so a box that flaps for days never grows an unbounded log. Failed appends are swallowed and logged with the incident id. The per-daemon shards are what `doctor logs --daemon ` tails, and what the status page reads back per-daemon escalations from (`readPerDaemonEscalation` in `src/compose/index.ts`).

#### needs-attention.json

`src/escalation/needs-attention-store.ts`. The dashboard read seam: doctor writes, the honeycomb dashboard (and doctor's own status page) reads. Strictly one-directional.

```typescript
export interface NeedsAttentionFile {
	readonly version: 1;
	readonly escalation: EscalationRecord;  // diagnosis, steps, recommendedAction, wouldHaveTaken?, at
	readonly resolved: boolean;             // true once a later heal cycle restored health
	readonly recordedAt: string;
	readonly resolvedAt?: string;           // absent while unresolved
}
```

A missing file means "no escalation has occurred" and is not an error. Readers must check `version` and tolerate unknown fields. Only the honeycomb primary's escalation hook writes this shared file; every other daemon's escalations stay in their own incident shards so one daemon's give-up can never overwrite another's banner.

#### removed-packages.ndjson

Rung 3's audit trail (`src/rungs/uninstall-hivemind.ts`). One record appended BEFORE each removal of a conflicting `@deeplake/hivemind` global; if the record cannot be written, the destructive uninstall is skipped.

```typescript
export interface RemovedPackageRecord {
	readonly package: string;        // "@deeplake/hivemind"
	readonly version: string | null;
	readonly at: string;             // ISO-8601, written before the uninstall ran
}
```

#### Telemetry SQLite DDL (Contract B, complete)

Doctor reads these tables; it never creates or writes them. Each service owns its database in WAL mode; doctor opens it with `new DatabaseSync(path, { readOnly: true, timeout: 1000 })`.

```sql
CREATE TABLE IF NOT EXISTS service_status (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  binding_time TEXT NOT NULL,       -- ISO-8601, set once at process start
  last_seen TEXT NOT NULL,          -- ISO-8601, updated every heartbeat
  health TEXT NOT NULL,             -- 'ok' | 'degraded' | 'unconfigured'
  deeplake_connected INTEGER,       -- 0/1, nullable
  deeplake_last_comm TEXT           -- ISO-8601, nullable
);

-- honeycomb's metric set (3 counters)
CREATE TABLE IF NOT EXISTS service_metrics (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  actions_taken INTEGER NOT NULL DEFAULT 0,
  files_processed INTEGER NOT NULL DEFAULT 0,
  memories_created INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

-- nectar's metric set (5 counters; own table variant, additive per PRD-002b-AC-4)
CREATE TABLE IF NOT EXISTS service_metrics (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  files_registered INTEGER NOT NULL DEFAULT 0,
  nectars_minted INTEGER NOT NULL DEFAULT 0,
  descriptions_generated INTEGER NOT NULL DEFAULT 0,
  hive_graph_versions INTEGER NOT NULL DEFAULT 0,
  embeddings_computed INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS service_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('error','warn','info','debug')),
  message TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_service_logs_ts ON service_logs(ts DESC);
```

Contract rules: `service_status` and `service_metrics` are single-row (`id = 1`) latest-wins tables updated in place. `service_logs` is append-only, writer-capped at 5,000 rows (oldest deleted past the cap). Metrics reset to zero on process start; `binding_time` is the "since last restart" anchor. Non-sensitive columns only. Doctor's reads are all either a single-row `id = 1` lookup or a windowed `id > ? ORDER BY id ASC LIMIT ?` scan (`readNewLogs`), so memory stays bounded regardless of history.

#### Config env overrides

`resolveConfig` in `src/config.ts` layers these over `DEFAULTS`; every parse falls back to the default on garbage, never throws:

`DOCTOR_PROBE_INTERVAL_MS`, `DOCTOR_PROBE_TIMEOUT_MS`, `DOCTOR_STARTUP_GRACE_MS`, `DOCTOR_HEALTH_URL`, `DOCTOR_STATUS_PAGE_PORT` (0 asks the OS for an ephemeral port), `DOCTOR_BACKOFF_FLOOR_MS`, `DOCTOR_BACKOFF_CEILING_MS` (a ceiling below the floor clamps up to the floor), `DOCTOR_RESTART_GIVE_UP`, `DOCTOR_RESTART_COOLDOWN_MS`, `DOCTOR_INSTALL_HEALTH_INTERVAL_MS` (default 3,600,000 = 60 min), `DOCTOR_WORKSPACE_DIR`, `HONEYCOMB_DAEMON_PID_PATH`.

### Trust Boundaries

The security model: what doctor exposes, what it refuses to trust, the attack the telemetryDbPath containment closes, the credential non-touch policy, and exactly what leaves the box over telemetry.

#### The boundary map

```mermaid
flowchart TD
    subgraph untrustedInputs["Untrusted inputs"]
        registryFile[("doctor.daemons.json (installer-written)")]
        serviceDbs[("service telemetry SQLite (service-written)")]
        healthBodies["/health response bodies"]
        envVars["environment variables"]
    end
    subgraph doctorProcess["doctor process (loopback only)"]
        parser["defensive parsers (registry.ts, config.ts, state.ts)"]
        pollLoop["poll loop + supervisors"]
        statusSurface["status page + SSE, 127.0.0.1:3852"]
        chokepoint["telemetry chokepoint (emit.ts)"]
    end
    subgraph outboundTargets["Outbound, egress only"]
        npmRegistry["npm registry (execFile, pinned semver specs)"]
        blessedCdn["get.theapiary.sh blessed-version.json (fail-closed)"]
        posthogSink["PostHog OTLP sink (allow-listed, opt-out gated)"]
    end
    credentialStore[("~/.deeplake/credentials.json")]
    registryFile --> parser
    serviceDbs -->|"read-only, contained paths"| pollLoop
    healthBodies --> parser
    envVars --> parser
    parser --> pollLoop
    pollLoop --> statusSurface
    pollLoop --> chokepoint
    chokepoint --> posthogSink
    pollLoop --> npmRegistry
    pollLoop --> blessedCdn
    doctorProcess -.->|"NO code path, read or write"| credentialStore
```

#### Loopback-only surfaces

Doctor's entire inbound surface is one HTTP listener bound to `127.0.0.1` on `:3852` (`LOOPBACK` constant in `src/status-page/server.ts`), serving `GET /`, `GET /status.json`, and the `GET /events` SSE stream. It is read-only by construction: no route mutates anything, proxies anything, or triggers an action. There is no MCP server, no SDK, no remote management port, and no 0.0.0.0 bind anywhere. All dynamic strings on the HTML page are entity-escaped (`escapeHtml`), so even hostile daemon names or escalation text cannot inject into the local page.

The outbound directions are equally narrow: `/health` probes to loopback daemons, `npm` invocations through `execFile`, the blessed-version CDN fetch, and the PostHog telemetry POST. That is the complete network story.

#### The registry is untrusted installer-written input

`~/.honeycomb/doctor.daemons.json` is an external file another process writes, so `src/registry.ts` validates it at the boundary like it came from the internet:

**SSRF gate on `healthUrl`.** Doctor fetches every entry's `healthUrl` on a timer and reflects reachability on the status page. A tampered registry with a non-loopback URL would turn the watchdog into a server-side request forgery primitive: attacker-chosen origins fetched from the user's machine on a schedule. `coerceHealthUrl` therefore requires http/https AND a hostname on the loopback allow-list (`127.0.0.1`, `localhost`, `::1`, `[::1]`); anything else silently falls back to the safe loopback default, mirroring hive's `isLoopbackBaseUrl` gate so both watchdog surfaces share one loopback-trust model.

**Containment on `telemetryDbPath`.** This is the fix landed in commit `ad2174a` off the security review of the telemetry ingestion work. The attack it closes: an unconstrained `telemetryDbPath` lets a poisoned registry point doctor's poller at ANY user-readable SQLite file. Doctor opens it read-only, sure, but if the file happens to carry Contract-B-shaped tables, its contents get polled and forwarded over the unauthenticated loopback `/events` stream, turning the watchdog into a local file-exfiltration relay. `coerceTelemetryDbPath` closes it: the value is tilde-expanded, rejected unless absolute (a relative path would anchor to whatever cwd the process has, so a parse-time check could validate one file and the poll loop could open another), resolved, and asserted to sit under `~/.honeycomb/telemetry/` via `assertWithinBase`, which returns the exact candidate it checked so nothing downstream can reinterpret it. An escaping path degrades to absent (health-probe-only), never a crash and never a silently honored escape. Downstream, the poll loop adds a second check: a `service_status.name` that does not match the registry entry's name is treated as a malformed DB and isolated before any row is cached or forwarded, so a mispointed path cannot cross-wire one service's telemetry onto another.

**Fail postures.** A missing file falls back to the honeycomb primary. A malformed file fails loudly at parse (`RegistryError`) but is caught at the composition root, which falls back, logs, and records a needs-attention record instead of handing the OS supervisor a crash loop.

Doctor's own state files get the same treatment in the other direction: every fixed filename is joined under the workspace dir through `resolveInBase`/`assertWithinBase` (`src/safe-path.ts`), so no composed write can land outside `~/.honeycomb/doctor`.

#### Command execution hygiene

Every shell-out (npm installs, service managers, detection probes) goes through `createExecFileRunner` (`src/rungs/command-runner.ts`): `execFile` with argv arrays and no shell, so a path or label can never be re-parsed as a metacharacter. The update engine adds npm-spec hygiene on top: any version string headed into `npm install -g @` is validated as strict semver first, because the rollback path's version once came from a network-sourced `/health` body and a spoofed `latest` or `>=0.0.0` range must never reach npm's resolver. The shared install lock serializes rung 2's reinstall against the auto-update engine so two global installs can never interleave.

#### The credential non-touch policy

Doctor never reads, writes, or deletes `~/.deeplake/credentials.json`. This is enforced by absence: there is no credential-purge code path in the codebase, no `clear-credentials` CLI verb in the command table (deliberately, AC-064f.4), and rung 3's only filesystem write is the backup record under doctor's own workspace. When doctor suspects a credential fault it escalates with `recommendedAction: "clear-credentials"` and a `wouldHaveTaken` note ("would clear ~/.deeplake/credentials.json (DEFERRED - not performed in v1)"), so the recommendation reaches a human without the action ever being automated. The status page renders that recommendation as a comment, not a command.

The same boundary shapes rung 3: removing a conflicting `@deeplake/hivemind` global removes the npm PACKAGE only. Credentials and onboarding state in `~/.deeplake/` are shared with honeycomb and are untouchable.

#### Telemetry: scrubbed, gated, one chokepoint

Everything that leaves the box goes through `emitTelemetry` in `src/telemetry/emit.ts`, one function, which is what makes the opt-out verifiable in a single place. Four gates run in order, and any hit means nothing is sent:

1. Empty PostHog key (an unkeyed local/fork build): hard-disabled.
2. `DO_NOT_TRACK=1` (any value other than empty or `0` counts): opted out.
3. `HONEYCOMB_TELEMETRY=0`: opted out.
4. `state.json` `telemetryDisabled: true` (the dashboard toggle): opted out.

What can be sent is allow-listed structurally: only keys on `ALLOWED_ATTRIBUTE_KEYS` survive `buildAllowedAttributes`, so credential contents, tokens, file paths, and PII are not scrubbed out so much as impossible to include. The payload is operational facts: severity, stream kind (errors, install-health, escalation episodes), the per-install device id, coarse OS/arch, version strings, remediation step verbs and outcomes, and heal-age buckets. The ingest key is a public write-only key sent as a Bearer header (never a query param, so it never lands in intermediary access logs). Every emit is fire-and-forget with an abort timeout; a telemetry failure is a warn log, never a wedge. The escalation hosted sink and the auto-update outcome events ride the same chokepoint and the same gates.

#### Security review checklist for changes

Reviewing a doctor PR? These are the questions that have caught real findings:

- Does any new input (file, env var, HTTP body, SQLite row) reach a syscall, a URL fetch, or an npm spec without passing a coercion that falls back or a containment assertion? The registry's `healthUrl` and `telemetryDbPath` gates are the templates to copy.
- Does any new path composition skip `resolveInBase`/`assertWithinBase`? Fixed filenames under variable dirs must route through them, both for real containment and for SAST taint visibility.
- Does any new shell-out use anything other than the `CommandRunner` seam with an argv array?
- Does any new outbound data skip the `emitTelemetry` chokepoint or add an attribute without extending the allow-list deliberately?
- Could the change let doctor write outside `~/.honeycomb/doctor`, or read under `~/.deeplake/`? Both are hard no's.
- Does any new listener bind to anything other than `127.0.0.1`?

#### What a compromise would get, and would not

An attacker who can write the registry file already runs code as the user, but doctor still refuses to amplify them: no off-loopback fetches, no out-of-containment file reads, no shell interpretation, no credential access. An attacker on the local machine reading `:3852` sees fleet health and scrubbed telemetry, nothing secret-bearing, because nothing secret-bearing is ever loaded into the model. And a compromised npm publish of the primary daemon is contained by the blessed gate plus verify-and-rollback: a bad version that never gets blessed never auto-installs, and a blessed-but-broken one is rolled back on the failed health verify. The release pipeline itself splits privileges so publish credentials (a short-lived OIDC identity, no long-lived token exists) never coexist with third-party code execution; see ../infrastructure/build-and-release.md.

### ADR-0001, hive telemetry transport and doctor as the single source of truth

#### Context

The Apiary runs a four-process fleet: honeycomb (workload daemon, `:3850`), nectar (workload daemon, `:3854`), hive (always-on portal, `:3853`), and doctor (the supervisor watchdog, loopback status page `:3852`). doctor already supervises the workload daemons from a static registry and serves a coarse `GET /status.json` (per-daemon `ok|degraded|unreachable|unknown` only, no metrics). hive already consumes that status via its `/api/fleet-status` route.

Two forces converge:

1. The portal needs far more than coarse health: it needs live metrics (actions taken, files processed, memories created since last restart), live logs at selectable verbosity, and Deeplake connection/stats, rendered in near real time.
2. doctor is deliberately a "can't-crash", ZERO-runtime-dependency watchdog (Node built-ins only). Any telemetry mechanism it gains must not add an external dependency or a failure mode that can wedge it.

The question this ADR settles: how does telemetry flow from each service to doctor, and from doctor to the portal?

#### Decision drivers

- A dying service cannot reliably push a "I am crashing" message before it dies, so a push channel from services is exactly the wrong shape for the failure we care most about.
- doctor must stay dependency-light and crash-proof.
- Memory must stay bounded: the portal wants live logs, but doctor must never hold whole log histories in memory.
- The portal wants one authoritative, near-real-time feed, not N direct connections to N services.

#### Decision

**Services write to SQLite; doctor polls and owns the truth; one SSE stream feeds the portal.**

1. **Services are producers, SQLite is the transport.** Each service (honeycomb, nectar, hive, and any future product) writes its own NON-SENSITIVE telemetry to its OWN local SQLite database: logs written live, health and metric check-ins written on an interval. Services never push to doctor.
2. **doctor is the puller and the single source of truth.** doctor polls each registered service's SQLite database (about once per second) and probes each service's `/health`, merges the results into an in-memory model, and is the one authoritative source of hive health and telemetry. Which databases/tables it polls comes from the registry (`ADR-0002`).
3. **One SSE stream, doctor to hive.** doctor maintains exactly one Server-Sent-Events stream to hive, which renders the health rail, the `/buzzing` readiness screen, and the health page in near real time. There is NO service-to-doctor SSE and no other streaming surface. This makes real the future direction hive `ADR-0003` recorded as Proposed, scoped to the single doctor to hive hop.
4. **Zero-dependency SQLite.** doctor uses Node's built-in `node:sqlite` (Node >= 22.5, the `--experimental-sqlite` builtin honeycomb already relies on for its local queue), so it gains SQLite access without any external runtime dependency, preserving the watchdog's zero-dep ethos. Databases run in WAL mode so a service writes while doctor reads without lock contention. doctor opens service databases read-only.

Memory stays bounded because doctor queries windows (recent rows, aggregates) rather than loading whole logs; the portal pages request bounded slices over the SSE feed.

```mermaid
flowchart LR
    hc["honeycomb :3850"] -->|"writes logs live + metrics on interval"| hcdb[("honeycomb.sqlite")]
    hn["nectar :3854"] -->|"writes"| hndb[("nectar.sqlite")]
    th["hive :3853"] -->|"writes"| thdb[("hive.sqlite")]
    doctor["doctor (SoT)"] -->|"poll ~1s (read-only) + probe /health"| hcdb
    doctor --> hndb
    doctor --> thdb
    doctor -->|"one SSE stream"| portal["hive dashboard"]
```

#### Consequences

**Positive.**

- Robust to crashes: a service that dies simply stops updating its SQLite rows and stops answering `/health`; doctor detects it within roughly one poll interval, no lost "dying" push required.
- doctor stays crash-proof and dependency-light (built-in `node:sqlite` only).
- Decoupled producer/consumer: services do not need to know doctor's address or protocol; they only write local files.
- One authoritative feed to the portal, not N browser-to-daemon connections.

**Negative.**

- Detection latency is roughly the poll interval (about 1s), acceptable for a local operator dashboard but not instantaneous.
- doctor must manage many SQLite readers and be disciplined about windowed queries to keep memory bounded.
- SQLite schemas become a contract between each service (writer) and doctor (reader); schema drift must be handled additively (owned by doctor PRD-002 and the per-service PRDs).

**Reversibility.** Moderate. The producer/consumer split via SQLite is a clean seam; a future move to a push or hybrid model would change doctor's ingestion side and the service writers, but the portal-facing SSE contract would be unaffected.

#### Alternatives considered and rejected

##### Services push health/logs to doctor over SSE or HTTP (REJECTED)

Each service opens a stream (or posts) to doctor. Rejected because the failure we most need to detect, a crash, is precisely when a service cannot push; it also adds N inbound streams, makes doctor a server for its supervisees (inverting the watchdog relationship), and couples every service to doctor's address and protocol.

##### Hybrid: SQLite for logs/metrics, plus a lightweight push for immediate state changes (CONSIDERED, REJECTED for v1)

Keep the SQLite pull for bulk telemetry but add a small service-to-doctor push so a clean shutdown or state change is reflected instantly. Deferred: it reintroduces an inbound channel and its failure modes for a marginal latency win over a 1s poll. Can be revisited if sub-second state transitions ever matter.

##### doctor reads each service's data over HTTP `/metrics` instead of SQLite (REJECTED)

Rejected because it requires each service to keep serving while degraded, does not survive a crashed-but-not-exited process well, and does not give the portal durable history; SQLite gives durable, queryable, crash-surviving local state for free.

#### Relationship to the corpus ADRs

- nectar `ADR-0004` decision #2 (hive holds no Deeplake client; it aggregates from daemon APIs) is unchanged: the portal still holds no data plane. This ADR routes fleet health/telemetry through doctor as SoT rather than through per-daemon API aggregation, which is complementary (workload data via hive's BFF proxy per hive ADR-0002; fleet health/telemetry via doctor's SSE per this ADR).
- hive `ADR-0003`: this ADR makes its Proposed SSE real, but only for the doctor to hive health/telemetry feed.

#### References

- `doctor/src/status-page/server.ts` - the current coarse `/status.json` this telemetry feed enriches.
- `doctor/src/registry.ts` - the registry that will also record each service's SQLite database location (see `ADR-0002`).
- nectar `prd-004` - the registry + hive module this builds on.
- Shipped: doctor `prd-001` (registration + ingestion) and `prd-002` (SSE + schema) implement this ADR.
   

### ADR-0002, service registration: static installer registry plus runtime SQLite status

#### Context

doctor supervises the fleet from a static JSON registry at `~/.honeycomb/doctor.daemons.json` (introduced by nectar PRD-004a). Each entry today carries `name`, `healthUrl`, `pidPath`, and the per-daemon supervision knobs (`probeIntervalMs`, `startupGraceMs`, `restartGiveUpThreshold`, `restartCooldownMs`); the root is `{ "daemons": [ ... ] }`. doctor reads this file on boot and falls back to the honeycomb primary when it is absent, and (per the recent fail-soft change) surfaces a needs-attention record rather than crash-looping when it is malformed.

`ADR-0001` makes doctor the single source of truth by polling each service's SQLite database and `/health`. That requires doctor to know, per service: that it should exist (even while it is down), how to supervise it, where its SQLite database lives, and its live runtime state (last check-in, binding time, last-seen, health, metrics). A single JSON file cannot cleanly hold both the static "should exist" contract and the churning runtime state.

#### Decision

**Two layers: an installer-written static registry, and a service-written runtime SQLite status.**

1. **Static registry (installer-owned).** The installer writes `doctor.daemons.json`, extended so each entry also records where that service's SQLite database(s) live (the path[s] doctor polls per `ADR-0001`). This layer answers "who SHOULD exist and how do I supervise it", and it must survive while a service is down, so doctor still supervises, probes, and restarts a stopped service. Registration is created on install and updated on install / update / deletion of a product (the installer owns those writes; see the-apiary `ADR-0002`).
2. **Runtime status (service-owned, SQLite).** On check-in, each service writes its runtime state (registration record, binding time, last-seen, current health, metrics) into SQLite. This is the churning, live layer.
3. **doctor merges.** doctor loads the static registry into memory on boot, restart, or explicit registration/deregistration, and retains in memory who to poll for health and which SQLite databases/tables to check. It merges the static "should exist" list with the runtime status to produce the authoritative fleet model. On a service disconnect (missed check-ins + failing `/health`), doctor records a last-seen time.

The static registry stays the durable source for supervision; the runtime SQLite is the live source for telemetry. doctor is the only reader that unifies them.

```mermaid
flowchart TD
    installer["Installer (install / update / delete)"] -->|"writes static entry + db path"| reg[("doctor.daemons.json")]
    service["A service, on check-in"] -->|"writes binding time, last-seen, health, metrics"| rt[("service runtime SQLite")]
    doctor["doctor"] -->|"reads on boot/restart/(de)register"| reg
    doctor -->|"polls ~1s"| rt
    doctor --> model["in-memory fleet model (SoT)"]
```

#### Consequences

**Positive.**

- doctor can supervise a service that is currently DOWN, because the static "should exist" entry persists independently of runtime state.
- Runtime churn (health flaps, metric updates, last-seen) never rewrites the installer's static config.
- Clean ownership: installers own the static registry; services own their runtime rows; doctor owns the merge.

**Negative.**

- Two sources to keep coherent; a service registered statically but never checking in shows as "registered but never seen" (which is the correct, useful signal).
- The registry schema grows (SQLite db path[s] per entry); the extension must stay backward compatible with the existing PRD-004a parser and its fail-soft fallback.

**Reversibility.** Moderate. The static layer is the existing registry extended; the runtime layer is additive SQLite. Collapsing to one store later would be a migration, but the two-layer split is the low-risk starting point.

#### Alternatives considered and rejected

##### Unify everything into a single SQLite registration table (REJECTED)

One table that both installers and runtime check-ins write, dropping the JSON registry. Rejected because it loses the durable, human-editable "who should exist while down" list doctor needs to keep supervising a stopped service; it also couples install-time writes and high-frequency runtime writes into one contended store.

##### Keep the JSON registry only and add runtime fields to it (REJECTED)

Cram last-seen/health/metrics into `doctor.daemons.json`. Rejected because it turns a static installer-owned config file into a high-churn runtime file (rewritten every check-in), fighting the atomic-write + fail-soft-parse posture and inviting corruption.

#### References

- `doctor/src/registry.ts` - the static registry loader/parser this extends (schema, fallback, fail-soft).
- nectar `prd-004` (PRD-004a registry + 004d registration) this builds on.
- the-apiary `ADR-0002` - the installer that creates/updates registration on install/update/delete.
- Shipped: doctor `prd-001` implements this ADR.
   

# Part 2: Hive, the Portal

## Hive: Stories & User Guide

*One address for your whole Apiary install, explained for the people who use it.*

### Foreword

The Apiary runs several services on your machine, each on its own port. None of that should be your problem. Hive is the front door: one always-on portal at 127.0.0.1:3853 that serves the entire dashboard for everything behind it. Bookmark one address and you are done. This guide walks through what you see when you open it, why it never shows you a broken page, and how to read the fleet at a glance.

### Hive Overview

Read this if you have an Apiary install and want to know what hive is, what you will see at `localhost:3853`, and why there is only one address to remember.

#### One dashboard for your whole Apiary install

The Apiary runs several services on your machine: Honeycomb doing the memory work, Nectar mapping your sources, Doctor watching all of them. Each one has its own port, and none of that should be your problem. Hive is the front door: one always-on portal at **`http://127.0.0.1:3853`** that serves the entire dashboard for everything behind it. Bookmark that one address and you are done. No port hunting, no "which service serves that page," no juggling tabs across loopback ports.

Hive was designed by Mario Aldayuz around a simple observation: the old dashboard lived inside the memory service, so it went dark exactly when you needed a status view most. So the portal became its own service, built to be the last thing standing.

#### What you see when you open it

**On a normal day: the dashboard.** The root page is the full Apiary dashboard: your memories, projects, the memory graph, the hive graph, sync activity, logs, ROI, and settings, all in one place. A health rail sits at the top of every page with a live pill per service, so you always know the state of the fleet without leaving what you are doing. Click through to the Health page for per-service metrics, Deeplake connection status, and a live log tail with adjustable verbosity.

**On a cold boot: the buzzing screen.** If you open the portal while the services are still waking up, you get an honest readiness screen at `/buzzing`: one tile per service, each with a little bee icon showing its state, from an empty honeycomb cell (starting) to a bee in full flight (active). The moment the fleet is ready, you land on the dashboard automatically. You will never see a broken page or a false "first time setup" screen just because something was still booting.

**Not signed in yet: the login screen.** If the fleet is healthy but you have not connected your credentials, you get the guided device-flow setup at `/login`. Health is checked first, on purpose: if nothing behind the portal will answer, prompting you to log in would be pointless.

#### Always on, by design

Hive starts when your machine boots, restarts itself if it ever crashes, and is watched by Doctor like every other Apiary service. It binds only to your machine (`127.0.0.1`), so nothing off your device can reach it. Your browser talks to hive alone; hive's server fetches everything else over local loopback on your behalf and passes your session straight through without storing anything. If one service goes down, its panels say "unreachable" while the rest of the dashboard keeps working, and everything recovers on its own when Doctor brings the service back.

#### Reading the bee icons

Every service tile on the buzzing screen and every pill in the health rail uses the same five states, drawn as distinct shapes so they read even without color:

| Icon | State | What it means |
|---|---|---|
| Empty honeycomb cell (dashed) | starting | Registered, but has not checked in yet |
| Bee with half-folded wings | warming | Just came up healthy; settling in |
| Bee with wide-spread wings | active | Checked in and healthy |
| One-winged bee with a caution mark | degraded | Up, but not fully healthy |
| Bee on its back, wings crossed | error | Failed or unreachable; likely needs attention |

#### Quick answers

**Why does the address start with 127.0.0.1?** That is your own machine. The portal binds locally only; nothing outside your device can reach it, and no account or cloud login is needed to view it.

**A panel says "unreachable." Is my data gone?** No. It means the service that owns that panel is not answering right now. Doctor restarts crashed services automatically; the panel recovers on its own once the service is back. The Health page shows exactly which service and since when.

**The whole page went to the buzzing screen. Now what?** Wait a moment. The buzzing screen means the fleet is not fully healthy, and it dismisses itself the moment it is. If a tile stays on the error bee, that service needs attention; the Health page's live logs are the first place to look.

**Does hive store my credentials?** No. Hive passes your session through to the services that own your data and stores nothing itself. Signing in (the device flow at `/login`) creates your Deeplake credential on your machine, managed by Honeycomb, not by the portal.

#### You should rarely need the terminal

The Apiary installer sets all of this up. For completeness, the CLI is four commands:

```bash
hive start                # run the portal (the default)
hive install-service      # install the boot-time OS service
hive uninstall-service    # remove the OS service
hive register             # register hive with Doctor's supervisor
```

Day to day, the only thing you touch is the browser: `http://127.0.0.1:3853`.

## Hive: Technical Manual & Specification

*Portal daemon, BFF federation, routing, and the copy-and-own provenance behind the Apiary dashboard.*

### Foreword

Hive became its own service for one reason: the old dashboard lived inside the memory daemon, so it went dark exactly when you needed a status view most. This manual documents the portal daemon, the server-side BFF proxy that federates every other service, the landing gate and path-based routing, how Hive registers with Doctor, and the trust boundaries it enforces. It is written for engineers building on or auditing the portal.

### Hive: Overview & Quickstart

#### What makes Hive different

Plenty of tools bolt a status page onto a daemon. Hive is built the other way around: the portal is the product, and four deliberate decisions make it hold up.

- **A single portal.** Every dashboard route in the Apiary lives here. Honeycomb's in-daemon dashboard is retired; Hive is the one source of always-on UI truth.
- **Server-side BFF proxy.** Per ADR-0002, the browser talks to Hive's origin only. The server resolves which daemon owns each `/api/*` and `/setup/*` request, fetches it over loopback, and streams it back. No CORS on any workload daemon, no daemon ports handed to a browser, loopback trust enforced on the server with redirect pinning.
- **Copy-and-own dashboard.** Per ADR-0001, the dashboard code was copied out of Honeycomb once and is owned here outright. No live shared module to drift, no fork to babysit, no second copy left to diverge from.
- **Always on.** Hive is its own supervised OS process, boot-ordered, not gated on any workload daemon's health. It ships on its own release train, so a dashboard change never forces a supervisor or workload release.

#### Features

- **The unified Apiary dashboard**, served from one process the moment the socket binds.
- **Server-side BFF proxy** routing `/api/*` and `/setup/*` to the owning daemon: Honeycomb (`:3850`), Nectar (`:3854`), each resolved from Doctor's registry.
- **Single browser origin.** Same-origin fetches only; your browser never learns another daemon's port.
- **Credential-free by design.** Transparent auth pass-through; Hive stores no token and holds no Deeplake client.
- **Fail-soft aggregation.** One daemon down means one panel shows unreachable while the rest of the dashboard keeps working.
- **Fleet readiness via Doctor.** `/api/fleet-status` reads the supervisor's status page server-side, so the portal shows honest per-fleet health instead of guessing from failed fetches.
- **Always-on daemon on `:3853`** with `/health`, a PID/lock single-instance guard, and OS service units (launchd, systemd, schtasks) that restart it on crash and start it on boot.
- **Supervised by Doctor** through an idempotent registry entry, installed at setup time.

#### Install (one command)

Hive doesn't install alone; it comes up as part of the Apiary stack. One line, and the installer handles Node, npm, the daemons, and the watchdog.

```bash
# macOS / Linux
curl -fsSL https://get.theapiary.sh | sh
```

```powershell
# Windows (PowerShell)
irm https://get.theapiary.sh/install.ps1 | iex
```

That single line installs the whole Apiary: Honeycomb, Nectar, Doctor, and Hive, which comes up at **`127.0.0.1:3853`** and becomes the one address you ever need to remember. The terminal is just a progress log; the portal is the product.

Prefer to build from source?

```bash
git clone https://github.com/legioncodeinc/hive.git
cd hive
npm install
npm run build        # tsc + esbuild → dist/cli.js

npm start            # runs `node dist/cli.js start`, binds :3853
npm run typecheck    # tsc --noEmit
npm test             # vitest run
```

The portal aggregates its data from the other Apiary daemons over loopback, so a source build of Hive alone gets you the shell and fleet status; the full dashboard lights up when Honeycomb and friends are running.

#### Using the dashboard

Open `http://127.0.0.1:3853` and the shell renders immediately, even on a cold boot. While the fleet is still waking up you get a readiness splash with per-daemon health rows instead of a false "first time setup" screen. Once the fleet is ready, the full portal takes over: the memory pages, the graph, sync, and ROI views migrated from Honeycomb, plus fleet status pulled from Doctor. Every page hydrates through the same-origin wire, proxied server-side to whichever daemon owns the data.

#### Using the CLI

The `hive` binary keeps a deliberately small surface. It's a portal daemon, not a Swiss Army knife:

```bash
hive start                # run the portal daemon on :3853 (the default verb)
hive install-service      # install the OS service unit (launchd / systemd / schtasks)
hive uninstall-service    # remove the service unit
hive register             # append Hive to Doctor's daemon registry
```

That's the whole list, on purpose. Day to day you never touch it; the installer wires the service unit and registration, Doctor keeps the process alive, and you live in the browser.

#### Open one URL, see the whole hive

```bash
# One address. No port hunting, no tab juggling.
open http://127.0.0.1:3853

# Honeycomb up, Nectar up, Doctor watching, memories flowing.
# You just checked four daemons without remembering a single port number.
```

Kill a workload daemon mid-session and the dashboard doesn't blink: that daemon's panels go "unreachable," everything else keeps rendering, and the page recovers on its own when Doctor brings the daemon back. That's the moment this thing earns its keep.

#### How it works

The browser talks to exactly one origin. Hive's server does the reaching around, over loopback, with the trust checks on its side of the line.

```mermaid
flowchart TD
    browser["Browser"] -->|"same-origin /api/*, /setup/*"| hive["Hive :3853<br/>portal + BFF proxy"]
    hive -->|"loopback proxy"| comb["Honeycomb :3850<br/>memory workload"]
    hive -->|"loopback proxy"| nectar["Nectar :3854<br/>hive graph workload"]
    hive -->|"fleet status"| doctor["Doctor :3852<br/>supervisor status page"]
```

The browser never talks to the back daemons directly. Hive resolves each request's owner from Doctor's registry, guards every resolved base as loopback-only, pins redirects so a daemon can't bounce a proxied fetch off the machine, and forwards your session headers verbatim without keeping any credential of its own.

#### Why one front door matters

Here's the thing about a stack of loopback daemons: individually they're clean, collectively they're a chore. Four processes means four ports, and four ports means the knowledge of your own tooling lives in your head instead of in the product. Every "wait, which one was 3854" is a small tax, and small taxes compound.

One front door collapses that. Your credentials cross exactly one boundary, enforced by a server you control, instead of being sprayed across browser tabs that each talk to a different origin. Your bookmark bar holds one entry. When something breaks at 2 a.m., you don't run a mental port scan; you open the one page and the sick daemon is the red row.

And there's a quieter payoff: the stack starts feeling like one product. Honeycomb, Nectar, and Doctor stay sharply separated where it counts, in process boundaries and data ownership, while you experience them as a single coherent surface. Separation of concerns for the machine, one front door for the human. That's the trade Hive makes, and it's the right one.

#### Other interfaces

Straight talk: Hive ships two surfaces, and that's it for now.

- **Dashboard.** The web portal at `http://127.0.0.1:3853`. This is the product.
- **HTTP portal API.** Hive's own loopback endpoints: `GET /health` for cheap liveness (status, uptime, version) and `GET /api/fleet-status` for fleet health, plus the proxied `/api/*` and `/setup/*` surfaces of the daemons behind it.

No MCP server, no SDK, and none pretending. The workload daemons own those surfaces; Hive owns the door.

 Status & Roadmap

Hive is **production ready (v0.2.x)** and fully tested in live scenarios. The whole PRD program has shipped: the portal daemon, the migrated dashboard, the server-side BFF proxy, the OS service units and registry wiring, the portal gate, the fleet readiness surface, the Hive Graph page, and the onboarding installer. We document what's shipped; the roadmap and idea board for what comes next live at [ideas.theapiary.sh](https://ideas.theapiary.sh).

#### Development

```bash
npm install
npm run build        # tsc + esbuild → dist/cli.js
npm run typecheck    # tsc --noEmit
npm test             # vitest run
```

Node `>= 22`, TypeScript, Hono on the server, React on the dashboard. The proxy surface (header hygiene, redirect pinning, streaming) carries its own test coverage; keep it that way.

#### Credits

- **[Activeloop](https://activeloop.ai/)** brings **[Deeplake](https://deeplake.ai/)** (the versioned, multi-modal database for AI with native vector + columnar indexing and hybrid search) and **[Hivemind](https://github.com/activeloopai/hivemind)**, the open-source agent-memory project Honeycomb is built upon.
- **[Legion Code Inc](https://github.com/legioncodeinc)** brings the **multi-tier memory system** (Tier 1 / 2 / 3 keys, summaries, raw), **code base atlas memory architecture**, **auto healing service**, **session priming**, **automatic skill development & propagation**, the **pollinating loop**, the **knowledge graph**, **cross device cross repository cross team skill sharing**, and the daemon architecture that turns Deeplake into a shared brain your coding agents read and write on every turn.

#### License

Hive is licensed under the **GNU Affero General Public License v3.0 or later** (AGPL-3.0-or-later).

Use it commercially or privately, free of charge. In return: keep the copyright and license notices intact, and if you modify it, your changes ship under the same AGPL license with source available. The "Affero" part is the point: run a modified version as a network service and you owe its source to the users who interact with it. No locking a fork behind a SaaS wall.

© 2026 Legion Code Inc.

  Built by Legion Code Inc · Powered by Activeloop Deeplake · theapiary.sh

<p alig

### Hive System Overview

Read this first if you work on any part of hive: it explains why the portal daemon exists, where it sits in the Apiary fleet, and what happens from OS boot to a rendered dashboard.

#### Why hive exists

The Apiary runs four daemons on one machine: honeycomb (the memory workload, `:3850`), nectar (the hive-graph workload, `:3854`), doctor (the supervisor, status page on `:3852`), and hive (the portal, `:3853`). Before hive, the dashboard lived inside honeycomb. That put the status surface inside the process most likely to be the thing you are trying to diagnose. When honeycomb was down, the dashboard was down, which is exactly when an operator needs it most.

Hive fixes that failure mode with a velocity/stability split. Doctor is the "can't-crash" watchdog: zero runtime dependencies, updated rarely, deliberately boring. The portal is the opposite: it is UI, it changes often, and it must never force a supervisor release. So the dashboard gets its own always-on daemon with its own release train. Doctor supervises hive like any other daemon, but a dashboard change ships as a hive release and touches nothing else. That split is nectar ADR-0004 decision #4, and it is the reason hive is a separate repository and a separate npm package (`@legioncodeinc/hive`, version 0.1.0).

The second reason is origin consolidation. Four daemons means four loopback ports, and the browser should not have to know any of them except one. Hive is the single origin of UI truth: the browser bookmarks `http://127.0.0.1:3853`, and hive's server reaches every other daemon over loopback on its behalf. No CORS on workloads, no port hunting, no credential in the browser beyond what honeycomb's own session posture already sends. Mario Aldayuz designed hive around that one bet: the portal is the product, not a status page bolted onto a daemon, so it gets a process, a gate, and a proxy built for exactly that job.

#### Fleet position

```mermaid
flowchart TD
    osBoot["OS service manager<br/>(launchd / systemd / schtasks)"] --> doctor["doctor :3852<br/>supervisor + status page"]
    osBoot --> hive["hive :3853<br/>always-on portal"]
    doctor -->|"probes healthUrl, restarts on crash"| hive
    doctor -->|"supervises"| honeycomb["honeycomb :3850<br/>memory workload"]
    doctor -->|"supervises"| nectar["nectar :3854<br/>hive-graph workload"]
    browser["Browser"] -->|"same-origin only: /, /api/*, /setup/*"| hive
    hive -->|"BFF proxy over loopback"| honeycomb
    hive -->|"BFF proxy over loopback"| nectar
    hive -->|"GET /status.json + GET /events (SSE)"| doctor
    honeycomb --> deeplake[("Deeplake")]
    nectar --> deeplake
```

Hive holds no Deeplake client and persists nothing of its own beyond a PID/lock pair and a telemetry dedupe ledger. Every row the dashboard renders comes from a workload daemon's API (proxied server-side) or from doctor's status page and SSE stream. `tests/wire/*` and the PRD-001 QA audit both verify the no-Deep-Lake constraint.

#### The four decisions that shape the codebase

1. **Copy-and-own the dashboard** (hive ADR-0001). The React SPA was copied out of honeycomb once, honeycomb's copy was deleted, and hive owns the code outright. No shared package, no fork, no drift. See copy-and-own-provenance.md.
2. **Server-side BFF proxy** (hive ADR-0002). The browser talks to hive's origin only. `src/daemon/proxy.ts` resolves the owning daemon per request from doctor's registry and forwards over loopback with transparent auth pass-through. See bff-proxy-federation.md.
3. **Health-first, auth-second landing gate** (hive ADR-0004). `src/daemon/gate.ts` runs ahead of every route: unhealthy fleet redirects to `/buzzing`, logged-out operator redirects to `/login`, everything else falls through to the requested path. See landing-gate-and-routing.md.
4. **Doctor is the single health source** (doctor ADR-0001, hive ADR-0003). Hive never probes workload `/health` endpoints itself. It reads doctor's `status.json` for the gate and relays doctor's `fleet-telemetry` SSE stream to the browser at `/api/telemetry/stream`. See ../frontend/buzzing-and-health-rail.md.

#### Lifecycle: boot to dashboard

Hive boots with the device and serves immediately. Nothing about a workload daemon's health delays the socket bind.

1. **OS start.** The service unit (`com.legioncode.hive` on macOS, `hive.service` user unit on Linux, the `hive` Scheduled Task on Windows) runs `node  start` at boot/login and restarts it on crash. `hive install-service` writes the unit; see doctor-registration-and-lifecycle.md.
2. **Single-instance lock.** `startHive()` (`src/daemon/server.ts`) calls `acquireSingleInstanceLock()` (`src/lock.ts`), which creates `~/.honeycomb/hive.lock` with the `wx` flag and writes `~/.honeycomb/hive.pid`. A live lock holder makes the second start exit with `DaemonAlreadyRunningError`; a stale lock (dead PID) is reclaimed.
3. **Bind `127.0.0.1:3853`.** The Hono app serves the shell the moment the socket binds. The constants are hard-pinned in `src/shared/constants.ts`:

```typescript
export const HIVE_HOST = "127.0.0.1" as const;
export const HIVE_PORT = 3853 as const;
export const DOCTOR_STATUS_URL = "http://127.0.0.1:3852/status.json" as const;
export const DOCTOR_EVENTS_URL = "http://127.0.0.1:3852/events" as const;
```

4. **Doctor supervision.** Doctor probes `http://127.0.0.1:3853/health` every 30 seconds (the registry entry hive's installer wrote) and restarts the process if it stops answering. Registration happened at install time, not at boot; boot does not touch the registry.
5. **First browser load.** The landing gate evaluates health then auth and serves `/buzzing`, `/login`, or the requested page. A cold fleet shows per-service bee tiles on `/buzzing`, never a false "first time setup" screen. That failure mode and its fix are the subject of ../frontend/portal-readiness-splash.md and its successor screens.

There is no runtime env configuration for host or port. The only env vars hive reads are the telemetry opt-outs (`HONEYCOMB_TELEMETRY=0`, `DO_NOT_TRACK`); everything else is injectable only through code options, which is a test seam, not an operator surface.

#### Provenance and the rename

Hive began life as "the-hive", a planned package inside the honeycomb repository (nectar ADR-0003/ADR-0004 era). Two things changed: hive became a first-class product in its own repository, and honeycomb's dashboard was retired rather than shared. The rename left one visible scar the code still handles: the pre-decision-#32 OS service names (`thehive`, `thehive.service`) are deregistered best-effort at the start of every `install-service` run (`legacyUninstallCommands` in `src/service/commands.ts`) so a re-run migrates a legacy unit instead of leaving two units racing over one daemon. The dashboard itself is a copy-and-own transfer from honeycomb, documented file-by-file in copy-and-own-provenance.md.

#### Repo map

Where things live, so you can go from this overview to the code in one hop:

```
src/
  cli.ts, cli-commands.ts      # the four verbs: start | install-service | uninstall-service | register
  lock.ts, errors.ts           # single-instance PID/lock guard
  daemon/
    server.ts                  # createHive/startHive: the route table, in registration order
    gate.ts                    # the landing gate (health then auth)
    proxy.ts                   # the BFF proxy for /api/* and /setup/*
    registry.ts                # doctor registry reader: daemon bases + registered service names
    fleet-status.ts            # GET /api/fleet-status projection of doctor's status.json
    setup-auth.ts              # the gate's auth input (honeycomb /setup/state, fail-closed)
    telemetry-proxy.ts         # GET /api/telemetry/stream, the SSE relay of doctor's /events
    dashboard/host.ts          # shell + asset routes; web-assets.ts locates/reads assets
  dashboard/
    contracts.ts               # partial copy of honeycomb's web-consumed ROI types
    web/                       # the SPA: 36 files (registry, router, wire, pages/, screens)
  install/registry.ts          # idempotent upsert into ~/.honeycomb/doctor.daemons.json
  service/                     # per-OS unit plans, templates, manager commands
  shared/                      # constants, daemon-routing, fleet-readiness, fleet-telemetry, service-status
  telemetry/emit.ts            # the single telemetry-egress chokepoint
tests/                         # 33 files mirroring the src domains
assets/                        # design tokens CSS, brand mark, fonts (served by host.ts)
```

Every domain above has a deeper doc in this knowledge base; start from the Related list at the top or the private README index.

#### Program state

Hive is production ready and fully tested in live scenarios: the whole portal PRD program has shipped and is QA-verified on main. PRD-001 (portal daemon), PRD-002 (readiness splash), PRD-003 (landing gate + path routing), PRD-004 (buzzing loaders), PRD-005 (health rail + page), and PRD-009 (onboarding installer) are all implemented, tested, and verified, with the CI and release train (`ci.yaml` + `release.yaml`) closing out the independent-release-train acceptance criterion. Every domain in this knowledge base describes shipped, exercised behavior rather than intended behavior. The `@legioncodeinc/hive` package carries a `published: false` pin in the superproject's `hive-release.json`, which reflects only the one-time trusted-publisher npm bootstrap th

### BFF Proxy Federation

Read this if you touch `src/daemon/proxy.ts`, `src/daemon/registry.ts`, or `src/shared/daemon-routing.ts`: it explains how every dashboard read reaches the daemon that owns it without the browser ever leaving hive's origin.

#### The model

The browser talks to exactly one origin: `http://127.0.0.1:3853`. The copied `wire` client (`src/dashboard/web/wire.ts`) fetches only relative paths (`/api/*`, `/setup/*`, `/health`). Hive's server owns federation: `createApiProxy` (`src/daemon/proxy.ts`) is mounted with `app.all("/api/*")` and `app.all("/setup/*")` in `src/daemon/server.ts`, resolves which daemon owns each request, fetches it over loopback, and streams the response back.

This replaced the first implementation, which federated client-side: hive served a routing table at `GET /api/daemon-bases` and the browser fetched each workload daemon's origin directly. That model forced a CORS middleware onto honeycomb and handed every daemon's port to a browser context, with the loopback-trust check living in the least-trusted tier. ADR-0002 killed it. The `/api/daemon-bases` route and honeycomb's `dashboard-cors.ts` are gone; no workload daemon emits a CORS header for the dashboard today, and none ever needs to again.

#### Target resolution

Ownership is a static routing rule plus a dynamic base lookup.

**The rule** lives in `src/shared/daemon-routing.ts`: nectar owns the hive-graph surface, honeycomb owns everything else.

```typescript
export const DEFAULT_DAEMON_BASES = Object.freeze({
  honeycomb: "http://127.0.0.1:3850",
  nectar: "http://127.0.0.1:3854"
} as const);

const HIVE_GRAPH_PREFIX = "/api/hive-graph";

export function resolveEndpointOwner(endpointPath: string): DaemonName {
  return endpointPath === HIVE_GRAPH_PREFIX || endpointPath.startsWith(`${HIVE_GRAPH_PREFIX}/`)
    ? "nectar"
    : "honeycomb";
}
```

**The bases** come from doctor's registry file. `resolveDaemonBases` (`src/daemon/registry.ts`) reads `~/.honeycomb/doctor.daemons.json`, zod-validates each entry, derives a base URL by stripping the `/health` suffix from the entry's `healthUrl`, and rejects any entry whose host is not loopback before it can become a base. A missing, unreadable, or corrupt registry degrades to the documented loopback defaults above; it never throws and never blocks hive from serving.

Three hive-owned routes are registered before the catch-all proxy so they win by registration order: `/health`, `/api/fleet-status`, `/api/registered-services`, and `/api/telemetry/stream`. Everything else under `/api/*` and `/setup/*` is proxied.

#### A request end to end

```mermaid
sequenceDiagram
    participant B as Browser (wire.ts)
    participant H as hive :3853 (proxy.ts)
    participant R as doctor.daemons.json
    participant C as honeycomb :3850

    B->>H: GET /api/diagnostics/kpis (same-origin, session headers)
    H->>H: resolveEndpointOwner("/api/diagnostics/kpis") = honeycomb
    H->>R: resolveDaemonBases() (loopback-guarded)
    R-->>H: honeycomb = http://127.0.0.1:3850
    H->>H: isLoopbackBaseUrl re-check (defense in depth)
    H->>C: GET http://127.0.0.1:3850/api/diagnostics/kpis<br/>(headers forwarded verbatim minus hop-by-hop, redirect: "error")
    C-->>H: 200 application/json
    H-->>B: 200, body streamed through, framing headers stripped
```

If the fetch to honeycomb throws (connection refused, network error, blocked redirect), the proxy returns the fail-soft response instead of an exception:

```typescript
function unreachableResponse(daemon: DaemonName): Response {
  return new Response(JSON.stringify({ error: "unreachable", daemon }), {
    status: 502,
    headers: { "content-type": "application/json" }
  });
}
```

#### Transparent auth pass-through

Hive forwards the browser's own request headers verbatim to the workload daemon and stores no credential of its own. There is no token minting, no session store, no injected authorization header anywhere in `src/`; the proxy's only header work is subtraction. This preserves honeycomb's existing loopback + local-mode + session-header posture (including the `x-honeycomb-project` scope header the wire sends) without hive becoming an auth authority. "Logged in" for the portal is honeycomb's `/setup/state` `authenticated` bit, which itself just reflects the presence of `~/.deeplake/credentials.json`; hive reads it, never writes it.

Header hygiene is two fixed strip sets in `proxy.ts`. Requests drop `host` (fetch re-derives it from the target) plus the RFC 7230 hop-by-hop headers and `content-length` (recomputed from the forwarded body). Responses drop the hop-by-hop set plus `content-encoding`/`content-length`, because fetch already decompressed the upstream body before hive re-streams it, so the original framing headers would lie.

Bodies are asymmetric by design: the request body is buffered (`await incoming.arrayBuffer()`, small JSON payloads, avoids the `duplex: "half"` dance), while the response body is streamed through (`new Response(upstream.body, ...)`) so SSE tails and large payloads never accumulate in hive's memory.

#### Fail-soft aggregation

One dead daemon never blanks the portal. The guarantee is layered:

1. **Per-request**: the proxy converts every upstream failure into the 502 `{ error: "unreachable", daemon }` JSON above. No exception crosses into Hono's error path.
2. **Per-panel**: `wire.ts` parses every payload through a zod schema per endpoint and degrades a non-2xx or malformed response to a typed empty/zero state. A dead nectar means the Hive Graph page shows its empty state while every honeycomb-backed panel keeps rendering, and vice versa.
3. **Per-registry**: a corrupt or missing registry file falls back to default loopback bases rather than taking the proxy down.

`tests/daemon/proxy.test.ts` and `tests/wire/fail-soft.test.ts` pin all three layers.

#### Why no CORS on workloads

Same-origin is not just tidier; it is the security posture. A CORS allowance on a daemon that serves captured session and memory data is an attack surface that has to be maintained forever and audited on every new daemon. With the BFF model the browser never issues a cross-origin request, so the question never arises: workload daemons owe hive a loopback `/api/*` surface and nothing else. Every future daemon inherits this for free by registering with doctor; the proxy routes to it the day `resolveEndpointOwner` learns its prefix.

#### SSRF posture

The proxy is the one place in the fleet where a server fetches URLs influenced by a file on disk, so it is defended in depth:

- `baseUrlFromHealthUrl` rejects non-loopback registry entries before they can become bases (a tampered `doctor.daemons.json` cannot point the proxy off-machine).
- The proxy re-checks the resolved base with `isLoopbackBaseUrl` immediately before use, so a future refactor of base resolution cannot silently remove the guard.
- Every proxied fetch pins `redirect: "error"`, so a compromised loopback listener cannot 3xx-redirect the request (and its forwarded body) to an external origin after the initial URL passed the loopback check. The same pin exists in `fleet-status.ts`, `setup-auth.ts`, and `telemetry-proxy.ts`.

The trusted hostname set is exactly `127.0.0.1`, `localhost`, `::1`, `[::1]` (`LOOPBACK_HOSTNAMES` in `src/shared/daemon-routing.ts`). See ../security/trust-boundaries.md for the full boundary picture.

#### Freshness

Data freshness is polling for the copied pages (`usePoll` through the proxy) and SSE for the health surface (`/api/telemetry/stream`, the same-origin relay of doctor's `fleet-telemetry` stream). ADR-0003 records the intent to generalize SSE beyond health and logs when the real-time benefit justifies the added moving parts; the proxy already streams response bodies, so a `text/event-stream` response rides through unchanged, which the Logs tail (`/api/logs/stream`) proves in production today.

### Landing Gate And Routing

Read this if you touch `src/daemon/gate.ts`, `src/daemon/server.ts` route registration, or the client boot path: it explains the health-first-auth-second gate, the exact route table, and the redirect semantics.

#### What changed and why

The copied dashboard originally routed from `location.hash` and made its landing decision in React: `main.tsx` mounted `ReadinessSplash` (poll fleet status), which mounted `SetupGate` (poll `/setup/state`), which finally mounted the `Shell`. The server served one shell for every load and never saw the fragment, so nothing authoritative decided what a visitor was allowed to see, and the wrong screen could flash while a client gate resolved.

ADR-0004 moved the decision to the server and made the URL real. Routes are paths, the gate is a Hono middleware registered ahead of every route, and the browser's first paint is already the correct screen. The nested `ReadinessSplash`/`SetupGate` client gates are retired; `main.tsx` now does one pure lookup (`resolveBootScreen` in `src/dashboard/web/boot-route.ts`) from `location.pathname` to a top-level screen and never re-derives health or auth client-side.

#### The gate precedence

`createPortalGate` (`src/daemon/gate.ts`) is registered first (`app.use("*", ...)`) and evaluates, for every non-exempt page navigation:

1. **Health first.** `fetchFleetStatus` reads doctor's `GET http://127.0.0.1:3852/status.json` server-side and `isFleetReady()` decides. Not ready means `302` to `/buzzing`. Auth is never even evaluated in this branch: an unhealthy fleet makes a login prompt pointless and misleading.
2. **Auth second.** `fetchSetupAuthenticated` (`src/daemon/setup-auth.ts`) resolves honeycomb's base the same way the proxy does, fetches `GET /setup/state` over loopback, and reads its `authenticated` bit. `false`, or any failure at all (network error, non-OK, bad JSON, schema mismatch, abort), means `302` to `/login`. This fails closed: a transient fault sends you to `/login`, never into the dashboard.
3. **Serve.** Healthy and authenticated: the middleware calls `next()` and the routes behind it serve the request. `/` is the dashboard; the root is never blank.

The readiness rule is one shared predicate, so "healthy" means the same thing to the gate, the `/buzzing` screen's dismissal poll, and anything else that asks:

```typescript
export const V1_REQUIRED_PEERS = ["honeycomb"] as const;

export function isFleetReady(status: FleetStatusResponse): boolean {
  if (status.supervisor !== "reachable") return false;
  if (status.health !== "ok") return false;
  return V1_REQUIRED_PEERS.every((name) =>
    status.daemons.some((daemon) => daemon.name === name && daemon.health === "ok")
  );
}
```

`degraded` blocks exactly like `unreachable`; only `ok` passes. Nectar is not yet a required peer (it joins when a shipped page depends on it); its row is display-only.

```mermaid
flowchart TD
    land["Request for any path"] --> infra{"Infra/asset/proxy path?"}
    infra -->|"yes"| serve["next(): serve directly"]
    infra -->|"no"| exempt{"/buzzing or /login?"}
    exempt -->|"yes"| serve
    exempt -->|"no"| health{"isFleetReady()?"}
    health -->|"no"| buzz["302 /buzzing"]
    health -->|"yes"| auth{"/setup/state authenticated?"}
    auth -->|"no or fetch failed"| login["302 /login"]
    auth -->|"yes"| serve
```

#### Exemptions: screens vs infra

Two kinds of path bypass the precedence, for two different reasons.

**Exempt screens** (`GATE_EXEMPT_ROUTES = ["/buzzing", "/login"]`): checked before the precedence so they are always served directly. This is the loop-termination proof: the only two redirect targets are themselves exempt from producing another redirect, so the gate can never bounce a browser in a cycle.

**Exempt infra**: paths that are not page navigations at all.

- Fixed assets: `/app.js`, `/styles.css`, `/honeycomb-memory-cluster.svg`. The exempt screens are the same SPA bundle, so the bundle must load even for a visitor the gate just redirected.
- Prefixes: `/api/`, `/setup/`, `/fonts/`. Data-plane traffic belongs to the BFF proxy, which handles its own requests untouched; gating it would break same-origin `/setup/*` flows and add a redirect surface to an API.
- `/health`, conditionally: see below.

**The `/health` double duty.** `/health` is both hive's machine-liveness probe (doctor polls it; monitoring polls it) and the operator-facing health page in the SPA. The gate and `server.ts` make the identical content-negotiation call: a request whose `Accept` header includes `text/html` is a page navigation (gated, served the SPA shell); anything else is a probe (bypasses the gate, gets the liveness JSON `{ status, uptimeMs, version }`). The two code paths cite each other so they stay in lockstep.

#### Redirect semantics

Every redirect the gate issues is a `302` to a hard-coded literal, `/buzzing` or `/login`. No `?next=` parameter, no `Referer` echo, no request path reflected anywhere. There is structurally no code path where attacker-influenced input reaches `c.redirect`, which is the whole open-redirect defense: it is not validated away, it is absent. The auth fetch is also tied to the incoming request's abort signal (`c.req.raw.signal`), so a client disconnect aborts the upstream `/setup/state` call instead of pinning it, and an abort reads as fail-closed.

Once `/buzzing` observes readiness it hard-navigates to `/` rather than swapping screens client-side, so the server gate re-evaluates health and auth on a fresh request and routes the operator to the dashboard or `/login`, whichever the now-current state calls for.

#### The full route table

Registration order in `createHive` (`src/daemon/server.ts`) is the authority; Hono serves the first matching handler.

| Order | Route | Handler | Gated? |
|---|---|---|---|
| 1 | `*` (middleware) | `createPortalGate` | is the gate |
| 2 | `GET /app.js`, `GET /styles.css`, `GET /honeycomb-memory-cluster.svg`, `GET /fonts/:name` | `mountDashboardAssets` (host.ts) | no (infra) |
| 3 | `GET /health` | liveness JSON, or the SPA shell when `Accept` includes `text/html` | probe: no; page: yes |
| 4 | `GET /api/fleet-status` | `fetchFleetStatus` projection of doctor's status page | no (`/api/` prefix) |
| 5 | `GET /api/registered-services` | `resolveRegisteredServiceNames` from doctor's registry file | no |
| 6 | `GET /api/telemetry/stream` | `createTelemetryStreamHandler`, the SSE relay of doctor's `/events` | no |
| 7 | `ALL /api/*`, `ALL /setup/*` | `createApiProxy` (BFF, honeycomb or nectar) | no |
| 8 | `GET *` | `mountDashboardShellFallback`: the SPA shell for every page path | yes |

The shell catch-all serves one byte-identical shell for every authorized path (`/`, `/projects`, `/harnesses`, `/memories`, `/graph`, `/hive-graph`, `/sync`, `/logs`, `/health`, `/roi`, `/settings`, plus `/buzzing`, `/login`, and any unknown deep link). The bundle self-hydrates from `location.pathname`: `resolveBootScreen` mounts `BuzzingScreen`, `LoginScreen`, or the `Shell`, and inside the shell `usePathRoute` (`router.tsx`) plus `matchRoute` (`registry.tsx`) resolve the specific page, with unknown paths falling back to the Dashboard entry rather than a blank screen. Client navigation uses `history.pushState` and a broadcast `hive:pathchange` event; there is no react-router and no new dependency.

#### Implementation status

PRD-003 (gate, `/login` device-flow screen, hash-to-path migration) is shipped and QA-verified on main, covered by `tests/daemon/gate.test.ts`, `tests/dashboard/boot-route.test.ts`, `tests/dashboard/router.test.tsx`, and `tests/dashboard/login-screen.test.tsx`, and exercised in live cold-boot and logged-out scenarios. The `/buzzing` content (PRD-004) and the health rail and `/health` page (PRD-005) are shipped alongside it; see ../frontend/buzzing-and-health-rail.md for the full health-surface detail. The gate behavior des

### Shared Contracts And Routing

Read this if you touch anything under `src/shared/`, or if you need to know how a URL path becomes a decision about which daemon owns it: this is the contract layer every other hive module builds on, and the place the fleet-wide pinned contracts land in hive.

#### Why a shared layer exists at all

`src/shared/` is the set of modules that both the node server and the browser bundle import. That dual-consumption is the whole reason the directory is separate: `constants.ts` pins the port that `server.ts` binds and that `wire.ts` never needs to know, `service-status.ts` derives the same five bee states whether the SSE model or the coarse REST row produced the signal, and `fleet-telemetry.ts` is a hand-kept copy of doctor's wire shape that has to compile in a browser and in Node. Nothing here reaches for `node:fs` or the DOM, because a module that both sides import cannot depend on either side's runtime.

The layer is also where the fleet's three pinned cross-daemon contracts surface inside hive. The superproject's `library/ledger/EXECUTION_LEDGER.md` pins Contracts A, B, and C in writing so honeycomb, nectar, and hive could all build against them in parallel without waiting on doctor's code to exist. Hive consumes two of the three: Contract A (the extended registry entry) through `registry.ts`, and Contract C (the doctor-to-hive SSE event shape) through `fleet-telemetry.ts`. Contract B (the per-service SQLite schema) is doctor's and each workload's business; hive only ever sees its projection arrive over Contract C.

#### The routing rule: one prefix, two daemons

Every dashboard read has exactly one owning daemon, and the ownership rule is a single function in `src/shared/daemon-routing.ts`. Nectar owns the hive-graph surface; honeycomb owns everything else.

```typescript
const HIVE_GRAPH_PREFIX = "/api/hive-graph";

export function resolveEndpointOwner(endpointPath: string): DaemonName {
  return endpointPath === HIVE_GRAPH_PREFIX || endpointPath.startsWith(`${HIVE_GRAPH_PREFIX}/`)
    ? "nectar"
    : "honeycomb";
}
```

`DaemonName` is `keyof typeof DEFAULT_DAEMON_BASES`, and the default bases are the only two workload daemons hive proxies to:

```typescript
export const DEFAULT_DAEMON_BASES = Object.freeze({
  honeycomb: "http://127.0.0.1:3850",
  nectar: "http://127.0.0.1:3854"
} as const);
```

This is a deliberately blunt rule. There is no per-endpoint registry, no wildcard table, no config file: a path is nectar's if and only if it is `/api/hive-graph` or begins with `/api/hive-graph/`, and honeycomb's otherwise. Adding a third workload daemon means teaching `resolveEndpointOwner` one more prefix and adding one more base; the proxy, the gate, and the wire all inherit the routing for free because they all call this one function.

```mermaid
flowchart TD
    path["endpointPath from the request URL"] --> check{"== /api/hive-graph<br/>or startsWith /api/hive-graph/ ?"}
    check -->|"yes"| nectar["owner = nectar<br/>base http://127.0.0.1:3854"]
    check -->|"no"| honeycomb["owner = honeycomb<br/>base http://127.0.0.1:3850"]
```

#### The loopback trust boundary lives here

`daemon-routing.ts` also owns the one hostname allow-list the whole server tier defends against SSRF with. The trusted set is exactly four names:

```typescript
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function isLoopbackBaseUrl(baseUrl: string): boolean {
  try {
    return LOOPBACK_HOSTNAMES.has(new URL(baseUrl).hostname);
  } catch {
    return false;
  }
}
```

Every server-side fetch in the codebase (the proxy, the gate's auth check, the fleet-status fetch, the SSE relay) re-checks its resolved target with `isLoopbackBaseUrl` immediately before firing. A URL that does not parse returns `false`, so a garbage base fails closed. The rationale is documented right in the source: hive forwards request bodies that can carry captured session and memory content, so a base that points off-machine would be an exfiltration primitive. `normalizeBaseUrl` and `normalizeDaemonBases` round out the module, trimming trailing slashes and filling absent daemons from the defaults so downstream code always sees a complete `DaemonBases` record. The full boundary picture is in ../security/trust-boundaries.md; this module is where the predicate itself is defined.

#### Constants: the pins with no env override

`src/shared/constants.ts` is short on purpose. The host, port, and doctor URLs are hard-pinned literals with no environment-variable path, which is a security decision as much as a simplicity one: there is no operator surface that can move the listener off loopback or point the relay at another host.

```typescript
export const HIVE_HOST = "127.0.0.1" as const;
export const HIVE_PORT = 3853 as const;
export const HIVE_VERSION = packageJson.version;
export const DOCTOR_STATUS_URL = "http://127.0.0.1:3852/status.json" as const;
export const DOCTOR_EVENTS_URL = "http://127.0.0.1:3852/events" as const;
export const HONEYCOMB_HOME_DIR = join(homedir(), ".honeycomb");
export const HIVE_PID_PATH = join(HONEYCOMB_HOME_DIR, "hive.pid");
export const HIVE_LOCK_PATH = join(HONEYCOMB_HOME_DIR, "hive.lock");
```

`HIVE_VERSION` reads straight off `package.json`, so the liveness probe, the telemetry payload, and the release guard all report one number. `HONEYCOMB_HOME_DIR` is the shared `~/.honeycomb` directory hive co-locates its state in; the full on-disk story is in ../operations/on-disk-footprint.md.

#### Fleet readiness: one predicate, three callers

`src/shared/fleet-readiness.ts` defines what "the fleet is ready" means, and it means the same thing to the landing gate, the `/buzzing` dismissal poll, and any future caller. The predicate is strict: the supervisor must be reachable, doctor's coarse health must be exactly `ok`, and every required peer must report `ok`.

```typescript
export const V1_REQUIRED_PEERS = ["honeycomb"] as const;

export function isFleetReady(status: FleetStatusResponse): boolean {
  if (status.supervisor !== "reachable") return false;
  if (status.health !== "ok") return false;
  return V1_REQUIRED_PEERS.every((name) =>
    status.daemons.some((daemon) => daemon.name === name && daemon.health === "ok")
  );
}
```

`degraded` blocks exactly like `unreachable`; only `ok` passes. Nectar is not in `V1_REQUIRED_PEERS`, so a down nectar does not send an operator to `/buzzing`; its row is display-only until a shipped page hard-depends on it. `FleetStatusResponse` is a discriminated union on `supervisor`: the reachable arm carries `health`, a `daemons` array, and `asOf`; the unreachable arm carries only an empty `daemons` tuple, which is the fail-soft shape `fetchFleetStatus` returns when doctor cannot be reached. That derivation happens in `src/daemon/fleet-status.ts`; readiness is defined in shared so both server and any client consumer agree on it.

#### Service status: the five-state derivation

`src/shared/service-status.ts` turns a raw health signal into one of five locked bee states, and it is source-agnostic by construction. Both the rich SSE `FleetServiceModel` and the coarse REST daemon row normalize into the same `ServiceSignal` first, so the same condition always yields the same state regardless of which feed reported it.

```typescript
export const SERVICE_STATES = ["error", "degraded", "starting", "warming", "active"] as const;
export type ServiceState = (typeof SERVICE_STATES)[number];

export interface ServiceSignal {
  readonly health: FleetHealth;                        // "ok" | "degraded" | "unreachable" | "unknown"
  readonly lastSeen: string | null;                    // ISO-8601, null on the coarse REST feed
  readonly telemetryFault: TelemetryFaultReason | null; // "missing" | "locked" | "malformed" | "read-error"
}

export function deriveServiceState(input: ServiceDerivationInput): ServiceState;
export function nextFirstActiveAt(health: FleetHealth, previous: number | null, now: number): number | null;
```

The rule order inside `deriveServiceState` is: no signal at all is `starting`; a per-service telemetry fault is `degraded` (isolated, never contagious); `unreachable` health or a `lastSeen` staler than the stale window is `error`; `degraded` health is `degraded`; `unknown` health is `starting`; `ok` is `warming` inside the grace window and `active` after it. The function is per-service by construction: it never reads a sibling's state, which is exactly what makes "one bad service flips only its own tile" a property rather than a promise. The consuming UI (the `/buzzing` tiles, the health rail, the `/health` page) is documented in ../frontend/fleet-telemetry-client.md and ../frontend/buzzing-and-health-rail.md.

#### Fleet telemetry: Contract C, hand-kept

`src/shared/fleet-telemetry.ts` is hive's copy of doctor's `src/telemetry/schema.ts`, the SSE wire shape pinned as Contract C. Hive does not depend on the doctor npm package (each fleet member is its own package), so this module is a browser-and-server-safe hand-kept copy that must stay in lockstep if doctor's schema ever changes. It exports the shape and a defensive parser:

```typescript
export const FLEET_TELEMETRY_EVENT_NAME = "fleet-telemetry" as const;

export interface FleetTelemetryEvent {
  readonly asOf: string;
  readonly services: readonly FleetServiceModel[];
  readonly logs: readonly FleetLogEntry[];
}

export function parseFleetTelemetryEvent(raw: string): FleetTelemetryEvent | null;
```

The load-bearing design choice is that `metrics` is typed `Readonly>`, not a fixed shape. Honeycomb ships three counters (`actionsTaken`, `filesProcessed`, `memoriesCreated`) and nectar ships five (`filesRegistered`, `nectarsMinted`, `descriptionsGenerated`, `hiveGraphVersions`, `embeddingsComputed`), and nothing in hive hardcodes either set. Every reader is schema-tolerant, so a workload can add a counter and hive's `/health` page renders it with no code change. `parseFleetTelemetryEvent` returns `null` on anything malformed rather than throwing, so one bad SSE frame never crashes the consuming hook. `FleetServiceModel` carries `name`, `health`, `lastSeen`, `metrics`, a nullable `deeplake` block, and a nullable `telemetryFault`; `FleetLogEntry` is `{ service, ts, level, message }`, and the event's `logs` field is a bounded slice of only the rows new since the previous tick, never a history.

#### Copied contract types

Two shared modules exist purely so that copied-verbatim pages keep their imports byte-identical. `src/shared/lifecycle-flags.ts` and `src/shared/memory-types.ts` came over from honeycomb with the dashboard so that `settings.tsx` and `memories.tsx` did not have to be edited on copy; they are part of the copy-and-own transfer documented in copy-and-own-provenance.md. They are contract-shaped (enumerations and record types the pages branch on) rather than behavioral, and they carry no server logic.

#### The maintenance contract

The shared layer has exactly one standing obligation to another repo: `fleet-telemetry.ts` mirrors doctor's `schema.ts` (Contract C), so if doctor's SSE shape changes, this copy must be updated deliberately. The parse is zod-defensive either way, so a drift degrades to empty rather than crashing, but a silently stale copy would drop fields the UI could otherwise render. Everything else in `src/shared/` is hive's own and moves only when hive's own code moves. `tests/shared/service-status.test.ts` and `tests/shared/fleet-telemetry.test.ts` pin the derivation and the parse; `tests/wire/federation.test.ts` pins `resolveEndpointOwner`'s ownership split.

### Doctor Registration And Lifecycle

Read this if you operate hive or touch `src/lock.ts`, `src/install/registry.ts`, or `src/service/`: it covers the single-instance guard, the OS service units, registration with doctor, and what uninstall does and honestly does not do.

#### The CLI surface

Four verbs, dispatched in `src/cli.ts`, implemented in `src/cli-commands.ts`:

```
hive start                # run the daemon on 127.0.0.1:3853 (the default verb)
hive install-service      # write + start the OS unit, then register with doctor
hive uninstall-service    # deregister + remove the OS unit (registry entry stays; see below)
hive register             # upsert hive's entry into doctor's registry, standalone
```

Each verb also fires one fail-soft lifecycle telemetry event through `src/telemetry/emit.ts` (`hive_installed`, `hive_uninstalled`, `hive_first_run`, `hive_updated`); a telemetry failure never changes a verb's exit code. See ../infrastructure/build-and-release.md for the chokepoint details.

#### Single-instance guard

`startHive` acquires the lock before the socket, in `acquireSingleInstanceLock` (`src/lock.ts`):

1. Open `~/.honeycomb/hive.lock` with the `wx` flag (exclusive create). Success means we own the instance; write our PID into the lock file and mirror it to `~/.honeycomb/hive.pid`.
2. On `EEXIST`, read the PID out of the existing lock and probe it with `process.kill(pid, 0)`. A live process (including `EPERM`, which means "alive but not ours") throws `DaemonAlreadyRunningError`, and the second `hive start` exits 1 with `hive is already running (pid N) and holds lock ...`.
3. A dead PID means a stale lock (crash, power loss): remove it and retry the exclusive create exactly once. Losing that race to another starter also throws `DaemonAlreadyRunningError`.

`stop()` (and signal handlers for SIGINT/SIGTERM) closes the server and releases both files. The lock is PID-probe based, not flock-based, which is what lets a crashed daemon's lock be reclaimed without manual cleanup. `tests/lock.test.ts` covers acquisition, stale reclaim, and the race.

The `pidPath` in doctor's registry entry points at the same `hive.pid`, so the supervisor and the lock agree on which process is "the" hive.

#### OS service unit

`hive install-service` resolves a per-platform plan (`src/service/platform.ts`), renders the unit (`src/service/templates.ts`), writes it, and runs the manager commands (`src/service/commands.ts`) through `execFile` (argv arrays, no shell, 15 s timeout per command).

| Platform | Manager | Unit name | Unit path |
|---|---|---|---|
| macOS | launchd (user domain `gui/`) | `com.legioncode.hive` | `~/Library/LaunchAgents/com.legioncode.hive.plist` |
| Linux | systemd (user) | `hive.service` | `~/.config/systemd/user/hive.service` |
| Windows | schtasks | task `hive` | XML staged at `~/.honeycomb/hive/hive-task.xml` |

All three units run `node  start` and encode restart-on-crash plus start-on-boot/login: launchd sets `RunAtLoad` + `KeepAlive` with a 5 s `ThrottleInterval` (stdout/stderr to `~/.honeycomb/hive/launchd.*.log`); systemd sets `Restart=always`, `RestartSec=5`, `StartLimitIntervalSec=0`, `WantedBy=default.target`; the Windows task uses a `LogonTrigger`, `RestartOnFailure` every `PT1M` up to 999 times, and `MultipleInstancesPolicy: IgnoreNew` (the OS-level echo of the PID lock).

**Legacy migration (decision #32).** Hive shipped briefly under the name `thehive` (`thehive` launchd label, `thehive.service`, Windows task `thehive`). Every install now begins by best-effort deregistering those legacy units and deleting their unit files (`legacyUninstallCommands`, `legacyUnitPath`), so a re-run migrates an old install instead of leaving two units racing over one daemon. When no legacy unit exists the commands fail harmlessly and the install proceeds.

#### Idempotent doctor registration

After the unit is installed (or standalone via `hive register`), `registerHiveWithDoctor` (`src/install/registry.ts`) upserts hive's entry into `~/.honeycomb/doctor.daemons.json`:

```typescript
export function buildHiveRegistryEntry(): RegistryDaemonEntry {
  return {
    name: HIVE_REGISTRY_NAME,                       // "hive"
    healthUrl: HIVE_REGISTRY_HEALTH_URL,            // "http://127.0.0.1:3853/health"
    pidPath: HIVE_REGISTRY_PID_PATH,                // "~/.honeycomb/hive.pid"
    probeIntervalMs: HIVE_REGISTRY_PROBE_INTERVAL_MS,          // 30_000
    startupGraceMs: HIVE_REGISTRY_STARTUP_GRACE_MS,            // 60_000
    restartGiveUpThreshold: HIVE_REGISTRY_RESTART_GIVE_UP_THRESHOLD, // 3
    restartCooldownMs: HIVE_REGISTRY_RESTART_COOLDOWN_MS       // 5_000
  };
}
```

The write is read-modify-write with real idempotence: an existing `name: "hive"` entry is merged in place (`{ ...existing, ...hiveEntry }`, preserving any extra keys doctor added), a missing one is appended, and every other daemon's entry is left byte-for-byte alone. The file is written atomically: serialize to `doctor.daemons.json.tmp--`, then `rename` over the original, with the temp file removed on a failed rename. A corrupt or missing registry parses to an empty document rather than an error, so registration works on a box where doctor has never run. No doctor restart is required; doctor picks the entry up from the file. `tests/install/registry.test.ts` pins the upsert, the merge, and the atomicity.

#### Uninstall: what it does and does not do

`hive uninstall-service` runs the manager's deregister command (`launchctl bootout` / `systemctl --user disable --now` / `schtasks /Delete`) and removes the unit file. The daemon stops and will not start on next boot.

**It does NOT deregister hive from doctor's registry.** There is no registry-removal code anywhere in the package; `runUninstallServiceCommand` touches only the service module. After an uninstall, doctor still carries hive's entry, still probes `http://127.0.0.1:3853/health` every 30 seconds, and will report hive as unreachable (and, depending on doctor's remediation config, may try to restart a process that no longer has a unit). If you want doctor to forget hive, edit `~/.honeycomb/doctor.daemons.json` by hand today. This asymmetry is a known, honest gap, not a documented feature.

#### Boot order and lifecycle

Hive is deliberately not gated on any peer at boot. The OS starts doctor and hive independently; hive binds and serves its shell immediately, and whatever the fleet looks like is rendered honestly by the landing gate (`/buzzing` while doctor or honeycomb are still coming up). Doctor's `startupGraceMs: 60_000` gives hive a minute after boot before missed probes count against the restart threshold (3 strikes, 5 s cooldown between restarts).

```mermaid
sequenceDiagram
    participant OS as OS service manager
    participant D as doctor :3852
    participant H as hive :3853
    participant B as Browser

    OS->>D: start (own unit)
    OS->>H: start (com.legioncode.hive / hive.service / task "hive")
    H->>H: acquire ~/.honeycomb/hive.lock, write hive.pid
    H->>H: bind 127.0.0.1:3853, serve shell
    D->>H: GET /health every 30s (registry entry)
    B->>H: GET / (gate: fleet not ready yet)
    H-->>B: 302 /buzzing
    Note over D,H: workloads come up; doctor reports fleet ok
    B->>H: GET /buzzing poll observes ready, hard-navigates /
    H-->>B: dashboard
```

There is no ordering dependency between hive and the workload daemons at all: the gate and the fail-soft proxy absorb every combination of who is up first.

### Copy-And-Own Provenance: Where The Dashboard Came From

Read this if you need to know which hive file came from which honeycomb file, what was changed in transit, and why there is deliberately no shared package or fork to keep in sync.

#### The story in one paragraph

Nectar ADR-0004 originally said hive would reuse honeycomb's dashboard "by runtime import". Two facts killed that mechanism: hive became its own repository (you cannot import another repo's internal module at runtime across a submodule boundary), and honeycomb's dashboard was being retired anyway (there would be nothing left to import). Hive ADR-0001 replaced the mechanism with two coupled decisions: honeycomb stops serving the dashboard (Decision A), and hive copies the `honeycomb/src/dashboard/web/` subtree once and owns it outright (Decision B). Because the source copy was deleted in the same program, this is an ownership transfer, not a fork. There is exactly one live dashboard codebase, and it lives here.

#### What was copied, what was adapted, what was retired

Of the 36 files that lived under `honeycomb/src/dashboard/**` at cutover:

- **24 copied verbatim**: the origin-agnostic shell/infra files and the page components. They were already portable because every page takes `PageProps` and hydrates through an injected `wire` client; nothing in them knew which daemon served the bundle.
- **4 copied with modification**: `wire.ts` (federation model changed, see below), `app.tsx`, `main.tsx`, `setup-gate.tsx` (boot and gating model changed).
- **1 copied partially**: `contracts.ts`. Hive took only the web-consumed ROI view-model types that `wire.ts` imports; the daemon-side contract machinery stayed in honeycomb.
- **2 adapted daemon-side files**: honeycomb served the bundle in-process; hive needed its own Hono host. `host.ts` and `web-assets.ts` were adapted rather than copied clean.
- **7 stayed in honeycomb**: the ViewBlock/TUI dashboard layer (`dashboard.ts`, `views.ts`, `html.ts`, `launch.ts`, `logs.ts`, `contracts.ts`, `index.ts` plus `CONVENTIONS.md`), which powers the `honeycomb dashboard` CLI and is out of scope for the web portal.

#### Concrete file mapping

Verified against both trees. Honeycomb's `src/dashboard/web/` no longer exists (deleted at cutover, Wave 5 of the PRD-001 execution ledger); the honeycomb paths below are the pre-deletion sources.

| honeycomb source | hive destination | Disposition |
|---|---|---|
| `src/dashboard/web/registry.tsx` | `src/dashboard/web/registry.tsx` | Verbatim, later extended (path routes, `/health`, `/hive-graph`) |
| `src/dashboard/web/router.tsx` | `src/dashboard/web/router.tsx` | Verbatim at copy; rewritten by PRD-003c (hash to path) |
| `src/dashboard/web/sidebar.tsx`, `page-frame.tsx`, `panels.tsx`, `primitives.tsx`, `scope-context.tsx`, `needs-project.tsx`, `folder-picker.tsx`, `harness-strip.tsx`, `build-graph-button.tsx`, `graph-layout.ts` | same paths under `src/dashboard/web/` | Verbatim |
| `src/dashboard/web/pages/*.tsx` (dashboard, projects, harnesses, memories, graph, sync, logs, roi, roi-chart, settings, coming-soon, lifecycle-panel) | `src/dashboard/web/pages/*.tsx` | Verbatim |
| `src/dashboard/web/wire.ts` | `src/dashboard/web/wire.ts` | Modified: single-origin, then briefly client-federated, now same-origin against hive's BFF proxy (ADR-0002) |
| `src/dashboard/web/app.tsx` | `src/dashboard/web/app.tsx` | Modified: hive shell concerns (health rail mount, path router) |
| `src/dashboard/web/main.tsx` | `src/dashboard/web/main.tsx` | Modified: boot entry, now a pure path-keyed screen lookup (`boot-route.ts`) |
| `src/dashboard/web/setup-gate.tsx` | `src/dashboard/web/setup-gate.tsx` | Modified: the nested React gate became the `/login` screen (`LoginScreen`) |
| `src/dashboard/contracts.ts` | `src/dashboard/contracts.ts` | Partial: web-consumed ROI types only |
| `src/daemon/runtime/dashboard/host.ts` | `src/daemon/dashboard/host.ts` | Adapted: serves at `/` not `/dashboard`; shell catch-all split out for the gate |
| `src/daemon/runtime/dashboard/web-assets.ts` | `src/daemon/dashboard/web-assets.ts` | Adapted: font route prefix `/fonts/`, bundle name `app.js` |
| `assets/styles.css`, `assets/tokens/*`, `assets/logos/honeycomb-memory-cluster.svg` | `assets/` (same relative layout) | Copied |
| `src/shared/lifecycle-flags.ts`, `src/shared/memory-types.ts` | `src/shared/` | Copied so two verbatim pages (`settings.tsx`, `memories.tsx`) keep their relative imports byte-identical |

`tests/dashboard/copy-map.test.ts` pins the completeness claim mechanically: it counts exactly 36 files under `src/dashboard/web/` and asserts the presence of every shell/infra file by name. The count grew from the original 28 copied files because hive has since added its own natives: `buzzing-screen.tsx`, `service-icons.tsx`, `use-fleet-telemetry.ts`, `health-rail.tsx`, `boot-route.ts`, `pages/health.tsx`, `pages/hive-graph.tsx`, `hive-graph-projection.ts`. Those are hive-born, not copied; the test comments mark which is which.

#### What honeycomb retired

At cutover honeycomb deleted, in one wave, everything that made it a dashboard server:

- The unprotected `/` SPA mount in `honeycomb/src/daemon/runtime/assemble.ts` (the local-mode block now mounts only the setup API routes: `/setup/login`, `/setup/state`, `/setup/migrate-from-hivemind`).
- The 28-file `src/dashboard/web/` subtree, `src/daemon/runtime/dashboard/host.ts`, and `web-assets.ts`.
- The dashboard-web bundle entry in `honeycomb/esbuild.config.mjs`.
- The dashboard CORS middleware (removed by ADR-0002 once the browser stopped issuing cross-origin requests to honeycomb at all).

Honeycomb kept its entire data plane: `/health`, every `/api/*` group, and the setup routes, because hive proxies all of them. It also kept the non-web TUI dashboard layer. `honeycomb install` and its `openDashboard` helper now point operators at `http://127.0.0.1:3853/`.

The cutover sequencing constraint in ADR-0001 (hive must serve before honeycomb drops `/`, so operators are never dashboard-less) was honored: hive's Waves 1-4 landed and were verified before the honeycomb deletion wave ran.

#### Auditing the provenance yourself

The claims above are mechanically checkable, and you should re-check them after any large refactor rather than trusting this doc:

```bash
# The copy-map completeness pin (fails if a file is added/removed without updating the map):
npx vitest run tests/dashboard/copy-map.test.ts

# Honeycomb no longer has a web dashboard tree (expect: no such directory):
ls ../honeycomb/src/dashboard/web

# Honeycomb kept its TUI layer and data plane (expect: dashboard.ts, views.ts, html.ts, ...):
ls ../honeycomb/src/dashboard

# Hive holds no Deeplake client (expect: no matches):
grep -ri "deeplake" src --include="*.ts" -l | grep -v "shared/fleet-telemetry"
```

The last check has one legitimate near-miss: `fleet-telemetry.ts` mentions Deeplake because doctor's telemetry carries per-service Deeplake connection stats that the health page renders. Rendering another daemon's stats is not holding a client.

#### The divergence policy going forward

There is no sync obligation, because there is nothing to sync with. Honeycomb has no web dashboard; future dashboard improvements happen in hive and only in hive. Three seams remain and are the whole maintenance contract:

1. **`contracts.ts` ROI shapes.** Hive carries a partial copy of honeycomb's view-model types. If honeycomb changes an ROI view-model shape, hive's zod schemas in `wire.ts` degrade fail-soft (empty state, never a React throw), but the copy should be updated deliberately. This is the one place a honeycomb change can silently stale a hive type.
2. **The wire endpoint contract.** `wire.ts` validates what honeycomb's and nectar's `/api/*` routes actually return. Endpoint changes on a workload daemon are API contract changes and get coordinated like any API change, not like shared UI code.
3. **`src/shared/fleet-telemetry.ts`** is a hand-kept copy of doctor's SSE wire shape (doctor `src/telemetry/schema.ts`, Contract C in the execution ledger). Keep it in lockstep if doctor's schema ever changes; the parse is zod-defensive either way.

Everything else in the copied tree is hive's to refactor without asking anyone.

```mermaid
flowchart LR
    subgraph honeycombBefore["honeycomb (before)"]
        mount["/ SPA mount"] --> webTree["src/dashboard/web/ (28 files)"]
        dataPlane["/api/* + /health + /setup/*"]
    end
    subgraph hiveAfter["hive (after)"]
        hiveWeb["src/dashboard/web/ (36 files, owned)"]
        hiveHost["src/daemon/dashboard/host.ts + web-assets.ts"]
        proxy["BFF proxy /api/* /setup/*"]
    end
    webTree -->|"one-time copy, then source deleted"| hiveWeb
    proxy -->|"loopback"| dataPlane
```

### Trust Boundaries

Read this before changing anything that fetches, redirects, serves a file, or forwards a header: it maps hive's trust boundaries and the invariants that keep the portal from becoming the fleet's weakest link.

#### The trust map

```mermaid
flowchart TD
    subgraph untrusted["Least trusted: browser context"]
        browser["Browser + bundled SPA"]
    end
    subgraph hiveTier["hive server :3853 (the chokepoint)"]
        gate["Landing gate<br/>health then auth"]
        proxy["BFF proxy<br/>/api/* /setup/*"]
        relay["SSE relay<br/>/api/telemetry/stream"]
        host["Asset host<br/>fixed paths + allow-lists"]
    end
    subgraph loopback["Loopback peers (trusted per-request, verified anyway)"]
        honeycomb["honeycomb :3850"]
        nectar["nectar :3854"]
        doctor["doctor :3852"]
    end
    subgraph disk["Local disk inputs (treated as tamperable)"]
        registry["~/.honeycomb/doctor.daemons.json"]
    end
    browser -->|"same-origin only"| gate
    browser --> proxy
    browser --> relay
    browser --> host
    proxy -->|"loopback-pinned, redirect: error"| honeycomb
    proxy --> nectar
    gate -->|"status.json + /setup/state"| doctor
    gate --> honeycomb
    relay -->|"/events, fixed constant URL"| doctor
    registry -.->|"zod-parsed, loopback-filtered"| proxy
```

#### Loopback binding

Hive binds `127.0.0.1:3853`, hard-pinned in `src/shared/constants.ts` with no env override. Nothing off-machine can reach the portal, and hive itself refuses to talk to anything off-machine: every server-side fetch target is either a fixed loopback constant (`DOCTOR_STATUS_URL`, `DOCTOR_EVENTS_URL`) or a registry-derived base filtered through `isLoopbackBaseUrl` (`src/shared/daemon-routing.ts`), whose trusted hostname set is exactly `127.0.0.1`, `localhost`, `::1`, `[::1]`.

#### The proxy is the single auth chokepoint

Every byte of dashboard data crosses one seam: the BFF proxy in `src/daemon/proxy.ts` (plus its two specialized siblings, the fleet-status fetch and the SSE relay). That concentration is the design. There is one place to audit header handling, one place to pin redirects, one place where the loopback decision is made, and it lives on the server tier that already owns the registry, not in the browser.

**Hive never mints or stores workload credentials.** Verified in code: there is no token generation, no credential file read or write, no session store, and no injected auth header anywhere under `src/`. The proxy forwards the browser's own headers verbatim (minus a fixed hop-by-hop strip set) and the response back (minus framing headers fetch already consumed). "Logged in" is honeycomb's `/setup/state` `authenticated` bit, which reflects the presence of `~/.deeplake/credentials.json`; hive reads the bit through the same proxy path and holds nothing. An always-on process that stores no secret has no secret to leak, which is precisely why ADR-0002 rejected giving hive a service credential.

Header handling, exactly:

- Request strip set: `host`, `connection`, `keep-alive`, `proxy-authenticate`, `proxy-authorization`, `te`, `trailer`, `transfer-encoding`, `upgrade`, `content-length`.
- Response strip set: the hop-by-hop set plus `content-encoding` and `content-length` (fetch decompressed the body; the original framing would lie).
- Nothing is added in either direction.

#### SSRF defense in depth

The registry file on disk is treated as tamperable input, because it is one: any local process in the user's account can edit `~/.honeycomb/doctor.daemons.json`. Three independent layers keep a tampered registry from turning the proxy into an exfiltration primitive for the session/memory bodies it forwards:

1. **Parse-time filter**: `baseUrlFromHealthUrl` (`src/daemon/registry.ts`) drops any entry whose `healthUrl` host is not loopback before it can become a daemon base. Corrupt JSON parses to defaults, never a throw.
2. **Use-time re-check**: the proxy, the setup-auth fetch, the fleet-status fetch, and the SSE relay each re-verify their resolved target with `isLoopbackBaseUrl` immediately before fetching, so no future refactor of base resolution can silently bypass the guard.
3. **Redirect pinning**: every server-side fetch sets `redirect: "error"`. Native fetch follows 3xx by default and the loopback check only validates the first hop, so without the pin a compromised loopback listener could redirect hive's request (headers and body included) to an external origin. With it, any redirect rejects the fetch, which degrades fail-soft.

This exact class of bug is hive's security history: the PRD-001 audit found and fixed the missing loopback gate (High), and the PRD-002 audit found and fixed the missing redirect pin on the doctor status fetch (Medium). Both reports live under the PRD `qa/` folders.

#### What the landing gate protects

The gate (`src/daemon/gate.ts`) is a UX authority more than a hard authorization boundary, and it is important to be honest about which. It guarantees a logged-out or unhealthy visitor never receives dashboard chrome: the server decides `/buzzing` vs `/login` vs the page before anything renders. Its own hardening:

- **No open redirect, structurally.** Both redirect targets are hard-coded literals. No `?next=`, no `Referer` echo, no path reflection; there is no code path where attacker-influenced input reaches `c.redirect`.
- **Fail-closed auth.** Any failure of the `/setup/state` read (network, non-OK, bad JSON, schema mismatch, client abort) resolves to "not logged in" and redirects to `/login`. A transient fault can never fail-soft an unauthenticated visitor into the dashboard.
- **No gate on the data plane.** `/api/*` and `/setup/*` bypass the gate by design; their protection is the workload daemons' own loopback + session posture, passed through transparently. The gate protects screens; the daemons protect data. Requests to the data plane are loopback-only in the first place because hive binds loopback.

#### The asset surface

The static host serves fixed paths only. The one parameterized route, `GET /fonts/:name`, matches against a frozen allow-list of six filenames; anything else, including any traversal attempt, is `null` and 404s, because the name is never joined to a path unless it is a known leaf filename. The shell HTML carries no inline data, no token, and no third-party reference; the bundle is compiled at build time (no in-browser Babel, no CDN script). `main.tsx` sanitizes the one DOM-read value (`data-asset-base`) against `/^[A-Za-z0-9._/-]*$/` before it can flow into an asset URL, closing the DOM-text-to-sink taint path even though the host, not the user, writes that attribute.

#### Telemetry egress

The only outbound-to-internet call hive can ever make is the lifecycle telemetry POST in `src/telemetry/emit.ts`, and it is fenced: a closed five-key property allow-list (`package`, `version`, `os`, `arch`, `node`; no hostname, no paths), a build-injected public write-only PostHog key that compiles to hard-disabled when unset, `HONEYCOMB_TELEMETRY=0` / `DO_NOT_TRACK` opt-outs, a dedupe ledger, and a 2 s bounded fire-and-forget POST that never throws and never alters an exit code. See ../infrastructure/build-and-release.md.

#### The invariants, as a review checklist

If a PR touches the server tier, check the diff against these. Every one of them is currently true and tested; breaking any of them is a security regression, not a style call.

- [ ] Hive binds `127.0.0.1` only; no listener gains an env-configurable host or port.
- [ ] Every server-side fetch target is a fixed loopback constant or passes `isLoopbackBaseUrl` at the point of use.
- [ ] Every server-side fetch pins `redirect: "error"` (proxy, gate auth, fleet status, SSE relay).
- [ ] The proxy adds no header in either direction; strip sets only grow deliberately.
- [ ] No code path stores, mints, or logs a credential; `grep -ri "authorization" src` should keep returning only the hop-by-hop strip entries.
- [ ] Gate redirects remain hard-coded literals; no request-derived value reaches `c.redirect`.
- [ ] The auth check stays fail-closed: every new failure mode of `fetchSetupAuthenticated` resolves `false`.
- [ ] Parameterized asset routes stay allow-listed; no user-supplied string is path-joined.
- [ ] Telemetry properties stay inside the closed five-key allow-list; no free-form property path is introduced.
- [ ] Service-manager invocations stay `execFile` with argv arrays; no shell string interpolation.

#### Known gaps, stated plainly

- The registry file's permissions are not tightened by hive (documented Low in the PRD-001 audit); the loopback filter is the compensating control.
- Unauthenticated loopback GETs (`/health`, `/api/fleet-status`, `/api/registered-services`) expose coarse fleet metadata to any local process. Accepted: it is health data, on loopback, in the user's own account.
- `hive uninstall-service` leaves the doctor registry entry behind (see ../architecture/doctor-registration-and-lifecycle.md); stale registry entries are an operational wart, not a privilege issue.

### ADR-0001, retire honeycomb's dashboard and copy-and-own it into hive

#### Context

The three-daemon topology (nectar `ADR-0003`) and hive's role (nectar `ADR-0004`) were recorded while hive was still framed as a package **inside the honeycomb repository**. ADR-0004's decision #3 said hive owns the unified dashboard and gets there by **reusing honeycomb's dashboard code by runtime import** (the route registry, the page components, the `wire` data-fetch abstraction), on the reasoning that a fork would diverge.

Two facts changed that make the reuse-by-import mechanism unworkable and force this decision:

1. **hive is now a first-class product in its own repository, `hive`** (a submodule of the Apiary umbrella, sibling to `honeycomb` and `nectar`), not a package inside honeycomb. A separate repository cannot import honeycomb's internal `src/dashboard/web/` module at runtime.
2. **honeycomb's dashboard is being retired.** hive becomes the single source of always-on UI truth (the whole point of ADR-0004's decision #1). Once honeycomb stops serving the dashboard, there is no live honeycomb dashboard module left to import.

Today the honeycomb dashboard is a React single-page app served by the honeycomb daemon. The daemon mounts it as an unprotected `/` route (`honeycomb/src/daemon/runtime/server.ts:108`, `{ path: "/", protect: false, session: false }`) alongside `/health` (`honeycomb/src/daemon/runtime/server.ts:319-341`) and the protected `/api/*` groups (`honeycomb/src/daemon/runtime/server.ts:73-107`). The SPA source lives under `honeycomb/src/dashboard/web/` (the route registry `honeycomb/src/dashboard/web/registry.tsx:196-218`, the `wire` client `honeycomb/src/dashboard/web/wire.ts`, `pages/*`, and the shell). When honeycomb is down, the dashboard is down: exactly the failure mode hive exists to survive.

This ADR records how the dashboard physically moves out of honeycomb and into hive.

#### Decision drivers

- **hive and honeycomb are separate repositories.** A runtime `import` of honeycomb's `src/dashboard/web/` from hive is not available across a submodule boundary; only a network API (`/api/*`) crosses it.
- **honeycomb's dashboard-serving surface is being retired.** The reuse-by-import mechanism assumed a live honeycomb dashboard module to import; after retirement there is none.
- **The dashboard component layer must survive the move unchanged.** The pages are already origin-agnostic: each takes `PageProps` and hydrates through an injected `wire` (`honeycomb/src/dashboard/web/registry.tsx:10-22, 83-94`), so the same components render whether served by honeycomb or hive as long as `wire` is supplied.
- **Operators must never be dashboard-less during cutover.** honeycomb's `/` mount cannot be removed before hive is serving.

#### Decision

Two coupled decisions.

##### Decision A, retire honeycomb's dashboard-serving surface

honeycomb stops serving the dashboard. Its unprotected `/` SPA mount (`honeycomb/src/daemon/runtime/server.ts:108`) and the `honeycomb/src/dashboard/web/` subtree are retired from honeycomb. honeycomb **keeps** its data plane: `/health` (`honeycomb/src/daemon/runtime/server.ts:319-341`) and the protected `/api/*` groups (`honeycomb/src/daemon/runtime/server.ts:73-107`) remain, because hive aggregates them (per ADR-0004 decision #2). honeycomb also keeps its non-web ViewBlock/TUI dashboard layer (`honeycomb/src/dashboard/dashboard.ts`, `views.ts`, `html.ts`, `launch.ts`, `logs.ts`, `index.ts`, `CONVENTIONS.md`), which powers the `honeycomb dashboard` CLI and the Cursor webview and is out of scope for the web-portal move.

##### Decision B, copy-and-own (not runtime import, not fork)

hive takes ownership of the dashboard by **copying** the `honeycomb/src/dashboard/web/` code into `hive` and owning it thereafter. It does not import honeycomb's module at runtime, and it does not maintain a live fork. Because Decision A retires honeycomb's copy, there is no second live copy to diverge from: this is a one-time ownership transfer paired with source retirement, not an ongoing dual-maintenance fork.

The file-by-file copy-map (dispositions, modifications, retirements) is owned by `prd-001b-dashboard-migration-and-copy-map.md`. In summary, of the 36 files under `honeycomb/src/dashboard/**`:

- **24 copy verbatim** to hive (12 `web/` shell/infra files + 12 `web/pages/` files; all origin-agnostic, hydrate through the injected `wire`).
- **4 copy with modification** (`wire.ts` moves from single-origin to federated aggregation, plus `app.tsx`, `main.tsx`, `setup-gate.tsx`).
- **1 copies partially** (`contracts.ts`, only the web-consumed ROI types that `wire.ts` imports at `honeycomb/src/dashboard/web/wire.ts:27`).
- **1 is net-new in hive** (the daemon-side Hono host that serves the bundle; honeycomb served it in-process, hive needs its own).
- **7 stay in honeycomb** (the ViewBlock/TUI layer named in Decision A).
- **28 `web/` files plus the `/` mount are deleted from honeycomb** (the retirement of Decision A).

```mermaid
flowchart LR
    subgraph before["Before"]
        hcOld["honeycomb daemon"] --> dashOld["/ dashboard SPA<br/>src/dashboard/web/*"]
        hcOld --> apiOld["/api/* + /health"]
    end
    subgraph after["After"]
        hcNew["honeycomb daemon"] --> apiNew["/api/* + /health<br/>(kept: the data plane)"]
        hive["hive portal"] --> dashNew["/ dashboard SPA<br/>copied + owned"]
        hive -->|aggregates| apiNew
    end
    before --> after
```

#### Consequences

**Positive.**

- hive can own and evolve the dashboard without a cross-repo import that a separate-repository build cannot satisfy.
- No dual-maintenance fork: honeycomb keeps no dashboard-serving copy, so there is nothing to keep in sync.
- honeycomb's data plane (`/api/*` + `/health`) is unchanged, so the API-aggregation contract (ADR-0004 decision #2) works unmodified.
- The component layer moves unchanged because the pages are already origin-agnostic (`PageProps` + injected `wire`).

**Negative.**

- A one-time copy transfers ~28 files into hive that hive now owns and maintains. Future honeycomb dashboard-component improvements do not automatically flow to hive, but Decision A means honeycomb no longer has a dashboard to improve, so this cost does not recur.
- A **cutover-sequencing constraint** appears: honeycomb must not drop its `/` mount until hive is serving the dashboard, or operators are momentarily dashboard-less. The safe order is: hive ships and serves, then honeycomb removes `/`.
- `contracts.ts` is split (web-consumed types copied to hive; the rest stays honeycomb-side), a small ongoing seam if the ROI view-model shapes change.

**Reversibility.** Moderate. The copy is a one-time operation; reverting would mean re-adding honeycomb's `/` mount and either re-importing or re-copying the components back. The API-aggregation half is untouched by this ADR, so a rollback of the copy does not disturb the data contracts.

#### Alternatives considered and rejected

##### Import honeycomb's dashboard module at runtime (REJECTED)

This is ADR-0004 decision #3's original mechanism. Rejected here because hive and honeycomb are separate repositories: hive cannot import honeycomb's internal `src/dashboard/web/` module at runtime across the submodule boundary, and Decision A retires that module anyway, so there would be nothing to import.

##### Extract the dashboard into a shared package both repos import (REJECTED)

Rejected as disproportionate. It keeps one source of truth, but adds a third published package, a versioning surface, and release coordination between honeycomb and hive, for a component layer that honeycomb is retiring and will no longer consume. Copy-and-own removes the second consumer entirely, so the shared-package machinery has no second consumer to justify it.

##### Rewrite the dashboard from scratch in hive (REJECTED)

Rejected because the existing dashboard is a working, mature surface (route registry, `wire`, pages, shell). A rewrite discards proven code and re-introduces bugs for no benefit; the pages are already origin-agnostic and move unchanged.

##### Fork honeycomb's dashboard and keep both live (REJECTED)

This is the fork ADR-0004 already rejected, and it is rejected again for a stronger reason: Decision A retires honeycomb's copy, so "both live" is not even on the table. Copy-and-own is distinct from a fork precisely because only one live copy remains after the move.

#### Relationship to the corpus ADRs

- **nectar `ADR-0003` (three-daemon topology):** unchanged. This ADR does not alter the topology, the four roles, or the process boundaries. hive is still the always-on portal, honeycomb and nectar are still workload daemons, doctor is still the supervisor.
- **nectar `ADR-0004` (hive role + boundaries):** decision #1 (always-on + boot order), decision #2 (API aggregation, not Deeplake), and decision #4 (independent update cadence) are unchanged and still binding. This ADR **refines only the mechanism half of decision #3**: "hive owns the unified dashboard" stands; "gets there by reusing honeycomb's code via runtime import" is replaced by copy-and-own, because hive now lives in its own repository and honeycomb's dashboard is retired. ADR-0004 has been annotated with `Refined by:` pointers at the relevant anchors.

#### References

- `prd-001-hive-portal-daemon-index.md` - the module that implements Decisions A + B.
- `prd-001b-dashboard-migration-and-copy-map.md` - the file-by-file copy-map summarized here.
- nectar ADR-0003 - the topology this ADR leaves unchanged.
- nectar ADR-0004 - the role ADR whose decision #3 mechanism this refines.
- `honeycomb/src/daemon/runtime/server.ts:73-108` - the `/api/*` groups and the `/` dashboard mount (retired by Decision A).
- `honeycomb/src/dashboard/web/registry.tsx:196-218` - the route registry copied into hive.
- `honeycomb/src/dashboard/web/wire.ts:27` - the ROI-type import that drives the `contracts.ts` partial copy.

### ADR-0002, federate dashboard data server-side through a hive BFF proxy

#### Context

`ADR-0001` moved the dashboard SPA into hive (copy-and-own) and retired honeycomb's `/` mount. It left open HOW hive fetches each dashboard row from the daemon that owns it. The first implementation federated **client-side**: hive served a routing table at `GET /api/daemon-bases`, and the browser `wire` client fetched each workload daemon's origin directly (`http://127.0.0.1:3850` honeycomb, `http://127.0.0.1:3854` nectar) via a `buildFederatedUrl`/`createFederatedFetch` pair.

Client-side federation has two structural costs:

1. **It forces CORS onto every workload daemon.** A browser page served from hive's origin (`:3853`) issuing a JSON `POST` or a custom-header `GET` to honeycomb's origin (`:3850`) triggers a CORS preflight. honeycomb had to grow a dedicated CORS middleware (`honeycomb/src/daemon/runtime/middleware/dashboard-cors.ts`) with an origin allowlist just to let the browser read its own loopback data. Every future workload daemon would owe the same allowance.
2. **It exposes workload daemon ports to a browser context and pushes the loopback-trust boundary into the browser.** The browser learned every daemon's origin from `/api/daemon-bases` and had to re-validate that each base was loopback (`isLoopbackBaseUrl`) before trusting it, because the response (and the session/memory bodies the wire POSTs) could otherwise be redirected to an attacker-influenced origin. The trust check lived in the least-trusted tier.

The product intent (nectar `ADR-0004` decision #1) is that hive is the always-on single origin of UI truth. A client that reaches around hive to the workload daemons contradicts that framing.

#### Decision

**hive federates dashboard data SERVER-SIDE, as a backend-for-frontend (BFF) proxy.**

- The browser talks to **hive's own origin only**. The copied `wire` client (`hive/src/dashboard/web/wire.ts`) fetches same-origin relative paths (`/api/*`, `/setup/*`, `/health`) exactly like honeycomb's original same-origin dashboard did. The client-side `buildFederatedUrl`/`createFederatedFetch`/`loadDaemonBases` federation and the `/api/daemon-bases` route are removed.
- hive's **server** owns federation. A proxy handler (`hive/src/daemon/proxy.ts`, mounted on `app.all("/api/*")` and `app.all("/setup/*")` in `hive/src/daemon/server.ts`) resolves the owning daemon per request from doctor's registry (`resolveEndpointOwner` + `resolveDaemonBases`), fetches that daemon over loopback, and streams the response back. hive's own routes (`/health`, `/api/fleet-status`) are registered ahead of the proxy so they win.
- **Auth is transparent pass-through.** The proxy forwards the browser's own request headers (session headers, and any auth) verbatim to the workload daemon and stores no credential of its own. This preserves honeycomb's existing loopback + local-mode + session-header posture and keeps team/hybrid auth working without hive becoming an auth authority. The `host` and hop-by-hop headers are stripped; `content-encoding`/`content-length` are dropped from the response (fetch already decoded the body).
- **SSRF stays a server-side guard.** `resolveDaemonBases` drops any non-loopback `healthUrl` from the registry and only ever returns loopback origins; the proxy re-checks the resolved base with `isLoopbackBaseUrl` and pins `redirect: "error"` so a workload daemon cannot 3xx-redirect the proxied fetch off loopback. The browser is out of the trust decision entirely.
- **honeycomb's dashboard CORS middleware is removed.** With the browser never issuing a cross-origin request to honeycomb, `dashboard-cors.ts` and its mount in `honeycomb/src/daemon/runtime/server.ts` are deleted.

Data freshness stays **polling** for now (the copied pages hydrate via `usePoll` same-origin, proxied). Moving to server-sent events is recorded as a future direction in `ADR-0003`.

```mermaid
flowchart LR
    subgraph before [Client-side federation]
        b1[Browser] -->|"GET /api/daemon-bases"| h1[hive :3853]
        b1 -->|"cross-origin fetch (needs CORS)"| hc1[honeycomb :3850]
        b1 -->|"cross-origin fetch"| hn1[nectar :3854]
    end
    subgraph after [Server-side BFF proxy]
        b2[Browser] -->|"same-origin /api/*"| h2[hive :3853]
        h2 -->|"loopback proxy, pass-through"| hc2[honeycomb :3850]
        h2 -->|"loopback proxy, pass-through"| hn2[nectar :3854]
    end
    before --> after
```

#### Consequences

**Positive.**

- No workload daemon needs CORS. honeycomb's dashboard CORS middleware is deleted, and future workload daemons owe hive only a loopback `/api/*` surface, never a browser-facing CORS allowance.
- One browser origin. The dashboard is genuinely same-origin against hive, matching the always-on single-origin framing (nectar ADR-0004 decision #1).
- Smaller attack surface. Workload daemon ports are never handed to a browser context, and the loopback-trust decision lives on hive's server, the tier that already owns the registry.
- The pages are unchanged. Because honeycomb's dashboard pages were already origin-agnostic (they fetch relative paths through the injected `wire`), same-origin fetching is the pages' original mode; only the `wire`'s base resolution was removed.

**Negative.**

- hive is now on the data path for every dashboard read, not just the shell. If hive is down, the dashboard data is down. This is acceptable because hive is the always-on, doctor-supervised process whose entire purpose is to be up; a workload daemon being down still degrades fail-soft per source (the proxy returns a 502 the wire renders as an empty/unreachable panel).
- hive owns a small proxy surface (header hygiene, redirect pinning, streaming) that must stay correct. It is covered by `hive/tests/daemon/proxy.test.ts`.

**Reversibility.** Moderate. Reverting to client-side federation would mean restoring `/api/daemon-bases` + the federated `wire` and re-adding honeycomb's CORS middleware. The endpoint-to-owner routing table (`resolveEndpointOwner`) and the registry base resolution are shared by both mechanisms, so only the fetch location (browser vs hive server) changes.

#### Alternatives considered and rejected

##### Client-side federation (the prior mechanism, REJECTED)

The browser fetches each daemon's origin directly using a base table from `/api/daemon-bases`. Rejected for the two structural costs above: it forces CORS onto every workload daemon and pushes the loopback-trust boundary into the browser. It is the mechanism this ADR supersedes.

##### hive holds a service credential and authenticates on the dashboard's behalf (REJECTED)

hive stores a local service token and injects it into every proxied request. Rejected as unnecessary: the daemons bind loopback and honeycomb's dashboard data is already reachable under the local-mode + session-header posture the browser sends. Transparent pass-through keeps hive credential-free, so an always-on portal process holds no secret to leak. This could be revisited if a workload daemon ever requires a token even for loopback local-mode reads.

##### Keep client-side federation but relax honeycomb's CORS to a wildcard (REJECTED)

Rejected outright: a wildcard CORS allowance on a daemon that serves captured session/memory data is a security regression, and it does not address the port-exposure or trust-boundary problems.

#### Relationship to the corpus ADRs

- **nectar `ADR-0004` decision #2 (API aggregation, not Deeplake):** unchanged as a BOUNDARY. hive still holds no Deeplake client and still fetches every row from the owning daemon's `/api/*`. This ADR refines only the MECHANISM: the aggregation happens on hive's server (a proxy) rather than in the browser.
- **`ADR-0001` Decision B (copy-and-own):** unchanged. hive still owns the copied dashboard. This ADR only changes how the copied `wire` reaches data: same-origin to hive, which proxies, instead of cross-origin to each daemon.

#### References

- `hive/src/daemon/proxy.ts` - the server-side proxy handler this ADR introduces.
- `hive/src/daemon/server.ts` - mounts the proxy on `/api/*` and `/setup/*`; the `/api/daemon-bases` route is removed.
- `hive/src/dashboard/web/wire.ts` - the copied wire, now same-origin (client-side federation removed).
- `hive/src/shared/daemon-routing.ts` - `resolveEndpointOwner` (the routing table the proxy uses) and `isLoopbackBaseUrl` (the loopback guard).
- `hive/src/daemon/registry.ts` - `resolveDaemonBases`, the loopback-guarded base resolution from doctor's registry.
- `honeycomb/src/daemon/runtime/server.ts` - the honeycomb daemon whose CORS middleware is removed by this ADR (its `/api/*` + `/health` data plane is unchanged).
- `prd-001c-api-aggregation-wire.md` - the sub-PRD reconciled to this server-side model.

### ADR-0004, gate the portal landing on health-then-auth and serve path-based routes from hive

#### Context

`ADR-0001` moved the dashboard SPA into hive, and `ADR-0002` made hive the single origin that serves the shell and proxies every `/api/*` and `/setup/*` read to the owning workload daemon. What neither ADR settled is what an operator sees the instant a browser lands on the portal, and how the URL space is shaped.

Today the landing behavior is entirely client-side and unconditional:

1. **Routing is hash-based.** `hive/src/dashboard/web/router.tsx` (`useHashRoute`, `routeFromHash`) resolves the active route from `location.hash`, and `hive/src/dashboard/web/registry.tsx` declares eight routes (`/`, `/projects`, `/harnesses`, `/memories`, `/graph`, `/sync`, `/logs`, `/roi`, `/settings`). The daemon host serves one shell for every load and never sees the fragment, so there is no server route per screen and no server-side decision about which screen is allowed.
2. **There is no `/login` route and no `/health` route in the SPA.** Boot instead flows through two nested React gates. `hive/src/dashboard/web/main.tsx` renders `` (PRD-002), which polls hive's own `GET /api/fleet-status` (a projection of doctor's fleet status) until the fleet is ready; it then mounts ``, which polls the proxied honeycomb `GET /setup/state` and, on the `authenticated` bit, decides whether to show device-flow setup or the ``.
3. **"Logged in" is credential presence, not a session.** There is no portal cookie or portal session. The `authenticated` bit that honeycomb's `/setup/state` returns is true exactly when a valid `~/.deeplake/credentials.json` exists. hive holds no credential of its own (it is a transparent pass-through proxy per ADR-0002).

Two structural problems follow from doing all of this in the SPA. First, the decision of what to show is made after the shell has already loaded and after React has mounted, so the wrong screen can flash before a gate resolves (the operator briefly sees a dashboard chrome that then swaps to a setup screen, or an empty panel before readiness resolves). Second, the URL is not authoritative: a deep link or refresh always re-runs the client gate from scratch, and nothing at the server tier can enforce that an unhealthy or logged-out visitor cannot reach a data screen. The gate lives in the least-authoritative tier.

Upstream, honeycomb's backlog carried this concern as `prd-070-first-browser-load-experience` (what the first browser load should show) and `prd-068-portal-daemon-boot-shell` (the boot shell). Both were framed while the portal still lived inside honeycomb. hive is now the always-on single origin of UI truth (ADR-0001, ADR-0002), so the first-load experience and the boot shell belong to hive, not honeycomb.

#### Decision

**hive serves path-based routes and gates the landing decision on its own server, health first and auth second. The root URL `/` is the dashboard, and `/buzzing` and `/login` are the only gate-exempt screens.**

##### The gate precedence

On landing on ANY route, hive's server evaluates a three-step precedence before it decides what to serve:

1. **If the fleet is not healthy, redirect to `/buzzing`.** "Not healthy" means doctor reports the required services unhealthy, or doctor is itself unreachable. Health is checked before anything else because an unhealthy fleet makes every other screen useless.
2. **Else if the user is not logged in, redirect to `/login`.** "Not logged in" means no valid `~/.deeplake/credentials.json`, determined via the proxied honeycomb `/setup/state` `authenticated` bit (the existing, shared source of truth, no new portal session).
3. **Else serve the requested route, defaulting to `/`, which IS the dashboard.** The root must never be blank and the dashboard is served at `/`, never at `/dashboard`.

`/buzzing` and `/login` are EXEMPT from the gate so the redirect can terminate and never loops:

- **`/buzzing` is the readiness screen.** The existing PRD-002 `ReadinessSplash` concept becomes this route. It reads the service registration and per-service health from doctor and renders a per-service loading state, so an operator watching a cold or degraded fleet sees exactly which service is not yet up.
- **`/login` renders the device-flow guided setup**, reusing honeycomb's existing `/setup/login` (proxied through hive per ADR-0002). It is the same device flow the current `` drives, now addressable as its own path.

```mermaid
flowchart TD
    land["Browser lands on any route"] --> health{"Fleet healthy?<br/>(doctor)"}
    health -->|"no / unreachable"| buzzing["/buzzing<br/>(readiness rail)"]
    health -->|"yes"| auth{"Logged in?<br/>(deeplake credential<br/>via /setup/state)"}
    auth -->|"no"| login["/login<br/>(device-flow setup)"]
    auth -->|"yes"| dashboard["/ (the dashboard)"]
    buzzing -.->|"exempt, no gate"| buzzing
    login -.->|"exempt, no gate"| login
```

##### Server-side, path-based, not client hash

Routes become real server-served paths and the gate is a server redirect, replacing the hash-router-plus-nested-React-gates model. The server is the authority: it decides `/buzzing` vs `/login` vs the requested route before the browser renders anything, so a logged-out or unhealthy visitor never receives dashboard chrome to flash. Deep links and refreshes hit the same authoritative decision, because the path (not a fragment the server never sees) carries the route.

##### Health arrives live over SSE

Near-real-time health on the dashboard and on `/buzzing` now arrives via the doctor to hive server-sent-events stream rather than the interval poll of `/api/fleet-status`. This makes the future direction proposed in `ADR-0003` real for the health view-model: the health rail is the first concrete SSE-through-proxy consumer beyond the existing Logs tail, sourced from doctor's telemetry (doctor `ADR-0001`) and its service registry (doctor `ADR-0002`).

#### Rationale

- **Root-is-dashboard.** A blank `/` is unacceptable for an always-on portal. The dashboard is the product, so it owns the root; `/buzzing` and `/login` are transient waystations the operator only sees when the fleet or the credential is not ready.
- **Health-before-auth.** An unhealthy fleet shows `/buzzing` even to a logged-out operator, because when nothing behind the portal will answer, prompting for login is pointless and misleading. Health is the precondition for auth to be meaningful, so it is checked first.
- **Reuse the Deeplake credential, do not invent a portal session.** "Logged in" is already defined, shared, and observable through the proxied honeycomb `/setup/state` `authenticated` bit. Introducing a portal-specific session would create a second, divergent notion of authentication for hive to store and keep in sync, which contradicts the credential-free pass-through posture ADR-0002 established.
- **Server-side gate over a client hash-gate.** A server redirect is authoritative and cannot flash the wrong screen; a client gate necessarily loads the shell first and decides afterward. Putting the decision on hive's server (the tier that already owns the proxy and the doctor registry) keeps the trust and routing decision where the other authoritative decisions already live.

#### Consequences

**Positive.**

- No wrong-screen flash. The operator's first paint is already the correct screen (`/buzzing`, `/login`, or the dashboard) because the server chose it before render.
- Deep links and refreshes are authoritative and refresh-safe against real paths, and the gate re-evaluates identically on every entry.
- One notion of "logged in" across the corpus: the Deeplake credential, surfaced through the existing `/setup/state` bit. hive stays credential-free.
- The health view-model gets live freshness for free by consuming doctor's SSE stream, proving out the ADR-0003 direction on the screen that needs it most.

**Negative.**

- hive grows a server-side gate and per-route serving (redirect logic, exemptions, a catch-all that serves the shell for gated paths), more server surface than the four static routes the host serves today, and it must stay correct or it can wrongly trap an operator.
- The hash-router (`useHashRoute`) and the nested `ReadinessSplash` / `SetupGate` React gates are replaced by path routing plus the `/buzzing` and `/login` routes, a migration of the copied SPA's routing layer.
- hive now consumes a long-lived SSE connection for health with explicit reconnect and fail-soft, the added moving part ADR-0003 anticipated.

**Reversibility.** Moderate. The gate is server logic and the routes are additive; reverting to the client hash-gate would mean restoring `useHashRoute` as the sole router and moving the health/auth decision back into `ReadinessSplash` / `SetupGate`. The credential-presence definition of "logged in" and the doctor health source are unchanged by a rollback, so only the location and authority of the decision (hive server vs the browser) would move back.

#### Alternatives considered and rejected

##### Keep client-side hash routing and implement the gate in the SPA (REJECTED)

Leave `useHashRoute` as the router and let `ReadinessSplash` / `SetupGate` (or their successors) keep deciding health and auth in React. Rejected because a client gate loads the shell first and decides afterward, so it can flash the wrong screen, and it is not authoritative: nothing at the server tier enforces that an unhealthy or logged-out visitor cannot request a data screen. Server redirects are cleaner and cannot flash.

##### Introduce a new portal session distinct from the Deeplake credential (REJECTED)

Give hive its own session or cookie that represents "logged into the portal", separate from `~/.deeplake/credentials.json`. Rejected because it duplicates authentication: credential presence is the existing, shared source of truth that honeycomb already exposes via `/setup/state`, and a second notion would have to be stored by hive and kept in sync, breaking the credential-free pass-through posture of ADR-0002 for no gain.

#### Relationship to the corpus ADRs

- **hive `ADR-0002` (server-side BFF proxy):** unchanged and depended upon. The gate reads `/setup/state` and the health source through the same proxy this ADR does not modify; hive stays credential-free and the gate adds no cross-origin surface.
- **hive `ADR-0003` (future SSE):** this ADR turns its proposed direction into a concrete, Active consumer for the health view-model. ADR-0003 stays the general statement of the SSE-over-proxy pattern; this ADR realizes it for health first.
- **doctor `ADR-0001` (telemetry source of truth + SSE):** the health the gate checks and the `/buzzing` rail renders originates here; hive consumes it, it does not author health.
- **doctor `ADR-0002` (service registration):** the per-service registration `/buzzing` reads to show which services are up comes from doctor's registry.
- **honeycomb `prd-070` and `prd-068`:** superseded. The first-browser-load experience and the portal boot shell they scoped for honeycomb move to hive, which is now the always-on single origin (ADR-0001, ADR-0002); this ADR is where that ownership and behavior are decided.

#### References

- `hive/src/dashboard/web/router.tsx` - `useHashRoute` / `routeFromHash`, the client hash router this ADR replaces with server path routing.
- `hive/src/dashboard/web/registry.tsx` - the eight-route registry that gains `/buzzing` and `/login` and loses hash addressing.
- `hive/src/dashboard/web/main.tsx` - the boot entry that renders `` then ``; the `ReadinessSplash` concept becomes the `/buzzing` route.
- `hive/src/daemon/proxy.ts` - the server proxy the gate reads `/setup/state` through and the SSE health stream rides over (ADR-0002).
- `prd-002-portal-readiness-splash` - the readiness splash whose concept becomes `/buzzing`.
- `prd-003-portal-landing-gate-and-routing`, `prd-004-buzzing-service-loaders`, `prd-005-health-rail-and-page` - the forthcoming PRDs that implement the gate, the `/buzzing` loaders, and the health rail and page.

# Part 3: Honeycomb, the Memory

## Honeycomb: Stories & User Guide

*Shared, lasting memory for your AI coding agents, explained in plain language.*

### Foreword

AI coding assistants are brilliant in the moment and forgetful the next. Close the window and the context is gone. Honeycomb gives every one of your agents a single shared memory that survives sessions, travels across tools, and gets sharper over time. This guide is the plain-language tour: what Honeycomb is, how it works, how to get started, how it behaves day to day, how teams share it, and the questions people ask most. No SQL, no servers, no configuration rituals.

### What is Honeycomb?

The plain-language introduction to Honeycomb: what it is, the problem it solves, and who it is for. Start here if you are new.

#### The problem: your AI agents forget

AI coding assistants are brilliant in the moment and forgetful the next. Close the window and the context is gone. Open a different tool tomorrow and it has never heard of your project. The decision you reached with one assistant at midnight is invisible to a different assistant the next morning. So you re-explain your conventions, re-discover the fix that already worked, and repeat yourself to a machine that should have remembered.

#### The idea: one shared memory for all of them

Honeycomb gives your AI coding agents a single, shared, lasting memory. A small program runs quietly on your machine, notices what happens as you work, distills it into clean notes, and hands those notes back to any assistant that asks. Learn something once, and it is there everywhere: the next session, a different tool, another laptop, and (if you want) the rest of your team.

Think of it as a shared brain your assistants read from and write to on every turn, instead of starting cold each time.

#### What you actually get

- **Memory that survives.** What you figured out yesterday is waiting for you today, already summarized.
- **Memory that travels across tools.** A note written while using one assistant is recalled by another. Honeycomb plugs underneath the coding assistants you already use (Claude Code, Cursor, and Codex today, with three more in progress).
- **Skills that spread.** When you (or a teammate) solve something reusable, Honeycomb can turn it into a shareable "skill" that shows up automatically for everyone, no copy-paste.
- **A memory that gets sharper, not noisier.** Honeycomb periodically tidies its own notes: merging duplicates, dropping junk, and keeping the current version of a fact instead of letting stale ones pile up.
- **A friendly dashboard.** A simple local web page shows what has been remembered, how your tools are wired, and the health of everything. No database knowledge required.

#### Who it is for

**Vibe coders.** If you live inside an AI coding assistant and just want it to *remember your project*, Honeycomb is the missing memory. One command to install, a dashboard that opens itself, and no SQL, servers, or configuration rituals. Stop re-explaining yourself every morning.

**Teams and enterprises.** If many developers, devices, and tools need to share what they learn, Honeycomb is one brain across all of them. A discovery by one engineer reaches the whole team on their next session. Your data stays in your own store, separated cleanly by team and project, and everything is versioned and inspectable.

#### Where it comes from

Honeycomb is a collaboration. **Activeloop** provides [Deeplake](https://deeplake.ai), the database for AI that Honeycomb's memory lives in, and [Hivemind](https://github.com/activeloopai/hivemind), the open-source agent-memory project Honeycomb is built on. **Legion Code** adds the multi-tier memory system, the skill sharing, the self-tidying loop, and the local daemon that ties it all together. Neither half stands alone: Deeplake gives the memories somewhere durable to live, and Legion Code gives every assistant one consistent way to use them.

#### Next steps

- See the shape of it in How Honeycomb works.
- Learn the words in the Glossary.
- ### How Honeycomb works

A plain-language tour of how Honeycomb captures, distills, and recalls memory, and why it gets sharper over time. No technical background needed.

#### One quiet helper in the background

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

#### Capture: notice what happened

As you and your assistant work, Honeycomb quietly records the important moments: what you asked, what the assistant did, and what came back. This recording is cheap and instant, and it never gets in the way. If anything ever goes wrong while recording, your assistant keeps working normally. Nothing is lost.

#### Distill: turn it into clean notes

Raw transcripts are long and noisy. Honeycomb distills them into short, useful notes: a one-line headline ("the index"), a longer summary, and the full original if you ever need to dig in. This is the **three-tier memory**: skim the headline, open the summary if it looks relevant, and only read the full detail when you truly need it. It is how a person remembers, a gist first, then the details on demand.

#### Recall: hand the right notes back

When you start a new session, Honeycomb gives your assistant a small, tidy "here is what I already know about this project" briefing so it starts informed instead of blank. During your work, the assistant can also ask for more whenever it needs it. You do not have to manage any of this; it happens for you.

Honeycomb finds the right notes two ways at once: by matching the words you used, and (optionally) by matching the *meaning* even when the words are different. That second kind is called semantic search, and it is what lets Honeycomb surface the right memory even when you would not have known the exact term to look for.

#### Compound: it gets sharper over time

Most note piles get messier as they grow. Honeycomb does the opposite. Every so often it runs a tidy-up pass that merges duplicate notes, drops the junk, and replaces stale facts with their current version, while keeping a full history so nothing is truly lost. The result is that the more you use Honeycomb, the *sharper* its memory gets, not the noisier.

#### Your data stays yours

Honeycomb keeps your memories in a store you control (powered by [Deeplake](https://deeplake.ai)), separated cleanly so different teams and projects never see each other's notes. The local helper is the only thing that connects to it, and on a single machine it only listens to your own computer. Secrets like API keys are handled separately and are never shown to the assistant.

#### In one sentence

Honeycomb watches your work, writes clean notes, hands the right ones back to any assistant on any device, and keeps tidying itself so your project's memory only gets better.

### Glossary

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

**Deeplake**: The database for AI, made by Activeloop, where Honeycomb's memories are stored. It is good at both exact lookups and meaning-based search, it keeps a full version history, and it can live in your own cloud. See [deeplake.ai](https://deeplake.ai).

**Hivemind**: Activeloop's open-source agent-memory project that Honeycomb is built on. See [the Hivemind repository](https://github.com/activeloopai/hivemind).

**Embeddings / semantic search**: The optional ability to find memories by *meaning* rather than exact words. Turn it on and Honeycomb can surface the right note even when you would not have guessed the exact term. Turn it off and recall still works by matching words; it simply finds fewer of the "I didn't know to search for that" cases.

**Org, workspace, and project**: How Honeycomb keeps memory in the right lane for a team. An **org** is your company, a **workspace** is a team within it, and a **project** is the specific repository or folder you are working in. Notes are kept separate across these so the right people see the right memory and nothing bleeds across.

**Dashboard**: The simple local web page Honeycomb serves on your own machine. It shows your memories, how your tools are wired, your team's shared skills, and the health of everything. It is also where first-time setup happens. No database skills required.

**ROI**: The dashboard page that answers "is this saving me money?" It nets what Honeycomb saves you (from reused context and fewer back-and-forths) against what it costs to run, in plain dollars. It carefully labels which numbers are **measured** (real, billed facts) and which are **estimates** (projections), and shows a dash rather than a made-up number when something cannot be measured yet. See Your ROI dashboard.

**Measured vs estimated savings**: Honeycomb's honesty rule on the ROI page. A *measured* number is arithmetic over your real billed usage, trust it like a receipt. An *estimated* number is a model of what would otherwise have happened, useful but a projection, and it is always flagged with an "est." marker so the two are never confused.

**MCP**: A standard way for AI tools to call external helpers. Honeycomb offers an MCP "server" so assistants t

### Getting started

Install Honeycomb, connect it, and save your first memory. Written for anyone, no prior setup or database knowledge required.

#### 1. Install with one command

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

#### 2. Click "First time setup"

On the dashboard you will see a **First time setup** button. Click it. Honeycomb runs the sign-in for you: it shows a short code right on the page and opens a tab where you approve it (and create a free Deeplake account if you do not have one). No copying codes out of a terminal.

When you approve, the same dashboard lights up its connected views. You are ready. Nothing to restart.

> Already using Hivemind? The dashboard will notice and offer to move you over cleanly. Running both at once is not supported, so let Honeycomb handle the switch.

#### 3. Save your first memory

Now teach it something and ask for it back. In your terminal:

```bash
honeycomb remember "we deploy from the release branch, never from main"
honeycomb recall "how do we deploy"
```

That note is now saved. Write it while using one assistant, and a different assistant will recall it tomorrow, even on another laptop. That is the whole point.

#### 4. Wire up your coding assistants

Let Honeycomb plug underneath the AI coding tools you already use, so it remembers automatically as you work:

```bash
honeycomb setup
```

This finds the assistants you have installed and connects each one. It is safe to run again any time, for example after you install a new tool. To check that everything is healthy:

```bash
honeycomb status
```

#### 5. Explore the dashboard

Browse back to the dashboard any time to see what Honeycomb knows:

```bash
honeycomb dashboard
```

You will find your memories, the state of each connected assistant, your team's shared skills, a map of your codebase, and the overall health of the system, all in one local page.

#### What next

- Learn the day-to-day flow in Everyday use.
- Sharing across a team? See Honeycomb for teams.
- Curious about a word? Check the Glossary.

### Everyday use

How Honeycomb fits into a normal day of coding: remembering and recalling, letting it work on its own, reading the dashboard, and the skills that travel with you.

#### It mostly works on its own

The best thing about Honeycomb day to day is how little you have to think about it. Once your assistants are wired (`honeycomb setup`), it captures the useful moments as you work and hands the right notes back at the start of your next session. You do not have to remember to save anything for the basics to work.

What you *will* notice is that a fresh session starts informed: your assistant already knows your project's recent decisions and durable conventions, instead of asking you to re-explain them.

#### Remembering on purpose

Sometimes you want to pin something down yourself. Two simple commands do it:

```bash
honeycomb remember "the staging database resets every night at 2am UTC"
honeycomb recall "staging database schedule"
```

`remember` saves a note. `recall` pulls back whatever is relevant to your question. Recall matches both the words you used and, when enabled, the *meaning*, so you can find a note even if you would not have guessed its exact wording.

#### Reading the dashboard

Run `honeycomb dashboard` (or just keep the tab open) to see everything in one place:

- **Home** gives you the at-a-glance picture: how much has been remembered, how things are trending, overall health.
- **Harnesses** shows each AI assistant Honeycomb is connected to and whether its wiring is healthy.
- **Memories** is your captured knowledge, browsable.
- **Graph** is the map of your codebase you can explore.
- **Sync** shows the skills and assets being shared, mined, and pulled.
- **Logs** is a live view of what the helper is doing.
- **Settings** holds your preferences and sign-in status, and lets you do the housekeeping actions right from the page: sign out, turn memory-meaning matching (embeddings) on or off, restart the helper, or remove Honeycomb, without dropping back to the terminal.

If something ever looks off, the dashboard tells you plainly what is degraded and what to do, rather than showing a green light that is not telling the truth.

#### Skills that travel

When you solve something genuinely reusable, Honeycomb can capture it as a **skill**, a short, reusable lesson. Skills you (or teammates) create show up automatically in your assistants at the start of a session. You do not copy files around; Honeycomb places them where each tool looks for them.

You can also manage skills directly:

```bash
honeycomb skill pull        # fetch the latest shared skills now
honeycomb skill scope team --users alice,bob   # also learn from these teammates
```

#### Working across tools and devices

Because every assistant talks to the same local helper and the same store, a memory written from one tool is recalled by another, and a memory captured on one machine is available on another (as long as you are signed in to the same account). Switch from one assistant to a different one mid-project and the context comes with you.

#### Turning things up (optional)

Two capabilities are off by default so nothing surprising happens on day one. Turn them on when you want them:

- **Semantic search** (finding memories by meaning) becomes available once the small language model that powers it has downloaded and warmed up. Until then, recall still works by matching words.
- **The self-tidying loop** (which merges duplicates and prunes stale notes over time) is opt-in, because it uses an AI model and you should decide when to spend that.

#### Pausing capture

If you are working on something sensitive and do not want it recorded for a session, you can put Honeycomb in read-only mode (recall still works, but nothing new is written). Your assistant keeps working normally either way.

#### What next

- Sharing with others? See Honeycomb for teams.
- Want the mental model? Read How Honeycomb works.

### Honeycomb for teams

How a team shares memory and skills with Honeycomb, what stays private versus shared, and how work in different projects stays in its own lane.

#### One brain for the whole team

On your own, Honeycomb remembers your work across sessions and tools. On a team, it does something more valuable: what one person learns can reach everyone. A teammate solves a tricky migration on Monday; the reusable lesson is available to the whole team's assistants by their next session, without anyone passing around a file.

#### Org, workspace, project: keeping memory in the right lane

Teams need memory to be shared *and* separated at the same time. Honeycomb organizes it in three nested levels:

- **Org** is your company. It is the outer boundary; two different companies never see each other's anything.
- **Workspace** is a team within the company. Two teams keep separate memory, enforced where the data is stored, not just in the app.
- **Project** is the specific repository or folder you are working in. Within a team, memory is scoped to the project you are actually in, so a note from one repo does not surface while you work in another.

You do not have to manage the project level by hand. Honeycomb figures out which project a session belongs to from the folder you are working in, even when you have several open at once across different tools.

#### What is shared and what is private

Inside a workspace, what an assistant can see depends on a simple policy:

- **Private lane**: an assistant sees only its own memories. Good for a personal or a CI assistant that should not mix into the shared pool.
- **Shared**: an assistant sees the team's shared memories plus its own. This is the "one brain" setting.
- **Group**: an assistant shares with a named group of teammates, plus its own.

The default leans private and safe: when in doubt, Honeycomb shows less, not more. You widen sharing on purpose, never by accident.

#### Skills spread automatically

Shared **skills** (reusable lessons) are the most visible team benefit. When a skill is published to the team, every teammate's assistants pick it up at the start of their next session. Skills carry who wrote them, so credit and history are clear, and two people can have a skill with the same name without clobbering each other.

Promoting something from "just mine" to "the whole team's" is always a deliberate, recorded action, so nothing private gets shared by surprise.

#### Switching between projects, teams, and companies

Because Honeycomb scopes to the folder you are in, **moving between repositories needs no manual switch at all**, just open the other project in your assistant and Honeycomb follows. What stays a deliberate choice is moving between the teams and companies you belong to:

```bash
honeycomb org list           # companies you belong to
honeycomb workspace list     # teams in the current company
honeycomb project list       # projects you are bound to
honeycomb org switch acme    # change company
honeycomb workspace use backend
```

The dashboard offers the same switches in a menu, showing only the orgs, workspaces, and projects you actually have access to.

#### Your data, your store

A team's memory lives in your own Deeplake store, with each team and project separated at the storage layer. You can even keep that storage in your own cloud account. Sensitive credentials (like API keys) are never stored alongside memory and are never shown to an assistant. For decision-makers: memory is versioned and inspectable, sharing is opt-in by design, and nothing leaves your store except the sign-in traffic and, only if you allow it, anonymous product-usage counts.

#### What next

- New here? Start with Getting started.
- Want the day-to-day flow? See Everyday use.

### Your ROI dashboard

Honeycomb has a page that answers the obvious question: *is this saving me money?* The **ROI** page on your dashboard shows what the memory layer saves you against what it costs to run, in plain dollars, and it is careful to tell you which numbers are measured and which are estimates.

#### What the page shows

At the top is the headline: **Net ROI**, the one number that nets everything out.

```
Net ROI = what you saved − what it cost to run
```

Underneath, that splits into the pieces it is made of:

- **What you saved** comes in two flavors:
  - **Measured cache savings** (the green headline). When your assistant reuses context it has already sent, that reused part is billed at a small fraction of the normal rate. Honeycomb reads the real token counts from your sessions and prices them, so this is an actual, billed saving, not a guess.
  - **Estimated memory savings** (clearly labeled as an estimate). When Honeycomb hands your assistant the right notes up front, it can reach an answer in fewer back-and-forths. We *model* what that would have cost you otherwise. It is shown next to the measured number but always marked as an estimate, never mixed in as if it were a hard fact.
- **What it cost to run** is Honeycomb's own running cost: the cloud compute behind storing and recalling your memory, plus the small amount of AI work Honeycomb does in the background to distill your sessions into clean notes.

#### Measured vs estimated: why we split them

This is the most important thing about the page. Honeycomb deliberately keeps two kinds of number apart:

- A **measured** number is arithmetic over your real, billed usage. You can trust it like a receipt.
- An **estimated** number is a model of what *would* have happened. It is useful, but it is a projection, and we label it so.

Any total that includes an estimate inherits an **"est."** marker, so you always know when you are looking at a projection rather than a billed fact. We would rather show you an honest estimate clearly flagged than dress a guess up as a guarantee.

#### When a number is missing

The page never invents a number to fill a gap. If something cannot be measured right now, you will see a **dash**, not a misleading `$0.00`:

- **Just getting started?** Until Honeycomb has captured a few sessions with token detail, the savings section shows dashes. A measured `$0` and an "unknown yet" are shown differently on purpose.
- **Token detail is captured for Claude Code first.** If you are mostly on Claude Code you will see the richest numbers; other tools are being added, and the page marks where data is partial.
- **If the cost service is unreachable**, the affected line shows a dash and offers a retry, rather than guessing.

A small **"rates as of"** date on the page tells you how current the pricing behind the math is.

#### A negative number is not a bug

If you barely use the memory features, it is possible for the running cost to be higher than what you have saved so far, a negative net. That is honest, not broken: the value compounds the more you use it. The page shows this plainly and never colors a rising cost as if it were good news.

#### Teams

ROI adds up **across your devices**, and if your workspace is organized into teams, it can roll up per team as well. Per-person breakdowns are intentionally switched off until a verified sign-in exists, Honeycomb will not guess who you are from your machine or your git email. Until then you will see a clear "needs verified login" note instead of a fabricated per-person figure. See Honeycomb for teams for how team rollups work.

#### Where to find it

Open your Honeycomb dashboard and choose **ROI** from the left navigation. The page runs locally on your own machine and reads only your own workspace's numbers.

### Self-hosting the storage backend

Run Honeycomb against your own storage backend instead of Activeloop's hosted Deeplake. The backend is Activeloop's open-source `pg_deeplake` Postgres extension, and Honeycomb can point at it either through an HTTP gateway or directly over a Postgres connection.

#### What you get, and the one limitation

Honeycomb's storage layer is pluggable. The daemon is the only process that talks to storage, so pointing it at a self-hosted backend is a single decision made at login time. Everything above storage (capture, recall, the dashboard, the harnesses) is unchanged.

The one honest limitation: only the storage path is self-hostable today. `honeycomb login` (the device and headless flows) and `honeycomb org switch` still call `api.deeplake.ai` for authentication and token re-mint. The `honeycomb login --endpoint` path documented below avoids that call by writing the credential directly, so a fully self-hosted deployment should establish its credential with `--endpoint` and avoid the auth-server verbs until a self-hosted auth issuer exists. This is an open question raised for the maintainers.

---

#### 1. Run pg_deeplake

`pg_deeplake` is Activeloop's open-source Postgres extension. It speaks Honeycomb's SQL dialect natively, so Honeycomb talks to it with no translation layer.

```bash
docker run -d --name pg-deeplake \
  -e POSTGRES_PASSWORD=deeplake \
  -p 5432:5432 \
  quay.io/activeloopai/pg-deeplake:18
```

That gives you a Postgres 18 server with the extension loaded, reachable at `postgres://postgres:deeplake@localhost:5432/postgres`.

---

#### 2. Point Honeycomb at it

There are two ways in, both established with one command. Neither touches `api.deeplake.ai`.

##### Direct Postgres (recommended for a single box)

Point Honeycomb straight at the Postgres URL. The daemon connects directly, with no HTTP gateway in the middle.

```bash
honeycomb login --endpoint "postgres://postgres:deeplake@localhost:5432/postgres"
```

When the endpoint starts with `postgres://` (or `postgresql://`), Honeycomb selects the direct Postgres transport automatically.

##### HTTP gateway

If you front `pg_deeplake` with an HTTP gateway that exposes the Deeplake query API, point at that URL instead.

```bash
honeycomb login --endpoint "https://deeplake.internal.example.com"
```

Any endpoint that does not start with `postgres://` or `postgresql://` uses the HTTP transport.

##### Flags

```
honeycomb login --endpoint <url> [--token <tok>] [--org <o>] [--workspace <w>]
```

- `--endpoint` selects the self-hosted path. This is the trigger: with it set, the device flow and the `GET /me` validation are skipped and the credential is written directly with `apiUrl = `.
- `--token` is optional. If you omit it, Honeycomb mints a local, verifiable token bound to your org and workspace, so a self-hoster needs no Activeloop token at all.
- `--org` defaults to `local`.
- `--workspace` defaults to `default`.

The credential is written to the shared `~/.deeplake/credentials.json` at mode `0600`, exactly like every other login. The token is never printed.

---

#### 3. The contract a backend must honor

If you write or front your own backend rather than using `pg_deeplake` as shipped, two behaviors are load-bearing. Both were reverse-engineered and proved end to end; getting either wrong breaks Honeycomb quietly.

##### A workspace is a Postgres schema

Honeycomb introspects a workspace's columns with `information_schema.columns WHERE table_schema = ''` and then issues statements with UNqualified table names (for example `memory`, not `.memory`). A backend MUST therefore map each workspace to its own Postgres schema and `SET search_path` to that schema so the unqualified names resolve inside it. The direct Postgres transport does this for you: it runs `CREATE SCHEMA IF NOT EXISTS ""` and sets the search path on every connection checkout.

##### Return RAW error text, never JSON-wrapped

Honeycomb's schema-heal engine classifies failures by regex-matching the RAW Postgres error message, for example `relation "memory" does not exist`. A backend MUST return that text unmodified. If you wrap the error in JSON, `JSON.stringify` escapes the quotes (`relation \"memory\" does not exist`) and the heal regexes stop matching, so tables and columns silently stop self-healing. Pass the database error message through verbatim.

##### Why pg_deeplake is a pure passthrough

`pg_deeplake` speaks Honeycomb's SQL dialect natively: `USING deeplake` table storage, `float4[768]` embedding columns, the `` cosine-distance operator, and `deeplake_index` BM25 indexes. Because the dialect matches, the transport forwards every statement verbatim and returns the result rows as-is. There is no query rewriting to maintain.

---

#### 4. Verify

```bash
honeycomb status
honeycomb remember "self-hosted backend is live"
honeycomb recall "self hosted"
```

If `recall` returns the memory you just wrote, the daemon is reading and writing your self-hosted backend.

### Frequently asked questions

Short, plain answers to the questions people ask most about Honeycomb.

#### The basics

**What is Honeycomb in one sentence?**
A shared, lasting memory for your AI coding assistants, so what one of them learns is remembered by all of them, across sessions, tools, devices, and (if you want) your team.

**Do I need to know about databases or SQL?**
No. You install with one command, click a button, and use plain commands like `remember` and `recall`. The technical machinery is hidden behind a friendly dashboard.

**Which AI coding assistants work with it?**
Three are supported today: Claude Code, Cursor, and Codex. Three more, Hermes, pi, and OpenClaw, are in progress. Honeycomb plugs underneath whichever supported ones you have installed, and a memory written from one is recalled by the others.

**Who makes Honeycomb?**
It is a collaboration between Legion Code and Activeloop. Activeloop provides [Deeplake](https://deeplake.ai) (the database for AI it stores memory in) and [Hivemind](https://github.com/activeloopai/hivemind) (the open-source project it builds on). Legion Code adds the multi-tier memory, skill sharing, the self-tidying loop, and the local helper that ties it together.

#### Privacy and data

**Where does my data live?**
In your own Deeplake store, which you control and can even host in your own cloud account. The small helper on your machine is the only thing that connects to it.

**Can other people or teams see my memories?**
No, unless you choose to share. Different companies, teams, and projects are kept separate at the storage layer, and within a team the default leans private. You widen sharing on purpose, never by accident.

**Are my API keys and secrets safe?**
Yes. Secrets are stored separately from memory, encrypted, tied to your machine, and they are never shown to an assistant. An assistant can *use* a secret (for example to call a service) without ever seeing its value.

**Does Honeycomb send my code or prompts anywhere?**
The only outbound traffic is the sign-in with Deeplake and, optionally, anonymous product-usage counts to help the makers understand adoption. That usage signal never includes your code, prompts, memories, file paths, or names, and you can turn it off entirely. Your actual memories go only to the store you control.

**Can I stop it from recording?**
Yes. You can put Honeycomb in read-only mode for a session (recall still works, nothing new is written), which is handy when you are working with sensitive material.

#### Cost and performance

**Does it slow my assistant down?**
No. Recording is cheap and happens out of the way, and if anything ever hiccups, your assistant keeps working normally. The start-of-session briefing it adds is deliberately small.

**Does it cost money in AI model usage?**
The everyday memory features (capturing, recalling, the briefing) do not require their own AI model or API key. Two optional extras can use a model: turning sessions into summaries and skills, and the periodic self-tidying loop. Both are opt-in, so you decide when to spend.

**What happens when I stop working for a while?**
Honeycomb notices when nothing is happening and quietly goes to sleep: after a couple of idle minutes it stops all its background chatter with your storage, which lets the hosted storage wind down so an idle setup costs next to nothing. It still captures anything new the moment you start again. The only thing you might notice is that the very first action after a long idle stretch can take a few extra seconds while storage wakes back up; after that it is full speed. This is on by default and nothing is ever lost while it sleeps.

**Do I need an internet connection?**
You need to be signed in to reach your store. The optional "search by meaning" feature uses a small language model that runs locally on your own machine (downloaded once), not a cloud service.

#### How it compares

**How is this different from a regular vector database or "RAG"?**
A plain vector database can store text and hand back similar text. Honeycomb does that and more: it keeps memory at three levels of detail so an assistant can skim then zoom, it tidies itself over time so it gets sharper instead of noisier, it turns lessons into shareable skills, and it works across many tools and your whole team. The storage underneath (Deeplake) is built for both exact lookups and meaning-based search in one place, with full version history.

**What is "search by meaning" (semantic search) and do I need it?**
It is the ability to find a memory by what it *means*, even if you used different words. It is optional. With it on, Honeycomb catches more of the "I didn't know the exact term to search for" cases. With it off, recall still works by matching words.

#### Setup and switching

**I already use Hivemind. What happens?**
Honeycomb and Hivemind are siblings and share one sign-in, but running both at once is not supported. When you set up Honeycomb, the dashboard notices an existing Hivemind install and offers to move you over cleanly, usually without even needing to sign in again.

**Can I use it across multiple machines?**
Yes. Sign in on each machine with the same account, and a memory captured on one is available on the others.

**How do I see what it knows?**
Open the dashboard (`honeycomb dashboard`). It shows your memories, your connected tools, your shared skills, a map of your codebase, and overall health.

**What keeps Honeycomb running if it crashes?**
A tiny built-in watchdog called **Doctor**. The one-command installer sets it up alongside Honeycomb. It quietly checks that the background helper is healthy and, if something breaks, repairs it for you (restart, reinstall, and so on) so you usually never notice. If it cannot fix the problem on its own, it shows a local status page and, unless you opt out, sends home a scrubbed report so the makers can help proactively. That report never includes your credentials, tokens, or code, and you can turn it off (`DO_NOT_TRACK=1`, `HONEYCOMB_TELEMETRY=0`, or the dashboard). Don't want the watchdog at all? Add `--no-doct

## Honeycomb: Technical Manual & Specification

*The daemon architecture, capture and recall pipeline, storage, knowledge graph, integrations, and full CLI/API/MCP reference.*

### Foreword

Honeycomb is daemon-centric: write the memory logic once inside a daemon, then wrap it per assistant with thin shims. This manual is the complete technical account. It covers the four-plane architecture, how memory is captured and compacted, how it is stored in Deeplake, the knowledge graph, the hybrid recall pipeline, harness integrations, and the security model, followed by the full CLI, HTTP API, and MCP tool reference. It is written for practitioners who need the real shape of the system.

### Honeycomb: Overview & Quickstart

#### What makes Honeycomb different

A vector database can store text and hand it back by similarity. Honeycomb does that, and then keeps going. On top of [Activeloop Deeplake](https://deeplake.ai), **[Legion Code](https://github.com/legioncodeinc)** builds the memory system that turns raw recall into a brain your agents actually trust.

- ** Three-tier memory.** Every memory exists at three resolutions at once (one-line **key** → **summary** → full **raw** session). Agents skim the keys, then zoom into detail only when they need it. *(Legion Code)*
- ** Session priming.** At session start a tiny, bounded index (~300-800 tokens) of your most relevant keys is pushed once; the agent pulls deeper on demand. No per-turn injection, no "lost in the middle." *(Legion Code)*
- ** Skillify & propagation.** The daemon mines reusable skills out of real sessions, gates them for quality, and auto-pulls the team's latest skills into every agent at session start. Author a skill once; everyone gets it. *(Legion Code)*
- ** The pollinating loop.** A periodic maintenance pass reasons over accumulated memory and the entity graph to merge duplicates, prune junk, and supersede stale facts, so memory gets *sharper* over time, not noisier. *(Legion Code)*
- ** Knowledge graph.** An entity-centric, versioned, provenance-tracked index over your memories. Newer facts supersede stale ones; every claim traces back to the session that produced it. *(Legion Code)*
- ** Hybrid recall.** Lexical (BM25) and semantic (768-dim vectors) search fused by Reciprocal Rank Fusion, with a measured **recall@5 ≈ 0.72-0.78**. *(built on Deeplake)*
- ** Codebase graph.** A multi-language AST graph (TypeScript, JS, Python, Go, Rust, Java, Ruby, C/C++) of files, functions, and their call/import/extends edges, queryable for impact and neighborhood. *(Legion Code)*

#### Install (one command)

No Node? No npm? No problem. The installer detects and sets up everything, then **opens a dashboard in your browser**. The terminal is just a progress log; the product is the first thing you touch.

```bash
# macOS / Linux
curl -fsSL https://get.theapiary.sh | sh
```

```powershell
# Windows (PowerShell)
irm https://get.theapiary.sh/install.ps1 | iex
```

That single line installs a current Node/npm if missing, installs **`@legioncodeinc/honeycomb`** globally, brings up the daemon on `127.0.0.1:3850`, opens the dashboard (Hive portal at `127.0.0.1:3853`), and sets up **[Doctor](https://github.com/legioncodeinc/doctor#readme)**, a tiny watchdog that keeps it all healthy (opt out with `--no-doctor`). Then:

1. The dashboard loads in a **pre-auth setup state**. No token ever touches your shell.
2. Click **"First time setup."** Honeycomb runs the Deeplake device-flow login *for* you, shows the code right on the page, and opens the verification tab.
3. Done. The same running daemon lights up its Deeplake-backed surfaces, and capture and recall go live.

> Already running **Hivemind**? The dashboard detects it, explains that running both is unsupported, and **"Proceed with Honeycomb"** migrates you cleanly. Prefer to inspect before you pipe? The script and a published `SHA256SUMS` are served from [get.theapiary.sh](https://get.theapiary.sh).

Prefer to build from source?

```bash
git clone https://github.com/legioncodeinc/honeycomb.git
cd honeycomb
npm install
npm run build          # tsc + esbuild → bundle/cli.js, daemon, harness, MCP, embed bundles

node bundle/cli.js setup     # detect your assistants, wire hooks, start the daemon
node bundle/cli.js status    # check the daemon and your environment
```

`setup` wires every coding assistant it detects and starts the loopback daemon; any storage command auto-starts the daemon if it is down. You'll need Activeloop Deeplake credentials; the device flow above writes them to the shared `~/.deeplake/credentials.json`.

> **Self-hosting the storage backend?** You can run Honeycomb against Activeloop's open-source [`pg_deeplake`](https://quay.io/activeloopai/pg-deeplake) Postgres extension instead of hosted Deeplake, and point Honeycomb at it with `honeycomb login --endpoint postgres://...` (direct) or `--endpoint https://...` (HTTP gateway), no Activeloop account required. See the self-hosting guide for the setup and the backend contract.

#### Using the dashboard

The dashboard is **Hive portal at `http://127.0.0.1:3853`**, the one UI for the whole Apiary stack and the first thing the installer opens. Honeycomb's old in-daemon dashboard is retired; the daemon on `:3850` serves data, the portal serves the picture. Everything Honeycomb knows shows up there: KPIs up top (memories, turns, estimated savings, team skills), memory recall you can query by hand, the codebase graph, every captured turn, skill-sync status, and settings, hydrated server-side from the daemon's API. It doubles as the guided-setup surface for first-time login.

#### Using the CLI

One unified `honeycomb` binary drives everything. Run `honeycomb --help` for the full list; these are the core verbs:

```bash
honeycomb install                    # one-shot install on a fresh machine
honeycomb setup                      # detect your coding assistants and wire hooks
honeycomb status                     # daemon + environment health at a glance
honeycomb daemon start|stop|status   # drive the daemon directly
honeycomb remember "<fact>"          # write a memory from anywhere
honeycomb recall "<query>"           # search the shared memory
honeycomb sessions                   # browse captured sessions
honeycomb skill                      # list, inspect, and sync mined skills
honeycomb goal                       # track goals across sessions
honeycomb sources                    # manage capture sources
honeycomb graph                      # query the codebase and knowledge graphs
honeycomb dashboard                  # open the dashboard (Hive portal, :3853)
```

#### First memory, shared across tools

```bash
# Capture a decision once…
honeycomb remember "we deploy from the prd-022 branch, never from main"

# …recall it anywhere: same daemon, same Deeplake, any harness
honeycomb recall "how do we deploy"
```

Write it from Claude Code; recall it from Cursor tomorrow on a different laptop. That's the whole point.

#### How it works

Honeycomb is a long-lived local **daemon** plus thin clients. The daemon is the *only* process that talks to storage. Every harness, the CLI, the MCP server, and the SDK reach it over loopback HTTP. One shared memory behind one boundary; your Deeplake credentials in exactly one place.

```mermaid
flowchart TB
    CC["Claude Code"] --> TC
    CU["Cursor"] --> TC
    CX["Codex"] --> TC
    HE["Hermes"] --> TC
    PI["pi"] --> TC
    OC["OpenClaw"] --> TC
    TC["thin clients<br/>hooks · CLI · MCP · SDK"] --> HTTP["loopback HTTP<br/>127.0.0.1:3850"]
    HTTP --> D["honeycomb daemon<br/>capture · recall · skillify · pollinate · session priming<br/>sole storage client, owns your credentials"]
    D --> DL["Activeloop Deeplake<br/>Tier 1 · Tier 2 · Tier 3<br/>BM25 + semantic vectors"]
```

- **Capture on every turn.** Per-harness hooks stream each turn to the daemon, which distills and persists it: always-on, cheap, and soft-failing so a capture error never breaks your agent's turn.
- **Recall through the daemon.** Any harness asks for relevant memories; the daemon runs the query and returns results already scoped to your org and workspace. The client never sees a storage handle or a line of SQL.
- **Shared by construction.** Every client reaches the same daemon and the same dataset, so a memory written from one harness is recallable from all of them.

#### The three-tier memory system

This is the heart of what **Legion Code** adds on top of Deeplake. The same memory lives at three levels of detail at once, and the agent chooses how far to zoom:

| Tier | What it is | When it's used |
|---|---|---|
| **Tier 1 · Key** | One keyword-dense sentence per session or fact. The index. | Skimmed at session start during priming. |
| **Tier 2 · Summary** | A distilled recap: goals, decisions, blockers, outcomes. Carries the semantic embedding. | Pulled when a key looks relevant. |
| **Tier 3 · Raw** | The full session dialogue: exact turns and tool calls, never rewritten. | Resolved when the agent needs ground truth. |

Resolution is a **deterministic SQL join, not a fuzzy search**. `key → summary → raw` is a pointer walk down three Deeplake tables. Mining ("find the thing I didn't know to name") is where the hybrid vector + lexical search kicks in. Cheap when you're skimming, precise when you're zooming.

#### Why Deeplake makes the difference

Most agent-memory tools bolt onto a vector-only store, which forces *every* access pattern through a similarity engine. Honeycomb's zoom model needs both exact joins **and** semantic search, and [**Deeplake**](https://deeplake.ai), the database for AI, gives it both natively:

- **SQL + vector in one engine.** The cheap skim and the deterministic zoom run as SQL; semantic mining runs as vector search; a single store serves both. No second database, no sync problem.
- **Versioned & append-only.** Writes bump a version instead of mutating in place, so memory's full history stays on disk. Supersession marks old facts stale without losing them, which is what makes the pollinating loop safe and auditable.
- **Hybrid lexical + semantic search.** BM25 and 768-dim `nomic-embed-text-v1.5` cosine arms, fused by Reciprocal Rank Fusion. Turn embeddings off and recall silently falls back to lexical, never an error, no quality cliff.
- **Built to scale & BYOC.** The same substrate that serves one developer's laptop serves an organization's entire history, in your own cloud bucket if you want it.

> Honeycomb stands on two shoulders: **[Deeplake](https://deeplake.ai)** gives the memories somewhere durable and queryable to live, and **[Hivemind](https://github.com/activeloopai/hivemind)**, Activeloop's open-source agent-memory project, is the foundation Legion Code extended into Honeycomb's multi-tier system.

#### Supported harnesses

Honeycomb supports 3 harnesses in production (Claude Code, Codex, Cursor). Hermes, pi, and OpenClaw are in progress.

| Supported today | In progress |
|---|---|
| **Claude Code**, **Cursor**, **Codex** | **Hermes**, **pi**, **OpenClaw** |

`honeycomb setup` detects the ones you have installed and wires each idempotently; `honeycomb uninstall` reverses only Honeycomb's changes. A skill mined while you were in Cursor is auto-pulled and ready in Claude Code on your next session.

#### Other interfaces

Beyond the CLI, three more ways to reach the same daemon and the same shared memory:

- **Dashboard.** Hive portal at `http://127.0.0.1:3853`, covered above. One front door for the whole stack; Honeycomb's data hydrates through it.
- **MCP server.** A [Model Context Protocol](https://modelcontextprotocol.io) server (bundled to `mcp/bundle`) exposing Honeycomb's read/resolve and search/mine tools to any MCP-capable host.
- **TypeScript SDK.** The `@legioncodeinc/honeycomb` client with framework subpath entries (`/react`, `/vercel`, `/openai`). The core entry is fetch-only and browser-safe; `react` and `ai` are optional peers.

 Status & Roadmap

Honeycomb is **production ready (v0.2.x)** and fully tested in live scenarios. We document what's real and flag what's opt-in.

**Production today**
- Capture-to-recall, proven end-to-end and live-tested against Deeplake (`npm run smoke:golden-path` with credentials).
- One-command install → guided dashboard setup, the loopback daemon, the unified CLI, per-harness hooks, the MCP server, and the SDK.
- Three-tier memory, session priming, skillify + propagation, the pollinating loop, the knowledge graph, and the codebase graph.
- Self-hosted backends: point the CLI at your own Postgres-backed Deeplake endpoint with `honeycomb login --endpoint`, with idle connection hibernation for scale-to-zero.

**Opt-in / by design**
- **Embeddings are opt-in.** Recall runs the lexical BM25 path by default; turning on the local embedding runtime (≈600 MB, model fetched on first warmup) adds 768-dim semantic recall. The fallback is silent and intentional; recall never errors when embeddings are unavailable.
- **The distillation pipeline is off by default** to avoid surprise model spend; enable it when you want background summarization and graph extraction.
- The daemon binds **loopback only** (single machine). Cross-device and cross-user sharing happen through Deeplake's org/workspace scope, not a remote daemon bind.

Full documentation and guides live at **[theapiary.sh](https://theapiary.sh)**; vote on what ships next at **[ideas.theapiary.sh](https://ideas.theapiary.sh)**.

#### Development

```bash
npm install          # dependencies
npm run build        # tsc + esbuild → bundle/cli.js, the daemon, harness, MCP, and embed bundles
npm run ci           # the gate: typecheck + duplication (jscpd) + tests (vitest) + SQL-safety audit
```

`npm run ci` is the quality gate every change must pass.

#### Credits

Honeycomb exists because two halves fit together:

- **[Activeloop](https://activeloop.ai/)** brings **[Deeplake](https://deeplake.ai/)** (the versioned, multi-modal database for AI with native vector + columnar indexing and hybrid search) and **[Hivemind](https://github.com/activeloopai/hivemind)**, the open-source agent-memory project Honeycomb is built upon.
- **[Legion Code Inc](https://github.com/legioncodeinc)** brings the multi-tier memory system (Tier 1 / 2 / 3 keys, summaries, raw), code base atlas memory architecture, auto healing service, session priming, automatic skill development & propagation, the pollinating loop, the knowledge graph, cross device cross repository cross team skill sharing, and the daemon architecture that turns Deeplake into a shared brain your coding agents read and write on every turn.

#### License

Honeycomb is licensed under the **GNU Affero General Public License v3.0 or later** (AGPL-3.0-or-later).

Use it commercially or privately, free of charge. In return: keep the copyright and lic

### Architecture overview

#### The concept

honeycomb gives your AI coding assistants one shared, lasting memory. A small program (the daemon) runs on your machine, watches what happens as you work across the assistants you already use, distills it into clean notes, and serves those notes back to any assistant that asks. The design problem honeycomb solves is that coding assistants share almost nothing at their integration layer, yet a real memory system needs a single place to run its pipeline, its knowledge graph, and its maintenance loops. honeycomb answers both: write the memory logic once inside a daemon, then wrap it per assistant with thin shims that are clients of that daemon.

#### The four planes

honeycomb is daemon-centric. Everything points at the daemon, and only the daemon points at storage.

```mermaid
flowchart TB
    subgraph surfaces[Surfaces]
        cli[CLI]
        dash[Dashboard]
        cursorExt[Cursor extension]
    end
    subgraph integrations[Assistant integrations]
        connectors[Connectors, install-time]
        hooks[Lifecycle hooks]
        mcp[MCP server]
        sdk[SDK]
    end
    subgraph runtime[honeycomb daemon, port 3850]
        capture[Capture intake]
        pipeline[Pipeline]
        retrieval[Hybrid retrieval and browse]
        ontology[Knowledge graph]
        pollinating[Maintenance loop]
        router[Model and provider router]
        workers[Skillify, summaries, codebase graph]
    end
    store[(Storage: GPU-backed SQL plus vector)]

    cli --> runtime
    dash --> runtime
    cursorExt --> integrations
    connectors --> runtime
    hooks --> runtime
    mcp --> runtime
    sdk --> runtime
    capture --> store
    pipeline --> store
    retrieval --> store
```

- **Surfaces** are how a person drives honeycomb: the CLI, the local dashboard, and the Cursor extension.
- **Integrations** are how external assistants reach it: install-time connectors, lifecycle hooks, the MCP server, and the SDK.
- **The daemon** is the runtime where all logic lives, on port `3850` by default.
- **Storage** is the substrate: a GPU-backed SQL and vector store where all durable state lives, isolated by organization and workspace.

#### The shape of the loop

Capture, distill, recall, compound. An assistant hook captures every prompt, tool call, and response as a raw event. The daemon's pipeline distills those events into facts, entities, and skills, each with provenance back to the source. Recall serves the right context before the next turn through hybrid search and a browsable virtual filesystem. Over time, a maintenance loop and a skill miner consolidate what was learned, so memory gets sharper instead of noisier.

#### The daemon as the only storage client

The single most important property of the architecture is that no process other than the daemon talks to storage. Hooks, the CLI, the SDK, and MCP tools assemble a request, hand it to the daemon over a local loopback connection, and render the response. They never open a storage connection themselves. This collapses the storage-facing surface to one process, which is where scoping, SQL construction and escaping, encryption, and schema healing all live. Adding a new assistant means writing a new thin shim, not a new engine; fixing the engine means editing the daemon, and every assistant inherits the fix.

#### Surfaces to reach the daemon

A consuming assistant or application can reach the daemon four ways, all thin clients:

| Surface | Used by | Nature |
|---|---|---|
| Connectors | Install time | Patch the assistant's config, write hook handlers, link skills, register MCP. Run once, never at session time. |
| Lifecycle hooks | Every session | Map native lifecycle events to capture and recall calls on the daemon. |
| MCP server | MCP-speaking assistants | On-demand tool surface in the assistant's native tool list. |
| SDK | Applications and custom agents | A typed HTTP client (`@honeycomb/sdk`) over the daemon API. |

#### Contracts that keep the planes apart

Three contracts hold the system together:

- **One storage client.** The daemon is the only process with a storage handle. A compromised or buggy client cannot reach storage directly or cross a tenant boundary, because the daemon re-derives scope from the validated token on every request.
- **One active runtime path per session.** A session can be reachable through more than one integration surface. The first path to touch a session claims it; a request from the other path on that session returns `409`. Stale claims expire and are swept, so a crashed assistant never locks a session forever.
- **Three-level tenancy.** Organization, then workspace, then project. Organization and workspace isolation is enforced at the storage layer, so two workspaces never share a row, partition, or index. Project is the soft inner ring that scopes recall to the repository the agent is working in without ever dropping a capture. Within a workspace, an `agent_id` and a visibility setting separate agents.

#### Getting in

Onboarding is one command. The installer detects and sets up a Node runtime, installs the global package, brings the daemon up, and lands you on the dashboard, with sign-in driven from the dashboard rather than the terminal. The daemon does not need credentials to boot; it serves a guided-setup state until you sign in, then serves the authenticated views on the next request with no restart. See the getting started guide and the CLI reference.

#### Where to read next

- Capture and memory: how a raw event becomes a structured fact.
- Recall and retrieval: how the right context is found and shaped.
- The knowledge graph: the ontology and the codebase graph.
- Harness integrations: how honeycomb plugs underneath six assistants.
- Data and storage: the table catalog and the storage patterns.
- Security model: trust boundaries, scoping, secrets, and telemetry.

### Capture and memory

#### The concept

A memory starts life as raw text: a prompt, a tool call, a response. On its own that is searchable but dumb. The capture-and-memory path turns it into something the retrieval layer can reason over, discrete facts with confidence scores, entities and relationships, and hints about what questions the memory could answer later. The one rule that never bends is that a slow or failing model must never cost you a memory. The raw content is committed first; everything after that is enrichment that runs asynchronously, off the write path.

#### Capture: from a session event to a row

Every assistant fires lifecycle events. honeycomb's per-assistant hooks are thin clients: when an event fires, the hook reads the credential, normalizes the assistant's native payload into the shape the daemon expects, and makes a local request to the daemon. The daemon writes one row per event into the raw `sessions` table. The hook builds no SQL, holds no storage handle, and decides no scope; it states what happened and lets the daemon persist it.

Three event types are captured:

- **Prompt events** record the user's prompt text.
- **Tool-call events** record the tool name, its input, and its response.
- **Assistant-response events** record the assistant's last message.

Each request carries session metadata (session id, working directory, permission mode, the native event name, and the `agent_id`) and an optional message embedding. Capture is append-only: readers reconstruct a session by concatenating its rows in order.

##### Capture opt-out

Setting `HONEYCOMB_CAPTURE=false` places honeycomb in read-only mode for sensitive workflows. In that mode the capture hooks still run but skip asking the daemon to write any trace data, and the table-ensure step is skipped. Recall and search still work. This is a per-session escape hatch for working with credentials, PII-heavy files, or regulated data.

#### The pipeline: from a raw memory to a distilled fact

Once a raw memory is written, the daemon makes it smart. The work runs as durable jobs with a lease, complete, fail, and dead-letter lifecycle, exponential backoff, and a reaper for stale leases. Jobs survive a daemon restart.

```mermaid
flowchart TD
    capture["Raw memory written"] --> extract["Extraction (model): facts plus entity triples"]
    extract --> decide["Decision (model): add / update / delete / none"]
    decide --> writes["Controlled writes to the distilled-memory table"]
    writes --> graph["Graph persistence (separate write)"]
    graph --> hints["Prospective hints (model)"]
    hints --> done["Done"]
```

##### Extraction

The extraction worker leases a job and asks the model to decompose the memory into facts (each with content, a type, and a confidence between 0 and 1) and entities (triples of source, relationship, target). Input is capped and output is bounded (roughly 20 facts and 50 entities, with per-fact length limits). Invalid fields are logged and dropped rather than failing the whole job.

##### Decision

For each extracted fact, the decision stage runs a hybrid search for the few existing candidates and asks the model what to do: add, update, delete, or none, with a target memory, a confidence, and a reason. With no candidates it proposes an immediate add without a model call. Every proposal, applied or not, is recorded to an audit history. That history is what makes shadow mode and audits possible.

##### Controlled writes

This is the only stage that mutates the distilled-memory table. Embeddings are prefetched before the write so no network call happens while committing. An add proposal must clear a minimum fact confidence (default 0.7), have non-empty normalized content, and not collide with an existing content hash (a content-hash check returns the existing memory rather than inserting a duplicate). Updates and deletes run a contradiction check, are flagged for review, and apply only when explicitly allowed, landing as append-only, version-bumped writes rather than in-place edits.

##### Graph persistence and prospective hints

After the memory write commits, graph structure is written separately: entities upsert by canonical name, relationships by their triple, and mention links insert-or-ignore so reprocessing is idempotent. A failure here logs a warning and does not revert the facts already written, because the facts matter more than the edges. Finally, if hints are enabled, a pass generates hypothetical future queries the memory would answer and indexes them, so retrieval can match a query against the hint, not only the literal text.

#### Default posture: nothing surprises you with model spend

The pipeline worker is constructed and started on every daemon boot, but the stage handlers default **off** by design, so no model spend happens without an explicit opt-in. Stages are enabled individually through `HONEYCOMB_PIPELINE_*` environment variables (or the equivalent `agent.yaml` flags).

| Flag | Effect |
|---|---|
| `enabled` | Master switch. Off means no extraction jobs are processed. |
| `shadowMode` | Run extraction and decision but write nothing; proposals are logged to history. |
| `mutationsFrozen` | Emergency read-only brake; supersedes shadow mode. |
| `graph.enabled` | Enable graph reads, traversal, and recall boosting. |
| `graph.extractionWritesEnabled` | Let background extraction persist entity triples. |
| `autonomous.enabled` | Allow scheduled maintenance and retention. |
| `autonomous.frozen` | Hard stop on maintenance even when autonomous is enabled. |
| `hints.enabled` | Run prospective-hint generation at write time. |

Default flag states can change between versions; confirm the defaults that ship with your installed version.

#### Embeddings

When embeddings are enabled (the default), captured turns and deliberately stored memories land with a real 768-dimension vector from a local embedding model (`nomic-embed-text-v1.5`), downloaded once and warmed in the background. The vector dimension is locked end to end against the storage columns and the model output; a vector of the wrong dimension is rejected rather than silently written. Turning embeddings off (`HONEYCOMB_EMBEDDINGS=false`) makes recall use its lexical fallback. The retrieval side of this is covered in recall and retrieval.

#### The other workers

Beyond the write-path stages, the daemon runs background workers on their own schedules: a document worker that ingests URLs and files, a retention worker that runs batch-limited purges, a maintenance worker that runs diagnostics and either logs recommendations or executes repairs, a summary worker that writes the canonical transcript and summary at session end, and a synthesis worker that regenerates a rebuildable `MEMORY.md` projection from durable memories and the session ledger.

#### Where to read next

- Recall and retrieval: how distilled memory is found and shaped.
- The knowledge graph: the ontology these writes feed.
- Data and storage: the table catalog.
- Harness integrations: the hooks that feed capture.

### Data and storage

#### The concept

All of honeycomb's durable state lives in tables on a GPU-backed SQL and vector store. The daemon is the only process that opens that store; everything else reaches it through the daemon. The storage layer has a few unusual properties that shape every table and every write pattern, so it pays to understand them before reading the catalog.

#### Storage properties a practitioner must know

- **Lazy schema healing.** Tables and columns are created on first write, not through an upfront migration. A new column added with a safe default is filled in on the next heal pass, so adding a field does not require a migration step ahead of the worker that writes it. Schema changes are additive.
- **No parameterized queries.** The query endpoint takes no bound parameters, so the daemon builds SQL by string composition and escapes every value itself through dedicated helpers. This is why all SQL construction lives in one place (the daemon) and never in a client.
- **Append-only, version-bumped writes.** The backend coalesces updates in a way that can silently drop concurrent edits, so honeycomb does not lean on naive in-place updates for hot tables. The current state of a versioned row is its highest version; a change appends a new version rather than mutating the old one.
- **Select-before-insert with drift detection.** Writes that must be unique check for an existing row first and re-verify after, making concurrent-writer races observable rather than silent, because the backend has no server-side unique constraint to lean on.
- **Tenant isolation at the storage layer.** Organization and workspace isolation is enforced at the storage partition, so two workspaces never share a row, partition, or index. Most tables therefore do not need explicit tenancy columns; a few cross-cutting tables carry explicit organization and workspace ids.

#### The three "memory" tables

Three tables are easy to confuse because they all hold something called memory. Fix them first.

| Table | Holds | Written by |
|---|---|---|
| `sessions` | The raw capture stream, one row per event | Capture |
| `memories` | The distilled engine output, the facts the pipeline decided to keep | The pipeline |
| `memory` | Wiki summaries and the virtual-filesystem file rows | The summary worker |

Capture writes `sessions`; the pipeline reads `sessions` and writes `memories`; the summary worker writes `memory`.

```mermaid
flowchart LR
    sessions["sessions (raw events)"] --> pipeline["pipeline"]
    pipeline --> memories["memories (distilled facts)"]
    pipeline --> entities["entities plus ontology"]
    sessions --> summary["summary worker"]
    summary --> memory["memory (wiki plus browse)"]
    memories --> skills["skillify -> skills"]
```

- **`sessions`** holds one row per prompt, tool call, or response. Its message body is structured JSON, with an optional vector. Rows are append-only inserts; readers concatenate by path in time order.
- **`memory`** holds wiki summaries and browse-surface file rows. It is update-or-insert keyed by path and carries a one-line key for fast session priming.
- **`memories`** is the engine's distilled output, with confidence, importance, provenance, a dedup hash, a soft-delete flag, and scope columns. It is the table recall ranks over. Each row carries a durable one-sentence key written at distillation time so the session-priming digest can skim durable keys with a pure SQL select and no generation at read time.

#### The distilled-memory schema (illustrative)

```sql
CREATE TABLE IF NOT EXISTS "memories" (
  id                 TEXT NOT NULL DEFAULT '',
  type               TEXT NOT NULL DEFAULT 'fact',
  content            TEXT NOT NULL DEFAULT '',
  key                TEXT NOT NULL DEFAULT '',
  normalized_content TEXT NOT NULL DEFAULT '',
  content_hash       TEXT NOT NULL DEFAULT '',
  confidence         FLOAT4 NOT NULL DEFAULT 1.0,
  importance         FLOAT4 NOT NULL DEFAULT 0.5,
  tags               TEXT NOT NULL DEFAULT '[]',
  project            TEXT NOT NULL DEFAULT '',
  project_id         TEXT NOT NULL DEFAULT '',
  source_id          TEXT NOT NULL DEFAULT '',
  source_type        TEXT NOT NULL DEFAULT '',
  pinned             BIGINT NOT NULL DEFAULT 0,
  is_deleted         BIGINT NOT NULL DEFAULT 0,
  agent_id           TEXT NOT NULL DEFAULT 'default',
  visibility         TEXT NOT NULL DEFAULT 'global',
  content_embedding  FLOAT4[],
  created_at         TEXT NOT NULL DEFAULT '',
  updated_at         TEXT NOT NULL DEFAULT ''
) USING deeplake;
```

The `key` column is additive and heal-compatible; a row with no derived key falls back to its content at read time, so a legacy un-keyed row is still primeable.

#### The rest of the catalog

| Group | Tables | What they hold |
|---|---|---|
| Engine support | `memory_history`, `memory_jobs`, `embeddings` | The audit trail of every proposal, the durable distillation job queue, and the vectors mirrored for GPU search. |
| Knowledge graph | `entities`, `entity_aspects`, `entity_attributes`, `entity_dependencies`, `memory_entity_mentions`, `epistemic_assertions`, `ontology_proposals` | The ontology, with supersession by appended attribute version. |
| Sources and documents | `memory_artifacts`, `documents`, `document_memories`, `connectors` | Source-backed rows keyed by source id, the ingest lifecycle, the document-to-chunk join, and external-connector sync cursors. |
| Product tables | `skills`, `rules`, `goals`, `kpis`, `codebase` | Mined skill versions, org-wide rules, goals and KPIs, and codebase-graph snapshots. |
| Tenancy and auth | `agents`, `api_keys`, `projects`, `synced_assets` | The within-workspace agent roster and read policies, hashed connector keys, the per-workspace project registry, and the team asset-sync substrate. |
| Telemetry | (opt-in counters and an optional recall-quality ledger) | Usage counters and diagnostics; never carries secrets or request bodies. |

Skills and rules are append-only and version-bumped (the current state for a logical key is the highest version). Goals and KPIs are update-or-insert by their logical key. Snapshots in `codebase` are one row per repository-checkout identity, deduped by a content hash.

#### Per-project scoping

Tenancy has a third, soft ring inside a workspace: the project. A `projects` registry records the projects a folder can bind to. Memory and skills carry a resolved project id that the scope clause segments on, defaulting to a reserved per-workspace inbox so a capture is never dropped when no project resolves. A project is a registry-backed identity, not a repository id; a canonical git remote is only an optional auto-bind signal. Cross-project sharing of a skill is an explicit, auditable opt-in recorded directly on the row.

#### The memory virtual filesystem

honeycomb presents the team-shared database as an ordinary directory and intercepts the shell commands that touch that mount, so an assistant browses memory with `cat`, `ls`, `grep`, and `find` while every operation is really a scoped query. No real files exist at these paths: every read hits an in-memory cache, a pending-write buffer, or a query, and every write is buffered and flushed on a timer.

Three things the intercept hides from the agent:

- **Write batching.** A read immediately after a write reads from the pending buffer, so the agent sees its own write even before it reaches storage.
- **The multi-row session layout.** A session "file" is dozens of rows concatenated transparently. Session files are read-only at this layer; attempts to write, append, remove, copy, or move them are rejected, because they are an append-only event log owned by capture.
- **The structured goals and KPIs tables.** Goals and KPIs appear as plain markdown files, so an agent manages objectives with file operations while the CLI reads the same state from typed columns. Goal lifecycle is expressed through file verbs: removing a goal file is a soft close (status flipped, the row preserved for the audit trail), and moving a goal between status folders is a status transition that may change only the status component.

A synthesized index file at the mount root lists the most recent summaries and sessions, and a synthesized subtree renders the codebase-graph queries from the local snapshot. The same browse view is produced by both the long-lived shell object and the stateless pre-tool hook, sharing one renderer so they never disagree.

#### Retention

Because the backend exposes no transactions at this layer, retention runs as batched, idempotent sweeps in a daemon worker rather than cascading deletes.

| Data | Default behavior |
|---|---|
| `sessions` raw events | Pruned by the sessions-prune operation; summaries retained in `memory` |
| `memories` | Soft-delete window before purge; history retained longer |
| `memory_jobs` | Completed jobs purged after a window; dead jobs later |
| `memory_artifacts` | Soft-delete on source-file removal, hard purge on source disconnect by source id |
| `skills` / `rules` | Append-only version history retained |
| Embeddings / vectors | Purged with their owning row during retention sweeps |

#### Where to read next

- Capture and memory: the pipeline that writes these tables.
- Recall and retrieval: how recall ranks over them.
- The knowledge graph: the ontology and codebase tables.
- Security model: how rows stay in their tenant lane.

### The knowledge graph

#### The concept

honeycomb keeps two graphs, and they answer different questions. The **memory knowledge graph** (the ontology) captures what was learned: the entities, claims, and relationships distilled from your sessions. The **codebase graph** captures how your code is actually wired: files, symbols, and the edges between them, extracted straight from source. Recall over raw traces tells an agent what was discussed; these graphs tell it what is true and how the code connects.

---

#### Part one: the memory ontology

The pipeline that distills memories also writes graph structure. The ontology is a set of related concepts:

- **Entities** are canonical things (a service, a person, a convention), keyed by canonical name and carrying a type and an agent scope.
- **Aspects** are weighted dimensions of an entity.
- **Attributes** are claim values about an entity. Each attribute carries a kind, a status, a claim key that names the slot it fills, a group key, and a version.
- **Dependencies** are audited edges between entities, each with a type, a strength, a confidence, and a required reason for loose links.
- **Mentions** join a memory to the entities it references.
- **Assertions** record the epistemic act: who claimed, believed, observed, decided, preferred, denied, or questioned something.
- **Proposals** are the audited control plane for changes to the ontology.

##### Supersession instead of mutation

The storage backend cannot safely update a row in place, so the ontology never mutates a claim. When a claim changes, a new attribute version is appended and the prior one is marked superseded. Readers resolve a claim slot by its highest version, so the current value wins and the history is preserved. This is the same append-only discipline the rest of honeycomb uses, and it is why recall can keep a stale claim off the result set with a pure version comparison rather than a destructive edit.

##### How the ontology earns its place in recall

Graph traversal is one of recall's candidate channels: a high-degree entity can surface related memory identifiers. As with every other channel, it produces identifiers only, and the scope filter authorizes them before any content loads, so a strong graph hit can never leak content past an agent's read policy. Graph reads, traversal, and recall boosting are gated by the pipeline's graph flags, so an operator can run the engine with or without graph influence.

---

#### Part two: the codebase graph

The codebase graph subsystem extracts files, symbols, and relationships directly from source, so an agent can ask "who calls this function", "what is the blast radius of changing this symbol", or "walk me through this subsystem" and get answers grounded in the current checkout rather than in prose.

The output mirrors the NetworkX node-link JSON format (a directed multigraph), so any tool that understands NetworkX graphs can consume a snapshot. The feature is AST-only: it uses tree-sitter parsers, never a language server, a type checker, or an LLM, which keeps builds fast and deterministic. Nine languages are supported: TypeScript, JavaScript, Python, Go, Rust, Java, Ruby, C, and C++.

##### The build pipeline

A build walks the repository, extracts every supported source file, aggregates one snapshot, and writes it to disk. Source discovery prefers git's own ignore engine so it honors `.gitignore` exactly, with a manual walk as a fallback when git is unavailable. Each file is content-hashed and looked up in a per-file cache before extraction, so a rebuild after a one-file change takes tens of milliseconds rather than seconds. Extraction routes each file to a language-appropriate extractor that produces a uniform shape, which keeps the snapshot builder language-agnostic.

##### The node and edge model

A node represents one code construct, with an id formatted `::`.

| Node field | Meaning |
|---|---|
| `id` | Unique key within a snapshot |
| `label` | Display name |
| `kind` | `function`, `class`, `method`, `interface`, `type_alias`, `enum`, `const`, `variable`, or `module` |
| `source_file` | Repository-relative path |
| `source_location` | A line or line range |
| `language` | One of the nine supported languages |
| `exported` | Whether the symbol is exported |
| `fan_in`, `fan_out`, `is_entrypoint` | Derived after cross-file resolution |

Edges are directed and typed. The relation is one of `imports`, `calls`, `extends`, `implements`, or `method_of`, and each carries a confidence (current edges are almost entirely concrete AST facts).

##### Cross-file resolution is high-confidence only

After every file is extracted, three passes turn per-file placeholders into real cross-file edges, and ambiguous cases are dropped rather than guessed. The calls pass resolves a call only when it matches a named or namespace import whose export exists in a resolvable local file; default imports, bare package specifiers, path aliases, barrel re-exports, instance dispatch, and dynamic imports are deliberately skipped. The imports pass repoints an import edge to the real module when the specifier resolves to a known repository file and keeps an `external:` marker otherwise, so "our code versus a dependency" stays distinguishable. The heritage pass resolves `extends` and `implements` to a same-file or named-import base type.

This is an honest limitation worth surfacing to consumers: because cross-file calls are resolved only for relative named and namespace imports, a symbol reading "incoming (0)" is **not** proof of dead code. A caller may reach it through an unresolved import path.

##### Deterministic, content-addressed snapshots

A snapshot is canonicalized before it is hashed or written: nodes and edges are sorted, and the JSON is serialized with sorted keys and no inserted whitespace, so the same code always serializes to the same bytes. The content hash covers only the stable graph fields and deliberately excludes volatile observation metadata (timestamp, branch, worktree, generator version), so two builds of identical code on different worktrees or at different times produce the same hash and dedup correctly. Snapshots are written atomically, so a crash leaves either the old file or the new one, never a partial.

##### Cloud sync and the query surface

A successful build best-effort pushes the snapshot to the cloud when you are authenticated; the local snapshot is the source of truth, and a push failure never blocks the build. The push uses a select-before-insert with drift detection: an identical hash is a no-op, a different hash for the same commit logs a drift warning and refuses to overwrite (because the same commit producing different content means extractor drift a human should investigate), and a missing row inserts. A teammate can pull the freshest snapshot for the current `HEAD`.

Agents read the graph through a synthesized query surface that renders text on the fly from the local snapshot:

| Query | Returns |
|---|---|
| Overview | Commit, node and edge counts, kind breakdowns, top files, limitations |
| Find | Substring and fuzzy search on node id and label |
| Show | Full node detail plus incoming and outgoing edges by relation |
| Impact | Transitive dependents (blast radius) of a symbol |
| Neighborhood | Symbols in a file plus their cross-file neighbors |
| Layers | Architectural subsystem grouping by path heuristic |
| Tour | A deterministic dependency-ordered walkthrough |
| Path | The shortest path between two symbol patterns |

The renderers carry an honest caveat: a snapshot whose source files have been edited since the build is stale and should be cross-checked against live source.

#### Where to read next

- Capture and memory: the pipeline that writes the ontology.
- Recall and retrieval: traversal as a recall channel.
- Data and storage: the tables behind both graphs.
- CLI reference: the `honeycomb graph` commands.

### Recall and retrieval

#### The concept

Recall is the moment honeycomb earns its keep: before the next turn, it hands the assistant the right context. That has to be four things at once. **Cheap**, because it cannot run a model on every query by default. **Scoped**, because it must never return a memory the requesting agent is not allowed to see. **Current**, because a superseded fact must not outrank the fact that replaced it. And **shaped**, because the few results that reach the assistant should be the distinct, fresh, relevant ones, not five paraphrases of one fact, and not a six-month-old claim above last week's.

#### How a query flows

```mermaid
flowchart TD
    query["Recall query"] --> lexical["Lexical arms over the memory tables (full-text or substring)"]
    query --> semantic["Semantic arms: cosine per table (optional)"]
    lexical --> fuse["Reciprocal-rank fusion plus provenance weights"]
    semantic --> fuse
    fuse --> rerank["Rerank top-k (default off)"]
    rerank --> dedup["Collapse near-duplicates (default on)"]
    dedup --> recency["Recency dampening (default neutral)"]
    recency --> budget["Token budget plus diversity (opt-in)"]
    budget --> scope["Scope filter: org and workspace partition, agent read policy"]
    scope --> out["Ranked, shaped results, with an honest degraded flag"]
```

#### Lexical and semantic arms

Recall runs a combined query over three tables: the durable distilled facts, the per-session summaries, and the raw dialogue rows. Each arm is separately guarded, so a missing sibling table degrades that one arm to empty rather than failing the whole recall. The lexical arms use full-text search when the index is present and fall back to a substring match when it is not.

When embeddings are enabled, the query is embedded and a cosine arm runs per table, scored as a normalized cosine in the range 0 to 1. Vectors are stored as tensor columns and searched on the GPU-backed engine, so the similarity filter and the scope filter run in one query rather than against a separate vector index.

#### Semantic recall is the default

A fresh signed-in user gets hybrid lexical plus 768-dimension semantic recall out of the box. Sign-in provisions and warms the local embedding model in the background, so the cosine path is what a real user hits. The system is honest about when it is degraded: recall reports `degraded: false` when the semantic arm actually ran, and `degraded: true` only on a genuine fallback, embeddings explicitly off, the model still warming, the embed worker unreachable or crashed, a per-call timeout, or a malformed response. In every degraded case recall still answers from the lexical arms. **Recall never throws and never hangs on the embedding path**, because a degraded answer beats an error for an agent's turn.

#### Fusion: provenance-forward ranking

Recall hits carry a real, comparable score, and results are ordered by relevance, never by arm order and never by a client-side fabrication. The per-arm ranked lists are blended with Reciprocal Rank Fusion, which is scale-free and needs no calibration between the lexical and semantic score scales. Two shaping rules ride the fusion:

- **Provenance weights** fold source quality into the rank: distilled summaries weight higher than raw session rows, so a raw tool-call blob needs a materially stronger signal to outrank a clean distilled fact. Distilled facts above raw dumps is the product-correct order.
- **Identity dedup** collapses the same source-plus-id across arms, and every hit keeps its source and scope provenance.

A note for practitioners: the storage backend ships a native hybrid operator that fuses vector and full-text in one statement. honeycomb deliberately does **not** use it, because measured evaluation found it did not beat the in-house fusion. "Hybrid" here means SQL for structure plus vector for similarity, fused in honeycomb's own reciprocal-rank step, not the backend's native operator. Treat that as a settled decision unless your installed version's documentation says otherwise.

#### The shaping stages

Above the fusion floor, recall runs four shaping stages in a fixed order, each wired into the live pipeline behind an honest default that was measured (or measured neutral) on a committed evaluation set. The defaults are deliberately conservative: ship the behavior that measurably helps, and leave the rest opt-in.

| Stage | Default | What it does |
|---|---|---|
| Reranker | off (fusion order unchanged) | Re-scores the top-k by raw cosine of the query against candidate embeddings. Real and wired, dormant by default after a measured near-zero lift. Timeout-budgeted; on timeout it keeps the prior order. |
| Semantic dedup | on | Collapses near-duplicate hits whose embeddings exceed a similarity threshold, keeping the highest-provenance copy (memory over summary over session). Fails soft to the un-deduped list. |
| Recency dampening | neutral (near-infinite half-life) | A multiplicative age decay on the fused score; demotes stale rows, never a hard cutoff, never drops a row by age. Neutral until a caller tunes it. |
| Token budget and diversity | opt-in (engages on a positive token budget) | Fills a token budget with a maximal-marginal-relevance selection, trading a little pure relevance for diversity. With no budget, the unchanged top-k path runs. |

Default stage states can change between versions; confirm them against your installed version.

#### The authorization boundary

Recall is where scoping has to be exactly right, because the candidate channels (full-text, vector, graph traversal, hints) cast a wide net. The defense is ordering: those channels produce memory identifiers only, and the scope filter authorizes candidates **before** any content loads. Every content-bearing stage that follows (reranking, summaries, transcript expansion, access tracking) runs only on the authorized set. A strong vector hit or a high-degree entity can surface an identifier, but it cannot leak content past the read policy. The outer ring (organization and workspace) is enforced at the storage partition beneath this, so even a buggy inner clause cannot cross a workspace boundary. The full scope model is in the security model.

#### Currentness

Superseded facts are kept off the result set by the append-only model itself: a soft-delete flag and a superseded status exclude stale versions at query time, and readers resolve by the highest version, so a newer fact in the same slot outranks the one it replaced. Recency dampening is a soft freshness signal layered on top of this hard version invariant; the two are complementary, not redundant.

#### The browse surface

Beyond scored recall, agents can browse memory as a virtual filesystem: ordinary shell commands against a memory mount, intercepted and routed to scoped queries. From the agent's point of view it is browsing files; underneath, each operation is a query against the session and memory tables. This is the explicit, agent-driven recall that bypasses the inject-on-confidence rule. Either way, scored recall or browse, the same authorization boundary applies before any content is returned. The browse mechanics are covered in data and storage.

#### How recall is measured

Every ranking change is provable on a committed evaluation set, not asserted. A harness scores a hand-curated set of query-to-expected-memory pairs (deliberately including pairs with no surface-token overlap, so the set exercises the semantic lift) on recall at k, mean reciprocal rank, and a position-discounted graded-relevance metric. A committed baseline is enforced: a change that regresses it fails. This is what lets the "semantic on by default" posture and each shaping default be defended by measurement rather than by claim.

#### Where to read next

- Capture and memory: how the facts recall ranks over are produced.
- The knowledge graph: traversal as a candidate channel.
- Security model: the scope and visibility rules recall enforces.
- MCP tools reference: the recall and browse tools.

### Harness integrations

#### The concept

honeycomb does not try to be another agent shell. It runs underneath the coding assistants people already use and gives them one shared memory layer. The hard part is that every assistant exposes a different extension surface, and they share almost nothing at the integration layer. The answer is to write the memory logic once inside the daemon and wrap it per assistant with a thin shim. Adding an assistant means writing a shim and a connector, not a memory engine.

honeycomb wires six assistants: **Claude Code, Codex, Cursor, Hermes, pi, and OpenClaw**. Each reaches the daemon through the same surfaces, and the daemon, the only process that touches storage, does the real work behind every one.

#### Three surfaces, one daemon

An assistant reaches honeycomb through three kinds of surface, all thin clients of the daemon. None touch storage directly.

- A **connector** is install-time. It runs once during `honeycomb setup` or `honeycomb connect `, patches the assistant's config, writes the compiled hook handlers, links team skills into the assistant's locations, and registers the MCP server where the assistant speaks MCP. Connectors never run at session time.
- A **hook** is a lifecycle event the assistant fires that calls the daemon. Hooks are how capture and automatic recall happen.
- An **MCP server** is the on-demand tool surface a registered server a harness invokes to ask for memory operations explicitly.

```mermaid
flowchart TD
    setup["honeycomb setup / connect"] --> connector["Connector (install-time): patch config, write handlers, link skills, register MCP"]
    connector --> files["Config plus hook handlers on disk"]
    session["Assistant session"] --> hooks["Lifecycle hooks (thin clients)"]
    session --> mcp["MCP tools (on demand)"]
    files --> hooks
    hooks --> daemon["honeycomb daemon"]
    mcp --> daemon
    daemon --> store[(Storage)]
```

#### The connector contract

Every per-assistant connector is a subclass of a shared base. The base owns install and uninstall and all the shared mechanics; a subclass overrides only four small seams: where the assistant keeps its hook config, which compiled handlers to write, where to link skills, and the native event-name map. All filesystem access goes through an injectable seam, so a connector is testable against an in-memory filesystem and a real config directory is never touched in a test.

Two invariants make a connector safe to run repeatedly:

- **Idempotent.** Every honeycomb config entry is stamped with a sentinel field. On re-install, the connector filters its own prior entries out by that sentinel, appends fresh ones, and writes the config only if the serialized bytes changed. A no-change re-run writes nothing, so the assistant's hook-trust fingerprint is unchanged and no re-trust dialog appears. This is why `honeycomb setup` is safe to run on every upgrade.
- **Foreign-safe.** A third-party hook never carries the sentinel, so honeycomb never reclaims it. Install preserves foreign entries verbatim; uninstall removes only honeycomb's entries and only honeycomb's skill links. A real directory or a foreign symlink at a target path is left untouched.

#### Capability detection

Each connector reports whether its assistant is installed by checking that the assistant's config root exists on disk. The CLI drives the registry off that probe: `honeycomb setup` wires every detected assistant, `honeycomb connect ` wires exactly one, and `honeycomb uninstall` reverses only honeycomb's footprint for one assistant or for every detected one.

#### The support matrix

Each assistant wires the same logical lifecycle events through its own mechanism; the shim normalizes the native event names and payloads into the daemon's shared shape.

| Assistant | Surfaces | Notes |
|---|---|---|
| Claude Code | Marketplace plugin plus hooks plus MCP | Reference connector and reference hook set; model-only context channel |
| Codex | Config-file hooks plus MCP | Nested matcher-block config shape; user-visible context |
| Cursor | Config hooks plus first-party extension plus MCP | Flat per-event config shape; editor extension; normalizes its shell tool to the canonical shape |
| Hermes | Skill plus shell hooks plus MCP | Terminal-only tool capture; user-visible context with an MCP-tools mention |
| pi | Managed extension plus an `AGENTS.md` marker block | On-demand recall; context from the static marker block |
| OpenClaw | Native extension (flagship) plus connector plus MCP | Batches capture at the end of an agent run; auto-routes the agent from the session key |

The differences are real but shallow: native event names and payload fields vary, and the context channel is model-only on some assistants and user-visible on others, so each shim normalizes before handing off and renders the context block through its assistant's channel.

#### The hook lifecycle

Each assistant maps its native events onto a shared set of logical events. A blank in one assistant's column does not mean a gap in coverage: OpenClaw, for example, batches capture across the whole conversation at the end of a run rather than per event, producing the same rows the daemon would have written incrementally; pi reads its session-start context from a static marker block rather than a live event.

| Logical event | What it does |
|---|---|
| Session start / recall inject | Load credentials, heal token drift, self-update, ensure tables, render the rules and goals context block plus the memory-prime digest, auto-pull team skills and assets, spawn a graph-pull worker, return context. |
| Prompt capture | Send the user's prompt as one capture request. |
| Pre-tool intercept | Route memory-path tool calls to daemon-backed reads and searches (the browse surface). |
| Tool-call capture | Send the tool name, input, and response as one capture request. |
| Assistant-response capture | Send the assistant's last message; optionally evaluate a trigger that can fire the skill miner. |
| Session end / summary | Mark the session ended, record usage, fire skill mining, and spawn the summary worker. |

Every hook is a thin client: it reads the credential, normalizes the payload, and makes a local request to the daemon. The hook builds no SQL, holds no storage handle, and decides no scope. The cross-assistant logic (the session-start sequence, capture, the browse intercept, session end, context rendering) lives in a shared core that every shim routes through, so a Cursor shell tool and a Claude Code bash tool reach the same shared intercept.

##### The session-start auto-pull seam

The session-start step that makes team collaboration feel live is the auto-pull. On every session start the hook asks the daemon to pull the latest team skills and portable assets. Both pulls are idempotent (a re-pull of a version already on disk writes nothing), fail-soft (any error, daemon down, non-200, refused socket, or timeout, is swallowed so session start is never blocked), and time-budgeted (a short abort timer, so a hung daemon never delays the first turn). Both honor a kill switch (`HONEYCOMB_AUTOPULL_DISABLED=1` for skills, `HONEYCOMB_ASSET_AUTOPULL_DISABLED=1` for assets). This is why a teammate's freshly mined skill or promoted asset becomes visible within seconds of publication.

##### The browse intercept

Before a tool runs, the pre-tool hook looks for memory-path tool calls and rewrites the result from the daemon's response: `cat` or `Read` on a path becomes a direct row read, `grep` or `Glob` becomes a hybrid search, `ls` becomes a path-prefix listing, and `find` becomes a path-pattern query. Write and edit on a memory path are denied with guidance to use the CLI instead, and commands the browse layer cannot model are rewritten to a harmless no-op. Coverage differs by assistant (some intercept the shell tool, some terminal tools only, some have no intercept), but the normalized shape means the same daemon-backed intercept applies wherever it runs.

#### MCP registration at install

For assistants that speak MCP, the MCP server is registered during install so its tools appear in the assistant's native tool list, with no separate "add an MCP server" step for the user. The server ships as a self-contained bundle and is registered as a stdio entry; the daemon additionally serves an HTTP transport for HTTP-speaking clients. The tool surface is documented in the MCP tools reference.

#### Identity sync

A workspace `AGENTS.md` file is the source of truth for operating instructions, and the daemon's file watcher syncs it into each assistant's identity file, each copy stamped do-not-edit. A manual re-sync is available through the harnesses-regenerate route.

#### Where to read next

- Architecture overview: how the surfaces fit the daemon.
- Capture and memory: what the hooks feed.
- MCP tools reference: the on-demand tool surface.
- CLI reference: `setup`, `connect`, and `uninstall`.

### Security model

#### The concept

honeycomb captures coding sessions and memories, which is some of the most sensitive data a developer tool handles. Its security model rests on one structural decision: the daemon is the only process that talks to storage, so the storage-facing attack surface is a single chokepoint where scoping, escaping, encryption, and isolation all live. Everything else (hooks, the CLI, the SDK, MCP tools) is a thin client that asks the daemon to do work and never holds a storage handle.

#### Trust boundaries

```mermaid
flowchart TD
    userBrowser([User browser])
    agentProcess([Coding assistant process])
    hookProcess([Hook / thin-client process])
    daemon([honeycomb daemon, port 3850])
    credFile([~/.deeplake/credentials.json])
    store([Storage: GPU SQL/vector])
    tenant([Org/workspace partition])

    userBrowser -- "OAuth approval over HTTPS" --> daemon
    agentProcess -- "spawns hooks, same OS user" --> hookProcess
    hookProcess -- "read 0600 file" --> credFile
    hookProcess -- "local loopback RPC" --> daemon
    daemon -- "the only path to storage" --> store
    store -- "org/workspace scoped rows" --> tenant
```

The single most important property of the map is that no process other than the daemon has a line into storage.

| Zone | Trust level |
|---|---|
| User browser (OAuth approval page) | User-trusted, separate from the assistant |
| Coding assistant process | Host OS user |
| Hook / thin-client process | Same OS user as the assistant |
| honeycomb daemon | Same OS user; the sole storage authority |
| Credentials file | Mode 0600, OS user only |
| Storage | Reached only by the daemon; tenant isolation enforced here, encrypted at rest |

Consequences of the chokepoint: a compromised hook can ask the daemon to do work on the user's behalf, but it cannot reach storage directly and cannot read another organization's data, because the daemon re-derives scope from the validated token on every request. SQL construction and escaping live in the daemon, so a thin client cannot smuggle raw SQL to storage. Tenant isolation is enforced at the storage layer, not at a client a user could patch.

#### Authentication and authorization

honeycomb separates **who you are** from **what you can do**.

Identity comes from an OAuth 2.0 Device Authorization Flow that mints a long-lived, organization-bound token, written to a local file at mode `0600`. No password is ever sent, and the short-lived access token is discarded rather than persisted.

Authorization is mode-aware. The daemon runs in one of three modes:

| Mode | Posture |
|---|---|
| `local` | No authentication; the daemon binds to localhost. For a single developer. |
| `team` | Every request needs a valid token or API key; unauthenticated requests get `401`; all operations are rate-limited and scoped. The default for a shared deployment. |
| `hybrid` | Localhost requests are trusted by the TCP peer address from the socket (not the spoofable `Host` header); remote clients must present a token; missing socket info fails closed. |

In team and hybrid modes, four roles (`admin`, `operator`, `agent`, `readonly`) map to permission sets, and admin, token, diagnostics, source, connector, secret, ontology-mutation, and org or workspace routes always carry an explicit permission check. Remote connectors use named API keys: revocable, stored hashed, prefixed `hc_sk_...`, printed once at creation, narrowable with an explicit permission list, and bindable to a connector, harness, agent, and allowed projects.

##### Token handling at boundaries

The access token is read from disk at hook startup and handed to the daemon. It is never passed as a command-line argument (which would be visible in a process list) and never written to a child process environment. Only the daemon makes the network call to storage, over TLS, with the token in an HTTP header rather than a URL parameter. Token-adjacent log messages are written to standard error, not standard output, so callers that read hook output as structured data cannot parse them.

##### Resolving token drift

If a user switches organizations, the stored active organization can disagree with the token's organization claim, which would otherwise query the wrong tenant. The daemon heals this on session start: it decodes the token's organization claim, compares it to the active organization, and re-mints a corrected token if they disagree, before any request reaches storage.

#### Scoping and visibility

honeycomb scopes memory in two rings, and both must hold for a row to be visible.

The **outer ring** is tenancy: organization and workspace, enforced at the storage partition so two workspaces never share a row, partition, or index. The organization and workspace passed with every request are validated server-side against the token's organization claim, so a token minted for one organization cannot read another by editing a header or the credentials file.

The **inner ring** is the agent: within a workspace, every read and write threads an `agent_id`, and an agent's roster row carries a read policy:

| Policy | What the agent sees within its workspace |
|---|---|
| `isolated` (fail-closed default) | Only its own memories |
| `shared` | Workspace-global memories plus its own |
| `group` | Global memories from agents in the same policy group, plus its own |

The inner ring is compiled into a SQL clause that every memory query carries, so a new code path either includes it or does not, which makes scoping auditable. The outer ring is enforced beneath it, so even a buggy inner clause cannot cross a workspace boundary.

##### The authorization boundary in recall

Recall's candidate channels (full-text, vector, graph traversal, hints) cast a wide net, so the defense is ordering: those channels produce identifiers only, and the scope clause authorizes candidates before any content loads. Every content-bearing stage that follows runs only on the authorized set, so a strong vector hit or a high-degree entity can surface an identifier but cannot leak content past the read policy.

##### Fail-closed posture

The subsystem leans toward refusing rather than over-sharing. A malformed caller falls back to `isolated` rather than widening access. Tenancy, scope, graph policy, mutation gates, and source access all fail closed. Failures return structured errors with enough context to diagnose, rather than silently downgrading. When in doubt, deny.

#### Secrets: usable, never readable

If an assistant could read an API key, a single prompt injection could exfiltrate it. honeycomb breaks that link: secrets are encrypted at rest, an assistant can cause them to be used, and an assistant never receives the decrypted values. Secrets are the one class of data that does **not** live in the shared store; they sit encrypted on the daemon host, so even a full dump of the store yields no credentials.

- **Encryption.** Secrets are stored as encrypted files (mode 0600, directories 0700) using an audited, zero-dependency cipher. The key is derived from a machine-bound identifier and scope-bound, so copying the encrypted tree to another machine yields nothing usable.
- **No read path.** The API exposes secret names but never values. There is deliberately no "read a secret value" endpoint, through the API, the SDK, MCP, the dashboard, a connector, or diagnostics.
- **The exec model.** To use a secret, a caller queues an exec job. The daemon resolves the references, spawns a subprocess with the secrets in its environment under a timeout and a bounded worker pool, and redacts any secret value from the output before the caller sees it. A command can authenticate to an external service without the credential ever passing through the agent's context.

The local secret store generalizes into a single machine-bound encrypted vault that holds typed record classes behind one seam, with each class declaring its read posture (a value-returning setting versus an internal-only secret) as data, so a secret can never be read through the settings path. A credential-copy migration into the vault is non-destructive by construction: it copies the login token and performs zero writes to the original credentials file, which stays authoritative.

#### Telemetry egress

honeycomb may emit anonymized operator telemetry from the daemon to an operator-owned analytics backend, for install-funnel attribution and operational health. This is the one outbound boundary other than the daemon-to-storage path, and it is governed by a single non-negotiable rule.

**The content versus operation bright line.** Telemetry may describe how the tool behaves (counts, durations, versions, states, error classes). It must never describe the content the tool handles (memory or session text, code, prompts, recall queries, file paths, working directory, repository or branch names, organization or workspace names, identities, secrets). The test for any property is the shrug test: would the user shrug if they saw this value in plaintext? If they would lean in and squint, it does not ship.

Boundary invariants worth knowing as a practitioner:

- **Daemon-only emitter** through a single chokepoint with a hardcoded allow-list; a structural test asserts the banned set is absent from every event.
- **No item-level egress**: no per-memory, per-query, or per-file events, because the cardinality itself is a signal.
- **Tiered consent**: operational lifecycle events are opt-out; usage-count events are opt-in. Setting `DO_NOT_TRACK=1` or `HONEYCOMB_TELEMETRY=0` silences all of it, and an unkeyed build emits nothing.
- **Glass-box**: `honeycomb telemetry --show` renders, in plaintext, exactly what has been and would be sent, so the displayed set is provably the egress set.
- **Anonymous identity**: the distinct id is a random per-machine install id, never an email or a content-derived hash, and the ingest key is write-only.

This boundary is independent of capture opt-out: `HONEYCOMB_CAPTURE=false` governs what your memory records into storage; the telemetry switches govern what operational metadata leaves for the operator.

#### Hook consent

honeycomb installs hooks into assistant lifecycle events, and each assistant platform enforces its own consent model before running foreign hooks (a trust prompt, a marketplace approval, an operator-controlled config file, or a user-controlled directory). No hook runs silently without an explicit user action, and the install command shows a one-line consent notice before opening the browser for authentication.

#### Data classification

| Data type | At rest | In transit | Access scope |
|---|---|---|---|
| Access token | Plaintext, mode 0600 | Bearer header, daemon to backend over TLS | OS user only |
| Secrets | Encrypted, decrypted in the daemon on demand | TLS | Scoped per the secrets rules; never returned |
| Session traces | Encrypted at rest in the tenant partition | TLS | All members of the organization workspace |
| Memory summaries | Encrypted at rest | TLS | Organization workspace members |
| Operator telemetry | No content at rest beyond the local event log | TLS, write-only ingest key | Operator only; opt-out and glass-box; never carries content |

Workspace-level isolation is the outer boundary; within a workspace, members share the trace and skill surface by design, with the agent read policy narrowing where the engine enforces it.

#### Where to read next

- Architecture overview: the daemon-as-chokepoint design.
- Recall and retrieval: the authorization boundary in recall.
- Data and storage: how tenant isolation is enforced at the storage layer.
- API reference: the auth modes, roles, and status codes.

### Schema

The canonical table catalog for Honeycomb on DeepLake: the capture and summary tables, the distilled-memory engine model, the knowledge graph, sources, the product tables (skills, rules, goals, KPIs, codebase), and the tenancy and auth tables.

#### How to read this catalog

Every table here lives in DeepLake and is written through the daemon using the patterns in `deeplake-storage.md`. Org and workspace isolation is enforced at the storage partition layer, so most tables do not need explicit tenancy columns; the engine tables additionally carry `agent_id` (default `'default'`), a `visibility` for within-workspace scoping, and a resolved `project_id` for per-project segmentation; and a few cross-cutting tenant-scoped tables (notably `codebase`, `projects`, and `synced_assets`) carry explicit `org_id` and `workspace_id`. DDL shown below is the logical shape; the runtime source of truth is the daemon's schema definition module, and the lazy heal pass converges every table toward it.

Three tables are easy to confuse because they all hold "memory," so fix them first. `sessions` is the raw capture stream (one row per event). `memories` is the distilled engine output (facts the pipeline decided to keep). `memory` is the wiki-summary and virtual-filesystem table. Capture writes `sessions`; the pipeline reads `sessions` and writes `memories`; the summary worker writes `memory`.

```mermaid
flowchart LR
    sessions["sessions (raw events)"] --> pipeline["pipeline"]
    pipeline --> memories["memories (distilled facts)"]
    pipeline --> entities["entities + ontology"]
    sessions --> summary["summary worker"]
    summary --> memory["memory (wiki + VFS)"]
    memories --> skills["skillify -> skills"]
```

#### Capture and summaries

`sessions` holds the raw event stream from capture: one row per prompt, tool call, or response. Its `message` is `JSONB` because each row is a structured payload, and `message_embedding` is the optional 768-dim vector. Rows are append-only INSERTs; readers concatenate by `path` ordered by `creation_date`.

```sql
CREATE TABLE IF NOT EXISTS "sessions" (
  id                TEXT NOT NULL DEFAULT '',
  path              TEXT NOT NULL DEFAULT '',
  filename          TEXT NOT NULL DEFAULT '',
  message           JSONB,
  message_embedding FLOAT4[],
  author            TEXT NOT NULL DEFAULT '',
  agent             TEXT NOT NULL DEFAULT '',
  project           TEXT NOT NULL DEFAULT '',
  project_id        TEXT NOT NULL DEFAULT '',
  plugin_version    TEXT NOT NULL DEFAULT '',
  agent_id          TEXT NOT NULL DEFAULT 'default',
  visibility        TEXT NOT NULL DEFAULT 'global',
  creation_date     TEXT NOT NULL DEFAULT '',
  last_update_date  TEXT NOT NULL DEFAULT ''
) USING deeplake;
```

The `project` column is the existing free-text raw cwd path, kept for display and back-compat. `project_id` is the **resolved registry key** the scope clause segments on (per-project isolation), defaulting to `''` which resolves to the workspace `__unsorted__` inbox at read time. The same `project` / `project_id` pair, and the `agent_id` / `visibility` scope columns, are added to `memory` and `memories` below. The resolution and isolation model is documented in `../architecture/multi-project-and-context-switching.md`.

`memory` holds wiki summaries and the virtual-filesystem file rows. Its `summary` is the file body and `summary_embedding` powers semantic recall over summaries. It is UPDATE-or-INSERT keyed by `path`. The VFS dispatch over this table is documented in `memory-virtual-filesystem.md`.

```sql
CREATE TABLE IF NOT EXISTS "memory" (
  id                TEXT NOT NULL DEFAULT '',
  path              TEXT NOT NULL DEFAULT '',
  filename          TEXT NOT NULL DEFAULT '',
  summary           TEXT NOT NULL DEFAULT '',
  summary_embedding FLOAT4[],
  description       TEXT NOT NULL DEFAULT '',
  key               TEXT NOT NULL DEFAULT '',
  version           BIGINT NOT NULL DEFAULT 0,
  author            TEXT NOT NULL DEFAULT '',
  mime_type         TEXT NOT NULL DEFAULT 'text/plain',
  project           TEXT NOT NULL DEFAULT '',
  project_id        TEXT NOT NULL DEFAULT '',
  agent             TEXT NOT NULL DEFAULT '',
  agent_id          TEXT NOT NULL DEFAULT 'default',
  visibility        TEXT NOT NULL DEFAULT 'global',
  creation_date     TEXT NOT NULL DEFAULT '',
  last_update_date  TEXT NOT NULL DEFAULT ''
) USING deeplake;
```

#### Distilled memory: the engine model

`memories` is the engine's output, the facts the pipeline decided to keep, with confidence, importance, provenance, dedup hash, and scope. It is the table recall ranks over.

```sql
CREATE TABLE IF NOT EXISTS "memories" (
  id                 TEXT NOT NULL DEFAULT '',
  type               TEXT NOT NULL DEFAULT 'fact',
  content            TEXT NOT NULL DEFAULT '',
  key                TEXT NOT NULL DEFAULT '',
  normalized_content TEXT NOT NULL DEFAULT '',
  content_hash       TEXT NOT NULL DEFAULT '',
  confidence         FLOAT4 NOT NULL DEFAULT 1.0,
  importance         FLOAT4 NOT NULL DEFAULT 0.5,
  tags               TEXT NOT NULL DEFAULT '[]',
  who                TEXT NOT NULL DEFAULT '',
  project            TEXT NOT NULL DEFAULT '',
  project_id         TEXT NOT NULL DEFAULT '',
  source_id          TEXT NOT NULL DEFAULT '',
  source_type        TEXT NOT NULL DEFAULT '',
  pinned             BIGINT NOT NULL DEFAULT 0,
  is_deleted         BIGINT NOT NULL DEFAULT 0,
  extraction_status  TEXT NOT NULL DEFAULT 'none',
  agent_id           TEXT NOT NULL DEFAULT 'default',
  visibility         TEXT NOT NULL DEFAULT 'global',
  content_embedding  FLOAT4[],
  created_at         TEXT NOT NULL DEFAULT '',
  updated_at         TEXT NOT NULL DEFAULT ''
) USING deeplake;
```

The `key` column is the durable **Tier-1 key**: a one-sentence, keyword-dense headline of the distilled fact, written at distillation time so the session-priming digest can skim durable keys with a pure SQL select and no generation at read time. It is additive and heal-compatible (`NOT NULL DEFAULT ''`); a fact with no derived key falls back to its `content` at read time, so a legacy un-keyed row is still primeable. The same durable `key` appears on `memory` and on the wiki-summary rows. The priming flow is documented in `../ai/session-priming-architecture.md`.

Supporting the engine: `memory_history` is the audit trail (every proposal, applied or shadowed, with `changed_by` distinguishing the harness from `pipeline` and `pipeline-shadow`); `memory_jobs` is the durable distillation queue (lease, complete, fail, dead, with bounded retries) that lets work survive a daemon restart; embeddings are stored on the `content_embedding` column and mirrored for GPU vector search. The pipeline that writes these is `../ai/memory-pipeline.md`.

#### Knowledge graph

The ontology is a set of related tables: `entities` (canonical name, type, agent scope, optional source provenance), `entity_aspects` (weighted dimensions), `entity_attributes` (claim values with `kind`, `status`, `claim_key`, `group_key`, and version lineage), `entity_dependencies` (audited edges with type, strength, confidence, and a required reason for loose links), `memory_entity_mentions` (the memory-to-entity join), `epistemic_assertions` (who claimed, believed, observed, decided, preferred, denied, questioned), and `ontology_proposals` (the audited control plane). Because DeepLake cannot safely update in place, supersession appends a new attribute version and marks the prior one superseded rather than mutating it. The model is documented in `../ai/knowledge-graph-ontology.md`.

```sql
CREATE TABLE IF NOT EXISTS "entity_attributes" (
  id                 TEXT NOT NULL DEFAULT '',
  aspect_id          TEXT NOT NULL DEFAULT '',
  agent_id           TEXT NOT NULL DEFAULT 'default',
  memory_id          TEXT NOT NULL DEFAULT '',
  kind               TEXT NOT NULL DEFAULT 'attribute',
  content            TEXT NOT NULL DEFAULT '',
  confidence         FLOAT4 NOT NULL DEFAULT 0.0,
  importance         FLOAT4 NOT NULL DEFAULT 0.5,
  status             TEXT NOT NULL DEFAULT 'active',
  superseded_by      TEXT NOT NULL DEFAULT '',
  claim_key          TEXT NOT NULL DEFAULT '',
  group_key          TEXT NOT NULL DEFAULT '',
  version            BIGINT NOT NULL DEFAULT 1,
  created_at         TEXT NOT NULL DEFAULT '',
  updated_at         TEXT NOT NULL DEFAULT ''
) USING deeplake;
```

#### Sources and documents

External knowledge bases and ad-hoc documents land in their own tables. `memory_artifacts` holds source-backed rows keyed by `source_id` so a source can be purged cleanly; `documents` tracks ingested URLs and files through the `queued -> extracting -> chunking -> embedding -> indexing -> done` lifecycle; `document_memories` joins a document to its chunk memories; `connectors` tracks external connectors and their sync cursors. Soft-delete advances a status rather than updating in place, in keeping with the DeepLake write patterns. The lifecycle is documented in `../sources/source-lifecycle.md`.

#### Skills, rules, goals, KPIs

These are the product tables carried from Hivemind. `skills` holds mined `SKILL.md` versions (append-only, version-bumped, with `scope`, `author`, `contributors`, `source_sessions`); `rules` holds org-wide principles (append-only, version-bumped); `goals` and `kpis` are UPDATE-or-INSERT by logical key, backed by the virtual-filesystem path conventions.

```sql
CREATE TABLE IF NOT EXISTS "skills" (
  id                    TEXT NOT NULL DEFAULT '',
  name                  TEXT NOT NULL DEFAULT '',
  project_key           TEXT NOT NULL DEFAULT '',
  project_id            TEXT NOT NULL DEFAULT '',
  scope                 TEXT NOT NULL DEFAULT 'me',
  install               TEXT NOT NULL DEFAULT 'project',
  author                TEXT NOT NULL DEFAULT '',
  contributors          TEXT NOT NULL DEFAULT '[]',
  source_sessions       TEXT NOT NULL DEFAULT '[]',
  description           TEXT NOT NULL DEFAULT '',
  trigger_text          TEXT NOT NULL DEFAULT '',
  body                  TEXT NOT NULL DEFAULT '',
  version               BIGINT NOT NULL DEFAULT 1,
  cross_project_scope   TEXT NOT NULL DEFAULT 'none',
  promoted_by           TEXT NOT NULL DEFAULT '',
  promoted_at           TEXT NOT NULL DEFAULT '',
  promoted_from_project TEXT NOT NULL DEFAULT '',
  agent_id              TEXT NOT NULL DEFAULT 'default',
  visibility            TEXT NOT NULL DEFAULT 'global',
  created_at            TEXT NOT NULL DEFAULT '',
  updated_at            TEXT NOT NULL DEFAULT ''
) USING deeplake;
```

The current state for a `(project_key, name)` pair is the highest version. The legacy path-derived `project_key` stays for back-compat, while `project_id` is the **resolved registry key** the surfacing predicate segments on, so a skill mined in one project is not surfaced in another. Cross-project sharing is an explicit, auditable opt-in recorded directly on the row: `cross_project_scope` (`none` is the project-scoped default; widened values are the promotion), with `promoted_by` / `promoted_at` / `promoted_from_project` carrying the provenance. The isolation and promotion model is in `../architecture/multi-project-and-context-switching.md`; skillify and team sharing that read and write this table are documented in `../ai/skillify-pipeline.md` and `../collaboration/team-skills-sharing.md`.

#### Codebase graph

`codebase` stores one snapshot row per `(org, workspace, repo, user, worktree, commit)` identity. `snapshot_jsonb` holds the canonical node-link JSON and `snapshot_sha256` dedups identical content and detects extractor drift. The push path uses SELECT-before-INSERT and re-verifies to make concurrent-writer races observable. The build and pull lifecycle is in `codebase-graph.md`.

```sql
CREATE TABLE IF NOT EXISTS "codebase" (
  org_id            TEXT NOT NULL DEFAULT '',
  workspace_id      TEXT NOT NULL DEFAULT '',
  repo_slug         TEXT NOT NULL DEFAULT '',
  user_id           TEXT NOT NULL DEFAULT '',
  worktree_id       TEXT NOT NULL DEFAULT '',
  commit_sha        TEXT NOT NULL DEFAULT '',
  branch            TEXT NOT NULL DEFAULT '',
  snapshot_sha256   TEXT NOT NULL DEFAULT '',
  snapshot_jsonb    TEXT NOT NULL DEFAULT '',
  node_count        BIGINT NOT NULL DEFAULT 0,
  edge_count        BIGINT NOT NULL DEFAULT 0,
  generator_version TEXT NOT NULL DEFAULT '',
  schema_version    BIGINT NOT NULL DEFAULT 1
) USING deeplake;
```

#### Tenancy, agents, and auth

`agents` is the within-workspace roster that drives read-policy enforcement (`isolated`, `shared`, `group` with a `policy_group`). `api_keys` holds named, revocable, hashed credentials for remote connectors, with a role, scope, optional explicit permission list, and connector/harness/agent binding. Org and workspace identity is carried on every request and resolved by DeepLake; the model is documented in `../multi-tenant/org-workspace-model.md`, and the auth that consumes `api_keys` and `agents` is in `../auth/auth-architecture.md` and `../security/scoping-and-visibility.md`.

```sql
CREATE TABLE IF NOT EXISTS "agents" (
  id           TEXT NOT NULL DEFAULT '',
  name         TEXT NOT NULL DEFAULT '',
  read_policy  TEXT NOT NULL DEFAULT 'isolated',
  policy_group TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT '',
  updated_at   TEXT NOT NULL DEFAULT ''
) USING deeplake;
```

#### Projects registry

`projects` is the per-workspace registry of projects a folder can be bound to, the third tenancy level (Org → Workspace → Project) that segments memory and skills inside a workspace. It is a cross-cutting tenant-scoped table carrying explicit `org_id` and `workspace_id` (like `agents` and `synced_assets`), UPDATE-or-INSERT keyed by `project_id` because project CRUD is low-frequency and human-driven. A project is a registry-backed identity, **not** a GitHub repo id; a canonical git remote is only an optional auto-bind signal.

```sql
CREATE TABLE IF NOT EXISTS "projects" (
  project_id    TEXT NOT NULL DEFAULT '',
  name          TEXT NOT NULL DEFAULT '',
  remote_signal TEXT NOT NULL DEFAULT '',
  bound_paths   TEXT NOT NULL DEFAULT '[]',
  is_reserved   BIGINT NOT NULL DEFAULT 0,
  org_id        TEXT NOT NULL DEFAULT '',
  workspace_id  TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT '',
  updated_at    TEXT NOT NULL DEFAULT ''
) USING deeplake;
```

`remote_signal` is the canonicalized git remote (`host/owner/repo`) stored as a discrete column so the git-signal resolution branch is a single indexed equality lookup; `bound_paths` is a JSON array of normalized path prefixes, read whole by the longest-prefix matcher. `is_reserved` is `1` only on the reserved per-workspace `__unsorted__` inbox project, the bucket a session falls to when no binding, git signal, or path candidate resolves, so capture is never dropped. A user-created project may not collide with the reserved id or name. The resolution precedence and the local `~/.deeplake/projects.json` cache the thin client reads are documented in `../architecture/multi-project-and-context-switching.md`.

#### Synced assets

`synced_assets` is the team asset-sync substrate: the rows that propagate skills (and other asset types) across a team's devices and harnesses. It is tenant-scoped (explicit `org` / `workspace`) and append-only, version-bumped, the current state for a `honeycomb_id` is the highest `version`, and a removal is a `tombstone` row, never a DELETE.

```sql
CREATE TABLE IF NOT EXISTS "synced_assets" (
  honeycomb_id  TEXT NOT NULL DEFAULT '',
  version       BIGINT NOT NULL DEFAULT 1,
  asset_type    TEXT NOT NULL DEFAULT 'skill',
  harness       TEXT NOT NULL DEFAULT '',
  native        TEXT NOT NULL DEFAULT '',
  canonical     TEXT NOT NULL DEFAULT '',
  content_hash  TEXT NOT NULL DEFAULT '',
  tombstone     TEXT NOT NULL DEFAULT 'false',
  tier          TEXT NOT NULL DEFAULT 'Local',
  style         TEXT NOT NULL DEFAULT 'Repository',
  org           TEXT NOT NULL DEFAULT '',
  workspace     TEXT NOT NULL DEFAULT '',
  author        TEXT NOT NULL DEFAULT '',
  device_set    TEXT NOT NULL DEFAULT '[]',
  created_at    TEXT NOT NULL DEFAULT ''
) USING deeplake;
```

The `native` and `canonical` blobs are the per-harness and canonical asset payloads; `tier` × `style` is the placement lattice cell a version was published at; `device_set` is the JSON array of device ids for Device-tier audience. The sync lifecycle that reads and writes this table is described in `../collaboration/asset-sync-substrate.md`.

#### Telemetry

Telemetry is opt-in and local to the deployment: usage counters and an optional recall QA ledger, used for diagnostics and never carrying secrets or request bodies. The router's redacted routing history (see `../ai/model-provider-router.md`) lands here too.

#### Spend ledger and teams (ROI)

`roi_metrics` is the **shared, cross-device spend ledger** that backs the ROI Tracker (see `../operations/roi-tracker.md`). It is tenant-scoped (explicit `org_id`/`workspace_id`) and **append-only**, one immutable row per session via `appendOnlyInsert`; a re-price APPENDs a new row with a fresh `price_ref` and the canonical row per `session_id` is `MAX(created_at)`, there is **no UPDATE path**. Every money column is **BIGINT integer cents, never FLOAT** (a ledger reconciles to the penny), and measured / modeled / allocated are kept as separate, self-describing columns so a modeled estimate can never read as a measured fact. `user_id` is **gated**, it stays `''` until a verified `backend-token` claim populates it (no git-email / `$USER` / OS-login fallback, no backfill). Indexes are lookup-only on the rollup columns; there is **no embedding column, no JSONB, no BM25, no vector**.

```sql
CREATE TABLE IF NOT EXISTS "roi_metrics" (
  id                            TEXT NOT NULL DEFAULT '',
  session_id                    TEXT NOT NULL DEFAULT '',
  org_id                        TEXT NOT NULL DEFAULT '',
  workspace_id                  TEXT NOT NULL DEFAULT '',
  agent_id                      TEXT NOT NULL DEFAULT 'default',
  project_id                    TEXT NOT NULL DEFAULT '',
  team_id                       TEXT NOT NULL DEFAULT '',
  user_id                       TEXT NOT NULL DEFAULT '',   -- GATED: '' until a verified backend-token claim
  input_tokens                  BIGINT NOT NULL DEFAULT 0,
  output_tokens                 BIGINT NOT NULL DEFAULT 0,
  cache_read_tokens             BIGINT NOT NULL DEFAULT 0,
  cache_creation_tokens         BIGINT NOT NULL DEFAULT 0,
  measured_cache_savings_cents  BIGINT NOT NULL DEFAULT 0,  -- MEASURED, billed fact
  modeled_savings_cents         BIGINT NOT NULL DEFAULT 0,  -- MODELED, labeled estimate
  modeled_assumption_ref        TEXT NOT NULL DEFAULT '',
  gross_cost_cents              BIGINT NOT NULL DEFAULT 0,
  infra_cost_cents              BIGINT NOT NULL DEFAULT 0,
  cost_basis                    TEXT NOT NULL DEFAULT 'none', -- measured | allocated | none
  allocation_method             TEXT NOT NULL DEFAULT '',
  price_ref                     TEXT NOT NULL DEFAULT '',
  period_start                  TEXT NOT NULL DEFAULT '',
  period_end                    TEXT NOT NULL DEFAULT '',
  created_at                    TEXT NOT NULL DEFAULT ''
) USING deeplake;
```

`teams` is the roster `roi_metrics.team_id` resolves against at ROI-write time. It is tenant-scoped and **version-bumped** (one row per (team, member); an edit APPENDs version N+1, read `ORDER BY version DESC`, the same primitive `api_keys` uses for the same backend-non-convergence reason). `member_type` is an `'agent'｜'user'` union, `agent` rows work today and `user` rows are inert until `user_id` is verified.

```sql
CREATE TABLE IF NOT EXISTS "teams" (
  id           TEXT NOT NULL DEFAULT '',
  team_id      TEXT NOT NULL DEFAULT '',
  team_name    TEXT NOT NULL DEFAULT '',
  member_type  TEXT NOT NULL DEFAULT 'agent',  -- agent (live) | user (inert until user_id verified)
  member_id    TEXT NOT NULL DEFAULT '',
  role         TEXT NOT NULL DEFAULT 'member',
  active       BIGINT NOT NULL DEFAULT 1,
  org_id       TEXT NOT NULL DEFAULT '',
  workspace_id TEXT NOT NULL DEFAULT '',
  version      BIGINT NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT '',
  updated_at   TEXT NOT NULL DEFAULT ''
) USING deeplake;
```

The `sessions` capture table additionally gained five additive token/cache columns (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`) plus a `source_tool` discriminant, added via additive schema healing so the measured-savings half has per-turn token data; a missing/legacy column degrades the read to "token data absent" rather than throwing.

#### Retention summary

| Data | Default behavior |
|---|---|
| `sessions` raw events | Pruned by the `sessions prune` operation; summaries retained in `memory` |
| `memories` | Soft-delete window before purge; history retained longer |
| `memory_jobs` | Completed purged after a window; dead jobs later |
| `memory_artifacts` | Soft-delete on source file removal, hard purge on source disconnect by `source_id` |
| `skills` / `rules` | Append-only version history retained |
| `roi_metrics` | Append-only ledger retained (re-price appends a new row; canonical = `MAX(created_at)` per session) |
| embeddings / vectors | Purged with their owning row during retention sweeps |

Because DeepLake exposes no transactions at this layer, retention runs as batched, idempotent sweeps in a daemon worker rather than cascading deletes, consistent with the patterns in `deeplake-storage.md`.

### Trust Boundaries

Maps every trust boundary in the Honeycomb system: where code runs, what it can access, who controls each boundary, and what defenses prevent privilege escalation or data leakage between zones. The Honeycomb daemon is the central chokepoint; only it talks to DeepLake.

#### Trust Boundary Map

```mermaid
flowchart TD
    userBrowser([User Browser])
    agentProcess([Coding Agent Process])
    hookProcess([Hook / Thin Client Process])
    honeycombDaemon([Honeycomb Daemon - port 3850])
    credFile([~/.deeplake/credentials.json])
    deeplakeStore([DeepLake - GPU SQL/Vector])
    tenantPartition([Org/Workspace Partition - storage-isolated])
    byocBucket([BYOC Bucket - GCS / Azure / S3])

    userBrowser -- "OAuth approval - HTTPS" --> honeycombDaemon
    agentProcess -- "spawns hooks - same user" --> hookProcess
    hookProcess -- "read 0600 file" --> credFile
    hookProcess -- "local RPC - loopback" --> honeycombDaemon
    honeycombDaemon -- "SQL/Vector - only path to storage" --> deeplakeStore
    deeplakeStore -- "org/workspace scoped rows" --> tenantPartition
    tenantPartition -- "GCS/Azure/S3 creds in vault" --> byocBucket
```

Note: the credentials file and the BYOC bucket are the data-at-rest nodes, distinct from the process nodes. The single most important property of the map is that no process other than the daemon has a line into DeepLake.

---

#### Zone Definitions

| Zone | Owner | What runs there | Trust level |
|---|---|---|---|
| **User Browser** | User's OS | OAuth device-flow approval page | User-trusted (separate from agent) |
| **Agent Process** | Coding agent (Claude Code, Codex, Cursor, etc.) | Agent LLM loop, tool calls | Host OS user |
| **Hook / Thin Client Process** | Agent runtime | Spawned Node bundles at lifecycle events; call the daemon | Same OS user as agent |
| **Honeycomb Daemon** | `honeycomb daemon` on port 3850 | Capture, recall, pipeline, secrets decrypt, the only DeepLake client | Same OS user; sole storage authority |
| **Credentials File** | File system | `~/.deeplake/credentials.json` | Mode 0600; OS user only |
| **DeepLake** | GPU-backed SQL/Vector backend | Session storage, memory, skill mining, vector search | Reached only by the daemon; org/workspace isolation enforced here |
| **Org/Workspace Partition** | DeepLake backend | Row- and partition-level org/workspace isolation | Server-enforced; AES-256 at rest |
| **BYOC Bucket** | Customer's cloud (GCS/Azure/S3) | Raw object storage | Customer-controlled; creds in DeepLake vault |

---

#### The Daemon as Chokepoint

Honeycomb is daemon-centric. Hooks and CLI commands are thin clients: they assemble a request, hand it to the daemon over a local loopback connection, and render the response. They never open a connection to DeepLake themselves. This collapses the storage-facing attack surface to a single process.

Consequences for the trust model:

- The bearer token and any secrets-subsystem decryption happen inside the daemon. A compromised hook can ask the daemon to do work on the user's behalf, but it cannot reach storage directly and cannot read another org's data because the daemon re-derives scope from the validated token on every request.
- SQL construction, escaping, and the VFS allowlist all live in the daemon. A thin client cannot smuggle raw SQL to DeepLake because it has no DeepLake handle to smuggle it to.
- Org and workspace isolation is enforced at the storage layer behind the daemon, not at a client the user could patch.

---

#### Token Handling at Boundaries

The access token is the primary client-side security primitive. It moves across boundaries as follows:

```mermaid
sequenceDiagram
    autonumber
    participant disk as Credentials File
    participant hook as Hook / Thin Client
    participant daemon as Honeycomb Daemon
    participant store as DeepLake

    hook->>disk: loadCredentials() - read 0600 file
    disk-->>hook: { token, orgId, workspaceId, ... }
    hook->>daemon: request + Bearer token (loopback)
    daemon->>daemon: validate token, derive org/workspace/agent scope
    daemon->>store: scoped SQL/Vector query
    store-->>daemon: rows for this org/workspace only
    daemon-->>hook: response scoped to caller
    Note over hook: token never written to stdout/stdin
    Note over hook: token never set in child process env
```

Key invariants:
- The token is read from disk at hook startup and handed to the daemon. It is never passed as a command-line argument (visible in `ps aux`) or written to `process.env` (visible to child processes).
- Only the daemon makes the network call to the backend, over TLS, with the token in an HTTP header rather than a URL query parameter.
- `authLog` writes to `process.stderr`, not `stdout`, so token-adjacent messages cannot be parsed by callers that read hook stdout as structured data.

---

#### Hook Consent Model

Honeycomb installs hooks into agent lifecycle events (`sessionStart`, `beforeSubmitPrompt`, `postToolUse`, `afterAgentResponse`, `stop`, `sessionEnd`). Each agent platform enforces its own consent model before running foreign hooks:

| Platform | Consent mechanism |
|---|---|
| **Codex** | "Hooks need review" terminal prompt on first run. User must choose "Trust all and continue"; otherwise hooks are inert. |
| **Cursor** | `hooks.json` is written to `~/.cursor/hooks.json`. Cursor 1.7+ reads this file; the user controls the Cursor installation. |
| **Claude Code** | Plugin marketplace install; Claude Code's own approval flow for marketplace plugins. |
| **OpenClaw** | `openclaw plugins install clawhub:honeycomb`; ClawHub approval. |
| **Hermes** | `config.yaml` hooks section; operator-controlled config file. |
| **pi** | `AGENTS.md` marker block + TypeScript extension; user controls the `~/.pi/agent/` directory. |

In all cases, no hook runs silently without an explicit user action. The install command (`honeycomb install`) displays a one-line consent notice before opening the browser for authentication.

---

#### VFS Allowlist

The virtual filesystem intercepts reads and writes to the memory path and routes them through the daemon. Commands routed through this layer are matched against an allowlist of approximately 70 built-in operations. Any command not on the allowlist is denied with an error. This prevents an agent from using the VFS path to execute arbitrary shell commands under the guise of memory operations.

Because DeepLake has no parameterized-query interface, the daemon builds SQL by string composition and must escape every agent-supplied value itself. Values passed into VFS-backed queries are escaped through three utility functions:
- `sqlStr(value)` - safe string literal
- `sqlLike(value)` - safe LIKE pattern
- `sqlIdent(value)` - safe identifier (table/column name)

These prevent SQL injection from agent-provided values such as memory keys or search terms. The escaping runs inside the daemon, which is the only place SQL is ever assembled.

---

#### Org, Workspace, and Agent Isolation

DeepLake enforces multi-tenant isolation at the storage layer, behind the daemon, not only at the request layer:

- Sessions never share a row, partition, or index with another workspace. Org and workspace are the primary tenancy boundary.
- The org and workspace passed with every daemon request are validated server-side against the `org_id` claim in the JWT. A token minted for org A cannot be used to read org B data by spoofing a header or editing the credentials file.
- Within a workspace, `agent_id` scoping narrows reads and writes to the calling agent's lane where the engine requires it, so multiple agents sharing a workspace do not silently clobber one another. See `scoping-and-visibility.md` for the full scope-resolution rules.
- Honeycomb's credential store mirrors the outer boundary: `creds.orgId` and the `org_id` JWT claim are kept in sync by `healDriftedOrgToken`. A session that starts with a drifted token (claim and stored ID disagree) has its token reminted before any request reaches the daemon.

---

#### Bring Your Own Cloud (BYOC)

BYOC moves object storage into the customer's own cloud account while leaving orchestration with the backend.

| Provider | Status | Boundary |
|---|---|---|
| Google Cloud Storage | Available | Customer GCS bucket; backend reads/writes via GCS credentials stored in DeepLake vault |
| Azure Blob Storage | Available | Customer Azure container; same vault model |
| Amazon S3 | Available | Customer S3 bucket |
| S3-compatible on-prem | On request | Customer network; requires private network or VPN |

In all BYOC configurations, the Honeycomb client (hooks, CLI) is unaware of the storage backend, and so is the daemon's caller. The daemon talks to the backend over TLS; the backend handles storage routing. The raw cloud provider credentials (GCS service account key, Azure SAS token, AWS credentials) are stored in the DeepLake vault and are never transmitted to the client process. Honeycomb's thin clients never see the raw keys.

---

#### Capture Opt-Out

The `HONEYCOMB_CAPTURE=false` environment variable places Honeycomb in read-only mode. In this mode:
- Session capture hooks execute but skip asking the daemon to write any trace data.
- The DDL ensure step (which writes placeholder rows) is also skipped.
- Recall and search still function.

This provides a per-session escape hatch for sensitive workflows where trace capture is inappropriate (e.g. working with credentials, PII-heavy files, or regulated data).

---

#### Telemetry Egress Boundary

Honeycomb may emit anonymized **operator telemetry** from the daemon to an operator-owned analytics backend (PostHog), install-funnel attribution and operational health (see PRD-050e). This is the one outbound boundary other than the daemon→DeepLake storage path, and because Honeycomb captures coding sessions and memories (the most sensitive data a dev tool handles), it is governed by a single non-negotiable rule.

**The content/operation bright line.** Telemetry may describe **how the tool behaves** (counts, durations, versions, states, error *classes*). It must never describe **the content the tool handles** (memory/session text, code, prompts, recall queries, file paths, cwd, repo/branch names, org/workspace names, identities, secrets). The operational test for any property is the **shrug test**: *would the user shrug if they saw this value in plaintext?* If they would lean in and squint, it is over the line and does not ship.

Boundary invariants:

- **Daemon-only emitter.** Telemetry leaves only from the daemon, through a single `emitTelemetry` chokepoint with a hardcoded allow-list; a structural test asserts no other call site posts to the endpoint and that the banned set (token, email, paths, repo/branch names, query strings, content, error messages, raw ids, secrets) is absent from every event.
- **No item-level egress.** No per-memory / per-query / per-file events, the cardinality itself is a signal. Tier-1 lifecycle events (install/link/upgrade) remain **exact** so the operator can count the funnel precisely; only Tier-2 usage *counts* are **bucketed** (the precise number never leaves the machine).
- **Tiered consent.** Operational (Tier 1) events are opt-out; usage-count (Tier 2) events are opt-in. `DO_NOT_TRACK=1` or `HONEYCOMB_TELEMETRY=0` silences all of it. An unkeyed build (no PostHog key baked in) emits nothing (fail-soft).
- **Glass-box.** `honeycomb telemetry --show` renders, in plaintext, exactly what has been and would be sent, the displayed set *is* the egress set, sourced from the same local events.
- **Anonymous identity.** The `distinct_id` is a random per-machine install-id, never an email or a content-derived hash. The write-only ingest key carries no read access to operator data.
- **Self-host conservatism.** A session against BYOC/self-hosted DeepLake defaults Tier-2 off (and Tier-1 minimal), an enterprise user firewalls egress anyway; respecting that before they ask is the posture.

This boundary is **additive to** Capture Opt-Out: `HONEYCOMB_CAPTURE=false` governs what the user's *memory* records into DeepLake; telemetry opt-out governs what *operational metadata* leaves for the operator. They are independent switches with independent defaults.

---

#### Data Classification Summary

| Data type | Where stored | At rest | In transit | Access scope |
|---|---|---|---|---|
| Access token | `~/.deeplake/credentials.json` | Plaintext; mode 0600 | Bearer header, daemon to backend over TLS | OS user only |
| Secrets (key/value material) | Secrets subsystem via daemon | Encrypted; decrypted in daemon on demand | TLS | Scoped per `secrets.md` |
| Session traces (prompts, tool calls, responses) | DeepLake org/workspace partition | AES-256 | TLS | All members of the org workspace |
| Codified skills (`SKILL.md`) | Project directory + DeepLake | Plaintext files + AES-256 | TLS | Org workspace members |
| Memory summaries | DeepLake `memory` table | AES-256 | TLS | Org workspace members |
| BYOC cloud credentials | DeepLake vault | Encrypted | Never sent to client | Backend only |
| Operator telemetry (anonymized lifecycle/health) | Operator PostHog project | n/a (no content at rest locally beyond the local event log) | TLS, daemon to PostHog, write-only ingest key | Operator only; opt-out + glass-box; **never** carries content (see Telemetry Egress Boundary) |

Workspace-level isolation is the outer boundary; within a workspace, members share the trace and skill surface by design, with `agent_id` narrowing where the engine enforces it. See `../multi-tenant/org-workspace-model.md` and `../data/deeplake-storage.md` for the storage-layer detail.

### CLI reference

The `honeycomb` command-line tool is the single entry point for installing honeycomb, wiring it underneath your coding assistants, signing in, and running operational commands against your memory. It is a thin client of the local honeycomb daemon (default `127.0.0.1:3850`): every command that touches memory, sessions, the codebase graph, or any other stored data sends a request to the daemon, which is the only process that talks to the storage backend. This keeps the CLI fast to start and keeps storage, encryption, and tenancy logic in one place.

This page documents the command surface as the knowledge base describes it. Where the knowledge base does not enumerate a specific flag, that is noted inline; confirm the detail against your installed version.

---

#### Conventions

- `honeycomb` is the global executable. Install it with the one-command installer (see Install).
- Arguments in angle brackets (``) are required; arguments in square brackets (`[value]`) are optional.
- Commands route through the daemon. If the daemon is not reachable, a command that needs it reports the failure on a single line and exits non-zero rather than printing a stack trace.
- Two global flags are recognized by the dispatcher: `--help` / `-h` / `help` prints usage, and `--version` / `-v` / `version` prints the installed version.

```bash
honeycomb --help
honeycomb --version
```

---

#### Command summary

| Command | Purpose |
|---|---|
| `install` | Bootstrap entry: bring the daemon up, stamp the onboarding marker and referral code, open the dashboard |
| `setup` | Detect installed assistants, wire their hooks, and bring the daemon up |
| `connect ` | Wire exactly one named assistant |
| `uninstall []` | Remove honeycomb's footprint from one assistant, or from every detected assistant |
| `login` | Device-flow sign-in |
| `status` | Report daemon connectivity, login state, and environment health |
| `update` | Self-update the CLI, daemon, and assistant bundles |
| `dashboard` | Open the local dashboard |
| `remember` | Write a memory entry |
| `recall` | Query memory (lexical plus semantic) |
| `agent` | Manage `agent_id` scoping and per-agent settings |
| `ontology` | Inspect and edit the memory ontology |
| `secret` | Store, list, and use scoped secrets |
| `skill` | Skillify scope, pull, unpull, and force operations |
| `hook` | Inspect and re-wire lifecycle hooks |
| `route` | Manage routing rules between agents and tables |
| `sources` | Register and sync external source connectors |
| `graph` | Build, query, and inspect the codebase graph |
| `goal` | Manage org and session goals surfaced in agent context |
| `org` | Organization administration (create, switch, list) |
| `workspace` | Workspace administration within the active org |
| `sessions prune` | Scoped cleanup of captured trace history |
| `telemetry` | Inspect operator telemetry egress |

The full top-level set above is what the knowledge base enumerates. Skillify operations that older Hivemind docs referenced as `hivemind skillify ...` are reached under `honeycomb skill ...` in this merged surface. The `org` and `workspace` verbs are the merged home of multi-tenant administration.

---

#### Install

##### `honeycomb install`

Bootstrap entry, the verb the one-command installer scripts hand off to once the global package is laid down. It composes existing daemon seams and is a thin daemon client.

**Synopsis**

```bash
honeycomb install [--ref <code>]
```

**Description**

`install` does three things, in order:

1. Health-gate the daemon up (idempotent: an already-healthy daemon is a no-op, never a second bind of `127.0.0.1:3850`). If the daemon never becomes reachable, the verb prints a "daemon didn't start" message plus a retry hint and exits non-zero.
2. Persist the onboarding marker (`phase: "installed"` plus the effective referral code) into `~/.deeplake/onboarding.json`. This write is fail-soft: a hiccup never fails the install.
3. Open the dashboard, best-effort at `honeycomb.local`, always falling back to the `http://127.0.0.1:3850/dashboard` loopback. The opener refuses any non-local URL. A failed launch is non-fatal; the URL is printed for you to open by hand.

Re-running is safe.

**Options**

| Flag | Description |
|---|---|
| `--ref ` | Override the referral code attributed at sign-up. The effective code resolves `--ref` first, then `onboarding.ref`, then the build-time default. An explicit blank value omits attribution. |

The one-command installer that lays down the package before this verb runs is:

```bash
# macOS or Linux
curl -fsSL https://get.theapiary.sh | sh

# Windows PowerShell
irm https://get.theapiary.sh/install.ps1 | iex
```

---

#### Setup, connect, uninstall

##### `honeycomb setup`

Detect every installed coding assistant and wire each one: patch its config, write the compiled hook handlers, link team skills, and register the MCP server where the assistant speaks MCP. The wiring is idempotent and foreign-safe, so re-running writes nothing where nothing changed and never touches a third party's hooks.

**Synopsis**

```bash
honeycomb setup
```

It is safe to run again at any time, for example after installing a new assistant.

##### `honeycomb connect `

Wire exactly one named assistant rather than every detected one.

**Synopsis**

```bash
honeycomb connect <harness>
```

`` is one of the six supported assistants: `claude`, `codex`, `cursor`, `hermes`, `pi`, or `claw` (OpenClaw). Confirm the exact accepted identifiers against your installed version.

##### `honeycomb uninstall`

Reverse only honeycomb's footprint: remove its config entries and its skill links, and leave foreign entries untouched.

**Synopsis**

```bash
honeycomb uninstall [<harness>]
honeycomb uninstall [--only <platforms>]
```

With no target, uninstall reverses every detected assistant. With a named harness (or an `--only` list), it reverses just those. An emptied config is cleanly unlinked rather than left as an empty object.

---

#### Authentication

##### `honeycomb login`

Sign in with the OAuth 2.0 Device Authorization Flow (RFC 8628), which works for headless installs, remote SSH, and local terminals. The CLI requests a device code, you approve in a browser, the CLI polls for a token, and the daemon mints a long-lived org-bound token. Credentials are written to the shared `~/.deeplake/credentials.json` at file mode `0600`.

**Synopsis**

```bash
honeycomb login
```

The same device flow can also be driven from the dashboard's "First time setup" button, which is the recommended path for new users (you read the code on the page instead of copying it out of a terminal). On session start the daemon also heals a drifted org token automatically: if the token's `org_id` claim disagrees with the active organization, it re-mints a corrected token.

##### `honeycomb status`

Report daemon connectivity, login state, and environment health (daemon reachable, signed in, hooks wired).

**Synopsis**

```bash
honeycomb status
```

---

#### Update

##### `honeycomb update`

Self-update the CLI, the daemon, and the per-assistant bundles.

**Synopsis**

```bash
honeycomb update [--dry-run]
```

**Options**

| Flag | Description |
|---|---|
| `--dry-run` | Report what would be updated without applying changes. |

---

#### Memory

##### `honeycomb remember`

Write a memory entry to the `memory` table through the daemon.

**Synopsis**

```bash
honeycomb remember "<text>"
```

The knowledge base shows additional metadata (for example importance and tags) on the equivalent SDK call. Whether those are exposed as CLI flags is not enumerated in the knowledge base; confirm against `honeycomb remember --help` on your installed version.

**Example**

```bash
honeycomb remember "we deploy from the release branch, never from main"
```

##### `honeycomb recall`

Query memory with hybrid lexical plus semantic recall through the daemon. When the semantic path is unavailable, recall transparently falls back to the lexical arms and still answers.

**Synopsis**

```bash
honeycomb recall "<query>"
```

**Example**

```bash
honeycomb recall "how do we deploy"
```

---

#### Dashboard

##### `honeycomb dashboard`

Open the local dashboard web page served by the daemon at the loopback address. The dashboard shows your memories, the state of each connected assistant, team skills, a map of your codebase, and overall health.

**Synopsis**

```bash
honeycomb dashboard
```

---

#### Codebase graph

The `graph` verb builds and inspects a live graph of files, symbols, and edges extracted from your source with tree-sitter (no language server, no LLM). The build is owned by the daemon; the CLI triggers it. The local snapshot is the authoritative source for reads.

##### `honeycomb graph build`

Walk the repository, extract every supported source file, aggregate one snapshot, and write it to disk. A successful build best-effort pushes the snapshot to the cloud when you are authenticated.

```bash
honeycomb graph build
```

##### `honeycomb graph init`

Install a managed post-commit hook that asks the daemon to rebuild the graph after each commit.

```bash
honeycomb graph init
```

##### `honeycomb graph pull`

Fetch a teammate's cloud snapshot for the current `HEAD`.

```bash
honeycomb graph pull
```

##### `honeycomb graph diff  `

Load two snapshots by commit and print added and removed node and edge counts with examples.

```bash
honeycomb graph diff <sha1> <sha2>
```

##### `honeycomb graph history`

Tail the per-repository `history.jsonl` audit log, where each entry records its own commit, hash, counts, and trigger.

```bash
honeycomb graph history
```

The knowledge base also describes query endpoints (find, impact, neighborhood, tour, and others) that agents read through the codebase-graph browse surface rather than as distinct CLI verbs. See the knowledge graph spec and the recall and retrieval spec.

---

#### Sessions

##### `honeycomb sessions prune`

Scoped cleanup of your captured trace history. The command groups your session events by path, lets you filter, and asks the daemon to delete the matching rows from the `sessions` table and the corresponding summaries from the `memory` table, so traces and summaries never drift out of sync.

**Synopsis**

```bash
honeycomb sessions prune [--before <date>] [--session-id <id>]
```

**Options**

| Flag | Description |
|---|---|
| `--before ` | Prune sessions whose first event is before the given date. |
| `--session-id ` | Prune a single session by id. |

These two filters are the ones the knowledge base names. Confirm the exact date format and any additional filters against your installed version.

---

#### Goals

##### `honeycomb goal`

Manage org and session goals that are surfaced in agent context. Goals are backed by the structured `goals` table and also appear as markdown files in the memory browse surface, so the same objective can be managed either with the CLI or by editing files. `honeycomb goal list` reads only the structured table.

```bash
honeycomb goal list
```

The full subcommand set (add, close, transition between `opened`, `in_progress`, and `closed`) is implied by the goal lifecycle but not exhaustively enumerated in the knowledge base. Confirm against `honeycomb goal --help`.

---

#### Secrets

##### `honeycomb secret`

Store and use scoped secrets that an agent can cause to be used without ever reading. Secrets are encrypted at rest on the daemon host (not in the storage backend) and are never returned to a caller. The API exposes names but never values, and there is deliberately no "read a secret value" path.

```bash
honeycomb secret list
```

The store, list, delete, and exec operations are the ones the knowledge base names (mirroring the `/api/secrets/*` routes). Confirm the exact CLI subcommand names and arguments against `honeycomb secret --help`.

---

#### Skills

##### `honeycomb skill`

Manage team skills mined from your sessions: set sharing scope, pull team skills onto disk, unpull them, and force operations. Skills auto-pull on session start, so a teammate's freshly mined skill becomes visible within seconds; the explicit verbs are for manual control.

```bash
honeycomb skill scope team --users alice,bob
honeycomb skill pull --force
```

The `--users` and `--force` flags shown above are the ones the knowledge base names. Confirm the complete subcommand and flag set against `honeycomb skill --help`.

---

#### Other commands

The knowledge base names these additional top-level verbs without enumerating every subcommand and flag. They are listed here for completeness; confirm their surface against your installed version.

| Command | Purpose |
|---|---|
| `honeycomb agent` | Manage `agent_id` scoping and per-agent settings. |
| `honeycomb ontology` | Inspect and edit the knowledge-graph ontology (entities, aspects, claims). |
| `honeycomb hook` | Inspect and re-wire lifecycle hooks for each assistant. |
| `honeycomb route` | Manage routing rules between agents and tables. |
| `honeycomb sources` | Register and sync external source connectors. |
| `honeycomb org` | Organization administration: create, switch, list. |
| `honeycomb workspace` | Workspace administration within the active organization. |
| `honeycomb telemetry --show` | Render, in plaintext, exactly what operator telemetry has been and would be sent. |

---

#### Environment variables

These environment variables change CLI and daemon behavior. They are read by the daemon and the hooks rather than passed as flags.

| Variable | Effect |
|---|---|
| `HONEYCOMB_PORT`, `HONEYCOMB_HOST`, `HONEYCOMB_BIND` | Override the daemon's port, host, and bind address (a team deployment widens the bind beyond localhost). |
| `HONEYCOMB_ORG_ID` | Override the organization selected at login. |
| `HONEYCOMB_CAPTURE=false` | Read-only mode: capture hooks run but write no trace data; recall and search still work. |
| `HONEYCOMB_EMBEDDINGS` | Opt out of semantic recall. Unset, `true`, or `1` keeps embeddings on; `false` or `0` turns them off and recall uses the lexical fallback. |
| `HONEYCOMB_TELEMETRY=0`, `DO_NOT_TRACK=1` | Silence all operator telemetry. |
| `HONEYCOMB_AUTOPULL_DISABLED=1` | Disable the session-start auto-pull of team skills. |
| `HONEYCOMB_ASSET_AUTOPULL_DISABLED=1` | Disable the session-start auto-pull of portable assets. |
| `HONEYCOMB_GRAPH_PUSH=0` | Skip pushing codebase-graph snapshots to the cloud. |

The pipeline stage toggles (the `HONEYCOMB_PIPELINE_*` family) are documented in the capture and memory spec.

---

#### Related

- MCP tools reference
- API reference
- Architecture overview
- Security model

### API reference

honeycomb's data-access API is the HTTP surface of the local honeycomb daemon. The daemon is the only process that talks to the storage backend; every other surface (the CLI, the lifecycle hooks, the MCP server, the SDK) is a thin client that reaches storage through this API. There are two supported ways to consume it: the daemon HTTP API directly, and the typed `@honeycomb/sdk` client that wraps it.

---

#### The service

The daemon serves everything from one HTTP server, by default on `127.0.0.1:3850`. The port, host, and bind address are overridable with `HONEYCOMB_PORT`, `HONEYCOMB_HOST`, and `HONEYCOMB_BIND` (a team deployment widens the bind beyond localhost).

| Root | Serves |
|---|---|
| `/` | The local dashboard and its static assets |
| `/health` | The cheap liveness check |
| `/api/*` | The working API |
| `/memory/*` | Search and similarity aliases |
| `/mcp` | The Model Context Protocol endpoint (streamable-HTTP transport) |
| `/v1/*` | The OpenAI-compatible inference gateway (gateway implemented; external HTTP mount deferred per the knowledge base; confirm availability against your installed version) |
| `/setup/*` | Pre-auth guided setup, loopback and local-mode only |

---

#### Route groups

The API is organized into coherent groups. The table maps each group to what it covers and the permission posture it carries in team and hybrid modes (in `local` mode every route is open).

| Path group | Covers | Permission |
|---|---|---|
| `/health`, `/api/status` | Liveness, version, resolved config and providers | none |
| `/api/auth/*` | Device-flow login, token issuance, whoami, org switch | varies |
| `/setup/*` | Credential-presence state, on-page device-flow login, migration | none (loopback, local-mode only) |
| `/api/memories`, `/memory/*` | List, search, similarity, remember, recall, forget, modify, recover, and the session-start prime digest | scoped |
| `/api/assets/*` | Publish, pull, and tombstone synced assets across a team | scoped |
| `/api/hooks/*` | Session-start, user-prompt-submit, pre-compaction, compaction-complete, session-end, synthesis | remember / recall |
| `/api/embeddings/*` | Vector export, health, 2D/3D projection | recall |
| `/api/documents/*`, `/api/sources/*` | Document ingest, source connect / index / health / purge | documents / source |
| `/api/connectors/*`, `/api/harnesses` | Connector registry and sync, harness config regenerate | connectors / local |
| `/api/skills`, `/api/rules`, `/api/goals`, `/api/kpis` | Skillify output, rules, goals, KPIs | scoped |
| `/api/graph/*` | Codebase-graph query (find, impact, neighborhood, tour) | scoped |
| `/api/ontology/*` | Entities, aspects, proposals, assertions, apply | mutation |
| `/api/secrets/*` | List names, store, delete, exec with secrets | admin / secret |
| `/api/org/*`, `/api/workspace/*` | Tenancy administration and switching | admin |
| `/api/diagnostics`, `/api/pipeline/*`, `/api/repair/*` | Health report, pipeline stats, operator repair | diagnostics / operator |
| `/api/inference/*`, `/v1/*` | Native inference routing and the OpenAI-compatible gateway | deferred (confirm against your version) |
| `/api/tasks/*`, `/api/logs`, `/api/update/*`, `/api/git/*` | Scheduled tasks, logs, updates, git sync | local |

New routes are expected to land in the right group rather than inventing a parallel namespace.

---

#### Authentication

The API authenticates with a Bearer token or a connector API key, depending on the daemon mode.

##### Daemon modes

| Mode | Posture |
|---|---|
| `local` | No authentication. Every request has full access; the daemon binds to localhost. For a single developer on one machine. |
| `team` | Every request needs a valid Bearer token or API key. Unauthenticated requests get `401`. All operations are rate-limited and scoped. The default for a shared deployment. |
| `hybrid` | Localhost requests are trusted by the TCP peer address from the socket (not the spoofable `Host` header); remote clients must present a token. If the socket info is unavailable, hybrid fails closed and requires a token. |

##### Tokens

Login uses the OAuth 2.0 Device Authorization Flow and mints a long-lived, org-bound token, written to `~/.deeplake/credentials.json` at mode `0600`. The token travels in an HTTP `Authorization` header, never in a URL query parameter, and only the daemon makes the network call to the storage backend (over TLS).

##### Connector API keys

Remote connectors authenticate with named API keys rather than user tokens. Keys are revocable, stored hashed (scrypt with a salt), prefixed `hc_sk_...`, and printed once at creation. A key carries a role and can be narrowed with an explicit permission list, and can be bound to a connector, harness, agent, and allowed projects. Connector keys default to a narrow permission set (recall, remember, documents).

##### Roles

| Role | Permissions |
|---|---|
| `admin` | Everything, including token creation, org and workspace admin, and secret operations. |
| `operator` | remember, recall, modify, forget, recover, documents, connectors, diagnostics, analytics. |
| `agent` | remember, recall, modify, forget, recover, documents. The default for harness connectors. |
| `readonly` | recall only. |

---

#### Cross-cutting contracts

Two contracts cut across every route.

**Scoping.** Every route that touches user data threads `agent_id` (or `agentId`) and threads `visibility` where the data model supports it, all within the caller's org and workspace tenancy. Org and workspace isolation is enforced at the storage layer, not just at the request layer, so a token minted for one org cannot read another org's data by editing a header. A token or key may additionally carry a tighter `scope` of `project`, `agent`, or `user`; a request touching a different value for a set field gets `403`.

**Runtime path.** A session uses one active runtime path. Connectors send `x-honeycomb-runtime-path: plugin|legacy`, and a conflicting path on the same session returns `409`. This stops two integration surfaces from writing into one session.

---

#### Errors and status codes

Errors return a structured shape, by default `{ "error": "human-readable message" }`, never a raw stack and never an upstream provider's error verbatim. Status codes carry meaning.

| Code | Meaning |
|---|---|
| `200` | Success. |
| `202` | Accepted: an async job was queued (for example a `secret_exec` job). |
| `401` | Missing or invalid auth (team / hybrid modes). |
| `403` | Authenticated but lacks the required permission or scope. |
| `404` | Not found, including a setup route requested when it is not mounted (team / hybrid). |
| `409` | State conflict, including a runtime-path conflict on a claimed session. |
| `429` | Rate limit exceeded, with a `Retry-After` header. |
| `503` | Mutation blocked by a kill switch (frozen mutations). |

Upstream errors are masked behind client-safe messages. Rate-limited operations surface a dedicated rate-limit error with `Retry-After`, and dead-lettered jobs are not retried.

---

#### Rate limiting

Rate limiting is enforced only in `team` and `hybrid` modes. It is a sliding window keyed by the caller (the token subject or API key; unauthenticated requests share an `anonymous` bucket) and resets on daemon restart. Expensive and abuse-prone operations (forget, batch operations, admin, inference execution and the gateway, LLM-backed recall) carry tighter limits. Exceeding a limit returns `429` with `Retry-After`.

---

#### Representative endpoints

The knowledge base names these specific endpoints with enough detail to call out here. For the full request and response bodies of each, consult the daemon's own `docs/API.md` and per-group docs on your installed version.

| Endpoint | Method | Purpose |
|---|---|---|
| `/health` | GET | Liveness, uptime, version, coarse pipeline status. No auth. |
| `/api/status` | GET | Full picture: resolved providers and tenancy. |
| `/api/memories/recall` | POST | The production hybrid-recall entry point. Returns ranked, shaped results with a `degraded` flag. |
| `/api/skills/pull` | POST | Idempotent team-skill pull plus cross-harness symlink fan-out. |
| `/api/assets/pull` | POST | Idempotent portable-asset pull. |
| `/api/harnesses/regenerate` | POST | Re-sync the per-harness identity files from the canonical workspace files. |
| `/api/secrets` | GET | List secret names only (never values). |
| `/api/secrets/:name` | POST | Store a secret. |
| `/api/secrets/:name` | DELETE | Delete a secret. |
| `/api/secrets/exec` | POST | Queue a command with secrets in its environment; returns `202` and a job id. |
| `/api/secrets/exec/:jobId` | GET | Inspect a queued exec job; output is redacted. |
| `/auth/device/code` | POST | Begin the device flow; carries referral-attribution headers on this request only. |
| `/auth/device/token` | POST | Poll for the long-lived token. |
| `/me` | GET | Validate a token and read the caller's identity. |
| `/users/me/tokens` | POST | Mint a long-lived org-bound API token. |

There is deliberately **no** `GET /api/secrets/:name`: a secret value can never be read through the API.

---

#### The SDK

`@honeycomb/sdk` is a typed HTTP client with no native dependencies, safe in Node, Bun, and the browser. It wraps the daemon API so an application gets memory without speaking raw HTTP.

```typescript
import { HoneycombClient } from "@honeycomb/sdk";

const honeycomb = new HoneycombClient({
  daemonUrl: "http://localhost:3850",
  token: "Bearer hc_sk_...",   // for team / hybrid daemon modes
  actor: "agent-name",
  actorType: "llm",
});

await honeycomb.remember("prefers TypeScript", { importance: 0.9, tags: "language" });
const { results } = await honeycomb.recall("language preferences", { limit: 5 });
```

The client covers memory, the hook entry points, connectors and documents, sources, skills and goals, health and diagnostics, and the value-safe secrets surface. React bindings, a Vercel AI SDK helper, and an OpenAI tool helper ship alongside the core client.

##### Retry and error semantics

- **GET requests retry; mutating requests do not**, because mutations are not idempotent.
- Errors are typed: an API error for non-2xx responses, a network error for transport failures, and a timeout error when a request exceeds the configured budget.
- Authenticated calls carry the same token and API-key model as the rest of the daemon.

The package name `@honeycomb/sdk`, the constructor options, and the `remember` / `recall` method shapes are transcribed from the knowledge base. The full method list is described by capability area rather than enumerated method by method; confirm exact method names and signatures against your installed SDK version's types.

---

#### Choosing a consumption surface

| Use | When |
|---|---|
| MCP server | The consumer is a coding assistant that speaks MCP and you want memory tools in its native tool list. |
| SDK | You are building an application, a worker, or a custom agent and want a typed client with explicit error handling. |
| Lifecycle hooks | You want automatic capture and recall around the session lifecycle. |
| HTTP API directly | You need a surface the SDK does not yet wrap, or a non-JavaScript runtime. |

All four end at the same daemon API, so the choice is about the calling environment, not about capability.

---

#### Related

- CLI reference
- MCP tools reference
- Architecture overview
- Security model
- Data and storage spec

### MCP tools reference

honeycomb exposes a Model Context Protocol (MCP) server so that coding assistants which speak MCP can ask for memory operations explicitly, as native tools in their own tool list. The server is registered into each MCP-speaking assistant during `honeycomb connect`, so there is no separate "add an MCP server" step.

Every tool handler is a thin client of the honeycomb daemon (default `127.0.0.1:3850`): the tool states what is wanted, and the daemon does the real work and is the only process that talks to the storage backend. MCP traffic is stamped with actor headers so it is identified and scoped like any other client of the daemon. Tool input schemas are defined with `zod` (the MCP server pins the v3 line for SDK compatibility).

The server binds two transports against one MCP server: a stdio transport when run as a subprocess (`node mcp/bundle/server.js`), and a streamable-HTTP transport served at `/mcp` on loopback for HTTP-speaking clients.

---

#### How the tools are grouped

The tool surface splits along a deliberate seam between resolving a known reference and mining for unknown matches:

- **Read / resolve** tools run deterministic lookups. They return exactly the row asked for; they do not rank.
- **Search / mine** tools run hybrid lexical-plus-semantic recall, fused by reciprocal-rank, with an honest `degraded` flag when the semantic path is unavailable.

The tools are organized into clusters by prefix:

| Cluster | Tools |
|---|---|
| Memory | `memory_search`, `memory_store`, `memory_get`, `memory_list`, `memory_modify`, `memory_forget`, `memory_feedback` |
| Browse (virtual filesystem) | `honeycomb_search`, `honeycomb_read`, `honeycomb_index` |
| Sessions | `session_search`, `session_bypass` |
| Prime pull | `hivemind_read`, `hivemind_search` |
| Goals and KPIs | `honeycomb_goal_add`, `honeycomb_kpi_add` |
| Codebase | `honeycomb_code_search`, `honeycomb_code_context`, `honeycomb_code_blast`, `honeycomb_code_impact` |
| Agent coordination | `agent_peers`, `agent_message_send`, `agent_message_inbox` |
| Secrets (value-safe) | `secret_list`, `secret_exec` |

The tool names above are transcribed verbatim from the knowledge base. The per-tool documentation below carries the honest name, purpose, input shape, output shape, side effects, and an example for the tools the knowledge base describes in enough detail. Where the knowledge base names a tool but does not detail its full schema, the entry says so plainly.

---

#### Memory cluster

##### `memory_store`

**Purpose.** Write a memory through the daemon. This is the explicit "remember this" tool an agent calls when it wants a fact persisted.

**Input shape.** A memory body, plus optional metadata such as importance and tags (the SDK equivalent takes `importance` and `tags`). The exact zod field names are not published in the knowledge base; confirm against the installed server definition.

**Output shape.** A confirmation that the memory was stored (the daemon returns the stored memory's identity). Confirm the exact field shape against your installed version.

**Side effects.** Writes. A new row lands in the distilled-memory path through the daemon; the daemon de-duplicates by content hash, so storing the same content twice returns the existing memory rather than inserting a duplicate.

**Example**

```json
{ "content": "we deploy from the release branch, never from main", "importance": 0.9, "tags": "deploy" }
```

##### `memory_search`

**Purpose.** The hybrid recall tool: lexical plus semantic candidate collection over the memory tables, fused by reciprocal-rank and shaped (dedup on by default), scoped to what the calling agent is allowed to see. Reach for this on a cold query when you do not already hold a reference.

**Input shape.** A query string, and (per the SDK equivalent) an optional result limit. Confirm the exact field names and any additional filters against the installed server definition.

**Output shape.** A ranked, shaped result set. Each hit carries its provenance (`source` and scope). Recall reports `degraded: false` when the semantic arm actually ran and `degraded: true` only on a genuine fallback (embeddings off, model still warming, embed daemon unreachable, a timeout, or a malformed response); in every degraded case it still answers from the lexical arms. Recall never throws and never hangs on the embedding path.

**Side effects.** Read-only. Runs `SELECT` queries against the memory tables; writes nothing on the recall path. (Recall may record redacted access tracking on the daemon side, but it creates no memory.)

**Example**

```json
{ "query": "how do we deploy", "limit": 5 }
```

##### `memory_get`

**Purpose.** Resolve a single memory by its path or id. Deterministic: returns exactly that row, no ranking.

**Input shape.** A memory identifier (path or id). Confirm the exact field name against the installed server definition.

**Output shape.** The single memory row, or an empty result when no row matches.

**Side effects.** Read-only.

##### `memory_list`

**Purpose.** List memories within the caller's scope.

**Input shape.** Optional scope or filter parameters. Not fully enumerated in the knowledge base; confirm against the installed server definition.

**Output shape.** A list of memory rows, scoped to what the agent may see.

**Side effects.** Read-only.

##### `memory_modify`

**Purpose.** Change an existing memory.

**Input shape.** A target memory and the change, plus a required `reason` argument, because every mutation is audited.

**Output shape.** A confirmation of the change. Confirm the exact field shape against your installed version.

**Side effects.** Writes. The change lands as an append-only, version-bumped write (the storage layer does not mutate in place), and the proposal is recorded to the memory history audit trail.

##### `memory_forget`

**Purpose.** Remove a memory from recall.

**Input shape.** A target memory and a required `reason` argument (audited, like `memory_modify`).

**Output shape.** A confirmation. Confirm the exact field shape against your installed version.

**Side effects.** Writes. Implemented as a soft delete (an `is_deleted` flag) rather than a hard row delete, so the audit trail survives. This is an expensive, abuse-prone operation and carries a tighter rate limit in team and hybrid modes.

##### `memory_feedback`

**Purpose.** Record feedback on a recalled memory (signal that a result was useful or not), feeding the recall-quality loop.

**Input shape.** A target memory and the feedback signal. Not fully enumerated in the knowledge base; confirm against the installed server definition.

**Output shape.** A confirmation.

**Side effects.** Writes a feedback or telemetry record on the daemon side; creates no memory.

---

#### Browse cluster (virtual filesystem)

These three tools are the read-only browse surface backed by the memory virtual filesystem: the team-shared database presented as an ordinary directory. They let an agent explore memory with familiar file operations.

##### `honeycomb_search`

**Purpose.** Search the memory browse surface. Routed to the daemon's hybrid lexical-plus-semantic search over the `sessions` and `memory` tables. This is also the "mine" half of the session-priming pull path.

**Input shape.** A query string (the search term). The knowledge base does not publish the full field list; confirm against the installed server definition.

**Output shape.** Returns text content: matching paths and snippets. On no match it reports that there were no matches for the query, and large result sets carry a truncation notice pointing at narrower queries. Confirm the exact wording against your installed version.

**Side effects.** Read-only. Runs scoped `SELECT` queries; creates nothing.

**Example**

```json
{ "query": "release branch deploy" }
```

##### `honeycomb_read`

**Purpose.** Read the content at a memory path. Deterministic resolve, not a search.

**Input shape.** A path to read.

**Output shape.** Returns text content: the full body at that path, or a "no content found at ``" message when nothing exists there. A session path is transparently concatenated from its many underlying event rows.

**Side effects.** Read-only.

**Example**

```json
{ "path": "/summaries/alice/2026-06-20-deploy.md" }
```

##### `honeycomb_index`

**Purpose.** List an index of the browse surface: the most recent memory summaries and raw sessions, so an agent can orient before reading or searching.

**Input shape.** Optional scope or prefix. Not fully enumerated in the knowledge base; confirm against the installed server definition.

**Output shape.** Returns text content: a two-section listing (memory summaries and raw sessions) with a per-section truncation notice pointing at search for older rows.

**Side effects.** Read-only.

---

#### Sessions cluster

##### `session_search`

**Purpose.** Search session transcripts. Can infer parent lineage from a child session key, which is how OpenClaw resolves a parent session.

**Input shape.** A query and, optionally, a session key. Confirm the exact field names against the installed server definition.

**Output shape.** Matching session rows or transcript slices, scoped to the caller.

**Side effects.** Read-only.

##### `session_bypass`

**Purpose.** A session-scoped control tool the knowledge base names within the sessions cluster. Its precise contract is not detailed in the knowledge base; confirm the input, output, and any side effects against your installed version before relying on it.

---

#### Prime pull cluster

These two tools carry the historical `hivemind_` names and back the session-priming pull path: a session that already holds a primed reference can resolve or mine it cheaply without re-running a full recall.

##### `hivemind_read`

**Purpose.** Resolve (zoom) a primed reference to its fuller summary or raw detail. Deterministic: returns the row asked for, no ranking.

**Input shape.** A reference (path or id) to resolve.

**Output shape.** The fuller content for the primed reference, or an empty result when nothing matches.

**Side effects.** Read-only.

##### `hivemind_search`

**Purpose.** Mine for unknown matches, the hybrid recall variant on the prime-pull path. Routes to the same daemon-backed hybrid search as the browse surface.

**Input shape.** A query string.

**Output shape.** Ranked matches with provenance; honest `degraded` flag on fallback.

**Side effects.** Read-only.

---

#### Goals and KPIs cluster

These two tools **write**. They are the explicit way an agent records objectives.

##### `honeycomb_goal_add`

**Purpose.** Create a goal that is surfaced in agent context.

**Input shape.** The goal text. Per the goal model, a created goal starts in the `opened` status. Confirm the exact field names against the installed server definition.

**Output shape.** A confirmation carrying the new goal's identity. Confirm the exact field shape against your installed version.

**Side effects.** Writes. A row lands in the `goals` table (created lazily on first use) through the daemon. The goal then also appears as a markdown file in the memory browse surface under the `opened` status.

**Example**

```json
{ "text": "cut the cold-start time of the dashboard below 1 second" }
```

##### `honeycomb_kpi_add`

**Purpose.** Attach a measurable KPI to an existing goal. Call this only when the user explicitly asks for KPIs.

**Input shape.** A reference to the parent goal plus the KPI definition (a target and a unit, and a name). The exact field names are not fully published in the knowledge base; confirm against the installed server definition.

**Output shape.** A confirmation. Confirm the exact field shape against your installed version.

**Side effects.** Writes. A row lands in the `kpis` table (created lazily on first use) through the daemon.

---

#### Codebase cluster

These tools surface the codebase-graph query endpoints once a graph exists for the workspace. They read the local graph snapshot; the graph is AST-only (tree-sitter, nine languages), so its answers are grounded in the current checkout.

| Tool | Purpose |
|---|---|
| `honeycomb_code_search` | Find symbols by name or pattern across the graph. |
| `honeycomb_code_context` | Return a symbol's detail plus its immediate neighbors (incoming and outgoing edges by relation). |
| `honeycomb_code_blast` | Return the transitive dependents (blast radius) of a symbol. |
| `honeycomb_code_impact` | Report the impact of changing a symbol. |

**Input shape.** A symbol name or pattern (and, for some, a scope). The knowledge base names the tools and the query semantics but does not publish each tool's exact zod fields; confirm against the installed server definition.

**Output shape.** Text renderings of the graph query (matches, neighborhoods, dependents). These carry an honest caveat: cross-file call edges are resolved only for relative named and namespace imports, so a symbol reading "incoming (0)" is not proof of dead code, and a snapshot whose source has been edited since the build is stale and should be cross-checked against live source.

**Side effects.** Read-only. They read the local snapshot and make no network call.

---

#### Agent coordination cluster

| Tool | Purpose | Side effects |
|---|---|---|
| `agent_peers` | List the agents that share the workspace. | Read-only. |
| `agent_message_send` | Send a message to another agent. | Writes a message record through the daemon. |
| `agent_message_inbox` | Read messages addressed to the calling agent. | Read-only. |

The knowledge base names these tools and their roles; it does not publish their exact zod fields. Confirm the input and output shapes against the installed server definition.

---

#### Secrets cluster (value-safe)

These two tools are deliberately value-safe: an agent can list secret names and cause a secret to be used, but it can never read a secret value through MCP (or any other surface).

##### `secret_list`

**Purpose.** List the names of stored secrets.

**Input shape.** Optional scope. Confirm against the installed server definition.

**Output shape.** Secret names only, never values.

**Side effects.** Read-only.

##### `secret_exec`

**Purpose.** Run a command with named secrets injected into its environment, without ever exposing the secret values to the agent.

**Input shape.** A command and the names of the secrets to inject. Confirm the exact field names against the installed server definition.

**Output shape.** The command's output with any secret value redacted to `[REDACTED]` before the caller sees it. The call is asynchronous: it queues a job and returns; the result is fetched once the job completes.

**Side effects.** Spawns a subprocess on the daemon host with the secrets in its environment, under a timeout (5 minutes default, 30 minutes maximum) and a bounded worker pool. It does not return or log the secret values.

---

#### A note on read-only vs writing tools

Honest side-effect classification matters when an assistant picks a tool. In this surface:

- **Read-only:** `memory_search`, `memory_get`, `memory_list`, `honeycomb_search`, `honeycomb_read`, `honeycomb_index`, `session_search`, `hivemind_read`, `hivemind_search`, all four `honeycomb_code_*` tools, `agent_peers`, `agent_message_inbox`, and `secret_list`.
- **Writes:** `memory_store`, `memory_modify`, `memory_forget`, `memory_feedback`, `honeycomb_goal_add`, `honeycomb_kpi_add`, `agent_message_send`.
- **Runs a process (not a memory write):** `secret_exec`.

`memory_modify` and `memory_forget` require a `reason` because they are audited mutations. Confirm the side-effect class of any tool not fully detailed here against your installed version before relying on it.

---

#### Related

- CLI reference
- API reference
- Harness integrations spec
- Recall and retrieval spec
- Security model

# Part 4: Nectar, the Understanding Layer

## Nectar: Stories & User Guide

*The memory layer that helps your agent understand your codebase by meaning, not file names.*

### Foreword

Ask your agent where you handle logins and it should hand you the right files, even when none of them are named login.ts. That is the job Nectar does. It gives every file a short plain-language description of what it actually does, so your agent matches on meaning instead of names. This guide is the plain-language tour: what Nectar is, a before-and-after walkthrough, the words you will see, how to get started, how to keep it accurate, how to share it with your team, and the questions people ask most.

### What is Nectar?

A 60-second introduction for anyone new to Nectar — what it is, the problem it solves, how it works in plain terms, and what it is not.

#### The one-sentence answer

Nectar is a memory layer that helps your AI coding assistant understand your codebase by meaning, not just by file names.

If you ask your agent "where do we handle logins?" it should hand you the right files — even if none of them are named `login.ts`. That is the job Nectar does.

---

#### The problem it solves

Modern AI coding tools are good at reading code, but they struggle with one basic task: *finding* the right code to read.

When you ask your agent a question, it usually starts by searching for files whose names or contents match your words. Ask "where do we handle logins?" and the agent hunts for files called `login.ts`, `auth.ts`, or `authenticate.js`. That works when files are named clearly. It breaks down fast in real codebases, where the login logic often lives in a file called `session-refresh.ts` buried three folders deep — a file no search would ever guess.

The result is the same dead end every time: the agent reads the wrong files, gives you a confident-sounding answer about the wrong thing, and you end up doing the search yourself.

Nectar exists to close that gap. It gives every file a short plain-language description of what that file actually does, so your agent can match on *meaning* instead of matching on *names*.

---

#### How it works, in one paragraph

Nectar quietly reads each file in your project and writes down what it does in plain language — something like "refreshes login tokens on each authenticated request." It stores that description alongside the file and remembers it from then on. When your agent later searches for "anything about logins," it searches those descriptions, not just the file names. Because the descriptions are written once and kept up to date, the agent finds the right files even when they are poorly named, hidden in an odd folder, or recently moved. You do nothing differently — you just ask your agent the same questions and get noticeably better answers.

A good analogy: Nectar is like the index at the back of a book, but one that has actually read every chapter. A normal index lists words that appear on the page. Nectar lists *what each chapter is about*, so you can look up a topic and land on the right page even when the chapter title never uses the word you searched for.

---

#### What Nectar is

- **A memory layer for your codebase.** It remembers what each file is for, in plain language, and keeps that memory current as files change.
- **A helper for your AI coding assistant.** It sits alongside your existing tools and gives your agent better, more relevant files to work with.
- **Team-ready.** Once one person has built up the understanding, the rest of the team gets it for free when they download the project.

---

#### What Nectar is NOT

It helps to know the boundaries.

- **It is a memory layer, not a full-text code search engine.** You *can* query it yourself with the `nectar search` command (and the daemon's HTTP endpoint), and the same recall also surfaces automatically through your AI coding assistant via Honeycomb's shared memory, with no search box at all.
- **It is not a replacement for your editor or your AI agent.** It does not write code, and it does not replace the assistant you already use. It makes the assistant you already use smarter about your project.
- **It is not a way to read every line of your code.** Nectar reads enough of each file to describe it accurately. It does not memorize your source code line by line.

---

#### What you actually notice

After Nectar has learned your codebase, the change is quiet but real:

- **More relevant file suggestions.** Your agent points you at the file that actually does the work, not just the file that happens to share a name with your question.
- **Fewer dead ends.** The agent stops confidently explaining the wrong file and then having to start over.
- **Less time spent hunting.** You ask the question once, and the answer points at the right place.

The best way to feel the difference is to ask your agent a meaning-shaped question — "where do we handle user authentication?" or "what handles sending emails?" — and notice that the right files come back, regardless of what they are called.

---

#### Where to go next

- `how-nectar-helps-your-agent.md` — a before-and-after walkthrough of one real question.
- `nectar-glossary.md` — plain-language definitions of the words you will see.

### How Nectar Helps Your Agent

A before-and-after walkthrough of a single real question — what changes for you and your AI coding assistant when Nectar is turned on.

#### The setup

You are working on a project with your AI coding assistant. You did not write most of this code. The folders are not organized the way you would organize them. File names are sometimes clear (`login.ts`) and sometimes not (`session-refresh.ts`, `jwt-helpers.js`).

You want to understand how logins work. So you ask your agent a normal, everyday question:

> *"Where do we handle user authentication?"*

This is the moment where Nectar matters. Here is what happens without it, and what happens with it.

---

#### Before Nectar: the agent guesses by name

Without Nectar, your agent searches for files the way a person might scan a folder — by looking for names and words that match your question.

Here is what it finds:

- `src/auth/login.ts` — because the name contains "login."
- `src/api/routes/login.ts` — same reason.

Those are good starting points. But the agent misses the file that actually does most of the work:

- `src/middleware/session-refresh.ts` — this file refreshes your login token on every authenticated request. It is a core part of how logins stay working. But nothing in its name says "login" or "auth," so the search never finds it.

The agent gives you a confident answer built on the two files it found. You read them, think you understand logins, and later discover there was a whole layer you never saw. You hit a bug in the token refresh, have no idea where it comes from, and end up searching the codebase yourself.

This is the dead end Nectar is built to prevent. It is not that your agent is lazy or broken — it simply has no way to know what a file *does* unless the file's name happens to give it away.

---

#### After Nectar: the agent knows what each file is for

With Nectar, every file in the project already carries a short plain-language description of what it does. The agent searches those descriptions, not just the file names.

So when you ask the same question — *"Where do we handle user authentication?"* — the agent now finds:

- `src/auth/login.ts` — "checks the username and password and starts a new login session."
- `src/middleware/session-refresh.ts` — "refreshes login tokens on each authenticated request; part of the login session lifecycle."
- `src/lib/jwt.ts` — "creates and checks login tokens; used by login and session-refresh."
- `src/api/routes/logout.ts` — "ends a login session and clears the refresh token."

Notice what happened: the agent found the files that *participate in* logins, not just the files *named for* logins. The critical `session-refresh.ts` file — invisible to a name search — came back because its description matches the meaning of your question.

The difference is not a nicer list. The difference is that you now actually understand how logins work, because the agent handed you the whole system instead of just the obviously-named part of it.

---

#### The before-and-after at a glance

| | Without Nectar | With Nectar |
|---|---|---|
| How the agent searches | By file name and exact words | By what each file actually does |
| What it finds | Files whose names match your question | Files whose *purpose* matches your question |
| Files it misses | Anything not obviously named (like `session-refresh.ts`) | Almost nothing relevant |
| Your experience | Partial answers, dead ends, manual hunting | Complete answers on the first try |

---

#### Why the descriptions survive everyday chaos

Codebases do not stand still. You rename files, move them between folders, copy them to start a new feature, and edit them constantly. A memory layer that forgets everything every time a file moves would be useless.

Nectar is built so that its understanding survives all of this:

- **If you rename a file**, Nectar still knows what it does. The description follows the file, not the name.
- **If you move a file to a new folder**, the description comes along. Reorganizing your project does not wipe the slate clean.
- **If you copy a file to start something new**, the copy keeps a link to the original — so Nectar understands the new file is related, without confusing it for the old one.
- **If you edit a file**, Nectar notices the change and updates the description when it matters.

In plain terms: **the system remembers what each file is for, even if you completely reorganize your folders.** You never lose the built-up understanding, and you never have to teach it again.

---

#### What this means for you, day to day

The value is not in any single search. It is in the accumulation:

- **You trust your agent more.** When it points you somewhere, that somewhere is usually right.
- **You onboard faster.** On a project you have never seen, meaning-based answers get you oriented in minutes instead of hours.
- **You stop fighting your file structure.** Whether the codebase is tidy or a mess, the agent can still find what matters.
- **Your whole team benefits.** Once one person's project has the descriptions, everyone who downloads it gets the same understanding — no setup required.

---

#### The takeaway

Nectar does not change how you ask questions. It changes whether the answers are worth trusting.

The next time you ask your agent "where do we handle ___?" — fill in the blank with anything: payments, emails, logins, reporting — the difference is whether the agent hands you the obviously-named file, or the set of files that actually does the work. Nectar is what makes the second outcome the normal one.

---

#### Where to go next

- `what-is-nectar.md` — the 60-second overview, if you have not read it.
- `nectar-glossary.md` — the words you will see, defined in plain language.

### Nectar Glossary

Plain-language definitions of the words you will see when reading about Nectar — each with a short note on why it matters to you.

#### How to use this glossary

These are the customer-facing terms — the words that describe *what Nectar does for you*, not the engineering underneath. Each entry has a one-sentence definition and a one-sentence "why it matters" note. If a word is not here, it is an internal engineering term you do not need to know to use the product.

---

#### Memory layer

**What it is:** The overall thing Nectar provides — a stored understanding of what every file in your project is for, kept up to date as your code changes.

**Why it matters to you:** It is the reason your AI coding assistant gets noticeably better at finding the right files. Without it, the assistant searches by name; with it, the assistant searches by meaning.

---

#### Nectar

**What it is:** A file's identity record — the small, stable tag Nectar assigns to a single file so it can keep track of that file forever, even if the file is renamed, moved, or edited.

**Why it matters to you:** It is how Nectar remembers a file across all the chaos of normal development. Because each file has a stable identity, its history and description never get lost when you reorganize your project.

---

#### Description

**What it is:** A short, plain-language note that says what a file actually does — for example, "refreshes login tokens on each authenticated request."

**Why it matters to you:** This is the heart of how Nectar helps your agent. When you ask a question by meaning ("where do we handle logins?"), the agent searches these descriptions instead of file names, so it finds files that do the work even when their names give nothing away.

---

#### Concepts (tags)

**What it is:** Short labels that link related files together across folders — like tagging a file with "authentication" or "email" so files that share a purpose can be found together.

**Why it matters to you:** They let your agent pull together everything tied to a topic in one go, even when those files live in completely different parts of your project and would never be grouped by name alone.

---

#### Fresh-clone inheritance

**What it is:** When a teammate downloads (clones) your project, they automatically receive the same file understanding Nectar already built — no setup, no waiting, no cost.

**Why it matters to you:** One person builds up the understanding once, and the whole team gets it instantly. A new teammate can ask the agent "where do we handle logins?" on their first day and get the same complete answer you get.

---

#### Team-share

**What it is:** Nectar's understanding belongs to the whole team working in a project, not to any one person's computer — everyone working in the same project sees the same file descriptions.

**Why it matters to you:** You never have to "teach" the same thing twice. Whatever understanding exists for the project is shared, so every teammate's AI assistant is equally informed.

---

#### Brooding

**What it is:** Nectar's first read-through of your project, where it reads every file and writes the initial descriptions. It happens once, usually when you first turn Nectar on.

**Why it matters to you:** It is the one-time setup cost. After brooding finishes, the understanding is in place and only needs light updates as files change — you are not paying for a full re-read every time.

---

#### Semantic search

**What it is:** Searching by *what something means* rather than by the exact words or file names it contains — matching the intent of your question to the purpose of each file.

**Why it matters to you:** It is the difference between your agent finding `login.ts` (because the name matches) and finding `session-refresh.ts` (because what it *does* matches). Semantic search is what makes the second find possible.

---

#### A word about words you will *not* see here

You may come across terms like "embeddings," "vectors," or other engineering jargon in deeper documentation. You do not need any of them to use Nectar. They describe *how the memory layer works under the hood*; this glossary describes *what it does for you*. If a concept is not in this list, it is internal detail, not something you need to act on.

---

#### Where to go next

- `what-is-nectar.md` — start here if you are new.
- `how-nectar-helps-your-agent.md` — see the value in a real before-and-after example.

### Getting Started With Nectar

Walks you through your project's very first scan (what Nectar does on first run, what it costs, and how to know it worked), so you can run `nectar search "where is the login logic"` and get the right files back.

#### What happens on your first run

The first time Nectar meets your project, it does not know anything yet. Every file is just a name on disk. To turn that pile of names into something your AI agent can reason about, Nectar reads through your files and writes a short, plain-language description for each one. We call this first pass **the first scan** — internally it is called "brooding," but what it amounts to is: read your files, understand them, and write down what each one is for.

Once the first scan finishes, you can search your codebase in a new way. Instead of only finding files whose names match a search word, `nectar search` understands what each file *does*. Run `nectar search "where is the login logic"` and it can return a file like `src/middleware/session-refresh.ts` (even though that file has no "login" in its name) because Nectar described it as part of the login session lifecycle. The same recall also surfaces directly through your AI coding assistant via Honeycomb's shared memory, so you get the benefit whether you run the `nectar search` command, hit the daemon's HTTP endpoint, or just ask your agent.

The understanding Nectar builds is saved as a small shared file at the root of your project: `.honeycomb/nectars.json`. Think of it as a shared map of your codebase. You do not need to open it or edit it. Nectar maintains it for you, and you commit it to your repo just like any other project file. (For what that shared map makes possible across your team, see the team-share guide.)

---

#### Before you brood: prerequisites

The dry-run preview below and `nectar search` work without any extra setup. A real first scan, though, needs two things in place so Nectar can actually describe your files:

- **Deeplake credentials.** The shared `~/.deeplake/credentials.json` file (written when you sign in with `hivemind login`) tells Nectar where to store what it learns.
- **A description model, via Portkey.** Set three environment variables so Nectar can call the model that writes descriptions:
  - `NECTAR_PORTKEY_ENABLED=1`
  - `NECTAR_PORTKEY_API_KEY=`
  - `NECTAR_PORTKEY_CONFIG=`

If either prerequisite is missing, the daemon still starts and serves `/health`, but brooding stays dormant: it describes nothing and tells you why. A startup log line names exactly what is missing, `/health` reports a `brooding.reason`, and on an interactive terminal the daemon prints the exact steps to fix it. Configure both, then start the daemon (or run `nectar brood`) and the first scan proceeds.

---

#### Before you run it: preview the cost

The first scan uses an AI model to describe your files, so it carries a small one-time cost. The good news is that cost is predictable, small, and paid only once for the whole project.

A typical project of 2,000 files costs about **three dollars** total for the first scan. A small service with 200 files runs about thirty cents. A very large codebase of 10,000 files runs around fifteen dollars. These are one-time numbers — you will not pay them again unless you delete the shared map and start fresh.

If you want to know the exact cost for *your* project before spending anything, run the preview:

```bash
nectar brood --dry-run
```

This reads your files, counts them, sorts them by size, and prints an estimate of how many descriptions it will write and roughly what they will cost. It does **not** describe anything, does **not** spend money, and does **not** change your project. Use it whenever you want to sanity-check the bill.

---

#### Run the first scan

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

#### What Nectar never does

Two promises worth stating plainly, because they matter for trust:

**It never modifies your source files.** Not a single character of your code, config, or documentation is ever changed. The only file Nectar writes is the shared map (`.honeycomb/nectars.json`), and even that is something it regenerates from scratch — it is not your code, and it is not a secret second copy of your project.

**It does not send your code to the model forever.** The first scan reads each file once to write its description. After that, Nectar only re-reads a file when that file has *meaningfully* changed — and it is smart enough to ignore cosmetic changes like reformatting. Day-to-day, the cost is essentially zero. (See the freshness guide for exactly how it decides what to re-describe.)

---

#### How to know it worked

The simplest test is a `nectar search` query the old name-based search would get wrong. With the daemon running, try something like:

- `nectar search "where is the login logic"`
- `nectar search "everything related to sending email"`
- `nectar search "what handles retry on failed payments"`

If the results include files that do the thing you asked about, regardless of what those files are named, the first scan worked. Semantic recall is live, and it surfaces both through `nectar search` and directly through your AI coding assistant via Honeycomb's shared memory.

You can also check the shared map directly. After a successful first scan, `.honeycomb/nectars.json` exists at your project root and contains one entry per described file, each with a title and a short description. You never need to read it by hand, but it is there, and it is human-readable if you are curious.

---

#### What comes next

- **Keep the shared map committed.** Add `.honeycomb/nectars.json` to version control. This is what lets teammates inherit your project's understanding instantly and for free — see sharing understanding with your team.
- **Let it stay fresh as you work.** When the brood prerequisites are configured, the daemon watches for changes and re-describes files as you edit, rename, and reorganize; see keeping descriptions accurate.
- **Re-run with a cost cap if you like.** `nectar brood --limit 100` describes at most 100 files at a time, useful if you added a large batch of new files and want to pace the cost.

That is the entire first-run journey. One scan, a small one-time cost, and your project is ready to answer questions the way a teammate who has been there for years would.

### Keeping Descriptions Accurate

Explains how Nectar keeps every file's description current as you edit, rename, move, and copy-paste — without re-describing on every keystroke, and without losing track of a file when it moves.

#### The promise

After the first scan, your project has a description for every file. But code is not static. You edit files, rename them, move them between folders, copy blocks from one place to another, and delete things. If the descriptions stayed frozen at their first-scan wording, they would drift out of sync with reality within a day.

Nectar's job in steady state is to keep descriptions accurate **without hovering over your shoulder**. When the daemon is running with the brood prerequisites configured, it does this with four behaviors, each tuned to a specific kind of change. The guiding principle throughout: only re-describe when something has *meaningfully* changed, so cost stays low and your descriptions stay trustworthy.

---

#### Edits — descriptions update after a pause, not on every keystroke

When you save a file, Nectar notices. But it does not rush to re-describe it the instant you press save — and it certainly does not re-describe on every keystroke. That would be wasteful, jumpy, and expensive.

Instead, it waits through a short pause. If you save the same file several times in quick succession (as you almost always do while working), those saves collapse into a single "this file changed" signal. Only after you have stopped editing for a moment does Nectar take a closer look.

Even then, it does not always re-describe. Before spending anything, it asks a simple question: **did the meaning of this file actually change?** It compares the new version of the file to the old one. If the change is purely cosmetic — reformatting, whitespace, a touched-up comment — it quietly keeps the existing description. No AI call is made, no money is spent, and the description does not churn.

Only when the change crosses a meaningful threshold does Nectar write a fresh description. The result is that routine editing costs essentially nothing, and descriptions only change when they genuinely need to.

---

#### Renames and moves — the description follows the file

A common worry with any tool that tracks files is: *what happens when I move or rename a file?* Many tools lose track, because they identify a file by its path or name — change the path, and as far as they know, it is a brand-new file.

Nectar does not work that way. It gives each file a stable identity that is **independent of its name or location**. When you rename a file or move it to a different folder, Nectar recognizes that it is the same file in a new place. The description travels with it.

In practice this means:

- **Rename `login.ts` to `auth-handler.ts`** — the description stays attached. You do not lose the understanding Nectar built, and you do not pay to re-build it.
- **Move `utils.ts` from `src/` to `src/lib/legacy/`** — same thing. The file is tracked across the move, description intact.
- **Reorganize a whole directory** — every file you shuffle keeps its description, because each one is tracked by identity, not by where it happens to sit.

This is one of the most important properties of Nectar: **refactoring does not reset understanding.** You are free to rename and reorganize as much as you like.

---

#### Copy-paste — the copy remembers where it came from

When you copy a file (or copy a chunk of code into a new file), something interesting happens. The new file is genuinely a new thing — it deserves its own identity and, eventually, its own description. But it is also *derived* from something that already exists, and that relationship is worth remembering.

Nectar handles this by giving the copy a fresh identity **and a link back to the original**. The copy keeps a pointer that says "I came from here." This is useful in two ways:

- **Seeing where code came from.** When you are reading a file that started life as a copy, the link lets you trace it back to its source. This is handy for understanding why a file looks the way it does, or for finding the canonical version of something that has been duplicated.
- **A fresh start with a remembered origin.** The copy is described on its own from its current contents (it does not inherit the original's description), while the link back to the source is preserved so its lineage is never lost. As the copy evolves and diverges, its description reflects what it has become.

So copy-paste is not a confused event (two files claiming to be the same thing) and not a lost event (the relationship forgotten). It is a tracked, recoverable event — the copy stands on its own, but never forgets its origin.

---

#### What to do if a description seems wrong

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

#### Why the cost stays low

It is worth restating the reassurance, because "AI describes your files" can sound expensive. The first scan is the only time Nectar describes everything at once, and even that is a small one-time cost (see the getting started guide).

After that, Nectar re-describes a file only when **all** of these are true:

1. The file was meaningfully edited (not just reformatted).
2. The editing settled down past the pause window (not on every save).
3. The change crossed the threshold where the old description no longer fits.

On a typical workday, that filters down to a handful of files at most — often zero. Cosmetic changes, rapid-fire saves, and untouched files all cost nothing. The steady-state bill for keeping descriptions accurate is a small fraction of the one-time first-scan cost, and for many projects it rounds to zero.

---

#### Recap

- **Edits** update a description only after a pause and only when the change is meaningful — cosmetic changes and rapid saves cost nothing.
- **Renames and moves** never lose the description, because files are tracked by stable identity, not by name or path.
- **Copy-paste** gives the copy its own identity plus a link back to the original, so you can trace where code came from; the copy starts with its own fresh description, not the original's.
- **Wrong descriptions** usually self-correct on the next meaningful edit or a `nectar brood --force`. `nectar review-matches` is a separate tool for confirming low-confidence identity matches, not for repairing descriptions.
- **Cost stays low** because re-description is rare and selective, not constant.

The result is a project whose descriptions stay accurate as it evolves — quietly, cheaply, and without you having to think about it.

### Sharing Understanding With Your Team

Explains what happens when you commit Nectar's shared map to version control: a teammate who clones the repo gets the same file descriptions instantly, for free, with no re-scan - so everyone shares one understanding of the codebase.

#### The idea in one sentence

The first person to run Nectar on a project pays a small, one-time cost to describe every file. After that, those descriptions live in a small shared file at the project root, and **every teammate who clones the repo inherits them for free**.

No re-scan. No new cost. No waiting. The moment your teammate's copy of Nectar starts up, it recognizes the shared map, matches it against the files on disk, and the project's understanding is live — identical to yours.

---

#### Why committing the shared map matters

After the first scan, Nectar writes a small file at the root of your project: `.honeycomb/nectars.json`. You can think of it as **a shared map of your codebase** — one entry per file, each carrying a short title and description of what that file does.

This file is meant to be committed, just like `package-lock.json` or any other project artifact your team relies on. Here is why that matters:

- **It is the bridge between "I scanned this" and "we all benefit."** The first scan's results do not help anyone else until the shared map reaches them. Committing it is what turns a single developer's investment into a team asset.
- **It makes descriptions a reviewable artifact.** When a teammate opens a pull request, they can see not only the code you changed but also the description Nectar wrote for any new file — and sanity-check that it reads reasonably. The shared map is human-readable, not an opaque database blob.
- **It works offline.** A teammate on a fresh clone gets the full set of descriptions without any network call, login, or cloud sync. Everything needed is already in the repo.

---

#### The team-share journey, step by step

##### Step 1 — Commit the shared map

After your first scan finishes, add the shared map to version control:

```bash
git add .honeycomb/nectars.json
git commit -m "Add Nectar shared map"
```

From this point on, the shared map travels with your repository like any other file. You do not need to think about it again — Nectar updates it automatically as descriptions change (see the freshness guide for how that stays low-churn).

##### Step 2 — A teammate clones the repo

When a teammate runs `git clone`, they get your source files **and** the shared map, in one step. Nothing special is required on their end — a normal clone is enough.

##### Step 3 — Their Nectar recognizes the existing descriptions

The first time your teammate's copy of Nectar starts up in the cloned project, it notices the shared map and does something efficient: it matches every file on disk against the map's records. For each match, it inherits that file's description directly. No new descriptions are written. No AI calls are made.

A current shared map typically produces **zero re-scan work and zero cost** on a fresh clone. Every file's content lines up with a record in the map, so every description carries over. The person who first scanned the project paid the bill; the clone pays nothing.

##### Step 4 - Everyone shares one understanding of the codebase

Once inheritance finishes, your teammate's project is in the same state yours was right after the first scan: every file carries its title and description. They can run `nectar search "where is the login logic"` and get lexical (name and description) matches straight away. Full vector-based semantic recall for the inherited files follows once their daemon (running with the brood prerequisites configured) re-embeds those inherited entries. That recall surfaces both through `nectar search` and directly through an AI coding assistant via Honeycomb's shared memory. There is one shared understanding of the codebase, and you are all working from it.

---

#### What happens when descriptions differ

Two teammates may describe the same file differently over time — for example, you edit a file in your branch while a teammate edits a different file in theirs, and both of you commit an updated shared map. This is normal, and Nectar handles it without drama.

When those changes meet (on a merge or a pull), the system **reconciles** them. Each file is tracked independently, so two teammates updating two different files simply produce two independent updates in the shared map — no conflict, because they touch different entries. Even when two people change the *same* file, the resolution is straightforward: each file's description is tied to that file's current content, so the version that matches the file as it exists after the merge is the one that wins. The shared map reflects the merged state of the code, not a separate battle over wording.

The practical effect: merges stay clean, and the shared map always describes the code as it actually is.

---

#### What happens on a branch switch

Switching branches can suddenly show or hide a batch of files — a feature branch might add new files, and switching back to `main` removes them again. You might worry that every branch switch throws away understanding and forces a re-scan.

It does not. Nectar gives deleted-or-switched-away files a **grace period**. When a file disappears from disk because you switched branches, its entry in the shared map is kept around for a while rather than dropped immediately. Switch back, and the file returns with its description intact — no re-scan, no cost.

Only after the grace period passes (and the file is still genuinely gone) is the entry cleaned up. This means hopping between branches as part of your normal workflow costs nothing. The understanding you built is sticky.

---

#### What happens if the shared map is out of date

Sometimes a teammate clones a repo whose shared map is a few commits behind the files on disk — maybe someone added files but forgot to commit the updated map, or the map is simply old. Nectar handles this gracefully too.

For every file whose content lines up with a record in the map, the description is inherited as usual — free and instant. For files that do **not** line up (new files, or files that changed since the map was last updated), Nectar falls back to its normal tracking: it figures out the best match for each one, mints a fresh record where there is no match, and describes only those unmatched files. The bill in this case is limited to the gap — the files the map did not already cover — not a full re-scan.

So a stale shared map is never a disaster. It just means the teammate pays to describe whatever is new or changed since the map was last refreshed.

---

#### A note on choosing not to commit

Some teams prefer not to commit the shared map — perhaps to avoid any extra diff noise in pull requests, or because each developer wants an independent scan. Nectar supports this: if you add `.honeycomb/nectars.json` to your ignore file, Nectar still writes it locally for your own use, but it is not shared.

The tradeoff is simple and worth understanding. Without the shared map in the repo:

- **Every clone pays for its own first scan.** Each teammate re-describes every file from scratch, including the cost.
- **Descriptions may drift between teammates.** Without a shared source, each person's copy can describe the same file with slightly different wording.
- **The team-share story stops working.** No inheritance on clone, no shared semantic index.

The recommendation is to commit it. The diff noise is small (one entry per changed file, written at most once per editing session), and the payoff — instant, free, identical understanding for every teammate — is large.

---

#### Recap

- Commit `.honeycomb/nectars.json`. It is the bridge that turns one person's scan into the whole team's asset.
- A fresh clone inherits every description for free, with zero re-scan cost, and works offline.
- Everyone shares one understanding of the codebase, so `nectar search "where is the login logic"` returns the same files across the team; vector recall for inherited files converges once the daemon re-embeds them.
- Merges reconcile cleanly because each file is tracked independently.
- Branch switches are free thanks to a grace period before any cleanup.
- A stale map is not a disaster — only the gap gets re-described.

That is the entire team-share model: understand once, share everywhere.

### Nectar Basics FAQ

The foundational questions a new user asks: what Nectar is, whether it changes how you work, and what it does (and does not) touch in your project.

#### Q: What is Nectar?

Nectar is a semantic memory layer for your project. It gives every file a stable identity and a short, plain-language description of what that file is for, so an AI coding assistant can answer a question like *"where is the login logic?"* and get back the right files — even the ones that are not named `login`.

The key idea is matching by **meaning**, not just by name. Regular search can only find a file if you already know part of its name or the exact text inside it. Nectar understands what each file *does*, so it can surface a file like a session-refresh middleware as part of "the login logic," even though the word "login" never appears in it.

It runs quietly in the background while you work. You do not launch it, configure it per query, or think about it day to day. It builds a shared map of your codebase once, keeps it up to date as files change, and feeds that understanding to your AI assistant.

---

#### Q: Do I need to change how I write code?

No. You write, name, and organize your code exactly as you do today. Nectar reads your files and builds its understanding from what is already there.

There are no special comments to add, no markers to insert, no naming conventions to follow, and no annotations required. You do not have to tag files, fill out metadata, or describe anything yourself. The whole point is that the descriptions are produced for you, automatically, so you can keep working the way you already do.

Your existing workflow — your editor, your version control, your build — is untouched. Nectar layers on top of it without asking you to adapt to it.

---

#### Q: Does it work with my existing AI coding assistant?

Yes. Nectar is designed to feed the assistant you already use, not to replace it. It plugs into the search and memory that your assistant already relies on, so that when your assistant goes looking for relevant code, it draws on Nectar's understanding of what each file means.

Think of it as giving your assistant a shared map of the codebase that it can consult. Your assistant still does the thinking, the editing, and the answering. Nectar just makes sure it is looking in the right places — by meaning, not only by keyword.

Because the understanding lives in a single shared map that is part of your project, every member of your team's assistant benefits from the same map, with no extra setup per person.

---

#### Q: Does it modify my source files?

No, never. Nectar only **reads** your source files. It does not edit them, does not insert comments into them, and does not rewrite your license headers or any other line of any file.

The one and only thing it writes is a single separate file at the root of your project — a shared map that records each file's identity and its plain-language description. This file is kept apart from your source code, and it is fully regenerable: it can be deleted and rebuilt from Nectar's memory store at any time, with nothing lost.

This is a deliberate design choice. Mutating source files (for example, stamping an identity number into the first line of every file) was considered and rejected because it would collide with license headers, create merge conflicts, and fail on files that have no comment syntax at all. Nectar keeps identity out of your code entirely.

---

#### Q: What kinds of files does it understand?

Nectar looks at the whole project, not just source code. It describes any text file that carries meaning: source files, configuration files, documentation, environment-example files, and more. If a file helps explain how the project works, Nectar can describe it.

A few categories are handled specially. Binary files (images, fonts, compiled assets) and very large files are not given a prose description — there is nothing meaningful for a language model to say about them — but they are still tracked and identified, so they are never invisible to the system.

The practical effect is that Nectar's map covers the parts of your project that matter for understanding it: the code, the configs, and the docs. It does not force everything into the same mold.

---

#### Q: Does it replace my editor's search?

No — the two are complementary, and you will likely use both.

Your editor's search (and its "go to symbol" or "find references" features) is structural. It is excellent at precise tasks: jump to this exact function, find everywhere this exact name is used, rename a symbol safely across the codebase. It works because it reads the literal structure of the code.

Nectar is semantic. It answers questions that structural search cannot: *"where do we handle a user logging in,"* *"what files are involved in sending email,"* *"find everything related to the checkout flow."* These questions are about meaning and intent, not exact names.

Use your editor's tools when you know the name. Use Nectar (through your AI assistant) when you know the *idea* but not the name. They cover different ground and do not get in each other's way.

---

#### Q: Is it free, and what does it cost to run?

Building the shared map the first time uses a fast, low-cost AI language model to produce the descriptions, so there is a small one-time cost per project. For a typical project of about 2,000 files, the first scan lands at roughly **$3**. It scales predictably with size: a small 200-file service costs about $0.30, and a large 10,000-file codebase around $15.

You can preview the exact cost before spending anything by running the first scan in a dry-run mode, which shows the estimated price without making any calls.

After that, the ongoing cost is minimal. Nectar does not re-describe your whole project on every edit — it only re-describes a file when its contents have meaningfully changed, and it waits for a pause in editing before doing so. Day-to-day refreshing costs pennies or nothing.

There is also a way to make clones of the same project free: the shared map can be committed to your repository, so a teammate who clones the project inherits all the descriptions without any new scanning cost. (See the privacy and cost FAQ for the details.)

### Nectar Comparison FAQ

The "how is this different from what I already use" questions, answered at a user level — honestly and without hype.

#### Q: How is Nectar different from regular code search?

Regular search matches **names and text**. Nectar matches **meaning**.

When you use your editor's search (or grep, or "find in files"), you have to already know something about what you are looking for: a function name, a variable, or an exact string that appears in the file. It works by comparing the letters you typed against the letters in your files. It is fast and precise — but it is blind to intent. It cannot find login logic unless the word "login" literally appears somewhere.

Nectar works the other way around. It already knows what each file *is for*, because it has a plain-language description of every file. So you can ask in ordinary language — *"where is the login logic"* — and get back the right files, including ones whose names and contents never contain the word "login" at all.

A concrete example: a file named `session-refresh.ts` that quietly refreshes login tokens is part of your login system, but regular search will not surface it for "login" unless you already know it is there. Nectar will, because its description captures that the file is part of the login session lifecycle.

The two are not in competition. Search is the right tool when you know the name. Nectar is the right tool when you know the idea but not the name.

---

#### Q: How is it different from AI tools that index my codebase?

Several AI tools today read your codebase, chop it into pieces, and build a searchable index so an assistant can answer questions about it. This sounds similar to Nectar, and there is real overlap — but three differences matter in practice.

**First, Nectar remembers what files are *for*, and that memory survives moves and renames.** Many indexing tools treat a file's location or its exact contents as its identity. Rename a file, move it to another folder, or copy it, and the tool treats it as something new — it has to re-index and often loses the connection to what came before. Nectar gives each file a stable identity that follows the file itself, so its description and its history survive a rename, a move, or a refactor. The understanding is durable.

**Second, that understanding is shared across the whole team, not rebuilt per person.** Most indexing tools do their work separately on each person's machine. Every teammate's clone re-indexes from scratch, pays the cost again, and builds its own private picture of the codebase. Nectar writes one shared map that can be committed to the repository, so a teammate who clones the project inherits the full set of descriptions instantly and for free. The team builds one shared understanding, once.

**Third, it does not duplicate the structural work your other tools already do.** Many indexers parse your code into fine-grained symbols (functions, classes) and embed each one. That is useful, but it is also the job your editor's "find references" and symbol-navigation features already do well. Nectar deliberately describes files at the level of "what is this file for," and leaves symbol-level precision to the tools that already do it — so it complements your existing setup rather than overlapping it.

The honest summary: Nectar is not the only tool that lets an assistant search your code semantically. Its difference is that the search is backed by **durable, shareable, file-level understanding** that survives the way code actually moves and grows over time.

---

#### Q: Does it replace my AI assistant?

No. It makes the assistant you already use **smarter about your codebase**.

Your AI coding assistant is good at reasoning, writing code, and answering questions — but it can only work with what it can find. When it does not know which files are relevant, it guesses, asks you, or searches by keyword and often misses the files that matter. Nectar fixes that last part: it gives your assistant a reliable map of what each file means, so its searches land on the right place the first time.

Think of the division of labor this way. The assistant does the thinking and the doing. Nectar supplies the context — the shared understanding of the codebase that the assistant draws on. Your assistant is still the one answering questions, writing code, and making changes. Nectar just makes sure it is not working in the dark.

Because it feeds the assistant rather than replacing it, you keep whichever assistant you prefer. You are not switching tools; you are upgrading the quality of the context your tool can reach.

---

#### Q: Does it conflict with my IDE's symbol navigation?

No. The two are complementary, and there is no overlap or interference between them.

Your IDE's symbol navigation — "go to definition," "find references," "rename symbol" — is **structural**. It reads the literal grammar of your code to know that this name refers to that function, and that these calls point back to it. It is exact, compiler-aware, and irreplaceable for tasks like safely renaming something or tracing a call chain.

Nectar is **semantic**. It knows what a file *means* and *is for*, so it can answer questions of intent — "which files handle authentication" — that structural navigation was never built to answer. It does not parse your code's grammar or try to resolve symbols; it leaves that entirely to your IDE.

Use your IDE's navigation when you want to follow the wiring: jump to a definition, find every caller, refactor a name. Use Nectar, through your assistant, when you want to find things by purpose: locate everything tied to a feature, a concept, or a responsibility. One finds by structure; the other finds by meaning. They answer different questions, and using both gives you the most complete picture of your codebase.

### Nectar Privacy and Cost FAQ

The trust questions: where your code goes, what it costs, how often it runs, and what happens if you stop using it.

#### Q: Does my code leave my machine?

When Nectar writes a plain-language description for a file, that description is produced by an AI language model. To produce it, the relevant file contents are sent to the model so it can read them. The important detail is **how** they are sent: the system routes through a gateway that you configure yourself, using the same connection the rest of the tool already trusts.

Here is what happens, in plain terms. Nectar runs as a background service on your machine. It reads your files locally. When a file needs describing, it sends only that file's contents — through your own configured gateway — to the model, receives a short description back, and stores the result. It does not upload your entire project in one go, and it does not send files to an unknown or hard-coded destination.

A few practical points:

- **Identity is local.** The stable identity assigned to each file is created on your machine and stored locally. It never needs to leave.
- **Descriptions are generated, not your code.** What comes back from the model is a one-to-three sentence summary of what the file is for. Your raw source is not kept on the other end.
- **You control the route.** Because requests go through your configured gateway, the same policies, keys, and privacy controls you already trust apply here too.

If your organization requires that no source leave the network at all, that is a gateway-configuration question. Nectar's design makes the routing explicit and yours to control, rather than hiding a fixed endpoint inside the tool.

---

#### Q: What does the first scan cost?

The first scan — the one-time process that builds the shared map for a project — uses a fast, low-cost AI model to produce the descriptions, and the cost scales with the number of files. It is a **one-time cost per project**, not a recurring fee.

For a typical project of about 2,000 files, the first scan lands around **$3**. The cost scales predictably with size: a small 200-file service runs about $0.30, and a large 10,000-file codebase around $15. Smaller files are described efficiently several dozen at a time, which keeps the price low; only genuinely large files cost more, one at a time.

Before you spend anything, you can run the first scan in **dry-run mode**. This shows you exactly how many files will be described, how they will be grouped, and the estimated dollar cost — without making any calls. It is the recommended first step on any new project, so there are no surprises.

---

#### Q: Subsequent clones of the same project are free — how?

Yes. Once the shared map has been built for a project, it can be committed to your repository — much like a lockfile. When a teammate clones the project, their copy already contains the map, so their Nectar recognizes every file and inherits its description without doing a new scan.

Here is why that works. Nectar records a fingerprint of each file's contents. When a fresh clone is opened, the tool checks each file's fingerprint against the committed map. A match means *"this is the same file someone already described"* — so it simply adopts the existing identity and description. No AI model is called, and no scanning cost is incurred.

The practical effect: one person (or one automated run) pays the one-time cost to build the map; everyone else on the team inherits every file's identity and description for free, instantly, the moment they clone. Lexical recall (by name and description) works right away; full vector-based semantic recall for the inherited files converges once a configured daemon re-embeds them. And because the map is just a committed file, the inherited descriptions work even with no network connection at all.

---

#### Q: Does it re-scan on every edit?

No. Re-describing the whole project on every save would be wasteful and slow. Instead, Nectar only re-describes a file when its contents have **meaningfully changed**, and it waits for a natural pause in editing before doing anything.

Two behaviors make this efficient:

- **Identity survives edits.** A file's identity is not derived from its contents, so editing a file does not break the link to its history. The existing description stays attached; only the description itself may need a refresh.
- **Updates are debounced and targeted.** If you are in the middle of a rapid edit session, Nectar waits for you to stop, then refreshes only the files that actually changed — not the entire project. One burst of editing produces one small update, not a flurry of one per keystroke.

The result is that day-to-day cost is minimal: pennies for the occasional file that genuinely changed, and nothing at all for files that did not.

---

#### Q: What happens to the descriptions if I stop using Nectar?

Nothing is lost. The descriptions and identities live in a shared map that is stored as part of your project, separate from your source code. If you stop using Nectar, that map simply sits there — it does not vanish, and it does not damage your code.

Because the map is a committed, reviewable file in your repository, it is also portable and durable. It does not depend on a running service or a continued subscription to exist. You can walk away from the tool today and the map is still there tomorrow, intact, for anyone who wants it.

If you ever come back, or a teammate picks it up later, the map is ready and waiting. And because your source files were never modified, removing Nectar leaves your code exactly as it was — there is nothing to clean up, no embedded markers to strip out, no leftover edits to undo.

---

#### Q: Does it work offline?

Yes. Because the shared map can be committed to your repository, a clone of the project works without any network connection at all.

When the map is present, Nectar can recognize every file and serve its description purely from what is already on disk, with no calls home and no cloud lookup. This makes the project's descriptions and lexical recall fully usable even on a plane, behind a strict firewall, or during an outage; vector-based semantic recall additionally needs each file's embedding to have been computed.

The one thing that does require a connection is **producing new descriptions** — for a file nobody has described yet. That step calls an AI model through your gateway, so it needs network access. But once a description exists and is saved to the map, it is available offline forever. For an already-described project, offline use is the norm, not a special case.

## Nectar: Technical Manual & Specification

*The brooding pipeline, hive graph, portable registry, recall integration, and identity model.*

### Foreword

Nectar reads each file, writes down what it does in plain language, and keeps that memory current as files change. This manual documents how. It covers the daemon and its role in the topology, the hive graph schema, the portable registry that ships understanding with the project, the recall integration that surfaces descriptions through Honeycomb, and the identity model that makes minted descriptions trustworthy across a team. It is written for engineers building on or auditing Nectar.

### Nectar: Overview & Quickstart

#### What makes Nectar different

- **Identity never lives in your source.** No serial numbers in comments, no sidecar files bolted next to your code. ADR-0001 kills that idea for four concrete reasons; read it before arguing about serials-in-source.
- **Daemon-minted ULIDs.** A nectar is a 26-character ULID minted once by the daemon and persisted in Deeplake. It is not derived from content, so edits don't churn it. It is not derived from path, so moves don't kill it.
- **The re-association ladder.** Five steps, first match wins: path/mtime/size fast path, path match with changed content, exact content-hash match for clean moves, TLSH fuzzy match for move-and-edit, mint fresh. Low-confidence fuzzy matches go to human review, never auto-claimed, because a mis-association corrupts the history chain.
- **Copy-paste as provenance, not ambiguity.** Copy a file and the copy gets a fresh nectar with a `derived_from_nectar` edge back to the original. The fork relationship survives forever, even after the copy diverges.
- **A committed lockfile, not a sidecar.** `.honeycomb/nectars.json` is a regenerable projection of Deeplake state. A fresh clone re-derives identity from it with zero LLM calls and zero network.
- **Hybrid recall, live in production.** `nectar search` runs a per-arm guarded lexical + vector query over described files, fused by Reciprocal Rank Fusion. Those hits also fold into Honeycomb's cross-memory recall as a 4th arm alongside sessions, memories, and skills, so nectars surface in the same recall your agents already use.

#### Features

- **Stable file identity.** 26-char ULID per file, minted by the daemon, never reused, never deleted by the ladder. *(registration protocol shipped, PRD-006)*
- **5-step re-association ladder.** Survives renames, moves, offline edits, and cold catch-up after your laptop was closed. TLSH fuzzy matching with a confidence-scored review surface. *(shipped, PRD-006)*
- **Copy-paste provenance.** `derived_from_nectar` + `fork_content_hash` record every fork as a first-class edge.
- **Two Deeplake tables.** `hive_graph` (one row per logical file) + append-only `hive_graph_versions` (one row per observed state, carrying 768-dim embeddings). *(shipped, PRD-005)*
- **Supervised daemon.** `nectar daemon` binds `127.0.0.1:3854`, serves `/health`, registers with Doctor, and installs as an OS service on launchd, systemd, and Windows. *(shipped, PRD-002/003/004)*
- **LLM-minted descriptions.** Lazy, batched, cheap: a long-context model describes files on demand, not eagerly, so a full pass on a 2000-file repo lands at about $3.05 and a committed projection makes every subsequent clone free. *(shipped, PRD-007/010/016)*
- **Portable projection.** `.honeycomb/nectars.json`, regenerated from Deeplake after every brood and enrich. *(shipped, PRD-011)*
- **Hybrid recall.** `nectar search` (and `POST /api/hive-graph/search`) run a per-arm guarded lexical + vector query over described files, fused by Reciprocal Rank Fusion, with a silent BM25 fallback when embeddings are off. These hits also surface as a 4th arm inside Honeycomb's cross-memory recall alongside sessions, memories, and skills. *(shipped, PRD-012/013)*

#### Install (one command)

No Node? No npm? No problem. The installer detects and sets up everything, then **opens a dashboard in your browser**. The terminal is just a progress log; the product is the first thing you touch.

```bash
# macOS / Linux
curl -fsSL https://get.theapiary.sh | sh
```

```powershell
# Windows (PowerShell)
irm https://get.theapiary.sh/install.ps1 | iex
```

That single line installs the Apiary stack and brings the **nectar daemon** up on `127.0.0.1:3854`, supervised by Doctor so it survives crashes and reboots without you thinking about it.

Prefer to build from source?

```bash
git clone https://github.com/legioncodeinc/nectar.git
cd nectar
npm install
npm run build          # tsc → dist/

npm start              # start the daemon (node dist/cli.js daemon)
node dist/cli.js install   # register the OS service unit + the Doctor registry entry
```

Requires Node ≥ 22. `npm run typecheck` and `npm test` are the local gates.

#### Using the dashboard

Straight talk: Nectar does not ship its own dashboard, and that is by design. The always-on **hive portal** owns the unified dashboard for the whole Apiary and aggregates from each daemon's API, fail-soft per daemon (ADR-0004). The **Hive Graph page** (PRD-015, shipped) renders your file graph, identity search, and brood status by fetching Nectar's `/api/hive-graph/*` endpoints through the portal. If the Nectar daemon is down, that page degrades gracefully instead of taking the whole dashboard with it.

#### Using the CLI

The `nectar` binary ships with the package. What works today:

```bash
nectar daemon                 # start the daemon (127.0.0.1:3854, /health)
nectar install                # register the OS service unit + Doctor registry entry
nectar uninstall              # deregister the OS service unit
nectar service-status         # report the OS service unit's running state
nectar brood --dry-run        # preview a full-codebase brood's cost locally (no LLM call, no writes)
nectar brood                  # run a full-codebase brood against Deeplake (needs the prerequisites below)
nectar search <query>         # hybrid recall over described files. Flags: --limit N, --json
nectar rebuild-projection     # regenerate .honeycomb/nectars.json from Deeplake
nectar prune --confirm        # prune long-missing nectars from the durable store
nectar review-matches         # review low-confidence identity matches against the durable store
nectar --help
```

`nectar search` reaches a running `nectar daemon` over loopback, so start the daemon first.

##### Brood prerequisites

A mutating `nectar brood` (and the boot auto-brood) describes files only when **both** prerequisites are in place:

- `~/.deeplake/credentials.json`, the shared Deeplake credentials `hivemind login` writes.
- Portkey, enabled via `NECTAR_PORTKEY_ENABLED=1`, `NECTAR_PORTKEY_API_KEY`, and `NECTAR_PORTKEY_CONFIG`.

Without them the daemon still boots and serves `/health`, but brooding stays dormant and says so: a startup log line names the missing pieces, `/health` reports `brooding.reason` (for example `credentials_missing` or `portkey_disabled`), and on an interactive terminal the daemon prints the exact configuration steps. `nectar brood --dry-run` and `nectar search` do not need Portkey.

##### Telemetry

Nectar sends anonymous, aggregate usage telemetry (install, first run, and version updates) by default, never file contents or paths. Opt out with `NECTAR_TELEMETRY=0` (it also accepts `off` and `false`, case-insensitive) or the cross-tool `DO_NOT_TRACK` standard.

#### Identity that survives the refactor

```bash
# The daemon minted src/auth/session-refresh.ts a nectar and described it.
# Now gut your directory structure:
git mv src/auth/session-refresh.ts src/middleware/token-lifecycle.ts

# …then ask recall about it:
nectar search "where do we refresh login sessions"
# → src/middleware/token-lifecycle.ts
# "refreshes JWT claims on each authenticated request,
# part of the login session lifecycle"
```

Same nectar, same description, new path. The identity followed the file, so the memory never went stale. `nectar search` runs the recall over described files, and the same hits fold into your agent's cross-memory recall as a 4th arm (PRD-013), so the answer surfaces wherever your agent already asks.

#### How it works

```mermaid
flowchart TD
    W["watcher + hiveantennae daemon<br/>127.0.0.1:3854"] --> M["mint 26-char ULID<br/>+ LLM-minted description"]
    W --> L["re-association ladder<br/>path/mtime/size → hash → TLSH → mint"]
    M --> DL["Deeplake<br/>hive_graph + hive_graph_versions<br/>768-dim embeddings, append-only history"]
    L --> DL
    DL --> P[".honeycomb/nectars.json<br/>committed projection (lockfile)"]
    DL --> R["Honeycomb hybrid recall<br/>4th arm · BM25 + vector · RRF"]
```

The daemon watches your source tree. New file: mint a nectar, queue a description. Known file: run the ladder, append a version row, keep the chain. Everything durable lands in Deeplake first; the projection is regenerated from it after every pass; recall unions over the described files alongside sessions, memories, and skills.

#### Why identity beats paths

Path-keyed memory is a bet that your repo never changes shape. That bet loses every single sprint. Every rename orphans a memory, every directory reshuffle silently detonates the recall your agents depend on, and nobody notices until an agent confidently cites a file that has not existed for three weeks.

Stable identity flips the failure mode. The nectar is the anchor; the path is just the latest observation attached to it. The file can move, get edited offline, or get forked into a new module, and the daemon re-associates it and keeps writing to the same history chain. Memory attached to identity does not rot when the tree churns.

Meaning is the other half. Structural tools can tell you a symbol named `authenticate` exists; they cannot tell you that `session-refresh.ts` is a critical piece of login behavior. An LLM-minted description per file gives your agents the *what is this for* layer that grep and AST graphs structurally cannot provide. Identity keeps the answer alive; meaning makes it worth recalling.

#### Why Deeplake makes the difference

Most code-indexing tools bolt onto a vector-only store, which forces every access pattern through a similarity engine. Nectar needs exact identity joins **and** semantic search, and [**Deeplake**](https://deeplake.ai), the database for AI, gives it both natively:

- **SQL + vector in one engine.** "Latest version row for this nectar" is a deterministic SQL join; "files that mean login" is a vector search over 768-dim embeddings. One store serves both. No second database, no sync problem, no sidecar.
- **Versioned and append-only.** `hive_graph_versions` never overwrites: every observed state of every file stays on disk. That is what makes re-association *auditable*: you can trace exactly when a nectar was carried across a move, at what confidence, and what the file looked like on both sides.
- **Identity table + versions table, cleanly split.** `hive_graph` anchors the stable key; `hive_graph_versions` carries the history. Collapsing them forces you to lose either history or the stable key. Deeplake makes the split cheap.
- **Graceful degradation.** Embeddings off? The embedding column stays NULL and recall falls back to BM25 over titles and descriptions. No error, no quality cliff.

> Nectar stands on the same two shoulders as the rest of the Apiary: **[Deeplake](https://deeplake.ai)** gives identity somewhere durable and queryable to live, and **[Hivemind](https://github.com/activeloopai/hivemind)**, Activeloop's open-source agent-memory project, is the foundation Legion Code extended into Honeycomb.

#### Supported harnesses

Nectar's file identity and descriptions reach your harness through Honeycomb's recall integration: same daemon boundary, same shared memory, no per-harness wiring of its own. Three harnesses are supported through that integration; three more are in progress on the same boundary, so they inherit Nectar the moment their Honeycomb recall lands.

| Harness | Status |
|---|---|
| **Claude Code** | Supported |
| **Cursor** | Supported |
| **Codex** | Supported |
| **Hermes** | In progress |
| **pi** | In progress |
| **OpenClaw** | In progress |

#### Other interfaces

- **Dashboard.** The hive portal's Hive Graph page (PRD-015, shipped), fed by Nectar's `/api/hive-graph/*` endpoints (PRD-008). Nectar deliberately owns no dashboard of its own.
- **MCP server.** Nectar does not ship a separate MCP server; its results surface through Honeycomb's existing MCP recall tools via the shipped recall arm (PRD-013). One boundary, not two.
- **TypeScript SDK.** `@legioncodeinc/nectar` ships a typed `dist/index` entry. The daemon and service lifecycle are the primary surface, and the API endpoints (PRD-008) that back the Hive Graph page are live.

 Status & Roadmap

Nectar is **v0.1.x and production stable**: the PRD program is fully built and tested in production. Shipped: the daemon, health, single-instance lock, OS service install, Doctor supervision, the Deeplake catalog tables, the file registration protocol, brooding, the enricher steady-state loop, the Portkey gateway, the portable projection, embeddings provider switching, service check-in telemetry, the API endpoints, and the recall arm that surfaces nectars through Honeycomb's hybrid recall, rendered in the Hive portal's Hive Graph page. The roadmap and idea board live at [ideas.theapiary.sh](https://ideas.theapiary.sh).

#### Development

```bash
npm install
npm run build        # tsc → dist/
npm run typecheck    # tsc --noEmit
npm test             # build + node --experimental-sqlite --test test/**/*.test.ts
npm run daemon       # run the daemon from dist/
npm run clean        # rm -rf dist
```

Requires Node ≥ 22. Every change passes typecheck and the test suite before it lands.

#### Credits

Nectar exists because two halves fit together:

- **[Activeloop](https://activeloop.ai/)** brings **[Deeplake](https://deeplake.ai/)** (the versioned, multi-modal database for AI with native vector + columnar indexing and hybrid search) and **[Hivemind](https://github.com/activeloopai/hivemind)**, the open-source agent-memory project Honeycomb is built upon.
- **[Legion Code Inc](https://github.com/legioncodeinc)** brings the **multi-tier memory system** (Tier 1 / 2 / 3 keys, summaries, raw), **code base atlas memory architecture**, **auto healing service**, **session priming**, **automatic skill development & propagation**, the **pollinating loop**, the **knowledge graph**, **cross device cross repository cross team skill sharing**, and the daemon architecture that turns Deeplake into a shared brain your coding agents read and write on every turn.

#### License

Nectar is licensed under the **GNU Affero General Public License v3.0 or later** (AGPL-3.0-or-later).

Use it commercially or privately, free of charge. In return: keep the copyright and license notices intact, and if you modify it, your changes ship under the same AGPL license with source available. The "Affero" part is the point: run a modified version as a network service and you owe its source to the users who interact with it. No locking a fork behind a SaaS wall.

© 2026 Legion Code Inc.

  Built by Legion Code Inc · Powered by Activeloop Deeplake · theapiary.sh

I am Legion. We are Legion.

#vibewithlegion

### hive Portal Daemon — design reference

The full design detail for **hive**, the always-on portal daemon of the Nectar three-daemon topology: its component breakdown, the API-aggregation protocol mechanics, the dashboard route inventory, and its deployment/lifecycle model. This is the narrative companion to ADR-0004 (which records the decisions) and PRD-004c/004d (which specify the build). Read ADR-0004 first for the *why*; this doc is the *what* and *how*.

**Implementation update (July 2026).** Hive shipped as its own repository and diverged from this design in three ways, recorded in hive's own knowledge base (`hive/library/knowledge/private/`): (1) the "reuse honeycomb's dashboard without forking" plan became **copy-and-own** (hive ADR-0001): the SPA was copied out of honeycomb once, honeycomb's copy was deleted, and hive owns the code outright; (2) the per-route TTL **aggregation cache was never built**: hive's server-side BFF proxy (hive ADR-0002, `hive/src/daemon/proxy.ts`) forwards each request over loopback with no cache layer; (3) the OS service names landed as `com.legioncode.hive` / `hive.service` / Windows task `hive` (`hive/src/service/platform.ts`), not the `com.hive.daemon` naming sketched here. The topology, the thin-portal boundaries, and the fail-soft aggregation contract all shipped as designed. Where this doc and hive's knowledge base disagree, hive's knowledge base wins.

#### What hive is, in one paragraph

hive is a TypeScript/Node + Hono daemon that serves the unified dashboard for the Nectar ecosystem. It is one of three daemon roles in the topology decided by ADR-0003: doctor supervises, hive portals, and the workload daemons (honeycomb, nectar) do the work. hive boots on OS start as a supervised daemon in its own right (sibling to the workloads, not a child of any of them), renders the dashboard shell the moment its socket binds — before any workload daemon is confirmed healthy — and populates that shell by fetching data from each registered daemon's HTTP API. It holds no Deeplake client, runs no queries, and resolves no tenancy scope. It is a thin portal: presentation plus an aggregation seam.

#### The four binding properties (from ADR-0004)

These are the load-bearing decisions; this doc expands each into design detail.

1. **Always-on + boot-order contract** — hive serves the shell before any workload is healthy.
2. **API aggregation, not direct Deeplake access** — hive fetches from daemon APIs; it is not a data-plane consumer.
3. **Dashboard ownership**: hive owns the unified dashboard. (Originally framed as runtime reuse of honeycomb's `registry.tsx` / `pages/*`; shipped as copy-and-own per hive ADR-0001, see the implementation update above.)
4. **Update-cadence boundary** — hive ships independently of doctor and the workloads.

---

#### Component breakdown

```mermaid
flowchart TD
    subgraph hive["hive (port 3853)"]
        shell["dashboard shell<br/>(static HTML + assets)"]
        server["Hono HTTP server<br/>(dashboard + aggregation routes)"]
        agg["aggregation layer<br/>(per-daemon wire routing + fail-soft)"]
        cache["aggregation cache<br/>(per-route TTL)"]
        shell --> server
        server --> agg
        agg --> cache
    end
    os["OS service manager"] --> hive
    hive -->|doctor registry read| reg["~/.honeycomb/doctor.daemons.json"]
    agg -->|"GET /api/* honeycomb :3850"| honeycomb["honeycomb daemon"]
    agg -->|"GET /api/* nectar :3854"| nectar["nectar daemon"]
    honeycomb -. unreachable .-x agg
    nectar -. unreachable .-x agg
```

| Component | Responsibility | Notes |
|---|---|---|
| **OS service unit** | Boots hive on device start; restarts on crash | Shipped as launchd `com.legioncode.hive` / systemd `hive.service` / Windows task `hive` (`hive/src/service/platform.ts`). Sibling to doctor's unit, not a child of a workload. |
| **Dashboard shell** | Static HTML + assets rendered before any API call | The always-on guarantee: the shell + a daemon-status grid render the moment the socket binds. API data populates async. |
| **Hono HTTP server** | Serves the shell + the dashboard routes + the aggregation routes | Modeled on honeycomb's `src/daemon/runtime/server.ts` (Hono, route groups, unprotected `/health`). |
| **Aggregation layer** | Per-daemon `wire` routing — each dashboard request is dispatched to the owning daemon's API | The seam from ADR-0004 decision 2. Fail-soft per daemon: unreachable → empty section + "daemon unreachable" badge, never a 500. |
| **Aggregation cache** | Per-route TTL cache of aggregated responses | Designed but never built: the shipped BFF proxy forwards every request over loopback uncached, and loopback latency made the cache unnecessary. Kept here as design history. |
| **doctor registry reader** | Reads `~/.honeycomb/doctor.daemons.json` to know which daemons exist + their API base URLs | Read on boot + on a slow poll. hive does not own the registry (doctor does); it consumes it. |

---

#### The API-aggregation protocol (the seam)

This is the most consequential design element — the contract that keeps hive thin while letting it render data from any registered daemon.

##### Request flow

1. A browser hits a hive dashboard route (e.g. `/hive-graph`).
2. hive's SPA router matches the route to a `PageProps` component from hive's own `registry.tsx` (copied and owned from honeycomb, hive ADR-0001).
3. The component calls `wire.(...)` to fetch its data.
4. hive's `wire` implementation routes the call to the **owning daemon's** API — not to an in-process handler. For `/hive-graph` data, that's `GET http://127.0.0.1:3854/api/hive-graph/*` (nectar).
5. The fetch fires on every request (the designed per-route TTL cache was never built; loopback made it unnecessary).
6. On success, the response is returned. On unreachable, the fail-soft path returns an empty payload + a degradation flag the component renders as "daemon unreachable."

##### The `wire` abstraction

hive's dashboard components call a `wire` data-fetch abstraction, the same pattern honeycomb's dashboard used. As designed here, hive was to reuse honeycomb's `wire` interface with a per-daemon HTTP implementation. As shipped, hive copied and owns its own `wire.ts` (`hive/src/dashboard/web/wire.ts`): every call fetches same-origin `/api/*` paths, and hive's server-side BFF proxy resolves the owning daemon per request and forwards over loopback (`hive/src/daemon/proxy.ts`, hive ADR-0002). The component layer still does not know which daemon serves it; the routing moved from the browser to the server.

##### Per-daemon routing table

| Dashboard route | Owning daemon | Daemon API |
|---|---|---|
| `/` (Dashboard) | honeycomb | `:3850/api/*` |
| `/projects` | honeycomb | `:3850/api/*` |
| `/harnesses` | honeycomb | `:3850/api/*` |
| `/memories` | honeycomb | `:3850/api/*` |
| `/graph` (memory graph) | honeycomb | `:3850/api/*` |
| `/sync`, `/logs`, `/roi`, `/settings` | honeycomb | `:3850/api/*` |
| `/hive-graph` (PRD-015, NEW) | nectar | `:3854/api/hive-graph/*` |

The existing honeycomb routes are served by proxying to honeycomb's API. The new `/hive-graph` route (PRD-015) is the first nectar-owned route. Future nectar-owned pages (or pages from future workload daemons) extend this table.

##### Fail-soft contract

- A daemon unreachable on a given route → that route's section renders empty + a "daemon unreachable" badge. hive never returns a 500 for a workload outage.
- A daemon returning an error payload → the section renders the error inline (operator-facing, not a broken page).
- hive's own `/health` is independent — it reports `ok` as long as hive's server is up, regardless of workload daemon health.

---

#### Dashboard ownership + code reuse

hive owns the unified dashboard: every route a user visits lives here, including the pages that originated in honeycomb and the Hive Graph page (PRD-015). This section originally specified **runtime reuse** of honeycomb's component layer. What shipped is **copy-and-own** (hive ADR-0001): the React components in `pages/*`, the route registry in `registry.tsx`, and the `PageProps` shape were copied into `hive/src/dashboard/web/` once, honeycomb's dashboard was deleted, and hive owns the code outright with no shared package and no drift risk. Concretely, as shipped:

- **Route registry**: hive's own `ROUTES` array (`hive/src/dashboard/web/registry.tsx`) carries all 11 entries, including `/hive-graph`.
- **Page components**: the honeycomb-origin pages live in hive's tree and fetch through hive's same-origin `wire`; `HiveGraphPage` is hive-authored and renders nectar data.
- **`PageProps`**: preserved through the copy, so the add-a-page contract survived the ownership change.

The "how to add a page" contract now lives in hive's own knowledge base (`hive/library/knowledge/private/frontend/spa-architecture.md`): write a `function MyPage({ wire, ... })`, add a `RouteEntry`, done.

---

#### Deployment + lifecycle

##### Boot ordering

```mermaid
sequenceDiagram
    participant OS as OS service manager
    participant HD as doctor
    participant TH as hive
    participant HB as honeycomb
    participant HN as nectar
    OS->>HD: boot (service unit)
    OS->>TH: boot (service unit, sibling)
    OS->>HB: boot (service unit)
    OS->>HN: boot (service unit)
    TH->>TH: bind socket 3853
    TH->>TH: render shell + status grid (NO workload dependency)
    Note over TH: dashboard is LIVE before any workload /health
    HD->>TH: probe /health (registry entry)
    HD->>HB: probe /health (registry entry)
    HD->>HN: probe /health (registry entry)
    TH->>HB: GET /api/* (populate dashboard, fail-soft)
    TH->>HN: GET /api/* (populate dashboard, fail-soft)
```

All four daemons are siblings under the OS service manager. There is no parent-child dependency. hive renders its shell the instant its own socket binds; workload data populates as each workload comes healthy.

##### Process surface

| Property | Value | Source |
|---|---|---|
| Port | 3853 | PRD-001b (confirmed) |
| PID file | `~/.honeycomb/hive.pid` | PRD-004d |
| Lock file | `~/.honeycomb/hive.lock` | PRD-004d (single-instance guard) |
| OS service unit | launchd `com.legioncode.hive` / systemd `hive.service` / Windows task `hive` | `hive/src/service/platform.ts` (fleet naming decision #32) |
| `/health` | `ok`/`degraded` — independent of workload health | ADR-0004 decision 1 |
| Registry entry | one row in `~/.honeycomb/doctor.daemons.json` | PRD-004a (hive is supervised like the others) |
| Stack | TypeScript/Node + Hono (reuses honeycomb's dashboard code) | PRD-004c, ADR-0004 decision 3 |

##### Update cadence

hive is a **separate release train** from doctor, honeycomb, and nectar. A dashboard change ships as a hive release (new bundle + restart of hive's service unit); it does not touch doctor or the workloads. Conversely, an doctor release does not redeploy hive. This is the operational realization of the stability/velocity split (ADR-0003 + ADR-0004 decision 4).

---

#### What hive explicitly is NOT

- **Not a Deeplake client.** No storage client, no tenancy scope, no queries. (ADR-0004 decision 2.)
- **Not a supervisor.** It does not probe `/health`, restart daemons, or own incident state — that's doctor.
- **Not a workload.** It does not brood, enrich, recall, or run any Nectar/honeycomb logic. It presents + aggregates.
- **Not a child of a workload.** It is a top-level supervised daemon, sibling to the workloads, so a workload outage does not take it down.
- **Not a fork of honeycomb's dashboard.** It is the dashboard: the code was copied and owned once (hive ADR-0001) and honeycomb's copy was retired, so there are not two dashboards to diverge.

---

#### Forward pointers

- **The decisions** (always-on, aggregation, ownership, cadence) → `ADR-0004`.
- **The build spec** (bootstrap, Hono server, aggregation `wire`, service unit, registration) → `prd-004c` + `prd-004d`.
- **The first hive-hosted page** (Hive Graph) → `prd-015`.
- **The dashboard code as shipped** → `hive/src/dashboard/web/registry.tsx` + `hive/src/dashboard/web/pages/*` (copy-and-own per hive ADR-0001).
- **The topology hive sits inside** → `ADR-0003`.
- **Hive's own knowledge base** (authoritative for the shipped implementation) → `hive/library/knowledge/private/architecture/system-overview.md`.

### Hive Graph Schema

The canonical Deeplake table catalog for Nectar: two tables (`hive_graph` for logical identity, `hive_graph_versions` for the append-only content+description chain), the column-by-column rationale, indexing strategy, tenancy model, and the lazy-schema-heal contract.

#### Why two tables

A single table cannot cleanly represent the two things Nectar must track. A file's *identity* is stable — it survives edits, renames, and moves. A file's *content and description* change constantly — every save produces new bytes, and the description eventually drifts to match. Collapsing both into one row forces an overwrite on every edit (losing history) or an append on every edit (losing the stable-identity key under a pile of versions).

The split mirrors how git works internally: a commit object (stable identity anchor) points at a tree, which points at blobs (content-addressed versions). It also mirrors how Aura separates "identity anchor" from "content hash" (see `../reference/prior-art-crosswalk.md`), and how Mimir keeps a stable `SymbolId` distinct from its append-only rename history. The pattern is well-trodden because it is correct.

- **`hive_graph`** — one row per logical file. Keyed by nectar (ULID). Identity + provenance only. No content, no description.
- **`hive_graph_versions`** — append-only. Keyed by `(nectar, content_hash)`. One row per observed state. Carries the path, the metadata, and the lazily-filled description.

"Current state of file X" = the latest version row for X's nectar. "Full history of file X" = all version rows for X's nectar. Both are cheap queries.

---

#### The `hive_graph` table (identity + provenance)

```sql
CREATE TABLE IF NOT EXISTS "hive_graph" (
  nectar              TEXT NOT NULL DEFAULT '',
  kind                TEXT NOT NULL DEFAULT 'file',
  created_at          TEXT NOT NULL DEFAULT '',
  derived_from_nectar TEXT NOT NULL DEFAULT '',
  fork_content_hash   TEXT NOT NULL DEFAULT '',
  org_id              TEXT NOT NULL DEFAULT '',
  workspace_id        TEXT NOT NULL DEFAULT '',
  project_id          TEXT NOT NULL DEFAULT '',
  last_update_date    TEXT NOT NULL DEFAULT ''
) USING deeplake;
```

| Column | Type | Purpose |
|---|---|---|
| `nectar` | TEXT | **Primary key.** 26-char ULID minted once by hiveantennae. Never changes. Never derived from content. Sortable by creation time. |
| `kind` | TEXT | Discriminator: `'file'` in v1. Reserved for `'directory'` if folder-level nectars are added later (see YAGNI note at the bottom). |
| `created_at` | TEXT | ISO 8601 timestamp of nectar minting. Equals the ULID's embedded timestamp but stored explicitly for portability into `nectars.json` (ULIDs are not self-describing to humans). |
| `derived_from_nectar` | TEXT | Copy-paste provenance. Empty for an originally-minted file. Set to the source nectar when a new path appears whose content matches an existing file's current content (the copy event). Survives forever, even after both files diverge. |
| `fork_content_hash` | TEXT | The content hash at the fork point. Lets the enricher render "this file was copied from X when X looked like Y" — useful for the Obsidian-style interlink view. |
| `org_id` | TEXT | Tenancy. Explicit because identity is cross-cutting (mirrors the `codebase` table's tenancy columns). |
| `workspace_id` | TEXT | Tenancy. Same rationale. |
| `project_id` | TEXT | Project isolation within a workspace. Soft column filter, not a Deeplake partition or provisioning boundary. |
| `last_update_date` | TEXT | Denormalized "last observed change" timestamp. Updated whenever a new version row is appended. Lets the projection sync and the dashboard render "recently touched" without scanning the versions table. |

The `nectar` column is the only column that is truly immutable. `derived_from_nectar` and `fork_content_hash` are write-once (set at minting, never updated). Everything else is mutable but rarely changes after the row's first write.

---

#### The `hive_graph_versions` table (content + description chain)

```sql
CREATE TABLE IF NOT EXISTS "hive_graph_versions" (
  nectar          TEXT NOT NULL DEFAULT '',
  content_hash    TEXT NOT NULL DEFAULT '',
  seq             BIGINT NOT NULL DEFAULT 0,
  path            TEXT NOT NULL DEFAULT '',
  filename        TEXT NOT NULL DEFAULT '',
  ext             TEXT NOT NULL DEFAULT '',
  size_bytes      BIGINT NOT NULL DEFAULT 0,
  mtime_observed  TEXT NOT NULL DEFAULT '',
  title           TEXT NOT NULL DEFAULT '',
  description     TEXT NOT NULL DEFAULT '',
  concepts        TEXT NOT NULL DEFAULT '[]',
  embedding       FLOAT4[],
  confidence      REAL,
  fingerprint     TEXT,
  described_at    TEXT NOT NULL DEFAULT '',
  describe_model  TEXT NOT NULL DEFAULT '',
  describe_status TEXT NOT NULL DEFAULT 'pending',
  observed_at     TEXT NOT NULL DEFAULT '',
  org_id          TEXT NOT NULL DEFAULT '',
  workspace_id    TEXT NOT NULL DEFAULT '',
  project_id      TEXT NOT NULL DEFAULT '',
  last_update_date TEXT NOT NULL DEFAULT ''
) USING deeplake;
```

| Column | Type | Purpose |
|---|---|---|
| `nectar` | TEXT | FK → `hive_graph.nectar`. Composite key part 1. |
| `content_hash` | TEXT | sha256 of file content at observation. Composite key part 2. **Changes per edit** — that is the point. |
| `seq` | BIGINT | Monotonic per-nectar version counter (0, 1, 2, …). Lets "latest version" be `ORDER BY seq DESC LIMIT 1` without parsing timestamps or relying on `content_hash` ordering. |
| `path` | TEXT | Repo-relative path with forward slashes, at observation time. **Mutable across version rows for the same nectar** — this is how moves are recorded. A nectar's `seq=0` row might say `src/a.ts` and its `seq=3` row might say `src/auth/a.ts`; the chain captures the rename. |
| `filename` | TEXT | Bare filename (`a.ts`). Denormalized from path for fast filename-only searches without path parsing. |
| `ext` | TEXT | Lowercased extension without dot (`ts`, `tsx`, `md`, `json`). Routed to the right CodeGraph extractor and to the brooding batcher (see brooding doc). |
| `size_bytes` | BIGINT | File size. Used to skip empty files and to bucket large files for solo-description. |
| `mtime_observed` | TEXT | File mtime at observation. Not authoritative (mtime is mutable), but useful as a fast-path cache key: if `(path, mtime, size)` all match the last observation, skip re-hashing. |
| `title` | TEXT | LLM-minted, ≤80 chars. Nullable until enriched. Empty string while pending, filled by the enricher. |
| `description` | TEXT | LLM-minted, 1–3 sentences. Nullable until enriched. Same lifecycle as `title`. |
| `concepts` | TEXT | JSON-encoded string array (`'["auth","session","jwt"]'`). LLM-minted concept tags for the Obsidian-style interlink layer. |
| `embedding` | FLOAT4[] | 768-dim vector over `title + ' ' + description`. **Same dimensionality as `sessions.message_embedding` and `memory.summary_embedding`** so the same hybrid recall pipeline queries all three. Nullable until enriched. |
| `confidence` | REAL | Set only on rows appended by re-association ladder step 4 (TLSH fuzzy match); the value is `1 − normalizedTLSHDistance`. NULL for all other rows. Supports the audit query "show me all auto-carried matches below a given confidence." |
| `fingerprint` | TEXT | TLSH-family locality-sensitive fingerprint of the content, computed on every content-bearing version row. Re-association ladder step 4 matches a moved-and-edited file against the fingerprints of missing files; persisting it here (rather than only in memory) is what lets cold-catch-up fuzzy matching survive a daemon restart. Nullable: rows written before this column existed leave it NULL and self-heal on next observation. |
| `described_at` | TEXT | Timestamp of the enricher run that filled `title`/`description`. Empty while pending. |
| `describe_model` | TEXT | Model identifier that produced the description (e.g. `gemini-2.5-flash` via `portkey`). Auditable, and lets a model swap trigger re-description selectively. |
| `describe_status` | TEXT | One of `pending`, `described`, `failed`, `skipped-too-large`, `skipped-binary`, `skipped-deleted`. Lets recall filter out undescribed rows and lets the enricher resume after failures. `skipped-deleted` marks a row whose file vanished while pending — distinct from `failed` (retryable LLM failure) so the enricher doesn't keep retrying a file that's gone. |
| `observed_at` | TEXT | Timestamp the version row was appended (distinct from `mtime_observed`, which is the file's own clock). |
| `org_id`, `workspace_id`, `project_id` | TEXT | Tenancy, denormalized from `hive_graph` so the versions table is queryable in isolation for recall. |
| `last_update_date` | TEXT | Standard Honeycomb UPDATE-coalescing workaround column. |

The composite key `(nectar, content_hash)` has a useful invariant: the same content under the same nectar is a no-op (idempotent re-observation after a no-change save). The same content under a *different* nectar is the copy-paste signal that sets `derived_from_nectar` on the newer nectar.

---

#### Sequence allocation and latest-version resolution

"Latest version of a nectar" means the row with the highest `seq`, and `seq` must therefore be unique per nectar for that phrase to resolve unambiguously. Deeplake offers no transactions and no enforced unique constraint, so `seq` uniqueness is a property the daemon maintains in code, not one the backend guarantees. Two mechanisms in `DeepLakeHiveGraphStore` together keep it monotonic and collision-free.

The first is **per-nectar append serialization**: every seq-allocating append for a nectar is chained through one promise, so the allocate-and-append pair is atomic within the store instance and two callers sharing the store cannot both read the same `MAX(seq)` and both write `seq+1` (`src/hive-graph/deeplake-store.ts:272-281`).

The second is a **lag-immune in-process high-water mark**, added after a live incident. Renaming a watched file while its describe append was still in flight produced a duplicate `(nectar, seq)` pair: the enricher's durable describe append and the registration bridge's carry flush allocated seqs from independent views of the store (a backend `SELECT MAX(seq)` under read-after-write lag versus a private in-memory mirror), and Deeplake's read lag meant a just-appended row was invisible to the very next `SELECT seq`. The store now records the highest seq this process has written per nectar and allocates `max(inProcessHighWater, backendMax) + 1`, so the read is no longer trusted to reflect an append that already happened here (`src/hive-graph/deeplake-store.ts:282-298`, `src/hive-graph/deeplake-store.ts:459-478`). Every durable append funnels the written seq back into the high-water mark (`src/hive-graph/deeplake-store.ts:399-414`).

Both components now route every version append through one shared allocator, `appendVersionAtNextSeq`, the single seq authority the live daemon wires into the enricher commit and the registration bridge flush (`src/hive-graph/store.ts:159-170`). The bridge re-allocates the seq at flush time rather than trusting the seq its synchronous mirror computed, then reconciles the allocated value back into the mirror so later synchronous reads agree with what persisted (`src/registration/store-bridge.ts:190-215`).

##### Healing an existing duplicate

The allocator prevents new duplicates; an idempotent repair heals any that already exist. Because the table is append-only (no in-place `UPDATE`, no unique constraint), the least-invasive correct repair for two rows tied at a nectar's `MAX(seq)` is to append a corrected copy of the winner one seq above the tie, making it the sole latest while the stale tied rows stay in history. The winner is the row with the newest `observed_at` (the most recently observed path or content, which is the renamed path after the incident), and its fields are copied verbatim so a pending carry stays pending and the enricher describes the newest path. The heal is idempotent: once the max seq is unique, a later pass finds nothing tied and does nothing (`src/registration/ladder.ts:551-591`). It runs from the crash-repair sweep and self-heals a live pre-fix duplicate on the next resync.

---

#### Indexing strategy

Deeplake indexing is additive and configured through the catalog helpers, not hand-rolled `CREATE INDEX`. The indexes Nectar relies on:

| Index | Table | Columns | Why |
|---|---|---|---|
| `deeplake_index` (BM25) | `hive_graph_versions` | `title`, `description` | Lexical recall over descriptions. Same operator Deeplake applies to `memory.summary`. |
| Vector (`` cosine) | `hive_graph_versions` | `embedding` | Semantic recall over descriptions. Falls back silently to BM25 if embeddings are off — same as the rest of Honeycomb, no quality cliff. |
| `deeplake_hybrid_record` | `hive_graph_versions` | BM25 + vector | The fused path recall prefers; documented in the main corpus's `ai/hybrid-sql-vector-rationale.md`. |
| Scope filter | `hive_graph_versions` | `org_id`, `workspace_id`, `project_id` | Every recall query scopes by tenancy before applying BM25/vector. |

The `path` and `filename` columns are covered by the standard ILIKE fallback (the same `sqlLike`-guarded lexical path that recall uses when vector indexes are absent or embeddings are off). No dedicated path index is needed in v1; the row counts (one per file version, not one per symbol) are small enough that ILIKE is adequate.

---

#### Tenancy and isolation

Decision update from `library/requirements/MASTER-PRD-INDEX.md:13`: `project_id` is a soft column-level filter within Honeycomb's org/workspace Deeplake scope. Nectar does not create per-project tables, per-project partitions, or a provisioning event when a project appears; catalog registration plus `withHeal` handles table creation and additive schema convergence on first write.

`hive_graph` and `hive_graph_versions` carry explicit `org_id`, `workspace_id`, and `project_id` columns. This mirrors the `codebase` table (the CodeGraph's cloud-sync target) and diverges from `sessions`/`memory`, which lean on partition isolation plus `agent_id`/`visibility`. The reason is that file identity is **cross-agent by nature** — every agent and every harness working in the same project should see the same file descriptions, so there is no `agent_id` column and no `visibility` column. Isolation is org→workspace at the Deeplake scope plus a required `project_id` predicate for project-level filtering.

A team sharing a workspace (the normal Honeycomb collaboration model) therefore shares a single Nectar graph per project by filtering on `project_id`. A new teammate's `git clone` + `nectar daemon` boot (registered with doctor per ADR-0003) pulls the cloud-synced `hive_graph_versions` rows for the workspace and re-derives the local projection from them, the same way the CodeGraph's `pullSnapshot` works.

---

#### Lazy schema healing

Decision update from `library/requirements/MASTER-PRD-INDEX.md:13`: there is no explicit DDL pre-step and no per-project provisioning flow. The Nectar catalog entries are registered with the daemon's catalog group, and `withHeal` creates or heals tables when the first write needs them.

Nectar tables participate in the same additive schema-heal pass as the rest of Honeycomb (documented in the main corpus's `data/deeplake-storage.md`). When hiveantennae writes through the catalog and finds a table missing, or finds an existing table missing a column added in a newer version (say `concepts` was added after initial deploy), `withHeal` creates or heals the table and backfills defaults. Existing rows get `'[]'` for `concepts`; the enricher picks them up on the next lazy pass.

Never hand-roll an `ALTER` against these tables. Define the `ColumnDef` array once in the daemon's schema module, add it to the catalog group, and let the heal pass converge. This is the same rule that governs every other Honeycomb table.

---

#### The projection contract

`hive_graph_versions` is the source of truth. `.honeycomb/nectars.json` (documented in `portable-registry.md`) is a **regenerable projection** - a denormalized, content-hash-keyed map of `{ content_hash: { nectar, title, description, concepts } }` for the *latest* version of each nectar in the project. If `nectars.json` is deleted, lost, or corrupted, `nectar project --rebuild-projection` regenerates it from Deeplake in a single scan. The projection is committed for portability across fresh clones, never because Deeplake is insufficient.

---

#### v1 non-goals (YAGNI)

The schema deliberately omits three things that the original design sketch mentioned, all deferred until measured need:

- **Directory nectars.** Folders are derivable from the union of file paths. A directory-level description can be synthesized on demand from its files' descriptions. The `kind` column reserves the namespace (`'directory'`) so this can be added later without a schema change, but v1 does not mint directory nectars. If synthesis reads weak in practice, add `kind='directory'` rows whose `content_hash` is `sha256(sorted_child_nectars)`.
- **Symbol-level nectars.** Symbol identity is the CodeGraph's job (and, optionally, an LSP layer's job). Nectar is file-granular in v1. Symbol-level semantic description would multiply row counts by 10–100× and duplicate what the CodeGraph already extracts structurally.
- **Edit-coalesced versioning.** Every save appends a version row. There is no debouncing at the schema level — debouncing happens at the watcher intake (see `ai/brooding-pipeline.md`), so the database sees one row per *meaningfully distinct* content state, not one per keystroke-save.

### Portable Registry (nectars.json)

The committed, reviewable, regenerable projection of the Deeplake `hive_graph` table that gives a fresh `git clone` its identity map before the daemon ever runs: what it contains, what it deliberately omits, how it differs from a sidecar, how it is generated and validated, and how it interacts with team sharing.

#### What the portable registry is for

Deeplake is the source of truth for Nectar, but Deeplake is not in the git repo. A fresh `git clone` has the source files and no nectars — until either (a) the daemon boots and pulls the workspace's rows from Deeplake cloud sync, or (b) the daemon boots and broods from scratch, re-paying the LLM cost. Option (a) requires network and auth; option (b) wastes money and time.

The portable registry is a third option. `.honeycomb/nectars.json` is a single committed file at the project root that carries enough of the Deeplake state to re-derive identity on a fresh clone *without* network, auth, or LLM calls. It is the bridge between "the source of truth is in the cloud" and "a clone should work offline immediately."

The registry is a **projection**, not a sidecar. The distinction matters and is enforced:

- A **sidecar** is a parallel source of truth that the system reads from and writes to during normal operation. Sidecars drift, get out of sync, and become liabilities. FR-8 in the main Honeycomb PRD substrate explicitly forbids them.
- A **projection** is a denormalized, regenerable view of the source of truth. It is written from the source of truth on a defined schedule, never edited directly, and can be deleted and regenerated without loss. A lockfile (`package-lock.json`, `Cargo.lock`) is a projection; an `.env` is a sidecar.

`.honeycomb/nectars.json` is generated from Deeplake at the end of every brood and every enricher cycle that produced new descriptions. It is committed for portability. It is never the system of record.

---

#### The file format

```json
{
  "version": 1,
  "generated_at": "2026-06-30T12:00:00Z",
  "generator": "honeycomb-nectar@0.1.13",
  "project": {
    "org_id": "legion",
    "workspace_id": "engineering",
    "project_id": "honeycomb"
  },
  "files": {
    "01J2X4F6K8ME7N9P1Q3R5T7V9WX": {
      "content_hash": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      "path": "src/auth/login.ts",
      "title": "User login route handler",
      "description": "Validates credentials against the user store, starts a session, and issues a JWT refresh token. Entry point for the /login API.",
      "concepts": ["auth", "login", "session", "jwt"],
      "describe_model": "gemini-2.5-flash",
      "described_at": "2026-06-29T14:30:00Z"
    },
    "01J2X4F6K8ME7N9P1Q3R5T7V9WY": {
      "content_hash": "2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae",
      "path": "src/middleware/session-refresh.ts",
      "title": "JWT session refresh middleware",
      "description": "Refreshes JWT claims on each authenticated request. Part of the login session lifecycle.",
      "concepts": ["auth", "session", "jwt", "middleware"],
      "describe_model": "gemini-2.5-flash",
      "described_at": "2026-06-29T14:30:05Z"
    }
  },
  "derived": {
    "01J2X4F6K8ME7N9P1Q3R5T7V9WY": {
      "from_nectar": "01J2X4F6K8ME7N9P1Q3R5T7V9WX",
      "fork_content_hash": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
    }
  }
}
```

##### What it contains

- **`version`** — schema version of the projection format. Bumped on incompatible changes; old daemon versions refuse to load a higher version and fall back to full brooding.
- **`generated_at`** — when the projection was last regenerated. Lets a clone detect staleness ("this projection is 3 weeks old; the daemon should verify against Deeplake when it gets network").
- **`generator`** — the daemon version that produced the file. Auditable.
- **`project`** — the tenancy triple. A clone in a different project context refuses to load a mismatched projection.
- **`files`** — the main payload. Keyed by nectar (ULID). Each entry carries the latest described version's content hash, path, title, description, concepts, and provenance metadata. This is exactly the data recall needs.
- **`derived`** — the copy-paste provenance map. Keyed by the derived nectar, pointing at the source nectar and fork content hash. Separated from `files` so the file map stays flat for content-hash lookups.

##### What it deliberately omits

- **The full version chain.** Only the latest described version per nectar is included. Historical versions stay in Deeplake. Including them would bloat the file and serve no recall purpose.
- **Embeddings.** The 768-dim vectors are not in the projection. They are regenerable from `title + description` via the configured embedding provider, and including them would make the file megabytes instead of kilobytes. A fresh clone recomputes embeddings on first daemon boot when a provider is available (or skips them when embeddings are unavailable).
- **Undescribed files.** A nectar minted but never described (brooding was interrupted, or the file was skipped as binary) appears with a minimal entry (`path`, `content_hash`, but empty `title`/`description`) so identity is preserved, but recall will not surface it until described.
- **Internal IDs.** No Deeplake row IDs, no internal indices. The projection is portable across Deeplake instances.

---

#### How it is used on a fresh clone

When hiveantennae boots and finds `.honeycomb/nectars.json` present, the boot path is:

```mermaid
flowchart TD
    boot["daemon boot on fresh clone"] --> load["load nectars.json"]
    load --> validate{"version + project match?'}
    validate -->|no| fallback["ignore projection, full brood"]
    validate -->|yes| index["build content_hash -> nectar index"]
    index --> scan["scan disk, hash each file"]
    scan --> match{"content_hash in index?"}
    match -->|yes| inherit["inherit nectar + description, write to Deeplake"]
    match -->|no| ladder["run re-association ladder, possibly mint new nectar"]
    inherit --> ready["recall is live immediately"]
    ladder --> ready
```

A fresh clone with a current projection typically achieves **zero LLM calls and zero fuzzy matches**: every file's content hash matches the projection, every nectar is inherited, every description is carried over. The daemon writes the inherited rows to Deeplake (the local Deeplake instance, which is the substrate for this clone's recall) and is immediately ready to serve semantic queries. The brooding cost was paid by whoever first brooded the project; the clone pays nothing.

When the projection is stale (files on disk have content hashes not in the projection), those files enter the re-association ladder (`../ai/identity-and-reassociation.md`). The projection's content-hash index is the "known nectars" map that step 3 of the ladder consults; a content-hash match against a projection entry inherits that nectar directly without needing Deeplake cloud sync.

---

#### Generation and regeneration

The projection is regenerated by the daemon at three points:

1. **End of brooding.** A full brood produces a complete projection.
2. **End of an enricher cycle that wrote new descriptions.** An incremental update — the projection is rewritten with the newly-described versions substituted in.
3. **Explicitly, via `nectar rebuild-projection`.** A full regeneration from Deeplake, used when the projection is corrupt, lost, or suspected stale.

Regeneration is a single scan of `hive_graph_versions` (latest described version per nectar, scoped to the project), denormalized into the projection format, written atomically (temp file + rename, same pattern the CodeGraph uses for snapshot writes). The write is atomic so a crashed regeneration leaves the old projection, not a partial one.

##### Validation on load

When the daemon loads a projection, it validates:

- `version` is one it knows how to read (≤ its own schema version).
- `project.org_id`, `project.workspace_id`, `project.project_id` match the current context. A mismatch means the projection is from a different project (the repo was templated from another project, or the file was committed by mistake) and is ignored.
- Every nectar key is a syntactically valid ULID.
- Every `content_hash` is a syntactically valid sha256.

A projection that fails validation is ignored with a warning, and the daemon falls back to full brooding. The projection is never partially loaded.

---

#### The commit discipline

`.honeycomb/nectars.json` should be committed to the repo, like `package-lock.json`. This is what makes it a team asset: every teammate's clone inherits it.

The churn cost is manageable. The projection changes when:

- A new file is added and described (one entry added).
- A file's description is updated (one entry's fields change).
- A file is deleted (one entry removed — though the daemon may keep it for a grace period in case of branch switches).

A typical PR might add or modify a handful of projection entries. The diff is reviewable: a reviewer can see "this PR added `src/auth/login.ts` with the description 'User login route handler'" and sanity-check that the description is reasonable. This is a real benefit — the descriptions become a reviewable artifact, not an opaque database blob.

To avoid projection churn dominating PR diffs, the daemon debounces projection writes the same way it debounces enricher calls (see `../ai/enricher-and-llm-model.md`). A rapid-fire edit session produces one projection write at the end, not one per save. The committed file therefore changes at most once per enricher cycle (default 30 seconds), and in practice far less often — only when descriptions actually change.

##### The `.gitignore` question

Some teams may prefer not to commit the projection (concerns about diff noise, or a preference for each clone to brood independently). Nectar supports this: if `.honeycomb/nectars.json` is gitignored, the daemon still writes it locally (for the clone's own use) but it is not shared. The tradeoff is that every clone broods from scratch, paying the LLM cost each time. The recommendation is to commit it, but the system works either way.

---

#### How it differs from a sidecar (the rule)

The line between "projection" and "sidecar" is enforcement, not format. The same JSON file is a projection if the system treats it as regenerable, and a sidecar if the system reads from it as a source of truth. Nectar enforces the projection invariant through three rules:

1. **Deeplake writes happen first.** Every nectar mint, version append, and description write goes to Deeplake before the projection is regenerated. The projection is never the target of a write; it is always derived.
2. **The projection is never edited by hand or by external tools.** A hand-edit to `.honeycomb/nectars.json` is overwritten on the next regeneration. The file is read-only from the system's perspective except for the regeneration write.
3. **The projection is regenerable from Deeplake alone.** `nectar rebuild-projection` produces a byte-identical file (modulo `generated_at`) from a Deeplake scan, with no other inputs. If it did not, the projection would be carrying state Deeplake does not have, which would make it a sidecar.

These rules are what keep `.honeycomb/nectars.json` on the right side of FR-8. The file exists for portability and reviewability; it does not exist because Deeplake is insufficient.

---

#### What the portable registry explicitly does not do

- **It does not carry embeddings.** Regenerated locally on boot from `title + description`.
- **It does not carry the version chain.** Only the latest described version per nectar.
- **It does not carry tenancy for every row.** The project triple is at the top level; individual entries do not repeat it.
- **It does not sync bidirectionally with Deeplake.** Sync is one-directional: Deeplake → projection. The reverse (projection → Deeplake) happens only on a fresh clone, as an inheritance write, and only for nectars the local Deeplake does not already have.
- **It does not replace Deeplake cloud sync.** A team that commits the projection gets offline-fresh-clone support; a team that also uses Deeplake cloud sync gets live description updates as teammates describe new files. The two are complementary, not alternative.

### Recall Integration

How Nectar's `hive_graph_versions` table plugs into the existing Honeycomb hybrid recall pipeline: the guarded hive-graph arm, the latest-per-nectar subquery, the weighting and dedup strategy against session/memory/skill hits, and the structural-vs-semantic complementarity that makes recall stronger with both layers than with either alone.

#### What recall looks like before Nectar

The existing Honeycomb hybrid recall pipeline (documented in the main corpus at `ai/retrieval.md` and `ai/hybrid-sql-vector-rationale.md`) answers an agent query by running BM25 lexical and 768-dim vector search over three guarded arms:

1. **`sessions`** — raw conversation events. `message` (JSONB) is the body; `message_embedding` is the vector.
2. **`memory`** — wiki summaries and VFS rows. `summary` is the body; `summary_embedding` is the vector.
3. **`memories`** — distilled facts from the pipeline. `body` is the text; `body_embedding` is the vector.

Each arm returns its top-K matches with a score; the results are fused by reciprocal rank fusion (RRF — see ADR-0001 in the main corpus) into a single ranked list, scoped by `org_id`/`workspace_id`/`project_id`/`agent_id`/`visibility` as each arm's schema requires. The result tells the agent *what was discussed and what was decided* about the query topic.

What it does not tell the agent is *what files in the codebase implement the query topic*. The CodeGraph's structural query surface (`find/`, `query/`, `show/`) answers that for symbol-shaped queries (`find/authenticate`), but not for semantic queries ("where is the login logic") — that is the gap Nectar fills.

---

#### The added guarded arm

Nectar adds a fourth guarded arm to recall: `hive_graph_versions`, filtered to the latest described version per nectar. The arm contributes a row per matching file, scored by BM25 over `title + description` and vector similarity over `embedding`.

```sql
-- The Nectar recall arm (simplified; the real query is sqlStr/sqlLike-guarded
-- per the SQL safety floor in AGENTS.md, and uses the helpers in src/daemon/storage/sql.ts)
SELECT
  'nectar' AS source,
  v.nectar     AS id,
  v.path       AS path,
  v.title      AS title,
  v.description AS body,
  v.concepts   AS concepts,
  v.content_hash AS content_hash
FROM hive_graph_versions v
INNER JOIN (
  SELECT nectar, MAX(seq) AS max_seq
  FROM hive_graph_versions
  WHERE describe_status = 'described'
    AND org_id       = :org
    AND workspace_id = :workspace
    AND project_id   = :project
  GROUP BY nectar
) latest ON v.nectar = latest.nectar AND v.seq = latest.max_seq
WHERE (
  v.title       ILIKE :pattern
  OR v.description ILIKE :pattern
  OR v.concepts  ILIKE :concept_pattern
)
ORDER BY bm25_score DESC
LIMIT :k;
```

The vector arm is analogous, substituting `` (cosine similarity, sorted `DESC`, per the pg_deeplake operator reference) over `embedding` for the BM25/ILIKE filter, gated on `embedding IS NOT NULL`. When embeddings are off, only the BM25 arm runs - same silent-fallback behavior as every other recall arm in Honeycomb.

The guard is load-bearing. If the Nectar tables are not present in a fresh workspace, this arm returns empty and the sessions, memory, and memories arms still answer. The implementation therefore mirrors Honeycomb's per-arm guarded-query pattern (`buildHiveGraphVersionsArmSql` beside the existing arm builders), rather than refactoring recall into one monolithic query.

The `latest-per-nectar` subquery is what makes recall return one row per *current* file rather than one row per *version*. Without it, a file edited 50 times would dominate recall with 50 near-duplicate rows; with it, recall sees only the most recent described state.

---

#### Fusion with the other arms

The Nectar arm feeds into the same RRF fusion as the other three. RRF is rank-based, not score-based, so the four arms contribute equally on a per-row basis: a Nectar hit at rank 1 contributes the same RRF weight as a sessions hit at rank 1, regardless of how their raw BM25/vector scores compare. This is why the four arms can have different score distributions (sessions JSONB is noisy; Nectar descriptions are clean and short) without one drowning the others out.

```mermaid
flowchart LR
    q["agent query: everything associated with logins"] --> bm25
    q --> vec
    subgraph bm25[BM25 lexical]
        s1[sessions]
        m1[memory]
        mem1[memories]
        h1[nectar - title/description]
    end
    subgraph vec[768-dim vector]
        s2[sessions]
        m2[memory]
        mem2[memories]
        h2[nectar - embedding]
    end
    bm25 --> rrf[RRF fusion]
    vec --> rrf
    rrf --> ranked["ranked results: code files + session traces + distilled facts"]
```

The agent receives a single ranked list where a code-file description ("refreshes JWT claims on each authenticated request, part of the login session lifecycle") sits alongside session traces ("we discussed the JWT refresh bug on Tuesday") and distilled facts ("JWT refresh has a 5-minute skew tolerance"). The agent can then decide whether to read the code file, replay the session, or trust the fact — it has all three signals in one place.

---

#### Weighting and the Nectar multiplier

RRF is unweighted by default (each arm's rank-1 contributes `1 / (k + 1)` with the same `k`), but the recall layer supports per-arm multipliers for cases where one arm should count more or less. Nectar ships with a **multiplier of 1.0** (equal weighting) as the default, on the theory that a file-description hit is exactly as actionable as a session-trace hit — they answer different aspects of the same question.

Operators who find Nectar hits dominating recall at the expense of session memory (a possible failure mode if descriptions are written to be too keyword-stuffed) can lower the multiplier via the `nectar_rrf_multiplier` key in `~/.honeycomb/nectar.json`:

```json
{
  "nectar_rrf_multiplier": 0.7
}
```

Resolution precedence is **environment variable > config file > code default**: `NECTAR_RECALL_MULTIPLIER` overrides the file, the file's `nectar_rrf_multiplier` overrides the built-in `1.0`, and a malformed file or unknown key is logged as a warning and ignored. The loader exposes the resolved value to the recall configuration surface (the search engine's dependencies). Note that the standalone hive-graph search engine that ships in this repo (`nectar search` and `POST /api/hive-graph/search`) applies **no cross-arm class weighting** (it is a per-arm guarded query per PRD-012a), so the multiplier is the wiring point the shipped cross-memory fusion arm (PRD-013) reads inside Honeycomb, not a value that alters the in-repo search engine's own fusion. This is the same `~/.honeycomb/nectar.json` loader that serves the enricher's `redescribe_threshold` (see `ai/enricher-and-llm-model.md`).

The reverse (raising the multiplier) is also supported but rarely useful — if Nectar is the dominant signal, the operator probably wants to investigate why session memory is thin, not amplify code descriptions to compensate.

---

#### Structural-vs-semantic complementarity in practice

The value of Nectar alongside the structural CodeGraph is clearest in a worked example. Consider the query *"everything associated with logins"* against a typical Honeycomb-shaped codebase:

| Source | What it returns | Quality |
|---|---|---|
| **CodeGraph `find/login`** | `src/auth/login.ts` (functions named `login`, `loginUser`), `src/api/routes/login.ts` | Exact, but misses anything not named "login" |
| **Nectar recall** | `src/auth/login.ts` ("user login entry point, validates credentials and starts a session"), `src/middleware/session-refresh.ts` ("refreshes JWT claims on each authenticated request, part of the login session lifecycle"), `src/lib/jwt.ts` ("JWT issue/verify, used by login and session-refresh"), `src/api/routes/logout.ts` ("ends a login session, clears refresh token") | Broader, surfaces files by *function* not *name* |
| **Sessions recall** | Tuesday's debugging session about the login skew bug | What was discussed, not what exists |

The structural hit (`find/login`) finds the files with "login" in their symbol names. The semantic hit (`session-refresh.ts`, `jwt.ts`, `logout.ts`) finds the files that *participate in* login without being named after it. The session hit finds the human discussion. Together they give the agent a complete picture; separately each is a blind spot.

The two are not redundant. The CodeGraph cannot find `session-refresh.ts` because no symbol in it is named `login*`. Nectar cannot tell you that `login.ts:14` calls `verifyJwt` (a structural edge) — it can only tell you that `login.ts` is *about* login. The agent uses both: Nectar to discover which files matter, the CodeGraph to navigate within and between them.

---

#### What recall does not do with Nectar

- **It does not return undescribed rows.** The `describe_status = 'described'` filter excludes pending, failed, and skipped rows. A file that was never described (brooding not yet reached it, or it was skipped as binary/too-large) does not appear in semantic recall. It may still appear in the structural CodeGraph's `find/` results, keyed by symbol name.
- **It does not deduplicate against CodeGraph hits.** If `src/auth/login.ts` appears in both a Nectar recall hit and a CodeGraph `find/login` hit, both are returned. The agent (or the harness prompt assembler) is responsible for recognizing them as the same file. Dedup at the recall layer would lose the structural context the CodeGraph hit carries (symbol names, line numbers).
- **It does not return historical versions.** Only the latest described version per nectar participates in recall. A prior version of a file (before a major refactor) is in the version chain as history but not in recall. This is deliberate: recall serves the current question, not archaeology.
- **It does not run during brooding's LLM calls.** Recall reads Deeplake; brooding writes Deeplake; the two proceed concurrently with no coordination. A query mid-brood sees whatever has been described so far.

---

#### The fresh-clone and team-share path

Because `hive_graph_versions` is a Deeplake table with tenancy columns, it cloud-syncs the same way every other Honeycomb table does. A teammate who clones the repo and runs `nectar daemon` (registered with doctor, per ADR-0003) for the first time:

1. Pulls the workspace's `hive_graph_versions` rows from Deeplake (the team-share path documented in the main corpus's `collaboration/` domain).
2. Re-derives the local `.honeycomb/nectars.json` projection from the pulled rows (or inherits the committed projection if present — see `portable-registry.md`).
3. Immediately has working semantic recall over the codebase, without brooding, because every file's content hash matches a pulled version row.

This is the property that makes Nectar a team asset, not a per-developer index. The brooding cost is paid once by whoever broods first; every teammate thereafter inherits the descriptions through Deeplake sync plus the projection lockfile.

### Hive Graph: Technical Specification

The column-level reference for the two Nectar Deeplake tables: full DDL carried verbatim, a column-by-column mutability table for each table, the indexing strategy, the tenancy/isolation contract, the lazy-schema-heal rule, the projection contract, and the v1 non-goals.

#### The two tables at a glance

`hive_graph` is one row per logical file — the stable identity and provenance, keyed by nectar, with no content and no description. `hive_graph_versions` is append-only — one row per observed state of a file, keyed by `(nectar, content_hash)`, carrying the path, the metadata, and the lazily-filled description. "Current state of file X" is the latest version row for X's nectar; "full history of file X" is all version rows for X's nectar. Both are cheap queries. The conceptual rationale for the split is in `hive-graph-introduction-and-theory.md`; this document is the mechanical reference.

---

#### `hive_graph` — identity + provenance

```sql
CREATE TABLE IF NOT EXISTS "hive_graph" (
  nectar              TEXT NOT NULL DEFAULT '',
  kind                TEXT NOT NULL DEFAULT 'file',
  created_at          TEXT NOT NULL DEFAULT '',
  derived_from_nectar TEXT NOT NULL DEFAULT '',
  fork_content_hash   TEXT NOT NULL DEFAULT '',
  org_id              TEXT NOT NULL DEFAULT '',
  workspace_id        TEXT NOT NULL DEFAULT '',
  project_id          TEXT NOT NULL DEFAULT '',
  last_update_date    TEXT NOT NULL DEFAULT ''
) USING deeplake;
```

##### Column-by-column reference

| Column | Type | Purpose | Mutability |
|---|---|---|---|
| `nectar` | TEXT | **Primary key.** 26-char ULID minted once by hiveantennae. Never derived from content. Sortable by creation time. | Immutable — the one truly immutable column |
| `kind` | TEXT | Discriminator: `'file'` in v1. Reserved for `'directory'` if folder-level nectars are added later. | Write-once at minting; effectively immutable |
| `created_at` | TEXT | ISO 8601 timestamp of nectar minting. Equals the ULID's embedded timestamp but stored explicitly for portability into `nectars.json` (ULIDs are not self-describing to humans). | Write-once at minting |
| `derived_from_nectar` | TEXT | Copy-paste provenance. Empty for an originally-minted file. Set to the source nectar when a new path appears whose content matches an existing file's current content (the copy event). Survives forever, even after both files diverge. | Write-once at minting; never updated |
| `fork_content_hash` | TEXT | The content hash at the fork point. Lets the enricher render "this file was copied from X when X looked like Y" for the Obsidian-style interlink view. | Write-once at minting; never updated |
| `org_id` | TEXT | Tenancy. Explicit because identity is cross-cutting (mirrors the `codebase` table's tenancy columns). | Set at minting; not updated on edit |
| `workspace_id` | TEXT | Tenancy. Same rationale as `org_id`. | Set at minting; not updated on edit |
| `project_id` | TEXT | Project isolation within a workspace. Soft column filter, not a Deeplake partition or provisioning boundary. | Set at minting; not updated on edit |
| `last_update_date` | TEXT | Denormalized "last observed change" timestamp. Updated whenever a new version row is appended. Lets the projection sync and the dashboard render "recently touched" without scanning the versions table. | Mutable — the only column that moves on a routine edit |

The `nectar` column is the only truly immutable column. `derived_from_nectar` and `fork_content_hash` are write-once (set at minting, never updated). `kind`, `created_at`, and the tenancy triple are set at minting and never subsequently change. Only `last_update_date` moves on a routine edit, and it moves in lockstep with a version-row append on the versions table.

---

#### `hive_graph_versions` — content + description chain

```sql
CREATE TABLE IF NOT EXISTS "hive_graph_versions" (
  nectar          TEXT NOT NULL DEFAULT '',
  content_hash    TEXT NOT NULL DEFAULT '',
  seq             BIGINT NOT NULL DEFAULT 0,
  path            TEXT NOT NULL DEFAULT '',
  filename        TEXT NOT NULL DEFAULT '',
  ext             TEXT NOT NULL DEFAULT '',
  size_bytes      BIGINT NOT NULL DEFAULT 0,
  mtime_observed  TEXT NOT NULL DEFAULT '',
  title           TEXT NOT NULL DEFAULT '',
  description     TEXT NOT NULL DEFAULT '',
  concepts        TEXT NOT NULL DEFAULT '[]',
  embedding       FLOAT4[],
  described_at    TEXT NOT NULL DEFAULT '',
  describe_model  TEXT NOT NULL DEFAULT '',
  describe_status TEXT NOT NULL DEFAULT 'pending',
  observed_at     TEXT NOT NULL DEFAULT '',
  org_id          TEXT NOT NULL DEFAULT '',
  workspace_id    TEXT NOT NULL DEFAULT '',
  project_id      TEXT NOT NULL DEFAULT '',
  last_update_date TEXT NOT NULL DEFAULT ''
) USING deeplake;
```

##### Column-by-column reference

| Column | Type | Purpose | Mutability |
|---|---|---|---|
| `nectar` | TEXT | FK → `hive_graph.nectar`. Composite key part 1. | Set at row insert; immutable |
| `content_hash` | TEXT | sha256 of file content at observation. Composite key part 2. **Changes per edit** — that is the point. | Set at row insert; immutable |
| `seq` | BIGINT | Monotonic per-nectar version counter (0, 1, 2, …). Lets "latest version" be `ORDER BY seq DESC LIMIT 1` without parsing timestamps or relying on `content_hash` ordering. | Set at row insert; immutable |
| `path` | TEXT | Repo-relative path with forward slashes, at observation time. **Mutable across version rows for the same nectar** — this is how moves are recorded. A nectar's `seq=0` row might say `src/a.ts` and its `seq=3` row might say `src/auth/a.ts`; the chain captures the rename. | Set at row insert; differs across rows for the same nectar |
| `filename` | TEXT | Bare filename (`a.ts`). Denormalized from path for fast filename-only searches without path parsing. | Set at row insert; immutable within a row |
| `ext` | TEXT | Lowercased extension without dot (`ts`, `tsx`, `md`, `json`). Routed to the right CodeGraph extractor and to the brooding batcher. | Set at row insert; immutable within a row |
| `size_bytes` | BIGINT | File size. Used to skip empty files and to bucket large files for solo-description. | Set at row insert; immutable within a row |
| `mtime_observed` | TEXT | File mtime at observation. Not authoritative (mtime is mutable), but useful as a fast-path cache key: if `(path, mtime, size)` all match the last observation, skip re-hashing. | Set at row insert; immutable within a row |
| `title` | TEXT | LLM-minted, ≤80 chars. Empty string while pending, filled by the enricher. | Nullable-then-filled: empty at insert, set by enricher |
| `description` | TEXT | LLM-minted, 1–3 sentences. Same lifecycle as `title`. | Nullable-then-filled: empty at insert, set by enricher |
| `concepts` | TEXT | JSON-encoded string array (`'["auth","session","jwt"]'`). LLM-minted concept tags for the Obsidian-style interlink layer. | Nullable-then-filled: `'[]'` at insert, set by enricher |
| `embedding` | FLOAT4[] | 768-dim vector over `title + ' ' + description`. **Same dimensionality as `sessions.message_embedding` and `memory.summary_embedding`** so the same hybrid recall pipeline queries all semantic arms. | Nullable until enriched; set by the configured embedding provider |
| `described_at` | TEXT | Timestamp of the enricher run that filled `title`/`description`. Empty while pending. | Empty at insert; set by enricher |
| `describe_model` | TEXT | Model identifier that produced the description (e.g. `gemini-2.5-flash` via `portkey`). Auditable, and lets a model swap trigger re-description selectively. | Empty at insert; set by enricher |
| `describe_status` | TEXT | One of `pending`, `described`, `failed`, `skipped-too-large`, `skipped-binary`. Lets recall filter out undescribed rows and lets the enricher resume after failures. | `'pending'` at insert; transitions through lifecycle |
| `observed_at` | TEXT | Timestamp the version row was appended (distinct from `mtime_observed`, which is the file's own clock). | Set at row insert; immutable |
| `org_id`, `workspace_id`, `project_id` | TEXT | Tenancy, denormalized from `hive_graph` so the versions table is queryable in isolation for recall. | Set at row insert; immutable within a row |
| `last_update_date` | TEXT | Standard Honeycomb UPDATE-coalescing workaround column. | Mutable |

The table is append-only in the sense that a new observed state always means a new row, never an in-place edit of an existing row. The one exception is the enricher's fill: a version row is inserted with empty `title`/`description`/`embedding` and `describe_status = 'pending'`, and the enricher later sets the description columns and flips the status to `'described'` (or `'failed'`/`'skipped-*'`). This is a state transition on the row's description fields, not a content revision; the content hash and path never change once the row is written.

##### The `describe_status` lifecycle

```mermaid
stateDiagram-v2
    [*] --> pending : version row appended
    pending --> described : enricher fills title/description/embedding
    pending --> failed : enricher call errors
    pending --> skipped_too_large : file exceeds describe limit
    pending --> skipped_binary : file has no extractable text
    failed --> pending : enricher resumes after failure
    described --> described : re-described after model swap or content change appends new row
```

Recall filters to `describe_status = 'described'`, so rows in any other state do not surface in semantic search. The enricher uses the status to resume after failures: a `'failed'` row is retried on the next lazy pass, not abandoned.

##### The composite key invariant

The composite key `(nectar, content_hash)` has a useful property that the re-association and copy-detection logic both rely on. The same content under the same nectar is a no-op — an idempotent re-observation after a no-change save produces no new row because the key already exists. The same content under a *different* nectar is the copy-paste signal: the daemon mints a fresh nectar for the new path and sets `derived_from_nectar` on the newer nectar pointing at the source. The composite key is how the schema distinguishes "nothing changed" from "this is a fork."

##### The `seq` uniqueness contract

`seq` is the counter that makes "latest version" resolvable: the latest version of a nectar is its `MAX(seq)` row, so `seq` must be unique per nectar for that to be unambiguous. Deeplake has no transaction and no enforced unique constraint, so the daemon maintains `seq` uniqueness in code rather than leaning on the backend. `DeepLakeHiveGraphStore` uses two mechanisms together:

| Mechanism | What it prevents | Source |
|---|---|---|
| Per-nectar append serialization | Two callers sharing the store both reading one `MAX(seq)` and both writing `seq+1` | `src/hive-graph/deeplake-store.ts:272-281` |
| In-process seq high-water mark | A just-appended row being invisible to the next `SELECT seq` under Deeplake read-after-write lag | `src/hive-graph/deeplake-store.ts:282-298`, `src/hive-graph/deeplake-store.ts:459-478` |

The high-water mark was added after a live incident: renaming a watched file while its describe append was in flight let the enricher's durable append and the registration bridge's carry flush allocate seqs from independent, lag-affected views, producing a duplicate `(nectar, seq)` that left latest-version resolution ambiguous and the renamed path undescribed. The store now allocates `max(inProcessHighWater, backendMax) + 1`, seeding the running maximum from the highest seq this process has written so the read is never trusted to reflect an append that already happened here. Both components route every version append through one shared allocator, `appendVersionAtNextSeq` (`src/hive-graph/store.ts:159-170`); the bridge re-allocates the seq at flush time and reconciles the allocated value back into its synchronous mirror (`src/registration/store-bridge.ts:190-215`).

An existing duplicate is healed idempotently by the crash-repair sweep. Because the table is append-only, the repair appends a corrected copy of the newest-`observed_at` tied row one seq above the tie, making it the sole latest while the stale rows remain history; once the max seq is unique a later pass does nothing (`src/registration/ladder.ts:551-591`).

---

#### Indexing strategy

Deeplake indexing is additive and configured through the catalog helpers, not hand-rolled `CREATE INDEX` statements. The indexes Nectar relies on all live on `hive_graph_versions`, because that is the table recall queries.

| Index | Table | Columns | Why |
|---|---|---|---|
| `deeplake_index` (BM25) | `hive_graph_versions` | `title`, `description` | Lexical recall over descriptions. Same operator Deeplake applies to `memory.summary`. |
| Vector (`` cosine) | `hive_graph_versions` | `embedding` | Semantic recall over descriptions. Falls back silently to BM25 if embeddings are off — same as the rest of Honeycomb, no quality cliff. |
| `deeplake_hybrid_record` | `hive_graph_versions` | BM25 + vector | The fused path recall prefers; documented in the main corpus's `ai/hybrid-sql-vector-rationale.md`. |
| Scope filter | `hive_graph_versions` | `org_id`, `workspace_id`, `project_id` | Every recall query scopes by tenancy before applying BM25/vector. |

The `path` and `filename` columns are deliberately not given dedicated indexes in v1. They are covered by the standard ILIKE fallback — the same `sqlLike`-guarded lexical path that recall uses when vector indexes are absent or embeddings are off. The row counts (one per file version, not one per symbol) are small enough that ILIKE is adequate. If path-anchored queries ever dominate cost, a dedicated index can be added through the catalog helpers without a schema change.

All indexing is additive and lazy. The BM25 index is present from initial table creation. The vector index is created when the first embedding is written; if the configured embedding provider is unavailable, the vector index is simply absent and recall falls back to BM25 alone. There is no hard dependency on embeddings for Nectar to function — only for the semantic-search arm.

---

#### Tenancy and isolation contract

`hive_graph` and `hive_graph_versions` carry explicit `org_id`, `workspace_id`, and `project_id` columns. `project_id` is a soft column-level filter inside Honeycomb's org/workspace Deeplake scope, not a per-project table or provisioning boundary. This mirrors the `codebase` table (the CodeGraph's cloud-sync target) and diverges from `sessions` and `memory`, which lean on partition isolation plus `agent_id` and `visibility`.

The divergence is structural, not stylistic. File identity is **cross-agent by nature** — every agent and every harness working in the same project reads the same source tree, so they must see the same file descriptions. There is therefore no `agent_id` column and no `visibility` column on either Nectar table. A team sharing a workspace shares a single Nectar graph per project through the required `project_id` predicate.

The practical consequence is that recall queries against `hive_graph_versions` always carry a `WHERE org_id = :org AND workspace_id = :workspace AND project_id = :project` predicate (the scope filter in the indexing table above) and never carry an `agent_id` predicate. This is what makes a teammate's fresh `git clone` inherit descriptions through cloud sync: the rows for the workspace are shared, not per-agent. The full collaboration and team-share path is documented in `../recall-integration.md`.

---

#### The lazy-schema-heal rule

Nectar's tables participate in the same additive schema-heal pass as the rest of Honeycomb. The catalog group is registered once, and `withHeal` creates or heals tables on first write; there is no explicit per-project DDL step. When hiveantennae finds a table missing a column that a newer daemon version expects — for example, if `concepts` was added after initial deploy — the `withHeal` helper issues the additive `ALTER TABLE` and backfills defaults. Existing rows get `'[]'` for `concepts`; the enricher picks them up on the next lazy pass.

The rule is absolute: **never hand-roll an `ALTER` against these tables.** Define the `ColumnDef` array once in the daemon's schema module, add it to the catalog group, and let the heal pass converge. A hand-rolled ALTER bypasses the catalog, drifts from the `ColumnDef` source of truth, and produces a table that the next daemon boot will try to "heal" into a different shape — or, worse, a table whose columns the catalog does not know about and therefore cannot query correctly.

Heals are additive only. The heal pass adds columns that are missing; it never drops columns, renames them, or changes types. This is what makes healing safe to run on every boot without coordination: an additive ALTER cannot destroy data, and a column that the running daemon does not know about is simply ignored until an upgrade that uses it. The same rule governs every other Honeycomb table.

---

#### The projection contract

`hive_graph_versions` is the source of truth. The committed `.honeycomb/nectars.json` file (documented in `../portable-registry.md`) is a **regenerable projection** — a denormalized, content-hash-keyed map of `{ content_hash: { nectar, title, description, concepts } }` for the *latest described version* of each nectar in the project.

The contract has three parts, each enforceable:

1. **Deeplake writes happen first.** Every nectar mint, version append, and description write goes to Deeplake before the projection is regenerated. The projection is never the target of a write; it is always derived.
2. **The projection is regenerable from Deeplake alone.** `nectar project --rebuild-projection` regenerates it from a single scan of `hive_graph_versions`, with no other inputs. If it did not, the projection would be carrying state Deeplake does not have, which would make it a sidecar - and sidecars are forbidden by FR-8.
3. **The projection is never edited by hand.** A hand-edit is overwritten on the next regeneration. The file is read-only from the system's perspective except for the regeneration write.

If `nectars.json` is deleted, lost, or corrupted, the rebuild command regenerates it from Deeplake in a single scan. The projection is committed for portability across fresh clones (so a new checkout inherits descriptions without re-paying the brooding cost), never because Deeplake is insufficient. The distinction between a projection and a sidecar, and the enforcement rules, are documented in full in `../portable-registry.md`.

---

#### v1 non-goals (YAGNI)

The schema deliberately omits three things that the original design sketch mentioned, all deferred until measured need. Each is a deliberate non-goal for v1, not an oversight.

- **Directory nectars.** Folders are derivable from the union of file paths, and a directory-level description can be synthesized on demand from its files' descriptions. The `kind` column reserves the namespace (`'directory'`) so this can be added later without a schema change, but v1 does not mint directory nectars. If synthesis reads weak in practice, the path forward is `kind='directory'` rows whose `content_hash` is `sha256(sorted_child_nectars)`.
- **Symbol-level nectars.** Symbol identity is the CodeGraph's job (and, optionally, an LSP layer's job). Nectar is file-granular in v1. Symbol-level semantic description would multiply row counts by 10–100× and duplicate what the CodeGraph already extracts structurally.
- **Edit-coalesced versioning.** Every save appends a version row. There is no debouncing at the schema level — debouncing happens at the watcher intake, so the database sees one row per *meaningfully distinct* content state, not one per keystroke-save.

These non-goals constrain the schema's shape. The `kind` column exists only because directory support is a plausible future addition; without it, the column would not be there. The absence of a `symbol_id` or `parent_directory_nectar` column reflects the file-granular commitment. The append-on-every-distinct-content contract (no schema-level coalescing) is what makes `seq` a clean monotonic counter and the version chain a complete record.

---

#### Forward pointers

The conceptual rationale for the two-table split — why one table cannot cleanly represent both identity and version — is in `hive-graph-introduction-and-theory.md`. The end-to-end composition, tracing a nectar from minting through version append through enrich through recall, is in `hive-graph-ecosystem-story-arc.md`. The engineering and operator contracts that the schema imposes, written as testable acceptance criteria, are in `hive-graph-user-stories.md`. The hard invariants and deliverable summary are restated in `hive-graph-conclusion-and-deliverables.md`.

### Portable Registry: Technical Specification

The file-format spec for the `.honeycomb/nectars.json` projection carried from the source document, what it contains versus what it deliberately omits, the three generation points, the validation-on-load contract, the three projection-invariant enforcement rules, and the atomic write pattern.

#### The file format

The portable registry is a single JSON file at `.honeycomb/nectars.json` in the project root. Its schema is fixed by the source document and carried here verbatim so this spec is the canonical reference for the projection's shape.

```json
{
  "version": 1,
  "generated_at": "2026-06-30T12:00:00Z",
  "generator": "honeycomb-nectar@0.1.13",
  "project": {
    "org_id": "legion",
    "workspace_id": "engineering",
    "project_id": "honeycomb"
  },
  "files": {
    "01J2X4F6K8ME7N9P1Q3R5T7V9WX": {
      "content_hash": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      "path": "src/auth/login.ts",
      "title": "User login route handler",
      "description": "Validates credentials against the user store, starts a session, and issues a JWT refresh token. Entry point for the /login API.",
      "concepts": ["auth", "login", "session", "jwt"],
      "describe_model": "gemini-2.5-flash",
      "described_at": "2026-06-29T14:30:00Z"
    },
    "01J2X4F6K8ME7N9P1Q3R5T7V9WY": {
      "content_hash": "2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae",
      "path": "src/middleware/session-refresh.ts",
      "title": "JWT session refresh middleware",
      "description": "Refreshes JWT claims on each authenticated request. Part of the login session lifecycle.",
      "concepts": ["auth", "session", "jwt", "middleware"],
      "describe_model": "gemini-2.5-flash",
      "described_at": "2026-06-29T14:30:05Z"
    }
  },
  "derived": {
    "01J2X4F6K8ME7N9P1Q3R5T7V9WY": {
      "from_nectar": "01J2X4F6K8ME7N9P1Q3R5T7V9WX",
      "fork_content_hash": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
    }
  }
}
```

---

#### What it contains

Each top-level key has a defined role. The projection is denormalized specifically for content-hash lookups on a fresh clone; nothing is present that does not serve that purpose or the reviewability goal.

| Key | Purpose |
|---|---|
| `version` | Schema version of the projection format. Bumped on incompatible changes; old daemon versions refuse to load a higher version and fall back to full brooding. |
| `generated_at` | When the projection was last regenerated. Lets a clone detect staleness — a projection weeks old should be verified against Deeplake once network is available. |
| `generator` | The daemon version that produced the file. Auditable. |
| `project` | The tenancy triple (`org_id`, `workspace_id`, `project_id`). A clone in a different project context refuses to load a mismatched projection. |
| `files` | The main payload. Keyed by nectar (ULID). Each entry carries the latest described version's content hash, path, title, description, concepts, and provenance metadata. This is exactly the data recall needs. |
| `derived` | The copy-paste provenance map. Keyed by the derived nectar, pointing at the source nectar (`from_nectar`) and the fork content hash (`fork_content_hash`). Separated from `files` so the file map stays flat for content-hash lookups. |

---

#### What it deliberately omits

The projection is a denormalized view, not a dump. Four categories of Deeplake state are intentionally absent.

- **The full version chain.** Only the latest described version per nectar is included. Historical versions stay in Deeplake. Including them would bloat the file and serve no recall purpose — recall serves the current question, not archaeology.
- **Embeddings.** The 768-dim vectors are not in the projection. They are regenerable from `title + description` via the configured embedding provider, and including them would make the file megabytes instead of kilobytes. A fresh clone recomputes embeddings on first daemon boot when a provider is available, or skips them if embeddings are unavailable.
- **Undescribed files beyond a minimal entry.** A nectar minted but never described (brooding interrupted, or the file skipped as binary) appears with a minimal entry — `path` and `content_hash`, but empty `title`/`description` — so identity is preserved, but recall will not surface it until described.
- **Internal IDs.** No Deeplake row IDs, no internal indices. The projection is portable across Deeplake instances.

---

#### The three generation points

The projection is regenerated by the daemon at three defined points. There is no other write path.

1. **End of brooding.** A full brood produces a complete projection. This is the only mode that writes the initial `nectars.json`, making the brood durable and shareable (see `../../ai/brooding-pipeline.md`).
2. **End of an enricher cycle that wrote new descriptions.** An incremental update — the projection is rewritten with the newly-described versions substituted in. A cycle that wrote no descriptions produces no projection write.
3. **Explicitly, via `nectar rebuild-projection`.** A full regeneration from Deeplake, used when the projection is corrupt, lost, or suspected stale.

Regeneration is a single scan of `hive_graph_versions` — the latest described version per nectar, scoped to the project — denormalized into the projection format and written atomically. The scan reads only Deeplake; no other input is permitted, or the projection would be carrying state Deeplake does not have.

---

#### Validation on load

When the daemon loads a projection, it validates four properties before inheriting anything. Validation is atomic: any single failure causes the whole projection to be ignored with a warning, and the daemon falls back to full brooding. The projection is never partially loaded.

| Check | Predicate | Failure behavior |
|---|---|---|
| Version compatibility | `projection.version <= daemon.schema_version` | Ignore, fall back to brooding. |
| Project triple match | `project.org_id`, `project.workspace_id`, `project.project_id` all match current context | Ignore (the repo was templated from another project, or the file was committed by mistake), fall back to brooding. |
| ULID validity | Every nectar key in `files` is a syntactically valid ULID (26-char Crockford base32, uppercase) | Ignore, fall back to brooding. |
| sha256 validity | Every `content_hash` is a syntactically valid sha256 | Ignore, fall back to brooding. |

The fall-back-to-brood on failure is the recovery path. A clone whose projection is unreadable is not stuck; it broods from scratch, minting fresh nectars and writing fresh descriptions, and regenerates a new valid projection at the end of the brood. The cost is the brooding LLM spend (documented in `../../ai/brooding-pipeline.md`); the correctness is preserved.

```mermaid
flowchart TD
    load["load nectars.json"] --> v1{"version <= schema?"}
    v1 -->|no| ignore["ignore + warn"]
    v1 -->|yes| v2{"project triple match?"}
    v2 -->|no| ignore
    v2 -->|yes| v3{"all nectars valid ULID?"}
    v3 -->|no| ignore
    v3 -->|yes| v4{"all hashes valid sha256?"}
    v4 -->|no| ignore
    v4 -->|yes| inherit["build content_hash -> nectar index, inherit"]
    ignore --> brood["fall back to full brood"]
```

---

#### The three projection-invariant enforcement rules

The line between a projection and a sidecar is enforcement, not format. The same JSON file is a projection if the system treats it as regenerable, and a sidecar if the system reads from it as a source of truth. Nectar enforces the projection invariant through three rules, grounded in FR-8 (no sidecars — durable state goes in Deeplake).

##### Rule 1 — Deeplake writes happen first

Every nectar mint, version append, and description write goes to Deeplake *before* the projection is regenerated. The projection is never the target of a write; it is always derived. This ordering guarantees the projection reflects committed Deeplake state at the moment of regeneration.

##### Rule 2 — The projection is never edited by hand or by external tools

A hand-edit to `.honeycomb/nectars.json` is overwritten on the next regeneration. The file is read-only from the system's perspective except for the regeneration write. No external tool or human edit is respected as state.

##### Rule 3 — The projection is regenerable from Deeplake alone

`nectar rebuild-projection` produces a byte-identical file (modulo `generated_at`) from a Deeplake scan, with no other inputs. If it did not, the projection would be carrying state Deeplake does not have, which would make it a sidecar. This rule is what keeps the file on the right side of FR-8: it exists for portability and reviewability, not because Deeplake is insufficient.

---

#### Atomic write pattern

Regeneration writes atomically so a crashed regeneration leaves the old projection, not a partial one. The pattern is temp-file-plus-rename — the same pattern the CodeGraph uses for snapshot writes.

```mermaid
sequenceDiagram
    participant Gen as Regeneration
    participant Tmp as Temp file
    participant Disk as nectars.json
    participant DL as Deeplake

    Gen->>DL: scan hive_graph_versions (latest described per nectar)
    Gen->>Tmp: write projection to temp file
    Gen->>Disk: rename temp onto nectars.json
    Note over Disk: rename is the commit point - old or new, never partial
```

The rename is the commit point. Readers observe either the old file or the new file, never an intermediate or truncated state. A crash during the temp write leaves the previous projection intact on disk; the orphaned temp file is cleaned up on the next regeneration. This is the durability property that lets a clone trust the committed file even if a teammate's last regeneration was interrupted.

---

#### What the spec does not cover

The conceptual motivation for the projection-vs-sidecar distinction and the FR-8 angle is in `portable-registry-introduction-and-theory.md`. The engineering and operator user stories that exercise the projection are in `portable-registry-user-stories.md`. The end-to-end fresh-clone journey that consumes the projection is in `portable-registry-ecosystem-story-arc.md`. The four-rule hard contract (what the projection explicitly does not do) and the commit-vs-gitignore tradeoff are restated in `portable-registry-conclusion-and-deliverables.md`.

### Recall Integration — Technical Specification

The SQL contract for the Nectar recall arm: the fourth guarded arm, the latest-per-nectar subquery that collapses the version chain to one row per current file, the `describe_status = 'described'` filter, the tenancy scoping, the per-arm BM25+vector scoring, and the reciprocal-rank-fusion merge that produces a single ranked list.

#### Why this exists

Recall is a contract before it is a query. The agent, the harness, and the operator all depend on the Nectar arm returning a predictable shape: one row per *current described* file, scoped to the caller's tenancy, scored by both lexical and vector similarity, and fused into the same ranked list as the three pre-existing arms. This document is the authoritative statement of that contract — the SQL the arm contributes, the subquery that makes it return one row per file, the filter that keeps undescribed rows out, and the fusion that brings it all together. The conceptual motivation is in `recall-integration-introduction-and-theory.md`; the end-to-end trace is in `recall-integration-ecosystem-story-arc.md`.

---

#### The SQL-guard requirement

Every SQL literal in the recall arm is bound through the daemon's storage-layer helpers — `sqlStr`, `sqlLike`, and their siblings — never string-interpolated. This is the SQL safety floor stated in the sibling Honeycomb daemon's `AGENTS.md` and implemented in its `src/daemon/storage/sql.ts`. The SQL in this document is written with named parameters (`:org`, `:pattern`, `:k`) for readability; the implementation substitutes each parameter through the appropriate helper so that a tenancy value, a query pattern, or an identifier can never become an injection vector.

This document does not reproduce the helpers' internals (they live in the sibling repo). It states the requirement as a hard contract on the arm: any engineer adding or modifying the recall SELECT must route every dynamic value through the storage-layer SQL guards (`sqlStr`, `sqlLike`, and siblings). A recall query that concatenates user input into SQL is a defect by definition.

---

#### The Nectar recall arm (annotated)

The arm contributes a row per matching file to recall's fused arm set. The SELECT below is the lexical (BM25) arm, annotated clause by clause. The source-of-truth version is in `../recall-integration.md`; the column catalog it reads from is in `../hive-graph-schema.md`.

```sql
SELECT
  'nectar'              AS source,     -- tag the arm for fusion + agent display
  v.nectar                  AS id,         -- stable file identity (ULID)
  v.path                    AS path,       -- repo-relative path at this version
  v.title                   AS title,      -- LLM-minted, <=80 chars
  v.description             AS body,       -- fused into BM25; also shown to the agent
  v.concepts                AS concepts,   -- JSON array of concept tags
  v.content_hash            AS content_hash
FROM hive_graph_versions v
INNER JOIN (
  -- (1) latest-per-nectar subquery: collapse the version chain to one row per file
  SELECT nectar, MAX(seq) AS max_seq
  FROM hive_graph_versions
  WHERE describe_status = 'described'        -- (2) exclude pending/failed/skipped
    AND org_id       = :org                  -- (3) tenancy scoping, applied inside
    AND workspace_id = :workspace            --     the subquery so MAX(seq) is scoped
    AND project_id   = :project              --     to this project's described rows
  GROUP BY nectar
) latest ON v.nectar = latest.nectar AND v.seq = latest.max_seq
WHERE (                                     -- (4) lexical filter, BM25 over title+description
  v.title       ILIKE :pattern               --     :pattern is sqlLike-guarded
  OR v.description ILIKE :pattern
  OR v.concepts  ILIKE :concept_pattern
)
ORDER BY bm25_score DESC
LIMIT :k;                                    -- top-K, same K as every other arm
```

Four clauses do the load-bearing work, and each is worth understanding precisely.

##### (1) The latest-per-nectar subquery

`hive_graph_versions` is append-only: one row per observed state of a file, keyed by `(nectar, content_hash)` with a monotonic `seq` counter per nectar. Without collapsing, a file edited 50 times would contribute 50 near-duplicate rows to recall and dominate the ranked list. The subquery picks `MAX(seq)` per nectar, scoped to described rows in the caller's tenancy, and the outer query joins back on `(nectar, seq)` to surface exactly that row.

The `seq` column exists for this purpose. It lets "latest version" be `MAX(seq)` without parsing timestamps or relying on `content_hash` ordering, both of which would be fragile. "Current state of file X" is, by definition, the row where `seq` equals the maximum `seq` for X's nectar.

##### (2) The `describe_status = 'described'` filter

The filter sits *inside* the subquery, not on the outer query. This is deliberate: `MAX(seq)` must be computed over described rows only, otherwise a pending row with a higher `seq` (a fresh edit not yet enriched) would win `MAX(seq)` and then be filtered out, leaving the arm with no row for that nectar at all. Scoping the filter to the subquery guarantees that the latest *described* version is the one that surfaces.

Rows excluded by the filter are `pending` (enricher has not reached them), `failed` (enricher tried and the LLM call failed), `skipped-too-large`, and `skipped-binary`. An undescribed file does not appear in semantic recall. It may still appear in the structural CodeGraph's `find/` results, keyed by symbol name — the two layers are independent.

##### (3) Tenancy scoping

`org_id`, `workspace_id`, and `project_id` are applied inside the subquery, alongside the describe filter. Nectar's tenancy model is org → workspace → project, with no `agent_id` and no `visibility` column, because file identity is cross-agent by nature: every agent working in the same project sees the same file descriptions. The columns are denormalized onto `hive_graph_versions` from `hive_graph` precisely so the versions table is queryable in isolation for recall.

##### (4) The lexical filter

The BM25 arm scores over `title`, `description`, and `concepts`. `title` and `description` are the LLM-minted text; `concepts` is a JSON-encoded string array (`'["auth","session","jwt"]'`) whose ILIKE match lets a concept-tagged file surface even when the query term is a tag rather than prose. `:pattern` and `:concept_pattern` are `sqlLike`-bound.

---

#### The vector arm

The vector arm is structurally analogous to the lexical arm, substituting vector similarity for the BM25/ILIKE filter. The same latest-per-nectar subquery and the same tenancy scoping apply; the difference is the scoring predicate.

```sql
SELECT
  'nectar' AS source,
  v.nectar     AS id,
  v.path       AS path,
  v.title      AS title,
  v.description AS body,
  v.concepts   AS concepts,
  v.content_hash AS content_hash
FROM hive_graph_versions v
INNER JOIN (
  SELECT nectar, MAX(seq) AS max_seq
  FROM hive_graph_versions
  WHERE describe_status = 'described'
    AND org_id       = :org
    AND workspace_id = :workspace
    AND project_id   = :project
  GROUP BY nectar
) latest ON v.nectar = latest.nectar AND v.seq = latest.max_seq
WHERE v.embedding IS NOT NULL              -- gate: only rows the enricher embedded
ORDER BY v.embedding <#> :query_vector DESC     -- cosine similarity, 768-dim
LIMIT :k;
```

The `` operator between a `FLOAT4[]` column and a `FLOAT4[]` literal is cosine similarity over the 768-dim `embedding` column, sorted `DESC` (most similar first), per the pg_deeplake SQL reference and confirmed by the live ordering probe in `test/hive-graph-search-live.test.ts` on 2026-07-03. (An earlier revision of this document called it cosine distance ordered ascending; that was incorrect and was flagged as NEC-005.) The dimensionality matches `sessions.message_embedding` and `memory.summary_embedding` deliberately - the hybrid recall pipeline's vector index expects consistent dimensionality across semantic arms. The embedding is computed over `title + ' ' + description` by the configured embedding provider, documented in `../../ai/enricher-and-llm-model.md`.

##### Graceful BM25-only fallback

When embeddings are off — the local provider is not installed/warmed up, the hosted provider is unavailable, or embeddings are disabled — the `embedding` column is NULL and the vector path returns nothing. Recall silently falls back to BM25 over `title` and `description`. This is the same fallback every other recall arm uses; there is no error, no quality cliff, just lexical-only recall over descriptions until embeddings are available. The arm stays alive on its lexical scoring alone.

---

#### The fourth guarded arm

The Nectar arm is the fourth guarded arm beside the three arms that predate Nectar. Each arm returns its top-K rows with a score; successful arms are fused into one ranked list. If the Nectar table is absent, that arm contributes no rows and the other arms still answer.

```mermaid
flowchart TD
    q["agent query"] --> arms["guarded recall arms"]
    arms --> arm1["arm 1: sessions - message / message_embedding"]
    arms --> arm2["arm 2: memory - summary / summary_embedding"]
    arms --> arm3["arm 3: memories - body / body_embedding"]
    arms --> arm4["arm 4: hive_graph_versions - title+description / embedding"]
    arm1 --> rrf["RRF fusion"]
    arm2 --> rrf
    arm3 --> rrf
    arm4 --> rrf
    rrf --> ranked["single ranked list - discussions + facts + files"]
```

Each arm is independently scoped by tenancy before scoring. The sessions, memory, and memories arms carry `agent_id` and `visibility` in addition to the org/workspace/project triple; the Nectar arm carries only the triple, because file identity is cross-agent. The arm set does not reconcile these scoping differences — each arm applies the scoping its schema requires, and fusion combines whatever survives.

---

#### Per-arm BM25 + vector scoring

Every arm — not just Nectar's — runs both a BM25 lexical path and a 768-dim vector path. The two paths are not mutually exclusive: an arm contributes rows from whichever path matches, and a row that matches both lexical and vector is a stronger hit than one that matches only one. The per-arm scoring is what produces the rank order that RRF then fuses.

| Arm | BM25 over | Vector over |
|---|---|---|
| Sessions | `message` (JSONB) | `message_embedding` |
| Memory | `summary` | `summary_embedding` |
| Memories | `body` | `body_embedding` |
| Nectar | `title + description + concepts` | `embedding` |

The score distributions differ across arms — sessions JSONB is noisy, Nectar descriptions are clean and short — and this is exactly why fusion is rank-based rather than score-based. RRF consumes each arm's *rank*, not its raw score, so the arms contribute on equal footing regardless of distribution.

---

#### RRF fusion and the weighting strategy

Reciprocal rank fusion merges the per-arm ranked lists into one. Each row's fused score is the sum, over every arm that returned it, of `multiplier / (k + rank)`, where `k` is the RRF constant (shared across arms) and `multiplier` is a per-arm weight. A row that ranks first in an arm contributes `multiplier / (k + 1)`; a row that ranks tenth contributes `multiplier / (k + 10)`.

RRF is rank-based by design, and that is the property that makes the four-arm fusion tractable. A Nectar hit at rank 1 contributes the same fused weight as a sessions hit at rank 1, even though their raw BM25/vector scores are computed over different text and live on different scales. The fusion does not need the arms to agree on what a "score" means — it only needs each arm to produce a rank order.

##### The default multiplier

Nectar ships with a **multiplier of 1.0** (equal weighting) as the default. The theory is that a file-description hit is exactly as actionable as a session-trace hit: they answer different aspects of the same question, and neither is privileged. An operator who finds Nectar hits dominating recall at the expense of session memory — a possible failure mode if descriptions are written too keyword-stuffed — can lower the multiplier:

```json
{
  "recall": {
    "nectar_rrf_multiplier": 0.7
  }
}
```

Raising the multiplier is also supported but rarely useful: if Nectar is the dominant signal, the operator probably wants to investigate why session memory is thin, not amplify code descriptions to compensate.

##### Dedup at fusion, not at the arm

The Nectar arm does not deduplicate against CodeGraph `find/` hits. If `src/auth/login.ts` appears in both a Nectar recall hit and a CodeGraph structural hit, both are returned — the recall layer has no view into the CodeGraph's results. Dedup at the recall layer would lose the structural context the CodeGraph hit carries (symbol names, line numbers). Recognizing the two as the same file is the agent's (or the harness prompt assembler's) job.

Within the Nectar arm, dedup is handled by the latest-per-nectar subquery: one row per nectar, never one row per version. There is no cross-nectar dedup because two different nectars are two different files, even if their current content is identical (the copy-paste case, recorded via `derived_from_nectar`).

---

#### What the contract guarantees

The SQL contract guarantees four properties that the rest of the deep-dive depends on:

1. **One row per current described file.** The latest-per-nectar subquery with the describe filter inside it ensures exactly the most recent described version of each nectar participates.
2. **Tenancy isolation.** Org/workspace/project scoping is applied inside the subquery, so a cross-tenant nectar can never surface.
3. **Graceful degradation.** The vector arm gates on `embedding IS NOT NULL`; when embeddings are off, the lexical arm carries recall alone with no error.
4. **Composable fusion.** The arm produces a rank order consumable by the same RRF that fuses the other three, with a tunable per-arm multiplier defaulting to equal weighting.

The contract does *not* guarantee recency of description (a query mid-brood sees whatever has been described so far), completeness (undescribed files are absent from semantic recall though present in the structural graph), or cross-layer dedup (the agent reconciles Nectar and CodeGraph hits for the same file). These non-guarantees are deliberate and are traced end-to-end in `recall-integration-ecosystem-story-arc.md`.

### Identity Model — Technical Specification

The technical contract of Nectar's chosen identity model (Option C: daemon-minted ULID): the nectar format, the minting triggers, the primary-key contract, the no-source-mutation invariant, the universal-applicability rule, FR-8 compliance, and a decision-driver matrix showing how Option C satisfies each driver where A and B fail.

#### The decision, as a contract

ADR-0001 adopts **Option C**: a daemon-minted ULID nectar, persisted in Deeplake as the primary key of `hive_graph`, re-associated to files on disk by the exact-then-fuzzy ladder, with a committed regenerable projection for fresh-clone inheritance. This document specifies that decision as an engineering contract — the invariants an implementation must satisfy to be compliant. The ADR is the authoritative source for *why*; this doc is the authoritative reference for *what*.

The contract has seven clauses, each derived from a decision driver in the ADR. An implementation that violates any clause is non-compliant with the identity model, regardless of whether its re-association ladder works or its recall returns results.

---

#### Clause 1: The nectar format (ULID)

A nectar is a **ULID** (Universally Unique Lexicographically Sortable Identifier). The format is fixed:

- **Length:** 26 characters.
- **Alphabet:** Crockford base32, uppercase (`0123456789ABCDEFGHJKMNPQRSTVWXYZ` — no `I`, `L`, `O`, `U`).
- **Structure:** 48-bit Unix millisecond timestamp + 80 bits of cryptographically secure randomness.
- **Sortability:** lexicographic order equals creation-time order. String-prefix range scans answer "nectars minted since T" without timestamp parsing.
- **Case:** uppercase. A lowercased nectar is non-compliant.

```typescript
import { ulid } from "ulid";

function mintNectar(): string {
  return ulid(); // e.g. "01J2X4F6K8ME7N9P1Q3R5T7V9WX"
}
```

The format is chosen for two properties a plain UUIDv4 lacks. **Lexicographic sortability by creation time** matters for cold catch-up: the daemon can ask "what nectars were minted while I was offline" and get them in creation order via a string-prefix scan. **Collision resistance without a registry** — 80 bits of randomness per millisecond — makes minting lock-free and distributed-safe; two harnesses minting in parallel cannot collide, so no coordination round-trip is required.

The `created_at` column on `hive_graph` is set to the decoded ULID timestamp in ISO 8601, so the projection file and dashboards have a human-readable creation time without ULID parsing. The nectar itself is **never re-derived and never recomputed**: if the minting logic changes in a future release, old nectars keep their values and new nectars use the new logic. This is what makes identity stable across daemon upgrades.

The format is deliberately recorded as separate from the identity-model decision, because the format is reversible (a future migration could re-encode nectars) while the model is not. Changing from ULID to UUIDv7 is a migration script; changing from minted to source-embedded is a re-brood.

---

#### Clause 2: Minting triggers (brooding and copy event only)

A nectar is minted in **exactly two situations**. Minting in any other situation is non-compliant.

1. **Brooding** — the first time hiveantennae observes a file it has no record of. This covers the initial scan, and any genuinely new file the watcher detects during live operation (a new file with content that does not match any existing file's current content).
2. **Copy event** — the daemon detected that a new path's content hash matches an existing file's current content hash, and mints a *fresh* ULID for the new path with `derived_from_nectar` pointing at the source.

The copy-event rule is the one that distinguishes the minted model from both alternatives. Under Candidate A (source-embedded serial), a copy carries the same serial, producing ambiguity. Under Candidate B (content hash), the copy and the source are indistinguishable and the relationship is lost on the copy's first edit. Under Option C, the copy gets its own identity *and* a permanent provenance edge — the property neither alternative can provide.

Minting does **not** happen on edits (that appends a version row, keeping the nectar), on moves (that carries the nectar via the ladder), or on re-association of an existing nectar to a moved file (that is an association update, not a mint).

---

#### Clause 3: The `hive_graph.nectar` primary-key contract

The nectar is persisted as the **primary key of `hive_graph`** in Deeplake. The contract:

- `nectar` is TEXT, NOT NULL, and is the row identity. One row per logical file.
- `nectar` is **immutable**. It is written once at minting and never updated, never reused, and never re-derived.
- The `(nectar, content_hash)` pair on `hive_graph_versions` is the composite version key; `content_hash` changes per edit, `nectar` does not.

The full DDL is documented in `../../data/hive-graph-schema.md`. The `hive_graph` row carries identity and provenance only (`kind`, `created_at`, `derived_from_nectar`, `fork_content_hash`, tenancy columns). No content, no description. Content and description live in the append-only `hive_graph_versions` table. The split is the schema consequence of the identity-model decision: a single table cannot cleanly represent stable identity and changing content without either overwriting history or burying the identity key.

---

#### Clause 4: The no-source-mutation invariant

The hiveantennae daemon **never writes to source files**. This is a hard invariant, not a preference. The only file hiveantennae writes is `.honeycomb/nectars.json`, a regenerable projection at the project root — and even that is reviewable, committed, and regenerable from Deeplake alone.

The invariant protects the AGPL license header convention. `AGENTS.md` in the main Honeycomb corpus is explicit: every new source file gets the AGPL header from `docs/license-header.txt`, and that header occupies line 1. A tool that mutates source on a git hook — as Candidate A requires — collides with this rule and produces an invasive "brooding mega-commit" that touches every file on first run, which code reviewers reject.

The invariant also means the original Nectar sketch's proposal to "serialize them in an sqlite db (that would be fastest)" is rejected at the storage layer (see Clause 6), but the *source* layer is held to an even stricter rule: not even a comment is inserted.

---

#### Clause 5: Universal applicability

The daemon observes **every file on disk regardless of whether it has a comment syntax**. The identity layer is universal; the description layer is best-effort.

- **JSON, `.env`, YAML, TOML, lockfiles** all get nectars. Comment syntax is irrelevant because the nectar never lives in the file.
- **Binary files** get nectars with `describe_status = 'skipped-binary'`. The nectar is minted and the identity row is written; the enricher skips description because there is no meaningful text to describe. The file is still discoverable by path and by provenance; it is simply not semantically described.
- **Files without a known extension** get nectars and are described if the enricher can extract text.

This is the rule Candidate A cannot satisfy. Source-embedded serials require a comment syntax, and JSON has none, `.env` has none, binary files have no first line to claim. Either serials cover only some files — a half-indexed codebase, which the ADR calls a liability, not an asset — or they require a sidecar-per-file scheme, which is the sidecar model rejected separately (Option D).

---

#### Clause 6: Deeplake as the only durable store (FR-8)

The nectar table is a **Deeplake table**. There is no SQLite sidecar, no JSONL log, no parallel store. This satisfies FR-8 from the main Honeycomb PRD substrate: *"Durable state goes in Deeplake, not JSON/JSONL sidecars."*

A parallel SQLite store (Option D in the ADR) is rejected independently of the identity-key choice because it would drift from Deeplake, get out of sync with the daemon, and become a second source of truth that the daemon's consistency checks cannot see. A *cache* — the regenerable `(path → mtime → last_hash)` map the daemon keeps to avoid re-hashing on poll — is acceptable because it is not a source of truth and can be deleted without loss.

The committed `.honeycomb/nectars.json` projection is not a violation of FR-8 because it is a **projection, not a sidecar**. The distinction is enforcement: a projection is a denormalized, regenerable view written from the source of truth on a defined schedule, never edited directly, and deletable without loss. `nectar rebuild-projection` regenerates it from a Deeplake scan with no other inputs. The three enforcement rules are documented in `../../data/portable-registry.md`: Deeplake writes happen first, the projection is never hand-edited, and the projection is regenerable from Deeplake alone.

---

#### Clause 7: Fresh-clone portability

A new `git clone` **inherits identity without re-paying the brooding cost or requiring network access** to Deeplake. The mechanism is the committed `.honeycomb/nectars.json` projection, which carries a content-hash → nectar map. On boot, the daemon matches on-disk content hashes into the projection before falling back to the re-association ladder.

A current projection typically achieves **zero LLM calls and zero fuzzy matches** on a fresh clone: every file's content hash matches the projection, every nectar is inherited, every description is carried over. The projection is committed by default precisely because without it, a fresh clone must brood from scratch — minting new nectars with no connection to the originals, breaking the team-share story.

---

#### Decision-driver → option matrix

The seven clauses above are deductions from the ADR's decision drivers. The matrix below shows how Option C satisfies each driver where Candidates A and B fail. This is the compliance view of the contract: an implementation satisfies the model if and only if it preserves every "" in the Option C column.

| Decision driver | Option A (source serial) | Option B (content hash) | Option C (minted ULID) |
|---|---|---|---|
| **Stability across edits** |  churns only on mint, but brittle |  churns every save |  not derived from content |
| **Stability across moves/renames** | ~ travels in-file, but copy breaks it |  if content unchanged |  ladder carries nectar |
| **Copy-paste as provenance** |  duplicate-serial ambiguity |  indistinguishable, link lost on edit |  fresh nectar + `derived_from_nectar` |
| **No source mutation** |  collides with AGPL header, line-1 conflict |  never touches source |  never touches source |
| **Universal applicability** |  JSON/`.env`/binary have no comment |  hashes anything |  nectars anything; binary `skipped-binary` |
| **Deeplake only (FR-8)** |  in-file, but needs sidecar for non-source |  hashable anywhere |  Deeplake table, projection not sidecar |
| **Fresh-clone portability** |  serial in-file, zero bootstrap |  must re-hash everything |  committed projection carries map |

The same matrix as a flowchart, showing how rejecting A and B leaves only C:

```mermaid
flowchart TD
    driver["decision drivers"] --> a{"Option A: source serial"}
    driver --> b{"Option B: content hash"}
    driver --> c{"Option C: minted ULID"}
    a -->|fails stability, copy-paste, no-mutation, universal| rejectA["REJECTED"]
    b -->|fails stability-across-edits| rejectB["REJECTED"]
    c -->|satisfies all seven drivers| acceptC["ADOPTED - Option C"]
    rejectA --> contract["7-clause technical contract"]
    rejectB --> contract
    acceptC --> contract
    contract --> impl["compliant implementation"]
```

Option C is the only model that satisfies all seven drivers simultaneously. Option A fails four (copy-paste, no-mutation, universal, and indirectly fresh-clone via the sidecar escape hatch). Option B fails the primary driver (stability across edits) and fresh-clone portability. The matrix is the argument; the seven clauses are the contract that enforces it.

---

#### What the contract does not specify

The contract is deliberately silent on three things, each documented elsewhere:

- **The re-association algorithm.** The ladder (exact path/mtime/size → path+content-changed → exact hash to missing file → fuzzy TLSH → mint new) is the mechanism that *maintains* the association; it is documented in `../../ai/identity-and-reassociation.md`. The contract specifies only that the nectar is stable and re-associated; it does not prescribe the ladder's steps.
- **The projection format.** The `.honeycomb/nectars.json` structure (version, files map, derived map) is documented in `../../data/portable-registry.md`. The contract specifies only that a projection exists and is regenerable.
- **The versioning semantics.** What constitutes a "meaningful edit," watcher debounce windows, and edit coalescing are documented in the brooding and enricher pipeline docs. The contract specifies only that the nectar does not change when content changes.

The contract is the invariant layer. The algorithm, projection, and versioning docs are the implementation layer. An implementation is compliant if it preserves the invariants; the implementation details are free to vary within those bounds.

# Part 5: Queen, the Fleet Orchestrator

## Queen: Stories & User Guide

*The cloud fleet orchestrator for the Apiary, explained for operators and decision makers.*

### Foreword

The Apiary is clean on one machine: four daemons behind one portal, everything on loopback. The problem starts when the stack spreads across machines, teammates, and orchestrators that spin up throwaway workers. Which daemons are alive, on which boxes? Who can mint identity for a new device? How does an admin see fleet-wide ROI without remoting into a laptop? When a machine is stolen, what gets cut off and how fast? Queen answers those questions and nothing else. It never touches memory content. This is the plain-language account of what it does and why.

### Queen: Overview & Quickstart

#### What makes Queen different

Most fleet tools start by grabbing your credentials and end by becoming the thing you have to trust blindly. Queen's architecture is four deliberate decisions, each written down before a line ships:

- **Orchestrator-custodian model.** Per ADR-0002, your fleet's long-lived orchestrator holds custody of the Deeplake credential, not the cloud. Queen coordinates identity, presence, and encrypted blobs it cannot decrypt in the default mode. Workers stay disposable: they check in, heartbeat, get brokered or short-lived access, and vanish. You trust your orchestrator; Queen coordinates; Deeplake stores memory.
- **Trusted-device custody and headless enrollment.** Per ADR-0003, adding a second laptop never requires two machines open at once: approve in the cloud, and an existing custodian device finishes the cryptographic rewrap next time it's online. A browserless VPS enrolls with a short-lived token whose only power is "let me join." It cannot read memory and cannot decrypt anything.
- **A control plane with a hard boundary.** Per ADR-0004, coordination state lives in Postgres behind an edge API (Cloudflare Workers + Hyperdrive + DigitalOcean managed Postgres), and it is deliberately narrow: identity, devices, fleets, enrollment, presence, leases, encrypted blob metadata. No memory content, no prompts, no session text, no plaintext credentials. Presence never writes into the Deeplake memory dataset, and idle daemons never poll Deeplake for coordination work.
- **Recovery, revocation, and escrow as policy, not improv.** Per ADR-0005, the hard cases have written answers before they hit a support ticket. Revoking a device in Queen and rotating the Deeplake credential are two honest, separate steps. Lose every custodian and the answer is re-link, not a hidden backdoor. Cloud escrow can exist only as explicit, visible, reversible opt-in.

#### Features

- **Presence store and heartbeat protocol.** A cheap `last_seen` heartbeat on a fixed interval plus a richer status diff written only on change, with TTL reaping so dead ephemeral agents never pile up in the fleet view. *(spec, PRD-007a)*
- **Daemon presence reporters.** Each daemon reports liveness and status fail-soft: a presence error never blocks real work. *(spec, PRD-007b)*
- **Read-only fleet dashboard.** Every agent in your org rendered with derived health, healthy vs offline distinguished purely by heartbeat age, scoped so you only ever see your own fleet. *(spec, PRD-007c)*
- **Per-agent enrollment and identity.** Every agent, including ephemeral sub-agents, gets its own attributable, revocable identity. Warm hosts vouch for their children; cold hosts exchange a short-lived join token for a per-agent credential. No shared forever-key, ever. *(spec, PRD-008a)*
- **Mint and sign authority.** One primary daemon Ed25519-signs every command and brokers credentials; workers verify against a pinned public key. The dashboard can request a command but can never forge one. *(spec, PRD-008b)*
- **Signed command channel.** Idempotent polled commands, signed and acked, built to survive a flaky transport. If the authority goes down, workers degrade to autonomous, not to dead. *(spec, PRD-008c)*
- **Hosted ROI admin surface.** An authenticated, multi-tenant admin app with per-org, per-team, and per-user leaderboards, fenced by an explicit admin entitlement and fed by an aggregation read API that never silently blends allocated cost with measured cost. *(spec, PRD-009a/b/c)*
- **Per-user claim gating.** Per-user leaderboards stay inert until a verified backend identity claim exists. No self-asserted names, no fabricated rows, org and team reporting in the meantime. *(spec, PRD-009d)*
- **Privacy and retention.** Per-user spend is treated as PII: visibility controls on who sees whom, plus a GDPR-style erasure path against the append-only ledger. *(spec, PRD-009e)*

#### Install (one command)

Queen rides on the Apiary stack. One line brings up the local half: Honeycomb, Nectar, Doctor, and the Hive portal.

```bash
# macOS / Linux
curl -fsSL https://get.theapiary.sh | sh
```

```powershell
# Windows (PowerShell)
irm https://get.theapiary.sh/install.ps1 | iex
```

That gets you the local Apiary with the Hive portal at `127.0.0.1:3853`. Queen's cloud enrollment layers on top of that per the roadmap: the machines you install today are the fleet Queen observes and steers tomorrow. Source setup instructions land with the first implementation PRDs.

#### Using the dashboard

Queen's surfaces are hosted, by design. The local stack's dashboard stays where it lives, at the Hive portal on `127.0.0.1:3853`; Queen adds the cloud views that no single machine can render.

The **fleet dashboard** (PRD-007c) is the observe half: your org's whole roster, every agent with a derived health state, orchestrators and their sub-agents, per-daemon state across machines. An idle-but-healthy daemon and a crashed one look identical from the outside; the heartbeat protocol is what tells them apart, and this page is where you see it. Read-only on purpose: maximum visibility, minimum new attack surface.

The **hosted ROI admin surface** (PRD-009) is a separate authenticated app where an authorized admin sees ROI across orgs: per-org, per-team, and per-user dashboards and leaderboards over the shared spend ledger, with allocated-vs-measured cost surfaced on every line and per-user views gated behind verified identity. It reads the ledger; it never writes a spend row.

#### Using the CLI

Straight answer: the exact verbs get pinned when implementation starts. What the specs already pin is the flow. PRD-008 defines it end to end: a short-lived, single-use join token is created on a trusted device, redeemed on the new machine for its own per-agent credential, and is dead after use. ADR-0003 sketches the shape:

```bash
# On an already-enrolled trusted device: mint a short-lived join token.
devices enroll-token create --kind openclaw-orchestrator --name openclaw-prod-01 --ttl 10m

# On the headless box: redeem it. The token can join; it can never read memory.
enroll --token <token>
```

Behind those two commands sits the whole PRD-008 machinery: token validation with scope, expiry, and usage count; a locally generated keypair whose private half never leaves the machine; and an identity of `(org, host device-id, agent-instance-id)` that can be revoked one agent at a time. Warm hosts skip the token entirely: an enrolled daemon vouches for the sub-agents it spawns, no human in the loop.

#### Second machine, zero ceremony

This is the payoff moment the specs are built around. Once Queen ships, adding a machine to your fleet looks like this:

```text
# Mint a 10-minute token on your laptop. Run the enroll command on the new box.
# Then watch the fleet dashboard:

  laptop-01    healthy    honeycomb · nectar · doctor · hive
  build-vps    enrolling…

# One heartbeat interval later:

  laptop-01    healthy    honeycomb · nectar · doctor · hive
  build-vps    healthy    honeycomb · nectar · doctor · hive
```

No browser on the VPS, no credential pasted into a config file, no shared key that haunts you at offboarding time. The token joined the machine and expired; the machine earned its own identity; its daemons started reporting presence under it.

#### How it works

Two planes, never collapsed. Memory and skills ride the Deeplake data plane that already works today. Queen is the control plane beside it: presence in, signed commands out, and a hard Postgres boundary that stores coordination state and nothing your sessions ever said.

```mermaid
flowchart TB
    subgraph M1["Machine A (laptop)"]
        D1["honeycomb · nectar · doctor · hive"]
    end
    subgraph M2["Machine B (VPS)"]
        D2["honeycomb · nectar · doctor · hive"]
    end
    subgraph Q["Queen control plane (cloud)"]
        PS[("Presence store")]
        MINT["Mint / sign authority"]
        CMD["Signed command channel"]
        PG[("Postgres<br/>coordination state only,<br/>never memory content")]
    end
    ADMIN["Admin / new device"]
    DASH["Fleet dashboard"]
    ROI["Hosted ROI admin surface"]

    D1 -. "heartbeat + status diff" .-> PS
    D2 -. "heartbeat + status diff" .-> PS
    CMD -. "signed, idempotent poll" .-> D1
    CMD -. "signed, idempotent poll" .-> D2
    ADMIN -- "enroll: join token → per-agent identity" --> MINT
    PS --> PG
    MINT --> PG
    CMD --> PG
    DASH --> PS
    ROI --> PG
```

Daemons heartbeat into the presence store; liveness is derived from heartbeat age, never guessed. The mint authority is the single place identity and commands come from: it signs, workers verify against a pinned key, and a tampered or replayed row simply fails verification. Postgres holds devices, fleets, enrollments, presence, and encrypted blob metadata, with explicit tenant identity on every row, and by policy it never holds memory text, prompts, paths, or plaintext credentials. The dashboards read from the control plane; they never get to write commands directly.

#### Why a fleet needs a custodian

Here's the uncomfortable truth about multi-machine agent fleets: the trust question doesn't go away because you ignored it. Somebody holds the credential that unlocks your team's shared memory. If that somebody is "every VM image," you've turned a golden image into fleet-wide secret material. If it's "the cloud vendor, readable," you've handed your memory plane to someone else's incident response. The orchestrator-custodian model picks the honest third option: custody lives with a durable machine in *your* trust domain, the cloud coordinates around ciphertext it cannot open, and the product says so out loud, because "we cannot decrypt this" is both the security promise and the support constraint.

Identity minting is guarded for the same reason. A config file with a shared API key cannot attribute anything, cannot revoke one agent without breaking all of them, and turns any single leak into a fleet-wide compromise. A mint authority flips every one of those: each agent gets its own identity, each identity can be cut individually, and every mint is signed and logged. Concentrating that power in one place concentrates risk too, which is why the specs treat the signing key as the crown jewels and why the authority is required to *issue* commands but never to *run* workers. Kill it and the fleet keeps working; it just stops taking new orders.

And the sequencing is deliberate: observation before control. PRD-007 ships the read-only fleet view first, maximum visibility with minimum new attack surface. PRD-008 adds commanding only after that view exists and the pain of not having control is real. Commanding an autonomous agent is the most sensitive surface in the system; you don't bolt that on first and audit it later.

#### Other interfaces

The specced surfaces, exactly as the PRDs name them:

- **Fleet dashboard.** The read-only, org-scoped fleet roster with derived health (PRD-007c).
- **Control-plane API.** Org-scoped heartbeat and fleet-roster endpoints (PRD-007), plus the enrollment, vouch, and signed-command endpoints (PRD-008): tokens in, per-agent credentials out, commands polled and acked.
- **Hosted ROI admin surface.** The separate authenticated admin app (PRD-009a/c) over the **aggregation read API** (PRD-009b): org, team, user, project, and time rollups with cost basis carried through end to end.

All three are specified in this repo's PRDs and sequenced on the roadmap below.

 Status & Roadmap

Queen is in the **specification stage**. The program moved here from Honeycomb on 2026-07-03, when cloud fleet and team management got their own product, and it arrived with its architecture already decided: four ADRs (orchestrator custody, trusted devices and headless enrollment, the control-plane Postgres boundary, and recovery/revocation/escrow policy) and three fully specced PRDs sitting in the backlog. PRD-007 (fleet observation) ships first, deliberately read-only. PRD-008 (enrollment, identity, and the mint/sign authority) is the control half, sequenced second on purpose. PRD-009 (the hosted ROI admin surface) is the reporting layer, gated behind its data foundation and flagged as the highest-risk auth surface in the set. Implementation is next; watch the roadmap and vote on what ships first at [ideas.theapiary.sh](https://ideas.theapiary.sh).

#### Development

The program lives under `library/`:

- `library/requirements/backlog/` holds the Queen PRD program with their sub-PRDs. The inherited fleet specs were renumbered into Queen's native sequence on 2026-07-03 (007 fleet observation, 008 fleet control, 009 hosted ROI), and the build-out PRDs (001 local agent, 002 cloud control-plane, 003 auth, 004 licensing, 005 usage-stream observation, 006 ingestion, 010 infrastructure, 011 observability) sit alongside them. Start with each PRD's index file; the acceptance criteria are the contract.
- `library/knowledge/private/architecture/` holds the ADR set: the inherited ADR-0002 through ADR-0005 (custody, enrollment, control-plane boundary, recovery) and the Queen-native ADR-0006 through ADR-0010 (two-app topology, stack selection, cloud-binding and license enforcement, observation scope, cloud infrastructure) that supersede their framing.
- `library/knowledge/private/auth/` and `.../collaboration/` hold the enrollment state machine and the fleet-observation design doc, the narrative sources the PRDs cite.

Read the ADRs first, then the PRD indexes, and you know the whole system. Build tooling lands with the first implementation wave.

#### Credits

- **[Activeloop](https://activeloop.ai/)** brings **[Deeplake](https://deeplake.ai/)** (the versioned, multi-modal database for AI with native vector + columnar indexing and hybrid search) and **[Hivemind](https://github.com/activeloopai/hivemind)**, the open-source agent-memory project Honeycomb is built upon.
- **[Legion Code Inc](https://github.com/legioncodeinc)** brings the multi-tier memory system (Tier 1 / 2 / 3 keys, summaries, raw), code base atlas memory architecture, auto healing service, session priming, automatic skill development & propagation, the pollinating loop, the knowledge graph, cross device cross repository cross team skill sharing, and the daemon architecture that turns Deeplake into a shared brain your coding agents read and write on every turn.

#### License

Queen is licensed under the **GNU Affero General Public License v3.0 or later** (AGPL-3.0-or-later).

Use it commercially or privately, free of charge. In return: keep the copyright and license notices intact, and if you modify it, your changes ship under the same AGPL license with source available. The "Affero" part is the point: run a modified version as a network service

## Queen: Technical Manual & Specification

*The two-plane control model, local agent and cloud application architecture, control-plane schema, and trust boundaries.*

### Foreword

Queen is the control plane that sits beside the Deeplake memory data plane and carries what that plane was never meant to carry: liveness, identity, enrollment, signed commands, usage observation, and fleet reporting. This manual documents the two-application topology, the local agent and cloud application architectures, the control-plane schema, cloud binding and license enforcement, and the trust boundaries. It is written for engineers building or auditing the orchestrator.

### Queen System Overview

The entry point for anyone about to build or reason about Queen. Read this first. It maps the two-plane model, the two-application split, the four-role Apiary topology Queen joins, and where to go next for each domain.

#### What Queen is

Queen is the Apiary's cloud fleet orchestrator. It is the control plane that sits beside the Deeplake memory data plane and carries what the data plane was never meant to carry: liveness, status, identity, enrollment, signed commands, usage-stream observation, and fleet-wide reporting. Memory and skills stay on Deeplake, where they already work. Queen owns seeing and steering the fleet that writes to it.

The Apiary is clean on one machine: four daemons behind one portal, everything on loopback. The problem starts when the stack spreads across machines, teammates, and orchestrators that spin up throwaway workers. Nobody can answer the questions that matter anymore. Which daemons are alive right now, on which boxes? Who is allowed to mint identity for a new device, and who just did? How does an admin see fleet-wide ROI without remoting into someone's laptop? When a machine is stolen or an engineer walks out, what gets cut off, how fast, and what still needs rotating? Queen answers those questions and nothing else. It does not touch memory content.

#### The two-plane model

Every design decision in Queen falls out of one framing: two planes, never collapsed. The data plane is Deeplake, and it already ships. The control plane is Queen, and it is new. Do not merge them.

```mermaid
flowchart LR
    subgraph DataPlane["Data plane (Deeplake, already ships)"]
        DL[("Deeplake dataset\nmemory · sessions · skills")]
    end
    subgraph ControlPlane["Control plane (Queen, new)"]
        PS[("Presence store")]
        MINT["Mint / sign authority"]
        LEDGER[("Usage / ROI ledger")]
        PG[("Postgres\ncoordination state only,\nnever memory content")]
    end
    A1["Agent daemon (machine A)"] --- DL
    A2["Agent daemon (machine B)"] --- DL
    A1 -. "heartbeat + coarse usage facts" .-> PS
    A2 -. "heartbeat + coarse usage facts" .-> PS
    PS --> PG
    MINT --> PG
    LEDGER --> PG
    MINT -. "signed commands (polled)" .-> A1
    MINT -. "signed commands (polled)" .-> A2
```

The two planes carry different things and live on different substrates.

| Plane | Carries | Substrate | Owner |
|---|---|---|---|
| Data | Memory, sessions, the skill library | Deeplake dataset (BYOC) | Deeplake, unchanged |
| Control | Liveness, status, identity, enrollment, signed commands, usage facts, ROI | Postgres + Valkey behind a Go API | Queen |

The reason the split is load-bearing and not stylistic: presence is mutable, high-frequency, and ephemeral, which is the exact opposite profile of the append-only, version-bumping Deeplake memory dataset. Heartbeating a fleet of daemons into Deeplake is the write-amplification pattern that has wedged the daemon before. Presence, usage facts, and coordination state get a fit-for-purpose store. The Postgres boundary is hard: it holds coordination state and coarse usage facts and never holds memory content, prompts, session text, or plaintext credentials. That boundary comes from ADR-0004 and carries forward unchanged into Queen.

#### The two-application split

Queen is not one program. It is two applications with a binding relationship between them, decided in ADR-0006.

**The local Queen agent** is TypeScript/Node, CLI only, no local dashboard. It runs on every machine in the fleet. It binds ("pairs") to a Queen cloud deployment as a required boot step, reports presence and usage-stream facts, redeems enrollment tokens, holds per-agent identity, and polls the signed command channel. The package is `@legioncodeinc/queen`. It has no web UI on purpose, because any dashboard renders fleet, org, or ROI data, and that data is control-plane data that belongs behind the cloud application's auth and licensing, never on a loopback port on an enrolled machine. The local agent is useless on its own; it functions only when bound to a cloud deployment. See `local-agent-architecture.md`.

**The cloud Queen application** is Go on the backend and Svelte/SvelteKit on the frontend. It serves every Queen dashboard (the read-only fleet dashboard and the hosted ROI admin surface) and the control-plane API, from `queen.theapiary.sh` (the hosted common deployment) or a customer's licensed BYOC deployment. It owns the Postgres boundary, ingestion, authentication, and licensing. See `cloud-application-architecture.md`.

```mermaid
flowchart TB
    subgraph Local["Local machines (fleet)"]
        A1["Local Queen agent (CLI)\nTS / Node\nno dashboard"]
        A2["Local Queen agent (CLI)\nheadless VPS"]
    end
    subgraph Cloud["Cloud Queen application"]
        API["Control-plane API (Go)"]
        DASH["Fleet dashboard (SvelteKit)"]
        ROI["Hosted ROI admin surface (SvelteKit)"]
        BIND["Binding / registration + licensing"]
    end
    PG[("Postgres\ncoordination + usage ledger,\nnever memory content")]

    A1 -- "bind / pair (required boot step)" --> BIND
    A2 -- "bind / pair (required boot step)" --> BIND
    A1 -. "presence + usage facts" .-> API
    A2 -. "presence + usage facts" .-> API
    API -- "signed commands (polled)" --> A1
    API --> PG
    DASH --> API
    ROI --> PG
    BIND --> PG
```

The stack choices are fixed in ADR-0007. Go on the backend for a single static binary, a tiny dependency surface, and strong concurrency for ingestion fan-in. SvelteKit on the frontend for a small bundle and good SSR on read-mostly dashboards. TypeScript/Node on the local agent for consistency with the rest of the Apiary local stack. One dependency discipline governs all three: prefer the standard library and language built-ins, and make every third-party dependency earn its place.

#### The four-role Apiary topology Queen joins

Queen does not run alone on a machine. It joins the local Apiary stack, which is four daemons behind one portal. Understanding those four roles tells you what Queen observes and what it leaves alone.

| Role | What it is | Queen's relationship to it |
|---|---|---|
| Honeycomb | The agent-memory engine that reads and writes the Deeplake dataset on every turn | Queen observes its liveness and reports presence; Queen never reads its memory content |
| Nectar | The skill and asset propagation layer | Queen observes; skills stay on the data plane |
| Doctor | The local watchdog and telemetry source of truth | Queen's presence view is fed by, and complementary to, Doctor's local telemetry; Queen adds the cloud, cross-machine view Doctor cannot render alone |
| Hive | The local portal on `127.0.0.1:3853` that renders the single-machine view | Hive stays local; Queen adds the fleet views no single machine can render |

The division of labor is deliberate. The local Apiary stack renders one machine's view at the Hive portal. Queen adds the cloud views that span machines. An idle-but-healthy daemon and a crashed one look identical from the outside; the heartbeat protocol is what tells them apart, and the fleet dashboard is where you see the difference across the whole fleet.

#### What Queen does, end to end

The system has three motions, and they were sequenced on purpose: observe, then steer, then report.

1. **Observe.** Local agents heartbeat into the presence store and extract coarse usage facts from the CLI harness and model-gateway streams they can already see. Liveness is derived from heartbeat age, never guessed. This is the read-only half, maximum visibility with minimum new attack surface.
2. **Steer.** A single mint-and-sign authority Ed25519-signs every command; workers verify against a pinned public key before executing. The dashboard can request a command but can never forge one. Per-agent identity means one revocation cuts off one agent, not the fleet.
3. **Report.** The usage facts feed an ingestion pipeline that writes a usage/ROI ledger in Queen's own Postgres. The hosted ROI admin surface reads that ledger, gated behind an explicit admin entitlement and verified per-user identity, and never writes a spend row.

Observation before control is not an accident. The read-only fleet view ships first (PRD-007) because commanding an autonomous agent is the most sensitive surface in the system, and you do not bolt that on first and audit it later. Control (PRD-008) lands second, once the fleet view exists and the pain of not having control is real. The hosted ROI surface (PRD-009) is the reporting layer, gated behind its data foundation and flagged as the highest-risk auth surface in the set.

#### The hard invariants

These hold across every Queen component. If a design choice violates one, the design is wrong, not the invariant.

- **No memory content, ever.** The Postgres boundary holds coordination state and coarse usage facts. It never holds memory content, prompts, session text, file paths, repo names, or plaintext credentials. See `../security/trust-boundaries.md`.
- **The local agent does not function unbound.** Binding to a cloud deployment is a required boot step, fused with license enforcement. See `../licensing/cloud-binding-and-byoc.md`.
- **Observation is coarse-facts-only in v1.** CLI harness and model-gateway traffic only. No root CA, no TLS interception on enrolled machines. See `../operations/usage-stream-observation.md`.
- **Two planes, never collapsed.** Presence never writes into the Deeplake memory dataset, and idle daemons never poll Deeplake for coordination work.

#### Where to read next

| You want to understand | Read |
|---|---|
| The local CLI agent's internals and lifecycle | `local-agent-architecture.md` |
| The cloud Go + SvelteKit service topology and API | `cloud-application-architecture.md` |
| The Postgres control-plane schema, as SQL DDL | `../data/control-plane-schema.md` |
| How Cloudflare, DigitalOcean, and the tooling wire together | `../integrations/infrastructure-topology.md` |
| The trust model and what the cloud can and cannot see | `../security/trust-boundaries.md` |
| How the local agent observes usage without reading content | `../operations/usage-stream-observation.md` |
| The AGPL cloud-binding enforcement and BYOC path | `../licensing/cloud-binding-and-byoc.md` |
| The device and per-agent enrollment state machine | `../auth/device-and-fleet-enrollment-state-machine.md` |
| The fleet observation and on-demand skill design | `../collaboration/fleet-observation-and-on-demand-skills.md` |

### Local Queen Agent Architecture

The internals of the local TypeScript/Node CLI agent (`@legioncodeinc/queen`): its pairing and binding lifecycle, config, command surface, presence reporter, usage-stream observer, enrollment client, and signed-command poller. Read this to build or reason about the local half of Queen. For the cloud half it talks to, see the cloud application doc.

#### Why this exists and what it is not

The local agent is the reporter and command executor half of Queen. It runs on every machine in the fleet: laptops, workstations, headless build VPS boxes, and the throwaway VMs an orchestrator spins up. Its job is narrow and precise. Report presence. Extract coarse usage facts from CLI and gateway traffic. Redeem enrollment tokens for a per-agent identity. Poll a signed command channel and execute what verifies. That is the whole contract.

It is TypeScript/Node because the rest of the Apiary local stack (Honeycomb, Doctor, Hive) is TS/Node, and sharing that toolchain matters more on the local side than any backend language unification does (ADR-0007). It follows the Apiary slim-dependency mandate: Node built-ins first, and every third-party dependency justified in the PRD that pulls it in.

The single most important design fact about the local agent is what it is not. **It has no local dashboard and opens no human-facing HTTP listener.** This is a boundary, not a preference. Any dashboard renders fleet, org, or ROI data, and that is control-plane data. Serving it locally would put a licensed, auth-gated, BYOC-class surface on every enrolled machine, including throwaway VMs, and multiply both the attack surface and the license-enforcement burden. So the local agent is CLI only. If a human wants to look at the fleet, they open the cloud dashboard, not a port on a laptop. This is fixed in ADR-0006.

#### Boot lifecycle: bind, then function

The local agent does nothing useful until it is bound to a Queen cloud deployment. Binding is a required boot step, and the license check is fused into it (ADR-0008, detailed in `../licensing/cloud-binding-and-byoc.md`). The agent cannot run offline or unbound; that is by design.

```mermaid
stateDiagram-v2
    [*] --> unbound
    unbound --> binding: queen pair (bootstrap)
    binding --> bound: authority issues binding material
    binding --> failedClosed: invalid / unreachable beyond grace
    failedClosed --> unbound: operator fixes binding
    bound --> enrolled: agent holds per-agent identity
    enrolled --> reporting: presence + usage reporter running
    reporting --> reporting: heartbeat interval
    reporting --> polling: signed-command poll on interval
    polling --> reporting: command acked or none
```

The sequence at boot:

1. **Bind.** The agent presents its binding credential to the cloud deployment (hosted common at `queen.theapiary.sh` or a licensed BYOC deployment). The handshake validates the license and returns the runtime material the agent needs on every request path: tenant context, the control-plane session credential, and the command-channel verification key (the pinned Ed25519 public key from the mint authority). No binding material means no running agent, and the failure is loud and specific.
2. **Enroll.** The agent obtains its per-agent identity. On a warm host, an already-enrolled daemon vouches for it. On a cold host, it redeems a short-lived join token. See the enrollment client below.
3. **Report.** Once bound and enrolled, the presence reporter and usage-stream observer start. Heartbeats begin on a fixed interval; usage facts flow as CLI and gateway traffic is seen.
4. **Poll.** The signed-command poller runs on its own interval, pulling commands, verifying signatures, and acking.

#### Internal components

The agent is a set of focused units. None has side effects at import time; the CLI entry point wires them together.

```mermaid
flowchart TD
    CLI["CLI entry point\nqueen pair / status / enroll ..."]
    CFG["Config module\n~/.queen/config.json"]
    BIND["Binding client\nvalidate-and-bind, holds session material"]
    ENROLL["Enrollment client\ntoken redeem / vouch"]
    IDENT["Per-agent identity\nlocal keypair, private key never leaves"]
    PRES["Presence reporter\nheartbeat + status diff, fail-soft"]
    OBS["Usage-stream observer\nCLI + gateway, coarse facts only"]
    POLL["Signed-command poller\nverify + ack + idempotent apply"]

    CLI --> CFG
    CLI --> BIND
    BIND --> IDENT
    CLI --> ENROLL
    ENROLL --> IDENT
    IDENT --> PRES
    IDENT --> OBS
    IDENT --> POLL
    BIND --> PRES
    BIND --> OBS
    BIND --> POLL
```

##### Config

Config lives at `~/.queen/config.json` (override the home with an environment variable, following the Apiary local-stack convention). It holds the binding target (which cloud deployment to pair with), the persisted per-agent identity reference, presence and poll intervals, and nothing secret in plaintext that a machine credential store can hold instead. The private half of the per-agent keypair is generated locally and never written to a plaintext config file; it lives in the machine credential store where the platform provides one. Config is read at boot and is not a place secrets are stashed.

##### Binding client

The binding client is the spine of the agent. It runs the validate-and-bind handshake and holds the session material the handshake returns. It is deliberately not a `verifyLicense()` gate followed by a separate `bind()`. The license validation and the production of the working session are the same code path: the authority validates the license and issues the binding material, and the agent derives its working session from that material. There is no code path that produces a working session while skipping validation. This is the anti-strip design from ADR-0008; see `../licensing/cloud-binding-and-byoc.md` for the full treatment.

##### Enrollment client

The enrollment client turns "this process exists" into "this process has an attributable, revocable identity." It covers two paths, matching the enrollment state machine.

- **Cold host.** A fresh machine with nothing enrolled redeems a short-lived, single-use join token. The token's only power is "let me join." The agent generates a keypair locally, presents the token to the mint authority, and receives its own per-agent credential plus an identity of `(org, host device-id, agent-instance-id)`. The token is dead after use.
- **Warm host.** A machine that already runs an enrolled daemon does not need a token for its children. The enrolled daemon vouches for the sub-agents it spawns, minting a child identity locally and reporting it. The trust chain is authority to host daemon to sub-agent.

The anti-pattern the enrollment client exists to avoid is one shared API key pasted into every agent forever: it cannot attribute or revoke a single agent, and a leak from any one agent is fleet-wide. Every agent, including ephemeral sub-agents, gets its own identity. Full state coverage is in `../auth/device-and-fleet-enrollment-state-machine.md`.

##### Presence reporter

The presence reporter emits two distinct signals, because liveness and status content are different problems.

- **Heartbeat.** A cheap `last_seen` timestamp the agent bumps on a fixed interval regardless of whether anything changed. Liveness is derived downstream as `now - last_seen > threshold`. If a healthy idle agent wrote nothing and a crashed agent also wrote nothing, the dashboard could not tell them apart. The heartbeat is what makes them distinguishable.
- **Status diff.** The richer record (current task, agent version, embeddings health, error state) written only on change. This is the "if nothing changes, nothing writes" idea applied to content, not to liveness.

The reporter is **fail-soft**: a presence error never blocks real work. If the control plane is unreachable, the agent keeps doing its actual job and keeps trying to report. Presence is a report, not a gate.

Reporting targets the control-plane API, which enqueues events at the ingestion edge. Presence writes never land in the Deeplake memory dataset; that separation is the whole point of the two-plane model. See `../integrations/infrastructure-topology.md` for where the events go.

##### Usage-stream observer (CLI and gateway only)

The usage-stream observer is what makes fleet ROI measured rather than guessed. It observes CLI harness and model-gateway traffic that already flows through a layer the user opted into (the rflectr-derived proxy/adapter layer that sees Claude Code CLI, Codex CLI, and Cursor CLI traffic without touching the operating system trust store). From those streams it extracts only coarse, non-content usage facts: model identifier, token counts, timestamps, agent identity, harness, and cost basis.

It observes **CLI harnesses and the model gateway only**. Desktop TLS interception (Claude Desktop, ChatGPT Desktop, Cursor Desktop) is explicitly out of scope for v1, because that path requires installing a root CA and a first-party TLS interceptor on every enrolled machine, which is the highest trust cost in the system and contradicts Queen's honest-custodian promise. The full reasoning and the deferred-capability seam are in `../operations/usage-stream-observation.md` and ADR-0009. No prompts, no completions, no session text crosses the boundary.

##### Signed-command poller

The poller is the command-executor half of the agent. It pulls commands from the control plane on an interval (poll, not push), and for each one it verifies the Ed25519 signature against the pinned public key from the mint authority before executing. A command that is unsigned, tampered, replayed, or of an unknown type simply fails verification and is not run. Applied commands are idempotent and acked, so a flaky transport that duplicates a row does not cause double execution.

The poller degrades to autonomous, not to dead. If the mint authority is down, the agent cannot receive new commands, but it keeps doing local work and keeps heartbeating. The authority is required to issue commands, never to run workers. Kill it and the fleet keeps working; it just stops taking new orders.

#### Command surface

The exact verbs are pinned when implementation starts (PRD-001). The shape the specs already fix:

| Command | Purpose |
|---|---|
| `queen pair` | Bind this machine to a cloud deployment. Required before anything else works. |
| `queen status` | Print this machine's binding, identity, and presence state to the terminal. This is the local view, and it is a CLI, not a web page, on purpose. |
| `queen enroll --token ` | Redeem a short-lived join token on a cold host for a per-agent credential. |
| `queen enroll-token create` | On an already-enrolled trusted device, mint a short-lived join token for another machine. |

The `queen status` output is the deliberate substitute for a local dashboard. Because there is no local web UI by design, the CLI's output has to be good: it must clearly answer whether the machine is bound, enrolled, reporting, and reachable.

#### Why no dashboard, restated

It is worth stating the constraint plainly because it drives everything above. A developer who wants a quick local view of just this machine gets a CLI, not a web page. That is intentional. The fleet view is not a local view: a dashboard that shows other machines cannot be served from one machine's loopback without that machine becoming a de facto control plane and a cross-machine data sink. Put the dashboards where the auth, tenancy, and licensing boundary already is, which is the cloud application. The local agent stays disposable, headless, and cheap, which is exactly what ephemeral workers and headless VPS boxes need.

#### Invariants for the local agent

- Ships no web dashboard and opens no human-facing HTTP listener.
- Performs a binding handshake as a required boot step and does not function unbound.
- Generates its per-agent keypair locally; the private key never leaves the machine.
- Presence reporting is fail-soft: a presence error never blocks real work.
- The usage-stream observer captures coarse facts only, from CLI and gateway traffic, never desktop TLS, in v1.
- The signed-command poller verifies every command against the pinned key and applies idempotently; it degrades to autonomous when the authority is down.

### Cloud Queen Application Architecture

The internals of the cloud Queen application: the Go backend and SvelteKit frontend, the service topology on the droplet pairs behind the Cloudflare Load Balancer, the control-plane API surface, how the dashboards are served, and how ingestion feeds it. Read this to build or reason about the cloud half of Queen. For the local half that binds to it, see the local agent doc.

#### Why this exists and what it owns

The cloud Queen application is where everything a single machine cannot honestly render lives. It serves every Queen dashboard, runs the control-plane API, terminates authentication and licensing, and owns the Postgres boundary. It is the thing the local agent binds to, and it is the thing an admin points a browser at. It runs at `queen.theapiary.sh` as the hosted common deployment, or as a customer's licensed BYOC deployment, and the two are the same application with a different license identity (ADR-0006, `../licensing/cloud-binding-and-byoc.md`).

The backend is Go and the frontend is Svelte/SvelteKit (ADR-0007). Go earns the backend because the real workload is concurrent ingestion fan-in and a control-plane API, and Go gives a single static binary with a tiny dependency surface, strong concurrency, and a cheap, boring deployment on droplets. SvelteKit earns the frontend because the dashboards are read-mostly, and SvelteKit ships a small bundle with good SSR for read-and-render pages. Cloudflare Workers appear in Queen only at the ingestion edge; they are never the control-plane API (ADR-0010).

#### Service topology

The cloud application runs across two droplet tiers on DigitalOcean, both fronted by a Cloudflare Load Balancer, with the ingestion edge on Cloudflare and the stores on DigitalOcean managed services.

```mermaid
flowchart TB
    subgraph Clients["Clients"]
        AGENT["Local Queen agents\n(bind, report, poll)"]
        ADMIN["Human admins\n(browser)"]
    end

    subgraph CFedge["Cloudflare (edge)"]
        LB["Load Balancer"]
        W["Edge Workers\nvalidate + enqueue"]
        Q["Queues\nbuffer"]
        HD["Hyperdrive\nPostgres pooling"]
        R2[("R2 object storage")]
    end

    subgraph AppTier["2x app droplets (Go + SvelteKit)"]
        API["Control-plane API (Go)\nbinding · presence · enrollment ·\ncommands · aggregation read"]
        SSR["SvelteKit SSR\nfleet dashboard · ROI admin surface"]
    end

    subgraph IngTier["2x ingestion-sidecar droplets (Go)"]
        CONS["Go pull consumer\nvalidate · tenancy · shape · batch upsert"]
    end

    subgraph Stores["DigitalOcean managed (core)"]
        PG[("Postgres\ncontrol plane + usage / ROI ledger,\nnever memory content")]
        VK[("Valkey\npresence · dedup · rate-limit")]
    end

    ADMIN --> LB --> SSR
    SSR --> API
    AGENT --> LB --> API
    AGENT -- "usage + presence events" --> W --> Q
    Q -- "HTTP pull" --> CONS
    CONS --> VK
    CONS --> HD --> PG
    API --> HD --> PG
    API --> VK
    API --> R2
```

The reason there are two separate droplet tiers is a workload split. The app tier serves synchronous request/response traffic: the control-plane API and the SSR dashboards. The ingestion tier does asynchronous, spiky, high-frequency work: pulling usage and presence events off the queue, validating and shaping them, and batch-upserting to Postgres. Keeping them separate means a burst of fleet usage events cannot starve the interactive API, and each tier scales on its own signal. Both tiers are the same Go codebase deployed in different modes, so validation, tenancy, and shaping logic is written once and tested locally without a Worker runtime. The full infrastructure wiring, including why the sidecar tier exists rather than Workers writing Postgres directly, is in `../integrations/infrastructure-topology.md`.

#### The Go backend

The backend is a single static Go binary that runs in one of two modes.

**API mode (app tier).** Serves the control-plane API and backs the SvelteKit SSR pages. It reaches Postgres through Hyperdrive for durable reads and writes, Valkey for hot presence and rate-limit reads, and R2 for exports and large payloads. It terminates the binding handshake and licensing (the validate-and-bind path from ADR-0008), the WorkOS-backed human authentication, and the org/workspace/team tenancy checks on every request.

**Consumer mode (ingestion tier).** Runs the pull consumer that drains the Cloudflare Queue. For each batch it applies validation, tenancy enforcement, and data shaping, dedupes against Valkey idempotency keys, and batch-upserts presence snapshots and usage/ROI ledger rows into Postgres via Hyperdrive. This is where the ingestion business logic lives, in Go, not scattered into Worker JS.

The slim-dependency mandate applies to the backend: prefer the Go standard library and justify every third-party import in the PRD that introduces it.

#### The SvelteKit frontend

The frontend is server-side rendered for a read-mostly experience. It serves two distinct surfaces, and they are kept separate on purpose.

**The fleet dashboard** (PRD-007c) is the observe half: the viewer's whole org roster, every agent rendered with a derived health state, orchestrators and their sub-agents, per-daemon state across machines. Health is derived from heartbeat age, not guessed: an idle-but-healthy daemon and a crashed one are distinguished purely by `last_seen`. It is read-only by design, for maximum visibility with minimum new attack surface. It reads through the control-plane API, which enforces the org boundary so a viewer sees only their own fleet.

**The hosted ROI admin surface** (PRD-009) is a separate authenticated app where an authorized admin sees ROI across orgs: per-org, per-team, and per-user dashboards and leaderboards over the usage/ROI ledger, with allocated-versus-measured cost surfaced on every line. It is fenced behind an explicit admin entitlement, and per-user views stay inert until a verified backend identity claim exists (no self-asserted names, no fabricated rows). It reads the ledger through the aggregation read API and never writes a spend row.

The two surfaces are separate because their risk profiles differ. The fleet dashboard is org-scoped, read-only, and low-risk. The ROI surface reads a cross-org ledger behind an admin entitlement and is the highest-risk auth surface in the set, which is why it is a distinct app with its own gating rather than a tab on the fleet dashboard.

#### The control-plane API surface

The API is org-scoped on every route. Tenancy is enforced by the same boundary throughout: a request is authorized against its org, and it can only touch rows in its own org. The surface groups into four areas, matching the PRD program.

| Area | Representative endpoints | Owner PRD |
|---|---|---|
| Binding and licensing | present binding credential, license heartbeat | PRD-004 |
| Presence and fleet roster | `POST` heartbeat (upsert `last_seen` + optional status diff), `GET` fleet roster with derived health | PRD-007 |
| Enrollment and identity | mint join token, redeem token for per-agent credential, warm-host vouch | PRD-008 |
| Signed commands | request/mint a signed command, poll the command channel, ack | PRD-008 |
| Aggregation read (ROI) | org/team/user/project/time rollups with cost basis carried through | PRD-009 |

Two rules hold across the whole surface. The dashboard reads; it never writes commands directly. It asks the mint authority to mint a command, and the authority signs it. So a stolen dashboard session can request but never forge. And the aggregation read API never blends allocated cost with measured cost silently: every rollup carries its cost basis through so a reader always knows whether a number is measured or allocated.

#### How ingestion feeds the application

The presence and usage facts the local agents report do not hit the API synchronously. They go through the ingestion path so a spike of fleet events cannot overwhelm the interactive tier.

The edge Worker validates the event shape and enqueues it to a Cloudflare Queue fast, absorbing the spike. The Go pull consumer on the ingestion droplets drains the queue at its own pace, applies validation, tenancy, and shaping, dedupes against Valkey, and batch-upserts to Postgres. Presence snapshots land in the presence tables (hot state also in Valkey with TTL-based liveness and reaping), and usage events land as rows in Queen's own usage/ROI ledger. The dashboards then read the results: the fleet dashboard reads presence, the ROI surface reads the ledger. The queue is the shock absorber between a bursty fleet and a steady core. Full topology and rationale in `../integrations/infrastructure-topology.md`; the tables it writes are in `../data/control-plane-schema.md`.

#### The Postgres boundary the cloud application owns

The cloud application is the sole owner of the Postgres boundary, and that boundary is hard. Postgres is the system of record for identity, orgs/workspaces/teams, devices, fleets, enrollments, per-agent identities, presence snapshots, leases, encrypted-blob metadata, signed-command records, and the usage/ROI ledger. Every tenant-scoped table carries explicit tenant columns. Postgres never holds memory content, prompts, session text, file paths, repo names, or plaintext credentials. This is the ADR-0004 boundary, preserved by ADR-0010, and it is enforced by the application, not by hope. The complete schema is in `../data/control-plane-schema.md`.

#### Invariants for the cloud application

- Serves every Queen dashboard; no dashboard is served from an enrolled machine's loopback.
- The backend is a single static Go binary run in API mode or consumer mode; the same codebase, different mode.
- Edge Workers only validate and enqueue; they are never the control-plane API.
- All ingestion validation, tenancy, and shaping lives in the Go consumer, not in Worker JS.
- Every API route is org-scoped; tenancy is enforced on every request.
- The dashboard reads and requests; it never writes a command or a spend row directly.
- Postgres holds coordination state and coarse usage facts only, never memory content.

### Control-Plane Schema Reference

The canonical SQL DDL for Queen's Postgres control plane. This is the system of record for identity, tenancy, devices, fleets, enrollment, per-agent identity, presence, leases, encrypted-blob metadata, signed commands, and the usage/ROI ledger. Read this to build the schema or to reason about what the control plane can and cannot hold. The hard boundary: no memory content, no prompts, no session text, no plaintext credentials, ever.

#### The boundary, stated once and enforced everywhere

Postgres is the system of record for Queen's control plane. It holds coordination state and coarse usage facts. It does not hold memory content, prompts, completions, session text, tool-call payloads, file paths, repo names, or plaintext credentials. Where the control plane must reference an encrypted credential, it stores ciphertext and wrapped-key metadata, never plaintext. This boundary comes from ADR-0004 and is preserved unchanged by ADR-0010. It is enforced by the application and by schema shape: there is no column in this schema that could hold session text.

Every tenant-scoped table carries explicit tenant columns (`org_id`, and `workspace_id` where the row is workspace-scoped). Tenancy is never implicit. A row's org is on the row, and every query filters on it.

The DDL below is the reference shape. It is Postgres, and it is complete for the entities the control plane owns. Hot, high-frequency, ephemeral state (presence liveness counters, dedup keys, rate-limit counters) lives in Valkey, not here; this file covers the durable system of record. Presence snapshots are persisted here for the fleet roster; the live liveness counter is a Valkey concern (`../integrations/infrastructure-topology.md`).

#### Entity map

```mermaid
erDiagram
    ORGANIZATION ||--o{ WORKSPACE : contains
    ORGANIZATION ||--o{ TEAM : contains
    ORGANIZATION ||--o{ USER_IDENTITY : contains
    ORGANIZATION ||--o{ DEVICE : contains
    ORGANIZATION ||--o{ FLEET : contains
    FLEET ||--o{ DEVICE : groups
    DEVICE ||--o{ AGENT_IDENTITY : hosts
    ORGANIZATION ||--o{ ENROLLMENT_TOKEN : issues
    ENROLLMENT_TOKEN ||--o{ AGENT_IDENTITY : bootstraps
    AGENT_IDENTITY ||--o{ PRESENCE_SNAPSHOT : reports
    AGENT_IDENTITY ||--o{ LEASE : holds
    DEVICE ||--o{ ENCRYPTED_BLOB_META : wraps
    ORGANIZATION ||--o{ SIGNED_COMMAND : mints
    AGENT_IDENTITY ||--o{ SIGNED_COMMAND : targets
    ORGANIZATION ||--o{ USAGE_LEDGER : accrues
    TEAM ||--o{ USAGE_LEDGER : attributes
    USER_IDENTITY ||--o{ USAGE_LEDGER : attributes
```

#### Identity, orgs, workspaces, teams

The tenancy backbone. `organization` is the top-level tenant. `workspace` and `team` partition an org. `user_identity` is a human, backed by WorkOS, and carries the verified backend identity claim the per-user ROI views gate on.

```sql
CREATE TABLE organization (
    org_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            TEXT NOT NULL UNIQUE,
    display_name    TEXT NOT NULL,
    workos_org_id   TEXT UNIQUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE workspace (
    workspace_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organization(org_id) ON DELETE CASCADE,
    slug            TEXT NOT NULL,
    display_name    TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, slug)
);

CREATE TABLE team (
    team_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organization(org_id) ON DELETE CASCADE,
    workspace_id    UUID REFERENCES workspace(workspace_id) ON DELETE SET NULL,
    slug            TEXT NOT NULL,
    display_name    TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, slug)
);

CREATE TABLE user_identity (
    user_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              UUID NOT NULL REFERENCES organization(org_id) ON DELETE CASCADE,
    workos_user_id      TEXT UNIQUE,
    email               TEXT NOT NULL,
    display_name        TEXT,
    -- The verified backend identity claim. Per-user ROI views stay inert until this is TRUE.
    identity_verified   BOOLEAN NOT NULL DEFAULT FALSE,
    is_org_admin        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, email)
);

CREATE TABLE team_member (
    team_id     UUID NOT NULL REFERENCES team(team_id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES user_identity(user_id) ON DELETE CASCADE,
    org_id      UUID NOT NULL REFERENCES organization(org_id) ON DELETE CASCADE,
    role        TEXT NOT NULL DEFAULT 'member',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (team_id, user_id)
);
```

The `is_org_admin` flag and a separate ROI admin entitlement (below) are what fence the cross-org ROI read. Admin identity is not self-asserted; it is a stored entitlement.

#### Devices and fleets

A `device` is a machine known to the control plane by its locally generated public key. A `fleet` groups devices under an orchestrator. The control plane stores the device public key, never the private key.

```sql
CREATE TABLE device (
    device_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organization(org_id) ON DELETE CASCADE,
    workspace_id    UUID REFERENCES workspace(workspace_id) ON DELETE SET NULL,
    fleet_id        UUID,   -- FK added after fleet table; nullable, a device may be unfleeted
    device_kind     TEXT NOT NULL,  -- 'trusted_device' | 'fleet_custodian' | 'ephemeral_worker' | 'non_custodian_server'
    public_key      BYTEA NOT NULL, -- device public key; private key never leaves the machine
    trust_state     TEXT NOT NULL DEFAULT 'cloud_registered',
    custodian_state TEXT,           -- 'custodian' | 'fleet_custodian' | NULL
    last_seen_at    TIMESTAMPTZ,
    revoked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE fleet (
    fleet_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              UUID NOT NULL REFERENCES organization(org_id) ON DELETE CASCADE,
    workspace_id        UUID REFERENCES workspace(workspace_id) ON DELETE SET NULL,
    display_name        TEXT NOT NULL,
    custodian_device_id UUID REFERENCES device(device_id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE device
    ADD CONSTRAINT device_fleet_fk
    FOREIGN KEY (fleet_id) REFERENCES fleet(fleet_id) ON DELETE SET NULL;
```

`trust_state` and `custodian_state` mirror the enrollment state machine (see `../auth/device-and-fleet-enrollment-state-machine.md`). Revocation sets `revoked_at`; it is a control-plane action distinct from rotating the underlying Deeplake credential, which is a data-plane action.

#### Enrollment tokens

A short-lived, scoped, usage-counted join token. Its only power is "let me join." It bootstraps a per-agent identity on a cold host and is dead after use or expiry.

```sql
CREATE TABLE enrollment_token (
    token_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organization(org_id) ON DELETE CASCADE,
    workspace_id    UUID REFERENCES workspace(workspace_id) ON DELETE SET NULL,
    fleet_id        UUID REFERENCES fleet(fleet_id) ON DELETE SET NULL,
    token_kind      TEXT NOT NULL,  -- e.g. 'openclaw-orchestrator', 'headless-server'
    token_hash      BYTEA NOT NULL, -- hash of the token secret; the secret itself is never stored
    scope           TEXT NOT NULL,  -- what the token may join as; deliberately minimal
    max_uses        INTEGER NOT NULL DEFAULT 1,
    consumed_count  INTEGER NOT NULL DEFAULT 0,
    issued_by       UUID REFERENCES device(device_id) ON DELETE SET NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

The token secret is never stored; only its hash is. The token registers a machine; it does not grant memory access and cannot decrypt anything.

#### Per-agent identity

Every agent, including ephemeral sub-agents, gets its own attributable, revocable identity of `(org, host device-id, agent-instance-id)`. This is the row that lets one revocation cut off one agent instead of the whole fleet.

```sql
CREATE TABLE agent_identity (
    agent_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organization(org_id) ON DELETE CASCADE,
    workspace_id    UUID REFERENCES workspace(workspace_id) ON DELETE SET NULL,
    device_id       UUID NOT NULL REFERENCES device(device_id) ON DELETE CASCADE,
    parent_agent_id UUID REFERENCES agent_identity(agent_id) ON DELETE SET NULL, -- warm-host vouch chain
    agent_instance  TEXT NOT NULL,  -- the agent-instance-id
    harness         TEXT NOT NULL,  -- 'claude-code' | 'codex' | 'cursor' | 'openclaw' | 'hermes' | 'pi'
    public_key      BYTEA NOT NULL, -- per-agent public key; private key never leaves the machine
    enrolled_via    UUID REFERENCES enrollment_token(token_id) ON DELETE SET NULL, -- NULL for warm-host vouch
    revoked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, device_id, agent_instance)
);
```

`parent_agent_id` records the warm-host vouch chain: an enrolled daemon that vouches for a sub-agent it spawned. `enrolled_via` is set for cold-host token enrollment and null for warm-host vouch.

#### Presence snapshots

The durable presence record backing the fleet roster. Liveness is derived from `last_seen_at` age, never stored as a boolean. High-frequency liveness counters and TTL reaping run in Valkey; this table is the persisted snapshot the dashboard reads.

```sql
CREATE TABLE presence_snapshot (
    org_id          UUID NOT NULL REFERENCES organization(org_id) ON DELETE CASCADE,
    agent_id        UUID NOT NULL REFERENCES agent_identity(agent_id) ON DELETE CASCADE,
    device_id       UUID NOT NULL REFERENCES device(device_id) ON DELETE CASCADE,
    last_seen_at    TIMESTAMPTZ NOT NULL,
    ttl_seconds     INTEGER NOT NULL DEFAULT 300,
    -- status diff, written only on change; coarse operational facts, never session content
    current_task    TEXT,           -- a coarse label, not session text
    agent_version   TEXT,
    embeddings_state TEXT,          -- 'ready' | 'degraded' | 'off'
    error_state     TEXT,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (org_id, agent_id)
);

CREATE INDEX presence_snapshot_org_last_seen
    ON presence_snapshot (org_id, last_seen_at DESC);
```

`current_task` is a coarse label (for example "indexing" or "idle"), not session content. If a value could reconstruct what was said or done, it does not belong here.

#### Leases

A lease is a claim an agent holds on a unit of work. Stale heartbeats release leases so work can be redispatched without duplicate execution.

```sql
CREATE TABLE lease (
    lease_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organization(org_id) ON DELETE CASCADE,
    agent_id        UUID NOT NULL REFERENCES agent_identity(agent_id) ON DELETE CASCADE,
    resource_key    TEXT NOT NULL,  -- what is leased; opaque coordination key, not content
    acquired_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL,
    released_at     TIMESTAMPTZ,
    UNIQUE (org_id, resource_key)
);
```

#### Encrypted-blob metadata

Where the control plane must reference a credential blob (for example a Deeplake credential wrapped for custodian devices), it stores ciphertext and wrapped-key metadata only. This is the custody model from ADR-0002/0003/0005: the cloud coordinates around ciphertext it cannot open in the default mode.

```sql
CREATE TABLE encrypted_blob_meta (
    blob_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organization(org_id) ON DELETE CASCADE,
    provider        TEXT NOT NULL,  -- e.g. 'deeplake'
    ciphertext      BYTEA NOT NULL, -- encrypted credential blob; the cloud cannot decrypt in default mode
    active_from     TIMESTAMPTZ NOT NULL DEFAULT now(),
    superseded_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE wrapped_credential_key (
    org_id          UUID NOT NULL REFERENCES organization(org_id) ON DELETE CASCADE,
    blob_id         UUID NOT NULL REFERENCES encrypted_blob_meta(blob_id) ON DELETE CASCADE,
    recipient_id    UUID NOT NULL, -- a device_id or agent_id that may unwrap
    recipient_kind  TEXT NOT NULL, -- 'device' | 'agent'
    wrapped_key     BYTEA NOT NULL, -- data key wrapped to the recipient; cloud holds ciphertext only
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at      TIMESTAMPTZ,
    PRIMARY KEY (org_id, blob_id, recipient_id)
);
```

The plaintext credential never touches this schema. Postgres stores ciphertext and wrapped-key metadata; unwrap happens on a custodian device, through recovery material, or through explicit escrow, never in the cloud by default.

#### Signed-command records

The command channel is a durable, dumb pipe. A command carries an Ed25519 signature; a worker runs it only if the signature verifies against the pinned public key, the command is idempotent, and it has not been applied yet. The table records the mint (who requested, what payload) for audit and the ack.

```sql
CREATE TABLE signed_command (
    command_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organization(org_id) ON DELETE CASCADE,
    target_agent_id UUID NOT NULL REFERENCES agent_identity(agent_id) ON DELETE CASCADE,
    command_type    TEXT NOT NULL,  -- e.g. 'pause', 'force-skill-pull'; workers refuse unknown types
    payload         JSONB NOT NULL DEFAULT '{}', -- command parameters, never session content
    signature       BYTEA NOT NULL, -- Ed25519 signature over the canonical command bytes
    requested_by    UUID REFERENCES user_identity(user_id) ON DELETE SET NULL, -- audit: who asked
    minted_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    delivered_at    TIMESTAMPTZ,
    acked_at        TIMESTAMPTZ,
    idempotency_key TEXT NOT NULL,
    UNIQUE (org_id, idempotency_key)
);

CREATE INDEX signed_command_target_undelivered
    ON signed_command (org_id, target_agent_id)
    WHERE acked_at IS NULL;
```

The dashboard writes a mint request; the mint authority signs. A stolen dashboard session can request but never forge, because the signature is produced in exactly one place and workers verify against the pinned key. The `payload` is command parameters, never session content.

#### The usage / ROI ledger (Queen owns this)

Queen owns the usage/ROI ledger going forward (ADR-0010). It is fed by the usage-stream ingestion pipeline (PRD-005 observation, PRD-006 ingestion), and the hosted ROI admin surface (PRD-009) reads it and never writes a spend row. This resolves the inherited cross-repo dependency: the ledger that honeycomb's PRD-060f used to hold lives here now, because ROI moved to Queen.

The ledger is append-only. Every row carries its cost basis so a reader always knows whether a number is measured or allocated, and the aggregation read API never silently blends the two.

```sql
CREATE TABLE usage_ledger (
    entry_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organization(org_id) ON DELETE CASCADE,
    workspace_id    UUID REFERENCES workspace(workspace_id) ON DELETE SET NULL,
    team_id         UUID REFERENCES team(team_id) ON DELETE SET NULL,
    -- user attribution is nullable and only set when the per-user identity claim is verified
    user_id         UUID REFERENCES user_identity(user_id) ON DELETE SET NULL,
    agent_id        UUID REFERENCES agent_identity(agent_id) ON DELETE SET NULL,
    device_id       UUID REFERENCES device(device_id) ON DELETE SET NULL,
    harness         TEXT NOT NULL,  -- which CLI or gateway produced the event
    model           TEXT NOT NULL,  -- model identifier
    input_tokens    BIGINT NOT NULL DEFAULT 0,
    output_tokens   BIGINT NOT NULL DEFAULT 0,
    cached_tokens   BIGINT NOT NULL DEFAULT 0,
    reasoning_tokens BIGINT NOT NULL DEFAULT 0,
    -- cost basis: 'measured' from real gateway pricing, or 'allocated' from a rule.
    -- The aggregation read API must never blend these silently.
    cost_basis      TEXT NOT NULL,  -- 'measured' | 'allocated'
    cost_micros     BIGINT NOT NULL DEFAULT 0, -- cost in millionths of a unit currency
    currency        TEXT NOT NULL DEFAULT 'USD',
    occurred_at     TIMESTAMPTZ NOT NULL, -- event time from the observed stream
    ingested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    idempotency_key TEXT NOT NULL,  -- dedup: an event ingested twice is one row
    UNIQUE (org_id, idempotency_key)
);

CREATE INDEX usage_ledger_org_time
    ON usage_ledger (org_id, occurred_at DESC);

CREATE INDEX usage_ledger_org_team_time
    ON usage_ledger (org_id, team_id, occurred_at DESC);
```

The ledger holds usage facts, not usage content: model, token counts, timestamps, agent identity, harness, and cost basis. It never holds prompts, completions, or session text, matching the observation boundary in `../operations/usage-stream-observation.md`. `user_id` is null until the user's backend identity claim is verified, so per-user leaderboards stay inert rather than fabricating rows.

The append-only shape has a privacy consequence: per-user spend is PII, and PRD-009 defines a GDPR-style erasure path against this append-only ledger (visibility controls plus an erasure mechanism). That erasure path is a policy layer over these rows, not a `DELETE` free-for-all.

#### The ROI admin entitlement

The cross-org ROI read is fenced by an explicit entitlement, separate from org membership. This is what stops any authenticated user from reading a cross-org ledger.

```sql
CREATE TABLE roi_admin_entitlement (
    user_id     UUID NOT NULL REFERENCES user_identity(user_id) ON DELETE CASCADE,
    granted_by  UUID REFERENCES user_identity(user_id) ON DELETE SET NULL,
    scope       TEXT NOT NULL,  -- what breadth of ROI read is granted
    granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at  TIMESTAMPTZ,
    PRIMARY KEY (user_id)
);
```

The hosted ROI admin surface checks this entitlement before serving any cross-org aggregation. No entitlement, no cross-org read.

#### Restating the boundary

Read every table above and confirm it: there is no column that holds a prompt, a completion, session text, a file path, a repo name, or a plaintext credential. Coarse operational facts and coordination state are in; content is out. Encrypted references are stored as ciphertext and wrapped-key metadata that the cloud cannot open in the default mode. That is the whole boundary, and the schema shape is one of the things that enforces it. See `../security/trust-boundaries.md` for the trust model this schema implements.

### Trust Boundaries

Queen's trust model: what the cloud can and cannot see, the license-enforcement boundary, the no-memory-content invariant, the observation boundary, and the custody model inherited from ADR-0002, ADR-0003, and ADR-0005. Read this to understand where the trust lines fall and why each one is drawn where it is.

#### The promise the trust model has to keep

Queen's whole trust story is one sentence: the control plane sees coordination and coarse facts, never content. Everything below is what it takes to keep that promise honest. Most fleet tools start by grabbing your credentials and end by becoming the thing you have to trust blindly. Queen refuses that shape. The cloud coordinates around ciphertext it cannot open in the default mode, it observes only coarse usage facts, and the product says so out loud, because "we cannot decrypt this" is both the security promise and a support constraint.

There are two planes, and the trust line runs between them. Memory and skills live on the Deeplake data plane. Queen is the control plane beside it. Queen never crosses into content.

#### The trust boundary diagram

```mermaid
flowchart TB
    subgraph UserDomain["User's trust domain"]
        subgraph Machine["Enrolled machine"]
            AG["Local Queen agent\nper-agent private key (local)"]
            CLI["CLI harnesses + model gateway"]
            HC["Honeycomb\nDeeplake credential custody (custodian devices)"]
        end
        ORCH["Fleet orchestrator\n(custodian, holds Deeplake credential)"]
    end

    subgraph DataPlane["Data plane"]
        DL[("Deeplake dataset\nmemory · sessions · skills\nBYOC")]
    end

    subgraph CloudDomain["Queen cloud trust domain"]
        API["Control-plane API"]
        AUTH["Licensing authority"]
        PG[("Postgres\ncoordination + coarse facts + ciphertext,\nnever memory content, never plaintext creds")]
    end

    HC -- "memory read/write (content)" --> DL
    ORCH -- "custody, encrypted blobs" --> DL
    AG -. "coarse usage facts + presence" .-> API
    AG -- "bind (license identity + coarse liveness)" --> AUTH
    API --> PG
    AUTH --> PG
    API -. "signed commands (no content)" .-> AG

    CLI -. "coarse facts only\n(model, tokens, timestamps, cost)" .-> AG
```

The dashed lines crossing into the Queen cloud trust domain carry coarse facts and coordination only. The solid lines that carry memory content stay entirely inside the user's trust domain and the data plane. No content line crosses into the cloud.

#### What the cloud can see

The cloud control plane can see, and holds in Postgres:

- **Identity and tenancy.** Orgs, workspaces, teams, users, devices, fleets, per-agent identities. Public keys, never private keys.
- **Presence.** Heartbeats and coarse status diffs: which agent is alive, its version, its embeddings health, a coarse task label. Liveness derived from heartbeat age.
- **Coordination.** Leases, enrollment token metadata (hashes, scope, expiry, usage counts), signed-command records (type, parameters, audit of who requested).
- **Coarse usage facts.** Model, token counts, timestamps, agent identity, harness, cost basis. These feed the usage/ROI ledger.
- **Encrypted references.** Ciphertext blobs and wrapped-key metadata it cannot decrypt in the default mode.
- **License identity and coarse liveness.** For binding and the license heartbeat.

#### What the cloud cannot see

The cloud control plane never sees, and no column in the schema holds:

- Memory content, prompts, system prompts, or user messages.
- Completions, tool-call payloads, or model responses.
- Session text, file paths, repo names, or any captured content.
- Plaintext Deeplake credentials or any plaintext credential.
- Anything that would let the control plane reconstruct what was said or done. It knows that work happened and what it cost, never what the work was.

This is the no-memory-content invariant, and it is enforced structurally by schema shape (there is no column that could hold session text) as much as by application logic. The full DDL and the restatement of the boundary per table are in `../data/control-plane-schema.md`.

#### The custody model (inherited from ADR-0002, 0003, 0005)

Queen inherits and preserves the orchestrator-custodian custody model. The reframe is only in naming: what those ADRs call the "Honeycomb control plane" is now the Queen cloud application; the custody decisions stand.

- **Custody lives in the user's trust domain, not the cloud** (ADR-0002). A durable machine in the user's fleet (a laptop custodian or a fleet orchestrator) holds the ability to decrypt or rewrap the Deeplake credential. Queen coordinates around ciphertext. The default architecture is not "Queen stores a decryptable credential"; that is an explicit, visible, opt-in escrow mode only, never the default.
- **Headless enrollment grants join, not memory** (ADR-0003). A browserless VPS enrolls with a short-lived token whose only power is "let me join." The token cannot read memory and cannot decrypt anything. Approval in the cloud is not the same as memory-ready; the cryptographic rewrap happens on a custodian device.
- **Recovery, revocation, and escrow are policy, not improv** (ADR-0005). Revoking a device in Queen and rotating the Deeplake credential are two honest, separate steps. Lose every custodian and the answer is re-link, not a hidden backdoor. Cloud escrow can exist only as explicit, visible, reversible opt-in.

The upshot: you trust your orchestrator, Queen coordinates, Deeplake stores memory, and workers are disposable. The trust question does not disappear because you ignore it. Queen picks the honest option and names it.

#### The license-enforcement boundary

License enforcement runs on its own channel, and that channel is content-free by design. The binding handshake and the license heartbeat carry only license identity and coarse liveness (license id, deployment id, a timestamp, a status). The enforcement channel is physically separate from any fleet data path, which is both a privacy guarantee and an anti-tamper property: there is no fleet content flowing through the enforcement path to intercept or repurpose, and the enforcement path cannot be confused with a data path.

Enforcement fails closed and degrades loud. An invalid, expired, or revoked license stops the app with a clear operator-facing reason; it never fails open and never degrades silently. The trust root stays in Legion's hosted authority: the local process does not self-attest, so a forged local "valid" flag buys nothing, because the authority (not the local process) issues the binding material the app needs. Full treatment in `../licensing/cloud-binding-and-byoc.md`.

#### The observation boundary

Observation is where Queen touches usage traffic, and it is drawn deliberately narrow. In v1, the local agent observes **CLI harness and model-gateway traffic only**, using the clean gateway-layer patterns that see the traffic a user already routed through a proxy they opted into. From those streams it extracts only coarse facts.

The line Queen does **not** cross in v1 is desktop TLS interception. Intercepting Claude Desktop, ChatGPT Desktop, or Cursor Desktop means installing a local root certificate authority and running a man-in-the-middle proxy that terminates the desktop app's TLS. That is the single highest-value attack surface in the system: a root CA plus a first-party TLS interceptor on every enrolled machine, which is exactly the capability the product promises it does not have. It is deferred, off by default, behind a future consent-gated PRD, with a clean seam so it can slot in without re-architecting (ADR-0009). The full observation boundary is in `../operations/usage-stream-observation.md`.

#### Attack surfaces and how the model limits them

| Surface | Risk | How the trust model limits it |
|---|---|---|
| Stolen dashboard session | Attacker requests commands | Dashboard can request but never forge; the mint authority signs, workers verify against a pinned key. |
| Compromised mint authority | Attacker owns command minting | The signing key is the crown jewels: keychain/HSM where possible, encrypted at rest at minimum, never on a worker. The authority is required to issue, never to run; kill it and the fleet degrades to autonomous, not dead. |
| Leaked enrollment token | Attacker joins the fleet | Token is short-lived, single-use, low-privilege ("let me join" only); it cannot read memory or decrypt anything, and it is dead after use. |
| Leaked per-agent credential | One agent compromised | Per-agent identity means one revocation cuts off one agent, not the fleet. No shared forever-key exists. |
| Compromised cloud control plane | Attacker reads Postgres | Postgres holds no memory content and no plaintext credentials; encrypted blobs are ciphertext the cloud cannot open in the default mode. The blast radius is coordination metadata, not memory. |
| Stolen or lost machine | Local Deeplake material at risk | Revoke the device in Queen, then rotate the Deeplake credential; two honest, separate steps, both documented in the recovery policy. |
| Desktop TLS interceptor (if built) | Root CA on every machine | Deferred in v1 precisely because it is the highest-value attack surface; only ships later behind explicit per-machine consent and a security review. |

#### Invariants for the trust model

- Postgres holds coordination state, coarse usage facts, and ciphertext only; never memory content, never plaintext credentials.
- Custody of the Deeplake credential lives in the user's trust domain; cloud escrow is explicit, visible, reversible opt-in only.
- Enrollment tokens grant join, never memory access, and cannot decrypt anything.
- Per-agent identity is attributable and individually revocable; no shared forever-key exists.
- The mint authority signs; the dashboard requests; workers verify against a pinned key.
- License enforcement runs on a content-free channel, fails closed, and degrades loud.
- v1 observation is CLI/gateway coarse facts only; no root CA and no TLS interception on enrolled machines.

### ADR-0006, Two-application topology: local CLI agent and cloud application

#### Context

Queen is the Apiary's cloud fleet orchestrator. It sits beside the Deeplake memory data plane and
carries what that plane was never meant to carry: liveness, status, identity, enrollment, signed
commands, usage-stream observation, and fleet-wide reporting. Memory and skills stay on Deeplake.
Queen owns seeing and steering the fleet.

The inherited ADRs (ADR-0002 through ADR-0005) were written in honeycomb's voice and described a
"Honeycomb control plane" with a cloud console and local daemons. Queen now owns that control plane
as its own product. That ownership forces a first-order decision the inherited docs never made
explicit: how many applications is Queen, and where does the dashboard live?

The naive answer is one application: a local daemon that also serves its own web UI, the way the
local Apiary stack serves the Hive portal on `127.0.0.1:3853`. That answer breaks down the moment
you look at what Queen's surfaces actually are. A fleet dashboard renders machines that are not the
one you are looking at. A hosted ROI admin surface reads a cross-org ledger. Neither of those is a
single-machine view, and neither can be served honestly from a loopback port on one laptop. The
control plane is inherently a cloud thing, and the local side of Queen is inherently a reporter and
a command executor, not a place a human points a browser.

#### Decision drivers

- **The fleet view is not a local view.** A dashboard that shows other machines cannot be served from
  one machine's loopback without that machine becoming a de facto control plane, which is exactly the
  cloud application's job.
- **A local web UI is a BYOC-class surface.** Any dashboard that renders fleet or org data is
  control-plane data. Serving it locally would put a licensed, auth-gated surface on every enrolled
  machine and multiply the attack surface and the license-enforcement burden.
- **The local agent must stay disposable and cheap.** Ephemeral workers and headless VPS boxes run
  the local agent. It has to install fast, run headless, and carry no browser, no bundled frontend,
  and no server that listens for humans.
- **Consistency with the rest of the Apiary local stack.** Honeycomb, Doctor, and Hive are TS/Node.
  The local agent should share that toolchain and those patterns.
- **The cloud application is where all the auth, tenancy, and licensing already have to live.** Put
  the dashboards where the boundary already is, not on the far side of it.
- **The local agent is useless on its own.** It only functions when bound to a cloud deployment. That
  binding relationship is the spine of the product, not an afterthought, and it wants a clean split
  between the thing that binds and the thing it binds to.

#### Considered options

##### Option A, One application: local daemon that also serves a local dashboard

The local agent bundles a web frontend and serves it on loopback, like the Hive portal. Fleet views
render from whatever the local agent can see or fetch.

This collapses the two planes the whole product is built to keep separate. To render a fleet, the
local dashboard would have to pull other machines' presence and identity data down to one laptop,
which turns that laptop into a control plane and a cross-machine data sink. It also puts an
auth-gated, license-relevant web surface on every enrolled box, including throwaway VMs, which is the
opposite of disposable. Rejected.

##### Option B, One application: a single cloud service with a thin local shim

Everything lives in the cloud, and the local presence is a shell script or a one-file shim with no
real identity or command surface.

This underpowers the local side. The local agent has to hold per-agent identity, redeem enrollment
tokens, observe usage streams, and poll a signed command channel. Those are real responsibilities
with their own lifecycle, packaging, and tests. Treating them as a shim understates the work and
couples the local agent's release cadence to the cloud's. Rejected.

##### Option C, Two independently built applications with a binding relationship (CHOSEN)

Queen ships as two applications:

1. **Local Queen agent.** TypeScript/Node, CLI only, no local dashboard. It binds ("pairs") to a
   Queen cloud deployment, reports presence and usage streams, redeems enrollment tokens, holds
   per-agent identity, and polls the signed command channel. Package: `@legioncodeinc/queen`.
2. **Cloud Queen application.** The server-side app that serves the Queen dashboard and control-plane
   API from `queen.theapiary.sh` (the hosted common deployment) or a customer's licensed BYOC
   deployment. This is where every dashboard lives: the read-only fleet dashboard and the hosted ROI
   admin surface. It owns the Postgres boundary, ingestion, auth, and licensing.

The two are built, versioned, and released independently. The local agent has no web UI on purpose.
Any dashboard is a cloud surface, served by the cloud application, whether that application is the
hosted common or a licensed BYOC deployment.

#### Decision

Adopt **Option C**. Queen is two applications: a local TS/Node CLI agent (`@legioncodeinc/queen`)
and a cloud Go + SvelteKit application served from `queen.theapiary.sh` or a licensed BYOC
deployment.

The local agent has **no local dashboard**. It is CLI only. Every dashboard Queen offers is served by
the cloud application. The reason is a boundary, not a preference: a dashboard renders fleet, org, or
ROI data, that data is control-plane data, and control-plane data belongs behind the cloud
application's auth and licensing, never on a loopback port on an enrolled machine.

The local agent is **useless on its own**. It functions only when bound to a cloud deployment
(hosted common or licensed BYOC). The binding handshake is a required boot step for the local agent.
The mechanism and enforcement of that binding are specified in ADR-0008. The stack choices for each
application are specified in ADR-0007. This ADR fixes the topology: two applications, one binding
relationship, dashboards on the cloud side only.

#### Topology map

```mermaid
flowchart TB
    subgraph Local["Local machines (fleet)"]
        A1["Local Queen agent (CLI)\n@legioncodeinc/queen\nno dashboard"]
        A2["Local Queen agent (CLI)\nheadless VPS"]
    end
    subgraph Cloud["Cloud Queen application"]
        API["Control-plane API (Go)"]
        DASH["Fleet dashboard (SvelteKit)"]
        ROI["Hosted ROI admin surface (SvelteKit)"]
        BIND["Binding / registration"]
    end
    PG[("Postgres\ncoordination + usage ledger,\nnever memory content")]

    A1 -- "bind / pair (required boot step)" --> BIND
    A2 -- "bind / pair (required boot step)" --> BIND
    A1 -. "presence + usage facts" .-> API
    A2 -. "presence + usage facts" .-> API
    API -- "signed commands (polled)" --> A1
    API --> PG
    DASH --> API
    ROI --> PG
    BIND --> PG
```

#### Consequences

**Positive**

- The two planes stay uncollapsed. The local agent reports and executes; the cloud application sees
  and steers. No enrolled machine becomes an accidental control plane.
- The local agent stays disposable. It installs headless, carries no frontend, and has no
  human-facing listener, which fits ephemeral workers and headless VPS boxes.
- Dashboards live behind one auth and licensing boundary, in the cloud application, instead of being
  duplicated onto every machine.
- The binding relationship becomes the natural home for license enforcement (ADR-0008): the same
  handshake the agent cannot skip is the one that carries the license check.
- Local agent and cloud application can ship on independent cadences with independent test suites.

**Negative / accepted**

- Two applications means two build pipelines, two release processes, and a versioned contract
  between them (the binding and reporting API) that must stay compatible across releases.
- A developer who wants a quick local view of "just this machine" gets a CLI, not a web page. That is
  intentional, and it means the CLI's output has to be good.
- The local agent cannot do anything useful offline or unbound. That is by design (ADR-0008), but it
  is a real constraint operators must understand up front.

#### Required invariants

- The local agent ships no web dashboard and opens no human-facing HTTP listener.
- Every Queen dashboard is served by the cloud application (hosted common or licensed BYOC).
- The local agent performs a binding handshake to a cloud deployment as a required boot step and does
  not function unbound.
- The two applications are built and released independently, with a versioned binding/reporting
  contract between them.
- No fleet, org, or ROI data is rendered on an enrolled machine's loopback surface.

#### Revisit triggers

Re-open this decision if any of these become true:

1. A concrete need appears for a genuinely local, single-machine web view that carries no fleet, org,
   or ROI data and no license-relevant surface.
2. The binding/reporting contract between the two applications becomes a recurring source of breakage
   that a merged codebase would avoid.
3. A future consent-gated local surface (see ADR-0009's deferred desktop observation) requires a
   local UI, at which point its trust boundary and licensing must be designed against this ADR.

#### Links

- ADR-0002: `library/knowledge/private/architecture/ADR-0002-orchestrator-custodian-for-fleet-memory-plane.md`
- ADR-0003: `library/knowledge/private/architecture/ADR-0003-trusted-device-custody-and-headless-enrollment.md`
- ADR-0004: `library/knowledge/private/architecture/ADR-0004-honeycomb-control-plane-and-postgres-boundary.md`
- ADR-0007: `library/knowledge/private/architecture/ADR-0007-stack-selection.md`
- ADR-0008: `library/knowledge/private/architecture/ADR-0008-cloud-binding-and-license-enforcement.md`
- PRD-001: `library/requirements/backlog/prd-001-local-queen-agent-foundation/prd-001-local-queen-agent-foundation-index.md`
- PRD-002: `library/requirements/backlog/prd-002-cloud-control-plane-foundation/prd-002-cloud-control-plane-foundation-index.md`
- PRD-007: `library/requirements/backlog/prd-007-fleet-observation-control-plane/prd-007-fleet-observation-control-plane-index.md`

### ADR-0007, Stack selection: Go backend, SvelteKit frontend, TypeScript local agent

#### Context

ADR-0006 fixed the topology: Queen is two applications, a local CLI agent and a cloud application
that serves every dashboard. This ADR picks the languages and frameworks for each and sets the
dependency discipline that governs both.

The inherited framing (ADR-0004) assumed the cloud API was Cloudflare Workers in JS/TS. That
assumption was made for a control plane whose only job was cheap coordination and idle liveness, and
it deliberately avoided always-on compute. Queen's workload is different. It ingests high-frequency
usage and presence streams (ADR-0009, ADR-0010), runs a real control-plane API with signed commands,
and serves read-mostly dashboards. That workload has proven concurrency and fan-in needs, which
changes the calculus away from "Workers as the API."

There is also a tempting default worth naming and rejecting: TypeScript everywhere. The local Apiary
stack (Honeycomb, Doctor, Hive) is TS/Node, and using TS for the cloud backend too would give one
language across the whole product. That convenience does not outweigh what Go buys on the server for
this specific workload, and the frontend and local agent do not need to be the same language as the
backend to share a team.

#### Decision drivers

- **The cloud backend's real workload is concurrent ingestion fan-in and a control-plane API.** That
  favors a language with cheap concurrency and a small, static deployment footprint.
- **Cheap to run on droplets.** ADR-0010 puts the app tier and the ingestion sidecar tier on
  DigitalOcean droplets. A single static binary with a tiny dependency surface is the cheapest,
  most boring thing to deploy and supervise there.
- **The dashboards are read-mostly.** The fleet dashboard and the ROI admin surface are largely
  read-and-render. They want a small bundle, fast first paint, and good SSR, not a heavy SPA runtime.
- **The local agent must match the rest of the Apiary local stack.** Honeycomb, Doctor, and Hive are
  TS/Node. Shared patterns, shared toolchain, and shared muscle memory matter more on the local side
  than backend language unification does.
- **Slim on dependencies, everywhere.** Prefer the standard library and language built-ins. Every
  third-party dependency must earn its place and be justified in the doc that introduces it. This is
  a house rule, not a per-service preference.
- **Do not unify the language just to unify the language.** One language across three very different
  runtimes (edge, server, CLI) is a convenience, not a requirement, and it costs the wrong things
  here.

#### Considered options

##### Option A, TypeScript everywhere (local agent, cloud backend, cloud frontend)

One language across the whole product. The local agent, the cloud API, and the frontend are all TS.

This is the convenient default and it is wrong for the backend. Node's concurrency story for
high-frequency ingestion fan-in is workable but heavier to operate than Go's, the deployment
artifact is a node_modules tree instead of a static binary, and the dependency surface on the server
grows fast. The convenience of one language does not pay for the operational cost on the tier that
does the most concurrent work. Rejected for the backend.

##### Option B, Cloudflare Workers as the cloud API (inherited from ADR-0004)

Keep the API on Workers in JS/TS, as ADR-0004 chose.

ADR-0004 chose this explicitly to avoid always-on compute for a coordination-only control plane. That
premise no longer holds: Queen has a proven high-frequency ingestion and presence workload, and it
adopts droplets and a Go sidecar tier for it in ADR-0010. Workers stay in Queen, but at the ingestion
edge only, not as the API. Rejected as the API; retained at the edge (see ADR-0010).

##### Option C, Go backend, SvelteKit frontend, TypeScript local agent (CHOSEN)

- **Cloud backend: Go.** Single static binary, tiny dependency surface, strong concurrency for
  ingestion fan-in, cheap to run on droplets, easy to containerize.
- **Cloud frontend: Svelte / SvelteKit.** Small bundle, fast, minimal runtime, good SSR for a
  read-mostly dashboard.
- **Local agent: TypeScript / Node.** Node built-ins first, slim deps. Consistency with the rest of
  the Apiary local stack and shared patterns with Honeycomb and Doctor.

Three runtimes, three fit-for-purpose choices, one dependency discipline across all of them.

#### Decision

Adopt **Option C**.

- **Cloud backend is Go.** It serves the control-plane API and the ingestion sidecar consumers
  (ADR-0010). Reasons: single static binary, tiny dependency surface, strong concurrency for the
  ingestion fan-in, cheap to run on droplets, easy to containerize.
- **Cloud frontend is Svelte / SvelteKit.** It serves the fleet dashboard and the hosted ROI admin
  surface. Reasons: small bundle, fast, minimal runtime, good SSR for read-mostly pages.
- **Local agent is TypeScript / Node.** Node built-ins first, slim deps. Reasons: consistency with
  the rest of the Apiary local stack and shared patterns with Honeycomb and Doctor.

This re-scopes the inherited assumption in ADR-0004 that the cloud API is Cloudflare Workers in
JS/TS. Workers still exist in Queen, but only at the ingestion edge (ADR-0010), never as the API. The
full runtime and infrastructure topology is specified in ADR-0010; this ADR is the language and
framework decision that ADR-0010 builds on.

**Slim-dependency mandate.** Across all three runtimes, prefer the standard library and language
built-ins. Every third-party dependency must earn its place and be justified in the doc that
introduces it (the PRD or ADR that pulls it in). A dependency that only saves a few lines of
first-party code does not earn its place. This mandate applies equally to the Go backend, the
SvelteKit frontend, and the TS local agent.

#### Consequences

**Positive**

- The backend deploys as a static binary with a small dependency surface, which is the cheapest and
  most boring thing to run and supervise on the droplet tiers ADR-0010 defines.
- Go's concurrency model fits the ingestion fan-in directly, so the validation, tenancy, and
  data-shaping logic lives in one testable Go codebase (ADR-0010) instead of being scattered.
- The SvelteKit dashboards ship a small bundle with good SSR, which suits read-mostly fleet and ROI
  views and keeps the frontend cheap.
- The local agent shares a toolchain and patterns with the rest of the Apiary local stack, so
  developers move between Honeycomb, Doctor, and Queen's agent without a context switch.
- The slim-dependency mandate keeps the supply-chain and audit surface small across all three
  runtimes.

**Negative / accepted**

- The product spans three runtimes and two languages. A developer working end to end touches Go,
  SvelteKit, and TS/Node, which is a wider surface than a single-language product.
- Backend and local agent do not share code directly. Any shared contract (the binding and reporting
  API) is a versioned wire contract, not shared source. ADR-0006 already accepted this.
- Choosing Go for the backend means the team maintains Go tooling, testing, and CI alongside the
  TS tooling the local stack already has.

#### Required invariants

- The cloud backend is Go, deployed as a static binary.
- The cloud frontend is SvelteKit, server-side rendered for the read-mostly dashboards.
- The local agent is TypeScript / Node, built on Node built-ins first.
- Cloudflare Workers appear only at the ingestion edge (ADR-0010), never as the control-plane API.
- Every third-party dependency in any of the three runtimes is justified in the doc that introduces
  it. Unjustified dependencies do not ship.

#### Revisit triggers

Re-open this decision if any of these become true:

1. The Go backend's operational cost or hiring constraints outweigh its concurrency and deployment
   benefits for the measured workload.
2. SvelteKit's SSR or ecosystem proves insufficient for a dashboard requirement that a different
   frontend framework would serve materially better.
3. The local agent needs to share substantial logic with the backend such that a shared language
   would remove a recurring class of contract bugs.
4. The slim-dependency mandate blocks a genuinely necessary capability that no reasonable amount of
   first-party code can cover.

#### Links

- ADR-0004: `library/knowledge/private/architecture/ADR-0004-honeycomb-control-plane-and-postgres-boundary.md`
- ADR-0006: `library/knowledge/private/architecture/ADR-0006-two-application-topology.md`
- ADR-0010: `library/knowledge/private/architecture/ADR-0010-cloud-infrastructure-and-ingestion.md`
- PRD-001: `library/requirements/backlog/prd-001-local-queen-agent-foundation/prd-001-local-queen-agent-foundation-index.md`
- PRD-002: `library/requirements/backlog/prd-002-cloud-control-plane-foundation/prd-002-cloud-control-plane-foundation-index.md`

### ADR-0008, Cloud binding and AGPL license enforcement

#### Context

Queen is licensed under the GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later). The
Affero clause is the point of the license: run a modified version as a network service and you owe
its source to the users who interact with it. Queen is exactly the kind of software that clause was
written for, a networked control plane, and the honest bargain only works if it is enforced.

Two things make enforcement worth designing deliberately rather than leaving to good faith. First, an
AGPL network service is trivial to run modified with the source-offer stripped out if nothing in the
running system depends on the check. Second, in the LLM era a developer can ask a coding assistant to
"remove the license check" and get a clean patch in seconds. A license check that sits in its own
tidy function, easy to find and easy to delete, is a check that will be deleted.

ADR-0006 gives us the lever. The local agent and any BYOC cloud deployment already cannot function
unbound: the binding/registration handshake is a required boot step. If the license check lives
inside that same handshake, then the check is not a bolt-on that can be excised without consequence.
It is fused into the one code path the application cannot run without. Removing the check means
removing the binding, and removing the binding means the app does not work.

This ADR records how binding and license enforcement work, and it commits to an anti-circumvention
design with concrete, implementable tactics. The enforcement lives in the cloud application's
registration and BYOC bootstrap components (ADR-0007's Go backend) and in the local agent's binding
step (ADR-0006).

#### Decision drivers

- **Keep the AGPL bargain honest.** Running a modified Queen network service without offering source,
  or running an unlicensed private BYOC deployment, must fail closed by design.
- **Make license-stripping materially harder, not merely forbidden.** The goal is that a developer or
  an LLM asked to remove the check cannot do so cleanly, because the check and the thing that makes
  the app work are the same code path.
- **Fail closed, degrade loud.** An invalid, expired, or revoked license stops the app with a clear
  operator-facing reason. Never fail open. Never degrade silently.
- **Enforcement never phones home with fleet content.** The license heartbeat carries license
  identity and coarse liveness only, consistent with the Postgres boundary (ADR-0004): no memory
  content, no prompts, no session text, no fleet data.
- **Binding is not optional.** No binding, no function, for both the local agent and a BYOC cloud
  deployment.
- **The code must teach the reader.** The registration and BYOC code carries prominent, specific
  comments explaining why the check exists and that removing it violates the license, so anyone (or
  any assistant) editing the file reads the consequence in the same file.

#### Considered options

##### Option A, No enforcement, rely on the license text alone

Ship AGPL, trust operators to honor it, add no runtime check.

This is the lowest-effort option and it abandons the Affero clause in practice. A modified,
source-stripped network service runs indefinitely with nothing stopping it, and the license becomes a
document nobody is compelled to honor. Rejected.

##### Option B, A standalone license check, separable from the runtime

Add a dedicated `verifyLicense()` gate at boot. If it fails, exit. Keep it in its own module.

This enforces the license but is trivially defeated. A standalone gate is the single easiest thing to
find and delete, and an LLM will produce a clean patch that removes it and leaves the rest of the app
working. Enforcement that a one-line change disables is not enforcement. Rejected.

##### Option C, Binding-fused enforcement with anti-circumvention design (CHOSEN)

Fold the license check into the same code path that establishes the cloud binding the application
cannot run without. The binding handshake produces the material (session credentials, signing keys,
tenant context) the running app depends on, and the license validation is inseparable from producing
that material. Remove the check and you remove the binding; remove the binding and the app does not
function. Add prominent code comments, a fail-closed / degrade-loud contract, and a content-free
heartbeat.

#### Decision

Adopt **Option C**. License enforcement is fused into the cloud binding.

**Binding is a required boot step.** The binding/registration handshake is mandatory for the local
agent to function (ADR-0006) and is a required bootstrap step for a BYOC cloud deployment. No binding,
no function. The local agent binds to either the hosted common at `queen.theapiary.sh` or a licensed
BYOC deployment. A BYOC deployment binds itself to the hosted licensing authority.

**The license check lives inside the binding path, not beside it.** The handshake that establishes the
binding also validates the license, and the two are not separable. The binding handshake is what
yields the runtime material the application needs to operate (session/tenant context and the
credentials the control plane issues). License validation is a precondition of, and interleaved with,
producing that material. There is no code path that produces a working binding while skipping the
license validation, and there is no working application without a binding.

**BYOC authenticates with a Legion-issued deployment license credential.** A BYOC deployment presents
a deployment license credential issued by Legion. The cloud app validates it against the hosted
licensing authority on boot and on a heartbeat. On invalid, expired, or revoked, it fails closed and
degrades loudly with a clear operator-facing reason. It never fails open and never degrades silently.

**The heartbeat carries no fleet content.** The license heartbeat carries only license identity and
coarse liveness (license id, deployment id, a timestamp, a status). It never carries memory content,
prompts, session text, presence detail, usage stream data, or any fleet content, consistent with the
Postgres boundary in ADR-0004.

**The code teaches the reader.** The registration and BYOC bootstrap code carries prominent, specific
comments stating why the check exists, that removing it violates the AGPL license and the deployment
license terms, and what the legal and functional consequence of removal is. The intent is that a
developer or an LLM asked to "strip the license check" is reading, in the same file, an explicit
statement that doing so is a license violation, alongside code where the check cannot be cleanly
separated from the binding the app needs.

#### Anti-circumvention design

These are concrete, implementable tactics, not aspirations. They are ordered from the structural
(hardest to defeat) to the supporting (defense in depth).

1. **Fuse the check into the binding handshake's output.** The binding handshake must return the
   runtime material the app uses on every request path: the tenant context, the control-plane session
   credential, and the command-channel verification key (the pinned Ed25519 public key from the mint
   authority the README and PRD-008 describe). Derive or unlock that material as part of the same
   function that validates the license, so that a caller who skips validation gets no usable material.
   The correct shape is "validate-and-bind returns the working session," not "validate; then, if ok,
   bind." A patch that deletes the validation must also delete the return of the material the app
   cannot run without.

2. **No boolean gate to flip.** Do not express enforcement as `if (!licenseValid) exit()`. That is a
   single predicate an assistant can invert or delete. Express it as data dependency: the license
   response is an input to deriving the session, not a branch guarding it. There should be no
   `licenseValid` boolean whose negation is the whole enforcement.

3. **Server-side validation, not client-side trust.** The hosted licensing authority validates the
   credential and issues the binding material. The local agent and BYOC deployment do not self-attest.
   A forged local "valid" flag buys nothing because the authority, not the local process, produces the
   session material. This keeps the trust root in Legion's control plane, which a local edit cannot
   move.

4. **Bind the license identity to the issued material.** The session/tenant material the authority
   issues is scoped to the validated license and deployment identity. Material issued for one license
   does not work for another deployment, so lifting a valid binding from a licensed deployment into an
   unlicensed one fails on use, not just on issue.

5. **Fail closed on every ambiguous outcome.** Network error to the authority, malformed response,
   clock skew beyond tolerance, unknown status: all resolve to "not bound," which means "not running,"
   with a loud operator-facing reason. There is a bounded, documented grace behavior for transient
   authority unreachability (see below), but the default of any ambiguity is closed.

6. **Heartbeat re-validation with revocation honored.** The BYOC deployment re-validates on a
   heartbeat, and a revoked or expired license takes effect on the next heartbeat. The heartbeat
   re-issues or refreshes the binding material, so a deployment that stops passing validation stops
   getting the material it needs to keep operating. Revocation is not merely logged; it withdraws the
   ability to keep running.

7. **Prominent, specific in-file comments (the LLM-reader tactic).** At the top of the registration
   and BYOC bootstrap files, and immediately around the validate-and-bind function, place comments
   that (a) state this code enforces the AGPL and the deployment license, (b) state that removing or
   bypassing it is a license violation with legal consequence, and (c) explain that the binding and
   the license check are deliberately inseparable so that removing the check breaks the app. The point
   is that any assistant reading the surrounding context to edit this file is reading the prohibition
   and the rationale in the same window.

8. **Content-free enforcement channel.** The license/binding channel is physically separate from any
   fleet data path and carries only license identity and coarse liveness. This is both a privacy
   guarantee (ADR-0004) and an anti-tamper property: there is no fleet content flowing through the
   enforcement path to intercept or repurpose, and the enforcement path cannot be confused with a data
   path.

9. **Degrade loud, with a real reason.** When enforcement fails closed, the operator-facing output
   states the specific cause (expired, revoked, unreachable authority beyond grace, invalid
   credential) and what to do. Silent failure and vague failure are both prohibited, because a clear
   failure is honest to the operator and removes the temptation to "just disable the check to see what
   breaks."

**Bounded grace for transient unreachability.** So that a brief outage of the hosted authority does
not black out a legitimately licensed BYOC deployment, the deployment may continue on its last valid
binding for a short, documented grace window while the authority is unreachable, then fail closed if
the window expires without a successful re-validation. The grace window is bounded and specified in
PRD-004. Grace applies only to transient unreachability, never to a response that says invalid,
expired, or revoked, which fail closed immediately.

#### Enforcement flow

```mermaid
sequenceDiagram
    autonumber
    participant Dep as BYOC deployment / local agent
    participant Auth as Hosted licensing authority
    participant App as Running application

    Dep->>Auth: bind: present license / deployment credential
    Auth->>Auth: validate (identity, expiry, revocation)
    alt valid
        Auth-->>Dep: issue binding material (session, tenant, verify key)
        Dep->>App: derive working session from binding material
        App->>App: run
        loop heartbeat
            Dep->>Auth: heartbeat (license id, deployment id, timestamp, status only)
            Auth-->>Dep: refresh binding material or signal revoked
        end
    else invalid / expired / revoked
        Auth-->>Dep: deny (specific reason)
        Dep->>App: no binding material, fail closed, degrade loud
    end
```

#### Consequences

**Positive**

- The AGPL bargain is enforced structurally. A modified, source-stripped, or unlicensed network
  service fails closed instead of running quietly.
- License-stripping is materially harder. The check is not a separable gate; it is fused to the
  binding the app needs, and the file says so in prominent comments aimed at both humans and
  assistants.
- The trust root stays in Legion's hosted authority. Local edits cannot mint valid binding material.
- Enforcement is privacy-preserving. The license channel carries no fleet content, consistent with
  ADR-0004.
- Operators get honest, specific failures instead of silent degradation.

**Negative / accepted**

- Queen cannot run fully air-gapped or indefinitely offline. Both the local agent and a BYOC
  deployment depend on reaching a cloud binding, subject to the bounded grace window. This is a
  deliberate constraint operators must accept.
- The hosted licensing authority is a critical dependency and a potential single point of failure.
  The bounded grace window mitigates transient outages, but a prolonged authority outage will fail
  legitimate deployments closed. The authority's own availability is an operational obligation.
- Fusing enforcement into the binding path raises the bar for anyone doing legitimate maintenance on
  that code, since the binding and the check are intentionally inseparable.
- AGPL enforcement of this kind is a product and legal posture, not just an engineering one. The
  comments and behavior must match the actual license terms, which is why legal is an owner of this
  ADR.

#### Required invariants

- Binding to a cloud deployment (hosted common or licensed BYOC) is a required boot step; the app
  does not function unbound.
- The license check is fused into the binding handshake and is not expressible as a single separable
  boolean gate.
- The hosted licensing authority, not the local process, issues the binding material, and that
  material is scoped to the validated license and deployment identity.
- Invalid, expired, or revoked licenses fail closed and degrade loud with a specific operator-facing
  reason; grace applies only to transient authority unreachability, within a bounded window.
- The license heartbeat carries only license identity and coarse liveness, never fleet content.
- The registration and BYOC bootstrap code carries prominent comments stating the enforcement's
  purpose and that removing it violates the license.

#### Revisit triggers

Re-open this decision if any of these become true:

1. A licensing model change (for example a genuinely offline enterprise tier) requires a different
   enforcement shape than always-reachable binding.
2. The bounded grace window proves too short for real BYOC network conditions, or too long for the
   revocation guarantee, and needs re-tuning against evidence.
3. The hosted licensing authority's availability becomes a material reliability problem for
   legitimate deployments.
4. Legal guidance changes what the license terms permit or require, changing the comment content or
   the enforcement behavior.
5. A hardening idea from the author or a security review materially improves the anti-circumvention
   posture and is adopted; document it here.

#### Escalation note

This decision records the license-enforcement architecture. Its security posture (the strength of the
credential scheme, the revocation path, the grace-window abuse surface, and the separation of the
enforcement channel from fleet data) should be reviewed by security before implementation lands. This
ADR touches deployment credentials and a licensing authority; surface it to security-worker-bee for a
review of the design's soundness.

#### Links

- ADR-0004: `library/knowledge/private/architecture/ADR-0004-honeycomb-control-plane-and-postgres-boundary.md`
- ADR-0006: `library/knowledge/private/architecture/ADR-0006-two-application-topology.md`
- ADR-0007: `library/knowledge/private/architecture/ADR-0007-stack-selection.md`
- ADR-0009: `library/knowledge/private/architecture/ADR-0009-usage-stream-observation-scope.md`
- PRD-003: `library/requirements/backlog/prd-003-authentication-and-multi-tenancy/prd-003-authentication-and-multi-tenancy-index.md`
- PRD-004: `library/requirements/backlog/prd-004-licensing-registration-and-byoc-enforcement/prd-004-licensing-registration-and-byoc-enforcement-index.md`
- License: `LICENSE.md`
- Trust boundaries: `library/knowledge/private/security/trust-boundaries.md`

### ADR-0010, Cloud infrastructure and ingestion architecture

#### Context

ADR-0004 chose the Honeycomb control-plane runtime topology: Cloudflare Workers as the API, DigitalOcean
managed Postgres as the system of record, Hyperdrive for Postgres access, Cloudflare Queues for async
work, and Durable Objects for live coordination. It explicitly refused two things for the MVP: a
DigitalOcean Droplet for the API, and Redis/Valkey for coordination. Both refusals were correct at the
time, and both were conditioned on a workload that did not yet exist.

ADR-0004 said, in its own words, to add a Droplet only after a documented long-running workload
requires it, and to add Valkey only when Postgres, Queues, and Durable Objects cannot handle the load,
for example when presence write/read volume makes Postgres the bottleneck, or when distributed rate
limiting and locks become central. Those were the revisit triggers.

Queen now has exactly that workload. ADR-0009 commits Queen to observing CLI and model-gateway usage
streams across the fleet and reporting coarse usage facts continuously. Combined with presence
heartbeats (PRD-007), that is high-frequency ingestion with real fan-in: many agents on many machines
reporting usage and presence events at a steady rate. This is the proven need ADR-0004 said to wait
for. It is here.

So this ADR reverses ADR-0004's runtime-topology decision. It does not reverse ADR-0004's data
boundary, which still holds: Postgres stores coordination state and coarse usage facts, never memory
content. It reverses the specific choices ADR-0004 made about where compute runs (Workers-as-API, no
Droplet) and about hot state (no Valkey). Queen adopts droplets and Valkey from day one because the
workload that justified them now exists. The stack languages themselves are fixed in ADR-0007 (Go
backend, SvelteKit frontend); this ADR places that stack on real infrastructure.

Legion already operates this shape in ospry: a Cloudflare Queue buffer feeding a droplet stream
consumer. Queen mirrors that proven topology rather than inventing a new one.

#### Decision drivers

- **The high-frequency ingestion workload ADR-0004 deferred now exists.** Usage-stream and presence
  ingestion is exactly the profile ADR-0004 named as the trigger for droplets and Valkey.
- **Keep validation, tenancy, and data-shaping in one testable Go codebase.** ADR-0007 chose Go for
  its concurrency and small footprint. Ingestion business logic should live in that Go codebase, not
  be duplicated into Worker JS.
- **Absorb spikes at the edge, process in the core.** Edge Workers validate and enqueue fast; a
  droplet consumer tier does the real work at its own pace. The queue is the shock absorber.
- **Hot state needs a hot store.** Presence, idempotency/dedup keys, and rate limiting are
  high-frequency ephemeral state. That is Valkey's job, and it is the "need" ADR-0004 explicitly
  deferred.
- **Preserve the Postgres data boundary from ADR-0004.** Postgres stays the system of record for
  coordination and the usage/ROI ledger; it never holds memory content.
- **Mirror what Legion already runs.** The ospry topology (CF Queue buffer to droplet stream consumer)
  is proven in production. Reuse it.
- **Slim on dependencies and boring to operate.** Prefer managed services and a small, static Go
  binary (ADR-0007). Every tool in the stack earns its place.

#### Considered options

##### Option A, Keep ADR-0004's topology unchanged (Workers-as-API, no Droplet, no Valkey)

Serve the API and process ingestion from Workers, keep all durable state in Postgres, add no Valkey.

This was right for a coordination-only control plane and is wrong for Queen's ingestion workload. It
forces the validation, tenancy, and data-shaping logic into Worker JS, splitting it from the Go
backend ADR-0007 chose, and it leans on Postgres for hot presence, dedup, and rate-limit state that is
the wrong profile for a relational source of truth. ADR-0004 itself named these as the conditions to
revisit under. Rejected; superseded by this ADR.

##### Option B, CF Queue consumer Workers writing Postgres directly via Hyperdrive

Keep Cloudflare Queues as the buffer, but have Cloudflare Queue consumer Workers pull from the queue
and write to Postgres directly through Hyperdrive. No droplet consumer tier.

This is the closest alternative and it is genuinely tempting: it stays mostly serverless and avoids a
droplet tier. It is rejected for the MVP for two concrete reasons. First, it scatters business logic
into Workers: the validation, tenancy checks, and batch-upsert shaping would live in Worker JS,
duplicating or splitting from the Go backend and violating the "one testable Go codebase" driver.
Second, it complicates local testing: exercising the full ingestion path means running the Worker
runtime and its queue bindings, which is a heavier and less faithful local loop than running a Go
consumer against a local queue and Postgres. It remains a reasonable future option if the sidecar tier
proves unnecessary; that is the revisit trigger.

##### Option C, Edge Worker to CF Queue to Go sidecar consumer to Postgres, with Valkey hot state (CHOSEN)

Edge Workers validate and enqueue usage/presence events to Cloudflare Queues fast. A Go sidecar
consumer running on dedicated ingestion droplets pulls from the queue (HTTP pull consumer), applies
all validation, tenancy, and shaping in Go, and batch-upserts to Postgres through Hyperdrive. Valkey
holds hot presence, idempotency/dedup keys, and rate-limit counters. This mirrors the ospry topology
Legion already runs.

#### Decision

Adopt **Option C**. Queen's cloud infrastructure and ingestion path is:

**Cloudflare (edge and buffer):**

- **Workers + Queues:** the ingestion edge and buffer. Edge Workers validate and enqueue
  usage/presence events to Cloudflare Queues fast, absorbing spikes. Workers are the edge, not the
  API.
- **Hyperdrive:** Postgres connection pooling and caching for any Worker or service that reaches
  Postgres.
- **Load Balancer:** fronts the frontend and backend droplet pairs for reliability.
- **R2:** object storage for exports, artifacts, and large payloads.

**DigitalOcean (core):**

- **Managed Postgres:** the system of record for the control plane, identity, devices, fleets,
  enrollment, presence snapshots, leases, encrypted blob metadata, and the usage/ROI ledger rows.
  Never memory content.
- **Managed Valkey:** hot state for presence, idempotency/dedup keys, and rate limiting. This is the
  documented need ADR-0004 deferred, now realized.
- **2x app droplets:** the frontend/backend Go + SvelteKit app tier (ADR-0007), load-balanced by
  Cloudflare.
- **2x ingestion-sidecar droplets:** the Go consumer tier, load-balanced by Cloudflare.

**Ingestion path (the decision):** edge Worker validates and enqueues to a Cloudflare Queue; a Go
sidecar consumer on the ingestion droplets pulls from the queue over HTTP (pull consumer); the
consumer applies validation, tenancy, and data shaping in Go and batch-upserts to Postgres via
Hyperdrive; Valkey serves as the hot presence, dedup, and rate-limit store. Rationale: keep all
validation, tenancy, and data-shaping logic in one testable Go codebase (ADR-0007) instead of
duplicating it into Worker JS. This mirrors the ospry topology Legion already operates (CF Queue
buffer to droplet stream consumer).

**Cross-cutting tooling:**

- **Doppler:** secrets management, a new Doppler project per Queen environment.
- **WorkOS:** authentication for the cloud app, a new WorkOS project. Org/workspace/team model and the
  admin entitlement that fences the ROI cross-org read (PRD-003, PRD-009).
- **Terraform Cloud:** all infrastructure as code, a new project, modeled on the ospry `infra/`
  Terraform layout.
- **PostHog:** product analytics and logging.
- **Sentry:** error reporting.

**This ADR supersedes ADR-0004's runtime-topology decision.** ADR-0004 chose Workers-as-API with no
Droplet and no Valkey, correct for a coordination-only MVP and conditioned on a workload that did not
yet exist. Queen reverses that specific runtime choice because the high-frequency usage/presence
ingestion workload ADR-0004 said to wait for now exists (ADR-0009). ADR-0004's **data boundary**
(Postgres holds coordination state and coarse facts, never memory content) is **not** superseded and
carries forward unchanged. ADR-0004's Status is updated to `Superseded by ADR-0010`, scoped to the
runtime-topology decision.

#### Ingestion topology

```mermaid
flowchart LR
    subgraph Fleet["Enrolled machines"]
        A["Local Queen agents\n(usage + presence events)"]
    end
    subgraph CF["Cloudflare (edge + buffer)"]
        W["Edge Workers\nvalidate + enqueue"]
        Q["Cloudflare Queues\nbuffer / shock absorber"]
        HD["Hyperdrive"]
        LB["Load Balancer"]
        R2[("R2 object storage")]
    end
    subgraph DO["DigitalOcean (core)"]
        ING["2x ingestion-sidecar droplets\nGo pull consumer\nvalidate, tenancy, shape, batch-upsert"]
        APP["2x app droplets\nGo backend + SvelteKit"]
        VK[("Managed Valkey\npresence, dedup, rate-limit")]
        PG[("Managed Postgres\ncontrol plane + usage/ROI ledger,\nnever memory content")]
    end

    A --> W
    W --> Q
    Q -- "HTTP pull" --> ING
    ING --> VK
    ING --> HD
    HD --> PG
    LB --> APP
    APP --> HD
    APP --> VK
    APP --> R2
```

#### The ROI/usage ledger lives in Queen

An inherited cross-repo dependency needs an explicit answer. Inherited PRD-009 (hosted ROI, formerly
honeycomb 061) depended on honeycomb's PRD-060f shared-spend ledger (`roi_metrics` and `teams` tables)
and a per-user backend identity claim, neither of which moved to Queen.

Decision: **Queen owns the ROI/usage ledger going forward**, in its own Postgres control plane, fed by
the usage-stream ingestion pipeline (PRD-005/PRD-006 through this ADR's path). PRD-009 reads Queen's
ledger, not honeycomb's. ROI moved to Queen, so the ledger moves with it. The ingestion path defined
here is what writes the ledger rows; the hosted ROI admin surface reads them and never writes a spend
row (per the README's read-only ROI contract).

#### Consequences

**Positive**

- The high-frequency ingestion workload has a real home: edge to absorb spikes, a Go consumer tier to
  do the work, and Valkey for hot state.
- All ingestion business logic lives in one Go codebase (ADR-0007), so validation, tenancy, and
  shaping are testable locally without a Worker runtime.
- The topology mirrors ospry, which Legion already runs in production, so operational patterns and
  Terraform layout carry over.
- Postgres stays the system of record and the ROI ledger owner, with ADR-0004's content boundary
  intact.
- Valkey removes presence, dedup, and rate-limit pressure from Postgres, which is the exact
  bottleneck ADR-0004 predicted.

**Negative / accepted**

- Queen now runs always-on droplet tiers (app and ingestion), with the patching, supervision,
  scaling, and deployment work ADR-0004 deliberately avoided. This is the cost of the workload, and it
  is accepted.
- Valkey is a new network, auth, backup, monitoring, and failure mode, exactly the cost ADR-0004
  flagged. It is accepted now that the need is real.
- The stack has more moving parts (Workers, Queues, Hyperdrive, R2, Load Balancer, Postgres, Valkey,
  four droplets, plus Doppler, WorkOS, Terraform Cloud, PostHog, Sentry). The slim-dependency mandate
  (ADR-0007) applies to code, not to this deliberately chosen managed-service footprint, but each
  service must still earn its place, and they do.
- The ingestion path is a distributed pipeline (edge, queue, consumer, two stores), so idempotency and
  dedup are correctness requirements, not niceties. Valkey dedup keys carry that weight.

#### Required invariants

- Edge Workers only validate and enqueue; they are not the control-plane API.
- All ingestion validation, tenancy, and data-shaping logic lives in the Go sidecar consumer, not in
  Worker JS.
- Postgres is the system of record and the ROI/usage ledger owner; it never holds memory content
  (ADR-0004 boundary preserved).
- Valkey holds only hot ephemeral state: presence, idempotency/dedup keys, and rate-limit counters.
- Ingestion is idempotent: duplicate events are deduped (Valkey keys) so ledger and presence rows are
  not double-counted.
- All infrastructure is defined in Terraform Cloud; secrets come from Doppler; no secret is hardcoded.
- The hosted ROI admin surface reads the Queen ledger and never writes a spend row.

#### Revisit triggers

Re-open this decision if any of these become true:

1. The Go sidecar consumer tier proves unnecessary and a CF Queue consumer Worker writing Postgres
   directly (Option B) would be simpler without scattering business logic. Then reconsider Option B.
2. Ingestion volume outgrows two ingestion droplets and the tier needs autoscaling or a different
   consumer runtime.
3. Valkey proves insufficient or overkill for the hot-state workload and Postgres or a different store
   fits better.
4. A managed service in the cross-cutting set (Doppler, WorkOS, PostHog, Sentry) fails to earn its
   place operationally or on cost.
5. The ospry topology this mirrors changes in a way that Queen should follow.

#### Escalation note

This ADR defines the ingestion pipeline, the Postgres boundary carry-forward, secrets handling
(Doppler), and auth (WorkOS). The tenancy enforcement on the ingestion path, the dedup/idempotency
correctness, and the separation of the ROI ledger from any content should be reviewed by security
before implementation. Surface it to security-worker-bee.

#### Links

- ADR-0004 (superseded, runtime topology): `library/knowledge/private/architecture/ADR-0004-honeycomb-control-plane-and-postgres-boundary.md`
- ADR-0006: `library/knowledge/private/architecture/ADR-0006-two-application-topology.md`
- ADR-0007: `library/knowledge/private/architecture/ADR-0007-stack-selection.md`
- ADR-0008: `library/knowledge/private/architecture/ADR-0008-cloud-binding-and-license-enforcement.md`
- ADR-0009: `library/knowledge/private/architecture/ADR-0009-usage-stream-observation-scope.md`
- PRD-002: `library/requirements/backlog/prd-002-cloud-control-plane-foundation/prd-002-cloud-control-plane-foundation-index.md`
- PRD-006: `library/requirements/backlog/prd-006-cloud-ingestion-pipeline/prd-006-cloud-ingestion-pipeline-index.md`
- PRD-010: `library/requirements/backlog/prd-010-infrastructure-as-code/prd-010-infrastructure-as-code-index.md`
- PRD-011: `library/requirements/backlog/prd-011-observability-analytics-and-error-reporting/prd-011-observability-analytics-and-error-reporting-index.md`
- Cloudflare Hyperdrive: `https://developers.cloudflare.com/hyperdrive/`
- Cloudflare Queues: `https://developers.cloudflare.com/queues/`
- DigitalOcean managed databases: `https://docs.digitalocean.com/products/databases/`
