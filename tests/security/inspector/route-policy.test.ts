/**
 * route-policy.test.ts — P4.3-Sb1: Route Policy Registry tests.
 *
 * Validates:
 *  1. Route registration (get, has, getAll)
 *  2. Method matching
 *  3. Unregistered route returns undefined
 *  4. API route list
 *  5. isPublic helper
 *  6. Duplicate registration throws
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  RoutePolicyRegistry,
  routeRegistry,
  type RouteDescriptor,
} from "../../../src/security/inspector/route-policy.js";

describe("RoutePolicyRegistry", () => {
  describe("register and get", () => {
    const reg = new RoutePolicyRegistry();

    reg.register({
      id: "test.exact",
      method: "GET",
      pathPattern: "/api/test",
      pathType: "exact",
      auth: "authenticated",
      permission: "test:read",
      routeClass: "data",
      redactionProfile: "operational",
      streaming: false,
    });

    reg.register({
      id: "test.pattern",
      method: "GET",
      pathPattern: "/api/items/:itemId",
      pathType: "pattern",
      auth: "authenticated",
      permission: "items:read",
      routeClass: "data",
      redactionProfile: "operational",
      streaming: false,
    });

    reg.register({
      id: "test.prefix",
      method: "GET",
      pathPattern: "/api/prefix",
      pathType: "prefix",
      auth: "public",
      routeClass: "static",
      redactionProfile: "public",
      streaming: false,
    });

    it("returns descriptor for exact match", () => {
      const d = reg.get("/api/test", "GET");
      assert.ok(d);
      assert.equal(d!.id, "test.exact");
    });

    it("returns descriptor for pattern match", () => {
      const d = reg.get("/api/items/abc123", "GET");
      assert.ok(d);
      assert.equal(d!.id, "test.pattern");
    });

    it("returns descriptor for prefix match", () => {
      const d = reg.get("/api/prefix/sub/path", "GET");
      assert.ok(d);
      assert.equal(d!.id, "test.prefix");
    });

    it("returns undefined for unknown path", () => {
      const d = reg.get("/api/unknown", "GET");
      assert.equal(d, undefined);
    });

    it("returns undefined for wrong method", () => {
      const d = reg.get("/api/test", "POST");
      assert.equal(d, undefined);
    });
  });

  describe("has", () => {
    const reg = new RoutePolicyRegistry();
    reg.register({
      id: "has.test",
      method: "GET",
      pathPattern: "/api/has",
      pathType: "exact",
      auth: "public",
      routeClass: "health",
      redactionProfile: "public",
      streaming: false,
    });

    it("returns true for registered route", () => {
      assert.equal(reg.has("/api/has", "GET"), true);
    });

    it("returns false for unregistered route", () => {
      assert.equal(reg.has("/api/missing", "GET"), false);
    });
  });

  describe("getAll", () => {
    it("returns all registered descriptors", () => {
      const reg = new RoutePolicyRegistry();
      reg.register({
        id: "a",
        method: "GET",
        pathPattern: "/a",
        pathType: "exact",
        auth: "public",
        routeClass: "health",
        redactionProfile: "public",
        streaming: false,
      });
      reg.register({
        id: "b",
        method: "GET",
        pathPattern: "/b",
        pathType: "exact",
        auth: "authenticated",
        routeClass: "data",
        redactionProfile: "operational",
        streaming: false,
      });
      const all = reg.getAll();
      assert.equal(all.length, 2);
    });
  });

  describe("getApiRoutes", () => {
    it("filters to /api/* routes only", () => {
      const reg = new RoutePolicyRegistry();
      reg.register({
        id: "health",
        method: "GET",
        pathPattern: "/healthz",
        pathType: "exact",
        auth: "public",
        routeClass: "health",
        redactionProfile: "public",
        streaming: false,
      });
      reg.register({
        id: "api.test",
        method: "GET",
        pathPattern: "/api/test",
        pathType: "exact",
        auth: "authenticated",
        routeClass: "data",
        redactionProfile: "operational",
        streaming: false,
      });
      const api = reg.getApiRoutes();
      assert.equal(api.length, 1);
      assert.equal(api[0].id, "api.test");
    });
  });

  describe("isPublic", () => {
    it("returns true for public routes", () => {
      const desc: RouteDescriptor = {
        id: "pub",
        method: "GET",
        pathPattern: "/pub",
        pathType: "exact",
        auth: "public",
        routeClass: "health",
        redactionProfile: "public",
        streaming: false,
      };
      const reg = new RoutePolicyRegistry();
      assert.equal(reg.isPublic(desc), true);
    });

    it("returns false for authenticated routes", () => {
      const desc: RouteDescriptor = {
        id: "auth",
        method: "GET",
        pathPattern: "/auth",
        pathType: "exact",
        auth: "authenticated",
        routeClass: "data",
        redactionProfile: "operational",
        streaming: false,
      };
      const reg = new RoutePolicyRegistry();
      assert.equal(reg.isPublic(desc), false);
    });
  });

  describe("duplicate registration", () => {
    it("throws on duplicate id", () => {
      const reg = new RoutePolicyRegistry();
      const desc: RouteDescriptor = {
        id: "dup",
        method: "GET",
        pathPattern: "/dup",
        pathType: "exact",
        auth: "public",
        routeClass: "health",
        redactionProfile: "public",
        streaming: false,
      };
      reg.register(desc);
      assert.throws(() => reg.register(desc), /Duplicate route descriptor id/);
    });
  });

  describe("pattern specificity", () => {
    it("matches more specific pattern first", () => {
      const reg = new RoutePolicyRegistry();
      // More specific (4 segments)
      reg.register({
        id: "specific",
        method: "GET",
        pathPattern: "/api/items/:itemId/detail",
        pathType: "pattern",
        auth: "authenticated",
        routeClass: "data",
        redactionProfile: "operational",
        streaming: false,
      });
      // Less specific (3 segments)
      reg.register({
        id: "generic",
        method: "GET",
        pathPattern: "/api/items/:itemId",
        pathType: "pattern",
        auth: "authenticated",
        routeClass: "data",
        redactionProfile: "operational",
        streaming: false,
      });

      const d = reg.get("/api/items/abc123/detail", "GET");
      assert.ok(d);
      // More specific pattern should win
      assert.equal(d!.id, "specific");
    });

    it("falls back to less specific when specific does not match", () => {
      const reg = new RoutePolicyRegistry();
      reg.register({
        id: "specific",
        method: "GET",
        pathPattern: "/api/items/:itemId/detail",
        pathType: "pattern",
        auth: "authenticated",
        routeClass: "data",
        redactionProfile: "operational",
        streaming: false,
      });
      reg.register({
        id: "generic",
        method: "GET",
        pathPattern: "/api/items/:itemId",
        pathType: "pattern",
        auth: "authenticated",
        routeClass: "data",
        redactionProfile: "operational",
        streaming: false,
      });

      const d = reg.get("/api/items/abc123", "GET");
      assert.ok(d);
      assert.equal(d!.id, "generic");
    });
  });
});

describe("canonical routeRegistry instance", () => {
  it("has all 35 routes registered", () => {
    const all = routeRegistry.getAll();
    assert.equal(all.length, 35, `expected 35 routes, got ${all.length}`);
  });

  it("all routes have unique ids", () => {
    const all = routeRegistry.getAll();
    const ids = all.map((d) => d.id);
    const unique = new Set(ids);
    assert.equal(unique.size, all.length, "all route ids must be unique");
  });

  it("healthz is public exact route", () => {
    const d = routeRegistry.get("/healthz", "GET");
    assert.ok(d);
    assert.equal(d!.auth, "public");
    assert.equal(d!.pathType, "exact");
    assert.equal(d!.routeClass, "health");
  });

  it("root serves static HTML", () => {
    const d = routeRegistry.get("/", "GET");
    assert.ok(d);
    assert.equal(d!.auth, "public");
    assert.equal(d!.routeClass, "static");
  });

  it("API routes are authenticated (except auth and SSE)", () => {
    const api = routeRegistry.getApiRoutes();
    for (const d of api) {
      // SSE routes are exempt from authenticated check
      if (d.routeClass === "sse") continue;
      // Auth routes (Sb3) are intentionally public — token validation
      // happens at the body level inside the handler
      if (d.routeClass === "auth") continue;
      assert.equal(
        d.auth,
        "authenticated",
        `API route ${d.id} must be authenticated, got ${d.auth}`,
      );
    }
  });

  it("no data route is public", () => {
    const all = routeRegistry.getAll();
    for (const d of all) {
      if (d.routeClass === "data" && d.auth === "public") {
        assert.fail(`Data route ${d.id} is public`);
      }
    }
  });

  it("pattern routes match concrete paths", () => {
    // Graph projection
    const d1 = routeRegistry.get("/api/graphs/my-graph-id/projection", "GET");
    assert.ok(d1);
    assert.equal(d1!.id, "api.graphs.projection");

    // Session snapshot
    const d2 = routeRegistry.get("/api/sessions/sess-abc-123/snapshot", "GET");
    assert.ok(d2);
    assert.equal(d2!.id, "api.sessions.snapshot");

    // Coordination run view
    const d3 = routeRegistry.get("/api/coordination/run-456", "GET");
    assert.ok(d3);
    assert.equal(d3!.id, "api.coordination.runId");

    // Coordination nested
    const d4 = routeRegistry.get("/api/coordination/run-456/workers/w1", "GET");
    assert.ok(d4);
    assert.equal(d4!.id, "api.coordination.runId.workers.workerId");
  });

  it("SSE routes have streaming flag", () => {
    const sseSession = routeRegistry.get("/api/sessions/sess-abc/events", "GET");
    assert.ok(sseSession);
    assert.equal(sseSession!.streaming, true);
    assert.equal(sseSession!.routeClass, "sse");

    const sseObs = routeRegistry.get("/api/observability/stream", "GET");
    assert.ok(sseObs);
    assert.equal(sseObs!.streaming, true);
    assert.equal(sseObs!.routeClass, "sse");
  });
});
