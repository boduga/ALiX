import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { ToolExecutor } from "../src/tools/executor.js";
import { DEFAULT_CONFIG, PERMIT_ALL_CONFIG } from "../src/config/defaults.js";
import { EventLog } from "../src/events/event-log.js";
import type { AlixConfig } from "../src/config/schema.js";

test("patch.apply with checkpointing is routed through executor", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-patch-"));
  try {
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src/a.ts"), "const a = 1;\n");
    const log = new EventLog(join(dir, "session"));
    await log.init();
    const executor = new ToolExecutor(PERMIT_ALL_CONFIG, log, dir);
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
      model: { provider: "google", name: "test-model" },
      permissions: {
        ...DEFAULT_CONFIG.permissions,
        default: "allow",
        sessionMode: "bypass",
      },
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
    const executor = new ToolExecutor(PERMIT_ALL_CONFIG, log, dir);

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

test("patch.apply checkpoints structured patch paths before applying", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-patch-"));
  try {
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src/a.ts"), "const a = 1;\n");
    const log = new EventLog(join(dir, "session"));
    await log.init();
    const executor = new ToolExecutor(PERMIT_ALL_CONFIG, log, dir);

    const result = await executor.execute({
      toolCallId: "p-structured-checkpoint",
      name: "patch.apply",
      args: {
        root: dir,
        format: "structured_patch",
        patchText: JSON.stringify({
          version: 1,
          files: [{ path: "src/a.ts", operation: "modify", content: "const a = 2;\n" }]
        })
      }
    });

    assert.equal(result.kind, "error");
    const events = await log.readAll();
    const checkpointEvent = events.find((event) => event.type === "patch.checkpoint_created");
    assert.ok(checkpointEvent);
    const payload = checkpointEvent.payload as Record<string, unknown>;
    assert.deepEqual(payload.files, ["src/a.ts"]);
    assert.equal(await readFile(join(dir, "src/a.ts"), "utf8"), "const a = 1;\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("patch.apply rolls back prior file changes when a later patch block fails", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-patch-"));
  try {
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src/a.ts"), "const a = 1;\n");
    await writeFile(join(dir, "src/b.ts"), "const b = 1;\n");
    const log = new EventLog(join(dir, "session"));
    await log.init();
    const executor = new ToolExecutor(PERMIT_ALL_CONFIG, log, dir);

    const result = await executor.execute({
      toolCallId: "p-rollback",
      name: "patch.apply",
      args: {
        root: dir,
        format: "search_replace",
        patchText: [
          "<<<<<<< SEARCH path=src/a.ts",
          "const a = 1;",
          "=======",
          "const a = 2;",
          ">>>>>>> REPLACE",
          "<<<<<<< SEARCH path=src/b.ts",
          "const missing = true;",
          "=======",
          "const b = 2;",
          ">>>>>>> REPLACE"
        ].join("\n")
      }
    });

    assert.equal(result.kind, "error");
    assert.equal(await readFile(join(dir, "src/a.ts"), "utf8"), "const a = 1;\n");
    assert.equal(await readFile(join(dir, "src/b.ts"), "utf8"), "const b = 1;\n");

    const events = await log.readAll();
    assert.ok(events.some((event) => event.type === "patch.rollback_started"));
    assert.ok(events.some((event) => event.type === "patch.rollback_completed"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
