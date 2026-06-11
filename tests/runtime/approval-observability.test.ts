import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PolicyGate } from "../../src/policy/policy-gate.js";
import { ApprovalStore } from "../../src/approvals/approval-store.js";
import { ContinuationStore } from "../../src/runtime/continuation-store.js";
import { ContinuationManager } from "../../src/runtime/continuation-manager.js";
import type { AlixConfig } from "../../src/config/schema.js";

function makeConfig(overrides?: Partial<AlixConfig>): AlixConfig {
  const base: AlixConfig = {
    version: 1,
    model: { provider: "mock", name: "mock", streaming: false, maxIterations: 10, maxContextTokens: 32000 },
    permissions: {
      sessionMode: "ask",
      default: "ask",
      tools: {},
      protectedPaths: ["/etc/**", "/home/*/.ssh/**"],
      allowNetworkDomains: [],
      denyCommands: ["rm -rf /", "shutdown"],
    },
    context: { repoMap: false, repoMapMode: "lite", maxRepoMapTokens: 0, semanticSearch: false, includeGitStatus: false, pinnedFiles: [] },
    runtime: { provider: "process", shell: "/bin/bash", commandTimeoutMs: 10000, envAllowlist: [] },
    ui: { enabled: false, host: "", port: 0, transport: "sse" as const },
  };
  if (!overrides) return base;
  const merged = { ...base, ...overrides } as any;
  if (overrides.permissions) {
    merged.permissions = { ...base.permissions, ...overrides.permissions as any };
  }
  return merged as AlixConfig;
}

describe("Approval observability", () => {
  let tmpDir: string;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "approval-obs-"));
    mkdirSync(join(tmpDir, ".alix", "approvals"), { recursive: true });
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("approval.resolved event is emitted on approval", async () => {
    const events: any[] = [];
    const mockLog = { append: async (e: any) => { events.push(e); } } as any;

    const store = new ApprovalStore(tmpDir, { eventLog: mockLog });
    await store.load();

    const approval = await store.request({ reason: "test", capability: "file.read" });
    await store.resolve(approval.id, "approved", "User approved");

    const resolvedEvents = events.filter(e => e.type === "approval.resolved");
    assert.ok(resolvedEvents.length > 0);
    assert.equal(resolvedEvents[0].payload.approvalId, approval.id);
    assert.equal(resolvedEvents[0].payload.status, "approved");
  });

  it("approval.resolved event is emitted on denial", async () => {
    const events: any[] = [];
    const mockLog = { append: async (e: any) => { events.push(e); } } as any;

    const store = new ApprovalStore(tmpDir, { eventLog: mockLog });
    await store.load();

    const approval = await store.request({ reason: "test deny", capability: "shell.run" });
    await store.resolve(approval.id, "denied", "User denied");

    const resolvedEvents = events.filter(e => e.type === "approval.resolved");
    const denied = resolvedEvents.find(e => e.payload.status === "denied");
    assert.ok(denied);
    assert.equal(denied.payload.approvalId, approval.id);
  });

  it("PolicyGate emits approval.created on ask decision with eventLog", async () => {
    const events: any[] = [];
    const mockLog = { append: async (e: any) => { events.push(e); } } as any;
    // Isolated store directory to avoid finding resolved approvals from other tests
    const pgTmpDir = mkdtempSync(join(tmpdir(), "pg-obs-"));
    mkdirSync(join(pgTmpDir, ".alix", "approvals"), { recursive: true });
    try {
      const store = new ApprovalStore(pgTmpDir);
      await store.load();

      const config = makeConfig({ permissions: { tools: { "shell.run": "ask" } } as any });
      const gate = new PolicyGate(config, { eventLog: mockLog, approvalStore: store });

      const result = await gate.evaluateToolCall({
        requestId: "obs-test-1",
        toolName: "shell.run",
        args: { command: "echo hello" },
        cwd: "/tmp",
        sessionMode: "ask",
        sessionId: "sess_test",
        source: "tool",
      });

      assert.equal(result.decision, "ask");
      const createdEvent = events.find(e => e.type === "approval.created");
      assert.ok(createdEvent, "Expected approval.created event");
      assert.equal(createdEvent.payload.capability, "shell.run");
      assert.equal(createdEvent.payload.toolName, "shell.run");
      assert.equal(createdEvent.payload.status, "pending");
    } finally {
      rmSync(pgTmpDir, { recursive: true, force: true });
    }
  });

  it("ContinuationManager emits approval.resumed on successful resume", async () => {
    const events: any[] = [];
    const mockLog = { append: async (e: any) => { events.push(e); } } as any;

    const store = new ApprovalStore(tmpDir);
    await store.load();
    const contStore = new ContinuationStore(tmpDir);
    await contStore.load();

    const approval = await store.request({ reason: "test", capability: "shell.run" });
    await store.resolve(approval.id, "approved", "ok");

    const { hashArgs } = await import("../../src/tools/executor.js");
    const args = { command: "echo done" };
    await contStore.persist({
      approvalId: approval.id,
      kind: "tool",
      sessionId: "sess_test",
      cwd: tmpDir,
      toolCall: { toolCallId: "tc_resume_obs", name: "shell.run", capability: "shell.run", args, argsHash: hashArgs(args) },
      createdAt: new Date().toISOString(),
    });

    const mgr = new ContinuationManager({
      continuationStore: contStore,
      approvalStore: store,
      eventLog: mockLog,
      executeTool: async () => ({ kind: "success", output: "ok" }),
    });

    const result = await mgr.resumeApproved(approval.id);
    assert.equal(result.resumed, true);

    const resumedEvent = events.find(e => e.type === "approval.resumed");
    assert.ok(resumedEvent, "Expected approval.resumed event");
    assert.equal(resumedEvent.payload.approvalId, approval.id);
    assert.equal(resumedEvent.payload.status, "resumed");

    const consumedEvent = events.find(e => e.type === "continuation.consumed");
    assert.ok(consumedEvent, "Expected continuation.consumed event");
  });
});
