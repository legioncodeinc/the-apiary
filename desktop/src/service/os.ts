/**
 * PRD-005c c-AC-4: the three service-manager families the takeover targets, plus a pure classifier
 * from a Node `process.platform` string. Injected (not read from `process` directly) so every
 * per-OS argv path is unit-testable on a single CI host regardless of the runner's real OS.
 */

/** The service-manager family a given OS uses. `unsupported` short-circuits the takeover to a no-op. */
export type ServiceOs = "windows" | "macos" | "linux" | "unsupported";

/**
 * Classify a Node platform string into a service-manager family. Total: any unknown platform maps
 * to `unsupported` (the takeover then does nothing rather than guessing a service manager).
 */
export function classifyOs(platform: NodeJS.Platform): ServiceOs {
  switch (platform) {
    case "win32":
      return "windows";
    case "darwin":
      return "macos";
    case "linux":
      return "linux";
    default:
      return "unsupported";
  }
}
