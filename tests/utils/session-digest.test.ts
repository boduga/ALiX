import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildSessionDigest, buildSessionDigestWithMemory } from "../../src/utils/session-digest.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("buildSessionDigest", () => {
  let dir: string;

  async function setupDir() {
    dir = await mkdtemp(join(tmpdir(), "alix-digest-"));
    return dir;
  }

  async function cleanupDir() {
    if (dir) await rm(dir, { recursive: true, force: true });
  }

  it("returns null when no events file exists", async () => {
    const d = await setupDir();
    try {
      const result = await buildSessionDigest(d);
      assert.equal(result, null);
    } finally {
      await cleanupDir();
    }
  });

  it("returns null when events file is empty", async () => {
    const d = await setupDir();
    try {
      await writeFile(join(d, "events.jsonl"), "", "utf8");
      const result = await buildSessionDigest(d);
      assert.equal(result, null);
    } finally {
      await cleanupDir();
    }
  });

  it("returns null when no relevant events", async () => {
    const d = await setupDir();
    try {
      await writeFile(join(d, "events.jsonl"), JSON.stringify({ type: "unknown.event", payload: {} }) + "\n", "utf8");
      const result = await buildSessionDigest(d);
      assert.equal(result, null);
    } finally {
      await cleanupDir();
    }
  });

  it("extracts created files from tool.completed for file.create", async () => {
    const d = await setupDir();
    try {
      await writeFile(join(d, "events.jsonl"), JSON.stringify({
        type: "tool.completed", payload: { toolName: "file.create", createdPath: "src/a.ts" }
      }) + "\n", "utf8");
      const result = await buildSessionDigest(d);
      assert.ok(result !== null);
      assert.ok(result!.includes("Files created"));
      assert.ok(result!.includes("src/a.ts"));
    } finally {
      await cleanupDir();
    }
  });

  it("extracts changed files from patch.apply", async () => {
    const d = await setupDir();
    try {
      await writeFile(join(d, "events.jsonl"), JSON.stringify({
        type: "tool.completed", payload: { toolName: "patch.apply", path: "src/b.ts" }
      }) + "\n", "utf8");
      const result = await buildSessionDigest(d);
      assert.ok(result !== null);
      assert.ok(result!.includes("Files changed"));
      assert.ok(result!.includes("src/b.ts"));
    } finally {
      await cleanupDir();
    }
  });

  it("extracts deleted files from file.delete tool", async () => {
    const d = await setupDir();
    try {
      await writeFile(join(d, "events.jsonl"), JSON.stringify({
        type: "tool.completed", payload: { toolName: "file.delete", deletedPath: "src/c.ts" }
      }) + "\n", "utf8");
      const result = await buildSessionDigest(d);
      assert.ok(result !== null);
      assert.ok(result!.includes("Files deleted"));
      assert.ok(result!.includes("src/c.ts"));
    } finally {
      await cleanupDir();
    }
  });

  it("extracts errors from tool.failed", async () => {
    const d = await setupDir();
    try {
      await writeFile(join(d, "events.jsonl"), JSON.stringify({
        type: "tool.failed", payload: { toolName: "patch.apply", error: "File not found" }
      }) + "\n", "utf8");
      const result = await buildSessionDigest(d);
      assert.ok(result !== null);
      assert.ok(result!.includes("Errors"));
      assert.ok(result!.includes("File not found"));
    } finally {
      await cleanupDir();
    }
  });

  it("uses domain event file.created", async () => {
    const d = await setupDir();
    try {
      await writeFile(join(d, "events.jsonl"), JSON.stringify({
        type: "file.created", payload: { path: "src/new.ts" }
      }) + "\n", "utf8");
      const result = await buildSessionDigest(d);
      assert.ok(result !== null);
      assert.ok(result!.includes("Files created"));
      assert.ok(result!.includes("src/new.ts"));
    } finally {
      await cleanupDir();
    }
  });

  it("uses domain event patch.changed_files", async () => {
    const d = await setupDir();
    try {
      await writeFile(join(d, "events.jsonl"), JSON.stringify({
        type: "patch.changed_files", payload: { changedFiles: ["src/d.ts", "src/e.ts"] }
      }) + "\n", "utf8");
      const result = await buildSessionDigest(d);
      assert.ok(result !== null);
      assert.ok(result!.includes("Files changed"));
      assert.ok(result!.includes("src/d.ts"));
    } finally {
      await cleanupDir();
    }
  });
});

describe("buildSessionDigestWithMemory", () => {
  let dir: string;

  async function setupDir() {
    dir = await mkdtemp(join(tmpdir(), "alix-digest-mem-"));
    return dir;
  }

  async function cleanupDir() {
    if (dir) await rm(dir, { recursive: true, force: true });
  }

  it("returns context when memory has entries but no session events", async () => {
    const d = await setupDir();
    try {
      // Memory store doesn't exist but buildMemoryContext handles that gracefully
      // The function returns a string containing context
      const result = await buildSessionDigestWithMemory(d, join(d, ".alix/memory"));
      // buildMemoryContext returns "No memory entries found." for empty memory
      assert.ok(result !== null);
      assert.ok(result!.includes("Context"));
    } finally {
      await cleanupDir();
    }
  });
});