import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTask } from "../src/run.js";

test("run task creates event log and returns mock plan", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-run-"));
  try {
    const result = await runTask(dir, "fix tests");
    assert.match(result.summary, /Plan:/);
    const events = await readFile(join(dir, ".alix", "sessions", result.sessionId, "events.jsonl"), "utf8");
    assert.match(events, /session.started/);
    assert.match(events, /context.repo_map_lite_created/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
