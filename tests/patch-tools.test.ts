import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { ToolExecutor } from "../src/tools/executor.js";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { EventLog } from "../src/events/event-log.js";

test("patch.apply with checkpointing is routed through executor", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-patch-"));
  try {
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src/a.ts"), "const a = 1;\n");
    const log = new EventLog(join(dir, "session"));
    await log.init();
    const executor = new ToolExecutor(DEFAULT_CONFIG, log, dir);
    const result = await executor.execute({
      toolCallId: "p1",
      name: "patch.apply",
      args: {
        root: dir,
        format: "search_replace",
        patchText: "<<<<<<< SEARCH path=src/a.ts\nconst a = 1;\n=======\nconst a = 2;\n>>>>>>> REPLACE"
      }
    });
    assert.equal(result.kind, "success");
    const content = await readFile(join(dir, "src/a.ts"), "utf8");
    assert.equal(content, "const a = 2;\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});