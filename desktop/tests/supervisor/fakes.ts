/**
 * Shared test fakes for the supervisor suite. Every seam is a controllable in-memory double so the
 * orchestrator runs with NO real processes, ports, or clocks (the whole point of the injectable
 * seams). Time is virtual: `sleep` resolves on the microtask queue and advances a fake clock, so
 * the startup budget / backoff logic is exercised deterministically and instantly.
 */

import { vi } from "vitest";

import type {
  HealthProbeFn,
  HealthResult,
  PortCheckFn,
  PortHolder,
  SpawnedProcess,
  SupervisorLogger,
  SupervisorSeams,
} from "../../src/supervisor/types.js";

/** A controllable fake child: tests fire its exit/error to simulate crashes. */
export class FakeProcess implements SpawnedProcess {
  pid: number | undefined;
  stopped = false;
  private exitListener?: (code: number | null) => void;
  private errorListener?: (error: Error) => void;

  constructor(pid: number | undefined = 1000 + Math.floor(Math.random() * 9000)) {
    this.pid = pid;
  }

  onExit(listener: (code: number | null) => void): void {
    this.exitListener = listener;
  }
  onError(listener: (error: Error) => void): void {
    this.errorListener = listener;
  }
  stop(): Promise<void> {
    this.stopped = true;
    return Promise.resolve();
  }

  /** Simulate a crash/exit. */
  fireExit(code: number | null = 1): void {
    this.exitListener?.(code);
  }
  /** Simulate a spawn-level error. */
  fireError(error: Error): void {
    this.errorListener?.(error);
  }
}

/** A virtual clock the fake sleep advances, so budgets/backoff are deterministic and instant. */
export class FakeClock {
  private now = 0;
  read = (): number => this.now;
  advance(ms: number): void {
    this.now += ms;
  }
}

/** Build a fully-faked {@link SupervisorSeams} plus handles to drive it from a test. */
export function makeFakeSeams(options: {
  /** Ordered spawn results; each spawn() shifts one. Defaults to a fresh FakeProcess each call. */
  readonly spawnQueue?: FakeProcess[];
  /** Health probe behavior, keyed by health URL. Default: everything returns ok. */
  readonly health?: (healthUrl: string) => HealthResult;
  /** Port-check behavior, keyed by port. Default: every port free. */
  readonly port?: (port: number) => PortHolder;
  /** pid-liveness answer. Default: nothing is alive (so spawns proceed). */
  readonly pidAlive?: (pid: number) => boolean;
  /**
   * Contents of a root's pid file, keyed by pidPath. Default: no pid file exists (the reader throws
   * ENOENT), so `isRootAlreadyAlive` is false and spawns proceed — the common case.
   */
  readonly pidFile?: (pidPath: string) => string;
} = {}): {
  readonly seams: SupervisorSeams;
  readonly clock: FakeClock;
  readonly spawns: { command: string; args: readonly string[]; process: FakeProcess }[];
  readonly logger: SupervisorLogger & { readonly entries: { level: string; message: string }[] };
  /** Every armed interval, so a test can fire an adopted-root re-probe tick synchronously. */
  readonly intervals: { ms: number; callback: () => void; cancelled: boolean }[];
} {
  const clock = new FakeClock();
  const spawns: { command: string; args: readonly string[]; process: FakeProcess }[] = [];
  const intervals: { ms: number; callback: () => void; cancelled: boolean }[] = [];
  const spawnQueue = options.spawnQueue ? [...options.spawnQueue] : undefined;

  const entries: { level: string; message: string }[] = [];
  const logger: SupervisorLogger & { entries: { level: string; message: string }[] } = {
    entries,
    info: (message) => entries.push({ level: "info", message }),
    warn: (message) => entries.push({ level: "warn", message }),
    error: (message) => entries.push({ level: "error", message }),
  };

  const probeHealth: HealthProbeFn = vi.fn(async (healthUrl: string) => (options.health ? options.health(healthUrl) : { kind: "ok" }));
  const checkPort: PortCheckFn = vi.fn(async (port: number) => (options.port ? options.port(port) : { kind: "free" }));

  const seams: SupervisorSeams = {
    spawn: vi.fn((command: string, args: readonly string[]) => {
      const process = spawnQueue ? (spawnQueue.shift() ?? new FakeProcess()) : new FakeProcess();
      spawns.push({ command, args, process });
      return process;
    }),
    probeHealth,
    checkPort,
    isPidAlive: options.pidAlive ?? (() => false),
    readPidFile: (pidPath: string) => {
      if (options.pidFile) return options.pidFile(pidPath);
      // No pid file by default: throw ENOENT so `readPidFile` returns null and spawns proceed.
      throw Object.assign(new Error(`ENOENT: no pid file ${pidPath}`), { code: "ENOENT" });
    },
    clock: clock.read,
    // Virtual sleep: resolve immediately but advance the fake clock so the budget loop terminates.
    sleep: (ms: number) => {
      clock.advance(ms);
      return { promise: Promise.resolve(), cancel: () => undefined };
    },
    // Virtual interval: record the callback so a test fires ticks synchronously; never a real timer.
    setInterval: (ms: number, callback: () => void) => {
      const entry = { ms, callback, cancelled: false };
      intervals.push(entry);
      return {
        cancel: () => {
          entry.cancelled = true;
        },
      };
    },
    logger,
  };

  return { seams, clock, spawns, logger, intervals };
}

/** Convenience: a health fn that returns a fixed result for all URLs. */
export function fixedHealth(result: HealthResult): (healthUrl: string) => HealthResult {
  return () => result;
}
