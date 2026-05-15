import { describe, it } from "node:test";
import assert from "node:assert";
import { existsSync, mkdirSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { discoverVerification } from "../src/verifier/verifier.js";

describe("discoverVerification", () => {
  function setupPkg(scripts: Record<string, string>, dir: string) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts }));
  }

  function cleanup(dir: string) {
    try { unlinkSync(join(dir, "package.json")); } catch {}
    try { rmdirSync(dir); } catch {}
  }

  function makeTempDir() {
    return join("/tmp", `verifier-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  }

  it("finds npm test", async () => {
    const testDir = makeTempDir();
    setupPkg({ test: "npm test" }, testDir);
    try {
      const checks = await discoverVerification(testDir);
      assert.ok(checks.some((c) => c.command.includes("npm test")));
    } finally {
      cleanup(testDir);
    }
  });

  it("finds npm run build", async () => {
    const testDir = makeTempDir();
    setupPkg({ build: "tsc" }, testDir);
    try {
      const checks = await discoverVerification(testDir);
      assert.ok(checks.some((c) => c.command.includes("npm run build")));
    } finally {
      cleanup(testDir);
    }
  });

  it("finds npm run typecheck", async () => {
    const testDir = makeTempDir();
    setupPkg({ typecheck: "tsc --noEmit" }, testDir);
    try {
      const checks = await discoverVerification(testDir);
      assert.ok(checks.some((c) => c.command.includes("npm run typecheck")));
    } finally {
      cleanup(testDir);
    }
  });

  it("finds multiple checks", async () => {
    const testDir = makeTempDir();
    setupPkg({ test: "jest", build: "tsc", typecheck: "tsc --noEmit" }, testDir);
    try {
      const checks = await discoverVerification(testDir);
      assert.ok(checks.length >= 2);
    } finally {
      cleanup(testDir);
    }
  });

  it("finds npm run lint", async () => {
    const testDir = makeTempDir();
    setupPkg({ lint: "eslint ." }, testDir);
    try {
      const checks = await discoverVerification(testDir);
      assert.ok(checks.some((c) => c.command.includes("npm run lint")));
    } finally {
      cleanup(testDir);
    }
  });

  it("returns empty when no package.json", async () => {
    const checks = await discoverVerification("/tmp/nonexistent-dir");
    assert.strictEqual(checks.length, 0);
  });
});