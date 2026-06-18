/**
 * P4.3-Sb2 — Platform State Directory Resolution
 *
 * Resolves the platform-appropriate directory for persisting Inspector
 * auth state (token store). Supports deterministic overrides for testing.
 *
 * Paths:
 * - Linux:   $XDG_STATE_HOME/alix-inspector or ~/.local/state/alix-inspector
 * - macOS:   ~/Library/Application Support/alix-inspector
 * - Windows: %LOCALAPPDATA%/alix-inspector
 *
 * @module
 */

import { homedir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UserStatePaths {
  /** Directory for Inspector auth state (token store). */
  authStateDir: string;
}

// ---------------------------------------------------------------------------
// Override for testing
// ---------------------------------------------------------------------------

let overrideDir: string | null = null;

/**
 * Override the resolved state directory (for deterministic tests).
 * Call `clearOverride()` to restore platform resolution.
 */
export function setStateDirOverride(dir: string): void {
  overrideDir = dir;
}

/** Clear any test override, restoring platform resolution. */
export function clearStateDirOverride(): void {
  overrideDir = null;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the platform-appropriate base state directory for ALiX Inspector.
 */
function resolveBaseStateDir(): string {
  if (overrideDir !== null) return overrideDir;

  const platform = process.platform;

  if (platform === "linux") {
    // XDG_STATE_HOME or ~/.local/state
    const xdg = process.env["XDG_STATE_HOME"];
    if (xdg) return join(xdg, "alix-inspector");
    return join(homedir(), ".local", "state", "alix-inspector");
  }

  if (platform === "darwin") {
    // ~/Library/Application Support
    return join(homedir(), "Library", "Application Support", "alix-inspector");
  }

  if (platform === "win32") {
    // %LOCALAPPDATA% or fallback
    const localAppData = process.env["LOCALAPPDATA"];
    if (localAppData) return join(localAppData, "alix-inspector");
    return join(homedir(), "AppData", "Local", "alix-inspector");
  }

  // Fallback for unknown platforms
  return join(homedir(), ".alix-inspector");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return the resolved user-state paths.
 *
 * The caller is responsible for creating directories with restrictive
 * permissions and verifying symlink safety before writing.
 */
export function getUserStatePaths(): UserStatePaths {
  const base = resolveBaseStateDir();
  return {
    authStateDir: join(base, "auth"),
  };
}
