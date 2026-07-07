/**
 * PRD-005b extension point (STUB). Wave 1b implements the body; this file exists so `main.ts`
 * can wire the call and the supervisor→window contract is fixed now.
 *
 * The window consumes ONLY the stable {@link FleetSupervisor} surface (005a): it reads
 * {@link FleetSupervisor.getFleetStatus} for the initial state and subscribes via
 * {@link FleetSupervisor.onHiveReady} to know when to point the BrowserWindow at Hive's dashboard
 * (loopback :3853). 005b MUST NOT edit the supervisor to add what it needs — the contract is here.
 */

import type { BrowserWindow } from "electron";

import type { FleetSupervisor } from "../supervisor/index.js";

/**
 * Create the main dashboard window (005b). STUB: throws until wave 1b implements it. `main.ts`
 * calls this on `whenReady`; wave 1b fills the body (BrowserWindow, preload, and the
 * `onHiveReady` → `loadURL(hive)` wiring) without touching the supervisor.
 */
export function createMainWindow(_supervisor: FleetSupervisor): BrowserWindow {
  throw new Error("TODO 005b: createMainWindow is not implemented yet (window/renderer wave).");
}
