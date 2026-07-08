/**
 * PRD-005a a-AC-2: the default `/health` probe seam.
 *
 * Probes a loopback `/health` URL over node:http with a bounded timeout and NEVER throws — every
 * transport error becomes a {@link HealthResult} classification, so the supervisor's startup loop
 * can always make a decision and continue (it never hangs). This mirrors doctor's `health-probe.ts`
 * refused-vs-timeout distinction, trimmed to what the shell needs (ok / refused / timeout / error).
 *
 * SECURITY: the caller only ever passes loopback URLs (the roots bind 127.0.0.1). Built-ins only.
 */

import { request } from "node:http";

import type { HealthResult } from "./types.js";

/** The raw status + bounded body of a `/health` response, before classification. */
interface RawResponse {
  readonly statusCode: number;
  readonly body: string;
}

/** Issue one bounded GET; resolve to the raw response, or reject with a tagged error for classification. */
function rawGet(healthUrl: string, timeoutMs: number): Promise<RawResponse> {
  return new Promise<RawResponse>((resolve, reject) => {
    let settled = false;
    const finishErr = (err: Error): void => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    const finishOk = (res: RawResponse): void => {
      if (settled) return;
      settled = true;
      resolve(res);
    };

    const req = request(healthUrl, { method: "GET" }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => {
        // Cap the buffered body so a misbehaving endpoint cannot exhaust memory.
        if (chunks.length < 256) chunks.push(chunk);
      });
      res.on("end", () => finishOk({ statusCode: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", (err) => finishErr(err instanceof Error ? err : new Error("response_error")));
    });

    req.setTimeout(timeoutMs, () => {
      // Tag the abort so the classifier maps it to `unreachable-timeout`, not refused.
      req.destroy(Object.assign(new Error("probe_timeout"), { code: "APIARY_PROBE_TIMEOUT" }));
    });
    req.on("error", (err) => finishErr(err instanceof Error ? err : new Error("request_error")));
    req.end();
  });
}

/** True iff the parsed body's top-level `status` reads `ok`. A body without it still counts as reachable. */
function isStatusOk(body: string): boolean {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (parsed === null || typeof parsed !== "object") return false;
    return (parsed as Record<string, unknown>).status === "ok";
  } catch {
    return false;
  }
}

/**
 * Probe `/health` once and classify. NEVER throws (a-AC-2). A 200 with `status:"ok"` — or any 200
 * (a reachable daemon that does not emit the structured body still counts as up) — is `ok`;
 * a refused/reset connection is `unreachable-refused`; a timed-out socket is `unreachable-timeout`;
 * any answered-but-not-2xx response is `error` with the status code.
 */
export async function probeHealth(healthUrl: string, timeoutMs: number): Promise<HealthResult> {
  try {
    const res = await rawGet(healthUrl, timeoutMs);
    // A 200 counts as up: either it carries the structured `status:"ok"` body, or it is a plain
    // 200 from a daemon that does not emit that shape (still reachable). A 200 that DOES carry a
    // structured body whose status is NOT "ok" is a degraded daemon → classified `error`.
    if (res.statusCode === 200) {
      const carriesStatus = res.body.includes("\"status\"");
      if (!carriesStatus || isStatusOk(res.body)) return { kind: "ok" };
      return { kind: "error", detail: "health status not ok" };
    }
    return { kind: "error", detail: `HTTP ${res.statusCode}` };
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === "APIARY_PROBE_TIMEOUT") return { kind: "unreachable-timeout" };
    const detail = error instanceof Error ? (typeof code === "string" ? code : error.message) : "unknown";
    return { kind: "unreachable-refused", detail };
  }
}
