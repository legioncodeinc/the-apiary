/**
 * The orchestrator suite: drives {@link createFleetSupervisor} through every acceptance criterion
 * it OWNS, entirely against the injected {@link makeFakeSeams} doubles — NO real processes, ports,
 * or clocks (a-AC-1..a-AC-7 are proven without spawning a real fleet; that is orchestrator-level
 * integration, out of scope for these unit tests).
 *
 *   - a-AC-2  start() brings both roots healthy; a root that never answers /health fails within the
 *             startup BUDGET (never hangs) and surfaces an actionable, non-empty detail.
 *   - a-AC-3  a crashed root restarts under the bounded policy; repeated crashes STOP retrying and
 *             land in a terminal `failed` state (a give-up, never an infinite loop). Backoff sleeps
 *             are consulted (proven via the injected sleep advancing the fake clock).
 *   - a-AC-4  stop() stops every spawned child cleanly (no orphan), marks roots `stopped`, and a
 *             crash callback that fires DURING teardown does not resurrect a root.
 *   - a-AC-5  a second, already-healthy root of ours is ADOPTED (port-check `ours-healthy`) — no
 *             re-spawn, no re-bind.
 *   - a-AC-6  a FOREIGN process on a required port lands the root in a terminal `port-conflict`
 *             state (actionable detail), and the supervisor never spawns over it.
 *   - boundary the pid-liveness no-op prevents double-spawning a root whose pid file names a live
 *             process (ADR-0005 decision 3).
 *
 * Contract surface proven for later waves: getFleetStatus(), onHiveReady(), onStatusChange().
 */

import { describe, expect, it, vi } from "vitest";

import { createFleetSupervisor } from "../../src/supervisor/fleet-supervisor.js";
import type { RootLaunchSpec, SupervisorPolicy } from "../../src/supervisor/types.js";
import { FakeProcess, makeFakeSeams } from "./fakes.js";

/** Test launch specs for the two roots — loopback contract only, no real filesystem touched. */
const SPECS: readonly RootLaunchSpec[] = [
  {
    name: "doctor",
    command: "/sidecar/node",
    args: ["/g/doctor/bundle/cli.js", "start"],
    port: 3852,
    healthUrl: "http://127.0.0.1:3852/health",
    pidPath: "/home/me/.apiary/doctor/daemon.pid",
  },
  {
    name: "hive",
    command: "/sidecar/node",
    args: ["/g/hive/dist/cli.js", "start"],
    port: 3853,
    healthUrl: "http://127.0.0.1:3853/health",
    pidPath: "/home/me/.apiary/hive/daemon.pid",
  },
];

/** A fast policy so the give-up path is reached in a handful of exits; budgets stay bounded. */
const FAST_POLICY: SupervisorPolicy = {
  probeTimeoutMs: 50,
  startupPollIntervalMs: 10,
  startupBudgetMs: 100,
  backoffFloorMs: 5,
  backoffCeilingMs: 20,
  maxRestarts: 2,
  adoptedProbeIntervalMs: 50,
};

/** Flush the microtask queue so the fake `sleep` (which resolves immediately) lets restarts run. */
async function flush(iterations = 20): Promise<void> {
  for (let i = 0; i < iterations; i += 1) {
    await Promise.resolve();
  }
}

describe("createFleetSupervisor.start (a-AC-2)", () => {
  it("brings both roots healthy when /health answers ok, in doctor-then-hive order", async () => {
    const { seams, spawns } = makeFakeSeams();
    const supervisor = createFleetSupervisor(SPECS, seams, FAST_POLICY);

    const status = await supervisor.start();

    expect(status.allHealthy).toBe(true);
    expect(status.hasTerminalFailure).toBe(false);
    expect(status.roots.map((r) => r.name)).toEqual(["doctor", "hive"]);
    expect(status.roots.every((r) => r.phase === "healthy")).toBe(true);
    // Each root spawned exactly once, with the sidecar node + argv array (never Electron, a-AC-1/7).
    expect(spawns).toHaveLength(2);
    for (const s of spawns) {
      expect(s.command).toBe("/sidecar/node");
      expect(Array.isArray(s.args)).toBe(true);
      expect(s.command).not.toContain("electron");
    }
  });

  it("does not hang: a root that never goes healthy fails within the startup budget (a-AC-2)", async () => {
    // doctor's /health never returns ok → the budget elapses (fake sleep advances the clock) and it
    // lands `failed` with an actionable detail, rather than looping forever.
    const { seams } = makeFakeSeams({
      health: (url) => (url.includes("3852") ? { kind: "unreachable-refused", detail: "ECONNREFUSED" } : { kind: "ok" }),
    });
    const supervisor = createFleetSupervisor(SPECS, seams, FAST_POLICY);

    const status = await supervisor.start();

    const doctor = status.roots.find((r) => r.name === "doctor");
    expect(doctor?.phase).toBe("failed");
    expect(doctor?.detail).toBeTruthy();
    expect(doctor?.detail).toContain("healthy");
    expect(status.hasTerminalFailure).toBe(true);
    expect(status.allHealthy).toBe(false);
  });
});

describe("createFleetSupervisor restart policy (a-AC-3)", () => {
  it("restarts a crashed root, then gives up after maxRestarts into a terminal `failed` state", async () => {
    // `spawns` records every spawn in order with its argv; we always crash the LATEST doctor child
    // (identified by its cli entry), so the test never guesses at array indices. Each start goes
    // healthy immediately, letting us watch the bounded policy count down to give-up.
    const { seams, spawns } = makeFakeSeams();
    const supervisor = createFleetSupervisor(SPECS, seams, FAST_POLICY);
    await supervisor.start();
    expect(supervisor.getFleetStatus().allHealthy).toBe(true);

    /** The FakeProcess of the most recent doctor spawn that has not been crashed yet. */
    const latestDoctorChild = (): FakeProcess | undefined =>
      [...spawns].reverse().find((s) => s.args[0] === "/g/doctor/bundle/cli.js" && !s.process.stopped)?.process;
    const doctorPhase = () => supervisor.getFleetStatus().roots.find((r) => r.name === "doctor");

    // Crash #1 → restart (restarts=1), comes back healthy.
    latestDoctorChild()?.fireExit(1);
    await flush();
    expect(doctorPhase()?.restarts).toBe(1);
    expect(doctorPhase()?.phase).toBe("healthy");

    // Crash #2 → restart (restarts=2), comes back healthy.
    latestDoctorChild()?.fireExit(1);
    await flush();
    expect(doctorPhase()?.restarts).toBe(2);
    expect(doctorPhase()?.phase).toBe("healthy");

    // Crash #3 → restarts (2) >= maxRestarts (2): GIVE UP. Terminal `failed`, not another restart.
    latestDoctorChild()?.fireExit(1);
    await flush();
    expect(doctorPhase()?.phase).toBe("failed");
    expect(doctorPhase()?.detail).toContain("giving up");
    // Off-by-one guard (finding): the honest count is the TOTAL crashes (maxRestarts recoveries + the
    // final crash that pushed us over) = 3, not the `restarts` counter's 2.
    expect(doctorPhase()?.detail).toContain("crashed 3 times");
    expect(doctorPhase()?.restarts).toBe(2);
    expect(supervisor.getFleetStatus().hasTerminalFailure).toBe(true);
  });

  it("consults the injected backoff sleep between restarts (bounded, never a busy loop)", async () => {
    const sleepMs: number[] = [];
    const base = makeFakeSeams();
    const seams = {
      ...base.seams,
      sleep: vi.fn((ms: number) => {
        sleepMs.push(ms);
        return { promise: Promise.resolve(), cancel: () => undefined };
      }),
    };
    const supervisor = createFleetSupervisor(SPECS, seams, FAST_POLICY);
    await supervisor.start();

    base.spawns[0]?.process.fireExit(1);
    await flush();

    // At least one backoff sleep was taken, and every sleep is within the bounded ceiling.
    expect(sleepMs.length).toBeGreaterThan(0);
    for (const ms of sleepMs) expect(ms).toBeLessThanOrEqual(FAST_POLICY.backoffCeilingMs);
  });
});

describe("createFleetSupervisor delayed-restart error routing (finding: no unhandled rejection)", () => {
  it("routes a throw inside the delayed restart into terminal `failed`, not an unhandled rejection", async () => {
    // probeHealth answers ok during the initial start(), then THROWS on the post-crash restart's
    // health-wait. Without the .catch() this throw would be an unhandled rejection; with it, the root
    // must land in a terminal `failed` state naming the failure — never a silent swallow.
    let started = false;
    const { seams, spawns } = makeFakeSeams();
    const throwingProbe = vi.fn(async (url: string) => {
      if (started && url.includes("3852")) throw new Error("probe boom");
      return { kind: "ok" as const };
    });
    const supervisor = createFleetSupervisor(SPECS, { ...seams, probeHealth: throwingProbe }, FAST_POLICY);

    // Capture any unhandled rejection: there must be none.
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      await supervisor.start();
      started = true;

      const doctorChild = spawns.find((s) => s.args[0] === "/g/doctor/bundle/cli.js")?.process;
      doctorChild?.fireExit(1);
      await flush();
      // Let any queued rejection microtasks settle so an unhandled rejection (if any) would surface.
      await new Promise((resolve) => setTimeout(resolve, 0));

      const doctor = supervisor.getFleetStatus().roots.find((r) => r.name === "doctor");
      expect(doctor?.phase).toBe("failed");
      expect(doctor?.detail).toContain("probe boom");
      expect(supervisor.getFleetStatus().hasTerminalFailure).toBe(true);
      expect(unhandled).toHaveLength(0);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

describe("createFleetSupervisor adopted-root monitoring (finding: adopted roots need a re-probe)", () => {
  it("restarts an adopted root that later fails, within the bounded policy", async () => {
    // doctor is adopted (`ours-healthy`) → no child spawned, no exit handle. The adopted re-probe is
    // the only thing that can notice it dying later. We toggle its /health to not-ok, fire the probe
    // tick, and assert it feeds the SAME bounded-restart policy (a fresh spawn happens).
    let doctorHealthy = true;
    const { seams, spawns, intervals } = makeFakeSeams({
      port: (port) => (port === 3852 ? { kind: "ours-healthy" } : { kind: "free" }),
      health: (url) => (url.includes("3852") && !doctorHealthy ? { kind: "unreachable-refused", detail: "ECONNREFUSED" } : { kind: "ok" }),
    });
    const supervisor = createFleetSupervisor(SPECS, seams, FAST_POLICY);

    await supervisor.start();
    // Adopted: doctor healthy with NO spawn; an adopted probe was armed for it.
    expect(supervisor.getFleetStatus().roots.find((r) => r.name === "doctor")?.phase).toBe("healthy");
    expect(spawns.some((s) => s.args[0] === "/g/doctor/bundle/cli.js")).toBe(false);
    const doctorProbe = intervals.find((iv) => !iv.cancelled);
    expect(doctorProbe).toBeDefined();

    // The adopted doctor dies. Fire the re-probe tick: it sees not-ok and hands off to the bounded
    // policy, which respawns doctor (now that health is ok again it comes back healthy).
    doctorHealthy = false;
    doctorProbe?.callback();
    await flush();
    doctorHealthy = true;
    await flush();

    const doctor = supervisor.getFleetStatus().roots.find((r) => r.name === "doctor");
    expect(doctor?.restarts).toBe(1);
    // A real spawn now backs doctor (the adopted no-op path is over): the bounded policy took over.
    expect(spawns.some((s) => s.args[0] === "/g/doctor/bundle/cli.js")).toBe(true);
  });

  it("cancels adopted-root re-probes on stop (no resurrection)", async () => {
    const { seams, intervals } = makeFakeSeams({
      port: (port) => (port === 3852 ? { kind: "ours-healthy" } : { kind: "free" }),
    });
    const supervisor = createFleetSupervisor(SPECS, seams, FAST_POLICY);
    await supervisor.start();
    await supervisor.stop();
    // Every armed adopted probe is cancelled after stop().
    expect(intervals.every((iv) => iv.cancelled)).toBe(true);
  });
});

describe("createFleetSupervisor.stop (a-AC-4)", () => {
  it("stops every spawned child cleanly and marks roots stopped (no orphan)", async () => {
    const { seams, spawns } = makeFakeSeams();
    const supervisor = createFleetSupervisor(SPECS, seams, FAST_POLICY);
    await supervisor.start();

    await supervisor.stop();

    for (const s of spawns) expect(s.process.stopped).toBe(true);
    expect(supervisor.getFleetStatus().roots.every((r) => r.phase === "stopped")).toBe(true);
  });

  it("is idempotent and does not resurrect a root that crashes during teardown", async () => {
    const { seams, spawns } = makeFakeSeams();
    const supervisor = createFleetSupervisor(SPECS, seams, FAST_POLICY);
    await supervisor.start();
    const spawnCountBefore = spawns.length;

    const stopPromise = supervisor.stop();
    // A late crash callback fires mid-teardown: it must NOT trigger a restart (shuttingDown guard).
    spawns[0]?.process.fireExit(1);
    await stopPromise;
    await supervisor.stop(); // second call is a no-op.
    await flush();

    // No new spawn happened after stop began: the crash-during-teardown did not resurrect anything.
    expect(spawns.length).toBe(spawnCountBefore);
    expect(supervisor.getFleetStatus().roots.every((r) => r.phase === "stopped")).toBe(true);
  });
});

describe("createFleetSupervisor adopt-vs-foreign (a-AC-5 / a-AC-6)", () => {
  it("adopts an already-healthy root of ours without re-spawning (a-AC-5)", async () => {
    // The port check reports OUR healthy daemon already up on doctor's port → adopt, do not spawn.
    const { seams, spawns } = makeFakeSeams({
      port: (port) => (port === 3852 ? { kind: "ours-healthy" } : { kind: "free" }),
    });
    const supervisor = createFleetSupervisor(SPECS, seams, FAST_POLICY);

    const status = await supervisor.start();

    const doctor = status.roots.find((r) => r.name === "doctor");
    expect(doctor?.phase).toBe("healthy");
    // Only hive was spawned; doctor was adopted (no re-bind, no re-spawn).
    expect(spawns.map((s) => s.args[0])).toEqual(["/g/hive/dist/cli.js"]);
    expect(status.allHealthy).toBe(true);
  });

  it("surfaces a FOREIGN process on a required port as terminal `port-conflict`, never double-binds (a-AC-6)", async () => {
    const { seams, spawns } = makeFakeSeams({
      port: (port) =>
        port === 3852 ? { kind: "foreign", detail: "port 3852 in use by a foreign process: no healthy /health" } : { kind: "free" },
    });
    const supervisor = createFleetSupervisor(SPECS, seams, FAST_POLICY);

    const status = await supervisor.start();

    const doctor = status.roots.find((r) => r.name === "doctor");
    expect(doctor?.phase).toBe("port-conflict");
    expect(doctor?.detail).toContain("foreign");
    expect(status.hasTerminalFailure).toBe(true);
    // The supervisor never spawned doctor over the foreign holder.
    expect(spawns.some((s) => s.args[0] === "/g/doctor/bundle/cli.js")).toBe(false);
  });
});

describe("createFleetSupervisor pid-liveness boundary (ADR-0005 decision 3)", () => {
  it("does not double-spawn a root whose pid file names a live process", async () => {
    // Both halves of the no-op are wired: the pid file yields a pid, and that pid is alive. The
    // no-op fires; combined with an already-ok /health, the root is treated as up WITHOUT a spawn
    // (the shell never double-spawns a live root — ADR-0005 decision 3).
    const { seams, spawns } = makeFakeSeams({ pidFile: () => "4242", pidAlive: (pid) => pid === 4242 });
    const supervisor = createFleetSupervisor(SPECS, seams, FAST_POLICY);

    const status = await supervisor.start();

    // No child was spawned for either root (both were already alive per the pid file).
    expect(spawns).toHaveLength(0);
    // Both are healthy via the adopt/health path, not via a fresh spawn.
    expect(status.roots.every((r) => r.phase === "healthy")).toBe(true);
  });
});

describe("createFleetSupervisor observer contract (surface for 005b / 005c)", () => {
  it("onHiveReady fires when hive goes healthy and immediately for a late subscriber", async () => {
    const { seams } = makeFakeSeams();
    const supervisor = createFleetSupervisor(SPECS, seams, FAST_POLICY);

    const early = vi.fn();
    supervisor.onHiveReady(early);

    await supervisor.start();
    expect(early).toHaveBeenCalledTimes(1);

    // A subscriber added AFTER hive is already healthy fires immediately.
    const late = vi.fn();
    supervisor.onHiveReady(late);
    expect(late).toHaveBeenCalledTimes(1);
  });

  it("onStatusChange emits and unsubscribes cleanly (005c tray contract)", async () => {
    const { seams } = makeFakeSeams();
    const supervisor = createFleetSupervisor(SPECS, seams, FAST_POLICY);

    const listener = vi.fn();
    const unsubscribe = supervisor.onStatusChange(listener);
    await supervisor.start();
    expect(listener).toHaveBeenCalled();

    const callsAtUnsub = listener.mock.calls.length;
    unsubscribe();
    await supervisor.stop();
    // No further calls after unsubscribe.
    expect(listener.mock.calls.length).toBe(callsAtUnsub);
  });

  it("getFleetStatus is safe to call before start() (005b initial-state contract)", () => {
    const { seams } = makeFakeSeams();
    const supervisor = createFleetSupervisor(SPECS, seams, FAST_POLICY);
    const status = supervisor.getFleetStatus();
    expect(status.allHealthy).toBe(false);
    expect(status.roots.every((r) => r.phase === "idle")).toBe(true);
  });
});
