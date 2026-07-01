# Hive Release Manifest — Schema

> Companion doc for [`hive-release.json`](./hive-release.json). Implements [PRD-001a](./library/requirements/backlog/prd-001-hive-release-manifest-and-ci/prd-001a-hive-release-manifest-and-ci-manifest-format-and-ownership.md) per [ADR-0001](./library/knowledge/private/architecture/ADR-0001-hive-release-manifest-and-combined-release-train.md).

## What this file is

`hive-release.json` is the single source of truth for "what ships together": it pins one tested, compatible set of versions across the four independently-published products in the fleet (`honeycomb`, `hivedoctor`, `the-hive`, `hivenectar`). It is a **pinning artifact**, not a build output — it never rebuilds or repackages a product. Every pinned version must already exist (or be validated to soon exist) as its own npm tarball, published by that product's own OIDC release pipeline.

- **Read by:** `.github/workflows/manifest-validate.yaml` and `.github/workflows/release-train.yaml` (this repo), and — once built — the one-line installer (PRD-002), which resolves a selected product to the manifest-pinned version instead of "latest."
- **Written by:** a human (or an agent acting on human intent) as a deliberate act of promoting a fleet release. It is not regenerated automatically from submodule pointers; see "Ownership and versioning" below.

## Top-level shape

```jsonc
{
  "manifestVersion": "0.1.0",
  "products": {
    "honeycomb": { "...": "..." },
    "hivedoctor": { "...": "..." },
    "thehive": { "...": "..." },
    "hivenectar": { "...": "..." }
  }
}
```

| Field | Type | Required | Meaning |
|---|---|---|---|
| `manifestVersion` | string (semver `x.y.z`) | **Required** | The version of this fleet release itself. Independent of every product's own version. Bump it every time the pinned set changes. |
| `products` | object | **Required** | A map keyed by product slug. Must contain **exactly** the four required keys below — no more, no fewer, in the required set. |

## Product slugs (required keys of `products`)

The four keys below are **required**. A manifest missing any one of them, or with an empty/blank pin under one of them, is invalid by construction (PRD-001a a-AC-2) and fails validation.

| Slug | Product | npm package |
|---|---|---|
| `honeycomb` | Honeycomb daemon + clients | `@legioncodeinc/honeycomb` |
| `hivedoctor` | HiveDoctor watchdog | `@legioncodeinc/hivedoctor` |
| `thehive` | The Hive portal daemon | `@legioncodeinc/thehive` |
| `hivenectar` | Hivenectar semantic memory layer | `@legioncodeinc/hivenectar` |

Slugs deliberately match (or are trivially derivable from) the installer's `--products=` tokens in PRD-002a, so product selection maps to a manifest pin with no translation table. `thehive` (no hyphen) is used, not `the-hive`, to stay a valid bare identifier.

## Per-product entry shape

Each value under `products.<slug>` is an **object**, not a bare version string. This is deliberate: PRD-001a a-AC-4 requires the schema to "reserve room for future per-product metadata ... without changing the meaning of the required version pins." Starting from an object (instead of a bare string that would need a breaking migration to an object later) means every future addition is purely additive.

```jsonc
{
  "version": "0.1.13",
  "packageName": "@legioncodeinc/honeycomb",
  "published": true
}
```

| Field | Type | Required | Meaning |
|---|---|---|---|
| `version` | string (semver `x.y.z`, no `v` prefix, no range operators) | **Required** | The exact pinned version. Empty string or missing = invalid manifest (a-AC-2). This is the only field CI and the installer treat as load-bearing today. |
| `packageName` | string | Optional (recommended) | The exact npm package name to resolve `version` against. If omitted, CI falls back to the table above. Present explicitly so a future rename doesn't require touching every consumer. |
| `published` | boolean | Optional, default `true` | Set to `false` **only** while a product genuinely has no publish pipeline yet or has never cut a real tag. When `false`, `manifest-validate.yaml` / `release-train.yaml` skip live npm-registry resolution for that product and only check internal consistency (valid semver, required fields present) — this is what lets the manifest exist and validate cleanly *before* `the-hive` and `hivenectar` have published their first real version (see PRD-001c). Flip to `true` (or remove the field) the moment a product cuts its first real tag; from then on CI enforces full registry resolution for it, same as `honeycomb`/`hivedoctor` today. |

### Reserved for future use (not implemented yet, do not remove-on-sight if present)

These are explicitly anticipated by a-AC-4 and MAY be added later without a schema-breaking change. Do not treat their absence as invalid; do not fail validation on their presence either:

- `integrityHash` (string) — a tarball integrity hash (e.g. an npm `dist.integrity` SRI string) for defense-in-depth verification beyond registry trust.
- `minNodeVersion` (string, semver range) — the minimum Node engine this pinned version requires, so the installer can pre-flight the host before installing.
- `tagName` (string) — the exact submodule git tag (e.g. `v0.1.13`) this pin corresponds to, for traceability from a pinned version back to the commit that produced it.

## Ownership and versioning

- **The superproject owns this file.** It is authored/updated only as a deliberate act of promoting a fleet release (ADR-0001) — never edited casually as a side effect of an unrelated PR.
- **Versions are hand-pinned, not derived from submodule pointers.** This manifest does not read the git-submodule commit pointers on the superproject to infer versions; a maintainer (or an agent under maintainer direction) chooses and writes the pinned version per product. This keeps promotion an explicit, auditable act (ADR-0001 "Negative" consequence: "a coordination step is added") and keeps `release-train.yaml`'s job simple: validate what is written, never guess it.
- **`manifestVersion` follows semver** and is bumped every time any pinned product version changes. It carries no relationship to any individual product's version number.
- **Immutability of a released manifest.** Once a superproject `v*` tag has run the release train (PRD-001b b-AC-3), the manifest content at that tag is the permanent record of that fleet release (b-AC-5: two installer runs against the same manifest version must resolve to the same four pins). Do not retroactively edit a manifest after its tag has been pushed; cut a new `manifestVersion` and a new tag instead.

## Validation rules (enforced by `.github/scripts/validate-hive-release-manifest.mjs`)

1. The file parses as valid JSON.
2. `manifestVersion` is present and matches `^\d+\.\d+\.\d+$`.
3. `products` is present and is an object containing **exactly** the four required slugs (`honeycomb`, `hivedoctor`, `thehive`, `hivenectar`). An extra unknown slug or a missing required slug is invalid.
4. Every product entry has a non-empty `version` matching `^\d+\.\d+\.\d+$` (no `v` prefix, no ranges, no pre-release tags for a fleet pin).
5. If `published` is present, it must be a boolean.
6. If `packageName` is present, it must be a non-empty string.
7. For every product where `published !== false`: the pinned `<packageName>@<version>` MUST resolve on the public npm registry (checked via the registry HTTP API, no `npm` CLI/auth required). An unresolvable version fails validation with a clear, specific message (which package, which version, what the registry returned).
8. For every product where `published === false`: registry resolution is skipped. The script prints a clearly distinguishable "not yet published (manifest declares `published: false`)" line for that product instead of attempting resolution — this is a pass, not a crash, and not silently ignored (it is always visible in the job log).
9. The script's process exit code is non-zero if and only if any of checks 1–7 fail for any product; skipped checks under rule 8 never contribute a failure on their own.

## Current pinned set (Wave 1)

As of this manifest's creation, `honeycomb` and `hivedoctor` are already published and independently verified against the registry. `thehive` and `hivenectar` are pinned at their current `package.json` versions with `published: false`, because [PRD-001c](./library/requirements/backlog/prd-001-hive-release-manifest-and-ci/prd-001c-hive-release-manifest-and-ci-thehive-hivenectar-publish-pipelines.md)'s release pipelines were only just added in this same change and neither product has cut a first real tag yet. The first maintainer action after this change lands is: register each as an npm Trusted Publisher, cut each product's first real `v*` tag, confirm the publish, then flip `published: true` (or drop the field) here.

## Related

- [ADR-0001](./library/knowledge/private/architecture/ADR-0001-hive-release-manifest-and-combined-release-train.md)
- [PRD-001a](./library/requirements/backlog/prd-001-hive-release-manifest-and-ci/prd-001a-hive-release-manifest-and-ci-manifest-format-and-ownership.md)
- [PRD-001b](./library/requirements/backlog/prd-001-hive-release-manifest-and-ci/prd-001b-hive-release-manifest-and-ci-superproject-release-ci.md) — the CI that validates and produces this manifest.
- [PRD-001c](./library/requirements/backlog/prd-001-hive-release-manifest-and-ci/prd-001c-hive-release-manifest-and-ci-thehive-hivenectar-publish-pipelines.md) — the publish pipelines whose output this manifest pins.
- `.github/workflows/manifest-validate.yaml`, `.github/workflows/release-train.yaml`, `.github/scripts/validate-hive-release-manifest.mjs`
