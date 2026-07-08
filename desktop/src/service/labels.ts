/**
 * PRD-005c c-AC-4: the Apiary-owned OS service-unit LABELS the takeover supersedes — current AND
 * legacy — for each of the three service managers (launchd / systemd / schtasks).
 *
 * These are the single source of truth for "which units do we own". The takeover only ever acts on
 * a unit whose label appears here (the never-touch-a-unit-we-don't-own boundary, c-AC-6). Every
 * label is a NAMED constant, not an inline literal, so a future confirmation against the fleet's
 * real service modules (`hive/src/service/platform.ts`, `nectar/src/service/platform.ts`,
 * `doctor/src/service/platform.ts`, `honeycomb/src/cli/daemon-service.ts`) is a one-place edit.
 *
 * SOURCE OF FACTS: PRD-005c c-AC-4 (`launchd com.legioncode.hive` + legacy; systemd units; schtasks
 * names) and ADR-0005 context (legacy names `thehive`, `HiveDoctor`, `HivenectarDaemon`). Those
 * submodule dirs are EMPTY in this worktree, so anything not stated verbatim in the PRD/ADR is
 * marked `TODO(005c-confirm)` and must be reconciled against the real service modules before ship.
 */

/** One OS-service unit the shell can supersede, on one platform. */
export interface ServiceUnitLabel {
  /**
   * The launchd service label (macOS), e.g. `com.legioncode.hive`. Also the reverse-DNS label used
   * to derive the plist filename `<label>.plist`.
   */
  readonly launchdLabel: string;
  /** The systemd --user unit name (Linux), e.g. `hive.service`. */
  readonly systemdUnit: string;
  /** The Windows Scheduled-Task name (schtasks /TN), e.g. `hive`. */
  readonly schtasksName: string;
  /** True for a CURRENT label, false for a LEGACY label kept only so old installs are cleaned up. */
  readonly current: boolean;
  /** Which fleet daemon this unit historically autostarted (for the audit log only). */
  readonly daemon: string;
}

/**
 * The CURRENT Hive service unit. `com.legioncode.hive` / `hive.service` / schtasks `hive` are
 * stated verbatim in PRD-005c c-AC-4, so these three are confident.
 */
export const HIVE_CURRENT: ServiceUnitLabel = {
  launchdLabel: "com.legioncode.hive",
  systemdUnit: "hive.service",
  schtasksName: "hive",
  current: true,
  daemon: "hive",
};

/**
 * LEGACY Hive unit — historical name `thehive` (ADR-0005 context lists `thehive` among the legacy
 * labels). The launchd/systemd spellings below are DERIVED from the current pattern and must be
 * confirmed against `hive/src/service/platform.ts` `LEGACY_*`.
 */
export const HIVE_LEGACY: ServiceUnitLabel = {
  // TODO(005c-confirm): confirm the legacy launchd label against hive/src/service/platform.ts LEGACY_*.
  launchdLabel: "com.legioncode.thehive",
  // TODO(005c-confirm): confirm the legacy systemd unit name against hive/src/service/platform.ts LEGACY_*.
  systemdUnit: "thehive.service",
  schtasksName: "thehive",
  current: false,
  daemon: "hive",
};

/**
 * The CURRENT Doctor service unit. Only the legacy schtasks name (`HiveDoctor`) is stated in the
 * ADR; the current launchd/systemd/schtasks spellings are DERIVED from the `com.legioncode.<daemon>`
 * / `<daemon>.service` pattern and must be confirmed against doctor/src/service/platform.ts.
 */
export const DOCTOR_CURRENT: ServiceUnitLabel = {
  // TODO(005c-confirm): confirm the doctor launchd label against doctor/src/service/platform.ts.
  launchdLabel: "com.legioncode.doctor",
  // TODO(005c-confirm): confirm the doctor systemd unit name against doctor/src/service/platform.ts.
  systemdUnit: "doctor.service",
  // TODO(005c-confirm): confirm the current doctor schtasks name against doctor/src/service/platform.ts.
  schtasksName: "doctor",
  current: true,
  daemon: "doctor",
};

/**
 * LEGACY Doctor unit — historical name `HiveDoctor` (ADR-0005 context). schtasks name is confident;
 * the launchd/systemd spellings are derived and must be confirmed.
 */
export const DOCTOR_LEGACY: ServiceUnitLabel = {
  // TODO(005c-confirm): confirm the legacy doctor launchd label against doctor/src/service/platform.ts LEGACY_*.
  launchdLabel: "com.legioncode.HiveDoctor",
  // TODO(005c-confirm): confirm the legacy doctor systemd unit name against doctor/src/service/platform.ts LEGACY_*.
  systemdUnit: "HiveDoctor.service",
  schtasksName: "HiveDoctor",
  current: false,
  daemon: "doctor",
};

/**
 * LEGACY Nectar unit — historical name `HivenectarDaemon` (ADR-0005 context). There is no current
 * Nectar root in the shell's ownership set (the shell owns only Doctor + Hive; Doctor owns Nectar),
 * so only the legacy unit is listed, purely to clean up an old service install. schtasks name is
 * confident; launchd/systemd derived.
 */
export const NECTAR_LEGACY: ServiceUnitLabel = {
  // TODO(005c-confirm): confirm the legacy nectar launchd label against nectar/src/service/platform.ts LEGACY_*.
  launchdLabel: "com.legioncode.HivenectarDaemon",
  // TODO(005c-confirm): confirm the legacy nectar systemd unit name against nectar/src/service/platform.ts LEGACY_*.
  systemdUnit: "HivenectarDaemon.service",
  schtasksName: "HivenectarDaemon",
  current: false,
  daemon: "nectar",
};

/**
 * Every Apiary-owned service unit the takeover supersedes, current + legacy. The takeover iterates
 * this list on each platform and only ever acts on units named here (c-AC-4 / boundary c-AC-6).
 */
export const APIARY_SERVICE_UNITS: readonly ServiceUnitLabel[] = [
  HIVE_CURRENT,
  HIVE_LEGACY,
  DOCTOR_CURRENT,
  DOCTOR_LEGACY,
  NECTAR_LEGACY,
];

/**
 * The npm package name of the STANDALONE product the desktop app supersedes (c-AC-8 / ADR-0005
 * decision 5). Constant so the uninstall argv never inlines it.
 */
export const STANDALONE_HIVEMIND_PACKAGE = "@deeplake/hivemind";

/**
 * The shared credential/data directory that the standalone uninstall MUST NEVER touch (c-AC-8
 * invariant). The uninstall removes only the package/service/autostart; `~/.deeplake` (credential +
 * memory data) is preserved. Encoded as a constant so a test can assert no argv references it.
 */
export const PROTECTED_DEEPLAKE_DIR = ".deeplake";
