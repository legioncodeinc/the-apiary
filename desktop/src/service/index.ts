/**
 * PRD-005c extension point (STUB). Wave 2 implements the body; this file exists so `main.ts` can
 * wire the call and the takeover→supervisor ordering is fixed now.
 *
 * OS-service takeover (ADR-0005 decision 4): on first run as fleet owner, detect existing Apiary
 * service units, stop + deregister them (current + legacy labels, reusing PRD-003's machinery),
 * and register launch-at-login — so the desktop app becomes the SOLE autostart owner before the
 * supervisor starts the fleet. Idempotent; logs what it changed. It runs BEFORE
 * {@link FleetSupervisor.start} so the shell never double-starts against an OS service.
 *
 * This wave (005a) does NOT touch real OS services — this is a stub only.
 */

/** The result of a takeover run, so `main.ts` / the tray can surface what changed (005c fills this out). */
export interface ServiceTakeoverResult {
  /** True iff any OS-service unit was stopped/deregistered this run. */
  readonly changed: boolean;
  /** Human-readable audit lines (never a credential). */
  readonly log: readonly string[];
}

/** Options for {@link runServiceTakeover} (005c defines the real shape; kept minimal here). */
export interface ServiceTakeoverOptions {
  /** When true, only report what WOULD change without mutating host service state. */
  readonly dryRun?: boolean;
}

/**
 * Run the OS-service takeover (005c). STUB: throws until wave 2 implements it. `main.ts` calls
 * this on `whenReady` BEFORE `supervisor.start()`; wave 2 fills the body (detect → stop →
 * deregister → setLoginItemSettings) reusing PRD-003's teardown, idempotently.
 */
export function runServiceTakeover(_options: ServiceTakeoverOptions = {}): Promise<ServiceTakeoverResult> {
  return Promise.reject(new Error("TODO 005c: runServiceTakeover is not implemented yet (service-migration wave)."));
}
