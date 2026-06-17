import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeCapability,
  matchCapabilities,
} from "../../src/kernel/collaborative-planner.js";

// ─── normalizeCapability ──────────────────────────────────────────────

describe("normalizeCapability", () => {
  it("passes canonical IDs through unchanged", () => {
    assert.equal(normalizeCapability("filesystem.read"), "filesystem.read");
    assert.equal(normalizeCapability("filesystem.write"), "filesystem.write");
  });

  it("maps alias 'read' to 'filesystem.read'", () => {
    assert.equal(normalizeCapability("read"), "filesystem.read");
  });

  it("maps alias 'write' to 'filesystem.write'", () => {
    assert.equal(normalizeCapability("write"), "filesystem.write");
  });

  it("maps alias 'filesystem_read' to 'filesystem.read'", () => {
    assert.equal(normalizeCapability("filesystem_read"), "filesystem.read");
  });

  it("maps alias 'filesystem_write' to 'filesystem.write'", () => {
    assert.equal(normalizeCapability("filesystem_write"), "filesystem.write");
  });

  it("lowercases input before lookup", () => {
    assert.equal(normalizeCapability("Read"), "filesystem.read");
    assert.equal(normalizeCapability("FILESYSTEM_READ"), "filesystem.read");
    assert.equal(normalizeCapability("FILESYSTEM.READ"), "filesystem.read");
  });

  it("trims whitespace before lookup", () => {
    assert.equal(normalizeCapability("  read  "), "filesystem.read");
    assert.equal(normalizeCapability("\twrite\n"), "filesystem.write");
  });

  it("strips invalid characters", () => {
    assert.equal(normalizeCapability("file_system!read@"), "file_systemread");
    // The stripped form doesn't match any alias, so it's returned as-is.
  });

  it("returns normalized string as-is when not in alias registry", () => {
    assert.equal(normalizeCapability("custom.capability"), "custom.capability");
    assert.equal(normalizeCapability("file.create"), "file.create");
    assert.equal(normalizeCapability("unknown"), "unknown");
  });

  it("handles empty string", () => {
    assert.equal(normalizeCapability(""), "");
  });
});

// ─── matchCapabilities ────────────────────────────────────────────────

describe("matchCapabilities", () => {
  it("exact match returns score 1 with no unmatched", () => {
    const result = matchCapabilities(["filesystem.read"], ["filesystem.read"]);
    assert.deepEqual(result, { matched: ["filesystem.read"], unmatched: [], score: 1 });
  });

  it("canonical alias match resolves through registry", () => {
    const result = matchCapabilities(["read"], ["filesystem.read"]);
    assert.deepEqual(result, { matched: ["read"], unmatched: [], score: 1 });
  });

  it("multiple aliases all resolve to canonical", () => {
    const result = matchCapabilities(["read", "write"], ["filesystem.read", "filesystem.write"]);
    assert.deepEqual(result, { matched: ["read", "write"], unmatched: [], score: 1 });
  });

  it("no match returns score 0 with all unmatched", () => {
    const result = matchCapabilities(["filesystem.read"], ["network.http"]);
    assert.deepEqual(result, { matched: [], unmatched: ["filesystem.read"], score: 0 });
  });

  it("partial match returns correct ratio", () => {
    const result = matchCapabilities(
      ["filesystem.read", "network.http"],
      ["filesystem.read"],
    );
    assert.deepEqual(result, {
      matched: ["filesystem.read"],
      unmatched: ["network.http"],
      score: 0.5,
    });
  });

  it("2 of 3 match returns score 2/3", () => {
    const result = matchCapabilities(
      ["filesystem.read", "filesystem.write", "network.http"],
      ["filesystem.read", "filesystem.write"],
    );
    assert.deepEqual(result, {
      matched: ["filesystem.read", "filesystem.write"],
      unmatched: ["network.http"],
      score: 2 / 3,
    });
  });

  it("empty required returns score 0", () => {
    const result = matchCapabilities([], ["filesystem.read"]);
    assert.deepEqual(result, { matched: [], unmatched: [], score: 0 });
  });

  it("empty agent capabilities returns score 0", () => {
    const result = matchCapabilities(["filesystem.read"], []);
    assert.deepEqual(result, { matched: [], unmatched: ["filesystem.read"], score: 0 });
  });

  it("both empty returns score 0", () => {
    const result = matchCapabilities([], []);
    assert.deepEqual(result, { matched: [], unmatched: [], score: 0 });
  });

  describe("substring is NOT a match (exact canonical equality only)", () => {
    it("'filesystem' does not match 'filesystem.read'", () => {
      const result = matchCapabilities(["filesystem"], ["filesystem.read"]);
      assert.deepEqual(result, { matched: [], unmatched: ["filesystem"], score: 0 });
    });

    it("'filesystem.' does not match 'filesystem.read'", () => {
      const result = matchCapabilities(["filesystem."], ["filesystem.read"]);
      assert.deepEqual(result, { matched: [], unmatched: ["filesystem."], score: 0 });
    });

    it("'read' without alias does not match 'filesystem.read'", () => {
      // 'read' maps to 'filesystem.read' via alias, so this WOULD match.
      // This test confirms that a non-aliased substring prefix does NOT match.
      const result = matchCapabilities(["filesystem.rea"], ["filesystem.read"]);
      assert.deepEqual(result, { matched: [], unmatched: ["filesystem.rea"], score: 0 });
    });
  });

  describe("case insensitivity", () => {
    it("uppercase required matches lowercase agent capability", () => {
      const result = matchCapabilities(["READ"], ["filesystem.read"]);
      assert.deepEqual(result, { matched: ["READ"], unmatched: [], score: 1 });
    });

    it("mixed case required matches agent capability", () => {
      const result = matchCapabilities(["FileSystem.Read"], ["filesystem.read"]);
      assert.deepEqual(result, { matched: ["FileSystem.Read"], unmatched: [], score: 1 });
    });

    it("uppercase agent capability matches lowercase required", () => {
      const result = matchCapabilities(["filesystem.read"], ["FILESYSTEM.READ"]);
      assert.deepEqual(result, { matched: ["filesystem.read"], unmatched: [], score: 1 });
    });
  });

  it("duplicates in required are preserved in matched/unmatched", () => {
    const result = matchCapabilities(
      ["filesystem.read", "filesystem.read"],
      ["filesystem.read"],
    );
    assert.deepEqual(result, {
      matched: ["filesystem.read", "filesystem.read"],
      unmatched: [],
      score: 1,
    });
  });

  it("duplicates in agent capabilities are deduped (Set behavior)", () => {
    const result = matchCapabilities(
      ["filesystem.read"],
      ["filesystem.read", "filesystem.read"],
    );
    assert.deepEqual(result, { matched: ["filesystem.read"], unmatched: [], score: 1 });
  });
});
