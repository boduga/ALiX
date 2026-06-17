import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { join } from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { EventLog } from "../../src/events/event-log.js";
import { ContextCompiler } from "../../src/repomap/context-compiler.js";

describe("Context Compiler Events", () => {
  const testDir = join(process.cwd(), ".test-context-events");
  let eventLog: EventLog;
  let compiler: ContextCompiler;

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    eventLog = new EventLog(testDir);
    await eventLog.init();
    compiler = new ContextCompiler({
      root: process.cwd(),
      maxTokens: 5000,
      eventLog,
      sessionId: "test-session",
    });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("emits context.repo_map_created on warm", { timeout: 120_000 }, async () => {
    await compiler.warm();
    const events = await eventLog.readAll();
    const repoMapEvent = events.find((e) => e.type === "context.repo_map_created");
    assert.ok(repoMapEvent);
    const payload = repoMapEvent.payload as any;
    assert.ok(payload.sourceFileCount >= 0);
    assert.ok(payload.symbolCount >= 0);
  });

  it("emits context.bundle_created on compile", { timeout: 120_000 }, async () => {
    await compiler.warm();
    await compiler.compileContext("fix the login bug", "bugfix");
    const events = await eventLog.readAll();
    const bundleEvent = events.find((e) => e.type === "context.bundle_created");
    assert.ok(bundleEvent);
    const payload = bundleEvent.payload as any;
    assert.equal(payload.taskType, "bugfix");
    assert.ok(payload.primaryFiles.length >= 0);
  });

  it("emits context.file_pinned when pinning", async () => {
    await compiler.pinFile("src/auth.ts", "needed for login fix");
    const events = await eventLog.readAll();
    const pinEvent = events.find((e) => e.type === "context.file_pinned");
    assert.ok(pinEvent);
    const payload = pinEvent.payload as any;
    assert.equal(payload.path, "src/auth.ts");
    assert.equal(payload.reason, "needed for login fix");
  });

  it("emits context.file_unpinned when unpinning", async () => {
    await compiler.pinFile("src/auth.ts", "test");
    await compiler.unpinFile("src/auth.ts");
    const events = await eventLog.readAll();
    const unpinEvent = events.find((e) => e.type === "context.file_unpinned");
    assert.ok(unpinEvent);
    const payload = unpinEvent.payload as any;
    assert.equal(payload.path, "src/auth.ts");
  });
});