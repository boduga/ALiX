import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

describe("git stash/restore test isolation", () => {
  const testDir = join(tmpdir(), `test-isolation-${Date.now()}`);

  // These tests exercise the SANDBOX path deliberately, so they opt in.
  // `stashChanges` now refuses any root that is not an explicit verification
  // sandbox — that guard is what stops a verification pass from capturing a
  // real working tree (see verification-isolation-guard.vitest.ts). A bare
  // temp dir is NOT auto-trusted: this repo runs real agent work in temp dirs.
  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    process.env.ALIX_VERIFY_ISOLATION_ROOT = testDir;
    writeFileSync(join(testDir, "package.json"), JSON.stringify({ scripts: {} }));
    writeFileSync(join(testDir, "index.js"), "console.log('hello');");
    // Initialize git repo for testing
    try { execSync("git init", { cwd: testDir, stdio: "ignore" }); } catch {}
    try { execSync("git config user.email 'test@test.com'", { cwd: testDir, stdio: "ignore" }); } catch {}
    try { execSync("git config user.name 'Test'", { cwd: testDir, stdio: "ignore" }); } catch {}
    try { execSync("git add .", { cwd: testDir, stdio: "ignore" }); } catch {}
    try { execSync("git commit -m 'initial'", { cwd: testDir, stdio: "ignore" }); } catch {}
  });

  afterEach(() => {
    delete process.env.ALIX_VERIFY_ISOLATION_ROOT;
    try { rmSync(testDir, { recursive: true }); } catch {}
  });

  it("stashes changes before running verification", async () => {
    const { stashChanges } = await import("../../src/capabilities/skills/test-isolation.js");
    writeFileSync(join(testDir, "index.js"), "console.log('modified');");
    const stashId = await stashChanges(testDir);
    assert.ok(stashId !== null && stashId.length > 0, "Should return a stash reference");
    // File should be restored to original
    const content = readFileSync(join(testDir, "index.js"), "utf8");
    assert.strictEqual(content, "console.log('hello');");
  });

  it("restores changes after verification", async () => {
    const { stashChanges, restoreChanges } = await import("../../src/capabilities/skills/test-isolation.js");
    writeFileSync(join(testDir, "index.js"), "console.log('modified');");
    const stashId = await stashChanges(testDir);
    const clean = readFileSync(join(testDir, "index.js"), "utf8");
    assert.strictEqual(clean, "console.log('hello');");
    await restoreChanges(testDir, stashId);
    const restored = readFileSync(join(testDir, "index.js"), "utf8");
    assert.strictEqual(restored, "console.log('modified');");
  });

  it("returns null stashId when nothing to stash", async () => {
    const { stashChanges } = await import("../../src/capabilities/skills/test-isolation.js");
    const stashId = await stashChanges(testDir);
    // No changes -> nothing to stash -> null
    assert.ok(stashId === null || stashId === "");
  });
});