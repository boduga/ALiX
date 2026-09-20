import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createCoordinationHandlers,
  COORDINATION_RUN_TOOL,
  COORDINATION_STATUS_TOOL,
  COORDINATION_LIST_TOOL,
  COORDINATION_RESULTS_TOOL,
} from "../../src/kernel/coordination-tools.js";
import { CoordinationStore } from "../../src/kernel/coordination-store.js";
import { createCoordinationRun, createWorkerAssignment } from "../../src/kernel/coordination-types.js";
import type { AlixConfig } from "../../src/config/schema.js";

function testConfig(): AlixConfig {
  return {
    version: 1,
    model: { provider: "test", name: "test-model" },
    permissions: {
      default: "ask",
      tools: {},
      protectedPaths: [],
      allowNetworkDomains: [],
      denyCommands: [],
      sessionMode: "bypass",
    },
    context: { repoMap: false, repoMapMode: "lite", maxRepoMapTokens: 0, semanticSearch: false, includeGitStatus: false, pinnedFiles: [] },
    runtime: { provider: "process", shell: "bash", commandTimeoutMs: 1000, envAllowlist: [] },
    ui: { enabled: false, host: "127.0.0.1", port: 0, transport: "sse" },
  } as unknown as AlixConfig;
}

describe("coordination chat tools", () => {
  let cwd: string;
  let store: CoordinationStore;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "coord-tools-"));
    store = new CoordinationStore(cwd);
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("exposes run/status/list/results handlers", () => {
    const handlers = createCoordinationHandlers({ cwd, config: testConfig(), store });
    assert.ok(typeof handlers[COORDINATION_RUN_TOOL] === "function");
    assert.ok(typeof handlers[COORDINATION_STATUS_TOOL] === "function");
    assert.ok(typeof handlers[COORDINATION_LIST_TOOL] === "function");
    assert.ok(typeof handlers[COORDINATION_RESULTS_TOOL] === "function");
  });

  it("run rejects a missing goal without planning", async () => {
    const handlers = createCoordinationHandlers({ cwd, config: testConfig(), store });
    const result = await handlers[COORDINATION_RUN_TOOL]({});
    assert.equal(result.kind, "error");
    assert.match(result.message ?? "", /goal/);
  });

  it("plans chat coordination runs in the active parent session", async () => {
    let plannedSessionId: string | undefined;
    const planner = {
      plan: async (goal: string, _coordinatorId: string, sessionId: string) => {
        plannedSessionId = sessionId;
        const run = createCoordinationRun({ sessionId, rootGoal: goal, coordinatorAgentId: "alix" });
        await store.save(run);
        return { valid: true, errors: [], run };
      },
    } as any;
    const handlers = createCoordinationHandlers({
      cwd, config: testConfig(), store, planner, sessionId: "tui-session-1",
    });

    const result = await handlers[COORDINATION_RUN_TOOL]({ goal: "coordinate test" });

    assert.equal(result.kind, "success");
    assert.equal(plannedSessionId, "tui-session-1");
    assert.equal((await store.list())[0]?.sessionId, "tui-session-1");
  });

  it("status reports workers by status and failures", async () => {
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "goal", coordinatorAgentId: "alix" });
    run.status = "failed";
    run.workers = [
      createWorkerAssignment({ coordinationRunId: run.id, agentId: "a", taskLabel: "Do A", goalPrompt: "do a", status: "completed" }),
      createWorkerAssignment({ coordinationRunId: run.id, agentId: "a", taskLabel: "Do B", goalPrompt: "do b", status: "failed", error: "boom" }),
    ];
    await store.save(run);

    const handlers = createCoordinationHandlers({ cwd, config: testConfig(), store });
    const result = await handlers[COORDINATION_STATUS_TOOL]({ runId: run.id });
    assert.equal(result.kind, "success");
    assert.match(result.output ?? "", /1 completed, 1 failed/);
    assert.match(result.output ?? "", /boom/);
  });

  it("status errors on unknown run id", async () => {
    const handlers = createCoordinationHandlers({ cwd, config: testConfig(), store });
    const result = await handlers[COORDINATION_STATUS_TOOL]({ runId: "coord_missing" });
    assert.equal(result.kind, "error");
    assert.match(result.message ?? "", /not found/);
  });

  it("results errors on unknown run id", async () => {
    const handlers = createCoordinationHandlers({ cwd, config: testConfig(), store });
    const result = await handlers[COORDINATION_RESULTS_TOOL]({ runId: "coord_missing" });
    assert.equal(result.kind, "error");
  });

  it("list reports no runs when empty", async () => {
    const handlers = createCoordinationHandlers({ cwd, config: testConfig(), store });
    const result = await handlers[COORDINATION_LIST_TOOL]({});
    assert.equal(result.kind, "success");
    assert.match(result.output ?? "", /No coordination runs/);
  });

  it("list returns recent runs newest first, bounded by limit", async () => {
    const older = createCoordinationRun({ sessionId: "s1", rootGoal: "older goal", coordinatorAgentId: "alix" });
    await store.save(older);
    await new Promise((r) => setTimeout(r, 10));
    const newer = createCoordinationRun({ sessionId: "s2", rootGoal: "newer goal", coordinatorAgentId: "alix" });
    await store.save(newer);

    const handlers = createCoordinationHandlers({ cwd, config: testConfig(), store });
    const result = await handlers[COORDINATION_LIST_TOOL]({ limit: 1 });
    assert.equal(result.kind, "success");
    assert.match(result.output ?? "", /newer goal/);
    assert.doesNotMatch(result.output ?? "", /older goal/);
  });
});
