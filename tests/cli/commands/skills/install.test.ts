import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { runInstall } from "../../../../src/cli/commands/skills/install.js";
import { join } from "node:path";
import { existsSync, rmSync } from "node:fs";
import { mkdirSync } from "node:fs";

const testDir = join(process.cwd(), ".test-alix-skills");

describe("install command", () => {
  beforeEach(() => {
    // Mock HOME to test directory
    process.env.HOME = testDir;
    mkdirSync(join(testDir, ".alix", "skills"), { recursive: true });
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("should list installed skills", async () => {
    await runInstall({ list: true });
    // Test passes if no error thrown
  });

  it("should install a core skill", async () => {
    await runInstall({ name: "tdd" });
    assert.ok(existsSync(join(testDir, ".alix", "skills", "tdd", "SKILL.md")), "tdd skill should be installed");
  });

  it("should throw for non-existent skill", async () => {
    await assert.rejects(runInstall({ name: "nonexistent" }), /not found/);
  });
});