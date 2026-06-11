import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ReplayExecutor } from "../../src/runtime/replay-executor.js";
import { buildReplayPreview } from "../../src/runtime/replay-preview.js";
import { buildReplayPlan } from "../../src/runtime/replay-plan.js";
import type { TraceEvent } from "../../src/runtime/trace-events.js";
import { EventLog } from "../../src/events/event-log.js";

function makeEvent(overrides: Partial<TraceEvent>): TraceEvent {
  return {
    id: "e1", timestamp: "2026-06-11T12:00:00Z",
    sourceType: "tool", eventType: "tool.started",
    label: "shell.run started", status: "running",
    ...overrides,
  };
}

describe("ReplayExecutor dry-run mode", () => {
  let tmpDir: string;
  let eventLog: EventLog;
  let executor: ReplayExecutor;

  before(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "replay-test-"));
    const logDir = join(tmpDir, ".alix", "sessions", "test-session");
    mkdirSync(logDir, { recursive: true });
    eventLog = new EventLog(logDir);
    await eventLog.init();
    executor = new ReplayExecutor(tmpDir, eventLog);
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("executes dry-run file.read (read passes through)", async () => {
    const testFile = join(tmpDir, "test.txt");
    writeFileSync(testFile, "hello world");
    const events = [
      makeEvent({ id: "e1", eventType: "file.read", label: "file.read test.txt", toolName: "file.read",
        toolCallId: "tc1", rawEvent: { payload: { toolName: "file.read", args: { path: "test.txt" } } } }),
    ];
    const preview = buildReplayPreview(events[0], events);
    const plan = buildReplayPlan(preview, events, "dry-run");
    const result = await executor.execute(plan);
    assert.equal(result.mode, "dry-run");
    assert.ok(result.steps.length > 0);
    // file.read should complete because it's read-only
    const readStep = result.steps.find(s => s.toolName === "file.read");
    assert.ok(readStep);
    assert.equal(readStep.status, "completed");
    // Test that the file still exists (no side effects)
    assert.ok(existsSync(testFile));
  });

  it("executes dry-run file.create (simulated, no file written)", async () => {
    const newFilePath = join(tmpDir, "new.txt");
    const events = [
      makeEvent({ id: "e1", eventType: "file.create", label: "file.create new.txt", toolName: "file.create",
        toolCallId: "tc1", rawEvent: { payload: { toolName: "file.create", args: { path: "new.txt", content: "new content" } } } }),
    ];
    const preview = buildReplayPreview(events[0], events);
    const plan = buildReplayPlan(preview, events, "dry-run");
    const result = await executor.execute(plan);
    const createStep = result.steps.find(s => s.toolName === "file.create");
    assert.ok(createStep);
    assert.equal(createStep.status, "completed");
    // File must NOT exist in dry-run mode
    assert.equal(existsSync(newFilePath), false);
    // Output should contain dry-run marker
    assert.ok(createStep.output?.includes("[DRY-RUN]"));
  });

  it("executes dry-run shell.run (simulated, no command run)", async () => {
    const events = [
      makeEvent({ id: "e1", eventType: "shell.run", label: "shell.run ls", toolName: "shell.run",
        toolCallId: "tc1", rawEvent: { payload: { toolName: "shell.run", args: { command: "echo hello" } } } }),
    ];
    const preview = buildReplayPreview(events[0], events);
    const plan = buildReplayPlan(preview, events, "dry-run");
    const result = await executor.execute(plan);
    const shellStep = result.steps.find(s => s.toolName === "shell.run");
    assert.ok(shellStep);
    assert.equal(shellStep.status, "completed");
    assert.ok(shellStep.output?.includes("[DRY-RUN]"));
  });

  it("blocks network tools in dry-run mode", async () => {
    const events = [
      makeEvent({ id: "e1", eventType: "web_search", label: "web_search started", toolName: "web_search",
        toolCallId: "tc1", rawEvent: { payload: { toolName: "web_search", args: { query: "test" } } } }),
    ];
    const preview = buildReplayPreview(events[0], events);
    const plan = buildReplayPlan(preview, events, "dry-run");
    const result = await executor.execute(plan);
    const webStep = result.steps.find(s => s.toolName === "web_search");
    assert.ok(webStep);
    assert.equal(webStep.status, "blocked");
  });
});

describe("ReplayExecutor sandbox mode", () => {
  let tmpDir: string;
  let eventLog: EventLog;
  let executor: ReplayExecutor;

  before(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "replay-test-sandbox-"));
    const logDir = join(tmpDir, ".alix", "sessions", "test-session");
    mkdirSync(logDir, { recursive: true });
    eventLog = new EventLog(logDir);
    await eventLog.init();
    executor = new ReplayExecutor(tmpDir, eventLog);
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("executes sandbox shell.run in temp dir", async () => {
    // Write a file in the real cwd
    writeFileSync(join(tmpDir, "real.txt"), "real data");
    const events = [
      makeEvent({ id: "e1", eventType: "shell.run", label: "shell.run ls", toolName: "shell.run",
        toolCallId: "tc1", rawEvent: { payload: { toolName: "shell.run", args: { command: "ls" } } } }),
    ];
    const preview = buildReplayPreview(events[0], events);
    const plan = buildReplayPlan(preview, events, "sandbox");
    const result = await executor.execute(plan);
    const shellStep = result.steps.find(s => s.toolName === "shell.run");
    assert.ok(shellStep);
    assert.equal(shellStep.status, "completed");
    // Shell ran but in sandbox dir — output should NOT show real.txt
    assert.ok(!shellStep.output?.includes("real.txt") || shellStep.output === "");
  });

  it("sandbox temp dir is cleaned up after execution", async () => {
    const executor2 = new ReplayExecutor(tmpDir, eventLog);
    const events = [
      makeEvent({ id: "e1", eventType: "shell.run", label: "shell.run pwd", toolName: "shell.run",
        toolCallId: "tc1", rawEvent: { payload: { toolName: "shell.run", args: { command: "pwd" } } } }),
    ];
    const preview = buildReplayPreview(events[0], events);
    const plan = buildReplayPlan(preview, events, "sandbox");
    const result = await executor2.execute(plan);
    // Sandbox dir should be cleaned up inside execute()
    assert.equal(result.mode, "sandbox");
    // Verify no leftover sandbox dirs
    const tmpFiles = readdirSync(tmpdir()).filter(f => f.startsWith("alix-replay-"));
    // There should be no alix-replay dirs (they get cleaned up)
    assert.equal(tmpFiles.length, 0);
  });

  it("blocks mcp tools in sandbox mode", async () => {
    const events = [
      makeEvent({ id: "e1", eventType: "mcp.github.list_issues", label: "mcp.github.list_issues", toolName: "mcp.github.list_issues",
        toolCallId: "tc1", rawEvent: { payload: { toolName: "mcp.github.list_issues", args: {} } } }),
    ];
    const preview = buildReplayPreview(events[0], events);
    const plan = buildReplayPlan(preview, events, "sandbox");
    const result = await executor.execute(plan);
    const mcpStep = result.steps.find(s => s.toolName?.startsWith("mcp."));
    assert.ok(mcpStep);
    assert.equal(mcpStep.status, "blocked");
  });
});

describe("ReplayExecutor approved-live mode", () => {
  let tmpDir: string;
  let eventLog: EventLog;
  let executor: ReplayExecutor;
  let approvalStore: any;

  before(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "replay-test-approve-"));
    const logDir = join(tmpDir, ".alix", "sessions", "test-session");
    mkdirSync(logDir, { recursive: true });
    eventLog = new EventLog(logDir);
    await eventLog.init();
    executor = new ReplayExecutor(tmpDir, eventLog);
    const { ApprovalStore } = await import("../../src/approvals/approval-store.js");
    approvalStore = new ApprovalStore(tmpDir);
    await approvalStore.load();
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("executes read-only file.read after PolicyGate allow without approval", async () => {
    const testFile = join(tmpDir, "test.txt");
    writeFileSync(testFile, "hello world");
    const events = [
      makeEvent({ id: "e1", eventType: "file.read", label: "file.read test.txt", toolName: "file.read",
        toolCallId: "tc1", rawEvent: { payload: { toolName: "file.read", args: { path: "test.txt" } } } }),
    ];
    const preview = buildReplayPreview(events[0], events);
    const plan = buildReplayPlan(preview, events, "approved-live");
    assert.ok(plan.replayId);
    const result = await executor.execute(plan, { approvalStore });
    const readStep = result.steps.find(s => s.toolName === "file.read");
    assert.ok(readStep);
    assert.equal(readStep.status, "completed");
    assert.ok(readStep.output?.includes("hello world"));
    assert.equal(result.replayId, plan.replayId);
  });

  it("blocks side-effecting tool when approval is pending", async () => {
    const events = [
      makeEvent({ id: "e1", eventType: "shell.run", label: "shell.run ls", toolName: "shell.run",
        toolCallId: "tc1", rawEvent: { payload: { toolName: "shell.run", args: { command: "ls" } } } }),
    ];
    const preview = buildReplayPreview(events[0], events);
    const plan = buildReplayPlan(preview, events, "approved-live");
    const result = await executor.execute(plan, { approvalStore });
    const shellStep = result.steps.find(s => s.toolName === "shell.run");
    assert.ok(shellStep);
    assert.equal(shellStep.status, "blocked");
    const pending = approvalStore.listPending();
    assert.ok(pending.length > 0);
    const replayApproval = pending.find((a: any) => (a.reason || "").includes(plan.replayId!));
    assert.ok(replayApproval);
  });

  it("executes side-effecting tool after approval is granted", async () => {
    const newFilePath = join(tmpDir, "approved-new.txt");
    const events = [
      makeEvent({ id: "e1", eventType: "file.create", label: "file.create test.txt", toolName: "file.create",
        toolCallId: "tc1", rawEvent: { payload: { toolName: "file.create", args: { path: "approved-new.txt", content: "approved content" } } } }),
    ];
    const preview = buildReplayPreview(events[0], events);
    const plan = buildReplayPlan(preview, events, "approved-live");

    // First attempt — no approval yet, should be blocked
    const result1 = await executor.execute(plan, { approvalStore });
    const step1 = result1.steps.find(s => s.toolName === "file.create");
    assert.ok(step1);
    assert.equal(step1.status, "blocked");
    assert.equal(existsSync(newFilePath), false);

    // Resolve all pending approvals
    const pending = approvalStore.listPending();
    for (const a of pending) {
      await approvalStore.resolve(a.id, "approved");
    }

    // Second attempt — approvals now granted
    const result2 = await executor.execute(plan, { approvalStore });
    const step2 = result2.steps.find(s => s.toolName === "file.create");
    assert.ok(step2);
    assert.equal(step2.status, "completed");
    assert.equal(existsSync(newFilePath), true);
    const content = readFileSync(newFilePath, "utf-8");
    assert.equal(content, "approved content");
  });

  it("returns replayId in result for approved-live mode", async () => {
    const events = [
      makeEvent({ id: "e1", eventType: "file.read", label: "file.read", toolName: "file.read",
        toolCallId: "tc1", rawEvent: { payload: { toolName: "file.read", args: { path: "test.txt" } } } }),
    ];
    const preview = buildReplayPreview(events[0], events);
    const plan = buildReplayPlan(preview, events, "approved-live");
    const result = await executor.execute(plan, { approvalStore });
    assert.ok(result.replayId);
    assert.ok(result.replayId!.startsWith("replay_"));
  });

  it("captures diff for file.create during approved-live replay", async () => {
    const { ReplayDiffStore } = await import("../../src/runtime/replay-diff-store.js");
    const diffStore = new ReplayDiffStore(tmpDir);
    const newFilePath = join(tmpDir, "diff-captured.txt");
    const events = [
      makeEvent({ id: "e1", eventType: "file.create", label: "file.create test.txt", toolName: "file.create",
        toolCallId: "tc1", rawEvent: { payload: { toolName: "file.create", args: { path: "diff-captured.txt", content: "diff captured content" } } } }),
    ];
    const preview = buildReplayPreview(events[0], events);
    const plan = buildReplayPlan(preview, events, "approved-live");

    // Resolve any pending approvals
    const pending = approvalStore.listPending();
    for (const a of pending) {
      await approvalStore.resolve(a.id, "approved");
    }

    const result = await executor.execute(plan, { approvalStore, diffStore });
    const createStep = result.steps.find(s => s.toolName === "file.create");
    assert.ok(createStep);
    assert.equal(createStep.status, "completed");

    // Verify diff was captured
    const index = await diffStore.loadIndex(plan.replayId!);
    assert.ok(index);
    assert.ok(index!.records.length >= 1);
    const record = index!.records.find(r => r.filePath === "diff-captured.txt");
    assert.ok(record);
    assert.equal(record!.changeType, "created");
    assert.equal(record!.rollbackable, false);
    assert.equal(existsSync(newFilePath), true);
    assert.equal(readFileSync(newFilePath, "utf-8"), "diff captured content");

    // Verify directory structure
    const replayDir = join(tmpDir, ".alix", "replays", plan.replayId!);
    assert.ok(existsSync(replayDir));
    assert.ok(existsSync(join(replayDir, "index.json")));
  });
});
