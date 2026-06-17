import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ServerResponse, IncomingMessage } from "node:http";
import { handleObservabilityRoute, type RouteContext } from "../../src/observability/observability-routes.js";

/**
 * Create a minimal mock ServerResponse that captures statusCode, headers, and body.
 */
function mockRes(): ServerResponse & { body: string; headers: Record<string, string> } {
  const captured: { statusCode: number; headers: Record<string, string>; body: string } = {
    statusCode: 200,
    headers: {},
    body: "",
  };
  return {
    get statusCode() { return captured.statusCode; },
    set statusCode(v: number) { captured.statusCode = v; },
    get headers() { return captured.headers; },
    get body() { return captured.body; },
    setHeader(k: string, v: string) { captured.headers[k] = v; },
    end(data: string) { captured.body = data; },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/**
 * Create a minimal mock IncomingMessage with a given URL.
 */
function mockReq(url: string): IncomingMessage {
  return {
    url,
    headers: { host: "localhost" },
    method: "GET",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("observability HTTP routes", () => {
  let tmpDir: string;
  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "obs-route-test-"));
    mkdirSync(join(tmpDir, ".alix"), { recursive: true });
  });
  after(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("handles GET /api/observability/health", async () => {
    const res = mockRes();
    const handled = await handleObservabilityRoute({
      req: mockReq("/api/observability/health"),
      res: res as unknown as ServerResponse,
      root: tmpDir,
    });
    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    // Should have returned a JSON body with RuntimeHealthSnapshot fields
    const body = JSON.parse(res.body);
    assert.ok(body.generatedAt);
    assert.ok(body.daemon);
    assert.ok(body.providers);
    assert.ok(body.coordination);
    assert.ok(body.approvals);
    assert.ok(body.ownership);
    assert.ok(body.recovery);
    assert.ok(body.resources);
  });

  it("handles GET /api/observability/metrics with no data", async () => {
    const res = mockRes();
    const handled = await handleObservabilityRoute({
      req: mockReq("/api/observability/metrics"),
      res: res as unknown as ServerResponse,
      root: tmpDir,
    });
    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(Array.isArray(body));
    assert.equal(body.length, 0);
  });

  it("handles GET /api/observability/metrics with bad limit", async () => {
    const res = mockRes();
    const handled = await handleObservabilityRoute({
      req: mockReq("/api/observability/metrics?limit=0"),
      res: res as unknown as ServerResponse,
      root: tmpDir,
    });
    assert.equal(handled, true);
    assert.equal(res.statusCode, 400);
    const body = JSON.parse(res.body);
    assert.ok(body.error);
  });

  it("handles GET /api/observability/metrics with invalid after date", async () => {
    const res = mockRes();
    const handled = await handleObservabilityRoute({
      req: mockReq("/api/observability/metrics?after=not-a-date"),
      res: res as unknown as ServerResponse,
      root: tmpDir,
    });
    assert.equal(handled, true);
    assert.equal(res.statusCode, 400);
    const body = JSON.parse(res.body);
    assert.ok(body.error);
  });

  it("returns false for /api/observability/stream (falls through)", async () => {
    const res = mockRes();
    const handled = await handleObservabilityRoute({
      req: mockReq("/api/observability/stream"),
      res: res as unknown as ServerResponse,
      root: tmpDir,
    });
    assert.equal(handled, false);
  });

  it("returns false for unknown observability path", async () => {
    const res = mockRes();
    const handled = await handleObservabilityRoute({
      req: mockReq("/api/observability/nonexistent"),
      res: res as unknown as ServerResponse,
      root: tmpDir,
    });
    assert.equal(handled, false);
  });

  it("sets cache-control: no-store on responses", async () => {
    const res = mockRes();
    await handleObservabilityRoute({
      req: mockReq("/api/observability/health"),
      res: res as unknown as ServerResponse,
      root: tmpDir,
    });
    assert.equal(res.headers["cache-control"], "no-store");
    assert.equal(res.headers["content-type"], "application/json");
  });
});
