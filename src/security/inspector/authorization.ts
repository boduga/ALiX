/**
 * P4.3-Sb1 — Authorization
 *
 * Authorize a request against a route descriptor using the
 * request-scoped SecurityContext.
 *
 * Follows the HostPolicyResult discriminated-union pattern:
 *   { ok: true } | { ok: false; error: string; statusCode: number }
 *
 * Rules:
 * - Public routes → always authorized.
 * - Authenticated routes → check context.authenticated.
 * - Permission check → verify route.permission is in context.permissions.
 * - Fail closed: any error in authorization logic results in deny.
 *
 * @module
 */

import type { SecurityContext } from "./security-context.js";
import type { RouteDescriptor } from "./route-policy.js";

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type AuthorizationResult =
  | { ok: true }
  | { ok: false; error: string; statusCode: number };

// ---------------------------------------------------------------------------
// Authorize
// ---------------------------------------------------------------------------

/**
 * Authorize a request against a route descriptor.
 *
 * Always returns a result — never throws.
 */
export function authorize(
  context: SecurityContext,
  route: RouteDescriptor,
): AuthorizationResult {
  try {
    // 1. Public routes — always allow
    if (route.auth === "public") {
      return { ok: true };
    }

    // 2. SSE routes — allow (streaming endpoints handle their own auth in Sb2)
    if (route.auth === "sse") {
      return { ok: true };
    }

    // 3. Authenticated routes — require valid auth
    if (route.auth === "authenticated") {
      if (!context.authenticated) {
        return {
          ok: false,
          error: "authentication_required",
          statusCode: 401,
        };
      }

      // 4. Permission check (if route declares a required permission)
      if (route.permission && route.permission.length > 0) {
        if (!context.permissions.includes(route.permission)) {
          return {
            ok: false,
            error: "insufficient_permissions",
            statusCode: 403,
          };
        }
      }

      return { ok: true };
    }

    // 5. Unknown auth mode — fail closed
    return {
      ok: false,
      error: "unknown_auth_mode",
      statusCode: 500,
    };
  } catch {
    // Fail closed — any error in authorization logic results in deny
    return {
      ok: false,
      error: "authorization_error",
      statusCode: 500,
    };
  }
}
