/**
 * PRD-005c c-AC-4/5/7/8: the takeover ORCHESTRATOR. Ties the pure pieces (labels, per-OS argv,
 * ownership, the Hivemind decision machine) to the injected {@link ServiceSeams}, staying
 * dryRun-DEFAULT, idempotent, and fully logged.
 *
 * SAFETY: this module never imports `node:child_process`, `schtasks`, `launchctl`, `systemctl`, or
 * `npm`. Every effect is a seam call. With `dryRun: true` (the default) NO seam that mutates host
 * state is ever invoked — the run only reports what it WOULD do.
 */

import { z } from "zod";

import { classifyOs, type ServiceOs } from "./os.js";
import { APIARY_SERVICE_UNITS } from "./labels.js";
import { buildDeregisterPlan, type Command, type OsContext } from "./service-manager.js";
import { assertNoProtectedPath, buildStandaloneUninstall, decideStandalone } from "./hivemind.js";
import type { CommandResult, ServiceSeams } from "./seams.js";

/**
 * Options for {@link runServiceTakeover}. The shape is fixed by the PRD-005a stub contract
 * (`{ dryRun?: boolean }`) and validated with zod at the boundary — `dryRun` DEFAULTS TO TRUE so an
 * accidental bare call mutates nothing (the destructive-by-default footgun is designed out).
 */
export const ServiceTakeoverOptionsSchema = z
  .object({
    dryRun: z.boolean().default(true),
  })
  .strict();

/** The caller-facing options type (pre-parse): `dryRun` optional. */
export interface ServiceTakeoverOptions {
  readonly dryRun?: boolean;
}

/** The outcome the caller (main.ts / tray) surfaces. Matches the PRD-005a stub contract exactly. */
export interface ServiceTakeoverResult {
  /** True iff any OS-service unit was actually stopped/deregistered this run (false in dryRun). */
  readonly changed: boolean;
  /** Human-readable audit lines (never a credential). */
  readonly log: readonly string[];
}

/** The outcome of the standalone-Hivemind sub-flow (c-AC-8), folded into the takeover result. */
export type StandaloneOutcome =
  /** Nothing detected, or detected+consented+uninstalled: the app install proceeds. */
  | { readonly kind: "proceed" }
  /** Detected + user DECLINED: the caller must ABORT the app install (machine left unchanged). */
  | { readonly kind: "aborted"; readonly reason: string };

/** The full takeover result, extending the stub contract with the standalone outcome for the caller. */
export interface TakeoverRun extends ServiceTakeoverResult {
  readonly standalone: StandaloneOutcome;
}

/** Build the per-OS argv context from the env seam. */
function osContext(seams: ServiceSeams): { os: ServiceOs; ctx: OsContext } {
  const os = classifyOs(seams.env.platform);
  return { os, ctx: { os, homeDir: seams.env.homeDir, uid: seams.env.uid } };
}

/**
 * Run ONE command through the seam unless this is a dry run, appending an audit line either way.
 * Returns the result (or a synthetic ok result in dryRun). Honours `tolerateFailure` so a
 * "already absent" non-zero exit is not treated as a failure — that is what makes re-running a no-op.
 */
async function runOrDescribe(
  command: Command,
  dryRun: boolean,
  seams: ServiceSeams,
  log: string[],
): Promise<{ ran: boolean; ok: boolean }> {
  const argv = `${command.file} ${command.args.join(" ")}`;
  if (dryRun) {
    log.push(`[dry-run] would run: ${argv}`);
    return { ran: false, ok: true };
  }
  const result: CommandResult = await seams.runCommand(command);
  const ok = command.tolerateFailure ? true : result.ok;
  log.push(`ran: ${argv} -> code=${result.code ?? "signal"}${ok ? "" : " (FAILED)"}`);
  if (!ok) seams.logger.warn("takeover command failed", { id: command.id, code: result.code });
  return { ran: true, ok };
}

/**
 * c-AC-8: run the standalone-Hivemind sub-flow — detect → decide → (proceed | prompt →
 * consent ⇒ uninstall | decline ⇒ abort). Never touches `~/.deeplake` (guarded). In dryRun, the
 * uninstall is described, not executed, but the PROMPT is still shown on consent-required so a dry
 * run faithfully reflects the real decision path.
 */
async function handleStandalone(
  dryRun: boolean,
  seams: ServiceSeams,
  ctx: OsContext,
  log: string[],
): Promise<{ outcome: StandaloneOutcome; changed: boolean }> {
  const detection = await seams.detectStandalone();
  const decision = decideStandalone(detection);
  if (decision.kind === "proceed") {
    log.push("standalone @deeplake/hivemind: not detected; proceeding");
    return { outcome: { kind: "proceed" }, changed: false };
  }

  log.push(
    `standalone @deeplake/hivemind detected (npmGlobal=${detection.npmGlobal}, serviceUnit=${detection.serviceUnit}, livePort=${detection.livePort}); prompting for consent`,
  );
  const answer = await seams.promptConsent(detection);
  if (answer === "decline") {
    log.push("consent DECLINED: aborting app install, machine left unchanged");
    return {
      outcome: { kind: "aborted", reason: "user declined uninstall of standalone @deeplake/hivemind" },
      changed: false,
    };
  }

  log.push("consent GRANTED: uninstalling standalone @deeplake/hivemind (preserving ~/.deeplake)");
  const commands = buildStandaloneUninstall(ctx); // throws if any argv targets the protected dir
  let changed = false;
  for (const command of commands) {
    const { ran, ok } = await runOrDescribe(command, dryRun, seams, log);
    if (ran && ok) changed = true;
    if (ran && !ok && !command.tolerateFailure) {
      // A hard uninstall failure (e.g. npm uninstall failed) must not leave a half state silently.
      return {
        outcome: { kind: "aborted", reason: `standalone uninstall failed at '${command.id}'` },
        changed,
      };
    }
  }
  return { outcome: { kind: "proceed" }, changed };
}

/**
 * c-AC-4/5/8: the takeover. Order (ADR-0005 decision 4/5): resolve the standalone-Hivemind question
 * FIRST (an abort must stop before we mutate any Apiary units), THEN deregister the Apiary OS units,
 * THEN register launch-at-login. Idempotent; dryRun-default; every step logged.
 *
 * Returns a {@link TakeoverRun}: the stub-contract `{ changed, log }` plus the `standalone` outcome
 * so the caller can ABORT the app install on decline. {@link runServiceTakeover} narrows this to the
 * stub contract for `main.ts`.
 */
export async function runTakeover(
  options: ServiceTakeoverOptions,
  seams: ServiceSeams,
): Promise<TakeoverRun> {
  const { dryRun } = ServiceTakeoverOptionsSchema.parse(options);
  const log: string[] = [];
  const { os, ctx } = osContext(seams);
  log.push(`takeover start (os=${os}, dryRun=${dryRun})`);

  if (os === "unsupported") {
    log.push("unsupported OS: no service manager to act on; no-op");
    return { changed: false, log, standalone: { kind: "proceed" } };
  }

  // 1. Standalone Hivemind (c-AC-8) — resolve BEFORE mutating any Apiary units.
  const standalone = await handleStandalone(dryRun, seams, ctx, log);
  if (standalone.outcome.kind === "aborted") {
    return { changed: standalone.changed, log, standalone: standalone.outcome };
  }

  // 2. Deregister every Apiary-owned unit (c-AC-4), current + legacy. Idempotent per-command.
  let changed = standalone.changed;
  for (const unit of APIARY_SERVICE_UNITS) {
    const plan = buildDeregisterPlan(unit, ctx);
    assertNoProtectedPath(plan.commands); // defence in depth: teardown never targets ~/.deeplake
    for (const command of plan.commands) {
      const { ran, ok } = await runOrDescribe(command, dryRun, seams, log);
      if (ran && ok) changed = true;
    }
  }

  // 3. Register launch-at-login (c-AC-3) — the shell becomes the sole autostart owner.
  if (dryRun) {
    log.push("[dry-run] would register launch-at-login (openAtLogin=true)");
  } else {
    seams.setLoginItem(true);
    log.push("registered launch-at-login (openAtLogin=true)");
  }

  log.push(`takeover done (changed=${changed})`);
  return { changed, log, standalone: standalone.outcome };
}

/**
 * c-AC-7: the SHELL-UNINSTALL path — remove launch-at-login, stop + deregister the units the shell
 * owns, and DO NOT re-register the superseded OS services (clean removal, not restore). Pure
 * decision + command construction driven over the seams; dryRun-aware. The absence of any
 * re-register command is the load-bearing property (asserted by a test).
 */
export async function runShellUninstall(
  options: ServiceTakeoverOptions,
  seams: ServiceSeams,
): Promise<ServiceTakeoverResult> {
  const { dryRun } = ServiceTakeoverOptionsSchema.parse(options);
  const log: string[] = [];
  const { os, ctx } = osContext(seams);
  log.push(`shell-uninstall start (os=${os}, dryRun=${dryRun})`);

  // 1. Clear launch-at-login FIRST so a reboot mid-uninstall never re-owns autostart.
  if (dryRun) {
    log.push("[dry-run] would clear launch-at-login (openAtLogin=false)");
  } else {
    seams.setLoginItem(false);
    log.push("cleared launch-at-login (openAtLogin=false)");
  }

  if (os === "unsupported") {
    log.push("unsupported OS: nothing further to deregister; no-op");
    return { changed: false, log };
  }

  // 2. Stop + deregister the units the shell owns. NO re-register command is ever emitted (c-AC-7).
  let changed = false;
  const commands = buildShellUninstallCommands(ctx);
  for (const command of commands) {
    const { ran, ok } = await runOrDescribe(command, dryRun, seams, log);
    if (ran && ok) changed = true;
  }

  log.push(`shell-uninstall done (changed=${changed}); services NOT restored (clean removal)`);
  return { changed, log };
}

/**
 * Build the shell-uninstall command list: the deregister argv for every Apiary unit and nothing
 * that re-registers a service (clean removal, not restore — c-AC-7). Exposed so a test can assert no
 * command ever registers/enables/loads a unit.
 */
export function buildShellUninstallCommands(ctx: OsContext): readonly Command[] {
  const commands = APIARY_SERVICE_UNITS.flatMap((unit) => buildDeregisterPlan(unit, ctx).commands);
  assertNoProtectedPath(commands);
  return commands;
}
