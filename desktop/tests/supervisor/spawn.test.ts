/**
 * a-AC-7: the default spawn seam passes `shell: false` and an ARGV ARRAY to node's spawn — never a
 * shell string. A test injects the raw spawn to assert the options without a real process.
 */

import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";

import { describe, expect, it, vi } from "vitest";

import { createNodeSpawn, type RawSpawn } from "../../src/supervisor/spawn.js";

function fakeChild(pid = 4242): ChildProcess {
  const emitter = new EventEmitter() as unknown as ChildProcess;
  (emitter as unknown as { pid: number }).pid = pid;
  (emitter as unknown as { killed: boolean }).killed = false;
  (emitter as unknown as { kill: () => boolean }).kill = () => true;
  return emitter;
}

describe("createNodeSpawn (a-AC-7)", () => {
  it("spawns with shell:false and the exact argv array", () => {
    const rawSpawn: RawSpawn = vi.fn((_command, _args, _options) => fakeChild());
    const spawn = createNodeSpawn(rawSpawn);

    spawn("/opt/node/bin/node", ["/g/cli.js", "start"]);

    expect(rawSpawn).toHaveBeenCalledTimes(1);
    const [command, args, options] = (rawSpawn as unknown as { mock: { calls: unknown[][] } }).mock.calls[0] as [
      string,
      readonly string[],
      { shell: false; detached: boolean },
    ];
    expect(command).toBe("/opt/node/bin/node");
    expect(args).toEqual(["/g/cli.js", "start"]);
    // The load-bearing assertion: shell is disabled, so no string can ever be interpreted by a shell.
    expect(options.shell).toBe(false);
    expect(options.detached).toBe(false);
  });

  it("exposes the child's pid on the returned handle", () => {
    const spawn = createNodeSpawn(() => fakeChild(7777));
    const proc = spawn("/node", ["/cli.js", "start"]);
    expect(proc.pid).toBe(7777);
  });

  it("passes argv as a copied array (caller mutation cannot reach the child)", () => {
    let captured: readonly string[] | undefined;
    const spawn = createNodeSpawn((_c, args) => {
      captured = args;
      return fakeChild();
    });
    const args = ["/cli.js", "start"];
    spawn("/node", args);
    args.push("--tampered");
    expect(captured).toEqual(["/cli.js", "start"]);
  });
});
