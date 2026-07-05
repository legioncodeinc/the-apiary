# PRD-003d: Global One-Command Uninstall Script

> **Parent:** [PRD-003](./prd-003-fleet-lifecycle-login-and-uninstall-index.md)
> **Status:** Backlog
> **Priority:** P1
> **Effort:** L (1-3d)
> **Schema changes:** None. Adds two published scripts and their checksum entries to the install site.

---

## Overview

`doctor purge` (003c) assumes doctor is installed and Node works. The cases that most need a full wipe are exactly the ones where that assumption fails: a half-completed install, a broken Node, a machine where only legacy `hivemind`-era artifacts remain. The install surface already solved this shape of problem in the other direction: a self-contained shell script served from `get.theapiary.sh`, inspectable before piping, with published SHA-256 checksums.

This sub-PRD ships the mirror image: **`curl -fsSL https://get.theapiary.sh/uninstall | sh`** (and a PowerShell twin for `irm ... | iex`), a one-command full purge of all Apiary assets that requires no pre-installed Apiary tooling. Source lives in [`scripts/install/`](../../../../scripts/install/) beside `install.sh` / `install.ps1` as `uninstall.sh` / `uninstall.ps1`, is copied and checksummed by [`site/install/build.mjs`](../../../../site/install/build.mjs), and deploys to Cloudflare Pages through the existing [`deploy-install-site.yaml`](../../../../.github/workflows/deploy-install-site.yaml) flow on a superproject `v*` tag.

**Coverage (all historical names, same inventory as 003c):**

| Asset class | Names |
|---|---|
| npm global packages | `@legioncodeinc/{honeycomb,nectar,hive,doctor}`; legacy: `@deeplake/hivemind` plus any legacy unscoped/legacy-scoped names found in the repos' migration code (hivemind, hivedoctor, hivenectar generations) |
| macOS launchd | `com.legioncode.{honeycomb,nectar,doctor,hive}`; legacy `ai.honeycomb.daemon`, `com.hivenectar.daemon`, `com.legioncode.hivedoctor`, `thehive` |
| Linux systemd-user | `{honeycomb,nectar,doctor,hive}.service` per each repo's unit naming; legacy `hivenectar.service`, `hivedoctor.service`, `thehive.service` |
| Windows scheduled tasks | current per-product task names; legacy `HivenectarDaemon`, `HiveDoctor`, `thehive` |
| State dirs | `~/.apiary` (whole fleet root incl. `registry.json`, `device.json`), `~/.deeplake`, legacy `~/.hivemind`, `~/.honeycomb` |

## Goals

- One pasted command fully purges all Apiary assets on macOS, Linux, and Windows, with zero pre-installed Apiary tooling required.
- The script is self-contained shell/PowerShell: service and directory removal work even when Node/npm is broken; npm package removal is best-effort with a clear report when npm is unavailable.
- Published exactly like the installer: routes on `get.theapiary.sh`, `text/plain` + `nosniff` headers, entries in `SHA256SUMS`, listed on the inspect page, byte-identical to what was checksummed at the tag.
- Confirmation-gated interactively, with `--yes` (`-Yes` in PowerShell) for non-interactive use, mirroring `doctor purge`.

## Non-Goals

- Product selection or partial uninstall: the script is all-or-nothing; surgical removal is 003b's per-product verb.
- Changing the install site's architecture: no new worker logic beyond serving the new static routes; combo/alias URL behavior (PRD-002a) is untouched.
- Server-side/team state deletion: machine-local only.
- Installer changes: `install.sh` / `install.ps1` are siblings, not modified (beyond the shared inventory, if one is generated).

## Acceptance criteria

| ID | Criterion |
|---|---|
| d-AC-1 | `curl -fsSL https://get.theapiary.sh/uninstall \| sh` on a machine with the full fleet installed removes every service unit, npm package, and state dir in the coverage table, and reports what it removed (parent AC-6). |
| d-AC-2 | The PowerShell variant (`irm https://get.theapiary.sh/uninstall.ps1 \| iex`) achieves the same result on Windows, including scheduled-task removal (parent AC-6). |
| d-AC-3 | On a machine with only legacy-generation artifacts (e.g. `@deeplake/hivemind`, `com.hivenectar.daemon`, `~/.hivemind`) and no current fleet, the script removes them all (parent AC-6). |
| d-AC-4 | With Node/npm absent or broken, the script still removes all service units and state dirs, and plainly reports which npm packages it could not remove and the one command to finish the job (parent AC-9). |
| d-AC-5 | `GET /uninstall`, `/uninstall.sh`, and `/uninstall.ps1` serve `text/plain` with `nosniff`; `SHA256SUMS` contains entries for both scripts; `sha256sum -c` verifies against the served bytes (parent AC-7). |
| d-AC-6 | The scripts are built into the site by `build.mjs` from `scripts/install/` and deployed by the existing `deploy-install-site.yaml` on a superproject `v*` tag, with the inspect page showing their checksums (parent AC-7). |
| d-AC-7 | Interactive runs require an explicit confirmation naming the destruction (including `~/.deeplake`); `--yes` / `-Yes` is the only bypass; deletion is restricted to the enumerated allow-list with no wildcard traversal outside it (parent AC-5-style gating, AC-8). |

## Implementation notes

- **Route conventions.** Mirror the installer exactly: bare `/uninstall` serves the shell script the way `/` + `/install.sh` do today, `/uninstall.ps1` the PowerShell twin; pin content types in [`site/install/_headers`](../../../../site/install/_headers); extend `SHA256SUMS` and the inspect page template ([`index.template.html`](../../../../site/install/index.template.html)) via [`build.mjs`](../../../../site/install/build.mjs). Note the README's rule: only un-prefixed checksummed routes are covered by `SHA256SUMS`; keep the uninstall routes inside that guarantee (no dynamic prefixing).
- **Confirmation over a pipe.** `curl ... | sh` leaves stdin attached to the pipe, not the TTY; the script must read the confirmation from `/dev/tty` when available and refuse to proceed (with instructions to pass `--yes` or download-then-run) when no TTY exists, rather than hanging or silently proceeding (parent AC-9).
- **Delegate when possible, standalone always.** If doctor is installed and functional the script MAY delegate to `doctor purge --yes` for the npm layer, but every removal must also have a pure-shell path; the flagged open question on delegation is parent-level.
- **Shared inventory with 003c.** The coverage table must be derived from the same code-derived inventory 003c uses (each repo's `SERVICE_LABEL` / `LEGACY_*` constants and migration code), ideally generated at site build time, so script and CLI can never disagree about what "everything" means.
- **Ordering.** Stop/remove services first (current then legacy labels), npm packages next, state dirs last (so a failed early step leaves logs and registry intact for diagnosis), mirroring 003c's resumability property.

## Open questions

- [ ] **Route spelling:** `/uninstall` serving shell (matching `/` for install) with `/uninstall.sh` + `/uninstall.ps1` as explicit twins, or only the explicit filenames? Proposed: all three, all checksummed.
- [ ] **Non-TTY default:** when piped with no `/dev/tty` and no `--yes`, hard-refuse (proposed) or proceed after a delay? Hard-refuse matches the security posture.
- [ ] **Inventory generation:** hand-written coverage tables in both 003c and the script, or one generated manifest consumed by both? Generated is proposed; where it lives (superproject script vs site build step) is open.
- [ ] **sudo/system scope:** doctor and nectar can register system-scope units in some configurations (`/Library/LaunchDaemons`, `/etc/systemd/system`); does the script attempt `sudo` escalation for those, or report them with the exact command to run?

## Related

- [`scripts/install/install.sh`](../../../../scripts/install/install.sh) and [`install.ps1`](../../../../scripts/install/install.ps1) - the siblings whose conventions (structure, logging, flag style) the uninstall scripts copy.
- [`site/install/build.mjs`](../../../../site/install/build.mjs), [`_headers`](../../../../site/install/_headers), [`_worker.js`](../../../../site/install/_worker.js), [`index.template.html`](../../../../site/install/index.template.html) - the build/serve surface gaining the uninstall routes and checksums.
- [`.github/workflows/deploy-install-site.yaml`](../../../../.github/workflows/deploy-install-site.yaml) - the deploy flow, unchanged in shape, that now also ships the uninstall scripts.
- [`site/install/README.md`](../../../../site/install/README.md) - documents the checksum and header conventions this sub-PRD mirrors.
- [003c](./prd-003c-fleet-lifecycle-login-and-uninstall-doctor-purge.md) - the CLI purge sharing the coverage inventory and confirmation posture.
