/**
 * Browser projection vocabulary tests (R4/V10).
 *
 * `src/interfaces/ui/projection.js` is a plain-JS module served statically (no build), so
 * it carries no TypeScript declarations. The `@ts-expect-error` import keeps it
 * importable from this typed lane. These tests are the running-lane coverage the
 * prior `tests/ui/*.test.js` files never had (they were `.js` and no lane
 * compiled or ran them), which is how the dead `context.bundle_created` read
 * survived.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error plain-JS browser module without TypeScript declarations
import { buildUiProjection, projectSubagentEvents, createReplayState, visibleEventsForReplay } from "../../src/interfaces/ui/projection.js";

type Event = { seq: number; type: string; actor?: string; payload?: Record<string, unknown>; timestamp: string };
const evt = (seq: number, type: string, payload: Record<string, unknown> = {}, actor = "system"): Event => ({
  seq, type, actor, payload, timestamp: `2026-01-01T00:00:${String(seq).padStart(2, "0")}Z`,
});

describe("buildUiProjection", () => {
  it("derives panel counts and terminal rows from raw events", () => {
    const projection = buildUiProjection([
      evt(1, "session.started"),
      evt(2, "tool.requested", { toolCallId: "s1", toolName: "shell.run", argsPreview: { command: "npm test" } }),
      evt(3, "tool.completed", { toolCallId: "s1", toolName: "shell.run", status: "success", outputPreview: "ok" }),
      evt(4, "verification.check_finished", { command: "npm test", status: "passed" }),
    ]);
    expect(projection.summary.eventCount).toBe(4);
    expect(projection.summary.toolCount).toBe(2);
    expect(projection.terminal[0].command).toBe("npm test");
    expect(projection.verification[0].status).toBe("passed");
  });

  it("reads the canonical context.bundle_compiled event (R4/V10)", () => {
    const projection = buildUiProjection([
      evt(1, "context.bundle_compiled", { bundleId: "b1", primaryFiles: [{ path: "src/a.ts", kind: "source" }] }),
    ]);
    expect(projection.context.bundle.bundleId).toBe("b1");
    expect(projection.context.bundle.primaryFiles).toHaveLength(1);
  });

  it("keeps context.bundle_created as a legacy fallback", () => {
    const projection = buildUiProjection([evt(1, "context.bundle_created", { bundleId: "legacy", primaryFiles: [] })]);
    expect(projection.context.bundle.bundleId).toBe("legacy");
  });

  it("extracts diff, patch status, policy, and token data", () => {
    const projection = buildUiProjection([
      evt(1, "tool.completed", { toolCallId: "p1", toolName: "patch.apply", changedFiles: ["a.ts"] }),
      evt(2, "patch.proposed", { proposalId: "pr1" }, "agent"),
      evt(3, "patch.applied", { proposalId: "pr1" }),
      evt(4, "patch.rolled_back", { proposalId: "pr2" }),
      evt(5, "policy.decision", { toolCallId: "c1", decision: "allow", reason: "ok", capability: "read" }, "policy"),
      evt(6, "model.usage", { provider: "anthropic", inputTokens: 100, outputTokens: 20 }, "agent"),
    ]);
    expect(projection.diffs[0].changedFiles[0]).toBe("a.ts");
    expect(projection.patches.map((p: { status: string }) => p.status)).toEqual(["proposed", "applied", "rolled_back"]);
    expect(projection.policyDecisions[0].decision).toBe("allow");
    expect(projection.tokens.totalInputTokens).toBe(100);
    expect(projection.tokens.totalOutputTokens).toBe(20);
  });
});

describe("replay state", () => {
  it("sorts events by seq and exposes the visible prefix", () => {
    const state = createReplayState([
      evt(3, "session.ended"),
      evt(1, "session.started"),
      evt(2, "tool.requested"),
    ]);
    expect(state.events.map((e: Event) => e.seq)).toEqual([1, 2, 3]);
    expect(state.cursor).toBe(3);
    state.cursor = 2;
    expect(visibleEventsForReplay(state).map((e: Event) => e.seq)).toEqual([1, 2]);
  });
});

describe("projectSubagentEvents (R4/V10)", () => {
  it("projects the canonical agent.* lifecycle with role, status, and duration", () => {
    const projected = projectSubagentEvents([
      evt(1, "agent.spawned", { agentId: "a1", role: "worker" }, "subagent"),
      evt(2, "agent.completed", { agentId: "a1", role: "worker" }, "subagent"),
    ]);
    expect(projected.map((e: { type: string }) => e.type)).toEqual(["agent.spawned", "agent.completed"]);
    expect(projected[0].subagentId).toBe("a1");
    expect(projected[0].role).toBe("worker");
    expect(projected[1].status).toBe("success");
    expect(projected[1].duration).toBe(1000);
  });

  it("prefers canonical agent.* over legacy subagent.* when both are emitted", () => {
    const projected = projectSubagentEvents([
      evt(1, "subagent.started", { subagentId: "a1", role: "worker" }, "subagent"),
      evt(2, "agent.spawned", { agentId: "a1", role: "worker" }, "subagent"),
      evt(3, "subagent.completed", { subagentId: "a1", role: "worker" }, "subagent"),
      evt(4, "agent.completed", { agentId: "a1", role: "worker" }, "subagent"),
    ]);
    expect(projected.map((e: { type: string }) => e.type)).toEqual(["agent.spawned", "agent.completed"]);
  });

  it("falls back to the legacy subagent.* vocabulary for older logs", () => {
    const projected = projectSubagentEvents([
      evt(1, "subagent.started", { subagentId: "a1", role: "worker" }, "subagent"),
      evt(2, "subagent.completed", { subagentId: "a1", role: "worker" }, "subagent"),
    ]);
    expect(projected.map((e: { type: string }) => e.type)).toEqual(["subagent.started", "subagent.completed"]);
    expect(projected[1].status).toBe("success");
  });

  it("ignores a main-agent agent.state_changed that carries no agent id", () => {
    const projected = projectSubagentEvents([
      evt(1, "agent.state_changed", { state: "thinking", reason: "loop" }, "system"),
      evt(2, "subagent.started", { subagentId: "a1", role: "worker" }, "subagent"),
      evt(3, "subagent.completed", { subagentId: "a1", role: "worker" }, "subagent"),
    ]);
    expect(projected.map((e: { type: string }) => e.type)).toEqual(["subagent.started", "subagent.completed"]);
  });

  it("shows only canonical subagent rows when a main-agent state change coexists", () => {
    const projected = projectSubagentEvents([
      evt(1, "agent.state_changed", { state: "thinking" }, "system"),
      evt(2, "agent.spawned", { agentId: "a1", role: "worker" }, "subagent"),
      evt(3, "agent.completed", { agentId: "a1", role: "worker" }, "subagent"),
    ]);
    expect(projected.map((e: { type: string }) => e.type)).toEqual(["agent.spawned", "agent.completed"]);
    expect(projected[0].subagentId).toBe("a1");
  });
});
