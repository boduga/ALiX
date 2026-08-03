import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { runInstall, resolveInstallOptions } from "../../../../src/cli/commands/skills/install.js";
import { join } from "node:path";
import { existsSync, rmSync } from "node:fs";
import { mkdirSync } from "node:fs";

const testDir = join(process.cwd(), ".test-alix-skills");

describe("resolveInstallOptions", () => {
  it("resolves bare 'available' subcommand", () => {
    assert.deepEqual(resolveInstallOptions(["available"]), {
      available: true, list: false, all: false, name: undefined,
    });
  });

  it("resolves 'install <name>' — name is the second arg, not 'install'", () => {
    assert.deepEqual(resolveInstallOptions(["install", "tdd"]), {
      available: false, list: false, all: false, name: "tdd",
    });
  });

  it("resolves 'install --all'", () => {
    assert.deepEqual(resolveInstallOptions(["install", "--all"]), {
      available: false, list: false, all: true, name: undefined,
    });
  });

  it("resolves 'install --list'", () => {
    assert.deepEqual(resolveInstallOptions(["install", "--list"]), {
      available: false, list: true, all: false, name: undefined,
    });
  });

  it("resolves legacy '--available' flag", () => {
    assert.deepEqual(resolveInstallOptions(["--available"]), {
      available: true, list: false, all: false, name: undefined,
    });
  });

  it("resolves empty args to a bare call (help path)", () => {
    assert.deepEqual(resolveInstallOptions([]), {
      available: false, list: false, all: false, name: undefined,
    });
  });
});

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