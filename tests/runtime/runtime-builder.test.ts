import { describe, it } from "node:test";
import assert from "node:assert";
import { RuntimeBuilder } from "../../src/runtime/runtime-builder.js";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

describe("RuntimeBuilder", () => {
  it("builds a Runtime", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "runtime-test-"));
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
    const tmp = mkdtempSync(join(tmpdir(), "runtime-test-"));
    try {
      const builder = new RuntimeBuilder(tmp);
      const runtime = await builder.build();
      assert.ok(runtime.eventLog);
      assert.ok(runtime.policyEngine);
      assert.ok(runtime.toolExecutor);
      assert.ok(runtime.contextCompiler);
      assert.ok(runtime.scopeTracker);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("Runtime has optional subagentManager when enabled in config", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "runtime-test-"));
    try {
      const builder = new RuntimeBuilder(tmp);
      const runtime = await builder.build();
      // subagentManager is undefined by default (no config with enableSubagents)
      assert.equal(runtime.subagentManager, undefined);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("close() works", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "runtime-test-"));
    try {
      const builder = new RuntimeBuilder(tmp);
      const runtime = await builder.build();
      await runtime.close();
      // No error means success
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});