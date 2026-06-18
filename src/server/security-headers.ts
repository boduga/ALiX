/**
 * security-headers.ts — Baseline security headers for the ALiX Inspector.
 *
 * Applies a consistent set of security headers to all HTTP responses
 * from the Inspector server. SSE endpoints override cache-control
 * with no-cache as required by the SSE spec.
 */

import type { ServerResponse } from "node:http";

/** Default security headers applied to every response. */
export const BASE_SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=(), display-capture=(), fullscreen=(), geolocation=(), microphone=(), usb=()",
  "cross-origin-resource-policy": "same-origin",
  "content-security-policy": "default-src 'self'; frame-ancestors 'none'; base-uri 'self'",
  "x-frame-options": "DENY",
  "x-xss-protection": "0",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "cache-control": "no-store",
};

/**
 * Apply security headers to a ServerResponse.
 * Skips headers already set (e.g. SSE maintains its own Cache-Control).
 */
export function applySecurityHeaders(res: ServerResponse): void {
  for (const [key, value] of Object.entries(BASE_SECURITY_HEADERS)) {
    if (!res.hasHeader(key)) {
      res.setHeader(key, value);
    }
  }
}

/**
 * Apply API-specific security headers (Cache-Control: no-store for API responses).
 */
export const API_CACHE_HEADERS: Record<string, string> = {
  "cache-control": "no-store",
};
