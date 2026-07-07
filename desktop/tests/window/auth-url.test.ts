/**
 * PRD-004 seam (b-AC-7): the auth-URL validation. HTTPS-only; reject http/file/other; reject
 * non-string / empty input at the zod boundary; never throw.
 */

import { describe, expect, it } from "vitest";

import { validateAuthUrl } from "../../src/window/auth-url.js";

describe("validateAuthUrl (b-AC-7)", () => {
  it("accepts a well-formed https URL and returns the normalized href", () => {
    const result = validateAuthUrl("https://auth.example.com/device?code=ABCD");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url).toBe("https://auth.example.com/device?code=ABCD");
  });

  it("rejects http (plaintext) URLs", () => {
    const result = validateAuthUrl("http://auth.example.com/device");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("https");
  });

  it("rejects file: URLs", () => {
    expect(validateAuthUrl("file:///etc/passwd").ok).toBe(false);
  });

  it("rejects data:, javascript:, and other schemes", () => {
    expect(validateAuthUrl("data:text/html,<h1>x</h1>").ok).toBe(false);
    expect(validateAuthUrl("javascript:alert(1)").ok).toBe(false);
    expect(validateAuthUrl("ftp://host/file").ok).toBe(false);
  });

  it("rejects a non-string input at the boundary without throwing", () => {
    expect(validateAuthUrl(undefined).ok).toBe(false);
    expect(validateAuthUrl(null).ok).toBe(false);
    expect(validateAuthUrl(42).ok).toBe(false);
    expect(validateAuthUrl({ url: "https://x" }).ok).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(validateAuthUrl("").ok).toBe(false);
  });

  it("rejects an unparseable URL string", () => {
    const result = validateAuthUrl("https://[:::not a url");
    expect(result.ok).toBe(false);
  });
});
