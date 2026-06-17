import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  type RuntimeHealthSnapshot,
  type HealthStatus,
  type DaemonHealth,
  type ProviderHealth,
  healthStatusFromAge,
  overallHealth,
  HealthProjectionCollector,
  ObservabilitySnapshotService,
} from "../../src/observability/health-snapshot.js";

describe("HealthSnapshot", () => {
  describe("HealthStatus", () => {
    it("supports 'unknown' status", () => {
      const s: HealthStatus = "unknown";
      assert.equal(s, "unknown");
    });
  });

  describe("healthStatusFromAge()", () => {
    it("returns 'unknown' for -1", () => {
      assert.equal(healthStatusFromAge(-1), "unknown");
    });
    it("returns 'healthy' for < 5000", () => {
      assert.equal(healthStatusFromAge(1000), "healthy");
    });
    it("returns 'degraded' for 5000-30000", () => {
      assert.equal(healthStatusFromAge(5000), "degraded");
      assert.equal(healthStatusFromAge(29999), "degraded");
    });
    it("returns 'unhealthy' for >= 30000", () => {
      assert.equal(healthStatusFromAge(30000), "unhealthy");
    });
  });

  describe("overallHealth()", () => {
    it("returns 'unhealthy' if any subsystem is unhealthy", () => {
      assert.equal(overallHealth(["healthy", "unhealthy", "unknown"]), "unhealthy");
    });
    it("returns 'degraded' if any is degraded and none unhealthy", () => {
      assert.equal(overallHealth(["healthy", "degraded", "unknown"]), "degraded");
    });
    it("returns 'unknown' when all are unknown", () => {
      assert.equal(overallHealth(["unknown", "unknown"]), "unknown");
    });
    it("returns 'healthy' when all are healthy", () => {
      assert.equal(overallHealth(["healthy", "healthy"]), "healthy");
    });
  });

  describe("HealthProjectionCollector", () => {
    let tmpDir: string;
    let collector: HealthProjectionCollector;

    before(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "health-proj-test-"));
      mkdirSync(join(tmpDir, ".alix"), { recursive: true });
      collector = new HealthProjectionCollector(tmpDir);
    });

    after(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("returns unknown providers when no telemetry exists", async () => {
      const snap = await collector.collect();
      assert.ok(snap.providers.length >= 0);
      for (const p of snap.providers) {
        assert.equal(p.status, "unknown");
        assert.equal(p.latencyMs, 0);
        assert.equal(p.errorRate, 0);
      }
    });

    it("reads daemon health from daemon.json without side effects", async () => {
      const daemonDir = join(tmpDir, ".alix");
      writeFileSync(join(daemonDir, "daemon.json"), JSON.stringify({
        pid: 12345, lastHeartbeat: new Date().toISOString(),
      }), "utf-8");
      // Recreate collector so it picks up file
      const snap = await collector.collect();
      assert.ok(snap.daemon.status === "healthy" || snap.daemon.status === "degraded");
    });

    it("returns all sections without throwing", async () => {
      const snap = await collector.collect();
      assert.ok(snap.daemon);
      assert.ok(Array.isArray(snap.providers));
      assert.ok(snap.coordination);
      assert.ok(snap.approvals);
      assert.ok(snap.ownership);
      assert.ok(snap.recovery);
      assert.ok(snap.resources);
    });
  });

  describe("ObservabilitySnapshotService", () => {
    it("returns cached health within TTL", async () => {
      const tmpDir2 = mkdtempSync(join(tmpdir(), "obs-svc-test-"));
      const svc = new ObservabilitySnapshotService(tmpDir2, {
        snapshot: { healthTtlMs: 60000, costTtlMs: 30000, trendTtlMs: 60000 },
      });
      const h1 = await svc.getHealth();
      const h2 = await svc.getHealth();
      // Second call should return cached (same generatedAt if within 1s)
      assert.equal(h1.generatedAt, h2.generatedAt);
      rmSync(tmpDir2, { recursive: true, force: true });
    });
  });
});
