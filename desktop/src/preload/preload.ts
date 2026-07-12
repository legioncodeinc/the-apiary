/**
 * PRD-005b (b-AC-3): the `apiary` preload bridge exposed to the dashboard renderer.
 *
 * MINIMAL and explicitly enumerated. Every capability is a single, purpose-built function wired to
 * ONE allow-listed IPC channel (see {@link APIARY_IPC_CHANNELS}). The bridge exposes NO raw
 * `ipcRenderer`, NO generic `invoke`, and NO spawn/file/network capability. Its exact key set is
 * pinned by the {@link ApiaryApi} type (compile-time) and asserted against {@link APIARY_API_KEYS}
 * at load time (runtime), so the renderer can never receive an un-enumerated capability.
 *
 * The auth-window channel (b-AC-7) carries only a URL out and a close signal back — never a token.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

import {
  APIARY_API_KEYS,
  APIARY_IPC_CHANNELS,
  type ApiaryApi,
  type OpenAuthWindowResult,
  type RendererFleetStatus,
} from "./api-shape.js";

/** The desktop shell version — inert, informational; NOT a capability. */
const SHELL_VERSION = "0.10.0";

const apiaryApi: ApiaryApi = {
  version: SHELL_VERSION,

  onFleetStatus(listener: (status: RendererFleetStatus) => void): () => void {
    // One-way main→renderer subscription. The renderer receives snapshots; it cannot send via this.
    const handler = (_event: IpcRendererEvent, status: RendererFleetStatus): void => {
      listener(status);
    };
    ipcRenderer.on(APIARY_IPC_CHANNELS.fleetStatus, handler);
    return () => {
      ipcRenderer.removeListener(APIARY_IPC_CHANNELS.fleetStatus, handler);
    };
  },

  async openAuthWindow(url: string): Promise<OpenAuthWindowResult> {
    // Sends ONLY the URL. The main process re-validates (https-only) and owns the window; the
    // renderer never receives a window handle and no token crosses this channel (b-AC-7).
    return (await ipcRenderer.invoke(APIARY_IPC_CHANNELS.openAuthWindow, url)) as OpenAuthWindowResult;
  },

  onAuthWindowClosed(listener: () => void): () => void {
    const handler = (): void => {
      listener();
    };
    ipcRenderer.on(APIARY_IPC_CHANNELS.authWindowClosed, handler);
    return () => {
      ipcRenderer.removeListener(APIARY_IPC_CHANNELS.authWindowClosed, handler);
    };
  },
};

/**
 * Runtime guard (b-AC-3): fail loudly if the concrete bridge ever drifts from the enumerated key
 * set. This catches an accidental extra key before it can reach the renderer.
 */
const actualKeys = Object.keys(apiaryApi).sort();
const expectedKeys = [...APIARY_API_KEYS].sort();
if (actualKeys.length !== expectedKeys.length || actualKeys.some((k, i) => k !== expectedKeys[i])) {
  throw new Error(
    `[preload] apiary bridge surface drift: expected [${expectedKeys.join(", ")}], got [${actualKeys.join(", ")}]`,
  );
}

contextBridge.exposeInMainWorld("apiary", apiaryApi);

declare global {
  interface Window {
    apiary: ApiaryApi;
  }
}
