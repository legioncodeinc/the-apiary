/**
 * PRD-005c (c-AC-1): the PURE tray menu-model builder.
 *
 * No `electron` import. This is the testable core that decides WHAT the tray tooltip/menu should
 * show, driven only by a {@link FleetStatus} snapshot. The electron wrapper (`index.ts`) calls this
 * on every `onStatusChange` tick and hands the returned {@link TrayMenuModel} to `Tray.setToolTip` /
 * `Menu.buildFromTemplate` — it does no status-to-label decisions itself.
 *
 * Menu items are always present (Open Dashboard, Restart Fleet, Quit) so the tray works while the
 * main window is closed (c-AC-1); only their `enabled` flag and the status label change with fleet
 * state. "Restart Fleet" is enabled precisely when there is something worth restarting (a terminal
 * failure) — restarting a healthy fleet is a no-op the wrapper does not need to offer.
 */

import type { FleetStatus, RootName, RootPhase } from "../supervisor/index.js";

/** One row in the tray's fleet-status section (not a clickable action — informational). */
export interface TrayStatusLine {
  readonly root: RootName;
  readonly label: string;
}

/** One clickable tray menu action. `enabled: false` renders greyed-out/disabled in the native menu. */
export interface TrayMenuAction {
  readonly id: "open-dashboard" | "restart-fleet" | "quit";
  readonly label: string;
  readonly enabled: boolean;
}

/** The full tray presentation for one status tick: tooltip text, status rows, and action rows. */
export interface TrayMenuModel {
  /** Short summary shown as the native tray icon tooltip. */
  readonly tooltip: string;
  /** Per-root status lines, rendered as disabled/informational menu rows above the actions. */
  readonly statusLines: readonly TrayStatusLine[];
  /** The three-plus standing actions (c-AC-1): Open Dashboard, Restart Fleet, Quit. */
  readonly actions: readonly TrayMenuAction[];
}

/** Human-readable label for one root phase, used in both the tooltip and the per-root status line. */
function phaseLabel(phase: RootPhase): string {
  switch (phase) {
    case "idle":
      return "idle";
    case "starting":
      return "starting…";
    case "healthy":
      return "healthy";
    case "restarting":
      return "restarting…";
    case "failed":
      return "failed";
    case "port-conflict":
      return "port conflict";
    case "stopped":
      return "stopped";
  }
}

/** Capitalized root name for display ("doctor" → "Doctor"). */
function rootDisplayName(name: RootName): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** The tooltip's one-line summary, prioritizing the most actionable state. */
function summaryLabel(status: FleetStatus): string {
  if (status.hasTerminalFailure) return "Apiary — attention needed";
  if (status.allHealthy) return "Apiary — fleet healthy";
  return "Apiary — starting…";
}

/**
 * Build the tray's menu model from a fleet-status snapshot (c-AC-1). Pure: same input always
 * produces the same output, so this is fully unit-testable with no Electron `Tray`/`Menu` classes.
 */
export function buildTrayMenuModel(status: FleetStatus): TrayMenuModel {
  const statusLines: TrayStatusLine[] = status.roots.map((root) => ({
    root: root.name,
    label: `${rootDisplayName(root.name)}: ${phaseLabel(root.phase)}`,
  }));

  const tooltipDetail = status.roots.map((root) => `${rootDisplayName(root.name)} ${phaseLabel(root.phase)}`).join(", ");
  const tooltip = tooltipDetail.length > 0 ? `${summaryLabel(status)}\n${tooltipDetail}` : summaryLabel(status);

  const actions: TrayMenuAction[] = [
    { id: "open-dashboard", label: "Open Dashboard", enabled: true },
    // Restarting is only meaningful when something is actually stuck in a terminal state; a healthy
    // or still-starting fleet has nothing productive for "Restart Fleet" to do.
    { id: "restart-fleet", label: "Restart Fleet", enabled: status.hasTerminalFailure },
    { id: "quit", label: "Quit", enabled: true },
  ];

  return { tooltip, statusLines, actions };
}
