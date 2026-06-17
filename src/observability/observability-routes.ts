/**
 * observability-routes.ts -- P4.2d/h Read-only HTTP handlers for observability.
 *
 * All routes are GET-only, never mutate state, and set Cache-Control: no-store.
 * Segregated from the monolithic server.ts router.
 */

import type { ServerResponse, IncomingMessage } from "node:http";

export interface RouteContext {
  root: string;
  req: IncomingMessage;
  res: ServerResponse;
}

const JSON_HEADERS = {
  "content-type": "application/json",
  "cache-control": "no-store",
};

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.statusCode = status;
  Object.entries(JSON_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
  res.end(JSON.stringify(data));
}

function badRequest(res: ServerResponse, msg: string): void {
  json(res, { error: msg }, 400);
}

/**
 * Try to handle an observability route path. Returns true if handled.
 */
export async function handleObservabilityRoute(ctx: RouteContext): Promise<boolean> {
  const { req, res, root } = ctx;
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  try {
    // All observability routes are GET-only
    if (req.method !== "GET") {
      json(res, { error: "Method not allowed" }, 405);
      return true;
    }

    if (url.pathname === "/api/observability/health") {
      const { ObservabilitySnapshotService } = await import("../observability/health-snapshot.js");
      const svc = new ObservabilitySnapshotService(root);
      const snap = await svc.getHealth();
      json(res, snap);
      return true;
    }

    if (url.pathname === "/api/observability/metrics") {
      const metricName = url.searchParams.get("name") ?? undefined;
      const after = url.searchParams.get("after") ?? undefined;
      const before = url.searchParams.get("before") ?? undefined;
      const limitParam = url.searchParams.get("limit");
      const limit = limitParam ? Math.min(parseInt(limitParam, 10), 1000) : 100;
      if (limit < 1) { badRequest(res, "limit must be >= 1"); return true; }
      if (after && isNaN(Date.parse(after))) { badRequest(res, "invalid after date"); return true; }
      if (before && isNaN(Date.parse(before))) { badRequest(res, "invalid before date"); return true; }

      const { MetricsStore } = await import("../observability/metrics-store.js");
      const store = new MetricsStore(root);
      const rows: unknown[] = [];
      for await (const r of store.readAll({ after, before, limit })) {
        if (!metricName || r.name === metricName) rows.push(r);
      }
      json(res, rows);
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
      json(res, alerts.firing);
      return true;
    }

    if (url.pathname === "/api/observability/stream") {
      // SSE stream -- handled by handleObservabilityStream
      return false; // fallthrough to dedicated handler
    }
  } catch (err) {
    json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    return true;
  }

  return false; // not an observability route
}
