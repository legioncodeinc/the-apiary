# PRD-001b: Superproject Release CI and Combined Release Train

> **Parent:** [PRD-001](./prd-001-hive-release-manifest-and-ci-index.md)
> **Status:** Backlog
> **Priority:** P0
> **Effort:** L (1-3d)
> **Schema changes:** None. Adds superproject CI workflows only.

---

## Overview

The superproject has carried no CI until now. This sub-PRD gives it two responsibilities, both scoped to the hive release manifest defined in 001a and required by [`ADR-0001`](../../../knowledge/private/architecture/ADR-0001-hive-release-manifest-and-combined-release-train.md): **validate** the manifest, and **run the combined release train** that promotes a set of individually published submodule versions into a named, reproducible fleet release.

CI here sits *above* the per-submodule pipelines. It never rebuilds a product and never replaces honeycomb's or doctor's own `ci.yaml` / `release.yaml`. Its job is to prove the pinned set is real and installable, then to stamp it as a fleet release.

## Goals

- **Manifest validation on every change:** a pull request that touches the manifest triggers a job that confirms every pinned version resolves on the registry and the pinned set is internally consistent.
- **A combined release train:** on a superproject fleet tag, produce (or verify) the manifest for that fleet version and mark it as the reproducible release that the installer can resolve against.
- **Fail loudly on an unshippable set:** a manifest pinning a version that does not exist, or an inconsistent set, fails CI rather than shipping.
- **Zero disruption to submodule pipelines:** submodules keep publishing independently; this train consumes their published outputs.

## Non-Goals

- Defining the manifest schema (that is 001a).
- Creating hive and nectar publish pipelines (that is 001c), though this train depends on them existing so their versions are resolvable.
- Building any product from source or producing a combined tarball or image (explicitly rejected in ADR-0001).

## Acceptance criteria

| ID | Criterion |
|---|---|
| b-AC-1 | A pull request that modifies the manifest runs a validation job that passes only when all four pinned versions resolve on the registry and the set is consistent. |
| b-AC-2 | The validation job fails with a clear message when any pinned version is missing, yanked, or unresolvable. |
| b-AC-3 | A superproject fleet tag runs the release train, which yields a manifest pinning all four versions and marks that manifest version as a released fleet (parent AC-1, AC-2). |
| b-AC-4 | The train does not invoke or alter any submodule's own CI or release workflow; submodule independence (parent AC-5) holds. |
| b-AC-5 | Two runs of the installer against the same released manifest version resolve to the same four pinned versions (supports parent AC-4). |

## Implementation notes

- **Two workflows.** A lightweight `manifest-validate` on pull requests touching the manifest, and a `release-train` on the superproject fleet tag. Keep them in the superproject `.github/workflows/`.
- **Validation = resolvability + consistency.** At minimum assert each pinned version exists on the registry. Optionally (open question) perform a dry install of the full set to prove cross-product installability rather than just per-version existence.
- **Reproducibility.** The released manifest version is the single number a support conversation can pin instead of four; the train must make that mapping durable and immutable once released.
- **No upward rebuild.** Consume submodule tarballs as published; never check out and build a product here.

## Open questions

- [ ] Validation depth: registry-existence check only, or a full dry install of the pinned set in CI?
- [ ] Does the fleet tag live on the superproject, and does the train read submodule versions from the submodule pointers on that commit or from the authored manifest (interacts with 001a)?
- [ ] Where is the released manifest served from for the installer to fetch, the install site (`honeycomb/site/install/`) or a superproject release asset?

## Related

- [`ADR-0001`](../../../knowledge/private/architecture/ADR-0001-hive-release-manifest-and-combined-release-train.md) - the release-train decision.
- [PRD-001a](./prd-001a-hive-release-manifest-and-ci-manifest-format-and-ownership.md) - the manifest this CI validates and produces.
- [PRD-001c](./prd-001c-hive-release-manifest-and-ci-hive-nectar-publish-pipelines.md) - the new publish pipelines whose versions this train must be able to resolve.
- [`honeycomb/.github/workflows/ci.yaml`](../../../../../honeycomb/.github/workflows/ci.yaml) and [`release.yaml`](../../../../../honeycomb/.github/workflows/release.yaml) - the per-submodule pipelines this train sits above and does not replace.
- [`honeycomb/.github/workflows/deploy-install-site.yaml`](../../../../../honeycomb/.github/workflows/deploy-install-site.yaml) - deploys the install surface the released manifest may be served from.
