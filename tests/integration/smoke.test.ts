/**
 * integration.test.ts — End-to-end smoke tests for core ALiX subsystems.
 *
 * Tests daemon lifecycle, policy eval, RuntimeIndex, approval store,
 * audit store, and registry loading without requiring external providers.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Integration: Daemon lifecycle", () => {
  let tmpDir: string;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "int-daemon-"));
    mkdirSync(join(tmpDir, ".alix"), { recursive: true });
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("DaemonManager returns null when never started", async () => {
    const { DaemonManager } = await import("../../src/daemon/daemon-manager.js");
    const mgr = new DaemonManager(tmpDir);
    const status = await mgr.status();
    assert.equal(status, null);
    assert.equal(await mgr.isRunning(), false);
  });

  it("stop does not throw when daemon not running", async () => {
    const { DaemonManager } = await import("../../src/daemon/daemon-manager.js");
    const mgr = new DaemonManager(tmpDir);
    await mgr.stop(); // should not throw
  });

  it("DaemonManager reads written status file", async () => {
    const { DaemonManager } = await import("../../src/daemon/daemon-manager.js");
    writeFileSync(join(tmpDir, ".alix", "daemon.json"), JSON.stringify({
      pid: 99999, startedAt: "2026-01-01T00:00:00Z", socketPath: "/tmp/test.sock",
      status: "running", lastHeartbeat: "2026-01-01T00:00:30Z",
    }));
    const mgr = new DaemonManager(tmpDir);
    const status = await mgr.status();
    assert.ok(status);
    assert.equal(status!.pid, 99999);
    assert.equal(status!.status, "running");
    assert.ok(status!.lastHeartbeat);
  });
});

describe("Integration: Policy eval", () => {
  it("RuleEvaluator defaults to deny", async () => {
    const { RuleEvaluator } = await import("../../src/policy/rule-evaluator.js");
    const e = new RuleEvaluator();
    const result = e.evaluate({ capability: "nonexistent" });
    assert.equal(result.decision, "deny");
  });

  it("Default policies allow web.search", async () => {
    const { defaultPolicyRules } = await import("../../src/policy/default-policies.js");
    const { RuleEvaluator } = await import("../../src/policy/rule-evaluator.js");
    const e = new RuleEvaluator(defaultPolicyRules());
    assert.equal(e.evaluate({ capability: "web.search" }).decision, "allow");
    assert.equal(e.evaluate({ capability: "shell.exec" }).decision, "ask");
  });

  it("validatePolicyRule rejects empty rule", async () => {
    const { validatePolicyRule } = await import("../../src/policy/policy-rule.js");
    const result = validatePolicyRule({ id: "", description: "", match: {}, decision: "allow", enabled: true });
    assert.equal(result.valid, false);
  });
});

describe("Integration: TaskRegistry", () => {
  it("creates, updates, and persists tasks", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "int-taskreg-"));
    try {
      const { TaskRegistry } = await import("../../src/daemon/task-registry.js");

      const r1 = new TaskRegistry(tmpDir);
      await r1.load();
      const t = r1.create("integration test");
      r1.update(t.id, { status: "running", sessionId: "sess_1", startedAt: new Date().toISOString() });
      r1.update(t.id, { status: "completed" });
      await new Promise(r => setTimeout(r, 100));

      const r2 = new TaskRegistry(tmpDir);
      await r2.load();
      const tasks = r2.list();
      assert.equal(tasks.length, 1);
      assert.equal(tasks[0].status, "completed");
      assert.equal(tasks[0].task, "integration test");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("reconcileOnStartup marks running as failed_orphaned", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "int-recon-"));
    try {
      const { TaskRegistry } = await import("../../src/daemon/task-registry.js");
      const reg = new TaskRegistry(tmpDir);
      await reg.load();
      const t = reg.create("orphaned task");
      reg.update(t.id, { status: "running" });
      reg.reconcileOnStartup();
      assert.equal(reg.get(t.id)!.status, "failed_orphaned");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("Integration: RuntimeIndex", () => {
  it("indexes multiple sources", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "int-index-"));
    try {
      // Seed audit + approval + graph data
      mkdirSync(join(tmpDir, ".alix", "audit"), { recursive: true });
      mkdirSync(join(tmpDir, ".alix", "approvals"), { recursive: true });
      mkdirSync(join(tmpDir, ".alix", "graphs"), { recursive: true });
      writeFileSync(join(tmpDir, ".alix", "audit", "audit.jsonl"),
        `{"id":"aud_1","action":"policy.allowed","timestamp":"2026-01-01T00:00:00Z","details":{"capability":"web.search"}}\n`);
      writeFileSync(join(tmpDir, ".alix", "approvals", "approvals.json"),
        JSON.stringify([{ id: "app_1", status: "approved", createdAt: "2026-01-01T00:00:00Z", reason: "ok", capability: "shell.exec" }]));
      writeFileSync(join(tmpDir, ".alix", "graphs", "graph_a.json"),
        JSON.stringify({ id: "graph_a", status: "completed", nodes: [{ id: "n1", status: "done", title: "Node 1" }] }));

      const { buildRuntimeIndex } = await import("../../src/runtime/runtime-index.js");
      const idx = await buildRuntimeIndex(tmpDir);
      assert.ok(idx.events.length >= 3); // audit + approval + graph + node
      assert.ok(idx.byAction("policy.allowed").length >= 1);
      assert.ok(idx.byGraph("graph_a").length >= 1);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("Integration: Approval store", () => {
  it("creates and resolves approvals", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "int-approval-"));
    try {
      const { ApprovalStore } = await import("../../src/approvals/approval-store.js");
      const store = new ApprovalStore(tmpDir);
      await store.load();
      const a = await store.request({ reason: "test", capability: "shell.exec" });
      assert.equal(a.status, "pending");
      const resolved = await store.resolve(a.id, "approved", "Looks good");
      assert.equal(resolved!.status, "approved");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("Integration: Audit store", () => {
  it("appends and lists audit records", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "int-audit-"));
    try {
      const { AuditStore } = await import("../../src/audit/audit-store.js");
      const store = new AuditStore(tmpDir);
      await store.append({ action: "policy.allowed", details: { capability: "web.search" } });
      await store.append({ action: "approval.approved", details: { approvalId: "app_1" } });
      const list = await store.list();
      assert.equal(list.length, 2);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("Integration: Card registry", () => {
  it("loads default cards", async () => {
    const { loadCardRegistry, defaultAgentCards, defaultToolCards } = await import("../../src/registry/card-loader.js");
    const tmpDir = mkdtempSync(join(tmpdir(), "int-cards-"));
    try {
      const reg = await loadCardRegistry(tmpDir);
      assert.equal(reg.listAgents().length, defaultAgentCards().length);
      assert.equal(reg.listTools().length, defaultToolCards().length);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("resolveCapabilities finds web.search tool", async () => {
    const { CardRegistry } = await import("../../src/registry/card-registry.js");
    const { resolveCapabilities } = await import("../../src/registry/capability-resolver.js");
    const reg = new CardRegistry();
    reg.registerTool({
      id: "web_search", name: "Web Search", description: "Search tool",
      version: "1.0.0", capabilities: ["web.search"], riskLevel: "low",
      approvalMode: "auto", sideEffects: "read", enabled: true,
    });
    const result = resolveCapabilities({ requiredCapabilities: ["web.search"], registry: reg });
    assert.equal(result.missingCapabilities.length, 0);
  });
});
