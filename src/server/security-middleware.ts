/**
 * P4.3-Sb1 — Security Middleware
 *
 * Request-scoped middleware builder.  Creates a middleware function that:
 *
 * 1. Generates a unique request id.
 * 2. Looks up the route descriptor from the registry.
 * 3. Builds a SecurityContext.
 * 4. Denies unauthenticated requests to authenticated-required routes.
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

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface SecurityMiddlewareConfig {
  /** Canonical host for URL reconstruction. */
  host: string;
  /** Allowed host values (for logging, not validated here). */
  allowedHosts?: string[];
  /** The route policy registry (with all 33 routes registered). */
  registry: RoutePolicyRegistry;
  /** Pre-configured secret detector. */
  detector: SecretDetector;
  /**
   * When true, deny unauthenticated requests to authenticated routes.
   * Default: false (Sb1 — infrastructure only, enforcement deferred to Sb2).
   */
  enforceAuth?: boolean;
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
 * If the request is denied (unauthenticated for an auth-required route),
 * the function sends a 401 response and returns `null`.
 */
export function createSecurityMiddleware(config: SecurityMiddlewareConfig) {
  const { host, registry, detector, enforceAuth } = config;

  return function securityMiddleware(
    req: IncomingMessage,
    res: ServerResponse,
  ): SecurityContext | null {
    // 1. Parse URL
    const url = new URL(req.url ?? "/", `http://${host}`);
    const pathname = url.pathname;
    const method = req.method ?? "GET";

    // 2. Look up route descriptor
    const route = registry.get(pathname, method) ?? null;

    // 3. Create security context (authenticated: false — Sb2 adds real auth)
    const ctx = createSecurityContext({ route });

    // 4. If enforcement is active, check authorization
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
