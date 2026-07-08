/**
 * PRD-005d d-AC-5/d-AC-6: the THIN electron-updater wrapper.
 *
 * This wires the PURE cores ({@link decideUpdateAction} from `update-decision.ts`,
 * {@link verifyChecksum} from `checksum-verify.ts`) to the real `electron-updater` /
 * `electron` surfaces. Mirrors `tray/index.ts`'s split: the decision logic is unit-tested with
 * zero Electron runtime; this wrapper imports `electron-updater` directly and is exercised by
 * hand / e2e, not the node vitest env.
 *
 * `main.ts` calls {@link checkForUpdates} once the fleet + window are up. Today (this wave) every
 * build is unsigned, so {@link resolveSigningPosture} always reports `"unsigned"` and every update
 * check resolves to a `"prompt-download"` verdict — never a broken silent auto-apply (d-AC-5).
 * When a signing identity is wired later (d-AC-7), only {@link resolveSigningPosture} needs to
 * change; the decision core and this wrapper's control flow do not.
 */

import { autoUpdater } from "electron-updater";

import { verifyChecksum, type ChecksumVerificationResult } from "./checksum-verify.js";
import {
  classifyUpdateCheck,
  decideUpdateAction,
  type RawUpdateCheck,
  type SigningPosture,
  type UpdateAction,
} from "./update-decision.js";

/** A structured, credential-free log sink. Defaults to `console`, matching the supervisor's logger shape. */
export interface UpdaterLogger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

const consoleLogger: UpdaterLogger = {
  info: (message, fields) => console.log(`[updater] ${message}`, fields ?? ""),
  warn: (message, fields) => console.warn(`[updater] ${message}`, fields ?? ""),
  error: (message, fields) => console.error(`[updater] ${message}`, fields ?? ""),
};

/**
 * Resolve this build's signing posture. This wave ships unsigned on every platform (no Apple
 * Developer ID / Windows cert exists yet — prd-005d's open question), so this always returns
 * `"unsigned"`. When signing is wired (d-AC-7), this function is the ONLY thing that changes —
 * it should read the real signature-verification result electron-updater reports (or an
 * app-level build-time flag baked in by the CI signing step) instead of hardcoding the answer.
 */
export function resolveSigningPosture(): SigningPosture {
  return "unsigned";
}

/** What the caller (main.ts / tray) should show the user, derived from an {@link UpdateAction}. */
export interface UpdatePromptRequest {
  readonly title: string;
  readonly body: string;
  readonly downloadUrl?: string;
}

/** Render an {@link UpdateAction} into copy a native dialog/notification can show. Pure. */
export function toPromptRequest(action: UpdateAction): UpdatePromptRequest | undefined {
  if (action.kind === "prompt-download") {
    return {
      title: `Apiary ${action.version} is available`,
      body: action.reason,
      downloadUrl: action.downloadUrl,
    };
  }
  if (action.kind === "check-failed") {
    return { title: "Update check failed", body: action.reason };
  }
  return undefined; // "up-to-date" and "auto-apply" need no manual prompt.
}

/**
 * Check for updates once and act on the verdict (d-AC-5). Returns the {@link UpdateAction} so the
 * caller (e.g. the tray) can render a prompt via {@link toPromptRequest} when appropriate.
 *
 * On `"auto-apply"`, delegates to electron-updater's normal `checkForUpdatesAndNotify` flow — it
 * performs its own signature verification before install, so no additional wiring is needed here
 * beyond having reached this branch only when {@link resolveSigningPosture} reports `"signed"`.
 * On every other verdict, this function does NOT call any electron-updater apply/quit-and-install
 * method — the unsigned/failed/up-to-date paths never touch the auto-apply machinery.
 */
export async function checkForUpdates(logger: UpdaterLogger = consoleLogger): Promise<UpdateAction> {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  const signing = resolveSigningPosture();

  let checkResult: Awaited<ReturnType<typeof autoUpdater.checkForUpdates>>;
  try {
    checkResult = await autoUpdater.checkForUpdates();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.error("update check failed", { reason });
    return decideUpdateAction({ signing, check: { kind: "check-failed", reason } });
  }

  // Reduce electron-updater's raw result to the evidence the pure decision needs, WITHOUT a
  // hand-rolled version compare:
  //  - `null` means the updater is DISABLED (no publish config / unpackaged dev) — NOT "up-to-date";
  //  - otherwise defer to electron-updater's own `isUpdateAvailable` (which honours its
  //    downgrade/staging/channel rules a bare `version !== currentVersion` compare would bypass).
  // The version→download-URL derivation is only meaningful when an update is actually available.
  const raw: RawUpdateCheck =
    checkResult === null
      ? { kind: "updater-disabled" }
      : {
          kind: "checked",
          isUpdateAvailable: checkResult.isUpdateAvailable,
          version: checkResult.updateInfo.version,
          // electron-updater's GitHub-releases provider derives the browser-facing download page from
          // the repo + tag; point users at the Releases page rather than a raw asset URL that may not
          // exist for their platform (e.g. a user on an unreleased arch).
          downloadUrl: `https://github.com/legioncodeinc/the-apiary/releases/tag/v${checkResult.updateInfo.version}`,
        };

  const check = classifyUpdateCheck(raw);
  if (check.kind === "check-failed") {
    logger.warn("update check unavailable", { reason: check.reason });
    return decideUpdateAction({ signing, check });
  }
  if (check.kind === "up-to-date") {
    logger.info("no update available");
    return decideUpdateAction({ signing, check });
  }

  const version = check.version;
  const action = decideUpdateAction({ signing, check });

  if (action.kind === "auto-apply") {
    logger.info("signed build: delegating to electron-updater auto-apply", { version });
    await autoUpdater.downloadUpdate();
    autoUpdater.quitAndInstall();
  } else {
    logger.info("unsigned/failed build: not auto-applying", { version, kind: action.kind });
  }

  return action;
}

/**
 * Verify a downloaded update artifact's checksum before any apply path touches it (d-AC-6). This
 * is the CHECKSUM leg of "signature where signing exists; checksum otherwise" — call this
 * whenever {@link resolveSigningPosture} is not `"signed"` and an artifact was downloaded for the
 * manual-install prompt flow (e.g. a future "verify before I open this" affordance). Delegates
 * entirely to the pure {@link verifyChecksum}; this wrapper only exists so callers that already
 * have `electron-updater`'s reported `sha512` field on hand have one obvious entry point.
 */
export function verifyDownloadedArtifact(
  artifactBytes: Uint8Array,
  expectedSha512Base64: string,
): ChecksumVerificationResult {
  return verifyChecksum(artifactBytes, expectedSha512Base64);
}
