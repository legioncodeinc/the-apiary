/**
 * PRD-005b (b-AC-4): the native chrome views. The failed view carries the actionable message
 * (HTML-escaped) and a Retry affordance pointed at the sentinel; the sentinel is kept in lockstep
 * with the navigation policy's copy.
 */

import { describe, expect, it } from "vitest";

import { RETRY_SENTINEL_URL as NAV_SENTINEL } from "../../src/window/navigation-policy.js";
import {
  RETRY_SENTINEL_URL,
  escapeHtml,
  renderFailedHtml,
  renderLoadingHtml,
  toHtmlDataUrl,
} from "../../src/window/chrome-views.js";

describe("chrome views (b-AC-4)", () => {
  it("the loading view is a full HTML document (never blank)", () => {
    const html = renderLoadingHtml();
    expect(html).toContain("<!doctype html>");
    expect(html.toLowerCase()).toContain("starting apiary");
  });

  it("the failed view shows the actionable message and a Retry affordance", () => {
    const html = renderFailedHtml("Hive did not start in time.");
    expect(html).toContain("Hive did not start in time.");
    expect(html).toContain(">Retry<");
    expect(html).toContain(RETRY_SENTINEL_URL);
  });

  it("HTML-escapes the message so it cannot inject markup", () => {
    const html = renderFailedHtml('<img src=x onerror="alert(1)">');
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });

  it("escapeHtml escapes the five significant characters", () => {
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });

  it("the retry sentinel is identical to the navigation policy's copy (lockstep)", () => {
    expect(RETRY_SENTINEL_URL).toBe(NAV_SENTINEL);
  });

  it("toHtmlDataUrl produces a data: URL with the encoded document", () => {
    const url = toHtmlDataUrl("<h1>hi</h1>");
    expect(url.startsWith("data:text/html;charset=utf-8,")).toBe(true);
    expect(decodeURIComponent(url.split(",")[1] ?? "")).toBe("<h1>hi</h1>");
  });
});
