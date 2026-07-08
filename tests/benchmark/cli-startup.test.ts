import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findRepoRoot, resolveBuiltCliPath } from "../../src/benchmark/cases/cli-startup.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("cli startup benchmark path resolution", () => {
  it("walks upward until package.json is found", () => {
    const root = mkdtempSync(join(tmpdir(), "alix-benchmark-root-"));
    tempDirs.push(root);
    const nested = join(root, "dist", "src", "benchmark", "cases");

    writeFileSync(join(root, "package.json"), "{}");
    writeFileSync(join(root, "marker"), "");
    rmSync(join(root, "marker"));

    assert.equal(findRepoRoot(nested), root);
  });

  it("resolves built CLI from a compiled benchmark case directory", () => {
    const root = mkdtempSync(join(tmpdir(), "alix-benchmark-root-"));
    tempDirs.push(root);
    const compiledCaseDir = join(root, "dist", "src", "benchmark", "cases");

    writeFileSync(join(root, "package.json"), "{}");

    assert.equal(resolveBuiltCliPath(compiledCaseDir), join(root, "dist", "src", "cli.js"));
  });
});
