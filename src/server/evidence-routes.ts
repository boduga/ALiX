/**
 * evidence-routes.ts — Evidence Memory REST API (P4.4d).
 *
 * Read-only HTTP handlers for evidence inspection.
 * All routes are GET-only (except POST /verify which is also read-only).
 *
 * Endpoints:
 *   GET  /api/security/evidence              — list records (query params: type, limit)
 *   GET  /api/security/evidence/:fingerprint  — get record by fingerprint
 *   GET  /api/security/evidence/query         — filtered query (type, after, before, limit)
 *   GET  /api/security/evidence/health        — evidence health metrics
 *   GET  /api/security/evidence/stats         — evidence statistics
 *   POST /api/security/evidence/verify        — run fingerprint verification
 *
 * @module
 */

import type { ServerResponse, IncomingMessage } from "node:http";
import { join } from "node:path";
import { EvidenceStore } from "../security/evidence/evidence-store.js";
import { EvidenceHealthCollector } from "../security/evidence/evidence-health.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EVIDENCE_DIR = join(".alix", "security");
const JSON_HEADERS = {
  "content-type": "application/json",
  "cache-control": "no-store",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EvidenceRouteContext {
  root: string;
  req: IncomingMessage;
  res: ServerResponse;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.statusCode = status;
  Object.entries(JSON_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
  res.end(JSON.stringify(data));
}

function error(res: ServerResponse, msg: string, status = 400): void {
  json(res, { error: msg }, status);
}

function createStore(root: string): EvidenceStore {
  return new EvidenceStore({ storeDir: join(root, EVIDENCE_DIR) });
}

/**
 * Parse URL query parameters from a URL.
 */
function parseQuery(url: URL): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, value] of url.searchParams.entries()) {
    params[key] = value;
  }
  return params;
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/**
 * GET /api/security/evidence — List records with optional type/limit filters.
 */
async function handleList(root: string, url: URL, res: ServerResponse): Promise<void> {
  const params = parseQuery(url);
  const store = createStore(root);
  const result = await store.query({
    type: params.type as any || undefined,
    limit: params.limit ? parseInt(params.limit, 10) || undefined : undefined,
  });
  json(res, result);
}

/**
 * GET /api/security/evidence/:fingerprint — Get a single record by fingerprint.
 */
async function handleGetByFingerprint(root: string, fingerprint: string, res: ServerResponse): Promise<void> {
  if (!fingerprint || fingerprint.length < 10) {
    error(res, "Invalid fingerprint", 400);
    return;
  }
  const store = createStore(root);
  const record = await store.getByFingerprint(fingerprint);
  if (!record) {
    error(res, "Evidence record not found", 404);
    return;
  }
  json(res, record);
}

/**
 * GET /api/security/evidence/query — Filtered query.
 */
async function handleQuery(root: string, url: URL, res: ServerResponse): Promise<void> {
  const params = parseQuery(url);
  const store = createStore(root);
  const result = await store.query({
    type: params.type as any || undefined,
    after: params.after || undefined,
    before: params.before || undefined,
    limit: params.limit ? parseInt(params.limit, 10) || undefined : undefined,
  });
  json(res, result);
}

/**
 * GET /api/security/evidence/health — Evidence health signals.
 */
async function handleHealth(root: string, _url: URL, res: ServerResponse): Promise<void> {
  const collector = new EvidenceHealthCollector(join(root, EVIDENCE_DIR));
  const health = await collector.collect();
  json(res, health);
}

/**
 * GET /api/security/evidence/stats — Evidence statistics.
 */
async function handleStats(root: string, _url: URL, res: ServerResponse): Promise<void> {
  const store = createStore(root);
  const stats = await store.stats();
  const verifyResult = await store.verify();
  const allRecords = await store.query({ limit: stats.total || 1 });
  const healthCollector = new EvidenceHealthCollector(join(root, EVIDENCE_DIR));
  const health = await healthCollector.collect();

  json(res, {
    records: stats.total,
    chainValid: verifyResult.ok,
    lastRecordAt: health.lastWriteAt,
    oldestRecordAt: health.oldestRecordAt,
    lastWriteAgeMs: health.lastWriteAgeMs,
    ...stats.byType,
  });
}

/**
 * POST /api/security/evidence/verify — Run fingerprint verification.
 * Read-only (verification never mutates the store).
 */
async function handleVerify(root: string, res: ServerResponse): Promise<void> {
  const store = createStore(root);
  const result = await store.verify();
  json(res, result, result.ok ? 200 : 200); // Always 200, body indicates result
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

/**
 * Try to handle an evidence route path. Returns true if handled.
 */
export async function handleEvidenceRoute(ctx: EvidenceRouteContext): Promise<boolean> {
  const { req, res, root } = ctx;
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const pathname = url.pathname;

  try {
    // All evidence routes are read-only
    if (req.method !== "GET" && req.method !== "POST") {
      error(res, "Method not allowed", 405);
      return true;
    }

    // POST /api/security/evidence/verify
    if (pathname === "/api/security/evidence/verify" && req.method === "POST") {
      await handleVerify(root, res);
      return true;
    }

    // GET /api/security/evidence/health
    if (pathname === "/api/security/evidence/health" && req.method === "GET") {
      await handleHealth(root, url, res);
      return true;
    }

    // GET /api/security/evidence/stats
    if (pathname === "/api/security/evidence/stats" && req.method === "GET") {
      await handleStats(root, url, res);
      return true;
    }

    // GET /api/security/evidence/query
    if (pathname === "/api/security/evidence/query" && req.method === "GET") {
      await handleQuery(root, url, res);
      return true;
    }

    // GET /api/security/evidence — list
    if (pathname === "/api/security/evidence" && req.method === "GET") {
      await handleList(root, url, res);
      return true;
    }

    // GET /api/security/evidence/:fingerprint — show
    // Must come after all other specific routes under /api/security/evidence/
    const showMatch = pathname.match(/^\/api\/security\/evidence\/([a-f0-9]{10,})$/);
    if (showMatch && req.method === "GET") {
      await handleGetByFingerprint(root, showMatch[1], res);
      return true;
    }

    return false; // Not handled by this router
  } catch (err) {
    error(res, `Internal error: ${err}`, 500);
    return true;
  }
}
