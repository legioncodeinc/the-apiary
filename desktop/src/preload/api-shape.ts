/**
 * PRD-005b (b-AC-3): the PURE, enumerated shape of the `apiary` preload bridge.
 *
 * No `electron` import. This module is the single source of truth for WHICH keys the preload bridge
 * exposes to the renderer. `preload.ts` builds the concrete bridge (wiring each key to a specific,
 * allow-listed IPC channel) and asserts — at build time via the `ApiaryApi` type and at runtime via
 * {@link APIARY_API_KEYS} — that it exposes exactly this surface and nothing more. Tests import
 * {@link APIARY_API_KEYS} and {@link APIARY_IPC_CHANNELS} to prove the surface is minimal.
 *
 * The bridge NEVER exposes raw `ipcRenderer`, a generic `invoke`, or any spawn/file/network
 * capability (b-AC-3). Each key below is a single, purpose-built function.
 */

/** The IPC event names bridged renderer↔main. Enumerated + frozen so nothing is added implicitly. */
export const APIARY_IPC_CHANNELS = Object.freeze({
  /** main→renderer: a fleet-status snapshot push (renderer subscribes via `onFleetStatus`). */
  fleetStatus: "apiary:fleet-status",
  /** renderer→main: open an app-owned auth window at a validated `https` URI (PRD-004 seam, b-AC-7). */
  openAuthWindow: "apiary:open-auth-window",
  /** main→renderer: the owned auth window closed (PRD-004 lifecycle signal, b-AC-7). Carries no token. */
  authWindowClosed: "apiary:auth-window-closed",
} as const);

/**
 * The exact set of keys the `apiary` bridge exposes on `window`. Frozen. Any drift between this list
 * and the concrete `apiaryApi` object is a compile error (the object is typed `ApiaryApi`) AND is
 * asserted at preload load time, so the renderer can never receive an un-enumerated capability.
 */
export const APIARY_API_KEYS = Object.freeze([
  "version",
  "onFleetStatus",
  "openAuthWindow",
  "onAuthWindowClosed",
] as const);

/** A single fleet root's status as seen by the renderer. Mirrors the supervisor's `RootStatus`, minus internals. */
export interface RendererRootStatus {
  readonly name: string;
  readonly phase: string;
  readonly port: number;
  readonly restarts: number;
  readonly detail?: string;
}

/** The fleet-status snapshot pushed to the renderer over {@link APIARY_IPC_CHANNELS.fleetStatus}. */
export interface RendererFleetStatus {
  readonly roots: readonly RendererRootStatus[];
  readonly allHealthy: boolean;
  readonly hasTerminalFailure: boolean;
}

/** The outcome the renderer gets back from {@link ApiaryApi.openAuthWindow}. Never includes a token. */
export interface OpenAuthWindowResult {
  /** True if the main process accepted the URL (valid `https`) and opened an owned window. */
  readonly ok: boolean;
  /** A short, credential-free reason when `ok` is false (e.g. the URL was not `https`). */
  readonly reason?: string;
}

/**
 * The typed `apiary` bridge exposed via `contextBridge` (b-AC-3). MINIMAL and explicit: four keys,
 * each a purpose-built function or value. No raw `ipcRenderer`, no arbitrary `invoke`.
 */
export interface ApiaryApi {
  /** The desktop shell version string (inert, informational). */
  readonly version: string;
  /**
   * Subscribe to fleet-status pushes from the main process (b-AC-3). Returns an unsubscribe fn so
   * the renderer can tear the listener down. This is a ONE-WAY main→renderer subscription; the
   * renderer cannot use it to send anything.
   */
  onFleetStatus(listener: (status: RendererFleetStatus) => void): () => void;
  /**
   * Ask the main process to open an app-owned child window at an `https` verification URI
   * (PRD-004 seam, b-AC-7). The main process re-validates the URL (https-only) before opening; the
   * renderer never gets a window handle and no token crosses this channel.
   */
  openAuthWindow(url: string): Promise<OpenAuthWindowResult>;
  /**
   * Subscribe to the "owned auth window closed" lifecycle signal (b-AC-7). Returns an unsubscribe
   * fn. Carries no token — only the fact that the window closed.
   */
  onAuthWindowClosed(listener: () => void): () => void;
}
