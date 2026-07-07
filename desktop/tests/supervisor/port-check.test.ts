/**
 * a-AC-6: the port check distinguishes free / ours-healthy (adopt) / foreign (surface). The
 * bind-probe uses real node:net against ephemeral ports; the health disambiguation is injected.
 */

import { createServer, type Server } from "node:net";
import { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { createPortCheck } from "../../src/supervisor/port-check.js";
import type { HealthResult } from "../../src/supervisor/types.js";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise<void>((resolve) => {
          s.close(() => resolve());
        }),
    ),
  );
});

/** Bind a throwaway loopback server and return its port, so the check sees an occupied port. */
function occupyEphemeralPort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer();
    servers.push(server);
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

/** Find a definitely-free loopback port by binding then closing. */
function freeEphemeralPort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      server.close(() => resolve(port));
    });
  });
}

describe("createPortCheck (a-AC-6)", () => {
  it("reports free when nothing is listening", async () => {
    const port = await freeEphemeralPort();
    const check = createPortCheck(async () => ({ kind: "ok" }) as HealthResult);
    const holder = await check(port, `http://127.0.0.1:${port}/health`, 200);
    expect(holder.kind).toBe("free");
  });

  it("adopts an already-healthy root of ours (ours-healthy), not a re-spawn", async () => {
    const port = await occupyEphemeralPort();
    // The occupant answers OUR /health ok → it is ours; adopt it.
    const check = createPortCheck(async () => ({ kind: "ok" }) as HealthResult);
    const holder = await check(port, `http://127.0.0.1:${port}/health`, 200);
    expect(holder.kind).toBe("ours-healthy");
  });

  it("surfaces a FOREIGN process when the port is held but /health is not ours", async () => {
    const port = await occupyEphemeralPort();
    // The occupant does NOT answer our /health → foreign. Surface, never double-bind.
    const check = createPortCheck(async () => ({ kind: "unreachable-refused", detail: "ECONNRESET" }) as HealthResult);
    const holder = await check(port, `http://127.0.0.1:${port}/health`, 200);
    expect(holder.kind).toBe("foreign");
    if (holder.kind === "foreign") {
      expect(holder.detail).toContain(`port ${port}`);
      expect(holder.detail).toContain("foreign");
    }
  });
});
