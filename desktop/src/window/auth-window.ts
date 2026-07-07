/**
 * PRD-004 seam (b-AC-7): the app-owned auth child window opener + its renderer→main IPC channel.
 *
 * This is the thin electron wrapper over the pure {@link validateAuthUrl} core. It is the SUBSTRATE
 * PRD-004's device-flow auth will consume — it does NOT implement the auth flow. It provides:
 *   1. a renderer→main channel (`apiary:open-auth-window`) that validates a candidate verification
 *      URI (https-only) and, on success, opens an app-OWNED child `BrowserWindow` pointed at it;
 *   2. a main→renderer close signal (`apiary:auth-window-closed`) fired when that window closes.
 *
 * The channel carries ONLY the URL and lifecycle signals — NEVER a token (b-AC-7). The owned window
 * is isolated exactly like the main window (contextIsolation on, nodeIntegration off, sandbox on):
 * it is an app-owned browser surface for an external verification page, not a renderer-controlled
 * one. Because it points at a validated remote `https` origin, it gets NO preload — the renderer
 * side of it is the remote page, which must have no bridge into this app.
 */

import { BrowserWindow, ipcMain, type WebContents } from "electron";

import { APIARY_IPC_CHANNELS, type OpenAuthWindowResult } from "../preload/api-shape.js";
import { validateAuthUrl } from "./auth-url.js";

/** A minimal logger so this module never hard-depends on `console` and stays testable-by-shape. */
export interface AuthWindowLogger {
  info(message: string): void;
  warn(message: string): void;
}

const defaultLogger: AuthWindowLogger = {
  info: (m) => console.info(`[auth-window] ${m}`),
  warn: (m) => console.warn(`[auth-window] ${m}`),
};

/**
 * Open an app-owned child auth window at an already-validated `https` URL. Isolated and preload-less
 * (the remote verification page must not reach into this app). Fires `onClosed` when it closes.
 */
function openOwnedAuthWindow(parent: BrowserWindow | undefined, validatedUrl: string, onClosed: () => void): BrowserWindow {
  const child = new BrowserWindow({
    parent,
    width: 480,
    height: 720,
    show: true,
    title: "Sign in",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // No preload: this window renders a remote https verification page. It must have NO bridge.
    },
  });
  child.on("closed", onClosed);
  void child.loadURL(validatedUrl);
  return child;
}

/**
 * Register the PRD-004 auth-window IPC seam on the main process (b-AC-7). Returns a disposer that
 * removes the handler and closes any open owned window. `getMainWindow` supplies the parent + the
 * renderer to notify on close, resolved lazily so registration can happen before the window exists.
 */
export function registerAuthWindowIpc(
  getMainWindow: () => BrowserWindow | undefined,
  logger: AuthWindowLogger = defaultLogger,
): () => void {
  let owned: BrowserWindow | undefined;

  const notifyClosed = (target: WebContents | undefined): void => {
    if (target !== undefined && !target.isDestroyed()) {
      target.send(APIARY_IPC_CHANNELS.authWindowClosed);
    }
  };

  ipcMain.handle(APIARY_IPC_CHANNELS.openAuthWindow, async (_event, rawUrl: unknown): Promise<OpenAuthWindowResult> => {
    // Re-validate at the main boundary — NEVER trust the renderer's claim that the URL is https.
    const validation = validateAuthUrl(rawUrl);
    if (!validation.ok) {
      logger.warn(`rejected auth window open: ${validation.reason}`);
      return { ok: false, reason: validation.reason };
    }

    // One owned auth window at a time: if one is already open, focus it rather than stacking.
    if (owned !== undefined && !owned.isDestroyed()) {
      owned.focus();
      return { ok: true };
    }

    const parent = getMainWindow();
    const renderer = parent?.webContents;
    logger.info("opening owned auth window (https, token-free channel)");
    owned = openOwnedAuthWindow(parent, validation.url, () => {
      owned = undefined;
      notifyClosed(renderer);
    });
    return { ok: true };
  });

  return () => {
    ipcMain.removeHandler(APIARY_IPC_CHANNELS.openAuthWindow);
    if (owned !== undefined && !owned.isDestroyed()) owned.close();
    owned = undefined;
  };
}
