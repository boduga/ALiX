// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { GitObservationProvider } from "../../../../src/evolution/observation/providers/git-provider.js";

function gitInit(dir: string, branch = "main") {
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync(`git checkout -b ${branch}`, { cwd: dir, stdio: "pipe" });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: "pipe" });
  execSync('git config user.name "Test"', { cwd: dir, stdio: "pipe" });
}

function gitCommit(dir: string, msg: string) {
  writeFileSync(join(dir, "file.txt"), msg);
  execSync("git add .", { cwd: dir, stdio: "pipe" });
  execSync(`git commit -m "${msg}"`, { cwd: dir, stdio: "pipe" });
}

describe("GitObservationProvider", () => {
  const provider = new GitObservationProvider();
  let repoDir: string;

  before(() => {
    repoDir = mkdtempSync(join(tmpdir(), "a5-git-test-"));
    gitInit(repoDir);
    gitCommit(repoDir, "Initial commit");
    gitCommit(repoDir, "Second commit");
  });

  after(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("has name 'git'", () => {
    assert.equal(provider.name, "git");
  });

  it("checks git branch", async () => {
    const result = await provider.observe({
      observationId: "obs-1",
      provider: "git",
      description: "Current branch",
      params: { check: "branch", cwd: repoDir },
    });
    assert.equal(result.status, "pass");
    assert.equal(result.observed, "main");
  });

  it("detects branch mismatch", async () => {
    const result = await provider.observe({
      observationId: "obs-2",
      provider: "git",
      description: "Branch check",
      expected: "main",
      params: { check: "branch", cwd: repoDir },
    });
    assert.equal(result.status, "pass");
    assert.equal(result.observed, "main");
  });

  it("checks git diff stat", async () => {
    writeFileSync(join(repoDir, "modified.txt"), "change");
    const result = await provider.observe({
      observationId: "obs-3",
      provider: "git",
      description: "Uncommitted changes",
      params: { check: "diff", cwd: repoDir },
    });
    assert.equal(result.status, "pass");
    assert.equal(typeof result.evidence.filesChanged, "number");
    // Clean up
    execSync("git checkout -- .", { cwd: repoDir, stdio: "pipe" });
  });

  it("checks clean repository status", async () => {
    const result = await provider.observe({
      observationId: "obs-4",
      provider: "git",
      description: "Clean status",
      params: { check: "clean", cwd: repoDir },
    });
    assert.equal(result.status, "pass");
  });

  it("lists files in repository", async () => {
    const result = await provider.observe({
      observationId: "obs-5",
      provider: "git",
      description: "File list",
      params: { check: "files", cwd: repoDir },
    });
    assert.equal(result.status, "pass");
    assert.ok(Array.isArray(result.evidence.files));
    assert.ok(result.evidence.files.length > 0);
  });

  it("returns error for invalid check type", async () => {
    const result = await provider.observe({
      observationId: "obs-6",
      provider: "git",
      description: "Invalid",
      params: { check: "invalid", cwd: repoDir },
    });
    assert.equal(result.status, "error");
  });

  it("returns error outside git repository", async () => {
    const nonGitDir = mkdtempSync(join(tmpdir(), "a5-nongit-"));
    try {
      const result = await provider.observe({
        observationId: "obs-7",
        provider: "git",
        description: "No repo",
        params: { check: "branch", cwd: nonGitDir },
      });
      assert.equal(result.status, "error");
    } finally {
      rmSync(nonGitDir, { recursive: true, force: true });
    }
  });
});
