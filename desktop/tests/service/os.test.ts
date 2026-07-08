/**
 * c-AC-4: the pure OS classifier that routes to the right service-manager family. Injected platform
 * string so every per-OS argv path is testable on one CI host.
 */

import { describe, expect, it } from "vitest";

import { classifyOs } from "../../src/service/os.js";

describe("classifyOs", () => {
  it("maps the three supported platforms", () => {
    expect(classifyOs("win32")).toBe("windows");
    expect(classifyOs("darwin")).toBe("macos");
    expect(classifyOs("linux")).toBe("linux");
  });
  it("maps anything else to unsupported (takeover then no-ops)", () => {
    expect(classifyOs("aix")).toBe("unsupported");
    expect(classifyOs("freebsd")).toBe("unsupported");
  });
});
