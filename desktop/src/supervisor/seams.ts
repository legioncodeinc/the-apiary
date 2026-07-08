/**
 * PRD-005a: the DEFAULT seam factory — wires the real node built-ins the supervisor uses in
 * production (child_process spawn, http health probe, net port check, signal-0 pid liveness, a
 * real clock + cancellable sleep, a console logger). Tests never call this: they hand
 * {@link createFleetSupervisor} a fully-faked {@link SupervisorSeams}.
 *
 * Keeping the wiring here (not inside the orchestrator) is what makes the orchestrator itself pure
 * and unit-testable with no real processes.
 */

import { readFileSync } from "node:fs";

import { createNodeSpawn } from "./spawn.js";
import { probeHealth } from "./health-probe.js";
import { createPortCheck } from "./port-check.js";
import { isPidAlive } from "./pid-liveness.js";
import type { IntervalFn, ReadPidFileFn, SleepFn, SupervisorLogger, SupervisorSeams } from "./types.js";

/** The default pid-file reader: `utf8`, delegating existence/garbage handling to `readPidFile`. */
const defaultReadPidFile: ReadPidFileFn = (pidPath) => readFileSync(pidPath, "utf8");

/** A cancellable sleep over setTimeout; unref'd so a pending nap never keeps the app alive. */
export const realSleep: SleepFn = (ms) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
    if (timer !== undefined && typeof timer.unref === "function") timer.unref();
    cancel = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      resolve();
    };
  });
  return { promise, cancel };
};

/** A periodic scheduler over setInterval; unref'd so a pending re-probe never keeps the app alive. */
export const realInterval: IntervalFn = (ms, callback) => {
  const timer = setInterval(callback, ms);
  if (typeof timer.unref === "function") timer.unref();
  return { cancel: () => clearInterval(timer) };
};

/** A minimal console logger. Never logs a credential (the supervisor only ever passes safe fields). */
export const consoleLogger: SupervisorLogger = {
  info(message, fields) {
    console.info(`[supervisor] ${message}`, fields ?? {});
  },
  warn(message, fields) {
    console.warn(`[supervisor] ${message}`, fields ?? {});
  },
  error(message, fields) {
    console.error(`[supervisor] ${message}`, fields ?? {});
  },
};

/** Build the production seams. Override any field for partial fakes in integration tests. */
export function createDefaultSeams(overrides: Partial<SupervisorSeams> = {}): SupervisorSeams {
  return {
    spawn: overrides.spawn ?? createNodeSpawn(),
    probeHealth: overrides.probeHealth ?? probeHealth,
    checkPort: overrides.checkPort ?? createPortCheck(overrides.probeHealth ?? probeHealth),
    isPidAlive: overrides.isPidAlive ?? isPidAlive,
    readPidFile: overrides.readPidFile ?? defaultReadPidFile,
    clock: overrides.clock ?? Date.now,
    sleep: overrides.sleep ?? realSleep,
    setInterval: overrides.setInterval ?? realInterval,
    logger: overrides.logger ?? consoleLogger,
  };
}
