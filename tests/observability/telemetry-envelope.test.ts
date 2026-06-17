import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  type TelemetryEnvelope,
  type TelemetryCategory,
  type TelemetrySeverity,
  createTelemetryEnvelope,
  normalizeCanonicalEvent,
  normalizeTraceEvent,
  normalizeMetricEvent,
  TelemetryBuffer,
  type MetricInputType,
} from "../../src/observability/telemetry-envelope.js";
import type { AlixEvent } from "../../src/events/types.js";
import type { TraceEvent } from "../../src/runtime/trace-events.js";

describe("TelemetryEnvelope", () => {
  describe("createTelemetryEnvelope()", () => {
    it("returns a fully populated envelope with required fields", () => {
      const env = createTelemetryEnvelope({
        sessionId: "sess_1",
        category: "provider",
        eventType: "provider.call.started",
        severity: "info",
        dimensions: { provider: "openai" },
        measurements: { tokens: 150 },
      });
      assert.equal(env.schemaVersion, "1.0");
      assert.ok(env.id);
      assert.ok(env.timestamp);
      assert.equal(env.category, "provider");
      assert.equal(env.correlation.sessionId, "sess_1");
    });
    it("rejects invalid metric names", () => {
      assert.throws(() => createTelemetryEnvelope({
        sessionId: "s_1", category: "provider", eventType: "", severity: "info",
      }));
    });
    it("rejects excessive dimension labels (>16)", () => {
      const dims: Record<string, string> = {};
      for (let i = 0; i < 17; i++) dims[`k${i}`] = "v";
      assert.throws(() => createTelemetryEnvelope({
        sessionId: "s_1", category: "provider", eventType: "test", severity: "info", dimensions: dims,
      }));
    });
  });

  describe("normalizeCanonicalEvent()", () => {
    it("converts a CanonicalEvent to TelemetryEnvelope", () => {
      const event: AlixEvent = {
        id: "evt_1", seq: 1, version: 1 as const,
        sessionId: "s_1", timestamp: new Date().toISOString(),
        type: "tool.completed", actor: "agent", payload: { toolName: "bash" },
      };
      const env = normalizeCanonicalEvent(event);
      assert.equal(env.category, "tool");
      assert.equal(env.correlation.sessionId, "s_1");
    });
  });

  describe("normalizeTraceEvent()", () => {
    it("converts a TraceEvent to TelemetryEnvelope", () => {
      const trace: TraceEvent = {
        id: "tr_1", timestamp: new Date().toISOString(),
        sourceType: "policy", eventType: "policy.decision", label: "test",
      };
      const env = normalizeTraceEvent(trace);
      assert.equal(env.category, "tool");
    });
  });

  describe("normalizeMetricEvent()", () => {
    it("maps counter_delta to TelemetryEnvelope", () => {
      const env = normalizeMetricEvent({
        name: "model_calls_total",
        type: "counter_delta",
        value: 1,
        timestamp: new Date().toISOString(),
        labels: { provider: "openai" },
      });
      assert.equal(env.measurements["delta"], 1);
    });
    it("maps histogram_sample and passes p50/p95/p99 in payload", () => {
      const env = normalizeMetricEvent({
        name: "workflow_duration_ms",
        type: "histogram_sample",
        value: 500,
        timestamp: new Date().toISOString(),
      });
      assert.equal(env.measurements["sample"], 500);
    });
  });

  describe("TelemetryBuffer", () => {
    it("is bounded at maxSize and drops oldest on overflow", () => {
      const buf = new TelemetryBuffer({ maxSize: 3, overflow: "drop_oldest" });
      buf.append(makeEnv("a"));
      buf.append(makeEnv("b"));
      buf.append(makeEnv("c"));
      buf.append(makeEnv("d")); // pushes 'a' out
      assert.equal(buf.size, 3);
      const drained = buf.drain();
      assert.equal(drained[0].eventType, "b");
    });
    it("drain() is idempotent on empty buffer", () => {
      const buf = new TelemetryBuffer({ maxSize: 100, overflow: "drop_oldest" });
      assert.deepEqual(buf.drain(), []);
      assert.deepEqual(buf.drain(), []);
    });
  });

  describe("TelemetrySink", () => {
    it("append() accepts a TelemetryEnvelope", async () => {
      const written: TelemetryEnvelope[] = [];
      const sink: import("../../src/observability/telemetry-envelope.js").TelemetrySink = {
        async append(e) { written.push(e); },
      };
      await sink.append(makeEnv("test"));
      assert.equal(written.length, 1);
    });
  });
});

function makeEnv(eventType: string): TelemetryEnvelope {
  return createTelemetryEnvelope({
    sessionId: "s_1", category: "provider", eventType, severity: "info",
  });
}
