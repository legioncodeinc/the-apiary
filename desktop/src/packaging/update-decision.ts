/**
 * PRD-005d d-AC-5: the update-flow DECISION LOGIC, as a pure, unit-tested module.
 *
 * The forcing function: an UNSIGNED build (this wave's shipped reality — no Apple Developer ID
 * or Windows cert exists yet, per prd-005d's open question) cannot safely auto-apply an
 * electron-updater update. electron-updater's silent auto-update path assumes the running app
 * and the downloaded update are both verifiably signed by the same identity; skipping that check
 * on an unsigned build is exactly the "broken silent auto-update" failure mode the parent PRD
 * calls out. So this module decides, from an evidence-only {@link UpdateDecisionContext} (never
 * touching electron-updater, the filesystem, or the network itself), whether the caller may:
 *   - "auto-apply"      — signing is valid on this build; let electron-updater run its normal
 *                          download-verify-quit-install flow.
 *   - "prompt-download" — signing is absent/invalid; surface a manual "update available —
 *                          download" prompt instead (d-AC-5's explicit non-broken fallback).
 *   - "up-to-date"      — no newer version is available; nothing to do.
 *   - "check-failed"    — the update check itself errored; surface the error, do not retry loop.
 *
 * `src/packaging/updater.ts` is the thin electron-updater wrapper that calls this pure function
 * with real context and acts on the verdict — this module never imports electron or
 * electron-updater, so it is testable with zero Electron runtime (mirrors node-resolver.ts's
 * seam-injection discipline).
 */

/** The platform signing posture this build was produced under (read from build-time config, not probed at runtime). */
export type SigningPosture =
  /** This build was code-signed for its OS AND the update artifact's signature verifies. */
  | "signed"
  /** No signing identity was used for this build (this wave's default: unsigned). */
  | "unsigned"
  /** A signing identity exists but electron-updater could not verify the update artifact's signature. */
  | "signature-invalid";

/** Whether a newer version is available, as reported by the update-feed check. */
export type UpdateCheckOutcome =
  | { readonly kind: "up-to-date" }
  | { readonly kind: "update-available"; readonly version: string; readonly downloadUrl: string }
  /** The feed check itself failed (network, 404, malformed feed) — never treated as "up-to-date". */
  | { readonly kind: "check-failed"; readonly reason: string };

/** Evidence-only input: no side effects, no Electron/electron-updater imports. */
export interface UpdateDecisionContext {
  readonly signing: SigningPosture;
  readonly check: UpdateCheckOutcome;
}

/** The verdict this module hands back to the thin electron-updater wrapper. */
export type UpdateAction =
  | { readonly kind: "up-to-date" }
  | { readonly kind: "check-failed"; readonly reason: string }
  /** Signed build + valid update: let electron-updater auto-download-verify-install. */
  | { readonly kind: "auto-apply"; readonly version: string }
  /**
   * Unsigned build (or an update whose signature failed verification): never auto-apply.
   * Surface a manual prompt with the version + a human-actionable download URL instead.
   */
  | {
      readonly kind: "prompt-download";
      readonly version: string;
      readonly downloadUrl: string;
      readonly reason: string;
    };

/** Human-readable reason strings, centralized so tests and the UI prompt agree on wording. */
const REASON_UNSIGNED =
  "This build is unsigned, so automatic updates are disabled. Download and install the new version manually.";
const REASON_SIGNATURE_INVALID =
  "The update artifact's signature could not be verified, so it was not applied automatically. Download and install the new version manually.";

/**
 * Decide what the update flow should do next, given only the build's signing posture and the
 * outcome of an update-feed check (d-AC-5). Pure: same input always yields the same verdict.
 */
export function decideUpdateAction(context: UpdateDecisionContext): UpdateAction {
  if (context.check.kind === "check-failed") {
    return { kind: "check-failed", reason: context.check.reason };
  }
  if (context.check.kind === "up-to-date") {
    return { kind: "up-to-date" };
  }

  // context.check.kind === "update-available" from here.
  const { version, downloadUrl } = context.check;

  if (context.signing === "signed") {
    return { kind: "auto-apply", version };
  }

  const reason = context.signing === "signature-invalid" ? REASON_SIGNATURE_INVALID : REASON_UNSIGNED;
  return { kind: "prompt-download", version, downloadUrl, reason };
}
