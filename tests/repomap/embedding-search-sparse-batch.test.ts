import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EmbeddingCache, type SearchableFile } from "../../src/context/repomap/embedding-cache.js";

/**
 * Stub the embedder for the duration of `run`, then restore it.
 *
 * `getEmbedding` is the single seam between the cache and the model. Replacing
 * it is what keeps this test off the network; restoring it in `finally` stops
 * the stub leaking into any other test that shares this module instance.
 */
async function withStubEmbedder<T>(
  embed: (text: string) => Promise<number[]>,
  run: (cache: EmbeddingCache) => Promise<T>
): Promise<T> {
  // A unique directory per run: a fixed path is shared by every parallel
  // invocation and by any stale leftover from an earlier run.
  const dir = mkdtempSync(join(tmpdir(), "alix-sparse-batch-"));
  const cache = new EmbeddingCache(dir);
  const original = cache.getEmbedding.bind(cache);
  cache.getEmbedding = embed;
  try {
    return await run(cache);
  } finally {
    cache.getEmbedding = original;
    rmSync(dir, { recursive: true, force: true });
  }
}

const VECTORS: Record<string, number[]> = {
  query: [1, 0],
  alpha: [1, 0],
  beta: [0, 1],
  gamma: [-1, 0],
};

const embedFromTable = async (text: string): Promise<number[]> => {
  const vector = VECTORS[text];
  assert.ok(vector, `Unexpected embedding input: ${text}`);
  return vector;
};

test("search preserves file-to-vector alignment across sparse batches without model downloads", async () => {
  const files: SearchableFile[] = [
    { path: "empty-first.ts", content: "" },
    { path: "alpha.ts", content: "alpha" },
    { path: "missing.ts" },
    { path: "beta.ts", content: "beta" },
    ...Array.from({ length: 6 }, (_, index) => ({ path: `empty-${index}.ts`, content: "" })),
    { path: "empty-second-batch.ts", content: "" },
    { path: "gamma.ts", content: "gamma" },
  ];

  const results = await withStubEmbedder(embedFromTable, (cache) =>
    cache.search("query", 10, files)
  );

  assert.deepEqual(
    results.map((result) => result.path),
    ["alpha.ts", "beta.ts", "gamma.ts"]
  );
  assert.deepEqual(
    results.map((result) => result.score),
    [1, 0, -1]
  );
});

test("every scored file is scored against its own vector, not a neighbour's", async () => {
  // One batch, one contentless file in the middle: the compaction bug scored
  // `beta` using `alpha`'s slot. Asserting each score against its own vector
  // catches a mis-alignment that a length-only check would miss.
  const files: SearchableFile[] = [
    { path: "alpha.ts", content: "alpha" },
    { path: "missing.ts" },
    { path: "beta.ts", content: "beta" },
  ];

  let callIndex = 0;
  const embedInCallOrder = async (text: string): Promise<number[]> => {
    // The query is embedded first, outside the batch loop.
    if (text === "query") return VECTORS.query;
    callIndex += 1;
    return text === "alpha" ? VECTORS.alpha : VECTORS.beta;
  };

  const results = await withStubEmbedder(embedInCallOrder, (cache) =>
    cache.search("query", 10, files)
  );

  assert.equal(callIndex, 2, "both contentful files should be embedded exactly once");
  const byPath = Object.fromEntries(results.map((result) => [result.path, result.score]));
  assert.deepEqual(byPath, { "alpha.ts": 1, "beta.ts": 0 });
});

test("files without content are excluded rather than scored as zero", async () => {
  const files: SearchableFile[] = [
    { path: "missing.ts" },
    { path: "empty.ts", content: "" },
  ];

  const results = await withStubEmbedder(embedFromTable, (cache) =>
    cache.search("query", 10, files)
  );

  assert.deepEqual(results, []);
});
