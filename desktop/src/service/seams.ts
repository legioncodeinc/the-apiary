/**
 * PRD-005c: the INJECTABLE SEAMS for the service-takeover module. Every external effect this module
 * can have — running an OS command, detecting a standalone product, prompting the user, reading the
 * environment, toggling launch-at-login — goes through one of these functions. NOTHING here calls a
 * real `child_process`, `schtasks`, `launchctl`, `systemctl`, or `npm` at module load. The
 * production wiring of these seams (over `node:child_process` with `shell:false`, `os`, and
 * Electron's `app.setLoginItemSettings`) lives in `defaults.ts` and is NEVER imported by tests.
 *
 * This mirrors the supervisor's seam pattern (`src/supervisor/seams.ts` / `types.ts`): the
 * orchestrator is pure and unit-testable because the real world is a set of injected functions.
 */

import type { Command } from "./service-manager.js";

/** The outcome of running one {@link Command} through the {@link RunCommandFn} seam. */
export interface CommandResult {
  /** The process exit code, or null if it was killed by a signal. */
  readonly code: number | null;
  /**
   * True iff the caller should treat this as success. For a `tolerateFailure` command a non-zero
   * exit is still `ok: true` (idempotent "already absent"); otherwise `ok` mirrors `code === 0`.
   */
  readonly ok: boolean;
}

/**
 * Run ONE argv-safe command and resolve its result. The production impl spawns with `shell: false`
 * (never a shell string) — the argv already came from our own constants, but `shell:false` is the
 * belt-and-braces guarantee (c-AC-4). Tests pass a fake that records argv and returns a scripted code.
 *
 * The seam receives the whole {@link Command} (not just file+args) so the impl can honour
 * `tolerateFailure` when computing `ok`.
 */
export type RunCommandFn = (command: Command) => Promise<CommandResult>;

/** What a detection probe found for the standalone `@deeplake/hivemind` (c-AC-8). */
export interface StandaloneDetection {
  /** True iff `@deeplake/hivemind` is installed as an npm global. */
  readonly npmGlobal: boolean;
  /** True iff a standalone Hivemind OS service unit is registered. */
  readonly serviceUnit: boolean;
  /** True iff something answers on the standalone daemon's loopback port (127.0.0.1:3850). */
  readonly livePort: boolean;
}

/** Probe for a standalone `@deeplake/hivemind` (npm global / service unit / live :3850). No side effects. */
export type DetectStandaloneFn = () => Promise<StandaloneDetection>;

/** The user's answer to the standalone-uninstall consent prompt (c-AC-8 / ADR-0005 decision 5). */
export type ConsentAnswer = "consent" | "decline";

/**
 * Ask the user to consent to uninstalling the detected standalone Hivemind. The production impl is
 * a native dialog; tests script the answer. The message is fixed by the caller so the seam only
 * returns the decision.
 */
export type PromptConsentFn = (detection: StandaloneDetection) => Promise<ConsentAnswer>;

/** Register or clear launch-at-login (c-AC-3 / c-AC-7). Production impl = `app.setLoginItemSettings`. */
export type SetLoginItemFn = (openAtLogin: boolean) => void;

/** Environment facts the argv builders need (home dir, uid, platform), injected so tests fix them. */
export interface EnvSeam {
  /** The current OS platform (`process.platform`), classified by the caller. */
  readonly platform: NodeJS.Platform;
  /** The user's home directory (mac/linux plist + unit-file paths). */
  readonly homeDir: string;
  /** The numeric uid for launchctl's `gui/<uid>` domain (macOS). 0 on platforms that don't use it. */
  readonly uid: number;
}

/** The full seam set the takeover consumes. All injectable; the default set is built in `defaults.ts`. */
export interface ServiceSeams {
  readonly runCommand: RunCommandFn;
  readonly detectStandalone: DetectStandaloneFn;
  readonly promptConsent: PromptConsentFn;
  readonly setLoginItem: SetLoginItemFn;
  readonly env: EnvSeam;
  readonly logger: ServiceLogger;
}

/** A structured, credential-free log sink for the takeover audit trail. Defaults to `console`. */
export interface ServiceLogger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}
