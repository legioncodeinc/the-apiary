/**
 * PRD-004 seam (b-AC-7): the PURE validation for the auth-window verification URI.
 *
 * No `electron` import. The PRD-004 device-flow auth window (built later) hands this module a URL
 * that the renderer asked to open; this module decides whether the main process is allowed to open
 * an app-owned child window pointed at it. The rule is deliberately narrow: **`https:` only**.
 * `http:`, `file:`, `data:`, `javascript:`, and anything unparseable are rejected — an owned
 * browser window must never be pointed at a plaintext or local-scheme target on behalf of the
 * renderer.
 *
 * This channel carries ONLY the URL (and lifecycle signals). It never carries a token — the token
 * lives in Hive's Deep Lake auth exchange, out of the renderer's and this seam's reach (b-AC-7).
 */

import { z } from "zod";

/** The result of validating a candidate verification URI. */
export type AuthUrlValidation =
  /** Accepted: a well-formed `https:` URL, normalized via the WHATWG parser. */
  | { readonly ok: true; readonly url: string }
  /** Rejected: a short, credential-free reason the caller can log/surface. */
  | { readonly ok: false; readonly reason: string };

/**
 * Zod boundary schema for the raw input. The renderer is an untrusted boundary: the value must be
 * a non-empty string before we even attempt to parse it as a URL (b-AC-7 / zod-at-boundary).
 */
export const authUrlInputSchema = z.string().min(1, "auth URL must be a non-empty string");

/**
 * Validate a candidate verification URI for the owned auth window (b-AC-7).
 *
 * Accepts ONLY `https:` URLs. Returns the parser-normalized `href` on success so the caller opens
 * exactly what was validated (no room for a second, different parse). Never throws.
 */
export function validateAuthUrl(rawUrl: unknown): AuthUrlValidation {
  const parsedInput = authUrlInputSchema.safeParse(rawUrl);
  if (!parsedInput.success) {
    return { ok: false, reason: "auth URL must be a non-empty string" };
  }

  let url: URL;
  try {
    url = new URL(parsedInput.data);
  } catch {
    return { ok: false, reason: "auth URL is not a valid URL" };
  }

  if (url.protocol !== "https:") {
    return { ok: false, reason: `auth URL must be https (got "${url.protocol}")` };
  }

  return { ok: true, url: url.href };
}

/**
 * PURE in-window navigation decision for the owned auth child window (b-AC-7).
 *
 * The child renders an UNTRUSTED remote verification page. It may only ever navigate WITHIN `https:`
 * (device-flow pages legitimately hop across https origins). Anything else — an http downgrade,
 * `file:`, `data:`, `javascript:`, a custom scheme, or an unparseable target — must be refused.
 *
 * This is the single decision both the `will-navigate` AND `will-redirect` electron handlers call:
 * `will-navigate` does NOT fire for a server-side (3xx) redirect, so a validated https page that a
 * server bounces to `http:`/`file:`/another scheme mid-flight would otherwise escape the guard.
 * Returns `true` to ALLOW the navigation in-window, `false` to block it. Never throws.
 */
export function isAllowedAuthChildNavigation(rawUrl: string): boolean {
  let protocol: string | undefined;
  try {
    protocol = new URL(rawUrl).protocol;
  } catch {
    protocol = undefined;
  }
  // Only https navigation may proceed in-window. Everything else is refused.
  return protocol === "https:";
}
