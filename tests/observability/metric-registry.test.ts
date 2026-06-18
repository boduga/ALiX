import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import {
  MetricRegistry,
  createMetricRegistry,
  SECURITY_METRIC_DEFINITIONS,
} from "../../src/observability/metric-registry.js";

describe("MetricRegistry", () => {
  describe("register + get + has", () => {
    it("registers and retrieves a metric definition", () => {
      const reg = new MetricRegistry();
      reg.register({
        name: "test_metric",
        type: "counter_delta",
        unit: "count",
        description: "A test metric",
        allowedLabelKeys: [],
      });
      assert.ok(reg.has("test_metric"));
      const def = reg.get("test_metric");
      assert.equal(def?.name, "test_metric");
      assert.equal(def?.type, "counter_delta");
    });

    it("returns undefined for unknown metric", () => {
      const reg = new MetricRegistry();
      assert.equal(reg.get("nonexistent"), undefined);
      assert.equal(reg.has("nonexistent"), false);
    });
  });

  describe("registerAll", () => {
    it("registers multiple definitions at once", () => {
      const reg = new MetricRegistry();
      reg.registerAll(SECURITY_METRIC_DEFINITIONS);
      assert.ok(reg.has("security_auth_attempt"));
      assert.ok(reg.has("security_gate_result"));
      assert.equal(reg.getNames().length, SECURITY_METRIC_DEFINITIONS.length);
    });
  });

  describe("getAllDefinitions / getNames", () => {
    it("returns all registered definitions and names", () => {
      const reg = new MetricRegistry();
      reg.register({
        name: "a", type: "counter_delta", unit: "count",
        description: "", allowedLabelKeys: [],
      });
      reg.register({
        name: "b", type: "gauge", unit: "count",
        description: "", allowedLabelKeys: [],
      });
      assert.equal(reg.getAllDefinitions().length, 2);
      assert.deepEqual(reg.getNames().sort(), ["a", "b"]);
    });
  });

  describe("validate", () => {
    let reg: MetricRegistry;
    before(() => {
      reg = new MetricRegistry({ mode: "strict" });
      reg.register({
        name: "test_counter",
        type: "counter_delta",
        unit: "count",
        description: "Test counter",
        allowedLabelKeys: ["env", "status"],
        allowedLabelValues: {
          env: ["prod", "dev"],
        },
      });
    });

    it("accepts a valid row", () => {
      const result = reg.validate({
        name: "test_counter",
        type: "counter_delta",
        value: 1,
        labels: { env: "prod", status: "ok" },
      });
      assert.ok(result.valid);
      assert.deepEqual(result.errors, []);
    });

    it("rejects unknown metric name in strict mode", () => {
      const result = reg.validate({
        name: "unknown_metric",
        type: "counter_delta",
        value: 1,
      });
      assert.equal(result.valid, false);
      assert.ok(result.errors[0].includes("unknown metric name"));
    });

    it("rejects wrong type", () => {
      const result = reg.validate({
        name: "test_counter",
        type: "gauge",
        value: 1,
      });
      assert.equal(result.valid, false);
      assert.ok(result.errors[0].includes("expects type"));
    });

    it("rejects invalid label key", () => {
      const result = reg.validate({
        name: "test_counter",
        type: "counter_delta",
        value: 1,
        labels: { forbidden_key: "x" },
      });
      assert.equal(result.valid, false);
      assert.ok(result.errors[0].includes("disallowed label key"));
    });

    it("rejects invalid label value when allowedLabelValues is defined", () => {
      const result = reg.validate({
        name: "test_counter",
        type: "counter_delta",
        value: 1,
        labels: { env: "staging" },
      });
      assert.equal(result.valid, false);
      assert.ok(result.errors[0].includes("disallowed value"));
    });

    it("rejects overlong label value (>128 chars)", () => {
      const result = reg.validate({
        name: "test_counter",
        type: "counter_delta",
        value: 1,
        labels: { status: "x".repeat(129) },
      });
      assert.equal(result.valid, false);
      assert.ok(result.errors[0].includes("exceeds 128 chars"));
    });

    it("rejects NaN value", () => {
      const result = reg.validate({
        name: "test_counter",
        type: "counter_delta",
        value: NaN,
      });
      assert.equal(result.valid, false);
      assert.ok(result.errors[0].includes("finite number"));
    });

    it("rejects Infinity value", () => {
      const result = reg.validate({
        name: "test_counter",
        type: "counter_delta",
        value: Infinity,
      });
      assert.equal(result.valid, false);
      assert.ok(result.errors[0].includes("finite number"));
    });

    it("rejects labels above the key limit (max 8)", () => {
      const result = reg.validate({
        name: "test_counter",
        type: "counter_delta",
        value: 1,
        labels: {
          a: "1", b: "2", c: "3", d: "4",
          e: "5", f: "6", g: "7", h: "8", i: "9",
        },
      });
      assert.equal(result.valid, false);
      assert.ok(result.errors[0].includes("max 8"));
    });
  });

  describe("compat mode", () => {
    it("warns but does not fail on unknown metric names", () => {
      const reg = new MetricRegistry({ mode: "compat" });
      const result = reg.validate({
        name: "legacy_metric",
        type: "counter_delta",
        value: 1,
      });
      assert.ok(result.valid);
      assert.deepEqual(result.errors, []);
    });

    it("still validates known metrics in compat mode", () => {
      const reg = new MetricRegistry({ mode: "compat" });
      reg.register({
        name: "known",
        type: "counter_delta",
        unit: "count",
        description: "",
        allowedLabelKeys: [],
      });
      const result = reg.validate({
        name: "known",
        type: "gauge",
        value: 1,
      });
      assert.equal(result.valid, false);
      assert.ok(result.errors[0].includes("expects type"));
    });
  });
});

describe("createMetricRegistry", () => {
  it("creates a registry with all production and security metrics", () => {
    const reg = createMetricRegistry();
    assert.ok(reg.has("workflow_runs_total"));
    assert.ok(reg.has("model_calls_total"));
    assert.ok(reg.has("security_auth_attempt"));
    assert.ok(reg.has("security_gate_result"));
    assert.ok(reg.has("security_gate_duration"));
    assert.ok(reg.getNames().length > 20);
  });
});
