import { contextBridge } from "electron";

/**
 * The `apiary` API surface exposed to the renderer.
 *
 * Empty by design: this is the seam later waves (005a supervisor status,
 * 005b window/IPC, 005c tray actions) extend with concrete, explicit
 * capabilities. No capability is exposed here yet — nodeIntegration stays
 * off and the renderer gets nothing beyond this typed stub until a real
 * need is specified.
 */
export interface ApiaryApi {
  readonly version: string;
}

const apiaryApi: ApiaryApi = {
  version: "0.1.0",
};

contextBridge.exposeInMainWorld("apiary", apiaryApi);

declare global {
  interface Window {
    apiary: ApiaryApi;
  }
}
