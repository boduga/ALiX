import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AlertRule,
  AlertEvent,
  AlertEngine,
  HEALTH_RULES,
  fingerprintAlert,
} from "../../src/observability/alert-engine.js";
import type { RuntimeHealthSnapshot } from "../../src/observability/health-snapshot.js";

const unhealthySnap: RuntimeHealthSnapshot = {
  generatedAt: new Date().toISOString(),
  daemon: { status: "unhealthy", pid: undefined, heartbeatAgeMs: -1 },
  providers: [],
  coordination: { activeRuns: 0, totalWorkers: 0, failedWorkers: 0, staleRuns: 0 },
  approvals: { pending: 25, total: 30, oldestPendingMs: 600_000, averageResolutionMs: 0 },
  ownership: { activeLeases: 0, conflicts: 0, expiredLeases: 0, deniedRequests: 0 },
  recovery: { lastScanMs: 0, totalFindings: 5, criticalFindings: 2, unresolvedFindings: 3 },
  resources: { memoryRssMb: 1200, heapUsedMb: 800, fileDescriptors: 0, sessionCount: 0 },
};

const healthySnap: RuntimeHealthSnapshot = {
  generatedAt: new Date().toISOString(),
  daemon: { status: "healthy", pid: 1234, heartbeatAgeMs: 500 },
  providers: [],
  coordination: { activeRuns: 1, totalWorkers: 3, failedWorkers: 0, staleRuns: 0 },
  approvals: { pending: 0, total: 10, oldestPendingMs: 0, averageResolutionMs: 5000 },
  ownership: { activeLeases: 2, conflicts: 0, expiredLeases: 0, deniedRequests: 0 },
  recovery: { lastScanMs: 120_000, totalFindings: 0, criticalFindings: 0, unresolvedFindings: 0 },
  resources: { memoryRssMb: 200, heapUsedMb: 100, fileDescriptors: 0, sessionCount: 1 },
};

describe("AlertEngine", () => {
  it("returns firing alerts for an unhealthy snapshot", () => {
    const engine = new AlertEngine();
    const result = engine.evaluate(unhealthySnap);
    assert.ok(result.firing.length > 0);
    assert.ok(result.firing.some(a => a.severity === "critical"));
    // All firing alerts have status "firing"
    assert.ok(result.firing.every(a => a.status === "firing"));
  });

  it("returns empty firing list for a healthy snapshot", () => {
    const engine = new AlertEngine();
    const result = engine.evaluate(healthySnap);
    assert.equal(result.firing.length, 0);
  });

  it("deduplicates identical alerts on consecutive evaluations", () => {
    const engine = new AlertEngine();
    engine.evaluate(unhealthySnap);
    const r2 = engine.evaluate(unhealthySnap);
    // Second call should return previously-fired alerts, not duplicates
    assert.ok(r2.firing.every(a => a.occurrences >= 1));
  });

  it("resolves alerts when condition clears", () => {
    const engine = new AlertEngine({ cooldownMs: 0 });
    engine.evaluate(unhealthySnap);
    // Now resolve
    const result = engine.evaluate(healthySnap);
    assert.ok(result.resolved.length > 0);
    assert.ok(result.resolved.every(a => a.status === "resolved"));
  });

  it("respects cooldown: condition must clear for full cooldownMs", () => {
    const engine = new AlertEngine({ cooldownMs: 50_000 });
    engine.evaluate(unhealthySnap);
    const result = engine.evaluate(healthySnap);
    // Should not resolve immediately -- still within cooldown
    assert.equal(result.resolved.length, 0);
  });

  it("fingerprintAlert() produces deterministic identity", () => {
    const a1: AlertEvent = {
      id: "x", ruleId: "memory_high", ruleName: "High Memory Usage", severity: "warning",
      message: "RSS at 600 MB", timestamp: new Date().toISOString(),
      status: "firing", firstTriggeredAt: "", lastTriggeredAt: "",
      occurrences: 1, acknowledged: false,
    };
    const a2: AlertEvent = { ...a1, id: "y" };
    assert.equal(fingerprintAlert(a1), fingerprintAlert(a2));
  });

  it("acknowledges a specific alert", () => {
    const engine = new AlertEngine();
    engine.evaluate(unhealthySnap);
    const result = engine.evaluate(unhealthySnap);
    const targetId = result.firing[0].id;
    engine.acknowledge(targetId);
    const state = engine.getState();
    assert.ok(state.firing.find(a => a.id === targetId)?.acknowledged);
  });
});
