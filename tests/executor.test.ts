import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ToolExecutor } from "../src/tools/executor.js";
import { DEFAULT_CONFIG, PERMIT_ALL_CONFIG } from "../src/config/defaults.js";
import { EventLog } from "../src/events/event-log.js";
import type { AlixConfig } from "../src/config/schema.js";

test("file.read allowed by default policy", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-exec-"));
  try {
    const log = new EventLog(dir);
    await log.init();
    const executor = new ToolExecutor(DEFAULT_CONFIG, log, dir);
    const result = await executor.execute({ toolCallId: "1", name: "file.read", args: { root: dir, path: "README.md" } });
    assert.notEqual(result.kind, "denied"); // may be error (not found) but not denied
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("shell.run with denied command returns denied", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-exec-"));
  try {
    const log = new EventLog(dir);
    await log.init();
    const executor = new ToolExecutor(DEFAULT_CONFIG, log, dir);
    const result = await executor.execute({ toolCallId: "2", name: "shell.run", args: { command: "rm -rf /", cwd: dir, timeoutMs: 5000 } });
    assert.equal(result.kind, "denied");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("shell.run uses root as cwd when cwd is omitted", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-exec-"));
  try {
    await writeFile(join(dir, "root-marker.txt"), "marker");
    const log = new EventLog(dir);
    await log.init();
    const executor = new ToolExecutor(PERMIT_ALL_CONFIG, log, "/tmp");
    const result = await executor.execute({ toolCallId: "3", name: "shell.run", args: { root: dir, command: "pwd && ls", timeoutMs: 5000 } });

    assert.equal(result.kind, "success");
    assert.ok((result as any).output.includes(dir));
    assert.ok((result as any).output.includes("root-marker.txt"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("file.create creates file at correct path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-exec-"));
  try {
    const log = new EventLog(dir);
    await log.init();
    const executor = new ToolExecutor(PERMIT_ALL_CONFIG, log, dir);
    const result = await executor.execute({ toolCallId: "1", name: "file.create", args: { path: "hello.txt", content: "world" } });
    assert.equal(result.kind, "success");
    assert.equal((result as any).createdPath, "hello.txt");
    const content = await readFile(join(dir, "hello.txt"), "utf8");
    assert.equal(content, "world");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("file.delete removes existing file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-exec-"));
  try {
    await writeFile(join(dir, "to-delete.txt"), "old content");
    const log = new EventLog(dir);
    await log.init();
    const executor = new ToolExecutor(PERMIT_ALL_CONFIG, log, dir);
    const result = await executor.execute({ toolCallId: "1", name: "file.delete", args: { path: "to-delete.txt" } });
    assert.equal(result.kind, "success");
    assert.equal((result as any).deletedPath, "to-delete.txt");
    assert.ok(!(await existsSync(join(dir, "to-delete.txt"))));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
