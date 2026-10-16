/**
 * P4.3-Sb1 — Security Context
 *
 * Request-scoped security context passed through the route handler chain.
 * Carries authentication state, matched route descriptor, and a unique
 * request id for error correlation.
 *
 * @module
 */

import type { RouteDescriptor } from "./route-policy.js";

// ---------------------------------------------------------------------------
// SecurityContext
// ---------------------------------------------------------------------------

/**
 * Request-scoped security context.
 *
 * Created by the security middleware at the start of every request and
 * forwarded to route handlers with current credential permissions and scope.
 */
export interface SecurityContext {
  /** Unique request identifier (UUID v4). */
  requestId: string;

  /** Whether the request carries valid authentication. */
  authenticated: boolean;

  /** Authentication token identifier (set when authenticated). */
  tokenId?: string;

  /**
   * Operator principal bound to this credential, when bound (G3-A′). Absent for
   * a genuinely unbound legacy credential. Read fresh per request.
   */
  principalId?: string;

  /** Current credential scope: undefined is legacy; [] grants no workspace. */
  workspaceIds?: string[];

  /**
   * How the request authenticated. `bearer` = Authorization header; `cookie` =
   * browser session. The remote-decision endpoint is bearer-only, so it denies
   * cookie-authenticated requests.
   */
  authTransport?: "bearer" | "cookie";

  /** Granted permissions (set when authenticated). */
  permissions: string[];

  /** The route descriptor matched for this request, or null. */
  route: RouteDescriptor | null;

  /** High-resolution monotonic start time (ms). */
  startTime: number;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

let seq = 0;

/**
 * Create a new SecurityContext with sensible defaults.
 *
 * The caller should set `route` from the registry lookup result.
 */
export function createSecurityContext(opts?: {
  authenticated?: boolean;
  tokenId?: string;
  principalId?: string;
  permissions?: string[];
  workspaceIds?: string[];
  authTransport?: "bearer" | "cookie";
  route?: RouteDescriptor | null;
}): SecurityContext {
  return {
    requestId: generateRequestId(),
    authenticated: opts?.authenticated ?? false,
    tokenId: opts?.tokenId,
    principalId: opts?.principalId,
    workspaceIds: opts?.workspaceIds === undefined ? undefined : [...opts.workspaceIds],
    authTransport: opts?.authTransport,
    permissions: opts?.permissions ?? [],
    route: opts?.route ?? null,
    startTime: performance.now(),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a compact, sortable request id:
 * `alx-{timestamp}-{seq}-{random}`.
 */
function generateRequestId(): string {
  seq = (seq + 1) & 0xffff;
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `alx-${ts}-${seq.toString(16)}-${rand}`;
}
