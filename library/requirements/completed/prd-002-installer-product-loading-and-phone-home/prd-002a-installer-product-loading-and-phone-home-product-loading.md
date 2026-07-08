# PRD-002a: Product Loading, Flags, Codes, and Admin Config

> **Parent:** [PRD-002](./prd-002-installer-product-loading-and-phone-home-index.md)
> **Status:** Completed
> **Priority:** P0
> **Effort:** L (1-3d)
> **Schema changes:** None. Adds installer flags, install-site code resolution, and an admin config surface.

---

## Overview

Today the installer always installs the same two products with no way to choose. This sub-PRD builds the product-selection seam required by [`ADR-0002`](../../../knowledge/private/architecture/ADR-0002-one-line-installer-product-loading-and-install-time-telemetry.md): a flag-driven model where `--products=`, `--profile=`, `--license=`, and `--code=` are first-class inputs; where a product code resolves at the install site to a product set plus configuration; where combo/alias URLs are optional sugar over flag presets; and where environment variables and a config file let a repo administrator pin what to deploy without editing the pasted command. Flags, env, and config all resolve to the same internal selection.

This is the explicit seam a future licensing and product-code system plugs into, so it is designed for that now rather than retrofitted later.

## Goals

- Parse `--products=<slug,slug>`, `--profile=<name>`, `--license=<key>`, and `--code=<code>` in both `install.sh` and `install.ps1`.
- Resolve a **product code** at the install site to a product set plus configuration, so a short code equals a longer flag combination.
- Support **combo/alias URLs** that expand to fixed flag presets, as optional convenience only, never the primary mechanism.
- Support **environment variables and a config file** for admin deploys, resolving to the same internal selection as flags with a documented precedence.
- Feed the resolved product set to the manifest-version resolution (PRD-001) so each selected product installs at its pinned version.

## Non-Goals

- Actually installing hive/nectar and writing the registry (that is 002b).
- Firing telemetry (that is 002c).
- Building the entitlement backend behind `--license=` / `--code=`; this sub-PRD only makes them resolvable inputs.

## Acceptance criteria

| ID | Criterion |
|---|---|
| a-AC-1 | `--products=honeycomb,hive` yields an internal selection of exactly those products, and drives installation of that set (supports parent AC-1, AC-5). |
| a-AC-2 | A `--code=<code>` resolves at the install site to a product set plus configuration that equals the equivalent explicit flags (parent AC-3). |
| a-AC-3 | Flags, environment variables, and a config file resolve to the same internal selection, with a documented precedence order (parent AC-4). |
| a-AC-4 | A combo/alias URL expands to a flag preset and produces the same selection as passing those flags directly; it is documented as sugar, not the primary path. |
| a-AC-5 | `--profile=<name>` and `--license=<key>` parse and thread through resolution as first-class inputs, even where the backing entitlement is not yet implemented. |
| a-AC-6 | Both `install.sh` and `install.ps1` implement the same flag grammar and resolution behavior. |

## Implementation notes

- **Product slugs align with the manifest.** The `--products=` tokens must match the manifest product keys (PRD-001a) so a selected product maps directly to a pinned version with no translation table. Use `honeycomb`, `doctor`, `hive`, `nectar` consistently.
- **Code resolution lives at the install site.** The install site already ships an edge `functions/` handler and an `index.template.html` build ([`honeycomb/site/install/`](../../../../../honeycomb/site/install/)); resolve codes and combo URLs there so the pasted shell command stays short.
- **Precedence is documented, not implicit.** State the flag / env / config order once (for example: explicit flag beats env beats config file beats built-in default) and implement it identically in both shells.
- **Design for licensing.** Keep `--license=` / `--code=` as opaque strings passed to a resolver so the entitlement service is a fill-in later, per ADR-0002's "designing them in from the start makes licensing a fill-in."

## Open questions

- [ ] Config file location and format for admin deploys, and how it is discovered by the shell script.
- [ ] Unknown/expired code behavior: hard fail, or fall back to a default product set with a warning?
- [ ] Do combo URLs live as distinct Cloudflare Pages routes, or as query parameters the edge function expands?

## Related

- [`ADR-0002`](../../../knowledge/private/architecture/ADR-0002-one-line-installer-product-loading-and-install-time-telemetry.md) - the flag-driven product-loading decision.
- [PRD-001a](../prd-001-hive-release-manifest-and-ci/prd-001a-hive-release-manifest-and-ci-manifest-format-and-ownership.md) - the manifest keys these `--products=` tokens align with.
- [PRD-002b](./prd-002b-installer-product-loading-and-phone-home-registration-and-install-coverage.md) - consumes the resolved selection to install and register the products.
- [`honeycomb/scripts/install/install.sh`](../../../../../honeycomb/scripts/install/install.sh) and [`install.ps1`](../../../../../honeycomb/scripts/install/install.ps1) - gain the flag grammar.
- [`honeycomb/site/install/`](../../../../../honeycomb/site/install/) - resolves codes and combo URLs to flag presets.
