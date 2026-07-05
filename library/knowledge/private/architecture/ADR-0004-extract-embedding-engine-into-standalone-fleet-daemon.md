# ADR-0004, extract the embedding engine into a standalone fleet-shared daemon supervised by doctor

> **Status:** Proposed · **Date:** 2026-07-05
> **Supersedes:** none · **Refines:** [`../../../../nectar/library/knowledge/private/architecture/ADR-0002-nectar-independent-daemon-supervised-by-doctor.md`](../../../../nectar/library/knowledge/private/architecture/ADR-0002-nectar-independent-daemon-supervised-by-doctor.md) (which already frames the embedding provider stack as "shared infrastructure Nectar consumes"), [`ADR-0003-fleet-directory-ownership-and-neutral-state-root.md`](./ADR-0003-fleet-directory-ownership-and-neutral-state-root.md) (the per-product-subdir state layout a new product slots into)
> **Owners:** platform, honeycomb, nectar, doctor
> **Related:** [`../../../../nectar/library/knowledge/private/architecture/ADR-0003-three-daemon-topology-and-hive-portal.md`](../../../../nectar/library/knowledge/private/architecture/ADR-0003-three-daemon-topology-and-hive-portal.md) (the doctor-registry-and-portal topology a new daemon registers into), Fleet v0.6.11 (the `resolveEmbedEntry` spawn-path fix that is a forcing function below)

## Context

The Apiary runs a coordinated local fleet on fixed ports: honeycomb `:3850`, the **embed daemon `:3851`**, doctor `:3852`, hive `:3853`, nectar `:3854` (`honeycomb/src/shared/constants.ts` — the port block declares `:3851` fleet-reserved). The embedding engine is already, in every meaningful respect, a **standalone daemon** — but it is *owned* by honeycomb as a private child process, and that ownership is the problem this ADR addresses.

### What the engine already is

- **A self-contained HTTP daemon.** `honeycomb/embeddings/src/index.ts` (433 lines) is an independent `node:http` server serving `POST /embed { text } -> { vector }` and `GET /health` on `127.0.0.1:3851`. It loads `nomic-embed-text-v1.5` (768-dim, q8) via a *dynamic* import of `@huggingface/transformers`. Its **only** source coupling to honeycomb is a single import of `HONEYCOMB_VERSION`.
- **Built as its own artifact.** `honeycomb/esbuild.config.mjs` emits `embed-daemon` as a **separate bundle** with its own external list (`entryPoints: { "embed-daemon": "dist/embeddings/src/index.js" }`, `outdir: "embeddings"`), distinct from the main daemon, MCP, harness, and CLI bundles.

### What honeycomb *owns* today (the coupling)

- **Lifecycle.** honeycomb spawns and supervises the child: `honeycomb/src/daemon/runtime/services/embed-supervisor.ts` (spawn, liveness/warm probing, bounded crash-restart, the dashboard on/off toggle).
- **Weight.** `@huggingface/transformers` (`^3.8.1`) is a **honeycomb `optionalDependency`** — the single heaviest item in a honeycomb install (~600 MB with the ONNX runtime), plus the `scripts/ensure-embed-deps.mjs` postinstall. This is the bulk of what makes honeycomb feel "bloated"; the engine *code* is tiny.
- **Consumption.** honeycomb dials it via `honeycomb/src/daemon/runtime/services/embed-client.ts` (`DEFAULT_EMBED_URL = http://127.0.0.1:3851`).

### The load-bearing fact: nectar already depends on honeycomb's child

nectar has its **own** embeddings subsystem (`nectar/src/embeddings/`), and its default `local` provider **connects to the same `:3851`** — it spawns nothing and ships no embed bundle:

- `nectar/src/embeddings/local-nomic.ts`: `DEFAULT_LOCAL_EMBED_PORT = 3851`, and the file's own header says nectar "reaches it over the network through its OWN transport." nectar has no `embeddings/` bundle directory and no `spawn` of an embed child anywhere.
- `nectar/src/embeddings/config.ts`: the default provider is `local` (the zero-marginal-cost nomic daemon); `hosted` (embeddings via Portkey) is an operator opt-in.

So today nectar's **local semantic capability is silently hostage to honeycomb being up.** If honeycomb is stopped or uninstalled, nectar's `local` provider has nothing to dial and degrades to lexical (or to a keyed `hosted` Portkey path). This directly contradicts nectar ADR-0002's independence claim ("Nectar runs with or without the rest of Honeycomb") and its own statement that the "embedding provider stack ... [is] shared infrastructure Nectar consumes." The engine is architecturally shared, but operationally it is one workload's private child.

doctor does not model `:3851` as a first-class product either: `doctor/src/health-probe.ts` reads the embed state *secondhand* from honeycomb's `/health` `reasons.embeddings`, rather than probing or supervising `:3851` directly.

### Forcing functions

1. **Cross-package spawn fragility (Fleet v0.6.11).** The embeddings toggle "did nothing" because `resolveEmbedEntry` in `embed-supervisor.ts` walked five parent directories to reach `embeddings/embed-daemon.js` — correct for the dev layout, but in the shipped bundle (supervisor inlined into `daemon/index.js`) it resolved *outside* the package, so the child never spawned. That entire bug class exists **only because one package supervises another package's bundled binary across a path boundary.** A standalone product with a normal entry point cannot hit it.
2. **honeycomb bloat.** The `@huggingface/transformers` optionalDep + ONNX runtime is honeycomb's dominant install cost. It does not belong to honeycomb's core job (session capture + recall serving).
3. **nectar independence gap.** nectar ADR-0002 asserts standalone operability; the shared engine's honeycomb ownership quietly undermines it.

## Decision

**Extract the embedding engine into a standalone fleet product — a doctor-supervised daemon on `:3851`, owned by neither honeycomb nor nectar — and reduce honeycomb and nectar to thin clients of it.**

This is the direct application of nectar ADR-0002's pattern ("independent process, same data/infra layer; supervised by doctor; registered in doctor's registry; surfaced through hive") to the embedding engine.

### Shape

- **A new package** (working name `@legioncodeinc/embed`; final name is an open question) that owns: the engine (moved verbatim from `honeycomb/embeddings/`), the supervisor logic (moved from `honeycomb/src/daemon/runtime/services/embed-supervisor.ts`), the `@huggingface/transformers` optionalDependency, the `ensure-embed-deps` postinstall, and the model cache (`~/.apiary/embed/…` per ADR-0003's per-product-subdir layout, replacing `~/.honeycomb/embed-models`).
- **Port `:3851` is unchanged** (already fleet-reserved), so both existing clients keep working with no URL change.
- **doctor supervises it** like every other daemon — start, restart-on-crash, `/health` probe, graceful shutdown — and registers it in `~/.apiary/registry.json`. doctor's health page gains a real `:3851` entry instead of honeycomb's secondhand reason.
- **honeycomb and nectar keep only their clients.** `honeycomb/src/daemon/runtime/services/embed-client.ts` and `nectar/src/embeddings/local-nomic.ts` are unchanged in spirit — they already just POST to `:3851`. honeycomb stops spawning/supervising and stops shipping transformers; its `/health` embeddings reason becomes a *probe* of `:3851`, not ownership of a child.
- **One model in memory serves both.** A single ~600 MB warm process answers honeycomb recall and nectar brooding alike — the design both clients already assume.

### Independence is at the process layer only (unchanged data/infra contracts)

Exactly as in nectar ADR-0002: nothing about the *data* layer changes. Both consumers still write 768-dim `FLOAT4[]` vectors into the same Deep Lake tables under the same tenancy; the `hosted`-via-Portkey alternative for embeddings is untouched; the dim-must-match-schema invariant (`EMBEDDING_DIMS = 768`) still holds. This ADR moves *who runs the local engine*, not *what it produces*.

## Consequences

**Positive.**

- **True nectar independence.** nectar's `local` provider dials a fleet-shared daemon that neither it nor honeycomb owns, so nectar's semantic capability no longer requires honeycomb to be installed — making nectar ADR-0002's claim true on the process graph, not just in prose.
- **honeycomb slims materially.** The ~600 MB `@huggingface/transformers` optionalDep and the `ensure-embed-deps` postinstall leave honeycomb entirely. honeycomb's install footprint drops to its core.
- **The cross-package spawn bug class disappears.** A standalone daemon has a normal entry point; there is no other package walking a path to its bundled binary. The v0.6.11 `resolveEmbedEntry` failure mode becomes structurally impossible.
- **Honest supervision.** doctor supervises and health-probes `:3851` as a first-class product, consistent with the ADR-0003 registry contract, instead of honeycomb owning a child whose failures doctor only learns about secondhand.
- **Shared cost, not duplicated cost.** One warm model process serves the whole fleet.

**Negative.**

- **A new fleet product to stand up.** A package = its own build, install path, doctor registration, release pipeline, `hive-release.json` entry, and version. This is the real cost, and it is why this is an ADR, not a sub-PRD. (The *engine* move is trivial; the *product* plumbing is the work — roughly the scope of standing up any fleet peer, mirroring how nectar and doctor are structured.)
- **Enable-state ownership must be redesigned.** Today honeycomb persists `embeddings.enabled` and its supervisor actuates it (the dashboard toggle). With a shared daemon, "embeddings on/off" is a **fleet setting**, not a honeycomb one — its owner (doctor? a fleet vault key? the embed daemon itself?) and how the hive toggle actuates it (via doctor? a direct `:3851` action?) are open questions to resolve before implementation.
- **A migration window.** honeycomb must stop spawning the child in the same release the new daemon starts being spawned by doctor, or the fleet either double-spawns `:3851` (port conflict) or spawns nothing. The cutover needs the same care as the ADR-0003 registry migration.
- **Model-cache relocation.** The cache moves from `~/.honeycomb/embed-models` to the per-product `~/.apiary/embed/…`; a one-time migration (or a one-time re-download) is needed so users are not surprised by a second ~600 MB fetch.

**Reversibility.** Moderate. Re-absorbing the engine back into honeycomb is possible (the data layer is unaffected, mirroring nectar ADR-0002's reversibility note), but reverting re-introduces the honeycomb-owns-a-shared-resource coupling and the cross-package spawn fragility this ADR exists to remove. The forward cutover (doctor spawns, honeycomb stops) is the safe direction; the backward one is deliberately not designed for.

## Alternatives considered and rejected

### A. Status quo — honeycomb owns and supervises the `:3851` child (REJECTED)

Leave the engine as honeycomb's private child. Rejected on all three forcing functions: nectar stays hostage to honeycomb, honeycomb keeps carrying the ~600 MB inference stack it does not need for its core job, and the cross-package spawn fragility (v0.6.11) remains latent. It is the zero-cost option and the one this ADR exists to end.

### B. One standalone daemon supervised by doctor, shared by all consumers (CHOSEN)

A fleet-shared embed daemon on `:3851`, owned by neither workload. Both consumers already point here; one warm model serves both. Chosen for the reasons in Decision/Consequences.

### C. Per-product embed daemons (honeycomb and nectar each spawn their own) (REJECTED)

Give each consumer its own embed child so nectar is fully self-sufficient. Rejected because it means **two copies of the identical ~600 MB model resident in RAM and two model downloads** of the same `nomic-embed-text-v1.5`, for no benefit — both consumers target the same model on the same reserved port. The independence goal ("nectar operates on its own") is fully satisfied by Option B's *shared, unowned* daemon without paying twice for the model. Per-product isolation would only be justified by a hard requirement to run nectar with no shared services at all, which nothing in the current design demands.

### D. Drop the local engine; route all embeddings through hosted Portkey (REJECTED)

Delete `:3851` entirely and make every embedding a `hosted`-via-Portkey call. Rejected because it discards the zero-marginal-cost, offline, no-API-key **local default** that nectar ADR-0002 and the embeddings config treat as the baseline (`DEFAULT_EMBED_PROVIDER = local`), adds a hard Portkey dependency and per-call cost to a hot path, and would regress every user who runs the fleet without a keyed gateway. The `hosted` path should remain the *opt-in alternative* it already is, not the only option.

## Open questions (to resolve at PRD time)

1. **Name.** `@legioncodeinc/embed`? A bee-family name (e.g. "pollen")? This affects the package, the `~/.apiary/<name>/` state dir, and the doctor registry entry.
2. **Enable-state ownership.** Where does `embeddings.enabled` live once it is fleet-shared, and how does the hive toggle actuate a daemon neither honeycomb nor hive owns?
3. **Who spawns during the cutover.** doctor as supervisor is the natural owner; confirm the installer + registry sequence so `:3851` is spawned exactly once across the migration window.
4. **honeycomb `/health` after extraction.** Keep an `embeddings`/`embeddingsState` reason by *probing* `:3851` (so the dashboard strip still shows semantic health), rather than deriving it from an owned supervisor. This is a small client change to the honesty work shipped in v0.6.11.
5. **Model-cache migration** from `~/.honeycomb/embed-models` to `~/.apiary/embed/…` (move vs. re-download).

## References

- `honeycomb/embeddings/src/index.ts` — the 433-line standalone embed daemon (`:3851`, nomic-embed-text-v1.5, only imports `node:http` + `HONEYCOMB_VERSION`); the artifact this ADR relocates into its own package.
- `honeycomb/esbuild.config.mjs:341-352` — the embed daemon is already built as its own bundle with its own external list.
- `honeycomb/src/daemon/runtime/services/embed-supervisor.ts` — the honeycomb-owned lifecycle (spawn/warm/restart/toggle) that moves to the new daemon; the site of the v0.6.11 `resolveEmbedEntry` cross-package spawn bug.
- `honeycomb/src/daemon/runtime/services/embed-client.ts` — honeycomb's thin client (`DEFAULT_EMBED_URL = http://127.0.0.1:3851`); stays, unchanged in spirit.
- `honeycomb/package.json` — `@huggingface/transformers` as a honeycomb `optionalDependency` (the ~600 MB bloat that leaves honeycomb), plus `scripts/ensure-embed-deps.mjs`.
- `nectar/src/embeddings/local-nomic.ts` — nectar's `local` provider defaults to `:3851` and only *connects* (no spawn, no bundle): the proof nectar already depends on honeycomb's child.
- `nectar/src/embeddings/config.ts` / `provider.ts` — nectar's `off | local | hosted` selector; `local` is the default, `hosted` (Portkey) the opt-in — both unchanged by this ADR.
- `doctor/src/health-probe.ts` — doctor reads the embed state secondhand from honeycomb's `/health` today; gains a first-class `:3851` probe under this ADR.
- `honeycomb/src/shared/constants.ts` — the fleet port block reserving `:3851`.
- [`../../../../nectar/library/knowledge/private/architecture/ADR-0002-nectar-independent-daemon-supervised-by-doctor.md`](../../../../nectar/library/knowledge/private/architecture/ADR-0002-nectar-independent-daemon-supervised-by-doctor.md) — the "independent daemon supervised by doctor, shared data/infra layer" pattern this ADR applies to the embed engine; already names the embedding stack as shared infrastructure.
- [`ADR-0003-fleet-directory-ownership-and-neutral-state-root.md`](./ADR-0003-fleet-directory-ownership-and-neutral-state-root.md) — the `~/.apiary/<product>/` per-product state layout the new daemon's cache/state adopts.
