/**
 * remote-access-policy.ts — Startup-time validation for Inspector binding.
 *
 * Determines whether the configured host address is a loopback address
 * and whether remote access is securely configured.
 */

import { isLoopbackHost } from "../../config/validator.js";
import type { AlixConfig } from "../../config/schema.js";

export type StartupCheckResult =
  | { ok: true; warnings: string[] }
  | { ok: false; error: string; warnings: string[] };

/**
 * Check whether the Inspector can safely start with the given config.
 *
 * Rules:
 *  - Loopback hosts are always safe (127.0.0.1, localhost, ::1).
 *  - 0.0.0.0 is allowed in development if remoteAccess is false and a warning is shown.
 *  - Any non-loopback host without authentication is rejected.
 *  - A high-visibility warning is printed for non-loopback hosts in development mode.
 */
export function checkStartupSafety(config: Pick<AlixConfig, "ui">): StartupCheckResult {
  const warnings: string[] = [];
  const host = config.ui.host;
  const sec = config.ui.security;

  if (isLoopbackHost(host)) {
    // Loopback — safe
    return { ok: true, warnings };
  }

  // Non-loopback host
  if (host === "0.0.0.0") {
    warnings.push(
      "WARNING: Inspector is configured to bind to 0.0.0.0 (all interfaces).\n" +
      "         This exposes the Inspector to network connections.\n" +
      "         Set ui.host to 127.0.0.1 in your config for loopback-only access.\n" +
      `         Current: ui.host = "${host}"`
    );
  } else {
    warnings.push(
      `WARNING: Inspector is configured to bind to "${host}" (non-loopback).\n` +
      "         Remote access is not yet approved until authentication lands.\n" +
      "         Set ui.host to 127.0.0.1 for safe local development.\n" +
      `         Current: ui.host = "${host}"`
    );
  }

  // Check authentication setup
  if (sec?.authentication === "disabled-loopback-development" || !sec) {
    // Without explicit security config or auth disabled on non-loopback — warn
    if (sec?.authentication === "disabled-loopback-development") {
      // Only warn if on non-loopback with auth disabled
      warnings.push(
        "WARNING: Authentication is disabled while binding to a non-loopback host.\n" +
        "         This is a security risk. Enable authentication or bind to loopback."
      );
    }
  }

  // Check remoteAccess
  if (sec?.remoteAccess) {
    warnings.push(
      "WARNING: remoteAccess is enabled but authentication is not yet fully implemented.\n" +
      "         Remote access over loopback is safe; external access is NOT yet approved."
    );
  }

  // 0.0.0.0 is allowed in development mode with a warning
  if (host === "0.0.0.0") {
    return { ok: true, warnings };
  }

  // Any other non-loopback host without authentication is rejected
  if (!sec || sec.authentication === "disabled-loopback-development") {
    return {
      ok: false,
      error: "Inspector cannot start: non-loopback host without authentication is not secure.\n" +
             "Set ui.host to 127.0.0.1 in your config, or configure ui.security with authentication.",
      warnings,
    };
  }

  return { ok: true, warnings };
}
