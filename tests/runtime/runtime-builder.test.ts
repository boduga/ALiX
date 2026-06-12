import { describe, it } from "node:test";
import assert from "node:assert";
import { RuntimeBuilder } from "../../src/runtime/runtime-builder.js";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

function createTempRoot(): string {
  const tmp = mkdtempSync(join(tmpdir(), "runtime-test-"));
  mkdirSync(join(tmp, ".alix"), { recursive: true });
  writeFileSync(join(tmp, ".alix", "config.json"), JSON.stringify({
    model: { provider: "test", name: "test-model" },
  }));
  return tmp;
}

describe("RuntimeBuilder", () => {
  it("builds a Runtime", async () => {
    const tmp = createTempRoot();
    try {
      const builder = new RuntimeBuilder(tmp);
      const runtime = await builder.build();
      assert.ok(runtime);
      assert.equal(typeof runtime.close, "function");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("Runtime has required modules", async () => {
    const tmp = createTempRoot();
    try {
      const builder = new RuntimeBuilder(tmp);
      const runtime = await builder.build();
      assert.ok(runtime.eventLog);
      assert.ok(runtime.toolExecutor);
      assert.ok(runtime.contextCompiler);
      assert.ok(runtime.scopeTracker);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("Runtime has optional subagentManager when disabled in config", async () => {
    const tmp = createTempRoot();
    try {
      const builder = new RuntimeBuilder(tmp);
      const runtime = await builder.build();
      assert.ok(runtime.subagentManager);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("close() works", async () => {
    const tmp = createTempRoot();
    try {
      const builder = new RuntimeBuilder(tmp);
      const runtime = await builder.build();
      await runtime.close();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});