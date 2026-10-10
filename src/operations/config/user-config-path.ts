// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * user-config-path.ts — the one resolver for `~/.config/alix/config.json`.
 *
 * Shared by credential resolution (`governance/security/credentials/api-keys.ts`)
 * and search-provider config (`operations/config/search-config.ts`) so the path
 * (and its test seam) has a single owner. Environment variables are never
 * consulted.
 */

import { homedir } from "node:os";
import { join } from "node:path";

// Test seam — override the user-config path without touching the real filesystem.
let userConfigPathOverride: string | undefined;

export function _setUserConfigPathOverride(path: string | undefined): void {
  userConfigPathOverride = path;
}

export function resolveUserConfigPath(): string {
  return userConfigPathOverride ?? join(homedir(), ".config", "alix", "config.json");
}
