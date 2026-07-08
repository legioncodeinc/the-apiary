/**
 * PRD-005c (finding: the initial fleet-status snapshot must go through the notification decision).
 *
 * A PURE (no `electron`) state machine that both the INITIAL snapshot and every subsequent
 * `onStatusChange` tick flow through, so a fleet already in `hasTerminalFailure` on the very first
 * tick (e.g. a fast port-in-use failure that resolves terminal before the tray subscribes) still
 * fires exactly one notification — respecting the once-per-transition dedupe and focus suppression
 * that {@link decideNotification} already encodes.
 *
 * The electron wrapper (`index.ts`) owns rendering and the real `new Notification(...).show()`; it
 * feeds each tick (initial + changes) here and acts on the returned decision. Extracting the
 * across-ticks bookkeeping makes "the first tick is not skipped" a unit-tested invariant rather than
 * a control-flow detail buried in an electron-only wrapper.
 */

import type { FleetStatus } from "../supervisor/index.js";
import { decideNotification, type NotificationDecision } from "./notification-policy.js";

/** Tracks `previous` status across ticks so the initial tick and change ticks share one dedupe path. */
export interface NotificationGate {
  /**
   * Process one status tick (initial snapshot OR change). Returns the notification decision AND
   * advances the remembered `previous` status. The caller renders on every tick regardless; it only
   * fires a native notification when `decision.kind === "notify"`.
   */
  tick(status: FleetStatus, windowFocused: boolean): NotificationDecision;
  /** Reset the remembered status (used when the supervisor is swapped on Restart Fleet). */
  reset(): void;
}

/** Construct a fresh {@link NotificationGate}. `previous` starts undefined, matching a cold subscribe. */
export function createNotificationGate(): NotificationGate {
  let previous: FleetStatus | undefined;
  return {
    tick(status: FleetStatus, windowFocused: boolean): NotificationDecision {
      const decision = decideNotification(previous, status, windowFocused);
      previous = status;
      return decision;
    },
    reset(): void {
      previous = undefined;
    },
  };
}
