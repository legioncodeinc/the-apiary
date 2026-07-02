# PRD-002c: Install-Time Telemetry from the Shell Script

> **Parent:** [PRD-002](./prd-002-installer-product-loading-and-phone-home-index.md)
> **Status:** Backlog
> **Priority:** P0
> **Effort:** M (3-8h)
> **Schema changes:** None to any DeepLake catalog. Persists a machine-local anonymous install id.

---

## Overview

Install-time telemetry does not work well today. `honeycomb_installed` fires from the Node CLI ([`honeycomb/src/commands/install.ts`](../../../../../honeycomb/src/commands/install.ts)) after a successful install, which rolls three problems into one: it depends on a build-time PostHog key baked into the Node package (so a keyless build sends nothing), it is fire-and-forget with no retry, and it never fires when the install fails before the CLI runs or when hive/hivenectar are absent. The single most important business event, "someone installed," is the least reliable one.

This sub-PRD implements the telemetry half of [`ADR-0002`](../../../knowledge/private/architecture/ADR-0002-one-line-installer-product-loading-and-install-time-telemetry.md): move the install-time phone-home **into the shell script itself** (`install.sh` / `install.ps1`), firing at **start** and at **completion or failure**, using a **public PostHog project key baked into the install site** (independent of the Node build key), with a **stable anonymous install id** so a run's start and terminal events correlate. PostHog project keys are safe to expose client-side, so this transport is legitimate and, crucially, present even on a keyless Node build or an early abort. The daemon-side `honeycomb_first_link` login event ([`honeycomb/src/daemon/runtime/auth/deeplake-issuer.ts`](../../../../../honeycomb/src/daemon/runtime/auth/deeplake-issuer.ts)) stays exactly where it is.

## Goals

- Fire an `install_started` event from the shell script at the start of a run.
- Fire `install_completed` on success and `install_failed` on failure, from the shell script, including in failure paths the Node CLI never reaches.
- Use a **public PostHog project key baked into the install site** ([`honeycomb/site/install/`](../../../../../honeycomb/site/install/), deployed by [`deploy-install-site.yaml`](../../../../../honeycomb/.github/workflows/deploy-install-site.yaml)), not the Node build-time key.
- Generate and persist a **stable anonymous install id** so start and terminal events for one run correlate and repeat installs are distinguishable from first installs, with no identifying information.
- Keep `honeycomb_first_link` firing on Deep Lake login, unchanged, and retire or de-duplicate the Node-side `honeycomb_installed` firing so events are not double-counted.

## Non-Goals

- Product selection (002a) or install coverage and registry writes (002b).
- Changing the daemon-side login event beyond keeping it in place.
- Building a bespoke analytics backend; this posts to PostHog's capture endpoint with a public key.

## Acceptance criteria

| ID | Criterion |
|---|---|
| c-AC-1 | An `install_started` event fires from the shell script at the start of every run, before product resolution and install (supports parent AC-2). |
| c-AC-2 | An `install_completed` or `install_failed` event fires from the shell script at the terminal state, including when the install fails before the Node CLI runs (parent AC-2). |
| c-AC-3 | The events use the public PostHog key baked into the install site, and fire even on a keyless Node build (parent AC-2). |
| c-AC-4 | Start and terminal events for one run share a stable anonymous install id; a repeat install on the same machine is distinguishable from a first install (parent AC-7). |
| c-AC-5 | `honeycomb_first_link` continues to fire on Deep Lake login unchanged, and the Node-side `honeycomb_installed` no longer double-counts the install-lifecycle event (parent AC-7). |
| c-AC-6 | Both `install.sh` and `install.ps1` implement the same start/terminal telemetry with the same event names and payload shape. |

## Implementation notes

- **Bake the key at the site.** The public PostHog project key is a build input of the install site, sourced the same way the site's other config is; the shell reads it as baked content, not a runtime env lookup on the user's machine.
- **Two dialects, one contract.** `install.sh` (POSIX `sh`, no bashisms) and `install.ps1` must send identical event names (`install_started`, `install_completed`, `install_failed`) and an identical minimal payload (anonymous install id, terminal status, coarse selection such as the product set, no PII).
- **Failure paths are the point.** Wrap the run so that any early exit still fires `install_failed`; this is precisely the case the Node-only transport misses. Keep the phone-home fail-soft and non-blocking so it never delays or breaks the install.
- **Anonymous id lifecycle.** Persist a random id (for example under `~/.deeplake` alongside onboarding state); reuse it on subsequent runs so first-vs-repeat is derivable without identifying the user.
- **De-duplicate with the Node event.** ADR-0002 moves the install-lifecycle event's transport to the shell; ensure `honeycomb_installed` (fired in `install.ts` / honeycomb's PRD-050e chokepoint) is retired or scoped so the fleet does not count an install twice.

## Open questions

- [ ] Exact event names and the minimal payload allow-list (product set, os, terminal status), keeping strictly no PII.
- [ ] Anonymous install id storage location and how `install.ps1` produces the same shape as `install.sh`.
- [ ] How to reconcile with honeycomb's existing PRD-050e daemon telemetry so `honeycomb_installed` is retired or repurposed, not duplicated.
- [ ] Spoofed-event tolerance: accept the standard client-analytics exposure (ADR-0002's position) or add a lightweight guard at the ingest edge?

## Related

- [`ADR-0002`](../../../knowledge/private/architecture/ADR-0002-one-line-installer-product-loading-and-install-time-telemetry.md) - the shell-fired telemetry decision.
- [`honeycomb/scripts/install/install.sh`](../../../../../honeycomb/scripts/install/install.sh) and [`install.ps1`](../../../../../honeycomb/scripts/install/install.ps1) - gain the start and terminal phone-home.
- [`honeycomb/site/install/`](../../../../../honeycomb/site/install/) - where the public PostHog key is baked.
- [`honeycomb/.github/workflows/deploy-install-site.yaml`](../../../../../honeycomb/.github/workflows/deploy-install-site.yaml) - deploys the install site to `get.theapiary.sh`.
- [`honeycomb/src/commands/install.ts`](../../../../../honeycomb/src/commands/install.ts) - fires `honeycomb_installed` today (transport moved here to the shell; de-duplicate).
- [`honeycomb/src/daemon/runtime/auth/deeplake-issuer.ts`](../../../../../honeycomb/src/daemon/runtime/auth/deeplake-issuer.ts) - fires `honeycomb_first_link` on Deep Lake login; unchanged.
