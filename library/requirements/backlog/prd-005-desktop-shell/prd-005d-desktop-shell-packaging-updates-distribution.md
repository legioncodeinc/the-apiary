# PRD-005d: Packaging, Updates, and Distribution

> **Parent:** [PRD-005](./prd-005-desktop-shell-index.md)
> **Status:** Backlog
> **Priority:** P1 (there is no shippable app without this; the signing sub-track is separately gated on certs)
> **Effort:** L (1-3d for the pipeline; the signing track is calendar-gated on certificate procurement)
> **Schema changes:** None. Adds installers, an update feed, and a bundled Node sidecar to the packaged app.

---

## Overview

This sub-PRD turns the shell into installable, updatable artifacts. It owns electron-builder packaging for the three OSes, the placement of the heavy/optional pieces (the ~600 MB embeddings runtime, the bundled Node sidecar, native/WASM artifacts) relative to the `.asar`, electron-updater wiring, and the signing/notarization tracks — with an explicit unsigned path since no EV cert exists today.

The load-bearing packaging decision, per product direction: **the embeddings model is packed into the desktop app, not downloaded on first run.** In the npm-package world the model is an optional first-run download with a BM25 fallback to keep the tarball lean ([`honeycomb/package.json`](../../../../honeycomb/package.json)); for the desktop product that is the wrong trade — the semantic-recall features are the point and are useless (or quietly degraded to BM25) without the model, and a ~600 MB first-run download is a poor first impression. So the desktop installer ships the model **and** the native ONNX runtime, asar-unpacked, and is large by design (hundreds of MB). BM25 stays only as a safety net. The ABI-sensitive part is not the model file but the ONNX native runtime — each OS/arch build must carry the matching binary. Tree-sitter is WASM (no native ABI) and packs cleanly. (The npm-package distribution's download-on-first-run behavior is unchanged; only the desktop build packs.)

The shell consumes the four submodules' built outputs (`dist`/`bundle`, or published npm tarballs), not their source, and ties into the existing version orchestration ([`hive-release.json`](../../../../hive-release.json), [`scripts/`](../../../../scripts/)).

## Goals

- electron-builder produces installable artifacts for macOS, Windows, and Linux from the four submodules' built bundles.
- An unsigned build installs and runs (with the known OS trust warnings); packaging is structured so adding signing/notarization is config, not re-architecture.
- The embeddings model + native ONNX runtime are packed into the app (asar-unpacked) so semantic recall works on first launch with no download; BM25 remains only as a safety net.
- Native/WASM artifacts and the Node sidecar are placed correctly relative to asar (unpacked where they must be executable/loadable).
- electron-updater delivers updates where signing permits; where it does not, the app degrades to a clear "update available — download" prompt.
- Update artifacts are integrity-checked (signature where present; checksum at minimum).
- The build consumes the submodules' published/built outputs and respects the pinned fleet versions.

## Non-Goals

- Procuring the Apple Developer ID / Windows OV/EV certificate (a business action; this specifies the packaging that uses them).
- Mac App Store / Microsoft Store submission.
- The supervisor (005a), window (005b), and native integration (005c) themselves — this packages what they produce.
- CI topology beyond the desktop build/publish job (defer to the existing release workflows where possible).

## Acceptance criteria

| ID | Criterion |
|---|---|
| d-AC-1 | electron-builder produces installable artifacts for macOS, Windows, and Linux from the four submodules' built bundles (parent AC-9). |
| d-AC-2 | An unsigned build installs and launches on each OS (accepting the documented Gatekeeper/SmartScreen warnings); the app is fully functional once past them (parent AC-9). |
| d-AC-3 | The embeddings model and its native ONNX runtime are present in the packaged installer and load with no network access; semantic recall works on a freshly installed, offline machine from the first query; the BM25 fallback remains available but is not the shipped default (parent AC-7). |
| d-AC-4 | Native/WASM artifacts and the bundled Node ≥22.5 sidecar are placed so they load/execute correctly (asar-unpacked where required); the sidecar runs the daemons per 005a on a clean install (parent AC-3). |
| d-AC-5 | electron-updater is wired and functional on a signed build; on an unsigned/unsupported build the app shows a clear manual-update prompt instead of a broken silent-update path (parent AC-10). |
| d-AC-6 | Update artifacts are integrity-verified before apply (signature where signing exists; checksum otherwise), consistent with the installer's "inspect before you pipe" posture (parent security). |
| d-AC-7 | The packaging config is structured so that supplying an Apple Developer ID and a Windows cert enables signing + notarization + hardened auto-update without re-architecting the build (parent AC-9). |
| d-AC-8 | The build consumes the submodules' built outputs and respects the pinned fleet versions from the release manifest; a version mismatch fails the build rather than shipping a skewed fleet. |

## Implementation notes

- **asar + unpack.** App code in `.asar`; `asarUnpack` for anything that must be a real file on disk: the Node sidecar binary, the native ONNX `.node` runtime, the embeddings model weights, any other `.node`/native artifact, and the daemon entrypoints the sidecar executes.
- **Model pre-fetch at build time.** The model is acquired at first-run today; to pack it, the build pre-downloads nomic-embed-text-v1.5 (768-dim, q8) into the app resources so no runtime fetch occurs. Pin the exact model revision so builds are reproducible and an offline install works.
- **Per-arch ONNX runtime.** `@huggingface/transformers` pulls a native ONNX runtime with platform/arch-specific binaries; each OS/arch target must bundle the matching binary (this, not the model file, is the ABI-sensitive part). Verify recall runs on a clean, offline VM per target.
- **Model license.** Confirm the model license permits redistribution in a bundled installer (nomic-embed-text-v1.5 is Apache-2.0, which does); record the confirmation + required attribution.
- **BM25 stays as a safety net.** Packing does not remove the lexical fallback; keep it for the pre-warmup window and corrupted-cache cases, but it is never the shipped default (d-AC-3).
- **Sidecar placement.** Ship the pinned Node per-OS under `resources/`, unpacked, referenced by 005a as the daemons' `execPath`. Budget the app-size impact (open question in the parent).
- **Consuming submodules.** Prefer the published `@legioncodeinc/*` tarballs (built, `files`-scoped) or each submodule's `dist`/`bundle`; do not vendor source. Pin to the manifest versions ([`hive-release.json`](../../../../hive-release.json)).
- **Signing tracks.** (macOS) Developer ID signing + `notarize` via electron-builder's afterSign; without it, document the right-click-open path and disable silent auto-update. (Windows) OV/EV cert for SmartScreen; without it, expect the reputation warning and still allow auto-update. (Linux) AppImage/deb; signing optional.
- **Update feed.** electron-updater against a release channel (GitHub Releases or a static feed). On platforms/builds without valid signing, gate the auto-apply and fall back to a "download the new version" prompt.
- **Provenance carry-over.** The fleet already publishes with npm provenance/OIDC and a public telemetry key injected at build ([`hive/esbuild.config.mjs`](../../../../hive/esbuild.config.mjs)); the desktop build adds no new embedded secret and preserves that posture.

## Open questions

- [ ] **Cert timeline.** When (if) do we acquire an Apple Developer ID and a Windows cert? Until then, the shipped story is unsigned + manual-update; is that acceptable for the initial audience?
- [ ] **Update channel.** GitHub Releases feed vs. self-hosted static feed vs. a service (e.g. Nuts/Hazel)? Bears on d-AC-5/6.
- [ ] **Sidecar Node size budget.** Full Node per OS adds tens of MB; acceptable, or pursue a smaller runtime? (Shared with 005a's sourcing question.)
- [ ] **Per-OS coverage for v1.** Ship all three OSes at once, or lead with one (macOS or Windows) to prove the pipeline?
- [ ] **Installer size + delta updates.** Packing the model pushes the installer to hundreds of MB, so electron-updater differential/blockmap updates become important — a version bump must not force a full re-download of an unchanged model. Configure delta updates for v1.
- [ ] **Model revision pinning + refresh.** Which exact nomic-embed-text-v1.5 revision ships, and how is a *model* update delivered — folded into an app update, or a separate cached download? (The weights rarely change; deltas should skip them when they don't.)
- [ ] **Optional lite variant.** Do we also offer a smaller "no-model" build (BM25-only, download-on-demand) for bandwidth-constrained users, or is packed-only the single desktop SKU? Proposed: packed-only; revisit only if size complaints surface.

## Related

- [`honeycomb/package.json`](../../../../honeycomb/package.json) — the optional embeddings runtime + `files` allowlist discipline the packaging mirrors (keep the model unpacked).
- [`ADR-0004` Extract the embedding engine into a standalone fleet daemon](../../../knowledge/private/architecture/ADR-0004-extract-embedding-engine-into-standalone-fleet-daemon.md) — the embed daemon the packaging must ship lean.
- [`hive-release.json`](../../../../hive-release.json) and [`PRD-001`](../prd-001-hive-release-manifest-and-ci/prd-001-hive-release-manifest-and-ci-index.md) — the pinned versions the build consumes.
- [`hive/esbuild.config.mjs`](../../../../hive/esbuild.config.mjs) — the build-time telemetry-key/provenance posture carried forward.
- [`prd-005a`](./prd-005a-desktop-shell-main-process-supervisor.md) — the sidecar Node this sub-PRD packages and places.
