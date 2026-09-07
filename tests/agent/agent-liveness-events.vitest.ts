/**
 * agent-liveness-events.vitest.ts — liveness state → log-event label mapping
 *
 * Regression for the session watchdog's recovery-mislabeled-as-warning bug:
 * the watchdog emits one event per liveness state transition and the recovery
 * (stalled/warning → healthy) state must surface as `agent.liveness.recovered`,
 * NOT a second `agent.liveness.warning`.
 *
 * The mapping lives in `livenessEventType` (src/agent/session.ts) — a pure
 * function over `AgentLivenessState`. These tests drive `AgentLiveness` through
 * the full warning → stalled → recovered cycle (mirroring the state machine in
 * src/agent/agent-liveness.ts) and assert the emitted label for each state.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  AgentLiveness,
  DEFAULT_LIVENESS_THRESHOLDS,
} from "../../src/agent/agent-liveness.js";
import { livenessEventType } from "../../src/agent/session.js";

describe("livenessEventType", () => {
  it("maps stalled → agent.liveness.stalled", () => {
    expect(livenessEventType("stalled")).toBe("agent.liveness.stalled");
  });

  it("maps warning → agent.liveness.warning", () => {
    expect(livenessEventType("warning")).toBe("agent.liveness.warning");
  });

  it("maps healthy (recovery) → agent.liveness.recovered, NOT another warning", () => {
    expect(livenessEventType("healthy")).toBe("agent.liveness.recovered");
    expect(livenessEventType("healthy")).not.toBe("agent.liveness.warning");
  });

  it("the three states map to three distinct labels", () => {
    const labels = new Set(["healthy", "warning", "stalled"].map((s) => livenessEventType(s as never)));
    expect(labels.size).toBe(3);
  });
});

describe("AgentLiveness recovery cycle (source of the states)", () => {
  let now: number;

  beforeEach(() => {
    now = 0;
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function advance(ms: number): void {
    now += ms;
    vi.setSystemTime(now);
  }

  it("warning → stalled → recovered maps through livenessEventType to distinct event labels", () => {
    const l = new AgentLiveness();
    l.mark("model_response", "m");

    advance(DEFAULT_LIVENESS_THRESHOLDS.warningAfterMs);
    expect(livenessEventType(l.snapshot().state)).toBe("agent.liveness.warning");

    advance(DEFAULT_LIVENESS_THRESHOLDS.stalledAfterMs - DEFAULT_LIVENESS_THRESHOLDS.warningAfterMs);
    expect(livenessEventType(l.snapshot().state)).toBe("agent.liveness.stalled");

    l.mark("tool_completed", "shell.run");
    expect(l.snapshot().state).toBe("healthy");
    expect(livenessEventType(l.snapshot().state)).toBe("agent.liveness.recovered");
  });
});
