import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { ToolExecutor } from "../src/tools/executor.js";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { EventLog } from "../src/events/event-log.js";
import type { AlixConfig } from "../src/config/schema.js";

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

test("patch.apply logs edit format policy telemetry", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-patch-"));
  try {
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src/a.ts"), "const a = 1;\n");
    const log = new EventLog(join(dir, "session"));
    await log.init();
    const config: AlixConfig = {
      ...DEFAULT_CONFIG,
      model: { ...DEFAULT_CONFIG.model, provider: "google" },
    };
    const executor = new ToolExecutor(config, log, dir);

    await executor.execute({
      toolCallId: "p-policy",
      name: "patch.apply",
      args: {
        root: dir,
        format: "search_replace",
        patchText: "<<<<<<< SEARCH path=src/a.ts\nconst a = 1;\n=======\nconst a = 2;\n>>>>>>> REPLACE"
      }
    });

    const events = await log.readAll();
    const policyEvent = events.find((event) => event.type === "patch.edit_format_policy");
    assert.ok(policyEvent);
    assert.deepEqual(policyEvent.payload, {
      toolCallId: "p-policy",
      provider: "google",
      requestedFormat: "search_replace",
      preferredFormat: "search_replace",
      allowedFormats: ["search_replace", "structured_patch"],
      matchesPreference: true,
      allowed: true,
      fullFileRewrite: "deny",
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("patch.apply blocks full_file at the edit format policy layer", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-patch-"));
  try {
    const log = new EventLog(join(dir, "session"));
    await log.init();
    const executor = new ToolExecutor(DEFAULT_CONFIG, log, dir);

    const result = await executor.execute({
      toolCallId: "p-full-file",
      name: "patch.apply",
      args: {
        root: dir,
        format: "full_file",
        patchText: "rewrite everything"
      }
    });

    assert.equal(result.kind, "error");
    assert.match((result as { message: string }).message, /not allowed by edit format policy/);

    const events = await log.readAll();
    const policyEvent = events.find((event) => event.type === "patch.edit_format_policy");
    assert.ok(policyEvent);
    const payload = policyEvent.payload as Record<string, unknown>;
    assert.equal(payload.allowed, false);
    assert.equal(payload.requestedFormat, "full_file");
    assert.equal(payload.fullFileRewrite, "deny");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
