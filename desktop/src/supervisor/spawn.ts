/**
 * PRD-005a a-AC-7: the argv-safe spawn seam.
 *
 * `command` + `args` are ALWAYS an argv array and the child is spawned with `shell: false`, so
 * there is no code path that concatenates a request- or config-derived string into a shell
 * command. Mirrors hive's `installer/spawn.ts` discipline exactly (the precedent this PRD cites).
 *
 * Windows footgun side-stepped (same as hive's spawn): a `.cmd` cannot be spawned with
 * `shell:false` on Node >=20 (EINVAL). Callers therefore spawn the resolved `node` binary with a
 * resolved `*.js` entry as argv[0], never a `.cmd` — so no `.cmd` and no shell is ever involved.
 *
 * The default is `detached: false` + explicit stdio 'ignore' with a stored child ref so
 * {@link NodeSpawnedProcess.stop} can terminate the tree cleanly on shutdown (a-AC-4).
 *
 * Built-ins only: node:child_process.
 */

import { spawn as nodeSpawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { delimiter, dirname } from "node:path";

import type { SpawnedProcess, SpawnFn } from "./types.js";

/** The low-level node spawn seam, injected by tests to assert `shell:false` + the argv array. */
export type RawSpawn = (
  command: string,
  args: readonly string[],
  options: { readonly shell: false; readonly detached: boolean; readonly env?: NodeJS.ProcessEnv },
) => ChildProcess;

/**
 * Child env with the spawned binary's directory prepended to PATH — mirrors hive's `childEnv`:
 * under a service manager the parent may inherit a minimal PATH without node's bin dir, and a
 * daemon's own `plain node` self-spawn would then die with exit 127. The command here is always
 * the resolved node path, so prepending its dir puts the RIGHT node first.
 */
function childEnv(command: string): NodeJS.ProcessEnv {
  const basePath = process.env.PATH ?? "";
  return { ...process.env, PATH: `${dirname(command)}${delimiter}${basePath}` };
}

/** Grace period before a stop() escalates from a polite signal to a forceful kill (a-AC-4). */
export const STOP_GRACE_MS = 4000;

/** Wrap a node {@link ChildProcess} as the supervisor's minimal {@link SpawnedProcess} handle. */
class NodeSpawnedProcess implements SpawnedProcess {
  private stopped = false;

  constructor(private readonly child: ChildProcess) {}

  get pid(): number | undefined {
    return this.child.pid;
  }

  onExit(listener: (code: number | null) => void): void {
    this.child.once("close", (code: number | null) => listener(code));
  }

  onError(listener: (error: Error) => void): void {
    this.child.once("error", (error: Error) => listener(error));
  }

  /**
   * Ask the child to stop, escalating to SIGKILL after a grace window, and resolve once it is
   * gone (a-AC-4: no orphan). Idempotent — a second call resolves immediately.
   */
  stop(): Promise<void> {
    if (this.stopped || this.child.pid === undefined || this.child.killed) {
      this.stopped = true;
      return Promise.resolve();
    }
    this.stopped = true;

    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(killTimer);
        resolve();
      };
      this.child.once("close", finish);

      // Polite request first.
      try {
        this.child.kill("SIGTERM");
      } catch {
        // Already gone between the guard and here: the close listener resolves, or the timer does.
      }

      // Escalate if it does not exit within the grace window, so a wedged child cannot orphan.
      const killTimer = setTimeout(() => {
        try {
          this.child.kill("SIGKILL");
        } catch {
          // Nothing more we can do; the close listener still resolves if/when it exits.
        }
        finish();
      }, STOP_GRACE_MS);
      // Do not let this timer keep the event loop (and thus the app) alive.
      if (typeof killTimer.unref === "function") killTimer.unref();
    });
  }
}

/**
 * Build the default {@link SpawnFn} over node's `child_process.spawn`, pinned to `shell: false`.
 * A test injects `rawSpawn` to assert the argv array and disabled shell without a real process.
 */
export function createNodeSpawn(rawSpawn: RawSpawn = nodeSpawn as unknown as RawSpawn): SpawnFn {
  return (command, args) => {
    // The whole point of a-AC-7: an argv array and `shell: false`, never a shell string.
    const child = rawSpawn(command, [...args], {
      shell: false,
      detached: false,
      env: childEnv(command),
    });
    return new NodeSpawnedProcess(child);
  };
}
