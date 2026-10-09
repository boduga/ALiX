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
 * forwarded to route handlers.  The `authenticated` and `permissions`
 * fields are currently stubs (always false / empty) — real auth arrives
 * in Sb2.
 */
export interface SecurityContext {
  /** Unique request identifier (UUID v4). */
  requestId: string;

  /** Whether the request carries valid authentication. */
  authenticated: boolean;

  /** Authentication token identifier (set when authenticated). */
  tokenId?: string;

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
  permissions?: string[];
  route?: RouteDescriptor | null;
}): SecurityContext {
  return {
    requestId: generateRequestId(),
    authenticated: opts?.authenticated ?? false,
    tokenId: opts?.tokenId,
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
