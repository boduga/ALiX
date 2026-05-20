import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { EventLog } from "../../src/events/event-log.js";
import { FileToolRouter, PatchToolRouter } from "../../src/tools/tool-router.js";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

describe("ToolRouter event emission", () => {
  async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
    const dir = join("/tmp", `tool-router-test-${randomUUID()}`);
    await mkdir(dir, { recursive: true });
    try {
      await fn(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it("file.create returns createdPath in result", async () => {
    await withTempDir(async (dir) => {
      const router = new FileToolRouter(dir);

      const result = await router.execute({
        toolCallId: "call-123",
        name: "file.create",
        args: { path: "new-file.txt", content: "hello world" },
      });

      assert.equal(result.kind, "success");
      const typedResult = result as { createdPath?: string; changedFiles?: string[] };
      assert.equal(typedResult.createdPath, "new-file.txt");
    });
  });

  it("file.delete returns deletedPath in result", async () => {
    await withTempDir(async (dir) => {
      const router = new FileToolRouter(dir);

      const testFile = join(dir, "to-delete.txt");
      await writeFile(testFile, "delete me");

      const result = await router.execute({
        toolCallId: "call-456",
        name: "file.delete",
        args: { path: "to-delete.txt" },
      });

      assert.equal(result.kind, "success");
      const typedResult = result as { deletedPath?: string };
      assert.equal(typedResult.deletedPath, "to-delete.txt");
    });
  });

  it("patch.apply with search_replace format returns changedFiles in result", async () => {
    await withTempDir(async (dir) => {
      const sessionDir = join(dir, "session");
      const eventLog = new EventLog(sessionDir);
      await eventLog.init();

      const targetFile = join(dir, "example.txt");
      await writeFile(targetFile, "line 1\nline 2\nline 3\n");

      const patchText = `<<<<<<< SEARCH path=example.txt
line 3
=======
line 3
line 4
>>>>>>> REPLACE`;

      const router = new PatchToolRouter(
        dir,
        { model: { provider: "anthropic" } } as any,
        undefined,
        undefined,
        eventLog,
        "test-session"
      );

      const result = await router.execute({
        toolCallId: "call-789",
        name: "patch.apply",
        args: {
          format: "search_replace",
          patchText,
          root: dir,
        },
      });

      assert.equal(result.kind, "success");
      const typedResult = result as { changedFiles?: string[] };
      assert.ok(typedResult.changedFiles?.includes("example.txt"));
    });
  });

  it("PatchToolRouter emits patch events with eventLog", async () => {
    await withTempDir(async (dir) => {
      const sessionDir = join(dir, "session");
      const eventLog = new EventLog(sessionDir);
      await eventLog.init();

      const targetFile = join(dir, "patch.txt");
      await writeFile(targetFile, "original\n");

      const patchText = `<<<<<<< SEARCH path=patch.txt
original
=======
original
modified
>>>>>>> REPLACE`;

      const router = new PatchToolRouter(
        dir,
        { model: { provider: "anthropic" } } as any,
        undefined,
        undefined,
        eventLog,
        "session-patch"
      );

      const result = await router.execute({
        toolCallId: "call-cp-1",
        name: "patch.apply",
        args: { format: "search_replace", patchText, root: dir },
      });

      assert.equal(result.kind, "success");

      const events = await eventLog.readAll();
      const patchEvents = events.filter((e) => e.type.startsWith("patch."));
      assert.ok(patchEvents.length > 0, "Should have patch events");
    });
  });

  it("FileToolRouter file.exists returns exists field", async () => {
    await withTempDir(async (dir) => {
      const router = new FileToolRouter(dir);

      const testFile = join(dir, "exists.txt");
      await writeFile(testFile, "content");

      const result = await router.execute({
        toolCallId: "call-exists",
        name: "file.exists",
        args: { path: "exists.txt" },
      });

      assert.equal(result.kind, "success");
      const typedResult = result as { exists?: boolean };
      assert.equal(typedResult.exists, true);
    });
  });

  it("FileToolRouter dir.search returns success", async () => {
    await withTempDir(async (dir) => {
      const router = new FileToolRouter(dir);

      await writeFile(join(dir, "a.txt"), "a");
      await writeFile(join(dir, "b.txt"), "b");

      const result = await router.execute({
        toolCallId: "call-search",
        name: "dir.search",
        args: { pattern: "*.txt" },
      });

      assert.equal(result.kind, "success");
    });
  });
});