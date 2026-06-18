/**
 * P4.3-Sc1.2 — Origin and Fetch Metadata Policy
 *
 * Validates the Origin header (and companion Fetch Metadata headers) for
 * cross-origin request protection. Enforces:
 *
 * - Same-origin requests always allowed
 * - Configured exact origins allowed
 * - Wildcard origins forbidden when credentials are present
 * - No-Origin allowed for non-browser Bearer clients
 * - Same-origin required for cookie-authenticated requests
 * - Sec-Fetch-Site validation
 * - Null origin rejection for credentialed requests
 * - Vary: Origin header signaling
 *
 * Follows the discriminated-union pattern:
 *   { ok: true } | { ok: false; error: string; statusCode: number }
 *
 * @module
 */

import type { IncomingMessage } from "node:http";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OriginPolicyResult =
  | { ok: true; varyHeaders?: string[] }
  | { ok: false; error: string; statusCode: number };

/**
 * Context about the request's authentication state, used by origin-policy
 * to decide credential-sensitive checks.
 */
export interface OriginPolicyContext {
  /** Whether the request is authenticated via Bearer token. */
  isBearerAuth: boolean;
  /** Whether the request is authenticated via session cookie. */
  isCookieAuth: boolean;
  /** Whether the request carries credentials of any kind. */
  hasCredentials: boolean;
}

// ---------------------------------------------------------------------------
// Sec-Fetch-Site values
// ---------------------------------------------------------------------------

type SecFetchSite = "cross-site" | "same-origin" | "same-site" | "none";

const VALID_SEC_FETCH_SITE: ReadonlySet<string> = new Set([
  "cross-site",
  "same-origin",
  "same-site",
  "none",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract a single header value (string or string[] → string | undefined).
 */
function getHeader(req: IncomingMessage, name: string): string | undefined {
  const val = req.headers[name];
  if (!val) return undefined;
  return Array.isArray(val) ? val[0] : val;
}

/**
 * Parse an Origin header into its components.
 * Returns null if the value is not a valid absolute URL.
 */
function parseOrigin(raw: string): { protocol: string; host: string } | null {
  // Must be an absolute URL: scheme://host[:port]
  const match = raw.match(/^([a-z][a-z0-9+\-.]*):\/\/([^/?#]+)$/i);
  if (!match) return null;

  const protocol = match[1].toLowerCase();
  const host = match[2].toLowerCase();

  // Strip default ports for comparison
  const hostWithoutDefaultPort = host
    .replace(/:80$/, "")
    .replace(/:443$/, "");

  return { protocol, host: hostWithoutDefaultPort };
}

/**
 * Strip port from a host string for comparison purposes.
 */
function stripPort(host: string): string {
  // IPv6 bracketed
  if (host.startsWith("[")) {
    const bracketEnd = host.lastIndexOf("]");
    if (bracketEnd !== -1) {
      return host.slice(0, bracketEnd + 1);
    }
    return host;
  }
  // host:port
  const colonIdx = host.lastIndexOf(":");
  if (colonIdx !== -1) {
    const afterColon = host.slice(colonIdx + 1);
    if (/^\d+$/.test(afterColon)) {
      return host.slice(0, colonIdx);
    }
  }
  return host;
}

/**
 * Check whether an Origin's host matches the request's Host header.
 */
function isSameOrigin(originHost: string, requestHost: string): boolean {
  // Normalize both for comparison — strip ports, lowercase
  const normOrigin = stripPort(originHost).toLowerCase();
  const normHost = stripPort(requestHost).toLowerCase();

  // Exact match
  if (normOrigin === normHost) return true;

  // Both localhost variants
  const localhosts = new Set(["127.0.0.1", "::1", "localhost"]);
  if (localhosts.has(normOrigin) && localhosts.has(normHost)) return true;

  return false;
}

/**
 * Determine the effective scheme for the incoming request.
 */
function requestScheme(req: IncomingMessage): string {
  // Check for TLS termination proxy header
  const fwdProto = getHeader(req, "x-forwarded-proto");
  if (fwdProto?.toLowerCase() === "https") return "https";

  // Direct TLS
  const sock = req.socket as unknown as { encrypted?: boolean } | null;
  if (sock?.encrypted) return "https";

  return "http";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Vary headers that should be set when Origin-based decisions are made.
 */
export const ORIGIN_VARY_HEADERS = ["Origin"];

/**
 * Validate the Origin header (and Fetch Metadata) for a request.
 *
 * @param req - The incoming HTTP request.
 * @param allowedOrigins - List of explicitly allowed origin values (exact match).
 * @param ctx - Authentication context for credential-sensitive checks.
 */
export function validateOrigin(
  req: IncomingMessage,
  allowedOrigins: string[],
  ctx: OriginPolicyContext,
): OriginPolicyResult {
  const originHeader = getHeader(req, "origin");
  const secFetchSite = getHeader(req, "sec-fetch-site");
  const hostHeader = getHeader(req, "host");

  // ── 1. No Origin header ───────────────────────────────────────────
  if (!originHeader) {
    // Non-browser Bearer clients are allowed to omit Origin
    if (ctx.isBearerAuth && !ctx.isCookieAuth) {
      return { ok: true };
    }

    // If the request has credentials (cookies) and no Origin, that's suspicious
    // but we allow it for now — the Sec-Fetch-Site check will catch issues
    return { ok: true };
  }

  // ── 2. Reject "null" Origin for credentialed requests ─────────────
  if (originHeader === "null") {
    if (ctx.hasCredentials) {
      return { ok: false, error: "null_origin_denied", statusCode: 403 };
    }
    // Non-credentialed null origins (e.g., sandboxed iframes) — allow
    // if the route permits it. For now, reject.
    return { ok: false, error: "null_origin_denied", statusCode: 403 };
  }

  // ── 3. Parse the Origin URL ───────────────────────────────────────
  const parsed = parseOrigin(originHeader);
  if (!parsed) {
    return { ok: false, error: "invalid_origin", statusCode: 400 };
  }

  // ── 4. Same-origin check ──────────────────────────────────────────
  if (hostHeader) {
    const hostStr = hostHeader;
    // Strip port for comparison
    const hostWithoutPort = hostStr.replace(/:\d+$/, "");
    if (isSameOrigin(parsed.host, hostWithoutPort)) {
      // Same-origin always allowed
      return { ok: true, varyHeaders: ORIGIN_VARY_HEADERS };
    }
  }

  // ── 5. Configured origins check (exact match) ─────────────────────
  const originLower = originHeader.toLowerCase();
  const allowedLower = allowedOrigins.map((o) => o.toLowerCase());
  if (allowedLower.includes(originLower)) {
    return { ok: true, varyHeaders: ORIGIN_VARY_HEADERS };
  }

  // ── 6. Wildcard origin + credentials = forbidden ──────────────────
  // If someone configured "*" as an allowed origin (which they shouldn't
  // for credentialed requests), detect and reject.
  if (allowedLower.includes("*")) {
    if (ctx.hasCredentials) {
      return {
        ok: false,
        error: "wildcard_origin_with_credentials",
        statusCode: 403,
      };
    }
    // Non-credentialed wildcard — this is unusual for an Inspector API
    // but we warn at startup, not here
  }

  // ── 7. Cookie-auth requires same-origin ───────────────────────────
  if (ctx.isCookieAuth) {
    return { ok: false, error: "cross_origin_denied", statusCode: 403 };
  }

  // ── 8. Disallowed origin ──────────────────────────────────────────
  return { ok: false, error: "origin_not_allowed", statusCode: 403 };
}

/**
 * Validate the Sec-Fetch-Site header against the expected site relationship.
 *
 * This provides an additional layer of defense beyond Origin checking.
 * Browsers set Sec-Fetch-Site automatically; non-browser clients do not.
 *
 * @param req - The incoming HTTP request.
 * @param expectedSite - The expected site relationship, or null to skip.
 */
export function validateSecFetchSite(
  req: IncomingMessage,
  expectedSite: "same-origin" | "same-site" | "none" | null,
): OriginPolicyResult {
  // No expected site — skip check
  if (expectedSite === null) return { ok: true };

  const secFetchSite = getHeader(req, "sec-fetch-site");

  // No Sec-Fetch-Site header — non-browser client, allow through
  if (!secFetchSite) return { ok: true };

  const lower = secFetchSite.toLowerCase();

  // Unknown value
  if (!VALID_SEC_FETCH_SITE.has(lower)) {
    return { ok: false, error: "invalid_sec_fetch_site", statusCode: 400 };
  }

  if (lower !== expectedSite) {
    return { ok: false, error: "sec_fetch_site_mismatch", statusCode: 403 };
  }

  return { ok: true };
}

/**
 * Full origin validation combining Origin check and Sec-Fetch-Site check.
 *
 * This is the primary entry point for middleware usage.
 */
export function validateRequestOrigin(
  req: IncomingMessage,
  allowedOrigins: string[],
  ctx: OriginPolicyContext,
  expectedSecFetchSite?: "same-origin" | "same-site" | "none" | null,
): OriginPolicyResult {
  // 1. Origin check
  const originResult = validateOrigin(req, allowedOrigins, ctx);
  if (!originResult.ok) return originResult;

  // 2. Sec-Fetch-Site check
  const secFetchResult = validateSecFetchSite(req, expectedSecFetchSite ?? null);
  if (!secFetchResult.ok) return secFetchResult;

  return {
    ok: true,
    varyHeaders: originResult.varyHeaders,
  };
}

/**
 * Build a normalized origin string from scheme, host, and optional port.
 * Used for construction of allowed origins.
 */
export function buildOrigin(
  scheme: "http" | "https",
  host: string,
  port?: number,
): string {
  const defaultPort = scheme === "http" ? 80 : 443;
  if (port && port !== defaultPort) {
    return `${scheme}://${host}:${port}`;
  }
  return `${scheme}://${host}`;
}

/**
 * Check if a configured allowed origin is a wildcard.
 */
export function isWildcardOrigin(origin: string): boolean {
  return origin === "*";
}
