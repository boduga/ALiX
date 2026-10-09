// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * R1.5 — authorization containment regression suite.
 *
 * Every state-changing path must fail closed without a verifiable
 * authorization envelope:
 *  - Graph execution enforces by default (no opt-in) and reruns are gated.
 *  - Continuation resumes require a durable, still-valid approval.
 *  - file.delete honors declared ownership scope (router second net).
 *  - X-series synthesized approvals are never recorded as operator source.
 *
 * @module r15-authorization
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("R1.5 authorization containment", () => {
  it("graph execution enforces capabilities by default (no opt-in)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "alix-r15-graph-"));
    try {
      const graphsDir = join(dir, ".alix", "graphs");
      await mkdir(graphsDir, { recursive: true });
      await writeFile(join(graphsDir, "g1.json"), JSON.stringify({
        id: "g1", schemaVersion: "1.0", workflowId: "wf", rootGoal: "test",
        status: "ready", strategy: "sequential",
        nodes: [{
          id: "n1", graphId: "g1", title: "N", goal: "do", domain: "general",
          status: "pending", dependencies: [], requiredCapabilities: ["nonexistent.cap"],
          riskLevel: "low", approvalMode: "auto", inputs: {}, artifacts: [],
          memoryRefs: [], createdAt: "2026-01-01", updatedAt: "2026-01-01",
        }],
        edges: [], createdAt: "2026-01-01", updatedAt: "2026-01-01",
      }));
      const { GraphExecutor } = await import("../../src/kernel/graph-executor.js");
      // No policyGate/config wired — enforcement ON by default must BLOCK,
      // not silently run the node.
      const exec = new GraphExecutor(dir);
      const result = await exec.execute("g1");
      const node = result.results[0];
      assert.equal(node.status, "blocked");
      assert.match(node.reason ?? "", /Policy gate or config not provided/);
      assert.equal(result.graphStatus, "failed");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rerunNode requires fresh authorization before executing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "alix-r15-rerun-"));
    try {
      const graphsDir = join(dir, ".alix", "graphs");
      await mkdir(graphsDir, { recursive: true });
      await writeFile(join(graphsDir, "g1.json"), JSON.stringify({
        id: "g1", schemaVersion: "1.0", workflowId: "wf", rootGoal: "test",
        status: "failed", strategy: "sequential",
        nodes: [{
          id: "n1", graphId: "g1", title: "N", goal: "do", domain: "general",
          status: "failed", dependencies: [], requiredCapabilities: ["nonexistent.cap"],
          riskLevel: "low", approvalMode: "auto", inputs: {}, artifacts: [],
          memoryRefs: [], createdAt: "2026-01-01", updatedAt: "2026-01-01",
        }],
        edges: [], createdAt: "2026-01-01", updatedAt: "2026-01-01",
      }));
      const { GraphExecutor } = await import("../../src/kernel/graph-executor.js");
      const exec = new GraphExecutor(dir);
      const result = await exec.rerunNode("g1", "n1");
      // Gate blocks the rerun instead of reaching runTask ungoverned.
      assert.equal(result.status, "blocked");
      assert.match(result.reason ?? "", /Policy gate or config not provided/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("continuation-resume without a durable approval is denied (fail closed)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "alix-r15-cont-"));
    try {
      const { ToolExecutor } = await import("../../src/tools/executor.js");
      const { DEFAULT_CONFIG } = await import("../../src/config/defaults.js");
      const { EventLog } = await import("../../src/events/event-log.js");
      const log = new EventLog(dir);
      await log.init();
      const executor = new ToolExecutor(DEFAULT_CONFIG, log, dir);

      // 1. source set but no approvalId → not authorization.
      const noApproval = await executor.execute({
        toolCallId: "c1", name: "file.read", args: { path: "x.txt" },
        source: "continuation-resume",
        executionId: "e", invocationId: "i",
      });
      assert.equal(noApproval.kind, "denied");
      assert.match((noApproval as { reason: string }).reason, /no durable approval/);

      // 2. approvalId claimed but no store to back it → still denied.
      const noStore = await executor.execute({
        toolCallId: "c2", name: "file.read", args: { path: "x.txt" },
        source: "continuation-resume", approvalId: "apr-1",
        executionId: "e", invocationId: "i",
      });
      assert.equal(noStore.kind, "denied");
      assert.match((noStore as { reason: string }).reason, /missing, not approved, or expired/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("continuation-resume with a valid durable approval passes the auth check", async () => {
    const dir = await mkdtemp(join(tmpdir(), "alix-r15-cont-ok-"));
    try {
      await writeFile(join(dir, "ok.txt"), "hello");
      const { ToolExecutor } = await import("../../src/tools/executor.js");
      const { DEFAULT_CONFIG } = await import("../../src/config/defaults.js");
      const { EventLog } = await import("../../src/events/event-log.js");
      const log = new EventLog(dir);
      await log.init();
      const fakeStore = {
        get: (id: string) => (id === "apr-ok"
          ? { id, status: "approved", expiresAt: new Date(Date.now() + 60_000).toISOString() }
          : undefined),
      };
      const executor = new ToolExecutor(DEFAULT_CONFIG, log, dir, undefined, undefined, undefined, undefined, fakeStore);
      const result = await executor.execute({
        toolCallId: "c3", name: "file.read", args: { path: "ok.txt" },
        source: "continuation-resume", approvalId: "apr-ok",
        executionId: "e", invocationId: "i",
      });
      assert.equal(result.kind, "success");

      // Expired approval → denied even though status says approved.
      const fakeExpired = {
        get: (id: string) => (id === "apr-old"
          ? { id, status: "approved", expiresAt: new Date(Date.now() - 1000).toISOString() }
          : undefined),
      };
      const executor2 = new ToolExecutor(DEFAULT_CONFIG, log, dir, undefined, undefined, undefined, undefined, fakeExpired);
      const expired = await executor2.execute({
        toolCallId: "c4", name: "file.read", args: { path: "ok.txt" },
        source: "continuation-resume", approvalId: "apr-old",
        executionId: "e", invocationId: "i",
      });
      assert.equal(expired.kind, "denied");
      assert.match((expired as { reason: string }).reason, /missing, not approved, or expired/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("file.delete honors declared ownership scope (router second net)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "alix-r15-del-"));
    try {
      await writeFile(join(dir, "mine.txt"), "a");
      await writeFile(join(dir, "theirs.txt"), "b");
      const { FileToolRouter } = await import("../../src/tools/tool-router.js");
      const router = new FileToolRouter(dir);

      // Owned scope covers mine.txt → delete allowed.
      const allowed = await router.execute({
        toolCallId: "d1", name: "file.delete",
        args: { path: "mine.txt" }, ownedPaths: ["mine.txt"],
      } as never);
      assert.equal(allowed.kind, "success");

      // Declared scope does NOT cover theirs.txt → fail closed.
      const denied = await router.execute({
        toolCallId: "d2", name: "file.delete",
        args: { path: "theirs.txt" }, ownedPaths: ["mine.txt"],
      } as never);
      assert.equal(denied.kind, "error");
      assert.match((denied as { message: string }).message, /outside owned scope/);

      // No ownership regime (operator, empty ownedPaths) → unchanged behavior.
      await writeFile(join(dir, "plain.txt"), "c");
      const operator = await router.execute({
        toolCallId: "d3", name: "file.delete",
        args: { path: "plain.txt" }, ownedPaths: [],
      } as never);
      assert.equal(operator.kind, "success");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("bound-tool authorization is governed by the PolicyGate, not ungoverned (R1.5)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "alix-r15-bound-"));
    try {
      const { EventLog } = await import("../../src/events/event-log.js");
      const { createToolExecutor } = await import("../../src/tools/tool-executor-factory.js");
      const log = new EventLog(join(dir, ".alix", "sessions", "s1"));
      await log.init();
      // Hermetic minimal config — the test must not require a configured model
      // or credentials (CI has none).
      const config = {
        permissions: {
          sessionMode: "bypass" as "bypass" | "ask",
          allowNetworkDomains: [] as string[],
          protectedPaths: [] as string[],
          tools: {} as Record<string, boolean>,
        },
        models: {},
      };
      const executor = createToolExecutor({
        config: config as unknown as import("../../src/config/schema.js").AlixConfig,
        log,
        root: dir,
      });
      const request = {
        toolCallId: "tc-bound-1",
        name: "alix_collaboration_publish_finding",
        args: { finding: "x" },
        sessionId: "s1",
        agentId: "worker-7",
      };

      // Bypass mode: the gate is consulted and allows.
      config.permissions.sessionMode = "bypass";
      assert.equal((await executor.authorizeBoundTool(request)).decision, "allow");

      // Ask mode with NO durable approval store must NOT silently allow — the
      // bound tool is governed, not executed ungoverned.
      config.permissions.sessionMode = "ask";
      const gated = await executor.authorizeBoundTool(request);
      assert.notEqual(gated.decision, "allow", "ask without a store fails closed, never silent allow");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("synthesized approvals carry system authorization source, never operator", async () => {
    const { createExecutionIntent } = await import("../../src/runtime/execution-intent-factory.js");
    const route = { kind: "direct" as const, prompt: "hello" };

    const synthesized = createExecutionIntent(route as never, { now: "2026-01-01T00:00:00.000Z" });
    assert.equal(synthesized.authorizationSource, "system");
    assert.ok(synthesized.approvalReference.startsWith("auto:"), "synthesized reference stays auto-tagged");

    const withRef = createExecutionIntent(route as never, {
      now: "2026-01-01T00:00:00.000Z", approvalReference: "apr-real",
    });
    assert.equal(withRef.authorizationSource, "policy");

    const operator = createExecutionIntent(route as never, {
      now: "2026-01-01T00:00:00.000Z",
      approvalReference: "apr-real", approvedBy: "human", authorizationSource: "operator",
    });
    assert.equal(operator.authorizationSource, "operator");
  });
});
