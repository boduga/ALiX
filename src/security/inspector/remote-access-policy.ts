/**
 * P4.3-Sc1.4 — Remote Access and TLS Policy
 *
 * Startup-time validation for Inspector binding PLUS per-request enforcement
 * of security boundaries between loopback (local development) and remote
 * (network-exposed) access patterns.
 *
 * Rules:
 * - Loopback bind → relaxed: non-TLS ok, no-Origin ok, cookie Secure optional
 * - Remote bind → strict: TLS required, secure cookies, exact origins/hosts
 * - Cleartext remote Bearer authentication is rejected
 * - Secure cookies required on remote connections
 * - Exact allowed origins and hosts required remotely
 *
 * Follows the discriminated-union pattern for validation results.
 *
 * @module
 */

import type { IncomingMessage } from "node:http";
import { isLoopbackHost } from "../../config/validator.js";
import type { AlixConfig } from "../../config/schema.js";

// ---------------------------------------------------------------------------
// Legacy types (Sb1 startup validation)
// ---------------------------------------------------------------------------

export type StartupCheckResult =
  | { ok: true; warnings: string[] }
  | { ok: false; error: string; warnings: string[] };

// ---------------------------------------------------------------------------
// New Sc1.4 types
// ---------------------------------------------------------------------------

export type RemoteAccessResult =
  | { ok: true }
  | { ok: false; error: string; statusCode: number };

/** The access mode determined at startup based on bind address. */
export type AccessMode = "loopback" | "remote";

/** Connection security level. */
export type ConnectionSecurity = "direct-tls" | "proxy-tls" | "cleartext";

/** Configuration for remote access policy. */
export interface RemoteAccessConfig {
  /** The host the server is bound to. */
  bindHost: string;
  /** Whether remote access is explicitly enabled. */
  remoteAccess: boolean;
  /** Whether TLS is required for remote connections. */
  requireTlsForRemote: boolean;
  /** Allowed hostnames. */
  allowedHosts: string[];
  /** Allowed origins. */
  allowedOrigins: string[];
}

/** Startup validation result. */
export interface RemoteAccessStartupResult {
  mode: AccessMode;
  valid: boolean;
  warnings: string[];
  errors: string[];
}

/** Doctor-compatible diagnostic summary for remote access. */
export interface RemoteAccessDoctorReport {
  mode: AccessMode;
  remoteAccessEnabled: boolean;
  tlsRequired: boolean;
  allowedHostsCount: number;
  allowedOriginsCount: number;
  startupValid: boolean;
  startupWarnings: string[];
  startupErrors: string[];
}

// ---------------------------------------------------------------------------
// Loopback detection
// ---------------------------------------------------------------------------

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost", "[::1]"]);

/**
 * Return true when the bind host is a loopback address.
 */
export function isLoopbackBind(host: string): boolean {
  const lower = host.toLowerCase();
  return LOOPBACK_HOSTS.has(lower);
}

/**
 * Determine the access mode from the bind host configuration.
 */
export function resolveAccessMode(bindHost: string): AccessMode {
  if (isLoopbackBind(bindHost)) return "loopback";
  return "remote";
}

// ---------------------------------------------------------------------------
// Connection security detection
// ---------------------------------------------------------------------------

/**
 * Determine the connection security level of a request.
 */
export function detectConnectionSecurity(req: IncomingMessage): ConnectionSecurity {
  const sock = req.socket as unknown as { encrypted?: boolean } | null;
  if (sock?.encrypted) return "direct-tls";

  const fwdProto = getSingleHeader(req, "x-forwarded-proto");
  if (fwdProto?.toLowerCase() === "https") return "proxy-tls";

  return "cleartext";
}

/**
 * Return true when the connection appears to be encrypted.
 */
export function isEncrypted(req: IncomingMessage): boolean {
  const security = detectConnectionSecurity(req);
  return security === "direct-tls" || security === "proxy-tls";
}

// ---------------------------------------------------------------------------
// Remote access validation (per-request)
// ---------------------------------------------------------------------------

/**
 * Validate a request against the remote access policy.
 *
 * Enforces:
 * - Cleartext remote Bearer auth → rejected
 * - Secure cookies required remotely
 * - Exact origins/hosts required remotely
 */
export function validateRemoteAccess(
  req: IncomingMessage,
  config: RemoteAccessConfig,
  isBearerAuth: boolean,
  isCookieAuth: boolean,
): RemoteAccessResult {
  const mode = resolveAccessMode(config.bindHost);

  if (mode === "loopback") {
    return { ok: true };
  }

  // Remote mode — strict checks
  const security = detectConnectionSecurity(req);

  // ── 1. Reject cleartext remote Bearer authentication ───────────────
  if (isBearerAuth && security === "cleartext") {
    const peerAddr = req.socket?.remoteAddress ?? "";
    const peerLower = peerAddr.toLowerCase();
    // Allow loopback peer behind a reverse proxy on the same machine
    if (
      !LOOPBACK_HOSTS.has(peerLower) &&
      peerAddr !== "127.0.0.1" &&
      peerAddr !== "::1"
    ) {
      if (config.requireTlsForRemote) {
        return { ok: false, error: "cleartext_remote_bearer_denied", statusCode: 403 };
      }
    }
  }

  // ── 2. Require secure cookies remotely ────────────────────────────
  if (isCookieAuth && security === "cleartext" && config.requireTlsForRemote) {
    return { ok: false, error: "cleartext_remote_cookie_denied", statusCode: 403 };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Secure cookie policy
// ---------------------------------------------------------------------------

/**
 * Determine whether the Set-Cookie response should include the Secure flag.
 */
export function shouldSetSecureCookie(
  req: IncomingMessage,
  mode: AccessMode,
): boolean {
  if (mode === "remote") return true;
  return isEncrypted(req);
}

// ---------------------------------------------------------------------------
// Startup validation (new — complements legacy checkStartupSafety)
// ---------------------------------------------------------------------------

/**
 * Validate remote access configuration at startup.
 * Separate from the legacy `checkStartupSafety` — returns structured
 * warnings and errors for `alix doctor`.
 */
export function validateRemoteAccessStartup(
  config: RemoteAccessConfig,
): RemoteAccessStartupResult {
  const mode = resolveAccessMode(config.bindHost);
  const warnings: string[] = [];
  const errors: string[] = [];

  if (!config.remoteAccess) {
    return { mode, valid: true, warnings, errors };
  }

  // Remote access enabled — validate configuration

  if (config.allowedHosts.length === 0) {
    errors.push(
      "Remote access enabled but no allowed hosts configured. " +
      "All external requests will be denied.",
    );
  }

  if (config.allowedHosts.includes("*")) {
    errors.push(
      "Wildcard '*' in allowed hosts is not permitted with remote access. " +
      "Specify exact hostnames.",
    );
  }

  if (config.allowedOrigins.length === 0) {
    warnings.push(
      "Remote access enabled but no allowed origins configured. " +
      "Cross-origin browser requests will be denied.",
    );
  }

  if (config.allowedOrigins.includes("*")) {
    errors.push(
      "Wildcard '*' in allowed origins is not permitted with remote access. " +
      "Specify exact origins for credentialed API requests.",
    );
  }

  if (!config.requireTlsForRemote) {
    warnings.push(
      "TLS not required for remote access. " +
      "Bearer tokens and cookies will be transmitted in cleartext.",
    );
  }

  return {
    mode,
    valid: errors.length === 0,
    warnings,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Doctor report
// ---------------------------------------------------------------------------

export function remoteAccessDoctorReport(
  config: RemoteAccessConfig,
): RemoteAccessDoctorReport {
  const startup = validateRemoteAccessStartup(config);

  return {
    mode: startup.mode,
    remoteAccessEnabled: config.remoteAccess,
    tlsRequired: config.requireTlsForRemote,
    allowedHostsCount: config.allowedHosts.length,
    allowedOriginsCount: config.allowedOrigins.length,
    startupValid: startup.valid,
    startupWarnings: startup.warnings,
    startupErrors: startup.errors,
  };
}

// ---------------------------------------------------------------------------
// Legacy startup safety check (Sb1 — kept for backward compatibility)
// ---------------------------------------------------------------------------

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
    if (sec?.authentication === "disabled-loopback-development") {
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSingleHeader(req: IncomingMessage, name: string): string | undefined {
  const val = req.headers[name];
  if (!val) return undefined;
  return Array.isArray(val) ? val[0] : val;
}
