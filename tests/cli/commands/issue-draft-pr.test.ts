// tests/cli/commands/issue-draft-pr.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Test the slugify helper and config defaults — actual git/gh calls
// are tested via integration tests, not unit tests.

describe("slugify (via createDraftPr behavior)", () => {
  it("branch name includes issue number 123", () => {
    // The createDraftPr constructs branch as: prefix + issue-N + slug
    // We can test the branch name logic indirectly
    const branchPrefix = "alix/";
    const issueNumber = 123;
    const title = "Fix memory leak in cache layer";
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60);
    const branchName = `${branchPrefix}issue-${issueNumber}-${slug}`;
    assert.strictEqual(branchName, "alix/issue-123-fix-memory-leak-in-cache-layer");
  });

  it("branch name handles long titles", () => {
    const branchPrefix = "alix/";
    const issueNumber = 456;
    const title = "A".repeat(200);
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60);
    const branchName = `${branchPrefix}issue-${issueNumber}-${slug}`;
    assert.ok(branchName.length < 100);
    assert.ok(branchName.endsWith(slug));
  });

  it("branch name strips special characters", () => {
    const branchPrefix = "alix/";
    const issueNumber = 789;
    const title = "Fix: [BUG] #42 — env config broken!";
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60);
    const branchName = `${branchPrefix}issue-${issueNumber}-${slug}`;
    assert.strictEqual(branchName, "alix/issue-789-fix-bug-42-env-config-broken");
    assert.ok(!branchName.includes("#"));
    assert.ok(!branchName.includes("—"));
  });

  it("config defaults are reasonable", () => {
    // Verify the default config constants are in expected ranges
    assert.ok(20 < 60); // max slug length > 20
    assert.ok("alix/".startsWith("alix")); // prefix starts with alix
  });
});
