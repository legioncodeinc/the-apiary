/**
 * PRD-005c: FAKE seams for the service-takeover tests. No real process, service manager, or npm is
 * ever touched — every command is RECORDED (not run) and the seams return scripted values. This is
 * the entire safety story for the unit suite: `runCommand` cannot spawn anything.
 */

import type { Command } from "../../src/service/service-manager.js";
import type {
  CommandResult,
  ConsentAnswer,
  EnvSeam,
  ServiceLogger,
  ServiceSeams,
  StandaloneDetection,
} from "../../src/service/seams.js";

/** A silent logger so tests never spam the reporter. */
export const silentLogger: ServiceLogger = {
  info() {},
  warn() {},
  error() {},
};

/** Env presets for the three service-manager families. */
export const windowsEnv: EnvSeam = { platform: "win32", homeDir: "C:/Users/dev", uid: 0 };
export const macosEnv: EnvSeam = { platform: "darwin", homeDir: "/Users/dev", uid: 501 };
export const linuxEnv: EnvSeam = { platform: "linux", homeDir: "/home/dev", uid: 1000 };

/** Detection presets. */
export const noStandalone: StandaloneDetection = { npmGlobal: false, serviceUnit: false, livePort: false };
export const standalonePresent: StandaloneDetection = { npmGlobal: true, serviceUnit: false, livePort: true };

/** Options for {@link makeSeams}. */
export interface FakeSeamOptions {
  readonly env: EnvSeam;
  readonly detection?: StandaloneDetection;
  readonly consent?: ConsentAnswer;
  /** Per-command-id exit codes; a command whose id is absent exits 0. */
  readonly exitCodes?: Readonly<Record<string, number>>;
}

/** A recording fake seam set plus the arrays the tests assert against. */
export interface FakeSeams {
  readonly seams: ServiceSeams;
  /** Every command handed to `runCommand`, in order (empty on a dry run — nothing is executed). */
  readonly ranCommands: Command[];
  /** Every `setLoginItem` toggle, in order. */
  readonly loginToggles: boolean[];
  /** How many times the consent prompt was shown. */
  promptCount(): number;
}

/**
 * Build a fully-faked seam set. `runCommand` RECORDS the command and returns a scripted exit code;
 * it never spawns. `promptConsent` returns the scripted answer and counts calls. `setLoginItem`
 * records the toggle.
 */
export function makeSeams(options: FakeSeamOptions): FakeSeams {
  const ranCommands: Command[] = [];
  const loginToggles: boolean[] = [];
  let prompts = 0;
  const exitCodes = options.exitCodes ?? {};

  const seams: ServiceSeams = {
    runCommand: (command: Command): Promise<CommandResult> => {
      ranCommands.push(command);
      const code = command.id in exitCodes ? (exitCodes[command.id] as number) : 0;
      const ok = command.tolerateFailure ? true : code === 0;
      return Promise.resolve({ code, ok });
    },
    detectStandalone: () => Promise.resolve(options.detection ?? noStandalone),
    promptConsent: () => {
      prompts += 1;
      return Promise.resolve(options.consent ?? "decline");
    },
    setLoginItem: (openAtLogin: boolean) => {
      loginToggles.push(openAtLogin);
    },
    env: options.env,
    logger: silentLogger,
  };

  return { seams, ranCommands, loginToggles, promptCount: () => prompts };
}
