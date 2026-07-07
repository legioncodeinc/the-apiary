/**
 * PRD-005a: the FleetSupervisor's public contract + injectable seams.
 *
 * This module is the stable interface later waves consume:
 *   - 005b (window)  reads {@link FleetSupervisor.getFleetStatus} + {@link FleetSupervisor.onHiveReady}
 *   - 005c (tray)    reads status + {@link FleetSupervisor.onStatusChange} and calls {@link FleetSupervisor.stop}
 *   - 005c (service) calls the takeover seam alongside {@link FleetSupervisor.start}
 *
 * Everything the supervisor touches that is non-deterministic or side-effecting is a SEAM
 * (a function on {@link SupervisorSeams}), so the whole orchestrator is unit-testable with NO
 * real processes, ports, or clocks. This mirrors the fleet's existing supervisors
 * (doctor `health-probe.ts` / `backoff.ts`, hive `installer/spawn.ts`), which inject the same
 * three things: a spawn fn, a health-probe fn, and a clock/sleep.
 */

/** The two ROOTS the shell keeps alive. Doctor keeps the workload daemons alive, not the shell (ADR-0005 decision 2). */
export type RootName = "doctor" | "hive";

/** The lifecycle phase of a single root, surfaced to the UI so startup never looks hung (a-AC-2). */
export type RootPhase =
  /** No spawn attempted yet. */
  | "idle"
  /** Spawned; waiting for the first healthy `/health`. */
  | "starting"
  /** `/health` answered ok; the root is up. */
  | "healthy"
  /** Crashed and inside the bounded backoff, waiting to retry. */
  | "restarting"
  /** Bounded retries exhausted: a terminal, actionable state (a-AC-3). Not a loop. */
  | "failed"
  /** A required loopback port is held by a FOREIGN process (a-AC-6): actionable, terminal. */
  | "port-conflict"
  /** Stopped cleanly on shutdown (a-AC-4). */
  | "stopped";

/** An immutable snapshot of one root's supervision state. */
export interface RootStatus {
  readonly name: RootName;
  readonly phase: RootPhase;
  /** The loopback port this root binds (doctor 3852, hive 3853). */
  readonly port: number;
  /** How many bounded restarts have been consumed so far. */
  readonly restarts: number;
  /**
   * A human-readable, actionable line when {@link phase} is `failed` or `port-conflict`;
   * `undefined` otherwise. Never carries a credential or a raw stack.
   */
  readonly detail?: string;
}

/** An immutable snapshot of the whole fleet, as the tray/window read it (a-AC-2/a-AC-5). */
export interface FleetStatus {
  readonly roots: readonly RootStatus[];
  /** True once every root is `healthy`. */
  readonly allHealthy: boolean;
  /** True once any root is `failed` or `port-conflict` (the terminal, actionable states). */
  readonly hasTerminalFailure: boolean;
}

/** The four health-probe classifications, mirroring doctor's `health-probe.ts` distinctions. */
export type HealthResult =
  | { readonly kind: "ok" }
  | { readonly kind: "unreachable-refused"; readonly detail: string }
  | { readonly kind: "unreachable-timeout" }
  | { readonly kind: "error"; readonly detail: string };

/** What holds a loopback port when a pre-spawn check finds it occupied (a-AC-6). */
export type PortHolder =
  /** Free: nothing is listening; safe to spawn. */
  | { readonly kind: "free" }
  /** OUR root is already up and answers `/health` ok: adopt it, do not re-spawn (a-AC-5/a-AC-6). */
  | { readonly kind: "ours-healthy" }
  /** SOMETHING binds the port but does not answer our `/health`: a foreign process (a-AC-6). Surface, never double-bind. */
  | { readonly kind: "foreign"; readonly detail: string };

/**
 * The argv-safe spawn seam (a-AC-7). `command` + `args` are ALWAYS an argv array, so no
 * request- or config-derived string is ever concatenated into a shell command. The default
 * implementation passes `shell: false`. Mirrors hive's `SpawnFn` (`installer/spawn.ts`).
 */
export type SpawnFn = (command: string, args: readonly string[]) => SpawnedProcess;

/** A minimal handle over a spawned child, so tests never touch a real process. */
export interface SpawnedProcess {
  /** The OS pid, or `undefined` if the spawn failed before a pid was assigned. */
  readonly pid: number | undefined;
  /** Register a one-shot exit listener (fired on close/crash). */
  onExit(listener: (code: number | null) => void): void;
  /** Register a spawn-level error listener (ENOENT, EINVAL). */
  onError(listener: (error: Error) => void): void;
  /** Request a clean stop; resolves once the child is gone (a-AC-4). Idempotent. */
  stop(): Promise<void>;
}

/** Probe a `/health` URL once, bounded by a timeout. Never throws — errors become classifications (a-AC-2). */
export type HealthProbeFn = (healthUrl: string, timeoutMs: number) => Promise<HealthResult>;

/** Check whether a loopback port is free, held by our healthy root, or held by a foreign process (a-AC-6). */
export type PortCheckFn = (port: number, healthUrl: string, timeoutMs: number) => Promise<PortHolder>;

/** True iff a process with `pid` is currently alive. Backs the pid-liveness no-op (ADR-0005 decision 3). */
export type PidAliveFn = (pid: number) => boolean;

/**
 * Read a root's pid file and return its contents (as a string), or throw if the file is absent.
 * The OTHER half of the pid-liveness no-op: injecting it (alongside {@link PidAliveFn}) makes the
 * boundary fully unit-testable with no real filesystem. The default reads the file with `utf8`.
 */
export type ReadPidFileFn = (pidPath: string) => string;

/** Resolve/return a monotonic timestamp in ms. Injected so tests control time. */
export type ClockFn = () => number;

/** Sleep for `ms`, cancellable via the returned handle's `cancel`. Injected so tests never wait. */
export type SleepFn = (ms: number) => { readonly promise: Promise<void>; cancel(): void };

/** A structured, credential-free log sink. Defaults to `console`. */
export interface SupervisorLogger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

/** Everything the supervisor needs that is non-deterministic or side-effecting. All injectable. */
export interface SupervisorSeams {
  readonly spawn: SpawnFn;
  readonly probeHealth: HealthProbeFn;
  readonly checkPort: PortCheckFn;
  readonly isPidAlive: PidAliveFn;
  /** Read a root's pid file; injected so the pid-liveness no-op needs no real filesystem in tests. */
  readonly readPidFile: ReadPidFileFn;
  readonly clock: ClockFn;
  readonly sleep: SleepFn;
  readonly logger: SupervisorLogger;
}

/** Bounded-backoff + startup-budget tuning (a-AC-2/a-AC-3). */
export interface SupervisorPolicy {
  /** Per-`/health` probe timeout in ms. */
  readonly probeTimeoutMs: number;
  /** Interval between startup health polls in ms. */
  readonly startupPollIntervalMs: number;
  /** Max time to wait for a root to become healthy before giving up on startup (a-AC-2: never hang). */
  readonly startupBudgetMs: number;
  /** Backoff floor in ms (rung-0 base). */
  readonly backoffFloorMs: number;
  /** Backoff ceiling in ms. */
  readonly backoffCeilingMs: number;
  /** Max consecutive restart attempts before a root goes `failed` (a-AC-3: never loop forever). */
  readonly maxRestarts: number;
}

/** How to launch one root: the resolved argv (sidecar-node-aware) and its loopback contract. */
export interface RootLaunchSpec {
  readonly name: RootName;
  /** The command to spawn — always the resolved system/sidecar Node, never Electron's execPath. */
  readonly command: string;
  /** The argv array (daemon entry + flags). Never a shell string (a-AC-7). */
  readonly args: readonly string[];
  /** The loopback port this root binds. */
  readonly port: number;
  /** This root's `/health` URL (loopback only). */
  readonly healthUrl: string;
  /** This root's pid/lock file, for the pid-liveness no-op (ADR-0005 decision 3). */
  readonly pidPath: string;
}

/**
 * The FleetSupervisor's public surface. Later waves depend ONLY on this interface, never on the
 * concrete class, so 005b/005c can be built against a stable contract while the body evolves.
 */
export interface FleetSupervisor {
  /**
   * Start the two roots (Doctor + Hive): resolve Node, port-check each, spawn argv-safely,
   * and health-check each within the startup budget. Resolves once the fleet is up OR a root
   * reaches a terminal state — never hangs (a-AC-2). Rejects only on an unrecoverable
   * precondition (e.g. no system Node ≥22.5, a-AC-1).
   */
  start(): Promise<FleetStatus>;
  /** Stop every root and any child cleanly, leaving no orphans (a-AC-4). Idempotent. */
  stop(): Promise<void>;
  /** The current immutable fleet snapshot (a-AC-2). Safe to call any time, including before {@link start}. */
  getFleetStatus(): FleetStatus;
  /**
   * Subscribe to Hive becoming healthy (005b points the window at hive's dashboard once this fires).
   * If Hive is ALREADY healthy the listener is invoked immediately. Returns an unsubscribe fn.
   */
  onHiveReady(listener: () => void): () => void;
  /** Subscribe to any fleet-status change (005c tray re-renders on this). Returns an unsubscribe fn. */
  onStatusChange(listener: (status: FleetStatus) => void): () => void;
}
