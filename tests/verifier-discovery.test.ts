import { describe, it } from "node:test";
import assert from "node:assert";
import { existsSync, mkdirSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { discoverVerification } from "../src/verifier/verifier.js";

describe("discoverVerification", () => {
  const tmpDir = join("/tmp", `verifier-test-${Date.now()}`);

  function setupPkg(scripts: Record<string, string>) {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ scripts }));
  }

  function cleanup() {
    try { unlinkSync(join(tmpDir, "package.json")); } catch {}
    try { rmdirSync(tmpDir); } catch {}
  }

  it("finds npm test", async () => {
    setupPkg({ test: "npm test" });
    const checks = await discoverVerification(tmpDir);
    assert.ok(checks.some((c) => c.command.includes("npm test")));
    cleanup();
  });

  it("finds npm run build", async () => {
    setupPkg({ build: "tsc" });
    const checks = await discoverVerification(tmpDir);
    assert.ok(checks.some((c) => c.command.includes("npm run build")));
    cleanup();
  });

  it("finds npm run typecheck", async () => {
    setupPkg({ typecheck: "tsc --noEmit" });
    const checks = await discoverVerification(tmpDir);
    assert.ok(checks.some((c) => c.command.includes("npm run typecheck")));
    cleanup();
  });

  it("finds multiple checks", async () => {
    setupPkg({ test: "jest", build: "tsc", typecheck: "tsc --noEmit" });
    const checks = await discoverVerification(tmpDir);
    assert.ok(checks.length >= 2);
    cleanup();
  });

  it("returns empty when no package.json", async () => {
    const checks = await discoverVerification("/tmp/nonexistent-dir");
    assert.strictEqual(checks.length, 0);
  });
});