import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDelegateHandler } from "../../src/agents/delegate-tool.js";

function makeMockManager(overrides: any = {}): any {
  return {
    spawn: async (task: any) => ({
      id: task.id, role: task.role, status: "success", findings: [], events: [],
      ...overrides,
    }),
  };
}

function makeMockBuildTask(): any {
  let counter = 0;
  return {
    buildTask: (opts: any) => ({ id: `task-${++counter}`, ...opts }),
  };
}

describe("Delegate tool", () => {
  it("returns success with findings when subagent succeeds", async () => {
    const manager = makeMockManager({
      status: "success",
      findings: [{ type: "summary", content: "Found 3 issues", confidence: "high", refs: [] }],
    });
    const handler = createDelegateHandler(manager, makeMockBuildTask().buildTask);
    const result = await handler({ role: "reviewer", prompt: "review auth" });
    assert.equal(result.kind, "success");
    assert.ok((result as any).output.includes("Found 3 issues"));
  });

  it("returns error when worker has no ownedPaths", async () => {
    const handler = createDelegateHandler(makeMockManager(), makeMockBuildTask().buildTask);
    const result = await handler({ role: "worker", prompt: "fix the bug" });
    assert.equal(result.kind, "error");
    assert.ok((result as any).message.includes("ownedPaths"));
  });

  it("returns error when subagent fails", async () => {
    const manager = makeMockManager({ status: "failed", error: "Model timeout" });
    const handler = createDelegateHandler(manager, makeMockBuildTask().buildTask);
    const result = await handler({ role: "explorer", prompt: "explore" });
    assert.equal(result.kind, "error");
    assert.ok((result as any).message.includes("Model timeout"));
  });

  it("returns success when no findings", async () => {
    const manager = makeMockManager({ status: "success", findings: [] });
    const handler = createDelegateHandler(manager, makeMockBuildTask().buildTask);
    const result = await handler({ role: "explorer", prompt: "look around" });
    assert.equal(result.kind, "success");
    assert.equal((result as any).output, "(no findings)");
  });
});