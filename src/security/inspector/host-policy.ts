/**
 * P4.3-Sc1.1 — Hardened Host Policy
 *
 * Validates incoming HTTP Host headers against an allowed list with:
 * - Exact hostname matching (no substring or suffix tricks)
 * - DNS rebinding detection (IP-vs-hostname mismatch)
 * - Rejection of userinfo, path, fragment, and invalid Unicode
 * - Case and port normalization
 * - Malformed bracketed IPv6 detection
 * - Never reflects raw Host header values in error responses
 *
 * Follows the discriminated-union pattern:
 *   { ok: true; normalizedHost: string } | { ok: false; error: string; statusCode: number }
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HostPolicyResult =
  | { ok: true; normalizedHost: string }
  | { ok: false; error: string; statusCode: number };

// ---------------------------------------------------------------------------
// Default loopback hosts
// ---------------------------------------------------------------------------

const DEFAULT_LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

/**
 * Return the default loopback host set.
 * Callers can use this to populate `allowedHosts` when none are configured.
 */
export function defaultLoopbackHosts(): ReadonlySet<string> {
  return DEFAULT_LOOPBACK_HOSTS;
}

// ---------------------------------------------------------------------------
// Character validators
// ---------------------------------------------------------------------------

/**
 * Check whether a hostname segment contains only valid characters.
 *
 * RFC 952 / RFC 1123 hostnames:
 * - Letters (a-z, A-Z), digits (0-9), hyphens
 * - Cannot start or end with a hyphen
 * - Each segment must be at least 1 character
 * - Total length <= 253 characters
 *
 * Returns the segment if valid, or null.
 */
function validateHostnameSegment(segment: string): string | null {
  if (segment.length === 0) return null;
  if (segment.length > 63) return null;
  if (segment.startsWith("-") || segment.endsWith("-")) return null;

  for (let i = 0; i < segment.length; i++) {
    const ch = segment.charCodeAt(i);
    // a-z (97-122), A-Z (65-90), 0-9 (48-57), hyphen (45)
    if (
      !(ch >= 97 && ch <= 122) &&
      !(ch >= 65 && ch <= 90) &&
      !(ch >= 48 && ch <= 57) &&
      ch !== 45
    ) {
      return null;
    }
  }

  return segment;
}

// ---------------------------------------------------------------------------
// IPv4 / IPv6 classification
// ---------------------------------------------------------------------------

/**
 * Return true when the host string is a bare IPv4 address (no brackets, no port).
 */
function isIPv4Literal(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return false;
    const n = parseInt(p, 10);
    if (n < 0 || n > 255) return false;
  }
  return true;
}

/**
 * Return true when the host string looks like a bare IPv6 address
 * (contains colons, may include hex digits and % scope ids).
 */
function isIPv6Literal(host: string): boolean {
  // Must contain at least one colon
  if (!host.includes(":")) return false;
  // Must not look like a hostname:port (only one colon)
  // IPv6 addresses have 2-7 colons
  const colonCount = (host.match(/:/g) || []).length;
  if (colonCount < 2) return false;
  // Allow % scope id at the end
  const scopeIdx = host.indexOf("%");
  const addr = scopeIdx !== -1 ? host.slice(0, scopeIdx) : host;
  // Validate hex digits and colons (simplified: reject obviously bad chars)
  for (const part of addr.split(":")) {
    if (part.length > 4) return false;
    if (part.length > 0 && !/^[0-9a-fA-F]{1,4}$/.test(part)) {
      // Allow empty for :: compression
      if (part.length !== 0) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// DNS rebinding detection
// ---------------------------------------------------------------------------

/**
 * Detect DNS rebinding: a Host value that is an IP address when the allowed
 * list only contains hostnames, or a hostname when the allowed list only
 * contains IP addresses.
 */
function isDnsRebinding(host: string, allowedHosts: string[]): boolean {
  const hostIsIp = isIPv4Literal(host) || isIPv6Literal(host);
  const allowedIsHostname = allowedHosts.some(
    (a) => !isIPv4Literal(a) && !isIPv6Literal(a),
  );
  const allowedIsIp = allowedHosts.some(
    (a) => isIPv4Literal(a) || isIPv6Literal(a),
  );

  // If allowed list contains both IPs and hostnames, no rebinding check needed
  if (allowedIsHostname && allowedIsIp) return false;

  // If we only allow IPs but got a hostname → rebinding attack
  if (allowedIsIp && !allowedIsHostname && !hostIsIp) return true;

  // If we only allow hostnames but got an IP → rebinding attack
  if (allowedIsHostname && !allowedIsIp && hostIsIp) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Normalize
// ---------------------------------------------------------------------------

/**
 * Normalize a raw Host header value:
 * - Takes first value from comma-separated list
 * - Trims whitespace
 * - Strips port (including IPv6 [::1]:port)
 * - Strips default ports (80 for http, 443 for https — not relevant for Host)
 * - Lowercases
 * - Removes IPv6 brackets from bare addresses
 * - Preserves brackets when port is present (caller strips separately)
 */
export function normalizeHost(raw: string): string {
  let host = raw
    .split(",")[0] // first of multiple values
    .trim()
    .toLowerCase();

  // Strip port from IPv6 [::1]:port
  if (host.startsWith("[")) {
    const bracketEnd = host.indexOf("]");
    if (bracketEnd !== -1) {
      const inner = host.slice(1, bracketEnd);
      const afterBracket = host.slice(bracketEnd + 1);
      if (afterBracket.startsWith(":")) {
        host = inner;
      } else {
        host = inner;
      }
    }
  } else {
    // Strip port from host:port — but NOT IPv6 addresses (multiple colons)
    const colonCount = (host.match(/:/g) || []).length;
    if (colonCount <= 1) {
      const colonIdx = host.lastIndexOf(":");
      if (colonIdx !== -1) {
        const afterColon = host.slice(colonIdx + 1);
        if (/^\d+$/.test(afterColon)) {
          host = host.slice(0, colonIdx);
        }
      }
    }
  }

  // Strip trailing dot (FQDN notation)
  if (host.endsWith(".")) {
    host = host.slice(0, -1);
  }

  return host;
}

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

/**
 * Validate an incoming Host header against the allowed hosts list.
 *
 * Hardening layers (applied in order):
 * 1. Presence check — reject missing/empty Host
 * 2. Syntax check — reject userinfo, path, fragment, bad characters
 * 3. Normalization — lowercase, strip port
 * 4. DNS rebinding check — reject IP/hostname mismatch
 * 5. Allow-list check — exact match against allowed hosts
 *
 * Errors never include the raw Host header value.
 */
export function validateHost(
  hostHeader: string | string[] | undefined,
  allowedHosts: string[],
): HostPolicyResult {
  // ── 1. Presence check ──────────────────────────────────────────────
  if (!hostHeader || (Array.isArray(hostHeader) && hostHeader.length === 0)) {
    return { ok: false, error: "invalid_host", statusCode: 400 };
  }

  const raw = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;
  const trimmed = raw.trim();

  if (!trimmed) {
    return { ok: false, error: "invalid_host", statusCode: 400 };
  }

  // ── 2. Syntax check — reject dangerous constructs ─────────────────

  // Reject userinfo (user:password@host)
  if (trimmed.includes("@")) {
    return { ok: false, error: "invalid_host", statusCode: 400 };
  }

  // Reject path or fragment separators
  if (trimmed.includes("/") || trimmed.includes("#") || trimmed.includes("?")) {
    return { ok: false, error: "invalid_host", statusCode: 400 };
  }

  // Reject control characters and other dangerous bytes
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed.charCodeAt(i);
    // Control chars (0-31), DEL (127), and high bytes > 127 are not valid
    // in a Host header (we only allow ASCII printable + ':[' ']' '%' for scope)
    if (ch <= 31 || ch === 127) {
      return { ok: false, error: "invalid_host", statusCode: 400 };
    }
  }

  // ── 3. IPv6 bracket validation ────────────────────────────────────
  if (trimmed.startsWith("[")) {
    const bracketEnd = trimmed.indexOf("]");
    if (bracketEnd === -1) {
      // Unmatched opening bracket
      return { ok: false, error: "invalid_host", statusCode: 400 };
    }
    // Reject content before the opening bracket
    if (trimmed.indexOf("[") !== 0) {
      return { ok: false, error: "invalid_host", statusCode: 400 };
    }
    // Validate port after bracket
    const afterBracket = trimmed.slice(bracketEnd + 1);
    if (afterBracket.startsWith(":")) {
      const portStr = afterBracket.slice(1);
      if (portStr && !/^\d+$/.test(portStr)) {
        return { ok: false, error: "invalid_host", statusCode: 400 };
      }
      const portNum = parseInt(portStr, 10);
      if (portStr && (portNum < 1 || portNum > 65535)) {
        return { ok: false, error: "invalid_host", statusCode: 400 };
      }
    } else if (afterBracket.length > 0) {
      // Trailing garbage after bracket that isn't a port
      return { ok: false, error: "invalid_host", statusCode: 400 };
    }
    // Validate the inner IPv6 address is not completely empty
    const inner = trimmed.slice(1, bracketEnd);
    if (inner.length === 0) {
      return { ok: false, error: "invalid_host", statusCode: 400 };
    }
  }

  // ── 4. Port validation for non-bracketed hosts ────────────────────

  // Extract host part (before port)
  let hostPart = trimmed;
  let portPart: string | null = null;

  if (!trimmed.startsWith("[")) {
    const colonCount = (trimmed.match(/:/g) || []).length;
    if (colonCount === 1) {
      const colonIdx = trimmed.indexOf(":");
      const afterColon = trimmed.slice(colonIdx + 1);
      if (/^\d+$/.test(afterColon)) {
        // Looks like host:port
        hostPart = trimmed.slice(0, colonIdx);
        portPart = afterColon;
        const portNum = parseInt(afterColon, 10);
        if (portNum < 1 || portNum > 65535) {
          return { ok: false, error: "invalid_host", statusCode: 400 };
        }
      }
      // If afterColon is not all digits, it might be an IPv6
      // without brackets — we handle that below via isIPv6Literal
    } else if (colonCount > 1) {
      // Multiple colons — likely bare IPv6
      // No port stripping needed here
    }
  }

  // ── 5. Validate hostname syntax (for non-IP hosts) ─────────────────

  if (hostPart.startsWith("[")) {
    // Already validated bracketed IPv6 above
  } else if (isIPv4Literal(hostPart)) {
    // Valid IPv4 — pass through
  } else if (isIPv6Literal(hostPart)) {
    // Valid bare IPv6 — pass through
  } else {
    // Validate as hostname
    if (hostPart.length > 253) {
      return { ok: false, error: "invalid_host", statusCode: 400 };
    }
    // Trailing dot (FQDN notation) — strip it
    if (hostPart.endsWith(".")) {
      hostPart = hostPart.slice(0, -1);
    }
    const segments = hostPart.toLowerCase().split(".");
    for (const seg of segments) {
      if (validateHostnameSegment(seg) === null) {
        return { ok: false, error: "invalid_host", statusCode: 400 };
      }
    }
  }

  // ── 6. Normalize for comparison ───────────────────────────────────
  const normalized = normalizeHost(trimmed);

  // ── 7. DNS rebinding check ────────────────────────────────────────
  if (isDnsRebinding(normalized, allowedHosts)) {
    return { ok: false, error: "invalid_host", statusCode: 403 };
  }

  // ── 8. Allow-list check (exact match, case-insensitive) ───────────
  const allowedLower = allowedHosts.map((h) => h.toLowerCase());
  if (!allowedLower.includes(normalized)) {
    return { ok: false, error: "invalid_host", statusCode: 403 };
  }

  return { ok: true, normalizedHost: normalized };
}
