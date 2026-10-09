/**
 * P4.3-Sb3 — Shared cookie parsing utilities.
 *
 * Provides a single canonical `parseSessionCookie` function used by both
 * the session-exchange handler and the security middleware, avoiding the
 * code duplication of two independent implementations.
 *
 * @module
 */

import type { IncomingMessage } from "node:http";

/** Session cookie name. */
const SESSION_COOKIE = "alix-session";

/**
 * Parse the ALiX session cookie from the Cookie header.
 *
 * Returns the session ID string, or null if no valid session cookie is
 * present in the request.
 */
export function parseSessionCookie(req: IncomingMessage): string | null {
  const cookieHeader = req.headers["cookie"];
  if (!cookieHeader) return null;

  const cookieStr = Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader;

  const match = cookieStr.match(
    new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`),
  );
  if (match) {
    const value = match[1];
    if (value.length > 0) return value;
  }

  return null;
}
