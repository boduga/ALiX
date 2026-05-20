import { describe, it, expect } from "vitest";
import { EventLog } from "../../src/events/event-log.js";
import { FileToolRouter, PatchToolRouter } from "../../src/tools/tool-router.js";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// Test helper: create a temp directory with auto-cleanup
async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = join("/tmp", `tool-router-test-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("ToolRouter event emission", () => {
  it("file.create returns createdPath in result", async () => {
    await withTempDir(async (dir) => {
      const router = new FileToolRouter(dir);

      const result = await router.execute({
        toolCallId: "call-123",
        name: "file.create",
        args: { path: "new-file.txt", content: "hello world" },
      });

      expect(result.kind).toBe("success");
      const typedResult = result as { createdPath?: string; changedFiles?: string[] };
      expect(typedResult.createdPath).toBe("new-file.txt");
    });
  });

  it("file.delete returns deletedPath in result", async () => {
    await withTempDir(async (dir) => {
      const router = new FileToolRouter(dir);

      // Create a file first
      const testFile = join(dir, "to-delete.txt");
      await writeFile(testFile, "delete me");

      const result = await router.execute({
        toolCallId: "call-456",
        name: "file.delete",
        args: { path: "to-delete.txt" },
      });

      expect(result.kind).toBe("success");
      const typedResult = result as { deletedPath?: string };
      expect(typedResult.deletedPath).toBe("to-delete.txt");
    });
  });

  it("patch.apply with search_replace format returns changedFiles in result", async () => {
    await withTempDir(async (dir) => {
      const sessionDir = join(dir, "session");
      const eventLog = new EventLog(sessionDir);
      await eventLog.init();

      // Create a file to patch
      const targetFile = join(dir, "example.txt");
      await writeFile(targetFile, "line 1\nline 2\nline 3\n");

      // Use search_replace format (marker format)
      const patchText = `<<<<<<< SEARCH path=example.txt
line 3
=======
line 3
line 4
>>>>>>> REPLACE`;

      const router = new PatchToolRouter(
        dir,
        { model: { provider: "anthropic" } } as any,
        undefined, // editFormatPolicy
        undefined, // checkpointManager
        eventLog,  // eventLog
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

      expect(result.kind).toBe("success");
      const typedResult = result as { changedFiles?: string[] };
      expect(typedResult.changedFiles).toContain("example.txt");
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

      expect(result.kind).toBe("success");

      const events = await eventLog.readAll();
      // Check for any patch-related events (checkpoint_created, applied, etc.)
      const patchEvents = events.filter((e) => e.type.startsWith("patch."));
      expect(patchEvents.length).toBeGreaterThan(0);
    });
  });

  it("FileToolRouter file.exists returns exists field", async () => {
    await withTempDir(async (dir) => {
      const router = new FileToolRouter(dir);

      // Test existing file
      const testFile = join(dir, "exists.txt");
      await writeFile(testFile, "content");

      const result = await router.execute({
        toolCallId: "call-exists",
        name: "file.exists",
        args: { path: "exists.txt" },
      });

      expect(result.kind).toBe("success");
      const typedResult = result as { exists?: boolean };
      expect(typedResult.exists).toBe(true);
    });
  });

  it("FileToolRouter dir.search returns success", async () => {
    await withTempDir(async (dir) => {
      const router = new FileToolRouter(dir);

      // Create test files
      await writeFile(join(dir, "a.txt"), "a");
      await writeFile(join(dir, "b.txt"), "b");

      const result = await router.execute({
        toolCallId: "call-search",
        name: "dir.search",
        args: { pattern: "*.txt" },
      });

      expect(result.kind).toBe("success");
    });
  });
});