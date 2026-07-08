/**
 * c-AC-4/5/7/8: the takeover ORCHESTRATION over fully-faked seams — dryRun no-op, idempotency,
 * launch-at-login, the standalone consent/decline branches, and the shell-uninstall no-restore path.
 * NO real service/npm command is ever executed: `runCommand` is a recording fake.
 */

import { describe, expect, it } from "vitest";

import {
  buildShellUninstallCommands,
  runShellUninstall,
  runTakeover,
} from "../../src/service/takeover.js";
import { runServiceTakeover } from "../../src/service/index.js";
import type { OsContext } from "../../src/service/service-manager.js";
import { makeSeams, standalonePresent, windowsEnv } from "./fakes.js";

describe("runTakeover — dryRun DEFAULT (c-AC-4/5 safety)", () => {
  it("runs NO command and toggles NO login item when dryRun is the default", async () => {
    const fake = makeSeams({ env: windowsEnv });
    const run = await runTakeover({}, fake.seams); // no dryRun given -> defaults to true
    expect(fake.ranCommands).toHaveLength(0);
    expect(fake.loginToggles).toHaveLength(0);
    expect(run.changed).toBe(false);
    expect(run.log.some((l) => l.includes("dryRun=true"))).toBe(true);
    expect(run.log.some((l) => l.startsWith("[dry-run] would run"))).toBe(true);
  });

  it("the index wrapper runServiceTakeover also defaults to dryRun and mutates nothing", async () => {
    const fake = makeSeams({ env: windowsEnv });
    const result = await runServiceTakeover({}, fake.seams);
    expect(fake.ranCommands).toHaveLength(0);
    expect(result.changed).toBe(false);
    expect(result).toHaveProperty("log");
  });

  it("rejects an unknown option key at the zod boundary", async () => {
    const fake = makeSeams({ env: windowsEnv });
    // @ts-expect-error deliberately passing an unknown key to prove the strict schema rejects it
    await expect(runTakeover({ force: true }, fake.seams)).rejects.toThrow();
  });
});

describe("runTakeover — live run deregisters Apiary units + registers login (c-AC-4/5)", () => {
  it("runs schtasks deregister for every unit and registers launch-at-login", async () => {
    const fake = makeSeams({ env: windowsEnv });
    const run = await runTakeover({ dryRun: false }, fake.seams);
    // Every unit contributed schtasks /Delete commands.
    const deletes = fake.ranCommands.filter((c) => c.id === "schtasks-delete");
    expect(deletes.length).toBeGreaterThanOrEqual(5); // 5 Apiary units (current + legacy)
    expect(fake.loginToggles).toEqual([true]); // registered launch-at-login exactly once
    expect(run.changed).toBe(true);
  });

  it("is idempotent: re-running is still a clean no-op even when tasks are already absent (non-zero exit tolerated)", async () => {
    // Simulate 'task not found' by making the delete exit non-zero; tolerateFailure makes it ok.
    const fake = makeSeams({ env: windowsEnv, exitCodes: { "schtasks-delete": 1, "schtasks-end": 1 } });
    const run = await runTakeover({ dryRun: false }, fake.seams);
    // It still completes and still registers login; no throw, no failure surfaced.
    expect(fake.loginToggles).toEqual([true]);
    expect(run.log.some((l) => l.includes("takeover done"))).toBe(true);
  });
});

describe("runTakeover — standalone Hivemind branches (c-AC-8)", () => {
  it("CONSENT: prompts, uninstalls (npm uninstall -g present), proceeds", async () => {
    const fake = makeSeams({ env: windowsEnv, detection: standalonePresent, consent: "consent" });
    const run = await runTakeover({ dryRun: false }, fake.seams);
    expect(fake.promptCount()).toBe(1);
    expect(fake.ranCommands.some((c) => c.file === "npm" && c.args.includes("uninstall"))).toBe(true);
    expect(run.standalone.kind).toBe("proceed");
  });

  it("DECLINE: prompts, ABORTS, and mutates NOTHING (no command run, no login toggle)", async () => {
    const fake = makeSeams({ env: windowsEnv, detection: standalonePresent, consent: "decline" });
    const run = await runTakeover({ dryRun: false }, fake.seams);
    expect(fake.promptCount()).toBe(1);
    expect(fake.ranCommands).toHaveLength(0); // aborted before any Apiary teardown or uninstall
    expect(fake.loginToggles).toHaveLength(0); // never registered login
    expect(run.standalone.kind).toBe("aborted");
    expect(run.changed).toBe(false);
  });

  it("no standalone detected: no prompt, proceeds straight to Apiary deregister", async () => {
    const fake = makeSeams({ env: windowsEnv, consent: "consent", detection: undefined });
    await runTakeover({ dryRun: false }, fake.seams);
    expect(fake.promptCount()).toBe(0);
    expect(fake.ranCommands.some((c) => c.file === "npm")).toBe(false);
  });

  it("CONSENT uninstall NEVER runs a command that targets ~/.deeplake (credential preservation)", async () => {
    const fake = makeSeams({ env: windowsEnv, detection: standalonePresent, consent: "consent" });
    await runTakeover({ dryRun: false }, fake.seams);
    const touchesData = fake.ranCommands.some((c) => c.args.some((a) => a.replace(/\\/g, "/").includes("/.deeplake")));
    expect(touchesData).toBe(false);
  });
});

describe("runShellUninstall — clean removal, NOT restore (c-AC-7)", () => {
  it("clears launch-at-login and deregisters, but NEVER re-registers/enables a service", async () => {
    const fake = makeSeams({ env: windowsEnv });
    const result = await runShellUninstall({ dryRun: false }, fake.seams);
    expect(fake.loginToggles).toEqual([false]); // cleared login exactly once
    // No command re-registers a service (schtasks /Create, launchctl bootstrap, systemctl enable).
    const reRegistered = fake.ranCommands.some(
      (c) =>
        c.args.includes("/Create") ||
        c.args.includes("bootstrap") ||
        (c.file === "systemctl" && c.args.includes("enable")),
    );
    expect(reRegistered).toBe(false);
    expect(result.log.some((l) => l.includes("NOT restored"))).toBe(true);
  });

  it("the constructed shell-uninstall commands contain deregister argv and no re-register argv", () => {
    const ctx: OsContext = { os: "windows", homeDir: "C:/Users/dev", uid: 0 };
    const commands = buildShellUninstallCommands(ctx);
    expect(commands.some((c) => c.id === "schtasks-delete")).toBe(true);
    expect(commands.every((c) => !c.args.includes("/Create"))).toBe(true);
  });

  it("dryRun shell-uninstall mutates nothing", async () => {
    const fake = makeSeams({ env: windowsEnv });
    await runShellUninstall({}, fake.seams); // default dryRun true
    expect(fake.ranCommands).toHaveLength(0);
    expect(fake.loginToggles).toHaveLength(0);
  });
});
