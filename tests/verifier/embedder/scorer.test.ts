import { describe, it } from "node:test";
import assert from "node:assert";
import { EmbeddingScorer } from "../../../src/verifier/embedder/scorer.js";

describe("EmbeddingScorer", () => {
  it("creates embedding from verification context", async () => {
    const scorer = new EmbeddingScorer({ dimensions: 128, modelName: "test", provider: "local" });

    const context = {
      taskType: "research",
      files: ["src/auth.ts", "src/user.ts"],
      errors: ["TypeError: Cannot read property 'name' of undefined"],
      tools: ["file.read", "shell.run"],
    };

    const embedding = await scorer.createEmbedding(context);
    assert.ok(embedding);
    assert.equal(embedding.length, 128);
  });

  it("calculates cosine similarity between embeddings", async () => {
    const scorer = new EmbeddingScorer({ dimensions: 4, modelName: "test", provider: "local" });

    const a = new Float32Array([1, 0, 0, 0]);
    const b = new Float32Array([1, 0, 0, 0]);
    const c = new Float32Array([0, 1, 0, 0]);

    assert.ok(scorer.cosineSimilarity(a, b) > 0.9);
    assert.ok(scorer.cosineSimilarity(a, c) < 0.1);
  });

  it("scores verification confidence", async () => {
    const scorer = new EmbeddingScorer({ dimensions: 64, modelName: "test", provider: "local" });

    const result = await scorer.scoreVerification({
      taskType: "research",
      files: ["src/test.ts"],
      errors: [],
      tools: ["shell.run"],
    });

    assert.ok(result.score >= 0 && result.score <= 1);
    assert.ok(result.factors);
  });
});