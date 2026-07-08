/**
 * d-AC-5: the update-flow decision core never auto-applies on an unsigned/invalid-signature
 * build, always offers a manual download prompt in those cases, and never treats a failed check
 * as "up-to-date".
 */

import { describe, expect, it } from "vitest";

import { classifyUpdateCheck, decideUpdateAction } from "../../src/packaging/update-decision.js";

describe("decideUpdateAction", () => {
  it("reports up-to-date when the feed check finds no newer version", () => {
    const action = decideUpdateAction({ signing: "unsigned", check: { kind: "up-to-date" } });
    expect(action).toEqual({ kind: "up-to-date" });
  });

  it("reports up-to-date regardless of signing posture", () => {
    const action = decideUpdateAction({ signing: "signed", check: { kind: "up-to-date" } });
    expect(action).toEqual({ kind: "up-to-date" });
  });

  it("surfaces a failed feed check as check-failed, never as up-to-date", () => {
    const action = decideUpdateAction({
      signing: "signed",
      check: { kind: "check-failed", reason: "feed returned 500" },
    });
    expect(action).toEqual({ kind: "check-failed", reason: "feed returned 500" });
  });

  it("auto-applies when the build is signed and an update is available", () => {
    const action = decideUpdateAction({
      signing: "signed",
      check: { kind: "update-available", version: "1.2.3", downloadUrl: "https://example.test/v1.2.3" },
    });
    expect(action).toEqual({ kind: "auto-apply", version: "1.2.3" });
  });

  it("NEVER auto-applies on an unsigned build — falls back to a manual download prompt", () => {
    const action = decideUpdateAction({
      signing: "unsigned",
      check: { kind: "update-available", version: "1.2.3", downloadUrl: "https://example.test/v1.2.3" },
    });
    expect(action.kind).toBe("prompt-download");
    if (action.kind === "prompt-download") {
      expect(action.version).toBe("1.2.3");
      expect(action.downloadUrl).toBe("https://example.test/v1.2.3");
      expect(action.reason).toMatch(/unsigned/i);
    }
  });

  it("NEVER auto-applies when the update artifact's signature failed verification", () => {
    const action = decideUpdateAction({
      signing: "signature-invalid",
      check: { kind: "update-available", version: "2.0.0", downloadUrl: "https://example.test/v2.0.0" },
    });
    expect(action.kind).toBe("prompt-download");
    if (action.kind === "prompt-download") {
      expect(action.reason).toMatch(/signature/i);
    }
  });

  it("is pure: identical input yields identical output", () => {
    const context = {
      signing: "unsigned" as const,
      check: { kind: "update-available" as const, version: "3.0.0", downloadUrl: "https://example.test/v3.0.0" },
    };
    expect(decideUpdateAction(context)).toEqual(decideUpdateAction(context));
  });
});

describe("classifyUpdateCheck (d-AC-5, updater availability branch)", () => {
  // These three cases are the exact distinction CodeRabbit flagged: DISABLED (null) must not be
  // conflated with UP-TO-DATE, and availability must come from electron-updater's own verdict.
  it("maps a DISABLED updater (electron-updater returned null) to check-failed, NOT up-to-date", () => {
    const outcome = classifyUpdateCheck({ kind: "updater-disabled" });
    expect(outcome.kind).toBe("check-failed");
    if (outcome.kind === "check-failed") expect(outcome.reason).toMatch(/disabled/i);
  });

  it("maps isUpdateAvailable=false to up-to-date (uses electron-updater's own verdict)", () => {
    const outcome = classifyUpdateCheck({
      kind: "checked",
      isUpdateAvailable: false,
      version: "1.0.0",
      downloadUrl: "https://example.test/v1.0.0",
    });
    expect(outcome).toEqual({ kind: "up-to-date" });
  });

  it("maps isUpdateAvailable=true to update-available with version + downloadUrl", () => {
    const outcome = classifyUpdateCheck({
      kind: "checked",
      isUpdateAvailable: true,
      version: "2.5.0",
      downloadUrl: "https://example.test/v2.5.0",
    });
    expect(outcome).toEqual({
      kind: "update-available",
      version: "2.5.0",
      downloadUrl: "https://example.test/v2.5.0",
    });
  });

  it("end-to-end: a DISABLED updater on an unsigned build yields check-failed, never a silent apply", () => {
    // The whole point of the fix: a disabled updater must not read as up-to-date NOR auto-apply.
    const action = decideUpdateAction({ signing: "unsigned", check: classifyUpdateCheck({ kind: "updater-disabled" }) });
    expect(action.kind).toBe("check-failed");
  });
});
