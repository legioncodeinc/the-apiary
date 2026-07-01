# PRD-001c: Publish Pipelines for the-hive and hivenectar

> **Parent:** [PRD-001](./prd-001-hive-release-manifest-and-ci-index.md)
> **Status:** Backlog
> **Priority:** P0
> **Effort:** L (1-3d)
> **Schema changes:** None. Adds two submodule release workflows and their npm publish setup.

---

## Overview

Two of the four products cannot be installed from a package registry yet: `the-hive` (the always-on portal daemon on port 3853) and `hivenectar` (port 3854) have no publish pipeline. The hive release manifest can only pin versions a registry can actually serve, so the manifest is incomplete until both products publish. This sub-PRD gives each of them an OIDC Trusted Publishing release pipeline that mirrors the model honeycomb and hivedoctor already use, per [`ADR-0001`](../../../../knowledge/private/architecture/ADR-0001-hive-release-manifest-and-combined-release-train.md).

Getting these two products published also closes half of the installer coverage gap: today the installer opens the-hive's URL but never installs it, and never touches hivenectar at all. Making them installable is the precondition; actually installing them from the selected product set is PRD-002b.

## Goals

- Add `the-hive/.github/workflows/release.yaml` and `hivenectar/.github/workflows/release.yaml`, each an OIDC Trusted Publishing release on `v*` tags, mirroring [`honeycomb/.github/workflows/release.yaml`](../../../../../honeycomb/.github/workflows/release.yaml).
- Publish each product to npm under the `@legioncodeinc` org so it is installable with `npm i -g` and pinnable in the manifest.
- Keep each product's release independent: its own tag namespace, changelog, and tarball, exactly like the two already-published products.
- Ensure the versions these pipelines publish are resolvable by the release-train validation in 001b.

## Non-Goals

- Wiring the installer to actually install these products (PRD-002b).
- The manifest schema (001a) or the release-train CI (001b), beyond the requirement that published versions be resolvable.
- Any runtime or product-behavior changes to the-hive or hivenectar; this is packaging and release only.

## Acceptance criteria

| ID | Criterion |
|---|---|
| c-AC-1 | the-hive publishes to npm through an OIDC Trusted Publishing workflow on `v*` tags, with no long-lived `NPM_TOKEN`, mirroring honeycomb's release model. |
| c-AC-2 | hivenectar publishes to npm through the same OIDC Trusted Publishing model on `v*` tags. |
| c-AC-3 | A tagged version of each product resolves on the registry and can be pinned in the manifest and validated by 001b (supports parent AC-3). |
| c-AC-4 | Each product retains an independent release path (its own tag namespace, changelog, tarball); publishing one does not force a version bump of any other (parent AC-5). |

## Implementation notes

- **Mirror, do not reinvent.** Copy honeycomb's OIDC Trusted Publishing shape. Per honeycomb's `RELEASING.md` model, the first publish is a manual 2FA bootstrap and there is no stored token; expect the same bootstrap for each new package.
- **Package identity.** Confirm the npm package names under `@legioncodeinc` for the-hive and hivenectar and that the org can publish them (provisioning may mirror honeycomb's npm-org path).
- **Independence preserved.** Each workflow lives in its own submodule and fires on that submodule's own `v*` tags; the superproject train (001b) only consumes the results.
- **Coordinate with the manifest.** The product slugs/package names chosen here must match the manifest keys settled in 001a and the installer tokens in PRD-002a.

## Open questions

- [ ] Exact npm package names for the-hive and hivenectar under `@legioncodeinc`.
- [ ] Is each product already structured as a publishable npm package (bin, `files`, entry), or does packaging work precede the release workflow?
- [ ] Do these products need their own `ci.yaml` gate before release, matching honeycomb's "CI must pass or it does not merge" posture?

## Related

- [`ADR-0001`](../../../../knowledge/private/architecture/ADR-0001-hive-release-manifest-and-combined-release-train.md) - onboards new products by giving them a publish pipeline and adding them to the manifest.
- [`honeycomb/.github/workflows/release.yaml`](../../../../../honeycomb/.github/workflows/release.yaml) - the OIDC Trusted Publishing model these two pipelines copy.
- [PRD-001b](./prd-001b-hive-release-manifest-and-ci-superproject-release-ci.md) - the release train that must resolve the versions these pipelines publish.
- [PRD-002b](../prd-002-installer-product-loading-and-phone-home/prd-002b-installer-product-loading-and-phone-home-registration-and-install-coverage.md) - installs the-hive and hivenectar once they are publishable, closing the installer coverage gap.
