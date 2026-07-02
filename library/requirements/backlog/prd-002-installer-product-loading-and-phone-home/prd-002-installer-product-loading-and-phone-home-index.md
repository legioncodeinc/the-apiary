# PRD-002: One-Line Installer Product Loading and Install-Time Telemetry

> **Status:** Backlog
> **Priority:** P0 (the installer is the top of funnel for every product, and today it neither selects products nor reliably reports installs)
> **Effort:** XL (> 3d)
> **Schema changes:** None to any DeepLake catalog. Writes doctor's registry on lifecycle transitions and adds a public-key install-time telemetry path.

---

## Overview

The Apiary has one front door: `curl -fsSL https://get.theapiary.sh | sh` (and the PowerShell twin `install.ps1`). Today that installer ([`honeycomb/scripts/install/install.sh`](../../../../../honeycomb/scripts/install/install.sh)) is deliberately thin: it provisions Node, installs `@legioncodeinc/honeycomb` and `@legioncodeinc/doctor`, hands off to the `honeycomb install` CLI verb, and opens hive's URL on port 3853. It never installs hive or nectar (a real coverage gap), it has no way to choose *which* products to load, and its most important business event is its least reliable one.

This module implements [`ADR-0002`](../../../knowledge/private/architecture/ADR-0002-one-line-installer-product-loading-and-install-time-telemetry.md). It gives the installer a **flag-driven product-selection model** (`--products=`, `--profile=`, `--license=` / `--code=`, with product codes resolving at the install site, optional combo-URL sugar, and env/config for admin deploys), makes the installer **actually install hive and nectar** per the selected products, writes **doctor's registry** on install / update / delete, and moves **install-time telemetry into the shell script** using a public PostHog key baked into the install site so the "someone installed" signal survives keyless Node builds and early failures. The versions it loads for each selected product come from the hive release manifest of [`PRD-001`](../prd-001-hive-release-manifest-and-ci/prd-001-hive-release-manifest-and-ci-index.md); this module owns *selection, configuration, registration, and telemetry*, not *which versions are compatible*.

## Overview of today's telemetry (what this changes)

- `honeycomb_installed` fires from the Node CLI ([`honeycomb/src/commands/install.ts`](../../../../../honeycomb/src/commands/install.ts)) after success: build-key-dependent (a keyless build sends nothing), fire-and-forget with no retry, and skipped entirely when the install fails before the CLI runs or when hive/nectar are absent.
- `honeycomb_first_link` fires from the daemon on Deep Lake login ([`honeycomb/src/daemon/runtime/auth/deeplake-issuer.ts`](../../../../../honeycomb/src/daemon/runtime/auth/deeplake-issuer.ts)); it is well placed and **stays exactly where it is**.

---

## Goals

- A **flag-driven install model**: `--products=` selects the set, `--profile=` selects a preset, `--license=` / `--code=` pass a license or product code; flags, env vars, and a config file resolve to the same internal selection.
- **Product codes resolve at the install site** to a product set plus configuration, so a short code stands in for a longer flag combination; **combo/alias URLs are optional sugar** that expand to flag presets.
- The installer **installs hive and nectar** (and any other selected product) at their manifest-pinned versions, closing the coverage gap where hive was only opened and nectar never touched.
- **Registration written on every lifecycle transition:** create on install, update on install/update/delete, into doctor's registry as the durable record of what is deployed.
- **Install-time telemetry fired from the shell script** at start and at completion or failure, using a public PostHog project key baked into the install site (independent of the Node build key), with a stable anonymous install id correlating a run.
- Keep `honeycomb_first_link` firing on Deep Lake login, unchanged.

## Non-Goals

- **Defining the manifest or the release train** (that is [`PRD-001`](../prd-001-hive-release-manifest-and-ci/prd-001-hive-release-manifest-and-ci-index.md) / [`ADR-0001`](../../../knowledge/private/architecture/ADR-0001-hive-release-manifest-and-combined-release-train.md)). This module *consumes* the pinned versions.
- **The doctor registry contract itself.** The schema and storage of the registry are doctor's ADR-0002 and PRD-001; this module writes to that contract, it does not define it.
- **Changing the daemon-side login event.** `honeycomb_first_link` is not in scope beyond keeping it in place.
- **A full licensing/entitlement backend.** `--license=` / `--code=` are designed as the resolvable seam now; the entitlement service behind them is future work.

---

## Sub-features

| Sub-PRD | Scope | Status |
|---|---|---|
| [`prd-002a-...-product-loading`](./prd-002a-installer-product-loading-and-phone-home-product-loading.md) | The flag grammar (`--products` / `--profile` / `--license` / `--code`), product-code resolution at the install site, combo-URL sugar, and env/config precedence for admin deploys. | Draft |
| [`prd-002b-...-registration-and-install-coverage`](./prd-002b-installer-product-loading-and-phone-home-registration-and-install-coverage.md) | Installing hive and nectar per the selected set, and writing doctor's registry on install / update / delete. | Draft |
| [`prd-002c-...-install-time-telemetry`](./prd-002c-installer-product-loading-and-phone-home-install-time-telemetry.md) | The phone-home moved into `install.sh` / `install.ps1`: public PostHog key baked in the install site, start and completion/failure events, stable anonymous install id; keep `honeycomb_first_link`. | Draft |

---

## Acceptance criteria (module-level)

| ID | Criterion |
|---|---|
| AC-1 | `curl -fsSL https://get.theapiary.sh \| sh -s -- --products=honeycomb,hive` installs exactly that product set (at manifest-pinned versions) and registers those products in doctor's registry. |
| AC-2 | A PostHog event fires from the shell script even on a keyless Node build and even when the install fails early (before the Node CLI runs), using the public key baked in the install site. |
| AC-3 | A product code resolves at the install site to a product set plus configuration, and produces the same internal selection as the equivalent explicit flags. |
| AC-4 | Flags, environment variables, and a config file resolve to the same internal selection with a documented precedence, so an admin can pin what to deploy without editing the pasted command. |
| AC-5 | The installer installs hive and nectar when selected (not merely opening hive's URL), closing the prior coverage gap. |
| AC-6 | Registration is created on install and updated on install, update, and delete, keeping doctor's registry an accurate picture of the machine's fleet. |
| AC-7 | Start and completion/failure telemetry for one run share a stable anonymous install id, and `honeycomb_first_link` continues to fire on Deep Lake login unchanged. |

---

## Data model changes

No DeepLake catalog changes. Two persistent effects:

- **doctor registry writes** on every product/service install, update, and delete (contract owned by doctor ADR-0002 / PRD-001).
- **A stable anonymous install id** persisted by the shell script (a machine-local id, carrying no identifying information) so start and completion/failure events correlate and repeat installs are distinguishable from first installs.

---

## API and configuration changes

- **Installer interface:** `--products=`, `--profile=`, `--license=`, `--code=` flags; environment variables and a config file that resolve to the same selection with documented precedence.
- **Install-site resolution:** product codes and combo/alias URLs resolve to flag presets at the install site ([`honeycomb/site/install/`](../../../../../honeycomb/site/install/), which already builds `index.template.html` and a `functions/` edge handler).
- **Telemetry transport:** a public PostHog project key baked into the install site, read by the shell script (not the Node build-time key); start and terminal events posted directly from `install.sh` / `install.ps1`.

---

## Open questions

- [ ] **Product code namespace and resolution.** Where do codes live (a table at the install site edge function), and what happens on an unknown or expired code, hard fail or fall back to a default product set?
- [ ] **Config precedence.** Exact order of flags vs env vs config file, and the config file location and format for admin deploys.
- [ ] **Anonymous install id storage.** Where the id is written (under `~/.deeplake` alongside onboarding state, or a dedicated file) and how the PowerShell twin generates the same shape.
- [ ] **PowerShell parity.** `install.ps1` must mirror flag parsing, code/config resolution, registration, and the phone-home; how much logic can be shared vs duplicated across the two shell dialects.
- [ ] **Spoofed events.** A public ingest key can receive spoofed events; is any lightweight mitigation wanted, or is install-funnel counting tolerant of it (ADR-0002 accepts the standard client-analytics trade)?
- [ ] **Relationship to honeycomb's existing PRD-050e telemetry chokepoint.** ADR-0002 moves the install-lifecycle event to the shell; confirm the Node-side `honeycomb_installed` firing is retired or repurposed so events are not double-counted.

---

## Related

- [`ADR-0002` One-line installer product loading and install-time telemetry](../../../knowledge/private/architecture/ADR-0002-one-line-installer-product-loading-and-install-time-telemetry.md) - the decision this module implements.
- [`ADR-0001` Hive release manifest and combined release train](../../../knowledge/private/architecture/ADR-0001-hive-release-manifest-and-combined-release-train.md) - supplies the pinned versions the installer loads for the selected products.
- [`PRD-001` Hive Release Manifest and Combined Release Train](../prd-001-hive-release-manifest-and-ci/prd-001-hive-release-manifest-and-ci-index.md) - the sibling PRD that makes hive and nectar publishable and pins the versions this installer resolves.
- doctor [`ADR-0002` Service registration, static registry plus runtime SQLite](../../../../doctor/library/knowledge/private/architecture/ADR-0002-service-registration-static-registry-plus-runtime-sqlite.md) - the registry contract this installer writes on every lifecycle transition.
- doctor [`PRD-001` Service registration and telemetry ingestion](../../../../doctor/library/requirements/backlog/prd-001-service-registration-and-telemetry-ingestion/prd-001-service-registration-and-telemetry-ingestion-index.md) - the registry/installer PRD whose registry this installer writes on every lifecycle transition.
- honeycomb install assets this module extends:
  - [`honeycomb/scripts/install/install.sh`](../../../../../honeycomb/scripts/install/install.sh) and [`install.ps1`](../../../../../honeycomb/scripts/install/install.ps1) - gain flag parsing, code/config resolution, install coverage, and the shell-fired phone-home.
  - [`honeycomb/site/install/`](../../../../../honeycomb/site/install/) - where the public PostHog key is baked and where codes and combo URLs resolve to flag presets.
  - [`honeycomb/.github/workflows/deploy-install-site.yaml`](../../../../../honeycomb/.github/workflows/deploy-install-site.yaml) - deploys the install site to `get.theapiary.sh`.
  - [`honeycomb/src/commands/install.ts`](../../../../../honeycomb/src/commands/install.ts) - fires `honeycomb_installed` today (the transport this module moves to the shell).
  - [`honeycomb/src/daemon/runtime/auth/deeplake-issuer.ts`](../../../../../honeycomb/src/daemon/runtime/auth/deeplake-issuer.ts) - fires `honeycomb_first_link` on Deep Lake login; unchanged by this module.
