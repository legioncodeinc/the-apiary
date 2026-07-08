/**
 * PRD-005a a-AC-6: detect a loopback port already in use BEFORE spawning a root, and distinguish
 * the two cases the ADR requires the shell to tell apart:
 *
 *   - OURS, healthy   → a daemon of ours is already up on the port and answers our `/health`.
 *                       ADOPT it (health-check, do not re-spawn) — this is also the a-AC-5 path
 *                       where a second launch must not re-bind.
 *   - FOREIGN         → something binds the port but does NOT answer our `/health`. Surface an
 *                       actionable message; never crash, never silently double-bind.
 *   - FREE            → nothing is listening; safe to spawn.
 *
 * Strategy: try to BIND the loopback port with a throwaway server.
 *   - bind succeeds  → free (close immediately).
 *   - EADDRINUSE     → occupied; probe `/health`. Ours-healthy ⇒ adopt; else ⇒ foreign.
 *   - other error    → treat as foreign/occupied (surface), never assume free.
 *
 * Built-ins only: node:net + the injected health probe. Never throws — resolves to a classification.
 */

import { createServer } from "node:net";

import type { HealthProbeFn, PortHolder } from "./types.js";

/** The bind-probe result before the health disambiguation. */
type BindResult = { readonly kind: "free" } | { readonly kind: "occupied"; readonly detail: string };

/** Attempt to bind `port` on 127.0.0.1 with a throwaway server; resolve free vs occupied. Never throws. */
function tryBind(port: number): Promise<BindResult> {
  return new Promise<BindResult>((resolve) => {
    let settled = false;
    const finish = (result: BindResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const server = createServer();
    server.once("error", (error: NodeJS.ErrnoException) => {
      const code = error.code ?? "UNKNOWN";
      // EADDRINUSE (and, on some platforms, EACCES for a held privileged port) ⇒ occupied.
      finish({ kind: "occupied", detail: code });
    });
    server.once("listening", () => {
      // The port is free. Close the throwaway server before resolving so we do not hold it ourselves.
      server.close(() => finish({ kind: "free" }));
    });

    try {
      server.listen(port, "127.0.0.1");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "UNKNOWN";
      finish({ kind: "occupied", detail: code });
    }
  });
}

/** Build the default {@link PortCheckFn} over node:net + the injected health probe (a-AC-6). */
export function createPortCheck(probeHealth: HealthProbeFn): (port: number, healthUrl: string, timeoutMs: number) => Promise<PortHolder> {
  return async (port, healthUrl, timeoutMs) => {
    const bind = await tryBind(port);
    if (bind.kind === "free") return { kind: "free" };

    // Occupied: probe /health to decide whether it is OUR healthy root (adopt) or a foreign process.
    const health = await probeHealth(healthUrl, timeoutMs);
    if (health.kind === "ok") return { kind: "ours-healthy" };

    // Something holds the port but does not answer our /health: a foreign process. Surface it.
    const reason = health.kind === "unreachable-timeout" ? "no /health response (timeout)" : `no healthy /health (${health.kind})`;
    return { kind: "foreign", detail: `port ${port} in use by a foreign process: ${reason}` };
  };
}
