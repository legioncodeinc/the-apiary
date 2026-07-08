/**
 * PRD-005a: build the {@link RootLaunchSpec} for each of the two roots (Doctor + Hive).
 *
 * The argv is `<sidecarNode> <globalCliEntry> start` — the resolved system/sidecar Node as
 * `command` (a-AC-1: never Electron's execPath), and a resolved `*.js` CLI entry as argv[0]
 * (a-AC-7: never a `.cmd`, so `shell:false` is always legal on Windows). The daemons then read
 * `process.execPath` (= the sidecar node) for their OWN self-spawns, exactly as ADR-0005 requires.
 *
 * The global CLIs are `@legioncodeinc/hive` (bin `dist/cli.js`) and `@legioncodeinc/doctor`
 * (bin `bundle/cli.js`), installed under the npm global root. We resolve their entry `*.js`
 * under `<globalRoot>/@legioncodeinc/<pkg>/<bin-relative>`. All lookups are seam-injectable.
 *
 * Loopback contract (ADR-0005): doctor `:3852`, hive `:3853`. Health is `/health` on each.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

import type { RootLaunchSpec, RootName } from "./types.js";

/** The two roots' fixed loopback ports (ADR-0005). */
export const ROOT_PORTS: Record<RootName, number> = {
  doctor: 3852,
  hive: 3853,
};

/** Per-root: the global npm package and the bin entry relative to the package root. */
const ROOT_PACKAGES: Record<RootName, { readonly pkg: string; readonly binRelative: string }> = {
  doctor: { pkg: "@legioncodeinc/doctor", binRelative: join("bundle", "cli.js") },
  hive: { pkg: "@legioncodeinc/hive", binRelative: join("dist", "cli.js") },
};

/** The verb each root's CLI takes to start its daemon. */
const START_VERB = "start";

/** Injectable seams so launch-spec building needs no real filesystem. */
export interface LaunchSpecSeams {
  /** The env to read npm-global hints from. Default `process.env`. */
  readonly env?: NodeJS.ProcessEnv;
  /** The platform (win32 changes the global-root default). Default `process.platform`. */
  readonly platform?: NodeJS.Platform;
  /** The home dir the fleet pid files anchor under. Default `homedir()`. */
  readonly home?: string;
  /** Does a path exist? Default `existsSync`. Used to pick the first global root that has the package. */
  readonly exists?: (path: string) => boolean;
  /** Explicit npm global root(s) to search first (highest priority). Injected by tests. */
  readonly globalRoots?: readonly string[];
}

/** Thrown when a required global CLI cannot be located. Actionable, never a raw stack. */
export class LaunchSpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LaunchSpecError";
  }
}

/**
 * Candidate npm global roots, in priority order:
 *   1. explicit `globalRoots` (tests / an operator override),
 *   2. `$npm_config_prefix`/`$PREFIX` node_modules,
 *   3. the OS default (win32: `%APPDATA%\npm\node_modules`; posix: `/usr/local/lib/node_modules`),
 *   4. each PATH-adjacent `node_modules` (best-effort).
 */
function candidateGlobalRoots(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, explicit?: readonly string[]): string[] {
  const roots: string[] = [];
  if (explicit) roots.push(...explicit);

  const prefix = env.npm_config_prefix ?? env.PREFIX;
  if (typeof prefix === "string" && prefix.trim() !== "") {
    roots.push(platform === "win32" ? join(prefix, "node_modules") : join(prefix, "lib", "node_modules"));
  }

  if (platform === "win32") {
    const appData = env.APPDATA;
    if (typeof appData === "string" && appData.trim() !== "") {
      roots.push(join(appData, "npm", "node_modules"));
    }
  } else {
    roots.push(join("/usr", "local", "lib", "node_modules"));
    roots.push(join("/usr", "lib", "node_modules"));
  }

  const pathValue = env.PATH ?? env.Path ?? "";
  for (const dir of pathValue.split(delimiter)) {
    if (dir.trim() === "") continue;
    roots.push(join(dir, "node_modules"));
    roots.push(join(dir, "..", "lib", "node_modules"));
  }

  return roots;
}

/** Resolve the on-disk `*.js` entry for one root's global CLI, or throw an actionable error. */
export function resolveCliEntry(name: RootName, seams: LaunchSpecSeams = {}): string {
  const env = seams.env ?? process.env;
  const platform = seams.platform ?? process.platform;
  const exists = seams.exists ?? existsSync;
  const { pkg, binRelative } = ROOT_PACKAGES[name];

  const roots = candidateGlobalRoots(env, platform, seams.globalRoots);
  const seen = new Set<string>();
  for (const root of roots) {
    const entry = join(root, pkg, binRelative);
    if (seen.has(entry)) continue;
    seen.add(entry);
    if (exists(entry)) return entry;
  }

  throw new LaunchSpecError(
    `Could not locate the globally-installed ${pkg} CLI (${binRelative}). ` +
      `Install it with \`npm i -g ${pkg}\`, or ensure the npm global root is discoverable.`,
  );
}

/**
 * Default per-root pid path under the neutral fleet root `~/.apiary/<name>/daemon.pid`
 * (ADR-0003 layout the shell's supervisor state lives beside). Used for the pid-liveness no-op.
 */
export function defaultPidPath(name: RootName, home: string): string {
  return join(home, ".apiary", name, "daemon.pid");
}

/** Build the {@link RootLaunchSpec} for one root: resolved sidecar node + resolved CLI entry + loopback contract. */
export function buildRootLaunchSpec(name: RootName, sidecarNode: string, seams: LaunchSpecSeams = {}): RootLaunchSpec {
  const home = seams.home ?? homedir();
  const port = ROOT_PORTS[name];
  const entry = resolveCliEntry(name, seams);
  return {
    name,
    command: sidecarNode,
    args: [entry, START_VERB],
    port,
    healthUrl: `http://127.0.0.1:${port}/health`,
    pidPath: defaultPidPath(name, home),
  };
}

/** Build both roots' launch specs in the canonical start order (Doctor first, then Hive). */
export function buildRootLaunchSpecs(sidecarNode: string, seams: LaunchSpecSeams = {}): readonly RootLaunchSpec[] {
  return [buildRootLaunchSpec("doctor", sidecarNode, seams), buildRootLaunchSpec("hive", sidecarNode, seams)];
}
