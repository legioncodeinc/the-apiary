# Execution Ledger — PRD-005 Apiary Desktop Shell (the-smoker run)

> **Branch:** `worktree-prd-004-005-desktop-shell` · **Package home:** `desktop/` (top-level folder, superproject)
> **Run scope:** Windows-first RUNNABLE skeleton + cross-OS-READY config. Unsigned. mac/linux build + signing/notarization + signed auto-update = **CI-DEFERRED** (marked, not failed).
> **Sidecar Node:** system Node ≥22.5 for the skeleton (Node 25.2.1 present; `node:sqlite` loads without the flag). Vendored per-OS Node = 005d follow-up.
> **Fixed decisions (ADR-0005, do not relitigate):** Shell → {Doctor, Hive}; Doctor keeps sole restart authority over workloads; boundary via registry single-owner + pidPath no-op; auto OS-service takeover; consent-gated Hivemind uninstall (decline aborts install). Renderer = loopback `127.0.0.1:3853`. Auth + storage = Deep Lake, unchanged.
> **Env caveat:** submodules are empty in this worktree; the skeleton spawns/renders the **globally installed** fleet (`@legioncodeinc/hive@0.6.7`, doctor, nectar, honeycomb→linked). That is the real product's job, so live-dashboard integration is testable here.

Status legend: OPEN · IN PROGRESS · DONE (impl+tests pass) · VERIFIED (independent pass) · CI-DEFERRED (out of local scope by user constraint) · BLOCKED.

## Wave 0 — Scaffold (blocking root)

| ID | Criterion | Owner Bee | Model | Status |
|---|---|---|---|---|
| W0-1 | `desktop/` package: package.json (Electron + electron-builder + vitest + TS), tsconfig, main/preload entry stubs, folder structure, `.gitignore`, build+test+start scripts, README | typescript-node | sonnet | OPEN |

## Wave 1 — Supervisor (005a) + Window (005b)

| ID | Criterion (source) | Owner | Model | Status |
|---|---|---|---|---|
| a-AC-1 | Daemons spawned via system Node ≥22.5 as execPath; nectar `--experimental-sqlite` + honeycomb execPath self-spawns work unmodified | typescript-node | opus | DONE |
| a-AC-2 | On launch: start fleet, health-check each `/health`; startup surfaces progress, never hangs | typescript-node | opus | DONE |
| a-AC-3 | Crashed daemon restarted under bounded backoff; repeated failure stops + surfaces actionable state | typescript-node | opus | DONE |
| a-AC-4 | On quit, every daemon + sidecar stopped cleanly; no orphans | typescript-node | opus | DONE |
| a-AC-5 | Second launch focuses running instance; no 2nd supervisor / no port re-bind (single-instance lock) | typescript-node | opus | DONE |
| a-AC-6 | Port-in-use detected pre-spawn + surfaced actionably; no crash/double-bind | typescript-node | opus | DONE |
| a-AC-7 | All daemon spawns use argv arrays + `shell:false`; no shell-string path | typescript-node | opus | DONE |
| b-AC-1 | Hive dashboard renders in native BrowserWindow (loopback `:3853`); no browser, no manual URL | typescript-node | opus | DONE |
| b-AC-2 | Renderer `contextIsolation:true`, `nodeIntegration:false`, sandbox; no Node reachable | typescript-node | opus | DONE |
| b-AC-3 | Privileged actions only via minimal enumerated preload bridge; no raw ipcRenderer | typescript-node | opus | DONE |
| b-AC-4 | Loading state before host ready; actionable failure if Hive doesn't come up in budget | typescript-node | opus | DONE |
| b-AC-5 | Loopback exposure not widened; Hive gate/token still applies | typescript-node | opus | DONE |
| b-AC-6 | (custom-protocol gate equivalence) — N/A for loopback-first v1 | — | — | CI-DEFERRED (design note only) |
| b-AC-7 | IPC surface for PRD-004 auth window (open https verification URI, close signal), carries no token | typescript-node | opus | DONE |

## Wave 2 — Native integration + autostart + takeover (005c)

| ID | Criterion | Owner | Model | Status |
|---|---|---|---|---|
| c-AC-1 | Tray shows live fleet status + open-dashboard/restart-fleet/quit; works with window closed | typescript-node | opus | OPEN |
| c-AC-2 | ≥1 critical state raises native notification when window unfocused | typescript-node | opus | OPEN |
| c-AC-3 | Launch-at-login via `setLoginItemSettings`; registration verified (reboot behavior = manual/CI) | typescript-node | opus | OPEN |
| c-AC-4 | Adopting shell de-registers per-daemon OS units — current + legacy labels (Windows schtasks verifiable) | typescript-node | opus | OPEN |
| c-AC-5 | Exactly one fleet after login (Windows verified; mac launchd / linux systemd = CI-deferred) | typescript-node | opus | OPEN (partial) |
| c-AC-6 | Doctor + shell non-overlapping ownership (registry single-owner + pidPath no-op); no fighting | typescript-node | opus | OPEN |
| c-AC-7 | Shell uninstall removes launch-at-login, stops fleet, de-registers owned units; no OS-service restore | typescript-node | opus | OPEN |
| c-AC-8 | Standalone Hivemind: detect on install → prompt → consent uninstalls (preserve `~/.deeplake`) / decline aborts install | typescript-node | opus | OPEN |

## Wave 3 — Packaging / updates / distribution (005d)

| ID | Criterion | Owner | Model | Status |
|---|---|---|---|---|
| d-AC-1 | electron-builder config for mac/win/linux; **Windows artifact built locally**, mac/linux = CI-deferred | devops | sonnet | OPEN (win) / CI-DEFERRED (mac,linux) |
| d-AC-2 | Unsigned build installs + launches (Windows verified; mac/linux CI-deferred) | devops | sonnet | OPEN (win) / CI-DEFERRED |
| d-AC-3 | Embeddings model+ONNX packed / offline recall — **model packing = CI-deferred**; skeleton must not break BM25 fallback | devops | sonnet | CI-DEFERRED (packing) / OPEN (don't-break-BM25) |
| d-AC-4 | asar-unpack placement for native + sidecar Node; **sidecar vendoring = 005d follow-up (config only now)** | devops | sonnet | OPEN (config) / CI-DEFERRED (vendor) |
| d-AC-5 | electron-updater wired; unsigned → clear manual "download" prompt (signed auto-update = deferred) | devops | sonnet | OPEN (manual path) / CI-DEFERRED (signed) |
| d-AC-6 | Update artifacts integrity-checked (checksum path in scope; signature = deferred) | devops | sonnet | OPEN (checksum) / CI-DEFERRED (sig) |
| d-AC-7 | Packaging structured so adding signing/notarization later is config, not re-architecture | devops | sonnet | OPEN |
| d-AC-8 | Build consumes submodule/published bundles + respects pinned versions; mismatch fails build | devops | sonnet | OPEN |
| — | GitHub Actions workflow: cross-OS build matrix (mac/win/linux) as config (CI runs deferred) | devops | sonnet | OPEN (config) |

## Module roll-up ACs (PRD-005 index)

| ID | Rolls up | Status |
|---|---|---|
| AC-1 | b-AC-1 | via Wave 1 |
| AC-2 | a-AC-2/3/4 | via Wave 1 |
| AC-3 | a-AC-1 | via Wave 1 |
| AC-4 | c-AC-3/4 | via Wave 2 |
| AC-5 | c-AC-1/2 | via Wave 2 |
| AC-6 | a-AC-5/6 | via Wave 1 |
| AC-7 | d-AC-3 | CI-DEFERRED (packing) |
| AC-8 | b-AC-2/3 | via Wave 1 |
| AC-9 | d-AC-1/2 | via Wave 3 (win) / CI-deferred |
| AC-10 | d-AC-5 | via Wave 3 (manual) / CI-deferred (signed) |
| AC-11 | c-AC-8 | via Wave 2 |

## Close-out

| Step | Bee | Model | Status |
|---|---|---|---|
| Security audit + remediate Critical/High | security-worker-bee | opus | OPEN |
| Quality verify vs PRD-005 | quality-worker-bee | opus | OPEN |

## Blockers / deferrals surfaced

- **CI-DEFERRED (user constraint):** mac/linux installer builds, code signing/notarization, signed auto-update path, actual embeddings-model packing, per-OS Node vendoring. These get wired as **config** now; their execution/verification runs in CI (post-cert).
- **ADR-0005 OQ-4 resolved by env:** Node 25.2.1 loads `node:sqlite` without the flag; nectar's flagged self-spawn remains compatible.
