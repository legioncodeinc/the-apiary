/**
 * PRD-005a a-AC-1: resolve the REAL system Node ≥22.5 to spawn the daemons with.
 *
 * The forcing function (ADR-0005 decision 1): in the Electron main process `process.execPath`
 * is the ELECTRON binary, not node, with a different flag posture. Nectar re-spawns itself with
 * `spawn(process.execPath, ["--experimental-sqlite", …])` and Honeycomb spawns the embed daemon
 * via `execPath`; running either under Electron's Node breaks both self-spawns. So the shell must
 * spawn the roots with a real, standalone Node ≥22.5 as their `execPath` — the daemons then
 * re-invoke THAT node for their own self-spawns, which is exactly right.
 *
 * This module finds that node. For this skeleton it uses the machine's SYSTEM node (found on PATH,
 * or via an explicit override / documented Windows default). Vendored per-OS Node is a later 005d
 * follow-up (ADR-0005 negative: the sidecar artifact). Fully seam-injectable: PATH lookup, the
 * version probe, and existence are all injected, so resolution is unit-tested with no real spawn.
 *
 * Built-ins only (node:child_process, node:path, node:fs), argv-safe by construction.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join, win32 as pathWin32 } from "node:path";

/** The minimum acceptable Node version (ADR-0005 decision 1: "a real Node ≥22.5"). */
export const MIN_NODE_MAJOR = 22;
export const MIN_NODE_MINOR = 5;

/** A parsed semver-ish triple. */
export interface NodeVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

/** Injectable seams so the resolver is testable with no real filesystem or process. */
export interface NodeResolverSeams {
  /** The env to read PATH / override from. Default `process.env`. */
  readonly env?: NodeJS.ProcessEnv;
  /** The platform, so the Windows `node.exe` default is only tried on win32. Default `process.platform`. */
  readonly platform?: NodeJS.Platform;
  /** Does a path exist and look like a file? Default `existsSync`. */
  readonly exists?: (path: string) => boolean;
  /**
   * Run `<candidate> --version` and return its stdout (e.g. "v22.5.1\n"), or throw if the
   * candidate is not a runnable node. Default runs `execFileSync` with `shell:false` (argv-safe).
   */
  readonly probeVersion?: (candidate: string) => string;
}

/** Thrown when no system Node ≥22.5 can be found. Actionable, never a raw stack (a-AC-1). */
export class NodeResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NodeResolutionError";
  }
}

/** The env var an operator may set to point the shell at an exact node binary, bypassing PATH search. */
export const NODE_OVERRIDE_ENV = "APIARY_SIDECAR_NODE";

/**
 * The documented Windows default install path for the system Node, tried when PATH search misses.
 * Built with `path.win32` (NOT the host-dependent `join`) so this is always the Windows form even
 * when the win32 branch is exercised on a POSIX host (e.g. CI on Linux/macOS) — otherwise POSIX
 * `join` would yield a malformed `C:\/Program Files/...` and the win32 fallback would never match.
 */
const WINDOWS_DEFAULT_NODE = pathWin32.join("C:\\", "Program Files", "nodejs", "node.exe");

/** Parse `v22.5.1` / `22.5.1` into a {@link NodeVersion}, or `null` if it is not a version string. */
export function parseNodeVersion(raw: string): NodeVersion | null {
  const match = /v?(\d+)\.(\d+)\.(\d+)/.exec(raw.trim());
  if (match === null) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (!Number.isInteger(major) || !Number.isInteger(minor) || !Number.isInteger(patch)) return null;
  return { major, minor, patch };
}

/** True iff `version` is at least the minimum (major, then minor) required by ADR-0005. */
export function meetsMinimum(version: NodeVersion): boolean {
  if (version.major > MIN_NODE_MAJOR) return true;
  if (version.major < MIN_NODE_MAJOR) return false;
  return version.minor >= MIN_NODE_MINOR;
}

/** Default version probe: `<candidate> --version`, argv-safe (`shell:false` is execFileSync's default). */
function defaultProbeVersion(candidate: string): string {
  return execFileSync(candidate, ["--version"], { encoding: "utf8", timeout: 5000 });
}

/** Build the ORDERED list of candidate node paths: explicit override, then each PATH entry's node, then the Windows default. */
function candidatePaths(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  const candidates: string[] = [];

  const override = env[NODE_OVERRIDE_ENV];
  if (typeof override === "string" && override.trim() !== "") {
    candidates.push(override.trim());
  }

  const exeName = platform === "win32" ? "node.exe" : "node";
  const pathValue = env.PATH ?? env.Path ?? "";
  for (const dir of pathValue.split(delimiter)) {
    if (dir.trim() === "") continue;
    candidates.push(join(dir, exeName));
  }

  if (platform === "win32") {
    candidates.push(WINDOWS_DEFAULT_NODE);
  }

  return candidates;
}

/** The result of a successful resolution: the runnable node path and the version it reported. */
export interface ResolvedNode {
  readonly path: string;
  readonly version: NodeVersion;
}

/**
 * Resolve a system Node ≥22.5 (a-AC-1). Tries an explicit override, every PATH entry, then the
 * Windows default; the FIRST candidate that (a) exists and (b) reports a version ≥22.5 wins.
 * Throws {@link NodeResolutionError} with an actionable message when none qualifies — the shell
 * surfaces this to the user rather than spawning the daemons under the wrong runtime.
 */
export function resolveSystemNode(seams: NodeResolverSeams = {}): ResolvedNode {
  const env = seams.env ?? process.env;
  const platform = seams.platform ?? process.platform;
  const exists = seams.exists ?? existsSync;
  const probeVersion = seams.probeVersion ?? defaultProbeVersion;

  const candidates = candidatePaths(env, platform);
  const seen = new Set<string>();
  let sawNodeButTooOld: NodeVersion | null = null;

  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    if (!exists(candidate)) continue;

    let output: string;
    try {
      output = probeVersion(candidate);
    } catch {
      // Not a runnable node (or the probe failed): try the next candidate.
      continue;
    }

    const version = parseNodeVersion(output);
    if (version === null) continue;
    if (meetsMinimum(version)) {
      return { path: candidate, version };
    }
    // A real node, but too old: remember it so the error message can be specific.
    sawNodeButTooOld = version;
  }

  if (sawNodeButTooOld !== null) {
    const found = `${sawNodeButTooOld.major}.${sawNodeButTooOld.minor}.${sawNodeButTooOld.patch}`;
    throw new NodeResolutionError(
      `Found Node ${found} but the Apiary fleet requires Node >=${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}. ` +
        `Install a newer Node, or set ${NODE_OVERRIDE_ENV} to a Node >=${MIN_NODE_MAJOR}.${MIN_NODE_MINOR} binary.`,
    );
  }

  throw new NodeResolutionError(
    `Could not find a system Node >=${MIN_NODE_MAJOR}.${MIN_NODE_MINOR} on PATH. ` +
      `Install Node, or set ${NODE_OVERRIDE_ENV} to the full path of a Node >=${MIN_NODE_MAJOR}.${MIN_NODE_MINOR} binary.`,
  );
}
