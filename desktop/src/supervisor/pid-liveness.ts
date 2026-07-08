/**
 * PRD-005a boundary (ADR-0005 decision 3): the pid-liveness no-op.
 *
 * Every restart the shell performs checks the entry's `pidPath` first; a LIVE pid short-circuits
 * to a no-op, so even a hypothetical race can never double-spawn one root. Combined with the
 * single-owner rule (the shell owns ONLY Doctor + Hive; Doctor owns the workloads), this makes the
 * supervision boundary provable rather than conventional.
 *
 * `isPidAlive` is the seam the supervisor consults; `readPidFile` reads a root's pid file if
 * present. Built-ins only (node:fs). Both are total — a missing/garbage pid file means "not alive"
 * rather than a throw.
 */

import { readFileSync } from "node:fs";

/**
 * True iff a process with `pid` is currently alive. Uses the signal-0 probe: `process.kill(pid, 0)`
 * throws ESRCH when the pid is dead and EPERM when it is alive-but-not-ours (still alive). A
 * non-positive pid is never alive.
 */
export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM ⇒ the process exists but we lack permission to signal it ⇒ still ALIVE.
    if ((error as NodeJS.ErrnoException).code === "EPERM") return true;
    // ESRCH (and anything else) ⇒ not a live process we can see.
    return false;
  }
}

/**
 * Read a pid from a root's pid file, or `null` if the file is absent, unreadable, or does not
 * contain a positive integer. Total by design so the pid-liveness check degrades to "spawn" (the
 * safe default under the single-owner rule) rather than crashing on a missing/garbage file.
 */
export function readPidFile(pidPath: string, readFile: (path: string) => string = (p) => readFileSync(p, "utf8")): number | null {
  let raw: string;
  try {
    raw = readFile(pidPath);
  } catch {
    return null;
  }
  const pid = Number.parseInt(raw.trim(), 10);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  return pid;
}

/**
 * The boundary check the shell runs before (re)spawning a root: if the root's pid file names a
 * LIVE process, restarting is a no-op (return true). Returns false when there is no live pid, so
 * the caller proceeds to spawn. Never throws.
 */
export function isRootAlreadyAlive(
  pidPath: string,
  seams: { readonly isPidAlive?: (pid: number) => boolean; readonly readFile?: (path: string) => string } = {},
): boolean {
  const aliveFn = seams.isPidAlive ?? isPidAlive;
  const pid = readPidFile(pidPath, seams.readFile);
  if (pid === null) return false;
  return aliveFn(pid);
}
