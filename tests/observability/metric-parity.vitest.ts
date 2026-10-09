/**
 * R5.4 — kernel metric vocabulary ⊆ observability registry.
 *
 * `MinimalMetrics` (kernel) and `MetricRegistry` (observability) previously
 * listed the same agent/conflict names independently. This pins parity: every
 * canonical kernel metric name must be registered, so the two cannot drift.
 */
import { describe, expect, it } from "vitest";
import { MINIMAL_METRIC_NAMES } from "../../src/coordination/kernel/minimal-metrics.js";
import { PRODUCTION_METRIC_DEFINITIONS } from "../../src/operations/observability/metric-registry.js";

describe("metric vocabulary parity (R5.4)", () => {
  it("registers every canonical kernel metric name", () => {
    const registered = new Set(PRODUCTION_METRIC_DEFINITIONS.map((definition) => definition.name));
    const missing = MINIMAL_METRIC_NAMES.filter((name) => !registered.has(name));
    expect(missing).toEqual([]);
  });
});
