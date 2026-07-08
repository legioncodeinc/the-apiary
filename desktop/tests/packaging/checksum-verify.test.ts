/**
 * d-AC-6: update-artifact checksum verification never silently passes a malformed expected
 * digest, correctly distinguishes match/mismatch, and defaults to a real SHA-512 digest fn.
 */

import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  CHECKSUM_ALGORITHM,
  CHECKSUM_ENCODING,
  defaultDigest,
  isChecksumValid,
  verifyChecksum,
} from "../../src/packaging/checksum-verify.js";

describe("defaultDigest", () => {
  it("computes a real SHA-512 base64 digest", () => {
    const bytes = new TextEncoder().encode("hello apiary");
    const expected = createHash(CHECKSUM_ALGORITHM).update(bytes).digest(CHECKSUM_ENCODING);
    expect(defaultDigest(bytes)).toBe(expected);
  });
});

describe("verifyChecksum", () => {
  const bytes = new TextEncoder().encode("the-apiary-installer-bytes");
  const correctDigest = createHash("sha512").update(bytes).digest("base64");

  it("matches when the expected digest is correct", () => {
    const result = verifyChecksum(bytes, correctDigest);
    expect(result).toEqual({ kind: "match" });
    expect(isChecksumValid(result)).toBe(true);
  });

  it("reports mismatch when the digest is well-formed but wrong", () => {
    const wrongButWellFormed = createHash("sha512").update(new TextEncoder().encode("different bytes")).digest("base64");
    const result = verifyChecksum(bytes, wrongButWellFormed);
    expect(result.kind).toBe("mismatch");
    expect(isChecksumValid(result)).toBe(false);
    if (result.kind === "mismatch") {
      expect(result.expected).toBe(wrongButWellFormed);
      expect(result.actual).toBe(correctDigest);
    }
  });

  it("rejects an empty expected digest rather than silently passing", () => {
    const result = verifyChecksum(bytes, "");
    expect(result.kind).toBe("invalid-expected-digest");
    expect(isChecksumValid(result)).toBe(false);
  });

  it("rejects a non-base64 expected digest", () => {
    const result = verifyChecksum(bytes, "not-valid-base64-!!!-@@@");
    expect(result.kind).toBe("invalid-expected-digest");
  });

  it("rejects a well-formed-but-wrong-length base64 string", () => {
    const result = verifyChecksum(bytes, Buffer.from("too short").toString("base64"));
    expect(result.kind).toBe("invalid-expected-digest");
  });

  it("uses an injected digest fn instead of the real one when provided", () => {
    const fakeDigest = (): string => "A".repeat(87) + "=";
    const result = verifyChecksum(bytes, "A".repeat(87) + "=", fakeDigest);
    expect(result).toEqual({ kind: "match" });
  });

  it("is pure: identical input yields identical output", () => {
    expect(verifyChecksum(bytes, correctDigest)).toEqual(verifyChecksum(bytes, correctDigest));
  });
});
