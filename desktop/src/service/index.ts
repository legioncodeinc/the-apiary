/**
 * PRD-005c: the service-takeover module public surface. Replaces the wave-1 stub. `main.ts` calls
 * {@link runServiceTakeover} on `whenReady` BEFORE `supervisor.start()` (ADR-0005 decision 4) so the
 * app is the sole autostart owner before the fleet starts.
 *
 * OS-service takeover (ADR-0005 decisions 4/5): detect a standalone `@deeplake/hivemind` → prompt →
 * (consent ⇒ uninstall preserving `~/.deeplake` | decline ⇒ abort), deregister the Apiary OS units
 * (current + legacy labels) so no daemon is double-started, and register launch-at-login. Idempotent;
 * logs what it changed.
 *
 * SAFETY: `dryRun` DEFAULTS TO TRUE. A bare `runServiceTakeover()` mutates NOTHING — it reports what
 * it would do. `main.ts` may pass `{ dryRun: false }` (and Electron-backed seams) once the shell is
 * ready to become the real owner. Every external effect is an injectable seam; this module calls no
 * real `child_process`/`schtasks`/`launchctl`/`systemctl`/`npm` at load.
 */

import { createDefaultServiceSeams } from "./defaults.js";
import { runTakeover, type ServiceTakeoverOptions, type ServiceTakeoverResult } from "./takeover.js";
import type { ServiceSeams } from "./seams.js";

export type { ServiceTakeoverOptions, ServiceTakeoverResult } from "./takeover.js";
export type { TakeoverRun, StandaloneOutcome } from "./takeover.js";
export { runTakeover, runShellUninstall, buildShellUninstallCommands } from "./takeover.js";
export { createDefaultServiceSeams } from "./defaults.js";
export type { ServiceSeams } from "./seams.js";

/**
 * Run the OS-service takeover (c-AC-4/5/8). Signature preserved from the wave-1 stub:
 * `runServiceTakeover(opts): Promise<ServiceTakeoverResult>` with `ServiceTakeoverOptions
 * { dryRun?: boolean }` and `ServiceTakeoverResult { changed, log }`.
 *
 * `seams` is an optional second argument (defaulting to the safe production seams). `main.ts` calls
 * it with a single argument, so the default seams apply there unchanged; tests call it with a full
 * fake seam set. It narrows the richer {@link runTakeover} result to the stub contract — callers who
 * need the standalone-abort outcome (to stop the app install on decline) use {@link runTakeover}.
 */
export async function runServiceTakeover(
  options: ServiceTakeoverOptions = {},
  seams: ServiceSeams = createDefaultServiceSeams(),
): Promise<ServiceTakeoverResult> {
  const run = await runTakeover(options, seams);
  return { changed: run.changed, log: run.log };
}
