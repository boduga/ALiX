import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import {
  MetricRegistry,
  createMetricRegistry,
  SECURITY_METRIC_DEFINITIONS,
} from "../../src/observability/metric-registry.js";
import { AGENT_ACTIVITY_STATES } from "../../src/agent/agent-activity.js";

/** The six Phase 9 agent activity/liveness metric definitions. */
function agentMetricDefs(reg: MetricRegistry) {
  return [
    reg.get("agent_activity_state"),
    reg.get("agent_activity_duration_ms"),
    reg.get("agent_last_progress_age_ms"),
    reg.get("agent_stall_warning_total"),
    reg.get("agent_invocation_cancelled_total"),
    reg.get("agent_invocation_failed_total"),
  ];
}

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

describe("agent activity/liveness metric definitions (Phase 9)", () => {
  let reg: MetricRegistry;
  before(() => {
    reg = createMetricRegistry();
  });

  it("registers all six agent_* metrics", () => {
    for (const def of agentMetricDefs(reg)) {
      assert.ok(def, `expected ${def?.name ?? "???"} to be registered`);
    }
    assert.deepEqual(
      agentMetricDefs(reg).map((d) => d!.name).sort(),
      [
        "agent_activity_duration_ms",
        "agent_activity_state",
        "agent_invocation_cancelled_total",
        "agent_invocation_failed_total",
        "agent_last_progress_age_ms",
        "agent_stall_warning_total",
      ],
    );
  });

  it("declares the plan types and units", () => {
    assert.equal(reg.get("agent_activity_state")?.type, "gauge");
    assert.equal(reg.get("agent_activity_state")?.unit, "count");
    assert.equal(reg.get("agent_activity_duration_ms")?.type, "histogram_sample");
    assert.equal(reg.get("agent_activity_duration_ms")?.unit, "ms");
    assert.equal(reg.get("agent_last_progress_age_ms")?.type, "gauge");
    assert.equal(reg.get("agent_last_progress_age_ms")?.unit, "ms");
    // *_total counters follow the file convention (per-event counter_delta),
    // matching workflow_runs_total etc. in PRODUCTION_METRIC_DEFINITIONS.
    assert.equal(reg.get("agent_stall_warning_total")?.type, "counter_delta");
    assert.equal(reg.get("agent_invocation_cancelled_total")?.type, "counter_delta");
    assert.equal(reg.get("agent_invocation_failed_total")?.type, "counter_delta");
  });

  it("agent_activity_state label vocabulary stays in sync with AGENT_ACTIVITY_STATES", () => {
    const allowed = reg.get("agent_activity_state")?.allowedLabelValues?.state;
    assert.deepEqual(allowed, [...AGENT_ACTIVITY_STATES]);
    assert.deepEqual(
      [...AGENT_ACTIVITY_STATES].sort(),
      allowed?.slice().sort(),
      "agent_activity_state allowed values must cover every AgentActivityState",
    );
  });

  it("restricts terminal duration + stall labels to their vocabularies", () => {
    const terminal = reg.get("agent_activity_duration_ms")?.allowedLabelValues?.state;
    assert.deepEqual(terminal, ["completed", "failed", "cancelled"]);
    const stall = reg.get("agent_stall_warning_total")?.allowedLabelValues?.state;
    assert.deepEqual(stall, ["warning", "stalled"]);
  });

  it("strict validation accepts canonical rows for all six", () => {
    const rows: Array<{
      name: string;
      type: string;
      value: number;
      labels?: Record<string, string>;
    }> = [
      { name: "agent_activity_state", type: "gauge", value: 1, labels: { state: "thinking", invocationId: "inv-1" } },
      { name: "agent_activity_duration_ms", type: "histogram_sample", value: 1234, labels: { state: "completed", invocationId: "inv-1" } },
      { name: "agent_last_progress_age_ms", type: "gauge", value: 42, labels: { invocationId: "inv-1" } },
      { name: "agent_stall_warning_total", type: "counter_delta", value: 1, labels: { state: "stalled" } },
      { name: "agent_invocation_cancelled_total", type: "counter_delta", value: 1 },
      { name: "agent_invocation_failed_total", type: "counter_delta", value: 1 },
    ];
    for (const row of rows) {
      const res = reg.validate(row);
      assert.ok(res.valid, `row ${row.name} should validate: ${res.errors.join("; ")}`);
    }
  });

  it("strict validation rejects wrong types and disallowed label values", () => {
    const wrongType = reg.validate({ name: "agent_activity_state", type: "counter_total", value: 1, labels: { state: "thinking" } });
    assert.equal(wrongType.valid, false);
    assert.ok(wrongType.errors[0]!.includes("expects type"));

    const badState = reg.validate({ name: "agent_activity_state", type: "gauge", value: 1, labels: { state: "paused" } });
    assert.equal(badState.valid, false);
    assert.ok(badState.errors[0]!.includes("disallowed value"));

    const badStall = reg.validate({ name: "agent_stall_warning_total", type: "counter_delta", value: 1, labels: { state: "healthy" } });
    assert.equal(badStall.valid, false);
    assert.ok(badStall.errors[0]!.includes("disallowed value"));

    const wrongOutcome = reg.validate({ name: "agent_activity_duration_ms", type: "histogram_sample", value: 1, labels: { state: "thinking" } });
    assert.equal(wrongOutcome.valid, false);
    assert.ok(wrongOutcome.errors[0]!.includes("disallowed value"));
  });
});
