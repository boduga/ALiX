import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { join } from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { EventLog } from "../../src/events/event-log.js";
import { ToolExecutor } from "../../src/tools/executor.js";
import type { AlixConfig } from "../../src/config/schema.js";

describe("Tool Executor Events", () => {
  const testDir = join(process.cwd(), ".test-tool-executor-events");
  let eventLog: EventLog;

  const config: AlixConfig = {
    version: 1,
    model: {
      provider: "mock",
      name: "test-model",
    },
    permissions: {
      default: "allow",
      tools: {},
      protectedPaths: [],
      allowNetworkDomains: [],
      denyCommands: [],
    },
    context: {
      repoMap: false,
      repoMapMode: "lite",
      maxRepoMapTokens: 1000,
      semanticSearch: false,
      includeGitStatus: false,
      pinnedFiles: [],
    },
    runtime: {
      provider: "process",
      shell: "/bin/sh",
      commandTimeoutMs: 30000,
      envAllowlist: [],
    },
    ui: {
      enabled: false,
      host: "localhost",
      port: 3000,
      transport: "sse" as const,
    },
  };

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    eventLog = new EventLog(testDir);
    await eventLog.init();
    // Write a test file for file.read tests
    await writeFile(join(testDir, "test.txt"), "Hello, World!", "utf8");
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("emits tool.requested with capability", async () => {
    const executor = new ToolExecutor(config, eventLog, testDir);
    const request = {
      toolCallId: `tool_${Date.now()}_abc1234`,
      name: "file.read",
      args: { path: "test.txt" },
    };

    await executor.execute(request);

    const events = await eventLog.readAll();
    const requested = events.find((e) => e.type === "tool.requested");
    assert.ok(requested, "Should have tool.requested event");
    const payload = requested.payload as any;
    assert.equal(payload.toolName, "file.read");
    assert.equal(payload.capability, "file.read");
    assert.ok(payload.argsPreview);
  });

  it("emits tool.started after tool.requested", async () => {
    const executor = new ToolExecutor(config, eventLog, testDir);
    const request = {
      toolCallId: `tool_${Date.now()}_abc1235`,
      name: "file.read",
      args: { path: "test.txt" },
    };

    await executor.execute(request);

    const events = await eventLog.readAll();
    const started = events.find((e) => e.type === "tool.started");
    assert.ok(started, "Should have tool.started event");
    assert.equal((started.payload as any).toolName, "file.read");
  });

  it("emits tool.completed on success", async () => {
    const executor = new ToolExecutor(config, eventLog, testDir);
    const request = {
      toolCallId: `tool_${Date.now()}_abc1236`,
      name: "file.read",
      args: { path: "test.txt" },
    };

    await executor.execute(request);

    const events = await eventLog.readAll();
    const completed = events.find((e) => e.type === "tool.completed");
    assert.ok(completed, "Should have tool.completed event");
    const payload = completed.payload as any;
    assert.equal(payload.status, "success");
    assert.ok(payload.durationMs >= 0);
  });

  it("emits tool.failed on error", async () => {
    const executor = new ToolExecutor(config, eventLog, testDir);
    const request = {
      toolCallId: `tool_${Date.now()}_abc1237`,
      name: "file.read",
      args: { path: "nonexistent.txt" },
    };

    await executor.execute(request);

    const events = await eventLog.readAll();
    const failed = events.find((e) => e.type === "tool.failed");
    assert.ok(failed, "Should have tool.failed event");
    const payload = failed.payload as any;
    assert.ok(payload.error);
  });

  it("emits all 5 lifecycle events in order", async () => {
    const executor = new ToolExecutor(config, eventLog, testDir);
    const request = {
      toolCallId: `tool_${Date.now()}_abc1238`,
      name: "file.read",
      args: { path: "test.txt" },
    };

    await executor.execute(request);

    const events = await eventLog.readAll();
    const toolEvents = events.filter((e) => e.type.startsWith("tool."));

    assert.ok(toolEvents.length >= 4, `Expected at least 4 tool events, got ${toolEvents.length}`);

    const eventTypes = toolEvents.map((e) => e.type);
    assert.ok(eventTypes.includes("tool.requested"), "Should have tool.requested");
    assert.ok(eventTypes.includes("tool.started"), "Should have tool.started");
    assert.ok(eventTypes.includes("tool.completed"), "Should have tool.completed");
  });
});