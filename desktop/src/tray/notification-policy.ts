/**
 * PRD-005c (c-AC-2): the PURE notification-decision core.
 *
 * No `electron` import. Decides WHETHER a fleet-status tick warrants firing a native `Notification`,
 * given the previous status, the new status, and whether the main window currently has focus. The
 * electron wrapper (`index.ts`) owns the actual `new Notification(...).show()` call; it feeds every
 * `onStatusChange` tick plus the window's live focus state through {@link decideNotification} and
 * only shows a notification when the result says to.
 *
 * Scope (PRD-005c "Notifications scope"): start minimal — fire on the transition INTO
 * `hasTerminalFailure`, not on every tick while it stays true (dedupe: once per transition), and
 * never while the main window is focused (the dashboard already shows it there).
 */

import type { FleetStatus } from "../supervisor/index.js";

/** What the wrapper should do for one status tick. */
export type NotificationDecision =
  /** Fire a native notification with this title/body. */
  | { readonly kind: "notify"; readonly title: string; readonly body: string }
  /** Do nothing — not a new terminal-failure transition, or the window is focused. */
  | { readonly kind: "suppressed"; readonly reason: "no-transition" | "window-focused" | "not-critical" };

/** Fixed copy for the one notification this wave ships: a daemon in a terminal failure state. */
export const TERMINAL_FAILURE_TITLE = "Apiary needs attention";

/** Build the notification body from the fleet status, naming the failed root(s) (credential-free). */
function terminalFailureBody(status: FleetStatus): string {
  const failed = status.roots.filter((r) => r.phase === "failed" || r.phase === "port-conflict");
  const names = failed.map((r) => r.name).join(", ");
  return names.length > 0
    ? `${names} could not be restarted. Open Apiary to see details.`
    : "A fleet component could not be restarted. Open Apiary to see details.";
}

/**
 * Decide whether this status transition warrants a native notification (c-AC-2).
 *
 * Dedupe rule: only the FALSE→TRUE edge of `hasTerminalFailure` fires — as long as the fleet stays
 * in terminal failure, repeated ticks are suppressed as `no-transition`. Recovery (TRUE→FALSE) and
 * any other tick are likewise `no-transition`. Focus suppression takes priority: even a fresh
 * transition into terminal failure is suppressed while the window is focused, since the dashboard
 * already surfaces it there.
 */
export function decideNotification(
  previous: FleetStatus | undefined,
  next: FleetStatus,
  windowFocused: boolean,
): NotificationDecision {
  const wasTerminal = previous?.hasTerminalFailure ?? false;
  const isTerminal = next.hasTerminalFailure;

  if (!isTerminal) {
    return { kind: "suppressed", reason: "not-critical" };
  }
  if (wasTerminal) {
    // Already notified for this ongoing failure; do not repeat on every tick (dedupe).
    return { kind: "suppressed", reason: "no-transition" };
  }
  if (windowFocused) {
    // The dashboard is visible and already shows this state; no need to interrupt with a toast.
    return { kind: "suppressed", reason: "window-focused" };
  }
  return { kind: "notify", title: TERMINAL_FAILURE_TITLE, body: terminalFailureBody(next) };
}
