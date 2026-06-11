import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildReplayPlan } from "../../src/runtime/replay-plan.js";
import { buildReplayPreview } from "../../src/runtime/replay-preview.js";
import type { TraceEvent } from "../../src/runtime/trace-events.js";

function makeEvent(overrides: Partial<TraceEvent>): TraceEvent {
  return {
    id: "e1", timestamp: "2026-06-11T12:00:00Z",
    sourceType: "tool", eventType: "tool.started",
    label: "shell.run started", status: "running",
    ...overrides,
  };
}

describe("buildReplayPlan", () => {
  it("builds an executable plan from a tool chain preview", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "policy.decision", status: "allowed", sourceType: "policy", label: "policy: shell.run", toolCallId: "tc1" }),
      makeEvent({ id: "e2", eventType: "tool.started", status: "running", label: "shell.run started", toolCallId: "tc1", rawEvent: { payload: { toolCallId: "tc1", toolName: "shell.run", args: { command: "ls -la" }, argsHash: "abc123" } } }),
      makeEvent({ id: "e3", eventType: "tool.completed", status: "success", label: "shell.run completed", toolCallId: "tc1", timestamp: "2026-06-11T12:00:01Z" }),
    ];
    const preview = buildReplayPreview(events[1], events);
    const plan = buildReplayPlan(preview, events, "dry-run");
    assert.equal(plan.mode, "dry-run");
    assert.ok(plan.executable);
    assert.ok(plan.steps.length > 0);
    assert.equal(plan.toolCount, 1);
  });

  it("marks network tools as blocked in dry-run mode", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "tool.started", label: "web_search started", toolCallId: "tc1", rawEvent: { payload: { toolCallId: "tc1", toolName: "web_search", args: { query: "test" } } } }),
    ];
    const preview = buildReplayPreview(events[0], events);
    const plan = buildReplayPlan(preview, events, "dry-run");
    assert.ok(plan.steps.length > 0);
    const webStep = plan.steps.find(s => s.toolName === "web_search");
    assert.ok(webStep);
    assert.equal(webStep.status, "blocked");
    assert.ok(webStep.blockReason?.includes("not available"));
  });

  it("marks mcp tools as blocked in sandbox mode", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "tool.started", label: "mcp.github.list_issues started", toolCallId: "tc1", rawEvent: { payload: { toolCallId: "tc1", toolName: "mcp.github.list_issues", args: {} } } }),
    ];
    const preview = buildReplayPreview(events[0], events);
    const plan = buildReplayPlan(preview, events, "sandbox");
    assert.ok(plan.steps.length > 0);
    const mcpStep = plan.steps.find(s => s.toolName?.startsWith("mcp."));
    assert.ok(mcpStep);
    assert.equal(mcpStep.status, "blocked");
  });

  it("marks denied approval chain as blocked", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "approval.created", sourceType: "approval", label: "approval created", approvalId: "app_1" }),
      makeEvent({ id: "e2", eventType: "approval.resolved", status: "denied", sourceType: "approval", label: "approval denied", approvalId: "app_1", timestamp: "2026-06-11T12:01:00Z" }),
    ];
    const preview = buildReplayPreview(events[0], events);
    const plan = buildReplayPlan(preview, events, "dry-run");
    assert.equal(plan.executable, false);
    assert.ok(plan.reason?.includes("denied"));
  });

  it("does not duplicate blocked steps from preview warnings", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "session.started", sourceType: "session", label: "session started" }),
    ];
    const preview = buildReplayPreview(events[0], events);
    const plan = buildReplayPlan(preview, events, "dry-run");
    assert.equal(plan.executable, false);
    assert.ok(plan.toolCount === 0);
  });

  it("builds plan with replayId for approved-live mode", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "tool.started", label: "shell.run", toolCallId: "tc1",
        rawEvent: { payload: { toolName: "shell.run", args: { command: "ls" } } } }),
    ];
    const preview = buildReplayPreview(events[0], events);
    const plan = buildReplayPlan(preview, events, "approved-live");
    assert.equal(plan.mode, "approved-live");
    assert.ok(plan.replayId);
    assert.ok(plan.replayId!.startsWith("replay_"));
  });

  it("allows network tools in approved-live mode", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "tool.started", label: "web_search", toolName: "web_search",
        toolCallId: "tc1", rawEvent: { payload: { toolName: "web_search", args: { query: "test" } } } }),
    ];
    const preview = buildReplayPreview(events[0], events);
    const plan = buildReplayPlan(preview, events, "approved-live");
    const webStep = plan.steps.find(s => s.toolName === "web_search");
    assert.ok(webStep);
    assert.equal(webStep.status, "ready");
  });
});
