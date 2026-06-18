/**
 * observability-routes.ts -- P4.2d/h Read-only HTTP handlers for observability.
 *
 * All routes are GET-only, never mutate state, and set Cache-Control: no-store.
 * Segregated from the monolithic server.ts router.
 *
 * P4.3-Sb1: Refactored to consume SecurityContext and use secure-response.ts
 * for all JSON responses.
 */

import type { ServerResponse, IncomingMessage } from "node:http";
import type { SecurityContext } from "../security/inspector/security-context.js";
import type { SecureJsonResponder } from "../server/secure-response.js";

export interface RouteContext {
  root: string;
  req: IncomingMessage;
  res: ServerResponse;
  /** P4.3-Sb1: Security context (set by middleware). */
  security?: SecurityContext | null;
  /** P4.3-Sb1: Secure JSON responder (set by server). */
  responder?: SecureJsonResponder;
}

// ---------------------------------------------------------------------------
// Fallback helpers (used when no secure responder is provided)
// ---------------------------------------------------------------------------

const JSON_HEADERS = {
  "content-type": "application/json",
  "cache-control": "no-store",
};

function rawJson(res: ServerResponse, data: unknown, status = 200): void {
  res.statusCode = status;
  Object.entries(JSON_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
  res.end(JSON.stringify(data));
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

/**
 * Try to handle an observability route path. Returns true if handled.
 */
export async function handleObservabilityRoute(ctx: RouteContext): Promise<boolean> {
  const { req, res, root } = ctx;
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const r = ctx.responder;

  try {
    // All observability routes are GET-only
    if (req.method !== "GET") {
      if (r) r.error("method_not_allowed", 405);
      else rawJson(res, { error: "Method not allowed" }, 405);
      return true;
    }

    if (url.pathname === "/api/observability/health") {
      const { ObservabilitySnapshotService } = await import("../observability/health-snapshot.js");
      const svc = new ObservabilitySnapshotService(root);
      const snap = await svc.getHealth();
      if (r) r.ok(snap);
      else rawJson(res, snap);
      return true;
    }

    if (url.pathname === "/api/observability/metrics") {
      const metricName = url.searchParams.get("name") ?? undefined;
      const after = url.searchParams.get("after") ?? undefined;
      const before = url.searchParams.get("before") ?? undefined;
      const limitParam = url.searchParams.get("limit");
      const limit = limitParam ? Math.min(parseInt(limitParam, 10), 1000) : 100;
      if (limit < 1) {
        if (r) r.error("invalid_limit", 400, "limit must be >= 1");
        else rawJson(res, { error: "limit must be >= 1" }, 400);
        return true;
      }
      if (after && isNaN(Date.parse(after))) {
        if (r) r.error("invalid_after_date", 400);
        else rawJson(res, { error: "invalid after date" }, 400);
        return true;
      }
      if (before && isNaN(Date.parse(before))) {
        if (r) r.error("invalid_before_date", 400);
        else rawJson(res, { error: "invalid before date" }, 400);
        return true;
      }

      const { MetricsStore } = await import("../observability/metrics-store.js");
      const store = new MetricsStore(root);
      const rows: unknown[] = [];
      for await (const row of store.readAll({ after, before, limit })) {
        if (!metricName || row.name === metricName) rows.push(row);
      }
      if (r) r.ok(rows);
      else rawJson(res, rows);
      return true;
    }

    if (url.pathname === "/api/observability/alerts") {
      const { ObservabilitySnapshotService } = await import("../observability/health-snapshot.js");
      const { AlertEngine } = await import("../observability/alert-engine.js");
      const svc = new ObservabilitySnapshotService(root);
      const snap = await svc.getHealth();
      const engine = new AlertEngine();
      // evaluate but don't persist (GET = read-only)
      const alerts = engine.evaluate(snap);
      if (r) r.ok(alerts.firing);
      else rawJson(res, alerts.firing);
      return true;
    }

    if (url.pathname === "/api/observability/stream") {
      const { subscribeObservabilityStream } = await import("../server/observability-stream.js");
      await subscribeObservabilityStream(res, root);
      return true;
    }
  } catch (err) {
    if (r) r.error("internal_error", 500);
    else rawJson(res, { error: "internal_error" }, 500);
    return true;
  }

  return false; // not an observability route
}
