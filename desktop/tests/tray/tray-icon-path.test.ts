import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { resolveTrayIconPath, trayIconFile } from "../../src/tray/tray-icon-path.js";

describe("trayIconFile", () => {
  it("uses the multi-res .ico on Windows", () => {
    expect(trayIconFile("win32")).toBe("icon.ico");
  });

  it("uses the 32px PNG on macOS and Linux", () => {
    expect(trayIconFile("darwin")).toBe("tray-icon.png");
    expect(trayIconFile("linux")).toBe("tray-icon.png");
  });
});

describe("resolveTrayIconPath", () => {
  // Build expectations with path.join (NOT literal separators) so the assertions hold on any host.
  const trayDir = join("/app", "dist", "tray");

  it("resolves the Windows icon two levels up under assets/", () => {
    expect(resolveTrayIconPath(trayDir, "win32")).toBe(join("/app", "assets", "icon.ico"));
  });

  it("resolves the non-Windows tray PNG under assets/", () => {
    expect(resolveTrayIconPath(trayDir, "darwin")).toBe(join("/app", "assets", "tray-icon.png"));
  });
});
