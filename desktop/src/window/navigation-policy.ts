/**
 * PRD-005b (b-AC-5): the PURE navigation allow-list decision for the main window.
 *
 * No `electron` import — this is the testable core the electron `will-navigate` /
 * `setWindowOpenHandler` wrappers call. The main window may ONLY ever sit on Hive's loopback
 * dashboard origin (`http://127.0.0.1:3853`). Any other URL is NOT allowed inside the main window:
 *  - a genuine external link (docs, Discord) is opened deliberately in the OS browser via
 *    `shell.openExternal` — it is `external`, never in-window;
 *  - everything else (a `file://`, a foreign http origin, a widened loopback host/port) is
 *    `blocked` outright.
 *
 * This preserves the loopback-only exposure (b-AC-5): navigation cannot walk the window off
 * `127.0.0.1:3853` and cannot silently broaden the origin the renderer trusts.
 */

/** The one origin the main window is allowed to load. Loopback IPv4 only — never `localhost`, never a wider host. */
export const DASHBOARD_ORIGIN = "http://127.0.0.1:3853";

/**
 * The internal sentinel URL the failed-view Retry link navigates to (b-AC-4). It is recognised here
 * and mapped to a `retry` decision so the window can re-arm the readiness gate; it is NEVER loaded
 * or opened externally. Duplicated as a const in `chrome-views.ts` (the two must stay in lockstep;
 * a unit test asserts they match) so the pure navigation core needs no import from the view module.
 */
export const RETRY_SENTINEL_URL = "https://apiary.invalid/__retry";

/** What the main window should do with a navigation/open request. */
export type NavigationDecision =
  /** Same as the dashboard origin: keep it in the main window. */
  | { readonly kind: "allow-in-window" }
  /** The failed-view Retry sentinel: cancel navigation and re-arm the readiness gate (b-AC-4). */
  | { readonly kind: "retry" }
  /** A genuine external `https`/`http` link: hand to `shell.openExternal`, do NOT load in-window. */
  | { readonly kind: "external" }
  /** Neither the dashboard nor a safe external link: refuse. Carries a short, credential-free reason. */
  | { readonly kind: "blocked"; readonly reason: string };

/** Parse a URL, returning `undefined` (never throwing) on anything the WHATWG parser rejects. */
function safeParse(rawUrl: string): URL | undefined {
  try {
    return new URL(rawUrl);
  } catch {
    return undefined;
  }
}

/**
 * Is this exactly the dashboard origin? Compares the parsed `origin` (scheme + host + port),
 * so `http://127.0.0.1:3853/anything` matches but `http://127.0.0.1:9999`,
 * `http://localhost:3853`, or `https://127.0.0.1:3853` do NOT — the origin must be identical.
 */
export function isDashboardUrl(rawUrl: string): boolean {
  const parsed = safeParse(rawUrl);
  if (parsed === undefined) return false;
  return parsed.origin === DASHBOARD_ORIGIN;
}

/**
 * Decide what the main window should do with a navigation or window-open target (b-AC-5).
 *
 * - Dashboard origin → `allow-in-window`.
 * - A well-formed `http:`/`https:` link that is NOT the dashboard → `external` (open in the OS
 *   browser via `shell.openExternal`; never widen the in-window origin).
 * - Anything else — unparseable, `file:`, `data:`, `javascript:`, or any other scheme → `blocked`.
 */
export function decideNavigation(rawUrl: string): NavigationDecision {
  // The retry sentinel is matched on the exact href, before the origin check — it must never be
  // loaded in-window nor opened externally; it only signals "re-arm the gate".
  if (rawUrl === RETRY_SENTINEL_URL) {
    return { kind: "retry" };
  }
  const parsed = safeParse(rawUrl);
  if (parsed === undefined) {
    return { kind: "blocked", reason: "unparseable URL" };
  }
  if (parsed.origin === DASHBOARD_ORIGIN) {
    return { kind: "allow-in-window" };
  }
  if (parsed.protocol === "http:" || parsed.protocol === "https:") {
    // A real external web link. It leaves the app entirely (OS browser), so it can never widen
    // the loopback surface the renderer runs on.
    return { kind: "external" };
  }
  return { kind: "blocked", reason: `disallowed scheme "${parsed.protocol}"` };
}
