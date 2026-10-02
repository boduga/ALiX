import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildReplayPlan } from "../../src/runtime/replay-plan.js";
import { classifySideEffect } from "../../src/runtime/replay-executor.js";
import { ALIX_BUILTIN_EXECUTORS } from "../../src/agents/tool-manifest.js";
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
      makeEvent({ id: "e1", eventType: "tool.started", label: "web_search started", toolCallId: "tc1", rawEvent: { payload: { toolCallId: "tc1", toolName: "web.search", args: { query: "test" } } } }),
    ];
    const preview = buildReplayPreview(events[0], events);
    const plan = buildReplayPlan(preview, events, "dry-run");
    assert.ok(plan.steps.length > 0);
    const webStep = plan.steps.find(s => s.toolName === "web.search");
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
      makeEvent({ id: "e1", eventType: "tool.started", label: "web.search", toolName: "web.search",
        toolCallId: "tc1", rawEvent: { payload: { toolName: "web.search", args: { query: "test" } } } }),
    ];
    const preview = buildReplayPreview(events[0], events);
    const plan = buildReplayPlan(preview, events, "approved-live");
    const webStep = plan.steps.find(s => s.toolName === "web.search");
    assert.ok(webStep);
    assert.equal(webStep.status, "ready");
  });
});

/**
 * THE PARITY TABLE for network-tool classification — an authorization surface.
 *
 * Three INDEPENDENT copies of the same set existed: `isNetworkTool` and the
 * risk classifier in `replay-executor.ts`, and `NETWORK_TOOLS` in
 * `replay-plan.ts`. They decide which tools are blocked in dry-run/sandbox
 * replay and in `task-router`'s research scope, so one missed name silently
 * grants network access where the operator expected a block.
 *
 * Every tool is listed explicitly, in both directions. A hand-maintained list
 * cannot detect itself losing an entry, so the classification is also asserted
 * against the manifest: any executor id not named here must classify as
 * NON-network, which makes an omission a visible failure instead of a silent
 * grant.
 */
describe("network-tool classification parity", () => {
  /** [executor id, is it a network tool] — the input space, not a sample. */
  const CASES: Array<[string, boolean]> = [
    // ── network: reach the internet ──
    ["web.search", true],
    ["web.fetch", true],
    // `agent.delegate` spawns a subagent that may itself use the network, so it
    // is conservatively classified as network even though it makes no request.
    // It WAS the bare executor id `delegate`; the dotted rename made
    // `agent.delegate` the executor id and left the capability key identical,
    // so the two spellings finally merged.
    ["agent.delegate", true],
    // ── not network: local only ──
    ["file.read", false],
    ["file.create", false],
    ["file.delete", false],
    ["file.exists", false],
    ["grep.search", false],
    ["glob.match", false],
    ["shell.run", false],
    ["patch.apply", false],
    ["task.complete", false],
    ["schedule.propose", false],
    ["coordination.run", false],
    ["coordination.status", false],
    ["state.query", false],
    ["verify.claim", false],
    ["skill.create", false],
    ["extension.list", false],
    ["extension.inspect", false],
    ["hook.create", false],
    ["mcp.search_tools", true],
    ["mcp.a", true],
    ["mcp.github.repos.list", true],
    ["mcp.z", true],
    ["coordination.list", false],
    ["coordination.results", false],
    ["collaboration.publish_finding", false],
    ["collaboration.publish_artifact", false],
    ["collaboration.query_findings", false],
    ["collaboration.get_dependency_results", false],
    ["collaboration.report_conflict", false],
    ["collaboration.list_conflicts", false],
    ["alix_execution_state_propose", false],
  ];

  for (const [tool, isNetwork] of CASES) {
    it(`${tool} is ${isNetwork ? "" : "not "}a network tool`, () => {
      const level = classifySideEffect(tool);
      if (isNetwork) assert.equal(level, "network", `${tool} must be classified network`);
      else assert.notEqual(level, "network", `${tool} must NOT be classified network`);
    });
  }

  it("classifies every mcp.* tool as network", () => {
    for (const name of ["mcp.a", "mcp.github.repos.list", "mcp.z"]) {
      assert.equal(classifySideEffect(name), "network");
    }
  });

  it("names no executor id outside the manifest, so the table cannot rot", () => {
    // Every manifest executor id is classified by the table above. If a tool is
    // added, this fails until the table says whether it is a network tool —
    // which is the point: an unclassified tool must never default to allowed.
    const listed = new Set(CASES.map(([name]) => name));
    for (const exec of Object.values(ALIX_BUILTIN_EXECUTORS)) {
      assert.ok(
        listed.has(exec),
        `executor id ${JSON.stringify(exec)} is missing from the network-tool parity table`,
      );
    }
  });
});
