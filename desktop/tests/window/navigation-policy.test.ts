/**
 * PRD-005b (b-AC-5): the navigation allow-list decision. Loopback-only in the main window; genuine
 * external links go external; the retry sentinel is its own decision; everything else is blocked.
 */

import { describe, expect, it } from "vitest";

import {
  DASHBOARD_ORIGIN,
  RETRY_SENTINEL_URL,
  decideNavigation,
  isDashboardUrl,
} from "../../src/window/navigation-policy.js";

describe("decideNavigation (b-AC-5)", () => {
  it("allows the exact dashboard origin in-window", () => {
    expect(decideNavigation("http://127.0.0.1:3853").kind).toBe("allow-in-window");
    expect(decideNavigation("http://127.0.0.1:3853/").kind).toBe("allow-in-window");
    expect(decideNavigation("http://127.0.0.1:3853/settings?tab=fleet").kind).toBe("allow-in-window");
  });

  it("does NOT widen the loopback host or port", () => {
    // A different port, a different loopback host spelling, or a LAN IP must not be in-window.
    expect(decideNavigation("http://127.0.0.1:9999/").kind).not.toBe("allow-in-window");
    expect(decideNavigation("http://localhost:3853/").kind).not.toBe("allow-in-window");
    expect(decideNavigation("http://127.0.0.1:3853").kind).toBe("allow-in-window"); // sanity anchor
    expect(decideNavigation("http://192.168.0.10:3853/").kind).not.toBe("allow-in-window");
  });

  it("does NOT allow a different scheme on the dashboard host/port in-window", () => {
    expect(decideNavigation("https://127.0.0.1:3853/").kind).not.toBe("allow-in-window");
  });

  it("routes a genuine external https link to external (OS browser)", () => {
    expect(decideNavigation("https://discord.gg/apiary").kind).toBe("external");
    expect(decideNavigation("https://docs.apiary.dev/guide").kind).toBe("external");
  });

  it("routes an external http link to external as well", () => {
    expect(decideNavigation("http://example.com/").kind).toBe("external");
  });

  it("maps the retry sentinel to a retry decision, never external or in-window", () => {
    expect(decideNavigation(RETRY_SENTINEL_URL).kind).toBe("retry");
  });

  it("blocks file:, data:, and javascript: schemes", () => {
    expect(decideNavigation("file:///etc/passwd").kind).toBe("blocked");
    expect(decideNavigation("data:text/html,<h1>x</h1>").kind).toBe("blocked");
    expect(decideNavigation("javascript:alert(1)").kind).toBe("blocked");
  });

  it("blocks an unparseable URL with a reason, never throwing", () => {
    const decision = decideNavigation("http://[::::");
    expect(decision.kind).toBe("blocked");
    if (decision.kind === "blocked") expect(decision.reason).toBeTruthy();
  });
});

describe("isDashboardUrl (b-AC-5)", () => {
  it("matches only the exact dashboard origin", () => {
    expect(isDashboardUrl(`${DASHBOARD_ORIGIN}/x`)).toBe(true);
    expect(isDashboardUrl("http://localhost:3853/")).toBe(false);
    expect(isDashboardUrl("http://127.0.0.1:3852/")).toBe(false);
    expect(isDashboardUrl("not a url")).toBe(false);
  });
});
