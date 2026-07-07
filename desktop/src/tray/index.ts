/**
 * PRD-005c extension point (STUB). Wave 2 implements the body; this file exists so `main.ts` can
 * wire the call and the supervisor→tray contract is fixed now.
 *
 * The tray consumes ONLY the stable {@link FleetSupervisor} surface (005a): it reads
 * {@link FleetSupervisor.getFleetStatus} to render fleet state, subscribes via
 * {@link FleetSupervisor.onStatusChange} to re-render on change, and calls
 * {@link FleetSupervisor.stop} from a "Quit" menu item. It MUST NOT edit the supervisor.
 */

import type { Tray } from "electron";

import type { FleetSupervisor } from "../supervisor/index.js";

/**
 * Create the system tray (005c). STUB: throws until wave 2 implements it. `main.ts` calls this
 * on `whenReady`; wave 2 fills the body (Tray, context menu, status-driven icon) against the
 * `getFleetStatus` / `onStatusChange` / `stop` contract without touching the supervisor.
 */
export function setupTray(_supervisor: FleetSupervisor): Tray {
  throw new Error("TODO 005c: setupTray is not implemented yet (tray/native-integration wave).");
}
