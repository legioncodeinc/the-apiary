/**
 * PRD-004 seam (b-AC-7): the auth-URL validation. HTTPS-only; reject http/file/other; reject
 * non-string / empty input at the zod boundary; never throw.
 */

import { describe, expect, it } from "vitest";

import { isAllowedAuthChildNavigation, validateAuthUrl } from "../../src/window/auth-url.js";

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

describe("isAllowedAuthChildNavigation (b-AC-7, will-navigate + will-redirect)", () => {
  // This is the ONE decision both the will-navigate AND will-redirect handlers call. The
  // will-redirect coverage is the point: a server-side 302 does NOT fire will-navigate, so this
  // function is the only thing standing between a validated https page and an http/file/other-scheme
  // hop mid-flight.
  it("ALLOWS an https navigation (a legitimate cross-origin device-flow hop stays in-window)", () => {
    expect(isAllowedAuthChildNavigation("https://auth.example.com/step2")).toBe(true);
    expect(isAllowedAuthChildNavigation("https://other-idp.example.org/verify?code=X")).toBe(true);
  });

  it("BLOCKS an http downgrade — the exact 302 https→http case will-navigate would miss", () => {
    expect(isAllowedAuthChildNavigation("http://auth.example.com/step2")).toBe(false);
  });

  it("BLOCKS a redirect to file:, data:, javascript:, or another scheme", () => {
    expect(isAllowedAuthChildNavigation("file:///etc/passwd")).toBe(false);
    expect(isAllowedAuthChildNavigation("data:text/html,<h1>x</h1>")).toBe(false);
    expect(isAllowedAuthChildNavigation("javascript:alert(1)")).toBe(false);
    expect(isAllowedAuthChildNavigation("ftp://host/file")).toBe(false);
  });

  it("BLOCKS an unparseable redirect target without throwing", () => {
    expect(isAllowedAuthChildNavigation("https://[:::not a url")).toBe(false);
    expect(isAllowedAuthChildNavigation("")).toBe(false);
  });
});
