import { describe, it, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { SubagentManager } from "../../src/agents/subagent-manager.js";
import type { AlixConfig, SubagentRole, SubagentTask } from "../../src/config/schema.js";

/** Minimal subagent tier config so getRoleModel doesn't throw. */
const TEST_SUBAGENT_CFG: AlixConfig["subagents"] = {
  enabled: true,
  roles: [
    { role: "explorer", mode: "read_only", style: "fast", retryCount: 1 },
    { role: "worker", mode: "write", style: "coding", retryCount: 0 },
  ],
  fast: { provider: "ollama", name: "llama3.2:3b" },
  coding: { provider: "ollama", name: "llama3.2:3b" },
  thinking: { provider: "ollama", name: "llama3.2:3b" },
  critic: { provider: "ollama", name: "llama3.2:3b" },
};

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
      config: { subagents: TEST_SUBAGENT_CFG } as AlixConfig,
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
      config: { subagents: TEST_SUBAGENT_CFG } as AlixConfig,
      spawnOverride: { command: process.execPath, args: ["-e", "process.exit(0)"] },
    });
    const result = await fresh.spawn(makeTask({ role: "worker" as SubagentRole, ownedPaths: ["src/bar.ts"] }));
    assert.equal(result.status, "success");
  });
});

test("manager resolves with the child's failed status instead of overriding to success", async () => {
  const manager = new SubagentManager({
    sessionId: "s1",
    config: { subagents: TEST_SUBAGENT_CFG } as AlixConfig,
    spawnOverride: {
      command: process.execPath,
      args: ["-e", `console.log(JSON.stringify({ id: "w", role: "worker", status: "failed", findings: [], events: [], error: "write blocked" })); process.exit(1);`],
    },
  });
  const result = await manager.spawn({
    id: "w", role: "worker", mode: "write", ownedPaths: ["src"], prompt: "fix", contextBundle: "s1",
  });
  assert.equal(result.status, "failed");
  assert.equal(result.error, "write blocked");
});

test("manager resolves with failed status even on exit 0 when the child reports failed", async () => {
  const manager = new SubagentManager({
    sessionId: "s1",
    config: { subagents: TEST_SUBAGENT_CFG } as AlixConfig,
    spawnOverride: {
      command: process.execPath,
      args: ["-e", `console.log(JSON.stringify({ id: "w", role: "worker", status: "failed", findings: [], events: [], error: "no writes applied" })); process.exit(0);`],
    },
  });
  const result = await manager.spawn({
    id: "w", role: "worker", mode: "write", ownedPaths: ["src"], prompt: "fix", contextBundle: "s1",
  });
  assert.equal(result.status, "failed");
});

test("manager preserves child-reported partial status on exit 1", async () => {
  const manager = new SubagentManager({
    sessionId: "s1",
    config: { subagents: TEST_SUBAGENT_CFG } as AlixConfig,
    spawnOverride: {
      command: process.execPath,
      args: ["-e", `console.log(JSON.stringify({ id: "w", role: "worker", status: "partial", findings: [], events: [], error: "delegated objective incomplete" })); process.exit(1);`],
    },
  });
  const result = await manager.spawn({
    id: "w", role: "worker", mode: "write", ownedPaths: ["src"], prompt: "fix", contextBundle: "s1",
  });
  assert.equal(result.status, "partial");
});

test("manager preserves child-reported partial status on exit 0", async () => {
  const manager = new SubagentManager({
    sessionId: "s1",
    config: { subagents: TEST_SUBAGENT_CFG } as AlixConfig,
    spawnOverride: {
      command: process.execPath,
      args: ["-e", `console.log(JSON.stringify({ id: "w", role: "worker", status: "partial", findings: [], events: [], error: "delegated objective incomplete" })); process.exit(0);`],
    },
  });
  const result = await manager.spawn({
    id: "w", role: "worker", mode: "write", ownedPaths: ["src"], prompt: "fix", contextBundle: "s1",
  });
  assert.equal(result.status, "partial");
});

test("manager emits partial once without rewriting it as completed state", async () => {
  const emitted: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const manager = new SubagentManager({
    sessionId: "s1",
    config: { subagents: TEST_SUBAGENT_CFG } as AlixConfig,
    eventLog: { append: (entry: any) => { emitted.push(entry); return Promise.resolve(entry); } } as any,
    spawnOverride: {
      command: process.execPath,
      args: ["-e", `console.log(JSON.stringify({ id: "w", role: "worker", status: "partial", findings: [], events: [], error: "incomplete" }));`],
    },
  });

  await manager.spawn(makeTask({ id: "w", role: "worker", mode: "write" }));
  const terminal = emitted.filter((entry) => entry.type === "agent.completed" || entry.type === "agent.failed" || entry.type === "agent.cancelled");
  assert.deepEqual(terminal.map((entry) => [entry.type, entry.payload.state]), [["agent.completed", "partial"]]);
});

test("manager shutdown emits cancellation without a later failed terminal", async () => {
  const emitted: Array<{ type: string }> = [];
  const manager = new SubagentManager({
    sessionId: "s1",
    config: { subagents: TEST_SUBAGENT_CFG } as AlixConfig,
    eventLog: { append: (entry: any) => { emitted.push(entry); return Promise.resolve(entry); } } as any,
    spawnOverride: { command: process.execPath, args: ["-e", "setInterval(() => {}, 1000)"] },
  });

  const result = manager.spawn(makeTask({ id: "cancelled" }));
  manager.shutdown();
  await assert.rejects(result);
  await new Promise((resolve) => setImmediate(resolve));
  const terminal = emitted.filter((entry) => entry.type === "agent.completed" || entry.type === "agent.failed" || entry.type === "agent.cancelled");
  assert.deepEqual(terminal.map((entry) => entry.type), ["agent.cancelled"]);
});

test("spawned subagent inherits the secret-service bus address but not ambient secrets", async () => {
  // Regression: delegate children re-run loadConfig, which resolves cred://
  // through the OS keychain (libsecret on Linux). The scrubbed child env
  // dropped DBUS_SESSION_BUS_ADDRESS/XDG_RUNTIME_DIR, so every delegate call
  // died with "Credential not found" even though the parent resolved fine.
  const saved: NodeJS.ProcessEnv = {};
  for (const k of ["DBUS_SESSION_BUS_ADDRESS", "XDG_RUNTIME_DIR", "ALIX_TEST_SENTINEL_SECRET"]) {
    if (k in process.env) saved[k] = process.env[k];
  }
  process.env.DBUS_SESSION_BUS_ADDRESS = "unix:path=/run/user/1000/bus";
  process.env.XDG_RUNTIME_DIR = "/run/user/1000";
  process.env.ALIX_TEST_SENTINEL_SECRET = "s3cret-must-not-propagate";
  try {
    const manager = new SubagentManager({
      sessionId: "s1",
      config: { subagents: TEST_SUBAGENT_CFG } as AlixConfig,
      spawnOverride: {
        command: process.execPath,
        args: ["-e", `console.log(JSON.stringify({ id: "env-probe", role: "explorer", status: "success", findings: ["DBUS=" + (process.env.DBUS_SESSION_BUS_ADDRESS ?? "<absent>"), "XDG=" + (process.env.XDG_RUNTIME_DIR ?? "<absent>"), "SECRET=" + ("ALIX_TEST_SENTINEL_SECRET" in process.env ? process.env.ALIX_TEST_SENTINEL_SECRET : "<absent>")], events: [] }));`],
      },
    });
    const result = await manager.spawn(makeTask({ id: "env-probe" }));
    assert.equal(result.status, "success");
    const findings = result.findings as unknown as string[];
    assert.ok(
      findings.some((f) => f === "DBUS=unix:path=/run/user/1000/bus"),
      "bus address must reach the child: " + JSON.stringify(findings),
    );
    assert.ok(
      findings.some((f) => f === "XDG=/run/user/1000"),
      "runtime dir must reach the child: " + JSON.stringify(findings),
    );
    assert.ok(
      findings.every((f) => !f.includes("s3cret")),
      "ambient secret values must not propagate: " + JSON.stringify(findings),
    );
  } finally {
    for (const k of ["DBUS_SESSION_BUS_ADDRESS", "XDG_RUNTIME_DIR", "ALIX_TEST_SENTINEL_SECRET"]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
});
