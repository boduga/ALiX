import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ToolExecutor } from "../src/capabilities/tools/executor.js";
import { DEFAULT_CONFIG, PERMIT_ALL_CONFIG } from "../src/operations/config/defaults.js";
import { EventLog } from "../src/runtime-state/events/event-log.js";
import type { AlixConfig } from "../src/operations/config/schema.js";

const TEST_CORRELATION = { executionId: "exec-test", invocationId: "inv-test" } as const;

test("file.read allowed by default policy", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-exec-"));
  try {
    const log = new EventLog(dir);
    await log.init();
    const executor = new ToolExecutor(DEFAULT_CONFIG, log, dir);
    const result = await executor.execute({ toolCallId: "1", name: "file.read", args: { root: dir, path: "README.md" }, ...TEST_CORRELATION });
    assert.notEqual(result.kind, "denied"); // may be error (not found) but not denied
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("shell.run with denied command returns denied", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-exec-"));
  try {
    const log = new EventLog(dir);
    await log.init();
    const executor = new ToolExecutor(DEFAULT_CONFIG, log, dir);
    const result = await executor.execute({ toolCallId: "2", name: "shell.run", args: { command: "rm -rf /", cwd: dir, timeoutMs: 5000 }, ...TEST_CORRELATION });
    assert.equal(result.kind, "denied");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("safe shell bypass cannot read a parent path", async () => {
  const parent = await mkdtemp(join(tmpdir(), "alix-exec-parent-"));
  const dir = join(parent, "workspace");
  try {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(dir);
    await writeFile(join(parent, "secret.txt"), "secret");
    const log = new EventLog(dir);
    await log.init();
    const executor = new ToolExecutor(DEFAULT_CONFIG, log, dir);
    const result = await executor.execute({
      toolCallId: "safe-traversal",
      name: "shell.run",
      args: { command: "cat ../secret.txt" },
      ...TEST_CORRELATION,
    });
    assert.equal(result.kind, "error");
    assert.match(result.message, /outside workspace/);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("shell.run uses the configured workspace as cwd when cwd is omitted", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-exec-"));
  try {
    await writeFile(join(dir, "root-marker.txt"), "marker");
    const log = new EventLog(dir);
    await log.init();
    const executor = new ToolExecutor(PERMIT_ALL_CONFIG, log, dir);
    const result = await executor.execute({ toolCallId: "3", name: "shell.run", args: { command: "pwd && ls", timeoutMs: 5000 }, ...TEST_CORRELATION });

    assert.equal(result.kind, "success");
    assert.ok((result as any).output.includes(dir));
    assert.ok((result as any).output.includes("root-marker.txt"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("file.create creates file and preserves agent identity on lifecycle events", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-exec-"));
  try {
    const log = new EventLog(dir);
    await log.init();
    const executor = new ToolExecutor(PERMIT_ALL_CONFIG, log, dir);
    const result = await executor.execute({ toolCallId: "1", name: "file.create", args: { path: "hello.txt", content: "world" }, agentId: "agent-1", ...TEST_CORRELATION });
    assert.equal(result.kind, "success");
    assert.equal((result as any).createdPath, "hello.txt");
    const content = await readFile(join(dir, "hello.txt"), "utf8");
    assert.equal(content, "world");
    const events = (await log.readAll()).filter((event) => event.type.startsWith("tool."));
    assert.ok(events.some((event) => event.type === "tool.started"));
    assert.ok(events.some((event) => event.type === "tool.completed"));
    assert.ok(events.every((event) => (event.payload as Record<string, unknown>).agentId === "agent-1"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("file.create cannot silently change an explicit task target", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-exec-"));
  try {
    const log = new EventLog(dir);
    await log.init();
    const executor = new ToolExecutor(PERMIT_ALL_CONFIG, log, dir);
    const result = await executor.execute({
      toolCallId: "strict-target",
      name: "file.create",
      args: { path: "fallback.txt", content: "wrong target" },
      allowedMutationPaths: ["/tmp/requested.txt"],
      ...TEST_CORRELATION,
    });
    assert.equal(result.kind, "error");
    assert.match(result.message, /explicitly requested target/);
    assert.equal(existsSync(join(dir, "fallback.txt")), false);
    const events = await log.readAll();
    assert.ok(events.some((event) => event.type === "tool.failed" && (event.payload as any).toolCallId === "strict-target"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("file.delete removes existing file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-exec-"));
  try {
    await writeFile(join(dir, "to-delete.txt"), "old content");
    const log = new EventLog(dir);
    await log.init();
    const executor = new ToolExecutor(PERMIT_ALL_CONFIG, log, dir);
    const result = await executor.execute({ toolCallId: "1", name: "file.delete", args: { path: "to-delete.txt" }, ...TEST_CORRELATION });
    assert.equal(result.kind, "success");
    assert.equal((result as any).deletedPath, "to-delete.txt");
    assert.ok(!(await existsSync(join(dir, "to-delete.txt"))));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("executor auto-approves an owned-path write for a subagent with ownedPaths", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-exec-"));
  try {
    const log = new EventLog(dir);
    await log.init();
    const executor = new ToolExecutor(DEFAULT_CONFIG, log, dir, undefined, undefined, undefined, undefined, undefined, undefined, undefined, ["src"]);
    const result = await executor.execute({ toolCallId: "t1", name: "file.create", args: { path: "src/new.ts", content: "// hi" }, ...TEST_CORRELATION });
    assert.equal(result.kind, "success");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("executor denies a write outside ownedPaths with the owned-path reason", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-exec-"));
  try {
    const log = new EventLog(dir);
    await log.init();
    const executor = new ToolExecutor(DEFAULT_CONFIG, log, dir, undefined, undefined, undefined, undefined, undefined, undefined, undefined, ["src"]);
    const result = await executor.execute({ toolCallId: "t2", name: "file.create", args: { path: "config.json", content: "{}" }, ...TEST_CORRELATION });
    assert.equal(result.kind, "denied");
    assert.match(result.reason, /outside owned paths/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("executor denies an out-of-scope owned write under a bypass session mode", async () => {
  // The owned-path rule used to be unreachable whenever the capability's
  // permission resolved to "allow" — which is every write under auto/bypass
  // session modes. A worker scoped to one file could then write anywhere in
  // the workspace (observed on a real gpt-4o coordination run).
  const dir = await mkdtemp(join(tmpdir(), "alix-exec-"));
  try {
    const log = new EventLog(dir);
    await log.init();
    const config = {
      ...DEFAULT_CONFIG,
      permissions: { ...DEFAULT_CONFIG.permissions, sessionMode: "bypass" as const },
    } as AlixConfig;
    const executor = new ToolExecutor(config, log, dir, undefined, undefined, undefined, undefined, undefined, undefined, undefined, ["src"]);
    const result = await executor.execute({ toolCallId: "t3", name: "file.create", args: { path: "config.json", content: "{}" }, ...TEST_CORRELATION });
    assert.equal(result.kind, "denied");
    assert.match(result.reason, /outside owned paths/);
    assert.equal(existsSync(join(dir, "config.json")), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── D1: the safe-shell bypass must still honour a mandatory deny ──────
//
// Independent Gate E review defect D1. The bypass existed to skip the APPROVAL
// gate for read-only commands, but it returned before authorization entirely, so
// a command named in `denyCommands` still executed as long as isSafeShellCommand
// said yes. `ls` is both safe and deniable, which is the exact overlap.
//
// This test fails if the mandatory-deny check is removed: the command then runs
// and the result is a success rather than a denial.
test("D1: a denyCommands entry still denies through the safe-shell bypass", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-exec-d1-"));
  try {
    const log = new EventLog(dir);
    await log.init();
    // `ls` is a SAFE_SHELL_COMMANDS entry AND explicitly denied: the two sets
    // overlap, which is what made the bypass a deny bypass.
    const config: AlixConfig = {
      ...DEFAULT_CONFIG,
      permissions: {
        ...DEFAULT_CONFIG.permissions,
        sessionMode: "ask" as const,
        denyCommands: ["ls"],
      },
    };
    const executor = new ToolExecutor(config, log, dir);
    const result = await executor.execute({
      toolCallId: "d1-deny",
      name: "shell.run",
      args: { command: "ls", cwd: dir, timeoutMs: 5000 },
      ...TEST_CORRELATION,
    });
    assert.notEqual(result.kind, "success", "a denied command must not succeed");
    assert.equal(result.kind, "error");
    // `message`, not a nonexistent `error` field: ToolResult's error branch is
    // {kind, message}. Asserting `.error` locked in a shape that rendered as
    // "Error: undefined" downstream.
    assert.match(String((result as { message?: string }).message ?? ""), /denied by policy/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("D1: a non-denied safe command still bypasses approvals", async () => {
  // The narrowing must not turn the bypass off. `echo` is safe and not denied,
  // so it must still execute without an approval prompt in ask mode.
  const dir = await mkdtemp(join(tmpdir(), "alix-exec-d1-ok-"));
  try {
    const log = new EventLog(dir);
    await log.init();
    const executor = new ToolExecutor(DEFAULT_CONFIG, log, dir);
    const result = await executor.execute({
      toolCallId: "d1-allow",
      name: "shell.run",
      args: { command: "echo d1-ok", cwd: dir, timeoutMs: 5000 },
      ...TEST_CORRELATION,
    });
    assert.equal(result.kind, "success", JSON.stringify(result));
    assert.match(String((result as { output?: string }).output ?? ""), /d1-ok/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── Vacuous #10: the continuation-resume ownership check ──────────────
//
// The cited test called `checkOwnershipGate` directly, so it would still pass if
// the executor's continuation branch stopped calling it (Gate E review,
// vacuous assertion #10). These drive the EXECUTOR through that branch, so
// removing the call at executor.ts fails them.
test("continuation-resume still enforces ownership through the executor", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-exec-cont-"));
  try {
    const log = new EventLog(dir);
    await log.init();
    const config = {
      ...DEFAULT_CONFIG,
      permissions: { ...DEFAULT_CONFIG.permissions, sessionMode: "bypass" as const },
    } as AlixConfig;
    const executor = new ToolExecutor(
      config, log, dir,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      ["src"],
    );
    const result = await executor.execute({
      toolCallId: "cont-1",
      name: "file.create",
      args: { path: "config.json", content: "{}" },
      source: "continuation-resume",
      ...TEST_CORRELATION,
    } as never);
    // No durable approval backs this, so the continuation branch fails closed
    // before ownership is even consulted. Either refusal is correct; a SUCCESS
    // is the defect.
    assert.notEqual(result.kind, "success", JSON.stringify(result));
    assert.equal(existsSync(join(dir, "config.json")), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("continuation-resume DENIES an out-of-scope owned write once approval is valid", async () => {
  // This is the case that actually reaches executor.ts's continuation ownership
  // check: a real, approved, unexpired backing record. Without the ownership
  // call the write would be allowed, so this test fails when that call is
  // removed. The two tests above only prove the branch fails closed earlier.
  const dir = await mkdtemp(join(tmpdir(), "alix-exec-cont3-"));
  try {
    const log = new EventLog(dir);
    await log.init();
    const { ApprovalStore } = await import("../src/governance/approvals/approval-store.js");
    const store = new ApprovalStore(dir);
    await store.load();
    const created = await store.request({
      reason: "continuation test",
      requestedBy: "test",
      capability: "file.write",
      capabilities: ["file.write"],
    } as never);
    await store.resolve(created.id, "approved", "operator");

    const config = {
      ...DEFAULT_CONFIG,
      permissions: { ...DEFAULT_CONFIG.permissions, sessionMode: "bypass" as const },
    } as AlixConfig;
    const executor = new ToolExecutor(
      config, log, dir,
      undefined, undefined, undefined, undefined,
      store,
      new (await import("../src/runtime-state/runtime/workspace-path.js")).WorkspacePathResolver(dir, []),
      new (await import("../src/coordination/ownership/ownership-registry.js")).OwnershipRegistry(dir),
      ["src"],
    );
    const result = await executor.execute({
      toolCallId: "cont-3",
      name: "file.create",
      args: { path: "outside.ts", content: "x" },
      source: "continuation-resume",
      approvalId: created.id,
      ...TEST_CORRELATION,
    } as never);
    assert.notEqual(result.kind, "success", "an out-of-scope owned write must not succeed");
    // The refusal must come from the OWNED-SCOPE rule, not incidentally from an
    // invocation-binding mismatch. Asserting only "not success" let the previous
    // version of this test pass with the ownership call deleted.
    assert.match(
      JSON.stringify(result),
      /outside owned paths/,
      `expected an owned-scope refusal, got ${JSON.stringify(result)}`,
    );
    assert.equal(existsSync(join(dir, "outside.ts")), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("continuation-resume cannot authorize an owned out-of-scope write", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-exec-cont2-"));
  try {
    const log = new EventLog(dir);
    await log.init();
    const config = {
      ...DEFAULT_CONFIG,
      permissions: { ...DEFAULT_CONFIG.permissions, sessionMode: "bypass" as const },
    } as AlixConfig;
    const executor = new ToolExecutor(
      config, log, dir,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      ["src"],
    );
    const result = await executor.execute({
      toolCallId: "cont-2",
      name: "file.create",
      args: { path: "outside.ts", content: "x" },
      source: "continuation-resume",
      approvalId: "nonexistent-approval",
      ...TEST_CORRELATION,
    } as never);
    assert.equal(result.kind, "denied");
    assert.equal(existsSync(join(dir, "outside.ts")), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
