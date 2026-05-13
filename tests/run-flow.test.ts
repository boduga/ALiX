import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTask } from "../src/run.js";
import { _setHomedirOverride } from "../src/config/loader.js";

test("run task creates event log and returns plan", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-run-"));
  try {
    _setHomedirOverride(dir);
    // Create a minimal project so the model has context
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src/index.js"), "console.log('hello');\n");
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "test-project", version: "1.0.0" }));

    const result = await runTask(dir, "add a greeting function");
    assert.ok(result.summary.length > 0);
    assert.ok(result.sessionId.length > 0);
    const events = await readFile(join(dir, ".alix", "sessions", result.sessionId, "events.jsonl"), "utf8") as string;
    assert.match(events, /session.started/);
  } finally {
    _setHomedirOverride(undefined);
    await rm(dir, { recursive: true, force: true });
  }
});