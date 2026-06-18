/**
 * P4.3-Sb3 — Auth Routes
 *
 * Handles:
 * - POST /api/auth/session  — Exchange a bearer token for an HttpOnly session cookie.
 * - POST /api/auth/logout    — Remove an active session and clear the cookie.
 *
 * Key invariants:
 * - Tokens are accepted only in the request body or Authorization header.
 * - Tokens are never echoed back in responses.
 * - Same-origin policy is enforced (Origin/Referer headers validated).
 * - Rate limiting prevents brute-force attempts.
 * - Bounded body size (10 KB max) prevents DoS.
 * - Cookies are HttpOnly, SameSite=Strict, Path=/, Secure when HTTPS.
 *
 * @module
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuthService } from "../security/inspector/auth-service.js";
import { BrowserSessionStore } from "../security/inspector/browser-session-store.js";
import type { SecureJsonResponder } from "./secure-response.js";
import { parseSessionCookie } from "./cookie-utils.js";
import { derivePermissions } from "./security-middleware.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum request body size for auth routes (10 KB). */
const MAX_BODY_SIZE = 10 * 1024;

/** Session cookie name. */
const SESSION_COOKIE = "alix-session";

/** Rate limit: max attempts per IP per minute for session exchange. */
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_ATTEMPTS = 20;

/** Maximum distinct IPs tracked by the rate limiter (prevents unbounded growth). */
const RATE_LIMIT_MAX_ENTRIES = 10_000;

// ---------------------------------------------------------------------------
// Rate limiter (in-memory, bounded)
// ---------------------------------------------------------------------------

interface RateEntry {
  count: number;
  resetAt: number;
}

const rateLimitMap = new Map<string, RateEntry>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();

  // 1. Purge all entries whose window has expired (keeps the map bounded)
  for (const [key, entry] of rateLimitMap) {
    if (now >= entry.resetAt) {
      rateLimitMap.delete(key);
    }
  }

  // 2. Enforce maximum-entries cap — evict oldest if over limit
  while (rateLimitMap.size >= RATE_LIMIT_MAX_ENTRIES) {
    let oldestKey: string | null = null;
    let oldestResetAt = Infinity;
    for (const [key, entry] of rateLimitMap) {
      if (entry.resetAt < oldestResetAt) {
        oldestResetAt = entry.resetAt;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      rateLimitMap.delete(oldestKey);
    } else {
      break; // safety guard
    }
  }

  // 3. Check / create entry for the current IP
  const entry = rateLimitMap.get(ip);

  if (!entry) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  if (now >= entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  entry.count++;
  return entry.count > RATE_LIMIT_MAX_ATTEMPTS;
}

// ---------------------------------------------------------------------------
// Body reader
// ---------------------------------------------------------------------------

/**
 * Read the request body up to `maxBytes`.
 */
function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;

    let exceeded = false;

    req.on("data", (chunk: Buffer) => {
      if (exceeded) return; // drain remaining data silently
      total += chunk.length;
      if (total > maxBytes) {
        exceeded = true;
        reject(new Error("body_too_large"));
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });

    req.on("error", () => {
      reject(new Error("body_read_error"));
    });
  });
}

// ---------------------------------------------------------------------------
// Same-origin validation
// ---------------------------------------------------------------------------

/**
 * Validate that Origin or Referer headers match the request's Host header.
 *
 * Uses `req.headers.host` (which includes port for non-standard ports) so
 * that same-origin validation works correctly when the server is listening
 * on a port other than 80/443.
 *
 * Returns true if the request appears to be same-origin (including cases
 * where neither header is present, e.g., from curl or native apps).
 */
function isSameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers["origin"];
  const referer = req.headers["referer"];

  // If neither header is present, proceed (non-browser context)
  if (!origin && !referer) return true;

  const hostHeader = req.headers["host"];
  if (!hostHeader) {
    // No Host header — can't validate, allow to proceed
    return true;
  }
  const hostStr = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;

  const expectedOrigin = `http://${hostStr}`;
  const expectedSecureOrigin = `https://${hostStr}`;

  if (origin) {
    const originStr = Array.isArray(origin) ? origin[0] : origin;
    if (originStr !== expectedOrigin && originStr !== expectedSecureOrigin) {
      return false;
    }
    return true;
  }

  if (referer) {
    const refererStr = Array.isArray(referer) ? referer[0] : referer;
    if (!refererStr.startsWith(expectedOrigin) && !refererStr.startsWith(expectedSecureOrigin)) {
      return false;
    }
    return true;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

/**
 * Build a Set-Cookie header value for a session cookie.
 */
function buildSetCookie(sessionId: string, isSecure: boolean): string {
  const parts = [
    `${SESSION_COOKIE}=${sessionId}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
  ];

  if (isSecure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

/**
 * Build an expire-cookie header value (Max-Age=0).
 */
function buildExpireCookie(isSecure: boolean): string {
  const parts = [
    `${SESSION_COOKIE}=`,
    "Max-Age=0",
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
  ];

  if (isSecure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/**
 * Handle POST /api/auth/session — Exchange a bearer token for a session cookie.
 */
export async function handleSessionExchange(
  req: IncomingMessage,
  res: ServerResponse,
  responder: SecureJsonResponder,
  authService: AuthService,
  sessionStore: BrowserSessionStore,
): Promise<void> {
  try {
    // 1. Rate limiting
    const clientIp = req.socket?.remoteAddress ?? "unknown";
    if (isRateLimited(clientIp)) {
      responder.error("rate_limited", 429);
      return;
    }

    // 2. Same-origin check (uses req.headers.host which includes port)
    if (!isSameOrigin(req)) {
      responder.error("cross_origin_denied", 403);
      return;
    }

    // 3. Read body
    let body: string;
    try {
      body = await readBody(req, MAX_BODY_SIZE);
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "body_too_large") {
        responder.error("body_too_large", 413);
      } else {
        responder.error("invalid_request", 400);
      }
      return;
    }

    // 4. Extract token from body or Authorization header
    let rawToken: string | null = null;

    // Try JSON body first
    if (body.length > 0) {
      try {
        const parsed = JSON.parse(body);
        if (typeof parsed.token === "string" && parsed.token.length > 0) {
          rawToken = parsed.token;
        }
      } catch {
        // Not valid JSON — fall through to header check
      }
    }

    // Fall back to Authorization header if no token in body
    if (!rawToken) {
      const authHeader = req.headers["authorization"];
      if (authHeader && !Array.isArray(authHeader)) {
        if (authHeader.startsWith("Bearer ")) {
          const bearerToken: string = authHeader.slice(7);
          if (bearerToken.length > 0) {
            rawToken = bearerToken;
          }
        }
      }
    }

    if (!rawToken) {
      responder.error("missing_token", 400);
      return;
    }

    // 5. Verify the token
    const verifyResult = await authService.verifyToken(rawToken);
    if (!verifyResult.ok) {
      responder.error(verifyResult.error, 401);
      return;
    }

    const principal = verifyResult.value;

    // 6. Create session with derived permissions (Fix I5: store permissions
    //    so cookie auth and bearer auth use the same permission set)
    const sessionPermissions = derivePermissions(principal.role);
    const session = sessionStore.createSession({
      id: principal.id,
      name: principal.name,
      role: principal.role,
      workspaceIds: principal.workspaceIds,
      permissions: sessionPermissions,
    });

    // 7. Determine if connection is secure
    // Check direct TLS (req.socket.encrypted) AND X-Forwarded-Proto for
    // reverse-proxy deployments
    const isSecure =
      (req.socket as any).encrypted ||
      (req.headers["x-forwarded-proto"] as string)?.toLowerCase() === "https";

    // 8. Set cookie
    res.setHeader("Set-Cookie", buildSetCookie(session.id, isSecure));

    // 9. Respond — DO NOT echo the token
    responder.ok({
      role: principal.role,
      expiresAt: session.expiresAt,
    });
  } catch {
    responder.error("internal_error", 500);
  }
}

/**
 * Handle POST /api/auth/logout — Remove session and clear cookie.
 *
 * Idempotent — always returns success even if no session exists.
 */
export async function handleLogout(
  req: IncomingMessage,
  res: ServerResponse,
  responder: SecureJsonResponder,
  sessionStore: BrowserSessionStore,
  onAudit?: (event: { type: string; sessionId: string }) => void,
): Promise<void> {
  try {
    // 1. Parse session cookie
    const sessionId = parseSessionCookie(req);

    // 2. Remove session if it exists and emit audit
    if (sessionId) {
      sessionStore.removeSession(sessionId);
      onAudit?.({ type: "logout", sessionId });
    }

    // 3. Determine secure flag
    // Check direct TLS AND X-Forwarded-Proto for reverse-proxy deployments
    const isSecure =
      (req.socket as any).encrypted ||
      (req.headers["x-forwarded-proto"] as string)?.toLowerCase() === "https";

    // 4. Expire cookie
    res.setHeader("Set-Cookie", buildExpireCookie(isSecure));

    // 5. Respond
    responder.ok({ ok: true });
  } catch {
    responder.error("internal_error", 500);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

