/**
 * PRD-005b: the main dashboard window (the thin electron wrapper).
 *
 * This wires the PURE cores (readiness gate, navigation policy, chrome views, auth-url validation)
 * to real electron surfaces. The pure logic is unit-tested; this wrapper is integration-only (it
 * imports `electron`, so it does not run in the node vitest env — like `main.ts`).
 *
 * The window consumes ONLY the stable {@link FleetSupervisor} surface (005a): it reads
 * {@link FleetSupervisor.getFleetStatus} for the initial snapshot and subscribes via
 * {@link FleetSupervisor.onHiveReady} to know when to point the BrowserWindow at Hive's dashboard
 * (loopback :3853). It never edits the supervisor.
 *
 * Flow (b-AC-1 / b-AC-4):
 *   1. Create the isolated BrowserWindow (b-AC-2) and show the native LOADING view (never blank).
 *   2. Subscribe to `onHiveReady`; arm a startup-budget timer.
 *   3. Hive ready in time  → gate `ready`  → `loadURL(DASHBOARD_ORIGIN)`.
 *      Budget expires first → gate `failed` → show the actionable failure view with Retry.
 *   4. Retry (a sentinel navigation intercepted by `will-navigate`) re-arms the timer + readiness.
 * Navigation is locked to the loopback origin; genuine external links go to the OS browser (b-AC-5).
 */

import { fileURLToPath } from "node:url";
import path from "node:path";

import { BrowserWindow, shell } from "electron";

import type { FleetStatus, FleetSupervisor } from "../supervisor/index.js";
import { APIARY_IPC_CHANNELS, type RendererFleetStatus } from "../preload/api-shape.js";
import { registerAuthWindowIpc } from "./auth-window.js";
import { renderFailedHtml, renderLoadingHtml, toHtmlDataUrl } from "./chrome-views.js";
import { DASHBOARD_ORIGIN, decideNavigation } from "./navigation-policy.js";
import { createReadinessGate } from "./readiness-gate.js";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
/** Built dashboard preload path (dist/preload/preload.js), resolved relative to this compiled module. */
const DASHBOARD_PRELOAD = path.join(thisDir, "..", "preload", "preload.js");

/** How long to wait for Hive to become healthy before showing the failure view (b-AC-4). */
const STARTUP_BUDGET_MS = 30_000;

/** Project the supervisor's FleetStatus into the renderer-facing shape (no internals leak). */
function toRendererStatus(status: FleetStatus): RendererFleetStatus {
  return {
    roots: status.roots.map((r) => ({
      name: r.name,
      phase: r.phase,
      port: r.port,
      restarts: r.restarts,
      detail: r.detail,
    })),
    allHealthy: status.allHealthy,
    hasTerminalFailure: status.hasTerminalFailure,
  };
}

/**
 * Create the main dashboard window (b-AC-1..b-AC-5, b-AC-7 seam). Returns the BrowserWindow; all
 * lifecycle wiring (readiness gate, navigation lock, IPC seam) is attached before return.
 */
export function createMainWindow(supervisor: FleetSupervisor): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    show: true,
    title: "Apiary",
    webPreferences: {
      // b-AC-2: renderer isolation. No Node/require surface reachable from dashboard content.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: DASHBOARD_PRELOAD,
    },
  });

  const gate = createReadinessGate();
  let budgetTimer: NodeJS.Timeout | undefined;
  let unsubHiveReady: (() => void) | undefined;
  let unsubStatus: (() => void) | undefined;
  let disposeAuthIpc: (() => void) | undefined;

  const showLoading = (): void => {
    void win.loadURL(toHtmlDataUrl(renderLoadingHtml()));
  };
  const showFailed = (message: string): void => {
    void win.loadURL(toHtmlDataUrl(renderFailedHtml(message)));
  };
  const showDashboard = (): void => {
    void win.loadURL(DASHBOARD_ORIGIN);
  };

  gate.onChange((state) => {
    if (state.phase === "loading") showLoading();
    else if (state.phase === "ready") showDashboard();
    else if (state.phase === "failed") showFailed(state.message ?? "Apiary could not start.");
  });

  const subscribeReady = (): void => {
    unsubHiveReady?.();
    // onHiveReady fires immediately if Hive is ALREADY healthy, so this both handles the
    // already-up case and the becomes-up-later case with one subscription.
    unsubHiveReady = supervisor.onHiveReady(() => {
      if (budgetTimer !== undefined) clearTimeout(budgetTimer);
      gate.markHiveReady();
    });
  };
  const armBudget = (): void => {
    if (budgetTimer !== undefined) clearTimeout(budgetTimer);
    budgetTimer = setTimeout(() => gate.markBudgetExpired(), STARTUP_BUDGET_MS);
  };

  // b-AC-1/b-AC-4: show loading now, then wait for Hive.
  showLoading();
  armBudget();
  subscribeReady();

  // b-AC-3: push fleet-status snapshots to the renderer — initial snapshot on load, then on change.
  const pushStatus = (status: FleetStatus): void => {
    if (!win.isDestroyed()) win.webContents.send(APIARY_IPC_CHANNELS.fleetStatus, toRendererStatus(status));
  };
  win.webContents.on("did-finish-load", () => pushStatus(supervisor.getFleetStatus()));
  unsubStatus = supervisor.onStatusChange(pushStatus);

  // b-AC-5 + b-AC-4 retry: lock navigation to the loopback origin; external links → OS browser; the
  // failed-view Retry sentinel re-arms the gate instead of navigating anywhere.
  const handleNavigation = (event: { preventDefault(): void }, url: string): void => {
    const decision = decideNavigation(url);
    if (decision.kind === "allow-in-window") return; // stay in-window
    event.preventDefault();
    if (decision.kind === "retry") {
      gate.retry();
      armBudget();
      subscribeReady();
    } else if (decision.kind === "external") {
      void shell.openExternal(url);
    }
    // "blocked" → simply prevented; nothing is opened.
  };
  // Guard client-initiated navigation AND server-side redirects with the SAME loopback decision:
  // `will-navigate` does NOT fire for a 3xx redirect, so a 302 from DASHBOARD_ORIGIN could otherwise
  // move the window off loopback unchecked. `will-redirect` closes that hole (b-AC-5).
  win.webContents.on("will-navigate", (event, url) => handleNavigation(event, url));
  win.webContents.on("will-redirect", (event, url) => handleNavigation(event, url));
  win.webContents.setWindowOpenHandler(({ url }) => {
    const decision = decideNavigation(url);
    if (decision.kind === "external") void shell.openExternal(url);
    // Never let the renderer spawn a new in-app window — the auth window is opened only via the
    // owned, validated IPC seam (b-AC-7), never through window.open.
    return { action: "deny" };
  });

  // b-AC-7: register the PRD-004 owned-auth-window seam (https-only, token-free).
  disposeAuthIpc = registerAuthWindowIpc(() => win);

  win.on("closed", () => {
    if (budgetTimer !== undefined) clearTimeout(budgetTimer);
    unsubHiveReady?.();
    unsubStatus?.();
    disposeAuthIpc?.();
  });

  return win;
}
