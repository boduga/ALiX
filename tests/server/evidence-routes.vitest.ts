/**
 * P4.4d — Evidence Routes tests.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { handleEvidenceRoute, type EvidenceRouteContext } from "../../src/server/evidence-routes.js";
import { EvidenceStore } from "../../src/security/evidence/evidence-store.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDir(): string {
  const dir = join("/tmp", "route-test-" + randomUUID().slice(0, 8));
  mkdirSync(dir, { recursive: true, mode: 0o755 });
  return dir;
}

/**
 * Create a minimal IncomingMessage mock with a URL.
 */
function mockRequest(method: string, pathname: string, query = ""): any {
  return {
    method,
    url: pathname + (query ? "?" + query : ""),
    headers: { host: "localhost:4137" },
  };
}

/**
 * Create a mock ServerResponse that captures the response.
 */
function mockResponse(): any {
  const chunks: Buffer[] = [];
  let statusCode = 200;
  const headers: Record<string, string> = {};

  return {
    statusCode,
    chunks,
    headers,
    setHeader(k: string, v: string) { headers[k] = v; },
    writeHead(s: number) { statusCode = s; },
    end(data: string) {
      statusCode = statusCode;
      if (data) chunks.push(Buffer.from(data));
    },
    getBody(): string {
      return chunks.map((c) => c.toString()).join("");
    },
    getJson(): any {
      return JSON.parse(this.getBody());
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EvidenceRoutes", () => {
  let dir: string;
  let root: string;

  beforeEach(() => {
    dir = tmpDir();
    root = dir; // Use dir as root (evidence store is at root/.alix/security)
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns 404 path for non-hex fingerprint on show route", async () => {
    // The show route requires hex fingerprint, so "not-hex" won't match
    const req = mockRequest("GET", "/api/security/evidence/not-hex-fingerprint");
    const res = mockResponse();
    const ctx: EvidenceRouteContext = { root, req, res };

    const handled = await handleEvidenceRoute(ctx);
    expect(handled).toBe(false);
  });

  it("returns 405 for PUT on list route", async () => {
    const req = mockRequest("PUT", "/api/security/evidence");
    const res = mockResponse();
    const ctx: EvidenceRouteContext = { root, req, res };

    // PUT is neither GET nor POST, so the handler rejects it
    const handled = await handleEvidenceRoute(ctx);
    expect(handled).toBe(true);
    expect(res.getJson().error).toBe("Method not allowed");
  });

  it("health endpoint returns health JSON", async () => {
    const req = mockRequest("GET", "/api/security/evidence/health");
    const res = mockResponse();
    const ctx: EvidenceRouteContext = { root, req, res };

    const handled = await handleEvidenceRoute(ctx);
    expect(handled).toBe(true);

    const body = res.getJson();
    expect(body).toHaveProperty("status");
    expect(body).toHaveProperty("storeAccessible");
    expect(body).toHaveProperty("recordCount");
    expect(body).toHaveProperty("chainIntegrity");
    expect(body).toHaveProperty("byType");
    expect(body).toHaveProperty("issues");
  });

  it("stats endpoint returns stats JSON", async () => {
    const store = new EvidenceStore({ storeDir: join(root, ".alix", "security") });
    await store.append("config_signed", { configVersion: 1 });

    const req = mockRequest("GET", "/api/security/evidence/stats");
    const res = mockResponse();
    const ctx: EvidenceRouteContext = { root, req, res };

    const handled = await handleEvidenceRoute(ctx);
    expect(handled).toBe(true);

    const body = res.getJson();
    expect(body).toHaveProperty("records");
    expect(body).toHaveProperty("chainValid");
    expect(body).toHaveProperty("config_signed");
  });

  it("list endpoint returns records", async () => {
    const store = new EvidenceStore({ storeDir: join(root, ".alix", "security") });
    await store.append("config_signed", { configVersion: 1 });
    await store.append("trust_evaluation", { trusted: true, configVersion: 1 });

    const req = mockRequest("GET", "/api/security/evidence");
    const res = mockResponse();
    const ctx: EvidenceRouteContext = { root, req, res };

    const handled = await handleEvidenceRoute(ctx);
    expect(handled).toBe(true);

    const body = res.getJson();
    expect(body.records.length).toBeGreaterThanOrEqual(2);
  });

  it("show endpoint returns a record by fingerprint", async () => {
    const store = new EvidenceStore({ storeDir: join(root, ".alix", "security") });
    const r = await store.append("config_signed", { configVersion: 7 });

    const req = mockRequest("GET", "/api/security/evidence/" + r.fingerprint);
    const res = mockResponse();
    const ctx: EvidenceRouteContext = { root, req, res };

    const handled = await handleEvidenceRoute(ctx);
    expect(handled).toBe(true);

    const body = res.getJson();
    expect(body.id).toBe(r.id);
    expect(body.payload.configVersion).toBe(7);
  });

  it("show endpoint returns 404 for missing fingerprint", async () => {
    const req = mockRequest("GET", "/api/security/evidence/" + "aa".repeat(16));
    const res = mockResponse();
    const ctx: EvidenceRouteContext = { root, req, res };

    const handled = await handleEvidenceRoute(ctx);
    expect(handled).toBe(true);
    expect(res.getJson().error).toContain("not found");
  });

  it("verify endpoint returns verification result", async () => {
    const store = new EvidenceStore({ storeDir: join(root, ".alix", "security") });
    await store.append("config_signed", { configVersion: 1 });

    const req = mockRequest("POST", "/api/security/evidence/verify");
    const res = mockResponse();
    const ctx: EvidenceRouteContext = { root, req, res };

    const handled = await handleEvidenceRoute(ctx);
    expect(handled).toBe(true);

    const body = res.getJson();
    expect(body).toHaveProperty("ok");
    expect(body).toHaveProperty("total");
    expect(body.ok).toBe(true);
  });

  it("query endpoint supports type filter", async () => {
    const store = new EvidenceStore({ storeDir: join(root, ".alix", "security") });
    await store.append("config_signed", { configVersion: 1 });
    await store.append("trust_evaluation", { trusted: true, configVersion: 1 });

    const req = mockRequest("GET", "/api/security/evidence/query", "type=config_signed");
    const res = mockResponse();
    const ctx: EvidenceRouteContext = { root, req, res };

    const handled = await handleEvidenceRoute(ctx);
    expect(handled).toBe(true);

    const body = res.getJson();
    expect(body.records.length).toBe(1);
    expect(body.records[0].type).toBe("config_signed");
  });
});
