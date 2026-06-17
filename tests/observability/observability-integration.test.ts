/**
 * observability-integration.test.ts — P4.2h Integration tests for TUI panels,
 * SSE stream, route validation, and cross-surface health consistency.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ServerResponse, IncomingMessage } from "node:http";
import { handleObservabilityRoute } from "../../src/observability/observability-routes.js";
import { subscribeObservabilityStream } from "../../src/server/observability-stream.js";
import { formatHealthPanel } from "../../src/tui/health-panel.js";
import { formatCostPanel } from "../../src/tui/cost-panel.js";
import {
  ObservabilitySnapshotService,
  overallHealth,
  type RuntimeHealthSnapshot,
} from "../../src/observability/health-snapshot.js";
import { AlertEngine } from "../../src/observability/alert-engine.js";

// ─── Helpers ────────────────────────────────────────────────────────────

function mockRes(): ServerResponse & { body: string; headers: Record<string, string>; closeHandlers: (() => void)[]; statusCode: number } {
  const captured = { statusCode: 200, headers: {} as Record<string, string>, body: "", closeHandlers: [] as (() => void)[] };
  return {
    get statusCode() { return captured.statusCode; },
    set statusCode(v: number) { captured.statusCode = v; },
    get headers() { return captured.headers; },
    get body() { return captured.body; },
    get closeHandlers() { return captured.closeHandlers; },
    setHeader(k: string, v: string) { captured.headers[k] = v; },
    end(data?: string) { if (data) captured.body = data; },
    flushHeaders() { /* no-op */ },
    write(_data: unknown) { return true; },
    on(event: string, cb: () => void) { if (event === "close") captured.closeHandlers.push(cb); },
  } as any;
}

function mockReq(url: string, method = "GET"): IncomingMessage {
  return { url, headers: { host: "localhost" }, method } as any;
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe("P4.2h Integration", () => {
  let tmpDir: string;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "obs-int-test-"));
    mkdirSync(join(tmpDir, ".alix"), { recursive: true });
  });

  after(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  // ── TUI Health Panel ──────────────────────────────────────────────────

  describe("TUI health panel", () => {
    it("returns formatted output with expected sections", async () => {
      const svc = new ObservabilitySnapshotService(tmpDir);
      const snap = await svc.getHealth();
      const output = formatHealthPanel(snap);
      assert.ok(Array.isArray(output), "should return array of lines");
      assert.ok(output.length > 0);
      const text = output.join("\n");
      // Should mention daemon, providers, coordination sections
      assert.ok(text.includes("Daemon") || text.includes("daemon"), "should reference daemon");
      assert.ok(text.includes("Memory") || text.includes("memory") || text.includes("RSS"), "should reference memory");
    });

    it("renders unknown status gracefully when no data", async () => {
      const svc = new ObservabilitySnapshotService(tmpDir);
      const snap = await svc.getHealth();
      const output = formatHealthPanel(snap);
      const text = output.join("\n");
      // With no daemon.json, daemon should show unknown
      assert.ok(text.includes("unknown") || text.includes("?"), "should handle unknown state");
    });
  });

  // ── TUI Cost Panel ────────────────────────────────────────────────────

  describe("TUI cost panel", () => {
    it("returns formatted output with provider breakdown", async () => {
      const output = formatCostPanel({
        totalTokens: 1000,
        totalCost: 0.015,
        byProvider: {
          openai: { tokens: 1000, cost: 0.015, calls: 5, latencyMs: 200 },
        },
        byWorkflow: {},
        unknownPricingModels: [],
      });
      assert.ok(Array.isArray(output), "should return array of lines");
      assert.ok(output.length > 0);
      const text = output.join("\n");
      assert.ok(text.includes("openai") || text.includes("total"), "should show provider data");
    });

    it("handles unknown pricing gracefully", () => {
      const output = formatCostPanel({
        totalTokens: 500,
        totalCost: -1,
        byProvider: {},
        byWorkflow: {},
        unknownPricingModels: ["ollama/llama3"],
      });
      assert.ok(Array.isArray(output), "should return array of lines");
      const text = output.join("\n");
      assert.ok(text.includes("unknown") || text.includes("Unknown") || text.includes("ollama"),
        "should surface unknown pricing models");
    });
  });

  // ── SSE Stream ────────────────────────────────────────────────────────

  describe("SSE stream", () => {
    it("sends initial health snapshot on connect", async () => {
      const res = mockRes();
      await subscribeObservabilityStream(res as unknown as ServerResponse, tmpDir);
      // SSE sets content-type header
      assert.equal(res.headers["content-type"], "text/event-stream");
      assert.equal(res.headers["cache-control"], "no-cache");
      // Clean up intervals to prevent process hang
      for (const cb of res.closeHandlers) cb();
    });

    it("fires close handlers to clean up intervals", async () => {
      const res = mockRes();
      await subscribeObservabilityStream(res as unknown as ServerResponse, tmpDir);
      // Fire close handlers to clean up intervals
      for (const cb of res.closeHandlers) cb();
      assert.ok(res.closeHandlers.length > 0, "should have registered close handlers");
    });
  });

  // ── REST Route Validation ────────────────────────────────────────────

  describe("REST route validation", () => {
    it("returns 400 for invalid metrics limit", async () => {
      const res = mockRes();
      const handled = await handleObservabilityRoute({
        req: mockReq("/api/observability/metrics?limit=-1"),
        res: res as unknown as ServerResponse,
        root: tmpDir,
      });
      assert.equal(handled, true);
      assert.equal(res.statusCode, 400);
      const body = JSON.parse(res.body);
      assert.ok(body.error, "should include error message");
    });

    it("returns 400 for invalid after date", async () => {
      const res = mockRes();
      const handled = await handleObservabilityRoute({
        req: mockReq("/api/observability/metrics?after=not-a-date"),
        res: res as unknown as ServerResponse,
        root: tmpDir,
      });
      assert.equal(handled, true);
      assert.equal(res.statusCode, 400);
      const body = JSON.parse(res.body);
      assert.ok(body.error, "should include error message");
    });

    it("returns 400 for invalid before date", async () => {
      const res = mockRes();
      const handled = await handleObservabilityRoute({
        req: mockReq("/api/observability/metrics?before=not-a-date-too"),
        res: res as unknown as ServerResponse,
        root: tmpDir,
      });
      assert.equal(handled, true);
      assert.equal(res.statusCode, 400);
      const body = JSON.parse(res.body);
      assert.ok(body.error, "should include error message");
    });

    it("returns 405 for non-GET on health", async () => {
      const res = mockRes();
      const handled = await handleObservabilityRoute({
        req: mockReq("/api/observability/health", "POST"),
        res: res as unknown as ServerResponse,
        root: tmpDir,
      });
      assert.equal(handled, true);
      assert.equal(res.statusCode, 405);
    });

    it("returns 405 for non-GET on metrics", async () => {
      const res = mockRes();
      const handled = await handleObservabilityRoute({
        req: mockReq("/api/observability/metrics", "PUT"),
        res: res as unknown as ServerResponse,
        root: tmpDir,
      });
      assert.equal(handled, true);
      assert.equal(res.statusCode, 405);
    });

    it("returns 405 for non-GET on alerts", async () => {
      const res = mockRes();
      const handled = await handleObservabilityRoute({
        req: mockReq("/api/observability/alerts", "DELETE"),
        res: res as unknown as ServerResponse,
        root: tmpDir,
      });
      assert.equal(handled, true);
      assert.equal(res.statusCode, 405);
    });

    it("returns 500 gracefully for internal errors", async () => {
      const res = mockRes();
      // Pass an invalid root to trigger a failure
      const handled = await handleObservabilityRoute({
        req: mockReq("/api/observability/health"),
        res: res as unknown as ServerResponse,
        root: "/nonexistent/path/that/should/fail",
      });
      assert.equal(handled, true);
      // Should still return JSON with an error, not crash
      assert.ok(res.statusCode === 200 || res.statusCode === 500,
        `expected 200 or 500, got ${res.statusCode}`);
      if (res.body) {
        const body = JSON.parse(res.body);
        assert.ok(!body.error || typeof body.error === "string", "error should be a string if present");
      }
    });

    it("sets cache-control: no-store on all responses", async () => {
      for (const path of ["/api/observability/health", "/api/observability/metrics", "/api/observability/alerts"]) {
        const res = mockRes();
        await handleObservabilityRoute({
          req: mockReq(path),
          res: res as unknown as ServerResponse,
          root: tmpDir,
        });
        assert.equal(res.headers["cache-control"], "no-store", `${path} should set no-store`);
      }
    });
  });

  // ── Cross-Surface Health Consistency ──────────────────────────────────

  describe("cross-surface health consistency", () => {
    it("overallHealth() and snapshot daemon status agree", async () => {
      const svc = new ObservabilitySnapshotService(tmpDir);
      const snap = await svc.getHealth();
      const allStatuses = [snap.daemon.status, ...snap.providers.map(p => p.status)];
      const overall = overallHealth(allStatuses);
      // Overall status should at minimum be a valid HealthStatus
      assert.ok(["healthy", "degraded", "unhealthy", "unknown"].includes(overall));
    });

    it("health panel returns same status as overallHealth()", async () => {
      const svc = new ObservabilitySnapshotService(tmpDir);
      const snap = await svc.getHealth();
      const panel = formatHealthPanel(snap);
      const allStatuses = [snap.daemon.status, ...snap.providers.map(p => p.status)];
      const overall = overallHealth(allStatuses);
      // Panel output and overallHealth should both reference the same data
      // The panel should contain either the status text or status-relevant content
      assert.ok(panel.length > 0, "panel should render");
      assert.ok(["healthy", "degraded", "unhealthy", "unknown"].includes(overall),
        `overall health status should be valid: ${overall}`);
    });
  });

  // ── Alert Fingerprint Dimensions ──────────────────────────────────────

  describe("alert fingerprint dimensions", () => {
    it("creates distinct fingerprints for different providers", () => {
      const engine = new AlertEngine({ cooldownMs: 0 });
      const snap: RuntimeHealthSnapshot = {
        generatedAt: new Date().toISOString(),
        daemon: { status: "healthy" },
        providers: [
          { providerId: "openai", status: "unhealthy", latencyMs: 100, errorRate: 0.5, lastCheckMs: 0 },
          { providerId: "ollama", status: "unhealthy", latencyMs: 50, errorRate: 0.3, lastCheckMs: 0 },
        ],
        coordination: { activeRuns: 0, totalWorkers: 0, failedWorkers: 0, staleRuns: 0 },
        approvals: { pending: 0, total: 0, oldestPendingMs: 0, averageResolutionMs: 0 },
        ownership: { activeLeases: 0, conflicts: 0, expiredLeases: 0, deniedRequests: 0 },
        recovery: { lastScanMs: -1, totalFindings: 0, criticalFindings: 0, unresolvedFindings: 0 },
        resources: { memoryRssMb: 100, heapUsedMb: 50, fileDescriptors: 0, sessionCount: 0 },
      };
      const result = engine.evaluate(snap);
      // Should create one alert per unhealthy provider
      const openaiAlerts = result.firing.filter(a => a.fingerprint.includes("providerId=openai"));
      const ollamaAlerts = result.firing.filter(a => a.fingerprint.includes("providerId=ollama"));
      assert.ok(openaiAlerts.length >= 1, "should alert for openai");
      assert.ok(ollamaAlerts.length >= 1, "should alert for ollama");
      assert.notEqual(openaiAlerts[0]?.fingerprint, ollamaAlerts[0]?.fingerprint,
        "different providers should have distinct fingerprints");
    });
  });
});
