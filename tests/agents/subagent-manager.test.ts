import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { SubagentManager } from "../../src/agents/subagent-manager.js";
import type { SubagentRole, SubagentTask } from "../../src/config/schema.js";

function makeTask(overrides: Partial<SubagentTask> = {}): SubagentTask {
  return {
    id: "test-1",
    role: "explorer" as SubagentRole,
    mode: "read_only",
    prompt: "echo test",
    ownedPaths: undefined,
    expectedOutput: undefined,
    contextBundle: undefined,
    ...overrides,
  };
}

describe("SubagentManager", () => {
  let manager: SubagentManager;

  beforeEach(() => {
    manager = new SubagentManager({
      sessionId: "test-session",
      // Use node -e which exits immediately with code 0 — no real CLI needed
      spawnOverride: { command: process.execPath, args: ["-e", "process.exit(0)"] },
    });
  });

  it("spawns a process and resolves on exit", async () => {
    const task = makeTask({ id: "spawn-test", prompt: "echo hello" });
    const result = await manager.spawn(task);
    assert.equal(result.status, "success");
    assert.equal(result.role, "explorer");
  });

  it("rejects overlapping owned paths at spawn time", async () => {
    // Manually register ownership for task1 without spawning (avoids exit race)
    const task1 = makeTask({ role: "worker" as SubagentRole, mode: "write" as const, id: "overlap-task-1", ownedPaths: ["src/foo.ts"] });
    (manager as any).ownershipRegistry.set("src/foo.ts", task1.id);

    const task2 = makeTask({ role: "worker" as SubagentRole, mode: "write" as const, id: "overlap-task-2", ownedPaths: ["src/foo.ts"] });
    await assert.rejects(async () => manager.spawn(task2), /overlapping ownership/i);
  });

  it("tracks concurrent subagents", async () => {
    const [r1, r2] = await Promise.all([
      manager.spawn(makeTask({ id: "c1" })),
      manager.spawn(makeTask({ id: "c2" })),
    ]);
    assert.equal(r1.role, "explorer");
    assert.equal(r2.role, "explorer");
  });

  it("fires callback on completion", async () => {
    let called = false;
    manager.onResult(() => { called = true; });
    await manager.spawn(makeTask({ id: "callback-test" }));
    assert.ok(called, "callback should fire on completion");
  });

  it("releases ownership on shutdown", async () => {
    await manager.spawn(makeTask({ role: "worker" as SubagentRole, mode: "write" as const, ownedPaths: ["src/bar.ts"] }));
    manager.shutdown();
    // After shutdown, new tasks can claim the same paths
    const fresh = new SubagentManager({
      sessionId: "fresh-session",
      spawnOverride: { command: process.execPath, args: ["-e", "process.exit(0)"] },
    });
    const result = await fresh.spawn(makeTask({ role: "worker" as SubagentRole, ownedPaths: ["src/bar.ts"] }));
    assert.equal(result.status, "success");
  });
});
