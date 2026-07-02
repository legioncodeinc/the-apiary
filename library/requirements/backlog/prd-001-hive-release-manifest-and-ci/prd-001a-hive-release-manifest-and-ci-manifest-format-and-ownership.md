# PRD-001a: Hive Release Manifest, Format and Ownership

> **Parent:** [PRD-001](./prd-001-hive-release-manifest-and-ci-index.md)
> **Status:** Backlog
> **Priority:** P0
> **Effort:** L (1-3d)
> **Schema changes:** None to any DeepLake catalog. Introduces one new source-controlled manifest file in the superproject.

---

## Overview

This sub-PRD defines the hive release manifest itself: what it is, where it lives, what it contains, who owns it, and how it is versioned. The manifest is the single source of truth for "what ships together" per [`ADR-0001`](../../../knowledge/private/architecture/ADR-0001-hive-release-manifest-and-combined-release-train.md). It pins one compatible set of the four submodule versions and carries its own manifest version. Everything downstream (the release-train CI in 001b, the installer's version resolution) reads this file.

The manifest is a *pinning* artifact, not a build output. It names the exact `honeycomb`, `hivedoctor`, `the-hive`, and `hivenectar` versions that constitute a tested fleet release; it never rebuilds or repackages those products.

## Goals

- Define a single versioned manifest file at the superproject root (working name `hive-release.json`) with a stable, documented schema.
- Pin exactly one explicit published version per product for all four products, plus a top-level manifest version.
- Establish ownership: the superproject owns the manifest; a fleet release is the deliberate act of choosing and pinning a compatible set.
- Make the manifest machine-readable for CI validation (001b) and for installer resolution (PRD-002), with a shape that a future licensing/product-code layer can extend without a breaking rewrite.

## Non-Goals

- The CI that validates or produces the manifest (that is 001b).
- The publish pipelines that make the-hive and hivenectar pinnable (that is 001c).
- Product selection or configuration semantics (that is PRD-002).

## Acceptance criteria

| ID | Criterion |
|---|---|
| a-AC-1 | The manifest is a single source-controlled file at the superproject root with a documented schema and a top-level manifest version field. |
| a-AC-2 | The manifest pins an explicit, published version string for each of the four products (`honeycomb`, `hivedoctor`, `the-hive`, `hivenectar`); a missing or empty pin is invalid by construction. |
| a-AC-3 | The schema is documented well enough that CI (001b) and the installer (PRD-002) can parse it without guessing, and the doc states which fields are required vs optional. |
| a-AC-4 | The schema reserves room for future per-product metadata (for example integrity hash or minimum runtime) without changing the meaning of the required version pins. |

## Implementation notes

- **Location and name.** Superproject root, working name `hive-release.json`. Resolve the final name in the open question below; keep it discoverable and unambiguous relative to any submodule's own `package.json`.
- **Shape.** A top-level `manifestVersion` plus a `products` map keyed by product slug (`honeycomb`, `hivedoctor`, `thehive`, `hivenectar`) to a pinned semver string. Prefer product slugs that match the installer's `--products=` tokens in PRD-002 so selection maps to a pin with no translation table.
- **Ownership.** The manifest is authored/updated only as part of promoting a fleet release; it is not edited casually. 001b's release train is the mechanism that produces or validates it.
- **Additive extensibility.** Any future fields (licensing hints, per-product config defaults) are additive and optional so old parsers keep working; the required pins never change shape.

## Open questions

- [ ] Final file name and format: `hive-release.json` at root vs a `manifest/hive-release.json`; JSON vs a format that carries comments and richer metadata.
- [ ] Are versions authored by hand into the manifest, or derived from the submodule pointers on the superproject release commit? (Interacts with 001b.)
- [ ] Do product keys use the bare slug (`thehive`) or the npm package name (`@legioncodeinc/honeycomb`)? Slug is friendlier to `--products=`; package name is unambiguous for `npm i`.

## Related

- [`ADR-0001`](../../../knowledge/private/architecture/ADR-0001-hive-release-manifest-and-combined-release-train.md) - the manifest decision.
- [PRD-001b](./prd-001b-hive-release-manifest-and-ci-superproject-release-ci.md) - the CI that validates and produces this manifest.
- [PRD-002a](../prd-002-installer-product-loading-and-phone-home/prd-002a-installer-product-loading-and-phone-home-product-loading.md) - the `--products=` tokens this schema should align with.
