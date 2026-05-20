import { describe, it } from "node:test";
import assert from "node:assert";
import { ContextRanker } from "../../src/context/context-ranker.js";

describe("ContextRanker", () => {
  it("ranks files by relevance score", () => {
    const ranker = new ContextRanker();
    const files = [
      { path: "src/main.ts", score: 0.5 },
      { path: "src/utils.ts", score: 0.8 },
      { path: "tests/main.test.ts", score: 0.3 },
    ];

    const ranked = ranker.rankFiles(files);
    assert.equal(ranked[0].path, "src/utils.ts");
    assert.equal(ranked[ranked.length - 1].path, "tests/main.test.ts");
  });

  it("boosts recently modified files", () => {
    const ranker = new ContextRanker({ recencyBoost: 0.3 });
    const now = Date.now();
    const files = [
      { path: "old.ts", score: 0.5, modifiedAt: new Date(now - 86400000 * 30) },
      { path: "recent.ts", score: 0.5, modifiedAt: new Date(now - 86400000) },
    ];

    const ranked = ranker.rankFiles(files);
    assert.ok(ranked[0].path === "recent.ts");
  });

  it("applies hot path boost", () => {
    const ranker = new ContextRanker({ hotPathBoost: 0.2 });
    const files = [
      { path: "stable.ts", score: 0.5, changeCount: 1 },
      { path: "active.ts", score: 0.5, changeCount: 10 },
    ];

    const ranked = ranker.rankFiles(files);
    assert.ok(ranked[0].path === "active.ts");
  });

  it("limits results to maxFiles", () => {
    const ranker = new ContextRanker({ maxFiles: 2 });
    const files = Array.from({ length: 5 }, (_, i) => ({ path: `file${i}.ts`, score: i / 5 }));

    const ranked = ranker.rankFiles(files);
    assert.equal(ranked.length, 2);
  });
});