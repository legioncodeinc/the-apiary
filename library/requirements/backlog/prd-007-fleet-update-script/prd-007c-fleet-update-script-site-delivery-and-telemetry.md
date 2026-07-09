# PRD-007c: Site Delivery and Update Telemetry

> **Parent:** [PRD-007](./prd-007-fleet-update-script-index.md)
> **Status:** Backlog
> **Priority:** P1
> **Effort:** S (< 1d)
> **Schema changes:** None. Adds two static routes + their `SHA256SUMS`/inspect-page entries, two `build.mjs` list entries, one `_worker.js` branch, two `_headers` rules, two `POSTHOG_KEY_PATTERNS` entries, and three new PostHog event names on the existing install-site channel.

---

## Overview

This sub-PRD makes the update script reachable at `get.theapiary.sh/update` and reporting on the same anonymous PostHog channel the installer uses. It mirrors the uninstall delivery surface (PRD-003d) exactly: bare `/update` serves the shell script for a pipe, `/update.sh` and `/update.ps1` are the explicit checksummed twins, everything is `text/plain` + `nosniff`, byte-identical to what `SHA256SUMS` covers, listed on the inspect page, and deployed by the existing `v*` flow. It also defines the telemetry seam 007a/007b call: `resolve_install_id`, `phone_home`, and `finish`, adding `update_started` / `update_completed` / `update_failed` and reusing `product_updated`.

## Goals

- `curl -fsSL https://get.theapiary.sh/update | sh` and `irm https://get.theapiary.sh/update.ps1 | iex` both resolve to the checksummed scripts.
- The new routes are served exactly like the install/uninstall routes: pinned content type, `nosniff`, published checksums, inspect-page rows, deployed on a superproject `v*` tag.
- The update script reports on the same anonymous install-site telemetry channel as the installer, with three new event names and the reused per-product event, no new key, no new payload fields, no PII.

## Non-Goals

- Any change to the installer/uninstaller routing or combo/alias behavior (untouched).
- New worker logic beyond the `/update` content-negotiation branch.
- A separate/parallel telemetry key or endpoint — it reuses the install-site key seam verbatim.

## User stories

### US-7c.1 — Serve the update routes like its siblings

**As a** user, **I want to** paste one command and inspect the script before piping, **so that** updating has the same trust surface as installing.

**Acceptance criteria:**
- c-AC-1 `GET /update` from a shell client (curl/wget/powershell UA, or non-`text/html` Accept) streams `update.sh` as `text/plain; charset=utf-8` with `X-Content-Type-Options: nosniff`; from a browser it serves the same inspect page as `/` and `/uninstall`.
- c-AC-2 `GET /update.sh` and `GET /update.ps1` serve `text/plain` + `nosniff` (via `_headers`), and `SHA256SUMS` contains entries for both; `sha256sum -c` verifies against the served bytes.
- c-AC-3 `build.mjs` copies `update.sh` / `update.ps1` from `scripts/install/`, computes their SHA-256 into `SHA256SUMS`, injects the same PostHog key via an anchored per-file pattern, and renders their checksums + source into the inspect page (`{{SHA_UPDATE_SH}}`, `{{SHA_UPDATE_PS1}}`, `{{SOURCE_UPDATE_SH}}`, `{{SOURCE_UPDATE_PS1}}`).
- c-AC-4 The routes deploy through the existing [`deploy-install-site.yaml`](../../../../.github/workflows/deploy-install-site.yaml) on a superproject `v*` tag, unchanged in shape (no new deploy job), and only the un-prefixed checksummed routes are covered by `SHA256SUMS` (no dynamic prefixing, matching the README rule).

### US-7c.2 — Report the update on the anonymous channel

**As the** team, **I want to** see update runs in PostHog in the same shape as installs, **so that** update adoption and failures are visible without a second analytics path.

**Acceptance criteria:**
- c-AC-5 `update_started` fires first, before any product resolution, using only `curl` (no Node dependency), with the anonymous `~/.honeycomb/install-id` (minted if absent) as `distinct_id`, exactly as `install_started` does.
- c-AC-6 Exactly one of `update_completed` / `update_failed` fires at the terminal state, via a single `finish()` funnel, including a failure before the honeycomb CLI ever runs.
- c-AC-7 One `product_updated` fires per product that actually moved (never for a skipped/already-current or absent product), reusing the installer's existing `product_updated` event and its `"product":"<slug>"` payload field.
- c-AC-8 The payload is the installer's allow-listed shape (`os`, `repeat_install`, `install-id`, optional `product`), carries no PII, and never includes any license/code value; an empty baked key makes every send a silent no-op; `--dry-run` previews the events and sends nothing.

## Implementation notes

- **`_worker.js`.** Add a `/update` branch alongside `/uninstall`: extend the early guard (`url.pathname !== "/" && !== "/uninstall" && !== "/update"`) and add an `if (url.pathname === "/update")` block that fetches `/update.sh` and re-wraps it as `text/plain` + `nosniff` + `Cache-Control: public, max-age=300` — a copy of the `/uninstall` block. The browser/inspect-page branch already covers any negotiated root; include `/update` there.
- **`build.mjs`.** Add `'update.sh'`, `'update.ps1'` to `SCRIPTS`; add their entries to `POSTHOG_KEY_PATTERNS` with the same anchored declaration-line pattern the install scripts use (`HONEYCOMB_INSTALL_POSTHOG_KEY=""` / `$HoneycombInstallPosthogKey = ''`); add the four template tokens to `replacements` and the two SHA lines to the build log.
- **`_headers`.** Add `text/plain` + `nosniff` rules for `/update.sh` and `/update.ps1` (and the bare `/update` if it is not fully worker-owned), mirroring the uninstall rules.
- **`index.template.html`.** Add an update card with its one-liner, the two checksums, and collapsible source, mirroring the uninstall card.
- **Telemetry seam.** Port `generate_uuid`, `resolve_install_id`, `phone_home`, and `finish` from `install.sh` verbatim (same endpoint `${host}/i/v0/e/`, same `{api_key,event,distinct_id,properties}` body, same 3s `--max-time`, same empty-key no-op). Only the event *names* differ. Keep `repeat_install` semantics as-is (an update is inherently a repeat interaction; the field stays meaningful) — do not invent a new field.
- **`--latest` is telemetry-neutral.** The `--latest` flag (007a) changes only the *resolved npm target*, never the event names, payload shape, or channel. A `--latest` run still fires `update_started` / `product_updated` / `update_completed` identically; if a `latest`-vs-`blessed` distinction is ever wanted in analytics, it is a future additive property, not part of this PRD.
- **README.** Note in `site/install/README.md` that `/update` joins `/` and `/uninstall` as a negotiated route and that its scripts are checksum-covered like the others.

## Open questions

- [ ] **`repeat_install` naming.** The reused field is named `repeat_install`; on an update run it is always effectively "repeat." Keep the name (payload-shape parity, no schema churn) or add an `is_update` boolean? Proposed: keep `repeat_install`, add nothing — the event *name* (`update_*`) already distinguishes the flow.
- [ ] **`products` payload on update.** On install, `products` is the resolved selection; on update, is it "the products that moved" or "the products present"? Proposed: the products that moved (matches `product_updated` semantics and keeps `update_completed`'s `products` field honest about what changed).
- [ ] **Inspect-page grouping.** One combined "manage your install" page section for install/update/uninstall, or three parallel cards? Proposed: three parallel cards, least churn to the existing template.

## Related

- [`site/install/_worker.js`](../../../../site/install/_worker.js), [`build.mjs`](../../../../site/install/build.mjs), [`_headers`](../../../../site/install/_headers), [`index.template.html`](../../../../site/install/index.template.html), [`README.md`](../../../../site/install/README.md) — the surfaces edited here.
- [`.github/workflows/deploy-install-site.yaml`](../../../../.github/workflows/deploy-install-site.yaml) — the unchanged-shape deploy flow.
- [`scripts/install/install.sh`](../../../../scripts/install/install.sh):185-270,995-1003 — the `generate_uuid` / `resolve_install_id` / `phone_home` / `finish` telemetry seam ported here.
- [`PRD-003d`](../../completed/prd-003-fleet-lifecycle-login-and-uninstall/prd-003d-fleet-lifecycle-login-and-uninstall-global-uninstall-script.md) — the uninstall delivery surface this mirrors route-for-route.
- [`PRD-002c`](../../completed/prd-002-installer-product-loading-and-phone-home/prd-002c-installer-product-loading-and-phone-home-install-time-telemetry.md) — the install-time telemetry contract these events extend.
