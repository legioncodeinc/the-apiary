/**
 * PRD-005a: the supervisor barrel + the top-level factory `main.ts` calls.
 *
 * {@link createSupervisor} is the one entry point the Electron main process uses: it resolves the
 * system/sidecar Node ≥22.5 (a-AC-1), builds both roots' argv-safe launch specs (a-AC-7), wires
 * the default production seams, and returns a ready {@link FleetSupervisor}. Node/CLI resolution
 * failures throw an ACTIONABLE error the caller surfaces — they are unrecoverable preconditions.
 */

export * from "./types.js";
export { createFleetSupervisor, DEFAULT_POLICY } from "./fleet-supervisor.js";
export { createDefaultSeams } from "./seams.js";
export {
  resolveSystemNode,
  NodeResolutionError,
  NODE_OVERRIDE_ENV,
  MIN_NODE_MAJOR,
  MIN_NODE_MINOR,
} from "./node-resolver.js";
export { buildRootLaunchSpecs, LaunchSpecError, ROOT_PORTS } from "./launch-spec.js";
export { createNodeSpawn } from "./spawn.js";
export { probeHealth } from "./health-probe.js";
export { createPortCheck } from "./port-check.js";
export { isPidAlive, isRootAlreadyAlive } from "./pid-liveness.js";
export { createBackoff } from "./backoff.js";

import { createFleetSupervisor, DEFAULT_POLICY } from "./fleet-supervisor.js";
import { buildRootLaunchSpecs } from "./launch-spec.js";
import { resolveSystemNode } from "./node-resolver.js";
import { createDefaultSeams } from "./seams.js";
import type { FleetSupervisor, SupervisorPolicy, SupervisorSeams } from "./types.js";

/** Options for {@link createSupervisor}. Everything is optional so `main.ts` can call it bare. */
export interface CreateSupervisorOptions {
  /** Seam overrides (production defaults are used for anything not provided). */
  readonly seams?: Partial<SupervisorSeams>;
  /** Policy overrides (bounded-backoff + startup-budget tuning). */
  readonly policy?: SupervisorPolicy;
}

/**
 * Resolve Node ≥22.5, build both roots' launch specs, wire the production seams, and return a
 * ready {@link FleetSupervisor}. Throws {@link NodeResolutionError} / {@link LaunchSpecError} on an
 * unrecoverable precondition (no system Node, missing global CLI) — the caller surfaces it.
 */
export function createSupervisor(options: CreateSupervisorOptions = {}): FleetSupervisor {
  const node = resolveSystemNode();
  const specs = buildRootLaunchSpecs(node.path);
  const seams = createDefaultSeams(options.seams);
  return createFleetSupervisor(specs, seams, options.policy ?? DEFAULT_POLICY);
}
