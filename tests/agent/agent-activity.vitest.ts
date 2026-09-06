import { describe, expect, it } from "vitest";
import {
  AGENT_ACTIVITY_STATES,
  createAgentActivity,
  transition,
  withElapsed,
  assertExhaustiveState,
  type AgentActivity,
  type AgentActivityState,
} from "../../src/agent/agent-activity.js";

describe("AgentActivity contract", () => {
  // ─── State union ────────────────────────────────────────────────

  it("has exactly 10 states", () => {
    expect(AGENT_ACTIVITY_STATES).toHaveLength(10);
  });

  it("includes all expected state values", () => {
    const expected = new Set([
      "thinking",
      "streaming",
      "tool_running",
      "waiting_for_provider",
      "verifying",
      "summarizing",
      "possibly_stalled",
      "completed",
      "failed",
      "cancelled",
    ]);
    for (const s of AGENT_ACTIVITY_STATES) {
      expect(expected.has(s)).toBe(true);
    }
    expect(AGENT_ACTIVITY_STATES.length).toBe(expected.size);
  });

  // ─── createAgentActivity ────────────────────────────────────────

  describe("createAgentActivity", () => {
    it("stamps all timestamps at `now` and elapsedMs at 0", () => {
      const a = createAgentActivity("thinking", "inv-1", 1000);
      expect(a.state).toBe("thinking");
      expect(a.invocationId).toBe("inv-1");
      expect(a.startedAt).toBe(1000);
      expect(a.lastProgressAt).toBe(1000);
      expect(a.lastEventAt).toBe(1000);
      expect(a.elapsedMs).toBe(0);
    });

    it("includes optional fields when provided", () => {
      const a = createAgentActivity("tool_running", "inv-2", 500, {
        operation: "Reading file",
        toolName: "read",
        provider: "openai",
        model: "gpt-4o",
      });
      expect(a.operation).toBe("Reading file");
      expect(a.toolName).toBe("read");
      expect(a.provider).toBe("openai");
      expect(a.model).toBe("gpt-4o");
    });

    it("omits optional fields when not provided", () => {
      const a = createAgentActivity("thinking", "inv-3", 0);
      expect(a.operation).toBeUndefined();
      expect(a.toolName).toBeUndefined();
      expect(a.provider).toBeUndefined();
      expect(a.model).toBeUndefined();
    });

    it("returns a frozen (immutable) record", () => {
      const a = createAgentActivity("thinking", "inv-4", 0);
      expect(Object.isFrozen(a)).toBe(true);
    });
  });

  // ─── transition ─────────────────────────────────────────────────

  describe("transition", () => {
    it("updates state, lastProgressAt, lastEventAt, and recomputes elapsedMs", () => {
      const a = createAgentActivity("thinking", "inv-5", 1000);
      const b = transition(a, "streaming", 3500);
      expect(b.state).toBe("streaming");
      expect(b.lastProgressAt).toBe(3500);
      expect(b.lastEventAt).toBe(3500);
      expect(b.elapsedMs).toBe(2500);
    });

    it("carries forward startedAt and invocationId", () => {
      const a = createAgentActivity("thinking", "inv-6", 1000);
      const b = transition(a, "tool_running", 2000, { toolName: "bash" });
      expect(b.startedAt).toBe(1000);
      expect(b.invocationId).toBe("inv-6");
    });

    it("carries forward optional fields not overridden", () => {
      const a = createAgentActivity("thinking", "inv-7", 0, {
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
      });
      const b = transition(a, "tool_running", 100, { toolName: "grep" });
      expect(b.provider).toBe("anthropic");
      expect(b.model).toBe("claude-sonnet-4-20250514");
      expect(b.toolName).toBe("grep");
    });

    it("overrides optional fields when specified", () => {
      const a = createAgentActivity("tool_running", "inv-8", 0, {
        toolName: "bash",
      });
      const b = transition(a, "tool_running", 100, { toolName: "read" });
      expect(b.toolName).toBe("read");
    });

    it("returns a frozen (immutable) record", () => {
      const a = createAgentActivity("thinking", "inv-9", 0);
      const b = transition(a, "streaming", 100);
      expect(Object.isFrozen(b)).toBe(true);
    });

    it("does not mutate the original record", () => {
      const a = createAgentActivity("thinking", "inv-10", 0);
      transition(a, "streaming", 100);
      expect(a.state).toBe("thinking");
      expect(a.elapsedMs).toBe(0);
    });

    it("supports chained transitions with correct cumulative elapsedMs", () => {
      let a = createAgentActivity("thinking", "inv-11", 1000);
      a = transition(a, "streaming", 2000);
      expect(a.elapsedMs).toBe(1000);
      a = transition(a, "tool_running", 4500, { toolName: "bash" });
      expect(a.elapsedMs).toBe(3500);
      a = transition(a, "completed", 5000);
      expect(a.elapsedMs).toBe(4000);
    });
  });

  // ─── withElapsed ────────────────────────────────────────────────

  describe("withElapsed", () => {
    it("recomputes elapsedMs without changing state or timestamps", () => {
      const a = createAgentActivity("thinking", "inv-12", 1000);
      const b = withElapsed(a, 4000);
      expect(b.elapsedMs).toBe(3000);
      expect(b.state).toBe("thinking");
      expect(b.lastProgressAt).toBe(1000);
      expect(b.lastEventAt).toBe(1000);
    });

    it("returns a frozen record", () => {
      const a = createAgentActivity("thinking", "inv-13", 0);
      const b = withElapsed(a, 500);
      expect(Object.isFrozen(b)).toBe(true);
    });
  });

  // ─── Exhaustive switch ──────────────────────────────────────────

  describe("assertExhaustiveState", () => {
    it("returns undefined for every state (compile-time exhaustive check)", () => {
      for (const state of AGENT_ACTIVITY_STATES) {
        const result = assertExhaustiveState(state);
        expect(result).toBeUndefined();
      }
    });
  });

  // ─── Exhaustive-never type test ─────────────────────────────────

  it("exhaustive switch compiles without error", () => {
    // This is a type-level test: if a new state is added to the union
    // without updating the switch, TypeScript will error.
    function handler(state: AgentActivityState): string {
      switch (state) {
        case "thinking":
          return "Thinking…";
        case "streaming":
          return "Streaming…";
        case "tool_running":
          return "Running tool…";
        case "waiting_for_provider":
          return "Waiting…";
        case "verifying":
          return "Verifying…";
        case "summarizing":
          return "Summarizing…";
        case "possibly_stalled":
          return "Possibly stalled…";
        case "completed":
          return "Completed";
        case "failed":
          return "Failed";
        case "cancelled":
          return "Cancelled";
        default: {
          const exhaustive: never = state;
          return exhaustive;
        }
      }
    }

    // Verify each branch produces the expected string.
    expect(handler("thinking")).toBe("Thinking…");
    expect(handler("streaming")).toBe("Streaming…");
    expect(handler("tool_running")).toBe("Running tool…");
    expect(handler("waiting_for_provider")).toBe("Waiting…");
    expect(handler("verifying")).toBe("Verifying…");
    expect(handler("summarizing")).toBe("Summarizing…");
    expect(handler("possibly_stalled")).toBe("Possibly stalled…");
    expect(handler("completed")).toBe("Completed");
    expect(handler("failed")).toBe("Failed");
    expect(handler("cancelled")).toBe("Cancelled");
  });
});
