import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execSync, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CLI_PATH = join(process.cwd(), "dist", "src", "cli.js");

describe("alix ownership CLI", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "own-cli-"));
    mkdirSync(join(dir, ".alix", "ownership"), { recursive: true });
  });

  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("list shows 'No active ownership records' when empty", () => {
    const out = execFileSync(process.execPath, [CLI_PATH, "ownership", "list"], {
      cwd: dir, encoding: "utf-8",
    });
    assert.ok(out.includes("No active ownership records"));
  });

  it("acquire creates a record", () => {
    const out = execFileSync(process.execPath, [
      CLI_PATH, "ownership", "acquire",
      "--agent", "test-bot",
      "--path", "src/**",
      "--mode", "exclusive-write",
    ], { cwd: dir, encoding: "utf-8" });
    assert.ok(out.includes("Acquired:"));
    assert.ok(out.includes("exclusive-write"));
  });

  it("acquired record appears in list", () => {
    execFileSync(process.execPath, [
      CLI_PATH, "ownership", "acquire",
      "--agent", "test-bot",
      "--path", "src/**",
      "--mode", "exclusive-write",
    ], { cwd: dir });
    const out = execFileSync(process.execPath, [CLI_PATH, "ownership", "list"], {
      cwd: dir, encoding: "utf-8",
    });
    assert.ok(out.includes("test-bot"));
    assert.ok(out.includes("exclusive-write"));
  });

  it("history shows released records", () => {
    const acquire = execFileSync(process.execPath, [
      CLI_PATH, "ownership", "acquire",
      "--agent", "test-bot",
      "--path", "x/**",
      "--mode", "exclusive-write",
    ], { cwd: dir, encoding: "utf-8" });
    const idMatch = acquire.match(/own_[a-z0-9]+/);
    assert.ok(idMatch, "Should find ownership ID in output");
    const id = idMatch![0];
    execFileSync(process.execPath, [CLI_PATH, "ownership", "release", id], { cwd: dir });
    const out = execFileSync(process.execPath, [CLI_PATH, "ownership", "history"], {
      cwd: dir, encoding: "utf-8",
    });
    assert.ok(out.includes("released"));
  });
});
