import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("approval ID regex", () => {
  // Must match the regex used in route-executor.ts
  const RE = /(approval_[a-zA-Z0-9_-]+)/;

  it("captures full ID with timestamp and random suffix", () => {
    const id = "approval_1718100000000_a1b2c";
    const match = id.match(RE);
    assert.ok(match);
    assert.equal(match[1], id);
  });

  it("captures ID with hyphens in random part", () => {
    const id = "approval_1718100000000_a1b2c-xyz";
    const match = id.match(RE);
    assert.ok(match);
    assert.equal(match[1], id);
  });

  it("does NOT match missing prefix", () => {
    const match = "no-match".match(RE);
    assert.equal(match, null);
  });

  it("extracts approval ID from full error message", () => {
    const msg = "Pending approval: approval_1718100000000_a1b2c";
    const match = msg.match(RE);
    assert.ok(match);
    assert.equal(match[1], "approval_1718100000000_a1b2c");
  });

  it("matches when ID is at end of string", () => {
    const msg = "Approval required: approval_123_xyz";
    const idMatch = msg.match(RE);
    assert.ok(idMatch);
    assert.equal(idMatch[1], "approval_123_xyz");
  });

  it("does NOT truncate at underscore separator", () => {
    // This is THE bug: the old regex stopped at the second underscore
    // The full ID is approval_<ts>_<random>, and the _ before random
    // was not matched by [a-zA-Z0-9-]
    const fullId = "approval_1781213289696_abcde";
    const truncated = "approval_1781213289696";
    const match = fullId.match(RE);
    assert.ok(match);
    assert.notEqual(match[1], truncated, "must NOT truncate the random suffix");
    assert.equal(match[1], fullId, "must preserve the full ID");
  });
});
