import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleObservability } from "../../src/cli/commands/observability.js";

describe("observability CLI", () => {
  let tmpDir: string;
  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "obs-cli-test-"));
    mkdirSync(join(tmpDir, ".alix"), { recursive: true });
  });
  after(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("health subcommand produces output with expected sections", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));
    try {
      await handleObservability(["health"], tmpDir);
      const output = logs.join("\n");
      assert.ok(output.includes("ALiX Health"));
      assert.ok(output.includes("Daemon"));
      assert.ok(output.includes("Providers"));
      assert.ok(output.includes("Memory"));
    } finally {
      console.log = origLog;
    }
  });
});
