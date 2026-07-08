/**
 * PRD-005c c-AC-4: PURE per-OS argv construction to STOP + DEREGISTER one Apiary service unit.
 *
 * Every command is an ARGV ARRAY (never a shell string) so the caller's {@link runCommand} seam can
 * spawn it with `shell: false` — no config- or label-derived string is ever concatenated into a
 * shell. This mirrors the supervisor's a-AC-7 spawn discipline (`src/supervisor/spawn.ts`).
 *
 * Windows (schtasks) is the VERIFIED path (unit-tested argv, exercised on this Windows host).
 * macOS (launchctl) and Linux (systemctl --user) argv are PRESENT and unit-tested for shape, but
 * their LIVE execution is CI-deferred — this Windows-only build never runs them against a real
 * machine, and the plist/unit file PATHS are derived (see the per-platform notes) and must be
 * confirmed against the fleet's real service modules before a mac/linux ship.
 *
 * These functions construct argv ONLY. They never spawn, never touch the filesystem, and never
 * decide idempotency — that is the takeover orchestrator's job over the {@link runCommand} seam.
 */

import type { ServiceOs } from "./os.js";
import type { ServiceUnitLabel } from "./labels.js";

/** One argv-safe command: the program plus its argument vector. Never a shell string (c-AC-4). */
export interface Command {
  /** A short, stable id for the audit log (e.g. `schtasks-delete`), never a credential. */
  readonly id: string;
  /** The program to run (e.g. `schtasks`, `launchctl`, `systemctl`, `rm`). */
  readonly file: string;
  /** The argument vector. Values are labels/paths from our own constants, never external input. */
  readonly args: readonly string[];
  /**
   * True iff a non-zero exit for THIS command should be treated as "already absent" (idempotent),
   * not a failure — e.g. deleting a task that was never registered. The takeover uses this to stay
   * idempotent (re-running is a no-op) without needing per-OS exit-code knowledge at the call site.
   */
  readonly tolerateFailure: boolean;
}

/** The ordered STOP→DEREGISTER command sequence for one unit on one OS (empty if nothing to do). */
export interface DeregisterPlan {
  readonly unit: ServiceUnitLabel;
  readonly os: ServiceOs;
  readonly commands: readonly Command[];
}

/**
 * Windows (schtasks). VERIFIED path.
 *   1. `schtasks /End /TN <name>`    — stop a running instance (tolerated: not-running is fine).
 *   2. `schtasks /Delete /TN <name> /F` — deregister the task, `/F` = no interactive confirm.
 * Both tolerate a non-zero exit so re-running against an already-absent task is a clean no-op.
 */
function windowsCommands(unit: ServiceUnitLabel): readonly Command[] {
  return [
    { id: "schtasks-end", file: "schtasks", args: ["/End", "/TN", unit.schtasksName], tolerateFailure: true },
    { id: "schtasks-delete", file: "schtasks", args: ["/Delete", "/TN", unit.schtasksName, "/F"], tolerateFailure: true },
  ];
}

/**
 * The per-user LaunchAgents plist path launchd loads a user agent from. DERIVED from the standard
 * `~/Library/LaunchAgents/<label>.plist` convention.
 *
 * TODO(005c-confirm): confirm the plist directory + filename against the fleet's real macOS service
 * module before shipping the mac path (submodule dirs are empty in this worktree).
 */
export function launchdPlistPath(homeDir: string, unit: ServiceUnitLabel): string {
  return `${homeDir}/Library/LaunchAgents/${unit.launchdLabel}.plist`;
}

/**
 * macOS (launchctl). PRESENT, live-CI-deferred.
 *   1. `launchctl bootout gui/<uid>/<label>` — the modern unload (stops + unloads the agent).
 *   2. `rm -f <plist>`                        — remove the plist so it is not reloaded at next login.
 * `bootout` tolerates failure (agent not loaded is fine). We use `bootout` (not the deprecated
 * `unload`) but keep `rm` idempotent via `-f`.
 */
function macosCommands(unit: ServiceUnitLabel, uid: number, homeDir: string): readonly Command[] {
  return [
    {
      id: "launchctl-bootout",
      file: "launchctl",
      args: ["bootout", `gui/${uid}/${unit.launchdLabel}`],
      tolerateFailure: true,
    },
    { id: "rm-plist", file: "rm", args: ["-f", launchdPlistPath(homeDir, unit)], tolerateFailure: true },
  ];
}

/**
 * The per-user systemd unit file path. DERIVED from the standard `~/.config/systemd/user/<unit>`
 * convention for `systemctl --user` units.
 *
 * TODO(005c-confirm): confirm the unit-file directory against the fleet's real Linux service module.
 */
export function systemdUnitPath(homeDir: string, unit: ServiceUnitLabel): string {
  return `${homeDir}/.config/systemd/user/${unit.systemdUnit}`;
}

/**
 * Linux (systemctl --user). PRESENT, live-CI-deferred.
 *   1. `systemctl --user disable --now <unit>` — stop (`--now`) AND remove the enable symlink.
 *   2. `rm -f <unitfile>`                        — remove the unit file itself.
 *   3. `systemctl --user daemon-reload`          — let systemd forget the removed unit.
 * `disable --now` tolerates failure (unit not present is fine); `rm -f` is idempotent.
 */
function linuxCommands(unit: ServiceUnitLabel, homeDir: string): readonly Command[] {
  return [
    {
      id: "systemctl-disable",
      file: "systemctl",
      args: ["--user", "disable", "--now", unit.systemdUnit],
      tolerateFailure: true,
    },
    { id: "rm-unit", file: "rm", args: ["-f", systemdUnitPath(homeDir, unit)], tolerateFailure: true },
    { id: "systemctl-daemon-reload", file: "systemctl", args: ["--user", "daemon-reload"], tolerateFailure: true },
  ];
}

/** Per-OS context the argv builders need beyond the label (uid/home for the file-path'd platforms). */
export interface OsContext {
  /** The current OS family. */
  readonly os: ServiceOs;
  /** The user's home dir (mac/linux plist + unit-file paths). Ignored on Windows. */
  readonly homeDir: string;
  /** The numeric uid for the launchctl `gui/<uid>` domain (macOS only). */
  readonly uid: number;
}

/**
 * Build the ordered STOP→DEREGISTER command sequence for one unit on the given OS. Returns an empty
 * plan for `unsupported`. Pure: constructs argv only, spawns nothing.
 */
export function buildDeregisterPlan(unit: ServiceUnitLabel, ctx: OsContext): DeregisterPlan {
  let commands: readonly Command[];
  switch (ctx.os) {
    case "windows":
      commands = windowsCommands(unit);
      break;
    case "macos":
      commands = macosCommands(unit, ctx.uid, ctx.homeDir);
      break;
    case "linux":
      commands = linuxCommands(unit, ctx.homeDir);
      break;
    case "unsupported":
      commands = [];
      break;
  }
  return { unit, os: ctx.os, commands };
}
