import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  AgentLiveness,
  DEFAULT_LIVENESS_THRESHOLDS,
  type AgentLivenessSnapshot,
} from "../../src/agent/agent-liveness.js";

describe("AgentLiveness", () => {
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

  function snapshot(l: AgentLiveness): AgentLivenessSnapshot {
    return l.snapshot();
  }

  it("starts healthy with zero idle and no last-progress details", () => {
    const l = new AgentLiveness();
    const s = snapshot(l);
    expect(s.state).toBe("healthy");
    expect(s.idleMs).toBe(0);
    expect(s.progressCount).toBe(0);
    expect(s.lastProgressKind).toBeUndefined();
  });

  it("records progress marks and stamps kind + description", () => {
    const l = new AgentLiveness();
    l.mark("phase_changed", "Executing");
    l.mark("model_response", "openai/gpt-4o");
    advance(10_000);
    l.mark("tool_completed", "shell.run");

    const s = snapshot(l);
    expect(s.progressCount).toBe(3);
    expect(s.lastProgressKind).toBe("tool_completed");
    expect(s.lastProgressDescription).toBe("shell.run");
    expect(s.idleMs).toBe(0);
    expect(s.state).toBe("healthy");
  });

  it("moves healthy → warning → stalled purely on idle time, never on wall clock", () => {
    const l = new AgentLiveness();
    l.mark("model_response", "m");
    // Below warning threshold — still healthy.
    advance(DEFAULT_LIVENESS_THRESHOLDS.warningAfterMs - 1);
    expect(snapshot(l).state).toBe("healthy");
    // Past warning threshold — RUNNING/SLOW, but not killed.
    advance(1);
    expect(snapshot(l).state).toBe("warning");
    // Past the stalled threshold — RUNNING/POSSIBLY STALLED.
    advance(DEFAULT_LIVENESS_THRESHOLDS.stalledAfterMs - DEFAULT_LIVENESS_THRESHOLDS.warningAfterMs);
    expect(snapshot(l).state).toBe("stalled");
    // A single progress mark resumes the run — no restart, no lost state.
    l.mark("tool_completed", "shell.run");
    expect(snapshot(l).state).toBe("healthy");
    expect(snapshot(l).progressCount).toBeGreaterThan(0);
  });

  it("debounces model_chunk marks but not discrete marks", () => {
    const l = new AgentLiveness();
    l.mark("model_chunk");
    advance(500); // < 1s debounce
    l.mark("model_chunk");
    expect(snapshot(l).progressCount).toBe(1);
    advance(600);
    l.mark("model_chunk");
    expect(snapshot(l).progressCount).toBe(2);
    // Discrete mark within the debounce window still records.
    advance(100);
    l.mark("tool_requested", "shell.run");
    expect(snapshot(l).lastProgressKind).toBe("tool_requested");
  });

  it("keeps startedAt fixed for the turn; elapsed grows with wall clock", () => {
    const l = new AgentLiveness();
    const startedAt = snapshot(l).startedAt;
    advance(5 * 60 * 1_000);
    expect(snapshot(l).startedAt).toBe(startedAt);
    expect(snapshot(l).idleMs).toBe(5 * 60 * 1_000);
  });

  it("satisfies the invariant: total elapsed of any length never changes state while progress flows", () => {
    const l = new AgentLiveness();
    for (let i = 0; i < 120; i++) {
      advance(30_000);
      l.mark("tool_completed", "shell.run");
    }
    // 60 minutes of continuous progress — still healthy, wall clock irrelevant.
    expect(snapshot(l).state).toBe("healthy");
  });
});