/**
 * c-AC-4: per-OS STOP + DEREGISTER argv for an Apiary unit, CURRENT + LEGACY labels. Windows argv is
 * the verified path; macOS/linux argv shape is asserted here but its LIVE execution is CI-deferred.
 * Every command is an argv array (no shell string).
 */

import { describe, expect, it } from "vitest";

import {
  APIARY_SERVICE_UNITS,
  DOCTOR_LEGACY,
  HIVE_CURRENT,
  HIVE_LEGACY,
  NECTAR_LEGACY,
} from "../../src/service/labels.js";
import {
  buildDeregisterPlan,
  launchdPlistPath,
  systemdUnitPath,
  type OsContext,
} from "../../src/service/service-manager.js";

const winCtx: OsContext = { os: "windows", homeDir: "C:/Users/dev", uid: 0 };
const macCtx: OsContext = { os: "macos", homeDir: "/Users/dev", uid: 501 };
const linuxCtx: OsContext = { os: "linux", homeDir: "/home/dev", uid: 1000 };

describe("Windows schtasks deregister (VERIFIED path, c-AC-4)", () => {
  it("builds /End then /Delete /F for the current Hive task", () => {
    const plan = buildDeregisterPlan(HIVE_CURRENT, winCtx);
    expect(plan.commands.map((c) => [c.file, ...c.args])).toEqual([
      ["schtasks", "/End", "/TN", "hive"],
      ["schtasks", "/Delete", "/TN", "hive", "/F"],
    ]);
  });

  it("covers the LEGACY Hive task name (thehive)", () => {
    const plan = buildDeregisterPlan(HIVE_LEGACY, winCtx);
    expect(plan.commands.map((c) => c.args).flat()).toContain("thehive");
    const del = plan.commands.find((c) => c.id === "schtasks-delete");
    expect(del?.args).toEqual(["/Delete", "/TN", "thehive", "/F"]);
  });

  it("covers the LEGACY Doctor (HiveDoctor) and Nectar (HivenectarDaemon) task names", () => {
    expect(buildDeregisterPlan(DOCTOR_LEGACY, winCtx).commands.some((c) => c.args.includes("HiveDoctor"))).toBe(true);
    expect(
      buildDeregisterPlan(NECTAR_LEGACY, winCtx).commands.some((c) => c.args.includes("HivenectarDaemon")),
    ).toBe(true);
  });

  it("marks every schtasks command tolerateFailure so a missing task is a clean no-op (idempotent)", () => {
    const plan = buildDeregisterPlan(HIVE_CURRENT, winCtx);
    expect(plan.commands.every((c) => c.tolerateFailure)).toBe(true);
  });
});

describe("macOS launchctl deregister (present, live-CI-deferred)", () => {
  it("boots out gui/<uid>/<label> then removes the plist", () => {
    const plan = buildDeregisterPlan(HIVE_CURRENT, macCtx);
    expect(plan.commands.map((c) => [c.file, ...c.args])).toEqual([
      ["launchctl", "bootout", "gui/501/com.legioncode.hive"],
      ["rm", "-f", "/Users/dev/Library/LaunchAgents/com.legioncode.hive.plist"],
    ]);
  });

  it("derives the plist path under ~/Library/LaunchAgents", () => {
    expect(launchdPlistPath("/Users/dev", HIVE_CURRENT)).toBe(
      "/Users/dev/Library/LaunchAgents/com.legioncode.hive.plist",
    );
  });
});

describe("Linux systemctl --user deregister (present, live-CI-deferred)", () => {
  it("disables --now, removes the unit file, then daemon-reloads", () => {
    const plan = buildDeregisterPlan(HIVE_CURRENT, linuxCtx);
    expect(plan.commands.map((c) => [c.file, ...c.args])).toEqual([
      ["systemctl", "--user", "disable", "--now", "hive.service"],
      ["rm", "-f", "/home/dev/.config/systemd/user/hive.service"],
      ["systemctl", "--user", "daemon-reload"],
    ]);
  });

  it("derives the unit-file path under ~/.config/systemd/user", () => {
    expect(systemdUnitPath("/home/dev", HIVE_CURRENT)).toBe("/home/dev/.config/systemd/user/hive.service");
  });
});

describe("unsupported OS", () => {
  it("produces an empty plan (no service manager to act on)", () => {
    const plan = buildDeregisterPlan(HIVE_CURRENT, { os: "unsupported", homeDir: "/", uid: 0 });
    expect(plan.commands).toEqual([]);
  });
});

describe("changeOnZeroExit marks the real removal step per OS (honest `changed` — c-AC-4)", () => {
  // Exactly ONE command per plan carries the removal signal (zero exit ⇒ actually removed): the
  // deregister step whose exit code distinguishes 'removed' from 'already absent'. Stop-only and
  // bookkeeping steps (rm -f, daemon-reload) do NOT — their exit is not a reliable removal signal.
  it("Windows: only schtasks-delete is the change signal (not schtasks-end)", () => {
    const plan = buildDeregisterPlan(HIVE_CURRENT, winCtx);
    expect(plan.commands.find((c) => c.id === "schtasks-delete")?.changeOnZeroExit).toBe(true);
    expect(plan.commands.find((c) => c.id === "schtasks-end")?.changeOnZeroExit).not.toBe(true);
    expect(plan.commands.filter((c) => c.changeOnZeroExit === true)).toHaveLength(1);
  });

  it("macOS: only launchctl-bootout is the change signal (not rm-plist)", () => {
    const plan = buildDeregisterPlan(HIVE_CURRENT, macCtx);
    expect(plan.commands.find((c) => c.id === "launchctl-bootout")?.changeOnZeroExit).toBe(true);
    expect(plan.commands.find((c) => c.id === "rm-plist")?.changeOnZeroExit).not.toBe(true);
    expect(plan.commands.filter((c) => c.changeOnZeroExit === true)).toHaveLength(1);
  });

  it("Linux: only systemctl-disable is the change signal (not rm-unit / daemon-reload)", () => {
    const plan = buildDeregisterPlan(HIVE_CURRENT, linuxCtx);
    expect(plan.commands.find((c) => c.id === "systemctl-disable")?.changeOnZeroExit).toBe(true);
    expect(plan.commands.find((c) => c.id === "rm-unit")?.changeOnZeroExit).not.toBe(true);
    expect(plan.commands.find((c) => c.id === "systemctl-daemon-reload")?.changeOnZeroExit).not.toBe(true);
    expect(plan.commands.filter((c) => c.changeOnZeroExit === true)).toHaveLength(1);
  });
});

describe("APIARY_SERVICE_UNITS coverage (current + legacy)", () => {
  it("includes both a current and a legacy label so old installs are cleaned up", () => {
    expect(APIARY_SERVICE_UNITS.some((u) => u.current)).toBe(true);
    expect(APIARY_SERVICE_UNITS.some((u) => !u.current)).toBe(true);
  });
});
