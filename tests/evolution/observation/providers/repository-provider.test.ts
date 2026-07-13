// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { RepositoryObservationProvider } from "../../../../src/evolution/observation/providers/repository-provider.js";

describe("RepositoryObservationProvider", () => {
  const provider = new RepositoryObservationProvider();
  let tmpDir: string;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "a5-repo-test-"));
    // Create a minimal project structure
    mkdirSync(join(tmpDir, "src"));
    writeFileSync(join(tmpDir, "src", "index.ts"), "export const x = 1;\n");
    writeFileSync(join(tmpDir, "src", "utils.ts"), "export function add(a: number, b: number): number {\n  return a + b;\n}\n");
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({
      dependencies: { express: "^4.0.0" },
      devDependencies: { typescript: "^5.0.0" },
    }));
    // Init git and commit
    try {
      execSync("git init", { cwd: tmpDir, stdio: "pipe" });
      execSync("git checkout -b main", { cwd: tmpDir, stdio: "pipe" });
      execSync('git config user.email "test@test.com"', { cwd: tmpDir, stdio: "pipe" });
      execSync('git config user.name "Test"', { cwd: tmpDir, stdio: "pipe" });
      execSync("git add .", { cwd: tmpDir, stdio: "pipe" });
      execSync("git commit -m init", { cwd: tmpDir, stdio: "pipe" });
    } catch {
      // git not available or already in a repo
    }
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("has name 'repository'", () => {
    assert.equal(provider.name, "repository");
  });

  it("scans file count and lines", async () => {
    const result = await provider.observe({
      observationId: "repo-1",
      provider: "repository",
      description: "Repository health check",
      params: { cwd: tmpDir },
    });

    assert.equal(result.status, "pass");
    assert.equal(typeof result.evidence.totalFiles, "number");
    assert.ok((result.evidence.totalFiles as number) >= 2); // At least index.ts + utils.ts + package.json
    assert.equal(typeof result.evidence.totalLines, "number");
    assert.ok((result.evidence.totalLines as number) > 0);
  });

  it("detects dependency count from package.json", async () => {
    const result = await provider.observe({
      observationId: "repo-2",
      provider: "repository",
      description: "Dependency check",
      params: { cwd: tmpDir },
    });

    assert.equal(result.status, "pass");
    assert.equal(result.evidence.dependencyCount, 1); // express
    assert.equal(result.evidence.devDependencyCount, 1); // typescript
  });

  it("detects git state", async () => {
    const result = await provider.observe({
      observationId: "repo-3",
      provider: "repository",
      description: "Git state",
      params: { cwd: tmpDir },
    });

    assert.equal(result.status, "pass");
    assert.equal(result.evidence.currentBranch, "main");
  });

  it("reports unused file without crashing", async () => {
    // Create a new file without committing
    writeFileSync(join(tmpDir, "untracked.txt"), "untracked content");

    const result = await provider.observe({
      observationId: "repo-4",
      provider: "repository",
      description: "Modified repo",
      params: { cwd: tmpDir },
    });

    assert.equal(result.status, "pass");
    assert.ok((result.evidence.uncommittedChanges as number) > 0);
  });

  it("never throws on invalid params", async () => {
    const result = await provider.observe({
      observationId: "repo-5",
      provider: "repository",
      description: "Invalid path",
      params: { cwd: "/nonexistent-path-xyz-12345" },
    });

    assert.ok(result); // Should always return a result
    assert.equal(result.observationId, "repo-5");
  });
});
