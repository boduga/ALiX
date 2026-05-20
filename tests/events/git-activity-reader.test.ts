import { describe, it } from "node:test";
import assert from "node:assert";
import { GitActivityReader } from "../../src/events/git-activity-reader.js";

describe("GitActivityReader", () => {
  it("reads recent commits", async () => {
    const reader = new GitActivityReader({ cwd: process.cwd() });
    const commits = await reader.getRecentCommits({ limit: 5 });
    assert.ok(Array.isArray(commits));
    assert.ok(commits.length <= 5);
    if (commits.length > 0) {
      assert.ok("hash" in commits[0]);
      assert.ok("message" in commits[0]);
    }
  });

  it("gets changed files from recent commits", async () => {
    const reader = new GitActivityReader({ cwd: process.cwd() });
    const commits = await reader.getRecentCommits({ limit: 3 });
    if (commits.length > 0) {
      const files = await reader.getChangedFiles(commits[0].hash);
      assert.ok(Array.isArray(files));
    }
  });

  it("detects hot paths by frequency", async () => {
    const reader = new GitActivityReader({ cwd: process.cwd() });
    const hotPaths = await reader.getHotPaths({ days: 30, minChanges: 2 });
    assert.ok(Array.isArray(hotPaths));
  });
});