/**
 * PRD-005b (b-AC-1 / b-AC-4): the PURE readiness-gate state machine for the main window.
 *
 * No `electron` import. This is the testable core that decides WHAT the window should show and WHEN
 * to load the dashboard, driven by three inputs only: "hive became ready", "the startup budget
 * expired", and "the user pressed retry". The electron wrapper (`index.ts`) owns the timer,
 * `supervisor.onHiveReady`, and the actual `loadURL` / native-view rendering — it just forwards
 * those three events here and reacts to the emitted {@link GateState}.
 *
 * States:
 *   - `loading`  — waiting for Hive; the window shows a native loading view (never a blank page).
 *   - `ready`    — Hive answered healthy within budget; the wrapper now `loadURL`s the dashboard.
 *   - `failed`   — the budget expired before Hive was ready; the window shows an ACTIONABLE failure
 *                  view with a retry affordance (b-AC-4), never a raw error page.
 *
 * The machine is deliberately monotonic-per-attempt and idempotent: once `ready`, a late budget
 * expiry cannot knock it back to `failed`; once `failed`, a late readiness signal is ignored until
 * the user explicitly retries (which returns it to `loading`). This prevents the classic race where
 * a slow-but-eventual Hive flips the UI after it already showed (or hid) the failure view.
 */

/** The three phases the gate can be in. The wrapper renders one native view per phase. */
export type GatePhase = "loading" | "ready" | "failed";

/** An immutable snapshot the wrapper renders from. */
export interface GateState {
  readonly phase: GatePhase;
  /**
   * An actionable, credential-free message when {@link phase} is `failed`; `undefined` otherwise.
   * Shown in the failure view alongside the retry affordance (b-AC-4).
   */
  readonly message?: string;
}

/** A listener for gate-state transitions. Called once per ACTUAL change (never for a no-op event). */
export type GateListener = (state: GateState) => void;

/** The message shown when the startup budget expires before Hive is ready (b-AC-4). */
export const BUDGET_EXPIRED_MESSAGE =
  "The Apiary dashboard did not start in time. Hive may still be starting up — press Retry to try again.";

/**
 * The readiness gate. Construct it, subscribe with {@link onChange}, then forward exactly three
 * events from the electron wrapper: {@link markHiveReady}, {@link markBudgetExpired}, {@link retry}.
 */
export interface ReadinessGate {
  /** The current immutable snapshot. Safe to read any time. Starts in `loading`. */
  getState(): GateState;
  /** Hive reported healthy (from `supervisor.onHiveReady`). `loading` → `ready`. No-op otherwise. */
  markHiveReady(): void;
  /** The startup budget timer fired. `loading` → `failed`. No-op if already `ready` or `failed`. */
  markBudgetExpired(): void;
  /** The user pressed retry in the failure view. `failed` → `loading`. No-op otherwise. */
  retry(): void;
  /** Subscribe to state changes; returns an unsubscribe fn. */
  onChange(listener: GateListener): () => void;
}

/** Create a fresh readiness gate in the `loading` phase (b-AC-4). */
export function createReadinessGate(): ReadinessGate {
  let state: GateState = { phase: "loading" };
  const listeners = new Set<GateListener>();

  const transition = (next: GateState): void => {
    state = next;
    for (const listener of listeners) listener(state);
  };

  return {
    getState() {
      return state;
    },
    markHiveReady() {
      // Only the loading phase can advance to ready. A ready/failed gate ignores a (possibly late)
      // readiness signal — retry is the only documented path out of failed.
      if (state.phase === "loading") {
        transition({ phase: "ready" });
      }
    },
    markBudgetExpired() {
      // A budget expiry only matters while still loading. If Hive already became ready, the expired
      // timer is a stale no-op (prevents flipping a shown dashboard to a failure view).
      if (state.phase === "loading") {
        transition({ phase: "failed", message: BUDGET_EXPIRED_MESSAGE });
      }
    },
    retry() {
      // Retry is only meaningful from the failure view. It returns to loading so the wrapper can
      // re-arm the budget timer and re-subscribe/re-check readiness.
      if (state.phase === "failed") {
        transition({ phase: "loading" });
      }
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
