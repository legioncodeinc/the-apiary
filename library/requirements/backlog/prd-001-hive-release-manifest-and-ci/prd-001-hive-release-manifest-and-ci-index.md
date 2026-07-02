# PRD-001: Hive Release Manifest and Combined Release Train

> **Status:** Backlog
> **Priority:** P0 (fleet coherence, and the prerequisite that makes the-hive and hivenectar installable at all)
> **Effort:** XL (> 3d)
> **Schema changes:** None to any DeepLake catalog. Introduces one new versioned superproject artifact (the hive release manifest) plus new CI and two new submodule publish pipelines.

---

## Overview

The Apiary is an umbrella git repository that aggregates four independently versioned products as git submodules: `honeycomb` (`@legioncodeinc/honeycomb`, published), `hivedoctor` (`@legioncodeinc/doctor`, published), `the-hive` (not published), and `hivenectar` (not published). Each published submodule releases on its own cadence through its own OIDC Trusted Publishing workflow, and that independence is deliberate: a honeycomb patch must not force a hivedoctor bump, and every product keeps its own tarball, changelog, and tag namespace.

Independence alone gives the fleet no notion of a *compatible set*. A user who installs "the latest of everything" can land a combination of the four products that no one ever tested together, and the shared contracts between them (the loopback port map, hivedoctor's registry schema, the-hive's proxy routing, the embeddings runtime) make an untested combination a real correctness and support hazard. The superproject has, until now, carried no CI and no library, so it had no place to express or enforce fleet compatibility.

This module implements [`ADR-0001`](../../../knowledge/private/architecture/ADR-0001-hive-release-manifest-and-combined-release-train.md). It defines a versioned **hive release manifest** that pins exactly one compatible set of submodule versions, gives the superproject **CI** that validates and produces that manifest as a combined release train, and adds **OIDC publish pipelines for the-hive and hivenectar** so the manifest can pin versions a registry can actually serve. The manifest sits above the products; it never merges them into a monolith.

---

## Goals

- A single versioned **hive release manifest** in the superproject root that pins the exact `honeycomb`, `hivedoctor`, `the-hive`, and `hivenectar` versions of one tested fleet release, carrying its own manifest version.
- **Superproject CI** that validates the manifest (every pinned version resolves on the registry, the pinned set is internally consistent) and coordinates the release train that promotes four independently published versions into a named, reproducible fleet release.
- **Publish pipelines for the-hive and hivenectar** that mirror honeycomb's and hivedoctor's OIDC Trusted Publishing model on `v*` tags, so both products become installable from npm.
- The **installer resolves versions from the manifest**: for each selected product it installs that product's own npm tarball at the manifest-pinned version, never "latest of each."
- Preserve every product's independent release machinery: no product loses its own cadence, tag namespace, changelog, or tarball.

## Non-Goals

- **Product selection, flags, licensing, and install-time telemetry.** How the installer chooses *which* products and applies configuration is [`PRD-002`](../prd-002-installer-product-loading-and-phone-home/prd-002-installer-product-loading-and-phone-home-index.md) / [`ADR-0002`](../../../knowledge/private/architecture/ADR-0002-one-line-installer-product-loading-and-install-time-telemetry.md). This module owns *which versions are compatible*, not *which products are picked*.
- **A monolithic combined artifact.** The superproject does not build the products together or produce one fleet tarball or image (explicitly rejected in ADR-0001). A "bundle" is the list of each submodule's own published tarball at the pinned version.
- **Changing any submodule's existing CI or release workflow.** honeycomb and hivedoctor keep their per-repo `ci.yaml` and `release.yaml` verbatim; superproject CI sits above them.
- **The hivedoctor registry contract.** How installed products are recorded on a machine is hivedoctor's ADR-0002 and PRD-001; this module only pins the versions the installer writes there.

---

## Sub-features

| Sub-PRD | Scope | Status |
|---|---|---|
| [`prd-001a-...-manifest-format-and-ownership`](./prd-001a-hive-release-manifest-and-ci-manifest-format-and-ownership.md) | The manifest file: its location in the superproject root, its schema (manifest version + one pinned version per product), ownership, and versioning rules. | Draft |
| [`prd-001b-...-superproject-release-ci`](./prd-001b-hive-release-manifest-and-ci-superproject-release-ci.md) | New superproject CI: validate the manifest (every pinned version resolves, set is consistent) and run the combined release train that promotes a pinned set into a named fleet release. | Draft |
| [`prd-001c-...-thehive-hivenectar-publish-pipelines`](./prd-001c-hive-release-manifest-and-ci-thehive-hivenectar-publish-pipelines.md) | OIDC Trusted Publishing pipelines for the-hive and hivenectar, mirroring honeycomb and hivedoctor, so both become installable and pinnable. | Draft |

---

## Acceptance criteria (module-level)

| ID | Criterion |
|---|---|
| AC-1 | A tagged hive release produces a manifest that pins an explicit version for all four products (`honeycomb`, `hivedoctor`, `the-hive`, `hivenectar`), plus a manifest version. |
| AC-2 | Superproject CI fails the release train when any pinned version does not resolve on the registry or when the pinned set is internally inconsistent, and passes only when the full set is installable. |
| AC-3 | the-hive and hivenectar each publish to npm through an OIDC Trusted Publishing workflow on `v*` tags, mirroring the honeycomb and hivedoctor release model (no long-lived `NPM_TOKEN`). |
| AC-4 | Given a manifest version, the installer installs exactly the four pinned versions (each from its own npm tarball), so two machines installing the same manifest version get the same fleet. |
| AC-5 | Each submodule's existing independent release path (cadence, tag namespace, changelog, tarball) is unchanged; the manifest pins already-published versions and never rebuilds them. |

---

## Data model changes

No DeepLake catalog changes. The only new persistent artifact is the hive release manifest itself, a versioned file at the superproject root (a `hive-release.json` / manifest whose exact name and shape are settled in 001a). It is source-controlled in the superproject, not written to any product's runtime store.

---

## CI and release-artifact changes

- **New superproject CI** (the umbrella repo gains workflows for the first time): manifest validation on pull requests that touch the manifest, and a release-train job that runs on a superproject fleet tag.
- **New submodule workflows:** `hive/.github/workflows/release.yaml` and `nectar/.github/workflows/release.yaml`, each an OIDC Trusted Publishing release on `v*` tags, mirroring [`honeycomb/.github/workflows/release.yaml`](../../../../../honeycomb/.github/workflows/release.yaml).
- **Installer read path:** the installer gains a manifest-resolution step so a selected product maps to a pinned version before `npm i -g`.

---

## Open questions

- [ ] **Manifest file name, location, and format.** `hive-release.json` at the superproject root vs a `manifest/` directory; JSON vs a format that can carry richer per-product metadata (integrity hashes, minimum Node). Settle in 001a.
- [ ] **How the manifest version relates to submodule tags.** Is the fleet release its own `v<n>` tag on the superproject, and does the release train pin the submodule versions from the submodule pointers on that superproject commit, or from an explicit list authored in the manifest?
- [ ] **Validation depth.** Does CI only assert each pinned version resolves on the registry, or does it perform a dry install of the full set to prove cross-product installability?
- [ ] **Registry availability for the-hive and hivenectar.** Do both ship under the `@legioncodeinc` npm org, and does provisioning follow honeycomb's Trusted Publishing bootstrap (first publish is a manual 2FA step, no stored token)?
- [ ] **Fallback behavior.** If the manifest is unreachable or a pinned version is yanked, does the installer hard-fail or fall back to "latest of each" with a warning (ADR-0001 notes reversibility to "latest of each")?

---

## Related

- [`ADR-0001` Hive release manifest and combined release train](../../../knowledge/private/architecture/ADR-0001-hive-release-manifest-and-combined-release-train.md) - the decision this module implements.
- [`ADR-0002` One-line installer product loading and install-time telemetry](../../../knowledge/private/architecture/ADR-0002-one-line-installer-product-loading-and-install-time-telemetry.md) - consumes the pinned versions this manifest supplies; implemented by PRD-002.
- [`PRD-002` One-Line Installer Product Loading and Install-Time Telemetry](../prd-002-installer-product-loading-and-phone-home/prd-002-installer-product-loading-and-phone-home-index.md) - the sibling installer PRD that selects products and resolves each to a manifest-pinned version.
- hivedoctor [`ADR-0002` Service registration, static registry plus runtime SQLite](../../../../doctor/library/knowledge/private/architecture/ADR-0002-service-registration-static-registry-plus-runtime-sqlite.md) - the registry the installer writes when it installs a pinned set.
- hivedoctor [`PRD-001` Service registration and telemetry ingestion](../../../../doctor/library/requirements/backlog/prd-001-service-registration-and-telemetry-ingestion/prd-001-service-registration-and-telemetry-ingestion-index.md) - the registry/installer PRD the manifest's installed set is recorded against.
- honeycomb install assets that this manifest and its installer read path build on:
  - [`honeycomb/scripts/install/install.sh`](../../../../../honeycomb/scripts/install/install.sh) and [`install.ps1`](../../../../../honeycomb/scripts/install/install.ps1) - the one-line installer that gains manifest resolution.
  - [`honeycomb/site/install/`](../../../../../honeycomb/site/install/) - the install surface served at `get.theapiary.sh` from which the manifest is fetched.
  - [`honeycomb/.github/workflows/deploy-install-site.yaml`](../../../../../honeycomb/.github/workflows/deploy-install-site.yaml) - deploys that surface to Cloudflare Pages.
  - [`honeycomb/.github/workflows/release.yaml`](../../../../../honeycomb/.github/workflows/release.yaml) and [`ci.yaml`](../../../../../honeycomb/.github/workflows/ci.yaml) - the OIDC release and CI model the-hive and hivenectar copy.
  - [`honeycomb/src/commands/install.ts`](../../../../../honeycomb/src/commands/install.ts) - the Node CLI verb that installs products, which will resolve versions from the manifest.
