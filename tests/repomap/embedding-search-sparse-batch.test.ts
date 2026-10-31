import { test } from "node:test";
import assert from "node:assert/strict";
import { EmbeddingCache } from "../../src/context/repomap/embedding-cache.js";

test("search preserves file-to-vector alignment across sparse batches without model downloads", async () => {
  const cache = new EmbeddingCache("/tmp/alix-embedding-search-sparse-batch-test");
  const vectors: Record<string, number[]> = {
    query: [1, 0],
    alpha: [1, 0],
    beta: [0, 1],
    gamma: [-1, 0],
  };
  // Exercise search alignment independently of the external model and network.
  cache.getEmbedding = async (text: string) => {
    const vector = vectors[text];
    assert.ok(vector, `Unexpected embedding input: ${text}`);
    return vector;
  };

  const files = [
    { path: "empty-first.ts", content: "" },
    { path: "alpha.ts", content: "alpha" },
    { path: "missing.ts" },
    { path: "beta.ts", content: "beta" },
    ...Array.from({ length: 6 }, (_, index) => ({ path: `empty-${index}.ts`, content: "" })),
    { path: "empty-second-batch.ts", content: "" },
    { path: "gamma.ts", content: "gamma" },
  ];
  const results = await cache.search("query", 10, files);
  assert.deepEqual(results.map(result => result.path), ["alpha.ts", "beta.ts", "gamma.ts"]);
  assert.deepEqual(results.map(result => result.score), [1, 0, -1]);
});
