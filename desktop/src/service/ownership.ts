/**
 * PRD-005c c-AC-6 (ADR-0005 decision 3): the single-supervisor-owner boundary as a PURE function.
 *
 * The registry records exactly ONE supervisor-owner per daemon:
 *   - the SHELL owns the two roots — Doctor + Hive,
 *   - DOCTOR owns the workloads — honeycomb, nectar, the embed daemon.
 * A supervisor only ever acts on a unit it owns. This module answers "does owner X own daemon Y?"
 * with no I/O, so the boundary is provable in a unit test rather than merely conventional.
 *
 * The takeover consults {@link shellOwns} before it deregisters a unit, so the shell can never act
 * on a workload unit that Doctor owns (which is why deregistering an Apiary unit and supervising a
 * root are two disjoint sets: Nectar's legacy unit is deregistered as leftover autostart, but the
 * shell never SUPERVISES nectar — Doctor does).
 */

/** The two supervisor-owners in the desktop process graph (ADR-0005 decision 2/3). */
export type SupervisorOwner = "shell" | "doctor";

/** Daemons the SHELL owns (keeps alive). Exactly the two roots. */
export const SHELL_OWNED_DAEMONS: readonly string[] = ["doctor", "hive"];

/** Daemons DOCTOR owns (keeps alive). The workloads — the shell must NEVER restart these. */
export const DOCTOR_OWNED_DAEMONS: readonly string[] = ["honeycomb", "nectar", "embed"];

/** True iff `owner` is the recorded single-owner of `daemon`. Total; unknown daemons are owned by no one. */
export function isOwnedBy(owner: SupervisorOwner, daemon: string): boolean {
  const table = owner === "shell" ? SHELL_OWNED_DAEMONS : DOCTOR_OWNED_DAEMONS;
  return table.includes(daemon);
}

/** True iff the SHELL owns `daemon` (may supervise/restart it). The shell owns only Doctor + Hive. */
export function shellOwns(daemon: string): boolean {
  return isOwnedBy("shell", daemon);
}

/**
 * The boundary assertion (c-AC-6): a supervisor may act on a daemon ONLY if it is the single owner.
 * Returns a decision object rather than throwing so the caller logs a clear, credential-free line.
 * If BOTH the shell and Doctor appeared to own the same daemon, that is a boundary violation and
 * `allowed` is false regardless of `actor` (defence in depth against a mis-populated registry).
 */
export interface OwnershipDecision {
  readonly allowed: boolean;
  /** A short, log-safe reason (never a credential). */
  readonly reason: string;
}

export function canActOn(actor: SupervisorOwner, daemon: string): OwnershipDecision {
  const shell = isOwnedBy("shell", daemon);
  const doctor = isOwnedBy("doctor", daemon);
  if (shell && doctor) {
    return { allowed: false, reason: `boundary violation: '${daemon}' claimed by both shell and doctor` };
  }
  if (!shell && !doctor) {
    return { allowed: false, reason: `no owner recorded for '${daemon}'` };
  }
  const isOwner = actor === "shell" ? shell : doctor;
  return isOwner
    ? { allowed: true, reason: `${actor} owns '${daemon}'` }
    : { allowed: false, reason: `${actor} does not own '${daemon}'` };
}
