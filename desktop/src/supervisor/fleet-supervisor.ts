/**
 * PRD-005a: the FleetSupervisor.
 *
 * Keeps the two ROOTS (Doctor + Hive) alive under a bounded policy and reuses Doctor's existing
 * supervision of the workload daemons beneath it (ADR-0005 decision 2 — the shell NEVER restarts a
 * workload directly). Every non-deterministic / side-effecting operation is an injected seam, so
 * the whole class is unit-tested with no real processes, ports, or clocks.
 *
 * Responsibilities, mapped to acceptance criteria:
 *   - a-AC-2  start(): port-check → adopt-or-spawn → health-wait within a startup BUDGET (never hangs).
 *   - a-AC-3  crash → bounded geometric backoff; maxRestarts exhausted → `failed` (terminal, not a loop).
 *   - a-AC-4  stop(): stop every spawned child cleanly, no orphans.
 *   - a-AC-5  a second launch adopts an already-healthy root (via port-check `ours-healthy`), no re-bind.
 *   - a-AC-6  a foreign process on a required port → `port-conflict` (terminal, actionable), never double-bind.
 *   - a-AC-3/boundary  before each (re)spawn, the pid-liveness no-op prevents double-spawning a live root.
 *
 * This module does no argv building or Node resolution itself — those are `launch-spec.ts` /
 * `node-resolver.ts`. It is handed the resolved {@link RootLaunchSpec}s and the seams.
 */

import { createBackoff, type Backoff } from "./backoff.js";
import { isRootAlreadyAlive } from "./pid-liveness.js";
import type {
  FleetStatus,
  FleetSupervisor,
  RootLaunchSpec,
  RootName,
  RootPhase,
  RootStatus,
  SpawnedProcess,
  SupervisorPolicy,
  SupervisorSeams,
} from "./types.js";

/** Sensible defaults; tests override to keep runs instant, production overrides for real budgets. */
export const DEFAULT_POLICY: SupervisorPolicy = {
  probeTimeoutMs: 2000,
  startupPollIntervalMs: 250,
  startupBudgetMs: 30_000,
  backoffFloorMs: 1000,
  backoffCeilingMs: 30_000,
  maxRestarts: 5,
};

/** Mutable per-root supervision state (internal). */
interface RootRuntime {
  readonly spec: RootLaunchSpec;
  phase: RootPhase;
  restarts: number;
  detail?: string;
  child?: SpawnedProcess;
  readonly backoff: Backoff;
  /** True once stop() has run, so a late crash callback does not trigger a restart (a-AC-4). */
  shuttingDown: boolean;
}

/** Construct a {@link FleetSupervisor} over the resolved launch specs, seams, and policy. */
export function createFleetSupervisor(
  specs: readonly RootLaunchSpec[],
  seams: SupervisorSeams,
  policy: SupervisorPolicy = DEFAULT_POLICY,
): FleetSupervisor {
  const roots = new Map<RootName, RootRuntime>();
  for (const spec of specs) {
    roots.set(spec.name, {
      spec,
      phase: "idle",
      restarts: 0,
      backoff: createBackoff({ floorMs: policy.backoffFloorMs, ceilingMs: policy.backoffCeilingMs, random: Math.random }),
      shuttingDown: false,
    });
  }

  const hiveReadyListeners = new Set<() => void>();
  const statusListeners = new Set<(status: FleetStatus) => void>();
  let started = false;
  let stopping = false;

  function snapshot(): FleetStatus {
    const rootStatuses: RootStatus[] = [];
    for (const rt of roots.values()) {
      rootStatuses.push({
        name: rt.spec.name,
        phase: rt.phase,
        port: rt.spec.port,
        restarts: rt.restarts,
        ...(rt.detail !== undefined ? { detail: rt.detail } : {}),
      });
    }
    const allHealthy = rootStatuses.length > 0 && rootStatuses.every((r) => r.phase === "healthy");
    const hasTerminalFailure = rootStatuses.some((r) => r.phase === "failed" || r.phase === "port-conflict");
    return { roots: rootStatuses, allHealthy, hasTerminalFailure };
  }

  function emitStatus(): void {
    const status = snapshot();
    for (const listener of statusListeners) {
      try {
        listener(status);
      } catch (error) {
        seams.logger.warn("status listener threw", { error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  function setPhase(rt: RootRuntime, phase: RootPhase, detail?: string): void {
    rt.phase = phase;
    rt.detail = detail;
    seams.logger.info("root phase", { root: rt.spec.name, phase, ...(detail !== undefined ? { detail } : {}) });
    if (rt.spec.name === "hive" && phase === "healthy") {
      for (const listener of hiveReadyListeners) {
        try {
          listener();
        } catch (error) {
          seams.logger.warn("hive-ready listener threw", { error: error instanceof Error ? error.message : String(error) });
        }
      }
    }
    emitStatus();
  }

  /** Poll `/health` until ok or the startup budget elapses (a-AC-2: never hangs). Returns true iff it went healthy. */
  async function waitHealthy(rt: RootRuntime): Promise<boolean> {
    const deadline = seams.clock() + policy.startupBudgetMs;
    for (;;) {
      if (rt.shuttingDown) return false;
      const result = await seams.probeHealth(rt.spec.healthUrl, policy.probeTimeoutMs);
      if (result.kind === "ok") return true;
      if (seams.clock() >= deadline) return false;
      const nap = seams.sleep(policy.startupPollIntervalMs);
      await nap.promise;
    }
  }

  /**
   * (Re)spawn a root, honoring the pid-liveness no-op boundary. Wires an exit handler that drives
   * the bounded-restart policy. Does NOT wait for health — callers pair this with {@link waitHealthy}.
   * Returns false if the root was already alive (no-op) or the spawn errored synchronously.
   */
  function spawnRoot(rt: RootRuntime): boolean {
    // Boundary (ADR-0005 decision 3): never double-spawn a live root. BOTH halves of the check are
    // injected seams (the pid-file read AND the liveness probe), so the boundary is unit-testable
    // with no real filesystem or process.
    if (isRootAlreadyAlive(rt.spec.pidPath, { isPidAlive: seams.isPidAlive, readFile: seams.readPidFile })) {
      seams.logger.info("root already alive (pid-liveness no-op)", { root: rt.spec.name });
      return false;
    }

    let child: SpawnedProcess;
    try {
      child = seams.spawn(rt.spec.command, rt.spec.args);
    } catch (error) {
      setPhase(rt, "failed", `spawn failed: ${error instanceof Error ? error.message : "unknown"}`);
      return false;
    }
    rt.child = child;

    child.onError((error) => {
      seams.logger.error("root spawn error", { root: rt.spec.name, error: error.message });
      // A spawn-level error (ENOENT/EINVAL) is treated like a crash so the bounded policy applies.
      handleExit(rt, null);
    });
    child.onExit((code) => {
      handleExit(rt, code);
    });
    return true;
  }

  /** Handle a root exit: if we are not shutting down, apply the bounded-restart policy (a-AC-3). */
  function handleExit(rt: RootRuntime, code: number | null): void {
    if (rt.shuttingDown || stopping) {
      // Expected exit during shutdown (a-AC-4): do not restart.
      return;
    }
    seams.logger.warn("root exited", { root: rt.spec.name, code });
    rt.child = undefined;

    if (rt.restarts >= policy.maxRestarts) {
      // a-AC-3: repeated failures stop retrying and surface an actionable terminal state, not a loop.
      setPhase(
        rt,
        "failed",
        `${rt.spec.name} crashed ${rt.restarts} times and did not recover; giving up. Check the daemon logs and restart the app.`,
      );
      return;
    }

    rt.restarts += 1;
    const delay = rt.backoff.delayMs();
    rt.backoff.advance();
    setPhase(rt, "restarting", `restarting after crash (attempt ${rt.restarts}/${policy.maxRestarts})`);

    const nap = seams.sleep(delay);
    void nap.promise.then(async () => {
      if (rt.shuttingDown || stopping) return;
      const spawned = spawnRoot(rt);
      if (!spawned) return; // pid-liveness no-op, or a synchronous spawn failure already set `failed`.
      setPhase(rt, "starting", `restarted (attempt ${rt.restarts}/${policy.maxRestarts})`);
      const healthy = await waitHealthy(rt);
      if (rt.shuttingDown || stopping) return;
      if (healthy) {
        rt.backoff.reset();
        setPhase(rt, "healthy");
      } else {
        // The restart did not come back healthy within budget: count it and let the next exit (or
        // this path on a future crash) advance toward give-up. Surface the stall now.
        setPhase(rt, "restarting", `restart did not become healthy within budget (attempt ${rt.restarts}/${policy.maxRestarts})`);
      }
    });
  }

  /** Bring one root up: port-check (adopt vs foreign vs free) → spawn → health-wait (a-AC-2/a-AC-5/a-AC-6). */
  async function startRoot(rt: RootRuntime): Promise<void> {
    setPhase(rt, "starting");

    const holder = await seams.checkPort(rt.spec.port, rt.spec.healthUrl, policy.probeTimeoutMs);
    if (holder.kind === "ours-healthy") {
      // a-AC-5/a-AC-6: an already-healthy root of ours — adopt it, do not re-spawn or re-bind.
      seams.logger.info("adopted already-healthy root", { root: rt.spec.name, port: rt.spec.port });
      setPhase(rt, "healthy");
      return;
    }
    if (holder.kind === "foreign") {
      // a-AC-6: a foreign process holds a required port. Terminal + actionable; never double-bind.
      setPhase(rt, "port-conflict", holder.detail);
      return;
    }

    const spawned = spawnRoot(rt);
    if (!spawned) {
      // Either the pid-liveness no-op fired (a live root we do not have a child handle for) or the
      // spawn failed synchronously (phase already `failed`). If a live pid exists, verify health.
      if (rt.phase !== "failed") {
        const healthy = await waitHealthy(rt);
        setPhase(rt, healthy ? "healthy" : "failed", healthy ? undefined : "an existing process holds the pid but is not healthy");
      }
      return;
    }

    const healthy = await waitHealthy(rt);
    if (rt.shuttingDown || stopping) return;
    if (healthy) {
      setPhase(rt, "healthy");
    } else {
      // a-AC-2: startup did not hang — the budget elapsed. Surface an actionable terminal state.
      setPhase(rt, "failed", `${rt.spec.name} did not become healthy within ${policy.startupBudgetMs}ms; check the daemon and try again.`);
    }
  }

  return {
    async start(): Promise<FleetStatus> {
      if (started) return snapshot();
      started = true;
      // Start Doctor first (the workload supervisor), then Hive (the dashboard host), per ADR-0005.
      for (const rt of roots.values()) {
        await startRoot(rt);
      }
      return snapshot();
    },

    async stop(): Promise<void> {
      if (stopping) return;
      stopping = true;
      // Mark every root shutting-down BEFORE stopping any child so a crash callback mid-teardown
      // cannot trigger a restart (a-AC-4: no orphan, no resurrection).
      for (const rt of roots.values()) rt.shuttingDown = true;
      await Promise.all(
        [...roots.values()].map(async (rt) => {
          if (rt.child !== undefined) {
            try {
              await rt.child.stop();
            } catch (error) {
              seams.logger.warn("error stopping root child", { root: rt.spec.name, error: error instanceof Error ? error.message : String(error) });
            }
            rt.child = undefined;
          }
          setPhase(rt, "stopped");
        }),
      );
    },

    getFleetStatus(): FleetStatus {
      return snapshot();
    },

    onHiveReady(listener: () => void): () => void {
      const hive = roots.get("hive");
      if (hive !== undefined && hive.phase === "healthy") {
        // Already healthy: fire immediately so a late subscriber is not stranded.
        try {
          listener();
        } catch (error) {
          seams.logger.warn("hive-ready listener threw", { error: error instanceof Error ? error.message : String(error) });
        }
        return () => undefined;
      }
      hiveReadyListeners.add(listener);
      return () => hiveReadyListeners.delete(listener);
    },

    onStatusChange(listener: (status: FleetStatus) => void): () => void {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
  };
}
