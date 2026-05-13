import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { ToolExecutor } from "../src/tools/executor.js";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { EventLog } from "../src/events/event-log.js";

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