/**
 * PRD-005d d-AC-6: update-artifact integrity verification, as a pure, unit-tested module.
 *
 * "Integrity-verified before apply (signature where signing exists; checksum otherwise),
 * consistent with the installer's 'inspect before you pipe' posture." This wave ships
 * UNSIGNED (no Apple Developer ID / Windows cert yet), so the SIGNATURE path is out of scope —
 * electron-updater performs code-signature verification itself once a signing identity exists,
 * and that verification result is exactly the {@link SigningPosture} input to
 * `update-decision.ts`'s `decideUpdateAction`. This module owns the CHECKSUM path: given the
 * bytes electron-updater downloaded and the expected digest published alongside the release
 * (electron-builder's `latest.yml`/`latest-mac.yml`/`latest-linux.yml` carry a `sha512` field
 * per artifact), decide whether the artifact is intact.
 *
 * Pure: takes a digest function as a seam (so tests never need to compute a real SHA-512 to
 * exercise the comparison/parsing logic, though the default IS Node's real `node:crypto`), and
 * never touches the filesystem, network, or electron-updater itself.
 */

import { createHash } from "node:crypto";

/** The one hash algorithm this module verifies against — matches electron-builder's `latest*.yml` `sha512` field. */
export const CHECKSUM_ALGORITHM = "sha512" as const;

/** The digest encoding electron-builder's update-feed YAML uses for the `sha512` field. */
export const CHECKSUM_ENCODING = "base64" as const;

/** Injectable seam: compute a digest of `data`, base64-encoded. Defaults to real `node:crypto`. */
export type DigestFn = (data: Uint8Array) => string;

/** The result of a checksum verification. Never throws — every outcome is a typed value. */
export type ChecksumVerificationResult =
  | { readonly kind: "match" }
  | { readonly kind: "mismatch"; readonly expected: string; readonly actual: string }
  /** The expected-digest string itself was malformed (empty, wrong charset) — never silently "pass". */
  | { readonly kind: "invalid-expected-digest"; readonly reason: string };

/** Default digest seam: real SHA-512 via Node's built-in `node:crypto`, base64-encoded. */
export function defaultDigest(data: Uint8Array): string {
  return createHash(CHECKSUM_ALGORITHM).update(data).digest(CHECKSUM_ENCODING);
}

/** A base64 string is valid iff non-empty and contains only base64 alphabet + padding. */
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

function isWellFormedBase64Digest(value: string): boolean {
  if (value.trim() === "") return false;
  // Base64-encoded SHA-512 digests are always 88 characters (64 bytes -> ceil(64/3)*4 with padding).
  if (value.length !== 88) return false;
  return BASE64_PATTERN.test(value);
}

/**
 * Verify that `artifactBytes` matches `expectedDigestBase64` (the `sha512` field electron-builder
 * writes into its update-feed YAML). Constant-time-safe comparison is unnecessary here — this is
 * an integrity check against a publicly-known published digest, not a secret comparison — but the
 * comparison is still exact (no truncation, no case-folding).
 */
export function verifyChecksum(
  artifactBytes: Uint8Array,
  expectedDigestBase64: string,
  digest: DigestFn = defaultDigest,
): ChecksumVerificationResult {
  if (!isWellFormedBase64Digest(expectedDigestBase64)) {
    return {
      kind: "invalid-expected-digest",
      reason: `Expected a base64-encoded SHA-512 digest (88 chars); got ${JSON.stringify(expectedDigestBase64)}.`,
    };
  }

  const actual = digest(artifactBytes);
  if (actual === expectedDigestBase64) {
    return { kind: "match" };
  }
  return { kind: "mismatch", expected: expectedDigestBase64, actual };
}

/**
 * True iff verification succeeded. Convenience for call sites that only need a boolean gate
 * (e.g. "block apply unless this is true") without inspecting the failure detail.
 */
export function isChecksumValid(result: ChecksumVerificationResult): boolean {
  return result.kind === "match";
}
