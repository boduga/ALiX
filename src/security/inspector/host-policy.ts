/**
 * host-policy.ts — Host header validation for the ALiX Inspector.
 *
 * Validates that incoming HTTP requests carry an approved Host header
 * before any route processing occurs. Prevents Host header injection
 * and DNS rebinding attacks against the local Inspector.
 */

export type HostPolicyResult =
  | { ok: true; normalizedHost: string }
  | { ok: false; error: string; statusCode: number };

/**
 * Normalize a raw Host header value:
 * - Takes the first value if array
 * - Trims whitespace
 * - Strips port (including IPv6 [::1]:port)
 * - Lowercases
 * - Removes IPv6 brackets
 */
export function normalizeHost(raw: string): string {
  let host = raw
    .split(",")[0]          // take first if multiple
    .trim()
    .toLowerCase();

  // Strip port from IPv6 [::1]:port
  if (host.startsWith("[")) {
    const bracketEnd = host.indexOf("]");
    if (bracketEnd !== -1) {
      const inner = host.slice(1, bracketEnd);
      // Strip the port after the bracket if present
      const afterBracket = host.slice(bracketEnd + 1);
      if (afterBracket.startsWith(":")) {
        host = inner;
      } else {
        host = inner;
      }
    }
  } else {
    // Strip port from host:port — but NOT for bare IPv6 addresses (multiple colons)
    const colonCount = (host.match(/:/g) || []).length;
    if (colonCount <= 1) {
      const colonIdx = host.lastIndexOf(":");
      if (colonIdx !== -1) {
        // Check that everything after colon is digits (port)
        const afterColon = host.slice(colonIdx + 1);
        if (/^\d+$/.test(afterColon)) {
          host = host.slice(0, colonIdx);
        }
      }
    }
  }

  return host;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

/**
 * Validate the Host header against the allowed hosts list.
 *
 * Returns `{ ok: true, normalizedHost }` when the host is approved.
 * Returns `{ ok: false, error, statusCode }` with a stable error
 * that does not include the rejected raw Host value.
 */
export function validateHost(
  hostHeader: string | string[] | undefined,
  allowedHosts: string[],
): HostPolicyResult {
  if (!hostHeader || (Array.isArray(hostHeader) && hostHeader.length === 0)) {
    return {
      ok: false,
      error: "invalid_host",
      statusCode: 400,
    };
  }

  const raw = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;
  const trimmed = raw.trim();

  if (!trimmed) {
    return {
      ok: false,
      error: "invalid_host",
      statusCode: 400,
    };
  }

  // Validate port if present
  if (trimmed.includes(":")) {
    // For IPv6 with brackets, validate port after the bracket
    if (trimmed.startsWith("[")) {
      const bracketEnd = trimmed.indexOf("]");
      if (bracketEnd === -1) {
        return { ok: false, error: "invalid_host", statusCode: 400 };
      }
      const afterBracket = trimmed.slice(bracketEnd + 1);
      if (afterBracket.startsWith(":")) {
        const portStr = afterBracket.slice(1);
        if (portStr && !/^\d+$/.test(portStr)) {
          return { ok: false, error: "invalid_host", statusCode: 400 };
        }
      }
    } else {
      // host:port — validate port part
      const lastColon = trimmed.lastIndexOf(":");
      const afterColon = trimmed.slice(lastColon + 1);
      if (/^\d+$/.test(afterColon)) {
        // Numeric port — valid, continue to allow-list match
      } else if (afterColon.includes(".") || afterColon === "com" || afterColon === "org" || afterColon === "net" || /[a-zA-Z]/.test(afterColon)) {
        // Not a numeric port — assume it's part of hostname (could be IPv6 without brackets)
        // Pass through to host check
      } else {
        // Non-numeric and not hostname-like — malformed port
        return { ok: false, error: "invalid_host", statusCode: 400 };
      }
    }
  }

  const normalized = normalizeHost(trimmed);

  // Check if it's a loopback host (always allowed by default)
  if (LOOPBACK_HOSTS.has(normalized)) {
    return { ok: true, normalizedHost: normalized };
  }

  // Check against the allowed list
  const allowedLower = allowedHosts.map(h => h.toLowerCase());
  if (allowedLower.includes(normalized) || allowedLower.includes("*")) {
    return { ok: true, normalizedHost: normalized };
  }

  // Reject with stable error — do NOT include the raw host
  return {
    ok: false,
    error: "invalid_host",
    statusCode: 403,
  };
}
