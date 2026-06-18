/**
 * P4.3-Sb1 — Route Security Registry
 *
 * Defines the `RouteDescriptor` type and `RoutePolicyRegistry` class.
 * Every ALiX Inspector route MUST be registered here.  The coverage test
 * (tests/server/route-coverage.test.ts) enforces this invariant.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Stable, human-readable route identifier (e.g. "api.graphs.list"). */
export type RouteId = string;

/** HTTP method for route registration. */
export type RouteMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

/** How the route pathPattern should be matched. */
export type PathType = "exact" | "prefix" | "pattern";

/** Authentication requirement for a route. */
export type RouteAuth = "public" | "authenticated" | "sse";

/** Functional class of a route. */
export type RouteClass = "health" | "static" | "data" | "sse" | "auth";

/** Redaction profile applied to responses from this route. */
export type RouteRedactionProfile = "public" | "operational" | "administrative";

/**
 * Descriptor for a single Inspector route.
 *
 * Every route the server handles must have exactly one descriptor.
 */
export interface RouteDescriptor {
  /** Stable, human-readable identifier. */
  id: RouteId;
  /** HTTP method. */
  method: RouteMethod;
  /** Path pattern (exact path, prefix, or colon-parameter template). */
  pathPattern: string;
  /** How to match pathPattern against a request pathname. */
  pathType: PathType;
  /** Authentication requirement. */
  auth: RouteAuth;
  /** Required permission (checked against SecurityContext.permissions). */
  permission?: string;
  /** Functional class. */
  routeClass: RouteClass;
  /** Redaction profile for JSON responses. */
  redactionProfile: RouteRedactionProfile;
  /** Whether this route uses streaming (SSE). */
  streaming: boolean;
  /** When true, this descriptor matches unknown paths (fallback). */
  allowUnknown?: boolean;
}

// ---------------------------------------------------------------------------
// Internal matching helpers
// ---------------------------------------------------------------------------

/**
 * Compile a colon-parameter template (e.g. "/api/graphs/:graphId/projection")
 * into a RegExp that matches concrete paths and captures parameter values.
 */
function compilePattern(pattern: string): RegExp {
  // Escape regex-special chars except ":"
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  // Replace :paramName segments with capture groups
  const regexStr = escaped.replace(/:([A-Za-z]\w*)/g, "([^/]+)");
  return new RegExp(`^${regexStr}$`);
}

/** Cache compiled regexes keyed by pattern string. */
const patternCache = new Map<string, RegExp>();

function getPatternRegex(pattern: string): RegExp {
  let re = patternCache.get(pattern);
  if (!re) {
    re = compilePattern(pattern);
    patternCache.set(pattern, re);
  }
  return re;
}

// ---------------------------------------------------------------------------
// RoutePolicyRegistry
// ---------------------------------------------------------------------------

export class RoutePolicyRegistry {
  /** All registered descriptors. */
  private readonly descriptors: RouteDescriptor[] = [];

  /** Exact-match index: `${method}:${pathPattern}` → descriptor. */
  private readonly exactIndex = new Map<string, RouteDescriptor>();

  /**
   * Register a route descriptor.
   *
   * Throws if a descriptor with the same id already exists.
   */
  register(descriptor: RouteDescriptor): void {
    // Guard against duplicate ids
    if (this.descriptors.some((d) => d.id === descriptor.id)) {
      throw new Error(`Duplicate route descriptor id: ${descriptor.id}`);
    }

    this.descriptors.push(descriptor);

    // Index exact-match routes for O(1) lookup
    if (descriptor.pathType === "exact") {
      const key = `${descriptor.method}:${descriptor.pathPattern}`;
      this.exactIndex.set(key, descriptor);
    }
  }

  /**
   * Look up the descriptor matching a concrete pathname and method.
   *
   * Returns `undefined` when no descriptor matches (unknown route).
   */
  get(pathname: string, method: string): RouteDescriptor | undefined {
    // 1. Exact match (fast path)
    const exactKey = `${method}:${pathname}`;
    const exact = this.exactIndex.get(exactKey);
    if (exact) return exact;

    // 2. Pattern and prefix matches (sorted by specificity)
    const candidates = this.descriptors.filter(
      (d) => d.method === method && d.pathType !== "exact",
    );

    // Sort by specificity: more segments first, then longer patterns first
    const sorted = [...candidates].sort((a, b) => {
      const segsA = a.pathPattern.split("/").length;
      const segsB = b.pathPattern.split("/").length;
      if (segsB !== segsA) return segsB - segsA;
      return b.pathPattern.length - a.pathPattern.length;
    });

    for (const d of sorted) {
      if (d.pathType === "prefix") {
        if (pathname.startsWith(d.pathPattern)) return d;
      } else if (d.pathType === "pattern") {
        const re = getPatternRegex(d.pathPattern);
        if (re.test(pathname)) return d;
      }
    }

    return undefined;
  }

  /**
   * Return `true` when a descriptor exists for the given pathname+method.
   */
  has(pathname: string, method: string): boolean {
    return this.get(pathname, method) !== undefined;
  }

  /**
   * Return a shallow copy of all registered descriptors.
   */
  getAll(): RouteDescriptor[] {
    return [...this.descriptors];
  }

  /**
   * Return descriptors for API routes (path starts with "/api/").
   */
  getApiRoutes(): RouteDescriptor[] {
    return this.descriptors.filter((d) => d.pathPattern.startsWith("/api/"));
  }

  /**
   * Return `true` when the route requires no authentication.
   */
  isPublic(route: RouteDescriptor): boolean {
    return route.auth === "public";
  }
}

// ---------------------------------------------------------------------------
// Singleton instance
// ---------------------------------------------------------------------------

/**
 * The canonical route policy registry.
 *
 * Every file that needs route lookups should import this instance.
 */
export const routeRegistry = new RoutePolicyRegistry();

// ---------------------------------------------------------------------------
// Route registration — static assets and health (public)
// ---------------------------------------------------------------------------

routeRegistry.register({
  id: "healthz",
  method: "GET",
  pathPattern: "/healthz",
  pathType: "exact",
  auth: "public",
  permission: "health:read",
  routeClass: "health",
  redactionProfile: "public",
  streaming: false,
});

routeRegistry.register({
  id: "root",
  method: "GET",
  pathPattern: "/",
  pathType: "exact",
  auth: "public",
  routeClass: "static",
  redactionProfile: "public",
  streaming: false,
});

routeRegistry.register({
  id: "static.appjs",
  method: "GET",
  pathPattern: "/app.js",
  pathType: "exact",
  auth: "public",
  routeClass: "static",
  redactionProfile: "public",
  streaming: false,
});

routeRegistry.register({
  id: "static.projection",
  method: "GET",
  pathPattern: "/projection.js",
  pathType: "exact",
  auth: "public",
  routeClass: "static",
  redactionProfile: "public",
  streaming: false,
});

routeRegistry.register({
  id: "static.styles",
  method: "GET",
  pathPattern: "/styles.css",
  pathType: "exact",
  auth: "public",
  routeClass: "static",
  redactionProfile: "public",
  streaming: false,
});

// ---------------------------------------------------------------------------
// Route registration — API data routes (authenticated)
// ---------------------------------------------------------------------------

routeRegistry.register({
  id: "api.graphs.list",
  method: "GET",
  pathPattern: "/api/graphs",
  pathType: "exact",
  auth: "authenticated",
  permission: "graphs:read",
  routeClass: "data",
  redactionProfile: "operational",
  streaming: false,
});

routeRegistry.register({
  id: "api.graphs.projection",
  method: "GET",
  pathPattern: "/api/graphs/:graphId/projection",
  pathType: "pattern",
  auth: "authenticated",
  permission: "graphs:read",
  routeClass: "data",
  redactionProfile: "operational",
  streaming: false,
});

routeRegistry.register({
  id: "api.registry.agents",
  method: "GET",
  pathPattern: "/api/registry/agents",
  pathType: "exact",
  auth: "authenticated",
  permission: "registry:read",
  routeClass: "data",
  redactionProfile: "operational",
  streaming: false,
});

routeRegistry.register({
  id: "api.registry.tools",
  method: "GET",
  pathPattern: "/api/registry/tools",
  pathType: "exact",
  auth: "authenticated",
  permission: "registry:read",
  routeClass: "data",
  redactionProfile: "operational",
  streaming: false,
});

routeRegistry.register({
  id: "api.policy.rules",
  method: "GET",
  pathPattern: "/api/policy/rules",
  pathType: "exact",
  auth: "authenticated",
  permission: "policy:read",
  routeClass: "data",
  redactionProfile: "operational",
  streaming: false,
});

routeRegistry.register({
  id: "api.policy.eval",
  method: "GET",
  pathPattern: "/api/policy/eval",
  pathType: "exact",
  auth: "authenticated",
  permission: "policy:read",
  routeClass: "data",
  redactionProfile: "operational",
  streaming: false,
});

routeRegistry.register({
  id: "api.daemon.status",
  method: "GET",
  pathPattern: "/api/daemon/status",
  pathType: "exact",
  auth: "authenticated",
  permission: "daemon:read",
  routeClass: "data",
  redactionProfile: "operational",
  streaming: false,
});

routeRegistry.register({
  id: "api.daemon.tasks",
  method: "GET",
  pathPattern: "/api/daemon/tasks",
  pathType: "exact",
  auth: "authenticated",
  permission: "daemon:read",
  routeClass: "data",
  redactionProfile: "operational",
  streaming: false,
});

routeRegistry.register({
  id: "api.approvals.list",
  method: "GET",
  pathPattern: "/api/approvals",
  pathType: "exact",
  auth: "authenticated",
  permission: "approvals:read",
  routeClass: "data",
  redactionProfile: "operational",
  streaming: false,
});

routeRegistry.register({
  id: "api.runtime.events",
  method: "GET",
  pathPattern: "/api/runtime/events",
  pathType: "exact",
  auth: "authenticated",
  permission: "runtime:read",
  routeClass: "data",
  redactionProfile: "operational",
  streaming: false,
});

routeRegistry.register({
  id: "api.audit.list",
  method: "GET",
  pathPattern: "/api/audit",
  pathType: "exact",
  auth: "authenticated",
  permission: "audit:read",
  routeClass: "data",
  redactionProfile: "operational",
  streaming: false,
});

routeRegistry.register({
  id: "api.sessions.compare",
  method: "GET",
  pathPattern: "/api/sessions/compare",
  pathType: "exact",
  auth: "authenticated",
  permission: "sessions:read",
  routeClass: "data",
  redactionProfile: "operational",
  streaming: false,
});

routeRegistry.register({
  id: "api.sessions.snapshot",
  method: "GET",
  pathPattern: "/api/sessions/:sessionId/snapshot",
  pathType: "pattern",
  auth: "authenticated",
  permission: "sessions:read",
  routeClass: "data",
  redactionProfile: "operational",
  streaming: false,
});

// ---------------------------------------------------------------------------
// Route registration — SSE routes
// ---------------------------------------------------------------------------

routeRegistry.register({
  id: "api.sessions.events",
  method: "GET",
  pathPattern: "/api/sessions/:sessionId/events",
  pathType: "pattern",
  auth: "sse",
  permission: "sessions:read",
  routeClass: "sse",
  redactionProfile: "public",
  streaming: true,
});

// ---------------------------------------------------------------------------
// Route registration — observability routes
// ---------------------------------------------------------------------------

routeRegistry.register({
  id: "api.observability.health",
  method: "GET",
  pathPattern: "/api/observability/health",
  pathType: "exact",
  auth: "authenticated",
  permission: "observability:read",
  routeClass: "data",
  redactionProfile: "operational",
  streaming: false,
});

routeRegistry.register({
  id: "api.observability.metrics",
  method: "GET",
  pathPattern: "/api/observability/metrics",
  pathType: "exact",
  auth: "authenticated",
  permission: "observability:read",
  routeClass: "data",
  redactionProfile: "operational",
  streaming: false,
});

routeRegistry.register({
  id: "api.observability.alerts",
  method: "GET",
  pathPattern: "/api/observability/alerts",
  pathType: "exact",
  auth: "authenticated",
  permission: "observability:read",
  routeClass: "data",
  redactionProfile: "operational",
  streaming: false,
});

routeRegistry.register({
  id: "api.observability.stream",
  method: "GET",
  pathPattern: "/api/observability/stream",
  pathType: "exact",
  auth: "sse",
  permission: "observability:read",
  routeClass: "sse",
  redactionProfile: "public",
  streaming: true,
});

// ---------------------------------------------------------------------------
// Route registration — coordination routes
// ---------------------------------------------------------------------------

routeRegistry.register({
  id: "api.coordination.list",
  method: "GET",
  pathPattern: "/api/coordination",
  pathType: "exact",
  auth: "authenticated",
  permission: "coordination:read",
  routeClass: "data",
  redactionProfile: "operational",
  streaming: false,
});

routeRegistry.register({
  id: "api.coordination.runId",
  method: "GET",
  pathPattern: "/api/coordination/:runId",
  pathType: "pattern",
  auth: "authenticated",
  permission: "coordination:read",
  routeClass: "data",
  redactionProfile: "operational",
  streaming: false,
});

routeRegistry.register({
  id: "api.coordination.runId.workers",
  method: "GET",
  pathPattern: "/api/coordination/:runId/workers",
  pathType: "pattern",
  auth: "authenticated",
  permission: "coordination:read",
  routeClass: "data",
  redactionProfile: "operational",
  streaming: false,
});

routeRegistry.register({
  id: "api.coordination.runId.workers.workerId",
  method: "GET",
  pathPattern: "/api/coordination/:runId/workers/:workerId",
  pathType: "pattern",
  auth: "authenticated",
  permission: "coordination:read",
  routeClass: "data",
  redactionProfile: "operational",
  streaming: false,
});

routeRegistry.register({
  id: "api.coordination.runId.results",
  method: "GET",
  pathPattern: "/api/coordination/:runId/results",
  pathType: "pattern",
  auth: "authenticated",
  permission: "coordination:read",
  routeClass: "data",
  redactionProfile: "operational",
  streaming: false,
});

routeRegistry.register({
  id: "api.coordination.runId.events",
  method: "GET",
  pathPattern: "/api/coordination/:runId/events",
  pathType: "pattern",
  auth: "authenticated",
  permission: "coordination:read",
  routeClass: "data",
  redactionProfile: "operational",
  streaming: false,
});

routeRegistry.register({
  id: "api.coordination.runId.approvals",
  method: "GET",
  pathPattern: "/api/coordination/:runId/approvals",
  pathType: "pattern",
  auth: "authenticated",
  permission: "coordination:read",
  routeClass: "data",
  redactionProfile: "operational",
  streaming: false,
});

routeRegistry.register({
  id: "api.coordination.runId.ownership",
  method: "GET",
  pathPattern: "/api/coordination/:runId/ownership",
  pathType: "pattern",
  auth: "authenticated",
  permission: "coordination:read",
  routeClass: "data",
  redactionProfile: "operational",
  streaming: false,
});

routeRegistry.register({
  id: "api.coordination.runId.conflicts",
  method: "GET",
  pathPattern: "/api/coordination/:runId/conflicts",
  pathType: "pattern",
  auth: "authenticated",
  permission: "coordination:read",
  routeClass: "data",
  redactionProfile: "operational",
  streaming: false,
});

routeRegistry.register({
  id: "api.coordination.runId.conflicts.conflictId",
  method: "GET",
  pathPattern: "/api/coordination/:runId/conflicts/:conflictId",
  pathType: "pattern",
  auth: "authenticated",
  permission: "coordination:read",
  routeClass: "data",
  redactionProfile: "operational",
  streaming: false,
});

// ---------------------------------------------------------------------------
// Route registration — auth routes (public, Sb3)
// ---------------------------------------------------------------------------

routeRegistry.register({
  id: "auth.session.create",
  method: "POST",
  pathPattern: "/api/auth/session",
  pathType: "exact",
  auth: "public",
  routeClass: "auth",
  redactionProfile: "public",
  streaming: false,
});

routeRegistry.register({
  id: "auth.session.delete",
  method: "POST",
  pathPattern: "/api/auth/logout",
  pathType: "exact",
  auth: "public",
  routeClass: "auth",
  redactionProfile: "public",
  streaming: false,
});
