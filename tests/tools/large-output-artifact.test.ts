import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { join } from "node:path";
import { mkdir, rm, readFile, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { EventLog } from "../../src/events/event-log.js";
import { ToolExecutor } from "../../src/tools/executor.js";
import type { AlixConfig } from "../../src/config/schema.js";

describe("Large Output Artifact", () => {
  const testDir = join(process.cwd(), `.test-large-output-artifact-${Date.now()}`);
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
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("writes large output to session artifacts directory", async () => {
    const executor = new ToolExecutor(config, eventLog, testDir);

    // Create a file with content larger than LARGE_OUTPUT_THRESHOLD (10000)
    const largeContent = "X".repeat(12000);
    await writeFile(join(testDir, "large-file.txt"), largeContent, "utf8");

    const request = {
      toolCallId: `tool_${Date.now()}_abc_large`,
      name: "file.read",
      args: { path: "large-file.txt" },
    };

    await executor.execute(request);

    // Check that artifacts directory was created
    const artifactsDir = join(testDir, "artifacts");
    assert.ok(existsSync(artifactsDir), "Artifacts directory should exist");

    // Check that at least one artifact file exists
    const artifactFiles = (await import("node:fs/promises")).readdir;
    const files = await (await import("node:fs/promises")).readdir(artifactsDir);
    assert.ok(files.length >= 1, "Should have at least one artifact file");

    // Check that the artifact file has the correct naming pattern
    const artifactFile = files[0];
    assert.ok(artifactFile.startsWith("tool-output-"), "File should start with tool-output-");
    assert.ok(artifactFile.endsWith(".json"), "File should end with .json");

    // Check that the file contains the large content
    const filePath = join(artifactsDir, artifactFile);
    const savedContent = await readFile(filePath, "utf8");
    assert.equal(savedContent, largeContent, "File content should match the large output");
  });

  it("emits artifact.created event with correct path", async () => {
    const executor = new ToolExecutor(config, eventLog, testDir);

    // Create a file with content larger than LARGE_OUTPUT_THRESHOLD (10000)
    const largeContent = "Y".repeat(12000);
    await writeFile(join(testDir, "another-large-file.txt"), largeContent, "utf8");

    const request = {
      toolCallId: `tool_${Date.now()}_abc_artifact`,
      name: "file.read",
      args: { path: "another-large-file.txt" },
    };

    await executor.execute(request);

    // Read events and find artifact.created
    const events = await eventLog.readAll();
    const artifactEvent = events.find((e) => e.type === "artifact.created");

    assert.ok(artifactEvent, "Should have artifact.created event");
    const payload = artifactEvent.payload as Record<string, unknown>;

    assert.ok(payload.artifactId, "Should have artifactId");
    assert.ok(payload.toolCallId, "Should have toolCallId");
    assert.equal(payload.toolCallId, request.toolCallId, "toolCallId should match");
    assert.ok(typeof payload.path === "string", "path should be a string");
    assert.ok((payload.path as string).includes("artifacts/tool-output-"), "path should point to artifacts directory");
    assert.equal(payload.mimeType, "text/plain", "mimeType should be text/plain for string output");
    assert.equal(payload.size, Buffer.byteLength(largeContent, "utf8"), "size should match content byte length");
    assert.equal(payload.retention, "session", "retention should be session");
  });

  it("does not create artifact for output below threshold", async () => {
    const executor = new ToolExecutor(config, eventLog, testDir);

    // Create a small file
    await writeFile(join(testDir, "small-file.txt"), "Hello, World!", "utf8");

    const request = {
      toolCallId: `tool_${Date.now()}_abc_small`,
      name: "file.read",
      args: { path: "small-file.txt" },
    };

    await executor.execute(request);

    // Artifacts directory should not exist
    const artifactsDir = join(testDir, "artifacts");
    assert.ok(!existsSync(artifactsDir), "Artifacts directory should NOT exist for small output");

    // No artifact.created event should be emitted
    const events = await eventLog.readAll();
    const artifactEvent = events.find((e) => e.type === "artifact.created");
    assert.ok(!artifactEvent, "Should NOT have artifact.created event for small output");
  });

  it("outputRef in tool.output event points to artifact file", async () => {
    const executor = new ToolExecutor(config, eventLog, testDir);

    // Create a file with content larger than LARGE_OUTPUT_THRESHOLD (10000)
    const largeContent = "Z".repeat(12000);
    await writeFile(join(testDir, "ref-test-file.txt"), largeContent, "utf8");

    const request = {
      toolCallId: `tool_${Date.now()}_abc_ref`,
      name: "file.read",
      args: { path: "ref-test-file.txt" },
    };

    await executor.execute(request);

    // Read events and find tool.output
    const events = await eventLog.readAll();
    const outputEvent = events.find((e) => e.type === "tool.output");

    assert.ok(outputEvent, "Should have tool.output event");
    const outputPayload = outputEvent.payload as Record<string, unknown>;

    assert.ok(outputPayload.outputRef, "outputRef should be set for large output");
    assert.ok(
      typeof outputPayload.outputRef === "string" && outputPayload.outputRef.includes("artifacts/tool-output-"),
      "outputRef should point to an artifact file"
    );
  });
});
