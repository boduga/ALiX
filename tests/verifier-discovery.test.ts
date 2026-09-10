import { describe, it } from "node:test";
import assert from "node:assert";
import { existsSync, mkdirSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { discoverVerification, requiresRepositoryVerification } from "../src/verifier/verifier.js";

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

  it("does not auto-run manual, eval, soak, benchmark, helper, or aggregate scripts", async () => {
    const testDir = makeTempDir();
    setupPkg({
      typecheck: "tsc --noEmit",
      build: "tsc",
      test: "vitest run",
      check: "npm run build && npm run test:node",
      "copy:profiles": "node scripts/copy.mjs",
      "test:node": "node scripts/run-node-tests.mjs",
      "test:unit:node": "echo legacy",
      "test:evals": "vitest run tests/evals",
      "test:manual": "node scripts/run-node-tests.mjs --manual",
      "test:soak": "node --test tests/soak/*.test.js",
      benchmark: "node benchmark/run.mjs",
    }, testDir);
    try {
      const checks = await discoverVerification(testDir);
      assert.deepStrictEqual(checks.map((check) => check.command), [
        "npm run typecheck",
        "npm run build",
        "npm test",
      ]);
    } finally {
      cleanup(testDir);
    }
  });

  it("returns empty when no package.json", async () => {
    const checks = await discoverVerification("/tmp/nonexistent-dir");
    assert.strictEqual(checks.length, 0);
  });
});

describe("requiresRepositoryVerification", () => {
  it("skips repository commands for harmless content files", () => {
    assert.equal(requiresRepositoryVerification(["alix-safety-test.txt"]), false);
    assert.equal(requiresRepositoryVerification(["README.md", "notes.rst"]), false);
  });

  it("keeps verification for code, configuration, and unknown file types", () => {
    assert.equal(requiresRepositoryVerification(["src/index.ts"]), true);
    assert.equal(requiresRepositoryVerification(["package.json"]), true);
    assert.equal(requiresRepositoryVerification(["tests/fixtures/events.jsonl"]), true);
    assert.equal(requiresRepositoryVerification(["src/ui/logo.svg"]), true);
    assert.equal(requiresRepositoryVerification(["generated/custom.artifact"]), true);
    assert.equal(requiresRepositoryVerification(["README.md", "src/index.ts"]), true);
  });
});
