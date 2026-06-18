/**
 * P4.3-Sb1/Sb2/Sc1 — Security Middleware
 *
 * Request-scoped middleware builder.  Creates a middleware function that:
 *
 * 1. Generates a unique request id.
 * 2. Looks up the route descriptor from the registry.
 * 3. Validates origin and fetch metadata (Sc1.2).
 * 4. Validates remote access policy (Sc1.4).
 * 5. Validates bearer token authentication (Sb2).
 * 6. Validates cookie session authentication (Sb3).
 * 7. Applies post-auth rate limiting (Sc1.6).
 * 8. Builds a SecurityContext.
 * 9. Denies unauthenticated requests to authenticated-required routes.
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
import { parseSessionCookie } from "./cookie-utils.js";
import { RateLimiter } from "../security/inspector/rate-limiter.js";
import { ConnectionLimiter } from "../security/inspector/connection-limiter.js";
import {
  type OriginPolicyContext,
  validateRequestOrigin,
} from "../security/inspector/origin-policy.js";
import {
  type RemoteAccessConfig,
  validateRemoteAccess,
} from "../security/inspector/remote-access-policy.js";
import { resolveClientAddress } from "../security/inspector/client-address.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface SecurityMiddlewareConfig {
  /** Canonical host for URL reconstruction. */
  host: string;
  /** Allowed host values. */
  allowedHosts?: string[];
  /** Allowed origin values. */
  allowedOrigins?: string[];
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
  /**
   * Pre-auth rate limiter (Sc1.6).
   * Applied before authentication, keyed by address + route class.
   */
  preAuthLimiter?: RateLimiter;
  /**
   * Post-auth rate limiter (Sc1.6).
   * Applied after authentication, keyed by principal + address + route class.
   */
  postAuthLimiter?: RateLimiter;
  /**
   * Connection limiter (Sc1.7).
   * Applied to SSE routes to bound active connections.
   */
  connectionLimiter?: ConnectionLimiter;
  /**
   * Remote access configuration (Sc1.4).
   * Used to validate remote/TLS policy per-request.
   */
  remoteAccessConfig?: RemoteAccessConfig;
  /**
   * Trusted proxy CIDR ranges for client address resolution (Sc1.3).
   * When configured, the middleware resolves the effective client address
   * from X-Forwarded-For headers when the immediate peer is within a
   * trusted CIDR. Used for rate-limit keying instead of socket address.
   */
  trustedProxyCidrs?: string[];
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
// Middleware factory
// ---------------------------------------------------------------------------

/**
 * Create a request-scoped security middleware function.
 *
 * Call the returned function for every incoming request before routing.
 * It returns a `SecurityContext` that downstream handlers should consume
 * for authorization and secure-response construction.
 *
 * With Sc1 additions, the middleware now:
 * - Validates origin and fetch metadata
 * - Validates remote access policy
 * - Applies pre-auth and post-auth rate limiting
 * - Reserves/releases connection slots for SSE routes
 */
export function createSecurityMiddleware(config: SecurityMiddlewareConfig) {
  const {
    host,
    allowedOrigins,
    registry,
    detector,
    enforceAuth,
    authService,
    sessionStore,
    preAuthLimiter,
    postAuthLimiter,
    connectionLimiter,
    remoteAccessConfig,
    trustedProxyCidrs,
  } = config;

  const effectiveOrigins = allowedOrigins ?? [];

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

    // ── 4. Origin and Fetch Metadata validation (Sc1.2) ────────────
    // Apply origin checks to data routes only.
    // Skip for: health, static, sse, auth (they handle origin internally or don't need it)
    const skipOriginCheck = new Set(["health", "static", "sse", "auth"]);
    if (route && !skipOriginCheck.has(route.routeClass)) {
      const originCtx: OriginPolicyContext = {
        isBearerAuth: false, // not yet determined
        isCookieAuth: false, // not yet determined
        hasCredentials: false, // not yet determined
      };

      // Cookie presence indicates potential cookie auth
      if (sessionStore) {
        const sessionId = parseSessionCookie(req);
        if (sessionId) {
          originCtx.hasCredentials = true;
          originCtx.isCookieAuth = sessionStore.getSession(sessionId) !== null;
        }
      }

      // Bearer presence indicates potential bearer auth
      if (authService) {
        const authHeader = getSingleHeader(req, "authorization");
        if (authHeader?.startsWith("Bearer ")) {
          originCtx.hasCredentials = true;
          originCtx.isBearerAuth = true;
        }
      }

      const originResult = validateRequestOrigin(
        req,
        effectiveOrigins,
        originCtx,
        route.routeClass === "auth" ? "same-origin" : null,
      );

      if (!originResult.ok) {
        const responder = createSecureResponder(res, registry, detector, {
          requestId: ctx.requestId,
        });
        responder.error(originResult.error, originResult.statusCode);
        return null;
      }

      // Apply Vary headers
      if (originResult.varyHeaders?.length) {
        res.setHeader("vary", originResult.varyHeaders.join(", "));
      }
    }

    // ── 5. Remote access validation (Sc1.4) ─────────────────────────
    if (remoteAccessConfig) {
      // Determine auth state for remote access check
      let isBearerForRemote = false;
      let isCookieForRemote = false;

      if (sessionStore) {
        const preSessionId = parseSessionCookie(req);
        if (preSessionId && sessionStore.getSession(preSessionId)) {
          isCookieForRemote = true;
        }
      }

      if (authService) {
        const preAuthHeader = getSingleHeader(req, "authorization");
        if (preAuthHeader?.startsWith("Bearer ")) {
          isBearerForRemote = true;
        }
      }

      const remoteResult = validateRemoteAccess(
        req,
        remoteAccessConfig,
        isBearerForRemote,
        isCookieForRemote,
      );

      if (!remoteResult.ok) {
        const responder = createSecureResponder(res, registry, detector, {
          requestId: ctx.requestId,
        });
        responder.error(remoteResult.error, remoteResult.statusCode);
        return null;
      }
    }

    // ── 6. Pre-auth rate limiting (Sc1.6) ───────────────────────────
    if (preAuthLimiter && route) {
      const resolvedAddr = resolveClientAddress(req, trustedProxyCidrs ?? []);
      const { buildRateLimitKey } =
        await import("../security/inspector/rate-limiter.js");
      const preAuthKey = buildRateLimitKey(resolvedAddr.address, route.routeClass);

      const preAuthResult = preAuthLimiter.consume(preAuthKey);
      if (!preAuthResult.allowed) {
        const responder = createSecureResponder(res, registry, detector, {
          requestId: ctx.requestId,
        });
        // Apply rate-limit headers
        const { buildRateLimitHeaders } =
          await import("../security/inspector/rate-limiter.js");
        const headers = buildRateLimitHeaders(
          preAuthResult,
          30, // pre-auth burst
        );
        for (const [k, v] of Object.entries(headers)) {
          res.setHeader(k, v);
        }
        responder.error("rate_limited", 429);
        return null;
      }
    }

    // ── 7. Session cookie authentication (Sb3) ──────────────────────
    if (sessionStore) {
      const sessionId = parseSessionCookie(req);
      if (sessionId) {
        const session = sessionStore.getSession(sessionId);
        if (session) {
          ctx = createSecurityContext({
            authenticated: true,
            tokenId: session.principal.id,
            permissions:
              session.principal.permissions ??
              derivePermissions(session.principal.role),
            route,
          });
        }
      }
    }

    // ── 8. Bearer token authentication (Sb2) ────────────────────────
    if (authService && !ctx.authenticated) {
      const bearerResult = extractBearerToken(req, url);

      if (!bearerResult.ok) {
        const responder = createSecureResponder(res, registry, detector, {
          requestId: ctx.requestId,
        });
        responder.error(bearerResult.error, bearerResult.statusCode);
        return null;
      }

      if (bearerResult.token) {
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
          if (enforceAuth && route && !registry.isPublic(route)) {
            const responder = createSecureResponder(res, registry, detector, {
              requestId: ctx.requestId,
            });
            responder.error(verifyResult.error, 401);
            return null;
          }
        }
      }
    }

    // ── 9. Post-auth rate limiting (Sc1.6) ──────────────────────────
    if (postAuthLimiter && route && ctx.authenticated) {
      const resolvedAddr = resolveClientAddress(req, trustedProxyCidrs ?? []);
      const { buildRateLimitKey } =
        await import("../security/inspector/rate-limiter.js");
      const principal = ctx.tokenId ?? "anonymous";
      const postAuthKey = buildRateLimitKey(
        principal,
        resolvedAddr.address,
        route.routeClass,
      );

      const postAuthResult = postAuthLimiter.consume(postAuthKey);
      if (!postAuthResult.allowed) {
        const responder = createSecureResponder(res, registry, detector, {
          requestId: ctx.requestId,
        });
        const { buildRateLimitHeaders } =
          await import("../security/inspector/rate-limiter.js");
        const headers = buildRateLimitHeaders(
          postAuthResult,
          100, // post-auth burst
        );
        for (const [k, v] of Object.entries(headers)) {
          res.setHeader(k, v);
        }
        responder.error("rate_limited", 429);
        return null;
      }
    }

    // ── 10. Authorization check ─────────────────────────────────────
    if (enforceAuth && route) {
      const result = authorize(ctx, route);
      if (!result.ok) {
        const responder = createSecureResponder(res, registry, detector, {
          requestId: ctx.requestId,
        });
        responder.error(result.error, result.statusCode);
        return null;
      }
    }

    // ── 11. SSE Connection limiting (Sc1.7) ─────────────────────────
    // Connection reservation happens at the route handler level
    // in server.ts, using the token returned here. We attach the
    // connectionLimiter to the context so SSE handlers can use it.

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
export function derivePermissions(role: string): string[] {
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
      break;
  }

  return permissions;
}

function getSingleHeader(req: IncomingMessage, name: string): string | undefined {
  const val = req.headers[name];
  if (!val) return undefined;
  return Array.isArray(val) ? val[0] : val;
}
