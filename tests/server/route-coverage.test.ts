/**
 * route-coverage.test.ts — P4.3-Sb1.3: Route coverage enforcement.
 *
 * Validates:
 *  1. Every route handler in the server has a descriptor in the registry.
 *  2. Every API descriptor in the registry has a matching route handler.
 *  3. No data-bearing API route is marked auth: "public".
 *  4. No P4.3-S route uses a non-GET method (all current routes are GET).
 *
 * Routes are enumerated as a test fixture since they live in if/else
 * blocks inside server.ts, not in a central list.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { routeRegistry } from "../../src/security/inspector/route-policy.js";

// ---------------------------------------------------------------------------
// Implemented routes — canonical list must match the handler code in
// src/server/server.ts, src/server/coordination-routes.ts, and
// src/observability/observability-routes.ts.
// ---------------------------------------------------------------------------

interface ImplementedRoute {
  pathname: string;
  method: string;
  source: string; // which module handles this route
}

const IMPLEMENTED_ROUTES: ImplementedRoute[] = [
  // -- Static assets and health -------------------------------------------
  { pathname: "/healthz", method: "GET", source: "server.ts" },
  { pathname: "/", method: "GET", source: "server.ts" },
  { pathname: "/app.js", method: "GET", source: "server.ts" },
  { pathname: "/projection.js", method: "GET", source: "server.ts" },
  { pathname: "/styles.css", method: "GET", source: "server.ts" },

  // -- Graphs -------------------------------------------------------------
  { pathname: "/api/graphs", method: "GET", source: "server.ts" },
  { pathname: "/api/graphs/my-graph/projection", method: "GET", source: "server.ts" },

  // -- Registry -----------------------------------------------------------
  { pathname: "/api/registry/agents", method: "GET", source: "server.ts" },
  { pathname: "/api/registry/tools", method: "GET", source: "server.ts" },

  // -- Policy -------------------------------------------------------------
  { pathname: "/api/policy/rules", method: "GET", source: "server.ts" },
  { pathname: "/api/policy/eval", method: "GET", source: "server.ts" },

  // -- Daemon -------------------------------------------------------------
  { pathname: "/api/daemon/status", method: "GET", source: "server.ts" },
  { pathname: "/api/daemon/tasks", method: "GET", source: "server.ts" },

  // -- Approvals ----------------------------------------------------------
  { pathname: "/api/approvals", method: "GET", source: "server.ts" },

  // -- Runtime events -----------------------------------------------------
  { pathname: "/api/runtime/events", method: "GET", source: "server.ts" },

  // -- Audit --------------------------------------------------------------
  { pathname: "/api/audit", method: "GET", source: "server.ts" },

  // -- Sessions -----------------------------------------------------------
  { pathname: "/api/sessions/compare", method: "GET", source: "server.ts" },
  { pathname: "/api/sessions/sess-test-12345/snapshot", method: "GET", source: "server.ts" },
  { pathname: "/api/sessions/sess-test-12345/events", method: "GET", source: "server.ts" },

  // -- Observability ------------------------------------------------------
  { pathname: "/api/observability/health", method: "GET", source: "observability-routes.ts" },
  { pathname: "/api/observability/metrics", method: "GET", source: "observability-routes.ts" },
  { pathname: "/api/observability/alerts", method: "GET", source: "observability-routes.ts" },
  { pathname: "/api/observability/stream", method: "GET", source: "observability-routes.ts" },

  // -- Coordination -------------------------------------------------------
  { pathname: "/api/coordination", method: "GET", source: "coordination-routes.ts" },
  { pathname: "/api/coordination/run-001", method: "GET", source: "coordination-routes.ts" },
  { pathname: "/api/coordination/run-001/workers", method: "GET", source: "coordination-routes.ts" },
  { pathname: "/api/coordination/run-001/workers/w1", method: "GET", source: "coordination-routes.ts" },
  { pathname: "/api/coordination/run-001/results", method: "GET", source: "coordination-routes.ts" },
  { pathname: "/api/coordination/run-001/events", method: "GET", source: "coordination-routes.ts" },
  { pathname: "/api/coordination/run-001/approvals", method: "GET", source: "coordination-routes.ts" },
  { pathname: "/api/coordination/run-001/ownership", method: "GET", source: "coordination-routes.ts" },
  { pathname: "/api/coordination/run-001/conflicts", method: "GET", source: "coordination-routes.ts" },
  { pathname: "/api/coordination/run-001/conflicts/conf-001", method: "GET", source: "coordination-routes.ts" },

  // -- Doctor (Sc1) --------------------------------------------------------
  { pathname: "/api/doctor", method: "GET", source: "server.ts" },

  // -- Auth (Sb3) ---------------------------------------------------------
  { pathname: "/api/auth/session", method: "POST", source: "server.ts" },
  { pathname: "/api/auth/logout", method: "POST", source: "server.ts" },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Route coverage (Sb1.3)", () => {
  it("every implemented route has a descriptor in the registry", () => {
    const missing: string[] = [];

    for (const r of IMPLEMENTED_ROUTES) {
      const desc = routeRegistry.get(r.pathname, r.method);
      if (!desc) {
        missing.push(`${r.method} ${r.pathname} (${r.source})`);
      }
    }

    assert.equal(
      missing.length,
      0,
      `Missing descriptors for ${missing.length} route(s):\n${missing.join("\n")}`,
    );
  });

  it("every API descriptor has a matching implemented route", () => {
    const apiDescriptors = routeRegistry.getApiRoutes();
    const orphaned: string[] = [];

    for (const desc of apiDescriptors) {
      // For pattern routes, we can't directly check — but we verify that
      // the pattern compilation works and the canonical instance has been
      // registered.  The main coverage check is the reverse direction:
      // every handler → descriptor.
      const found = IMPLEMENTED_ROUTES.some((r) => {
        const d = routeRegistry.get(r.pathname, r.method);
        return d && d.id === desc.id;
      });

      if (!found) {
        orphaned.push(`${desc.id} (${desc.method} ${desc.pathPattern})`);
      }
    }

    // For pattern routes, the canonical test paths in IMPLEMENTED_ROUTES
    // won't match by direct get() in the reverse direction.  Instead we
    // verify that every descriptor id is referenced by at least one
    // implemented route.
    const implementedDescriptorIds = new Set<string>();
    for (const r of IMPLEMENTED_ROUTES) {
      const d = routeRegistry.get(r.pathname, r.method);
      if (d) implementedDescriptorIds.add(d.id);
    }

    const trulyOrphaned = apiDescriptors.filter(
      (d) => !implementedDescriptorIds.has(d.id),
    );

    assert.equal(
      trulyOrphaned.length,
      0,
      `Orphaned descriptors (no matching handler): ${trulyOrphaned.map((d) => d.id).join(", ")}`,
    );
  });

  it("no data-bearing API route is marked public", () => {
    const api = routeRegistry.getApiRoutes();
    const publicData: string[] = [];

    for (const d of api) {
      if (d.routeClass === "data" && d.auth === "public") {
        publicData.push(d.id);
      }
    }

    assert.equal(
      publicData.length,
      0,
      `Data routes marked public: ${publicData.join(", ")}`,
    );
  });

  it("non-GET routes are limited to auth endpoints (Sb3)", () => {
    const all = routeRegistry.getAll();
    const nonGet: string[] = [];

    for (const d of all) {
      if (d.method !== "GET" && d.routeClass !== "auth") {
        nonGet.push(`${d.id} (${d.method} ${d.pathPattern})`);
      }
    }

    assert.equal(
      nonGet.length,
      0,
      `Non-GET non-auth route(s) found: ${nonGet.join(", ")}`,
    );
  });

  it("registry has exactly 36 routes", () => {
    const all = routeRegistry.getAll();
    assert.equal(all.length, 36, `expected 36 routes, got ${all.length}`);
  });

  it("all 36 routes have distinct ids", () => {
    const all = routeRegistry.getAll();
    const ids = all.map((d) => d.id);
    const unique = new Set(ids);
    assert.equal(unique.size, all.length, "duplicate route ids detected");
  });

  it("every static route is public", () => {
    const all = routeRegistry.getAll();
    for (const d of all) {
      if (d.routeClass === "static") {
        assert.equal(d.auth, "public", `Static route ${d.id} must be public`);
      }
    }
  });

  it("healthz route is public with correct class", () => {
    const d = routeRegistry.get("/healthz", "GET");
    assert.ok(d, "healthz route must exist");
    assert.equal(d!.routeClass, "health");
    assert.equal(d!.auth, "public");
  });

  it("SSE routes use correct auth mode", () => {
    const sseRoutes = routeRegistry.getAll().filter((d) => d.routeClass === "sse");
    assert.ok(sseRoutes.length >= 2, "at least 2 SSE routes expected");
    for (const d of sseRoutes) {
      assert.equal(d.auth, "sse", `SSE route ${d.id} must have auth="sse"`);
      assert.equal(d.streaming, true, `SSE route ${d.id} must have streaming=true`);
    }
  });

  it("API routes have operational redaction profile", () => {
    const api = routeRegistry.getApiRoutes();
    for (const d of api) {
      if (d.routeClass === "data") {
        assert.equal(
          d.redactionProfile,
          "operational",
          `Data route ${d.id} must use operational redaction, got ${d.redactionProfile}`,
        );
      }
    }
  });

  it("public routes (health/static) have public redaction profile", () => {
    const all = routeRegistry.getAll();
    for (const d of all) {
      if (d.routeClass === "health" || d.routeClass === "static") {
        assert.equal(
          d.redactionProfile,
          "public",
          `${d.routeClass} route ${d.id} must use public redaction, got ${d.redactionProfile}`,
        );
      }
    }
  });
});
