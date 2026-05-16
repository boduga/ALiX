import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rankContextCandidate } from "../../src/repomap/context-ranker.js";

describe("rankContextCandidate", () => {
  it("combines mention, dependency, symbol, test, config, and git activity signals", () => {
    const ranked = rankContextCandidate({
      path: "src/auth.ts",
      baseKind: "source",
      mentionScore: 100,
      dependencyDistance: 1,
      symbolMatched: true,
      relatedTest: false,
      config: false,
      gitTouches: 3,
    });

    assert.equal(ranked.score, 163);
    assert.deepEqual(ranked.reasons, [
      "task_mention:100",
      "dependency_distance:1",
      "symbol_match",
      "git_activity:3",
    ]);
  });

  it("scores config files without pretending they are edit targets", () => {
    const ranked = rankContextCandidate({
      path: "package.json",
      baseKind: "config",
      mentionScore: 0,
      dependencyDistance: null,
      symbolMatched: false,
      relatedTest: false,
      config: true,
      gitTouches: 0,
    });

    assert.equal(ranked.score, 10);
    assert.deepEqual(ranked.reasons, ["config_file"]);
  });
});