import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { join } from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { EventLog } from "../../src/events/event-log.js";
import { ToolExecutor } from "../../src/tools/executor.js";
import type { AlixConfig } from "../../src/config/schema.js";

/**
 * Integration tests for tool events in the event log.
 * Verifies that tool lifecycle events are properly emitted and ordered.
 */
describe("Tool Events in Event Log", () => {
  const testDir = join(process.cwd(), `.test-tool-events-${Date.now()}`);
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
    // Write test files
    await writeFile(join(testDir, "test.txt"), "Hello, World!", "utf8");
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("contains tool events in sequence", async () => {
    const executor = new ToolExecutor(config, eventLog, testDir);
    const toolCallId = `tool_${Date.now()}_seq001`;

    const result = await executor.execute({
      toolCallId,
      name: "file.read",
      args: { path: "test.txt" },
    });

    assert.equal(result.kind, "success");

    const events = await eventLog.readAll();
    const toolEvents = events.filter((e) => e.type.startsWith("tool."));

    // Verify we have the expected lifecycle events
    const eventTypes = toolEvents.map((e) => e.type);

    // tool.requested should appear before tool.started
    const requestedIndex = eventTypes.indexOf("tool.requested");
    const startedIndex = eventTypes.indexOf("tool.started");
    assert.ok(requestedIndex >= 0, "Should have tool.requested event");
    assert.ok(startedIndex >= 0, "Should have tool.started event");
    assert.ok(requestedIndex < startedIndex, "tool.requested should appear before tool.started");

    // tool.completed should appear after tool.started
    const completedIndex = eventTypes.indexOf("tool.completed");
    assert.ok(completedIndex >= 0, "Should have tool.completed event");
    assert.ok(startedIndex < completedIndex, "tool.started should appear before tool.completed");
  });

  it("emits tool.failed instead of tool.completed on error", async () => {
    const executor = new ToolExecutor(config, eventLog, testDir);
    const toolCallId = `tool_${Date.now()}_seq002`;

    const result = await executor.execute({
      toolCallId,
      name: "file.read",
      args: { path: "nonexistent.txt" },
    });

    assert.equal(result.kind, "error");

    const events = await eventLog.readAll();
    const toolEvents = events.filter((e) => e.type.startsWith("tool."));

    const hasFailed = toolEvents.some((e) => e.type === "tool.failed");
    const hasCompleted = toolEvents.some((e) => e.type === "tool.completed");

    assert.ok(hasFailed, "Should have tool.failed event on error");
    assert.ok(!hasCompleted, "Should NOT have tool.completed on error");
  });

  it("emits tool.output with correct payload", async () => {
    const executor = new ToolExecutor(config, eventLog, testDir);
    const toolCallId = `tool_${Date.now()}_seq003`;

    await executor.execute({
      toolCallId,
      name: "file.read",
      args: { path: "test.txt" },
    });

    const events = await eventLog.readAll();
    const outputEvent = events.find((e) => e.type === "tool.output");

    assert.ok(outputEvent, "Should have tool.output event");
    const payload = outputEvent.payload as Record<string, unknown>;
    assert.equal(payload.toolCallId, toolCallId);
    assert.ok(typeof payload.outputSize === "number");
    assert.ok(payload.outputPreview !== undefined);
  });

  it("sanitizes sensitive arguments", async () => {
    const executor = new ToolExecutor(config, eventLog, testDir);
    const toolCallId = `tool_${Date.now()}_seq004`;

    await executor.execute({
      toolCallId,
      name: "shell.run",
      args: {
        command: "echo hello",
        password: "supersecret",
        apiKey: "key-12345",
        token: "abc123",
      },
    });

    const events = await eventLog.readAll();
    const requestedEvent = events.find((e) => e.type === "tool.requested");

    assert.ok(requestedEvent, "Should have tool.requested event");
    const payload = requestedEvent.payload as Record<string, unknown>;
    const argsPreview = payload.argsPreview as Record<string, unknown>;

    assert.equal(argsPreview.command, "echo hello");
    assert.equal(argsPreview.password, "[REDACTED]");
    assert.equal(argsPreview.apiKey, "[REDACTED]");
    assert.equal(argsPreview.token, "[REDACTED]");
  });

  it("maintains event sequence ordering", async () => {
    const executor = new ToolExecutor(config, eventLog, testDir);
    const toolCallId = `tool_${Date.now()}_seq005`;

    await executor.execute({
      toolCallId,
      name: "file.read",
      args: { path: "test.txt" },
    });

    const events = await eventLog.readAll();
    const toolEvents = events.filter((e) => e.type.startsWith("tool."));

    // Verify sequence: requested -> started -> output -> completed
    const expectedOrder = ["tool.requested", "tool.started", "tool.output", "tool.completed"];
    let lastIndex = -1;

    for (const expected of expectedOrder) {
      const currentIndex = toolEvents.findIndex((e) => e.type === expected);
      assert.ok(currentIndex >= 0, `Missing event: ${expected}`);
      assert.ok(currentIndex > lastIndex, `${expected} should come after previous event`);
      lastIndex = currentIndex;
    }
  });
});