/**
 * PRD-005c: the DEFAULT (production) wiring of the service-takeover seams. Tests NEVER import this —
 * they hand the orchestrator fully-faked {@link ServiceSeams}. Keeping the real-world wiring here
 * (not inside the orchestrator) is what keeps `takeover.ts` pure and unit-testable with no real
 * processes, and is why nothing in `takeover.ts` imports `node:child_process`/`npm`/`schtasks`.
 *
 * IMPORTANT: importing this module does NOT run anything. It only builds functions. The destructive
 * effects happen only when the takeover CALLS a seam with `dryRun: false`.
 *
 * The Electron `app.setLoginItemSettings` binding is injected by the caller (main.ts, which has
 * `app`) rather than imported here, so this module stays free of an Electron import and remains
 * loadable in a plain-Node context.
 */

import { spawn } from "node:child_process";
import { homedir, userInfo } from "node:os";

import type { Command } from "./service-manager.js";
import type {
  CommandResult,
  DetectStandaloneFn,
  EnvSeam,
  PromptConsentFn,
  RunCommandFn,
  ServiceLogger,
  ServiceSeams,
  SetLoginItemFn,
  StandaloneDetection,
} from "./seams.js";

/** A minimal console logger. Never logs a credential (the takeover only passes safe fields). */
export const consoleServiceLogger: ServiceLogger = {
  info(message, fields) {
    console.info(`[service] ${message}`, fields ?? {});
  },
  warn(message, fields) {
    console.warn(`[service] ${message}`, fields ?? {});
  },
  error(message, fields) {
    console.error(`[service] ${message}`, fields ?? {});
  },
};

/**
 * The production {@link RunCommandFn}: spawn the command with `shell: false` (belt-and-braces on top
 * of the already-safe argv from our own constants — c-AC-4) and resolve its exit code. Honours
 * `tolerateFailure` so an "already absent" non-zero exit is reported as `ok`.
 */
export function createRealRunCommand(): RunCommandFn {
  return (command: Command): Promise<CommandResult> =>
    new Promise<CommandResult>((resolve) => {
      const child = spawn(command.file, [...command.args], { shell: false, stdio: "ignore" });
      child.once("error", () => resolve({ code: null, ok: command.tolerateFailure }));
      child.once("close", (code) => {
        const ok = command.tolerateFailure ? true : code === 0;
        resolve({ code, ok });
      });
    });
}

/**
 * The production standalone detector. STUBBED-SAFE: the real npm-global / service-unit / live-:3850
 * probes are themselves I/O and are wired in a later integration pass (they must use the same
 * `shell:false` spawn discipline). Until then this returns "nothing detected" so the default path is
 * safe — it will never claim a standalone Hivemind exists and trigger an uninstall on a real machine
 * without a real probe behind it.
 *
 * TODO(005c-confirm): wire the real probes (npm ls -g @deeplake/hivemind / service-unit query /
 * a bounded fetch to 127.0.0.1:3850) here, each over an argv-safe seam; keep the shape below.
 */
export function createRealDetectStandalone(): DetectStandaloneFn {
  return async (): Promise<StandaloneDetection> => ({ npmGlobal: false, serviceUnit: false, livePort: false });
}

/**
 * The production consent prompt. STUBBED-SAFE default: declines. A real native dialog is injected by
 * the caller (main.ts, which owns the Electron `dialog`); the default declines so that in the
 * absence of a real prompt the app never uninstalls a standalone product unattended.
 *
 * TODO(005c-confirm): inject an Electron `dialog.showMessageBox`-backed prompt from main.ts.
 */
export function createRealPromptConsent(): PromptConsentFn {
  return async () => "decline";
}

/**
 * The production launch-at-login toggle. STUBBED-SAFE no-op default: the real one is
 * `app.setLoginItemSettings({ openAtLogin })`, injected by main.ts (which owns Electron `app`). The
 * default is a no-op so importing defaults in a plain-Node context registers nothing.
 */
export function createRealSetLoginItem(): SetLoginItemFn {
  return (_openAtLogin: boolean): void => undefined;
}

/** Read the real environment facts (platform, home dir, uid) for the argv builders. */
export function realEnv(): EnvSeam {
  let uid = 0;
  try {
    const info = userInfo();
    uid = typeof info.uid === "number" && info.uid >= 0 ? info.uid : 0;
  } catch {
    uid = 0; // userInfo can throw on some Windows configs; uid is macOS-only anyway.
  }
  return { platform: process.platform, homeDir: homedir(), uid };
}

/**
 * Build the default production seams. `overrides` lets main.ts inject the Electron-backed
 * `setLoginItem` + `promptConsent` (and, later, the real detector) without this module importing
 * Electron. Tests do NOT call this — they build a full fake seam set directly.
 */
export function createDefaultServiceSeams(overrides: Partial<ServiceSeams> = {}): ServiceSeams {
  return {
    runCommand: overrides.runCommand ?? createRealRunCommand(),
    detectStandalone: overrides.detectStandalone ?? createRealDetectStandalone(),
    promptConsent: overrides.promptConsent ?? createRealPromptConsent(),
    setLoginItem: overrides.setLoginItem ?? createRealSetLoginItem(),
    env: overrides.env ?? realEnv(),
    logger: overrides.logger ?? consoleServiceLogger,
  };
}
