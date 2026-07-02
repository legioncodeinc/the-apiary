# PRD-002b: Install Coverage and Registry Writes

> **Parent:** [PRD-002](./prd-002-installer-product-loading-and-phone-home-index.md)
> **Status:** Backlog
> **Priority:** P0
> **Effort:** L (1-3d)
> **Schema changes:** None to any DeepLake catalog. Writes hivedoctor's registry on lifecycle transitions.

---

## Overview

Today the installer installs only honeycomb and hivedoctor, then opens the-hive's URL on port 3853 without ever installing the-hive, and never touches hivenectar (port 3854). This sub-PRD closes that coverage gap: given the resolved product selection from 002a and the pinned versions from PRD-001, the installer **installs the-hive and hivenectar** (and any other selected product), and it **writes hivedoctor's registry** as the durable record of what is deployed, creating a registration on install and updating it on install, update, and delete, per [`ADR-0002`](../../../knowledge/private/architecture/ADR-0002-one-line-installer-product-loading-and-install-time-telemetry.md).

The registry contract itself (its schema and storage) is owned by hivedoctor's ADR-0002 and PRD-001; this sub-PRD is the installer-side writer of that contract.

## Goals

- Install every product in the resolved selection, including the-hive and hivenectar, at the manifest-pinned version, rather than merely opening the-hive's URL.
- Create a registration entry when a product or service is installed.
- Update the registration on install, update, and deletion of a product or service, so hivedoctor's registry stays an accurate picture of the machine's fleet.
- Keep the friendly progress-log and plain-language-error posture the current installer already sets.

## Non-Goals

- Defining the registry schema or storage (hivedoctor ADR-0002 / PRD-001).
- Flag/code resolution (002a) or telemetry (002c).
- The publish pipelines that make the-hive and hivenectar installable in the first place (PRD-001c); this sub-PRD assumes those packages exist.

## Acceptance criteria

| ID | Criterion |
|---|---|
| b-AC-1 | When the selection includes the-hive, the installer installs the-hive (not merely opens its URL); when it includes hivenectar, hivenectar is installed (parent AC-5). |
| b-AC-2 | Each installed product is installed at the manifest-pinned version supplied by PRD-001, not "latest." |
| b-AC-3 | A registration entry is created in hivedoctor's registry when a product or service is installed (parent AC-6). |
| b-AC-4 | The registration is updated on install, update, and deletion, keeping the registry consistent with the machine's actual fleet (parent AC-6). |
| b-AC-5 | `--products=honeycomb,thehive` results in exactly honeycomb and the-hive installed and registered, and no unselected product installed (supports parent AC-1). |

## Implementation notes

- **Depends on 001c and PRD-001.** the-hive and hivenectar must be publishable (001c) and pinned (PRD-001a/b) before this sub-PRD can install them from npm at a fixed version.
- **Registry writes go through hivedoctor's contract.** Do not invent a second record of deployed products; write the registry hivedoctor defines (ADR-0002 / PRD-001). Treat create/update/delete as the three transitions the installer is responsible for.
- **Keep opening the-hive's URL** (port 3853) as a post-install convenience, but only *after* it is actually installed; the open is no longer a substitute for installation.
- **Port map awareness.** The fleet uses fixed loopback ports (honeycomb 3850, embeddings 3851, hivedoctor status 3852, the-hive 3853, hivenectar 3854); installation and registration should reflect the services that will bind them.

## Open questions

- [ ] How the installer invokes hivedoctor's registry writer: a hivedoctor CLI verb, a file the registry reads, or a local endpoint (depends on hivedoctor PRD-001).
- [ ] Delete/uninstall entry point: does this installer own uninstall, or does it only update the registry when another path performs the delete?
- [ ] Do the-hive and hivenectar install as global npm bins like honeycomb, or as services with their own bootstrap?

## Related

- [`ADR-0002`](../../../knowledge/private/architecture/ADR-0002-one-line-installer-product-loading-and-install-time-telemetry.md) - registration on every lifecycle transition; installer installs the selected set.
- hivedoctor [`ADR-0002` Service registration, static registry plus runtime SQLite](../../../../doctor/library/knowledge/private/architecture/ADR-0002-service-registration-static-registry-plus-runtime-sqlite.md) - the registry contract this sub-PRD writes.
- hivedoctor [`PRD-001` Service registration and telemetry ingestion](../../../../doctor/library/requirements/backlog/prd-001-service-registration-and-telemetry-ingestion/prd-001-service-registration-and-telemetry-ingestion-index.md) - the registry contract this sub-PRD writes.
- [PRD-001c](../prd-001-hive-release-manifest-and-ci/prd-001c-hive-release-manifest-and-ci-thehive-hivenectar-publish-pipelines.md) - makes the-hive and hivenectar installable.
- [PRD-002a](./prd-002a-installer-product-loading-and-phone-home-product-loading.md) - supplies the resolved product selection.
- [`honeycomb/scripts/install/install.sh`](../../../../../honeycomb/scripts/install/install.sh) and [`install.ps1`](../../../../../honeycomb/scripts/install/install.ps1) - gain the install-coverage and registry-write steps.
- [`honeycomb/src/commands/install.ts`](../../../../../honeycomb/src/commands/install.ts) - the CLI verb that installs products and can drive registry writes.
