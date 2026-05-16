import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readGitActivity } from "../../src/repomap/git-activity.js";

describe("readGitActivity", () => {
  it("returns an empty map outside a git repository", async () => {
    const dir = await mkdtemp(join(tmpdir(), "alix-git-activity-"));
    try {
      const activity = await readGitActivity(dir);
      assert.deepEqual([...activity.entries()], []);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("parses git log numstat output", async () => {
    const activity = await readGitActivity("/repo", {
      runGitLog: async () => [
        "src/a.ts",
        "src/b.ts",
        "src/a.ts",
      ].join("\n"),
    });

    assert.equal(activity.get("src/a.ts"), 2);
    assert.equal(activity.get("src/b.ts"), 1);
  });
});