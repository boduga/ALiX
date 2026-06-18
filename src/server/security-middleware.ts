/**
 * P4.3-Sb1 / Sb2 — Security Middleware
 *
 * Request-scoped middleware builder.  Creates a middleware function that:
 *
 * 1. Generates a unique request id.
 * 2. Looks up the route descriptor from the registry.
 * 3. Validates bearer token authentication (Sb2).
 * 4. Builds a SecurityContext.
 * 5. Denies unauthenticated requests to authenticated-required routes.
 *
 * The returned context is forwarded to route handlers for authorization
 * and secure response construction.
 *
 * @module
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import {
  type SecurityContext,
  createSecurityContext,
} from "../security/inspector/security-context.js";
import type { RoutePolicyRegistry } from "../security/inspector/route-policy.js";
import { authorize } from "../security/inspector/authorization.js";
import { SecretDetector } from "../security/redaction/secret-detector.js";
import { createSecureResponder } from "./secure-response.js";
import type { AuthService } from "../security/inspector/auth-service.js";
import { BrowserSessionStore } from "../security/inspector/browser-session-store.js";
import { parseToken } from "../security/inspector/token-format.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface SecurityMiddlewareConfig {
  /** Canonical host for URL reconstruction. */
  host: string;
  /** Allowed host values (for logging, not validated here). */
  allowedHosts?: string[];
  /** The route policy registry (with all routes registered). */
  registry: RoutePolicyRegistry;
  /** Pre-configured secret detector. */
  detector: SecretDetector;
  /**
   * When true, deny unauthenticated requests to authenticated routes.
   * Default: false (Sb1 — infrastructure only, enforcement deferred to Sb2).
   */
  enforceAuth?: boolean;
  /**
   * Auth service for bearer token validation (Sb2).
   * When provided, the middleware will parse Authorization headers and
   * set `authenticated: true` on the SecurityContext for valid tokens.
   */
  authService?: AuthService;
  /**
   * Browser session store for cookie-based authentication (Sb3).
   * When provided, the middleware will parse the ALiX session cookie
   * and authenticate requests with valid sessions.
   */
  sessionStore?: BrowserSessionStore;
}

// ---------------------------------------------------------------------------
// Bearer token extraction
// ---------------------------------------------------------------------------

/**
 * Extract and validate a Bearer token from the Authorization header.
 *
 * Rejects:
 * - Multiple Authorization headers
 * - Non-Bearer schemes
 * - Tokens in query strings
 *
 * Returns the raw token string, or null if no Authorization header is present.
 * Returns an error string on invalid format (for use in rejection responses).
 */
type BearerResult =
  | { ok: true; token: string }
  | { ok: false; error: string; statusCode: number }
  | { ok: true; token: null }; // no auth header present

function extractBearerToken(req: IncomingMessage, url: URL): BearerResult {
  // 1. Reject tokens in query strings
  const rawQueryToken = url.searchParams.get("token")
    ?? url.searchParams.get("access_token")
    ?? url.searchParams.get("bearer");
  if (rawQueryToken) {
    return { ok: false, error: "token_in_query_string", statusCode: 400 };
  }

  // 2. Get Authorization header
  const authHeader = req.headers["authorization"];

  // No auth header — not an error, just unauthenticated
  if (!authHeader || authHeader === "") {
    return { ok: true, token: null };
  }

  // 3. Reject multiple Authorization headers
  if (Array.isArray(authHeader)) {
    return { ok: false, error: "multiple_auth_headers", statusCode: 400 };
  }

  // 4. Must be Bearer scheme
  if (!authHeader.startsWith("Bearer ")) {
    return { ok: false, error: "unsupported_auth_scheme", statusCode: 401 };
  }

  const token = authHeader.slice(7); // after "Bearer "

  // 5. Reject empty token
  if (token.length === 0) {
    return { ok: false, error: "empty_token", statusCode: 401 };
  }

  return { ok: true, token };
}

// ---------------------------------------------------------------------------
// Session cookie parsing (Sb3)
// ---------------------------------------------------------------------------

/** Session cookie name. */
const SESSION_COOKIE = "alix-session";

/**
 * Parse the ALiX session cookie from the Cookie header.
 *
 * Returns the session ID or null if not found.
 */
function parseSessionCookie(req: IncomingMessage): string | null {
  const cookieHeader = req.headers["cookie"];
  if (!cookieHeader) return null;

  const cookieStr = Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader;

  // Parse: alix-session=<value>
  const match = cookieStr.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  if (match) {
    const value = match[1];
    if (value.length > 0) return value;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

/**
 * Create a request-scoped security middleware function.
 *
 * Call the returned function for every incoming request before routing.
 * It returns a `SecurityContext` that downstream handlers should consume
 * for authorization and secure-response construction.
 *
 * With Sb2, if `authService` is provided, the middleware will:
 * 1. Extract and validate Bearer tokens from the Authorization header.
 * 2. Verify tokens against the auth store.
 * 3. Set `authenticated: true`, `tokenId`, and `permissions` on the context.
 *
 * With Sb3, if `sessionStore` is provided, the middleware will:
 * 1. Parse the ALiX session cookie from the Cookie header.
 * 2. Look up the session in the store.
 * 3. Set `authenticated: true`, `tokenId`, and `permissions` for valid sessions.
 *
 * If the request is denied (unauthenticated for an auth-required route,
 * or invalid auth), the function sends a structured error response and
 * returns `null`.
 */
export function createSecurityMiddleware(config: SecurityMiddlewareConfig) {
  const { host, registry, detector, enforceAuth, authService, sessionStore } = config;

  return async function securityMiddleware(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<SecurityContext | null> {
    // 1. Parse URL
    const url = new URL(req.url ?? "/", `http://${host}`);
    const pathname = url.pathname;
    const method = req.method ?? "GET";

    // 2. Look up route descriptor
    const route = registry.get(pathname, method) ?? null;

    // 3. Create base security context (unauthenticated by default)
    let ctx = createSecurityContext({ route });

    // 4. Session cookie authentication (Sb3) — takes priority over Bearer
    if (sessionStore) {
      const sessionId = parseSessionCookie(req);
      if (sessionId) {
        const session = sessionStore.getSession(sessionId);
        if (session) {
          ctx = createSecurityContext({
            authenticated: true,
            tokenId: session.principal.id,
            permissions: derivePermissions(session.principal.role),
            route,
          });
        }
      }
    }

    // 5. Bearer token authentication (Sb2) — fallback if no valid session
    if (authService && !ctx.authenticated) {
      const bearerResult = extractBearerToken(req, url);

      if (!bearerResult.ok) {
        // Invalid auth format — reject immediately
        const responder = createSecureResponder(res, registry, detector, {
          requestId: ctx.requestId,
        });
        responder.error(bearerResult.error, bearerResult.statusCode);
        return null;
      }

      if (bearerResult.token) {
        // Attempt to verify the token
        const verifyResult = await authService.verifyToken(bearerResult.token);

        if (verifyResult.ok) {
          const principal = verifyResult.value;
          ctx = createSecurityContext({
            authenticated: true,
            tokenId: principal.id,
            permissions: derivePermissions(principal.role),
            route,
          });
        } else {
          // Token verification failed
          // If enforcement is on, reject with 401
          if (enforceAuth && route && !registry.isPublic(route)) {
            const responder = createSecureResponder(res, registry, detector, {
              requestId: ctx.requestId,
            });
            responder.error(verifyResult.error, 401);
            return null;
          }
          // Otherwise, leave ctx as unauthenticated (authorize() will handle it)
        }
      }
    }

    // 6. If enforcement is active, check authorization
    if (enforceAuth && route) {
      const result = authorize(ctx, route);
      if (!result.ok) {
        // Deny — send structured error via secure responder
        const responder = createSecureResponder(res, registry, detector, {
          requestId: ctx.requestId,
        });
        responder.error(result.error, result.statusCode);
        return null;
      }
    }

    // Unknown route — let the request continue to 404 handler
    return ctx;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derive permissions from a token role.
 *
 * Uses a closed vocabulary — no dynamic permission generation.
 */
function derivePermissions(role: string): string[] {
  const permissions: string[] = [];
  permissions.push("health:read");

  switch (role) {
    case "admin":
      permissions.push(
        "graphs:read",
        "registry:read",
        "policy:read",
        "daemon:read",
        "approvals:read",
        "runtime:read",
        "audit:read",
        "sessions:read",
        "observability:read",
        "coordination:read",
      );
      break;
    case "operator":
      permissions.push(
        "graphs:read",
        "registry:read",
        "daemon:read",
        "runtime:read",
        "audit:read",
        "sessions:read",
        "observability:read",
        "coordination:read",
      );
      break;
    case "readonly":
      permissions.push(
        "graphs:read",
        "registry:read",
        "audit:read",
        "sessions:read",
        "observability:read",
        "coordination:read",
      );
      break;
    default:
      // Unknown role — only health:read
      break;
  }

  return permissions;
}
