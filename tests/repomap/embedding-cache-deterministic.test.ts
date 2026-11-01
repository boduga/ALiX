import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { mkdirSync, rmSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  EmbeddingCache,
  EmbeddingUnavailableError,
  SEMANTIC_EMBEDDER,
  vectorSpaceId,
} from "../../src/context/repomap/embedding-cache.js";

/**
 * Deterministic embedding-cache tests.
 *
 * No network, no ONNX runtime, no model download: `getEmbedding` is stubbed
 * with a deterministic text→vector function. These cover cache keys, vector
 * space isolation, corruption handling, batch alignment and ranking — the
 * behaviour that silently degrades context quality when it regresses.
 */

const DIM = 4;

/** Deterministic bag-of-characters embedding; stable across runs. */
function fakeEmbed(text: string): number[] {
  const v = [0, 0, 0, 0];
  for (const ch of text) v[ch.charCodeAt(0) % DIM] += 1;
  const norm = Math.hypot(...v);
  return norm === 0 ? v : v.map((x) => x / norm);
}

function makeTmp(): string {
  return join("/tmp", `alix-embedding-deterministic-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`);
}

describe("EmbeddingCache (deterministic, no network)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmp();
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("cache namespace", () => {
    it("isolates vectors by model identity", () => {
      const base = { modelName: "Xenova/all-MiniLM-L6-v2", label: "semantic" };
      const a = vectorSpaceId({ ...base, revision: "rev1" });
      const b = vectorSpaceId({ ...base, revision: "rev2" });
      assert.notStrictEqual(a, b, "different revisions must not share a cache namespace");
    });

    it("isolates vectors by precision", () => {
      const base = { modelName: "m", label: "semantic" };
      assert.notStrictEqual(
        vectorSpaceId({ ...base, dtype: "q8" }),
        vectorSpaceId({ ...base, dtype: "fp32" }),
        "q8 and fp32 produce different vectors and must not share a namespace"
      );
    });

    it("isolates vectors by pooling and normalization", () => {
      const base = { modelName: "m", label: "semantic" };
      assert.notStrictEqual(
        vectorSpaceId({ ...base, pooling: "mean" }),
        vectorSpaceId({ ...base, pooling: "cls" })
      );
      assert.notStrictEqual(
        vectorSpaceId({ ...base, normalize: true }),
        vectorSpaceId({ ...base, normalize: false })
      );
    });

    it("is stable for the same config", () => {
      assert.strictEqual(vectorSpaceId(SEMANTIC_EMBEDDER), vectorSpaceId({ ...SEMANTIC_EMBEDDER }));
    });

    it("stores different vector spaces in separate directories", async () => {
      const a = new EmbeddingCache(tmpDir, { modelName: "m", label: "semantic", dtype: "q8" });
      const b = new EmbeddingCache(tmpDir, { modelName: "m", label: "semantic", dtype: "fp32" });
      assert.notStrictEqual(a.getVectorSpaceId(), b.getVectorSpaceId());

      // Seed one entry per namespace through the same code path the cache uses.
      const { createHash } = await import("node:crypto");
      const key = createHash("sha256").update("same text").digest("hex").slice(0, 16);
      for (const [cache, vec] of [
        [a, [1, 0]],
        [b, [0, 1]],
      ] as const) {
        const dir = join(tmpDir, ".alix", "embeddings", "semantic", cache.getVectorSpaceId());
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, `${key}.json`), JSON.stringify(vec));
      }

      // Each namespace resolves only its own vector for the identical text.
      assert.deepStrictEqual(await a.getEmbedding("same text"), [1, 0]);
      assert.deepStrictEqual(await b.getEmbedding("same text"), [0, 1]);

      const root = join(tmpDir, ".alix", "embeddings", "semantic");
      const dirs = readdirSync(root).sort();
      assert.deepStrictEqual(dirs, [a.getVectorSpaceId(), b.getVectorSpaceId()].sort());
    });
  });

  describe("cache hits and misses", () => {
    it("reads a pre-seeded entry without touching the model", async () => {
      const cache = new EmbeddingCache(tmpDir, SEMANTIC_EMBEDDER);
      const { createHash } = await import("node:crypto");
      const key = createHash("sha256").update("seeded").digest("hex").slice(0, 16);
      const dir = join(tmpDir, ".alix", "embeddings", "semantic", cache.getVectorSpaceId());
      mkdirSync(dir, { recursive: true });
      const vec = [0.5, 0.5, 0.5, 0.5];
      writeFileSync(join(dir, `${key}.json`), JSON.stringify(vec));

      // A model load would throw here (no model path); never reached on a hit.
      const got = await cache.getEmbedding("seeded");
      assert.deepStrictEqual(got, vec);
    });

    it("keys distinct texts to distinct cache files", async () => {
      const cache = new EmbeddingCache(tmpDir, SEMANTIC_EMBEDDER);
      const { createHash } = await import("node:crypto");
      const keyOf = (t: string) => createHash("sha256").update(t).digest("hex").slice(0, 16);
      assert.notStrictEqual(keyOf("hello world"), keyOf("goodbye world"));

      const dir = join(tmpDir, ".alix", "embeddings", "semantic", cache.getVectorSpaceId());
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${keyOf("hello world")}.json`), JSON.stringify([1, 0]));
      writeFileSync(join(dir, `${keyOf("goodbye world")}.json`), JSON.stringify([0, 1]));

      assert.deepStrictEqual(await cache.getEmbedding("hello world"), [1, 0]);
      assert.deepStrictEqual(await cache.getEmbedding("goodbye world"), [0, 1]);
    });

    it("treats a corrupted cache entry as a miss rather than crashing", async () => {
      const cache = new EmbeddingCache(tmpDir, SEMANTIC_EMBEDDER);
      const { createHash } = await import("node:crypto");
      const key = createHash("sha256").update("corrupt").digest("hex").slice(0, 16);
      const dir = join(tmpDir, ".alix", "embeddings", "semantic", cache.getVectorSpaceId());
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${key}.json`), "not json at all");

      // Assert on the real `loadCached` (private) rather than stubbing
      // `getEmbedding`, which would only prove the stub works. No model is
      // configured, so a genuine cache miss must fail with a load error —
      // that is exactly the signal that the corrupt entry was not returned.
      const loadCached = (cache as unknown as { loadCached(k: string): Promise<number[] | null> }).loadCached.bind(cache);
      assert.strictEqual(await loadCached(key), null, "corrupt JSON must read as a miss");
    });

    it("treats a non-finite, empty, or non-array cache entry as a miss", async () => {
      const cache = new EmbeddingCache(tmpDir, SEMANTIC_EMBEDDER);
      const { createHash } = await import("node:crypto");
      const key = createHash("sha256").update("bad-vector").digest("hex").slice(0, 16);
      const dir = join(tmpDir, ".alix", "embeddings", "semantic", cache.getVectorSpaceId());
      mkdirSync(dir, { recursive: true });
      const loadCached = (cache as unknown as { loadCached(k: string): Promise<number[] | null> }).loadCached.bind(cache);

      for (const payload of [
        JSON.stringify([]),
        JSON.stringify([1, null, 3]),
        JSON.stringify([1, "2", 3]),
        JSON.stringify({ not: "an array" }),
      ]) {
        writeFileSync(join(dir, `${key}.json`), payload);
        assert.strictEqual(await loadCached(key), null, `payload ${payload} must be a miss`);
      }

      // A well-formed entry still reads back, so the test is not vacuous.
      writeFileSync(join(dir, `${key}.json`), JSON.stringify([0.25, 0.75]));
      assert.deepStrictEqual(await loadCached(key), [0.25, 0.75]);
    });
  });

  describe("search()", () => {
    it("ranks by cosine similarity and respects topK", async () => {
      const cache = new EmbeddingCache(tmpDir, SEMANTIC_EMBEDDER);
      cache.getEmbedding = async (text: string) => fakeEmbed(text);

      const files = [
        { path: "a.ts", content: "aaa" },
        { path: "b.ts", content: "bbbb" },
        { path: "c.ts", content: "cccc" },
      ];
      const results = await cache.search("aaa", 2, files);
      assert.strictEqual(results.length, 2);
      assert.strictEqual(results[0].path, "a.ts", "exact match must rank first");
      assert.ok(results[0].score >= results[1].score, "results must be sorted descending");
    });

    it("skips files without content without breaking alignment", async () => {
      const cache = new EmbeddingCache(tmpDir, SEMANTIC_EMBEDDER);
      const seen: string[] = [];
      cache.getEmbedding = async (text: string) => {
        seen.push(text);
        return fakeEmbed(text);
      };

      const files = [
        { path: "empty.ts", content: "" },
        { path: "alpha.ts", content: "alpha" },
        { path: "missing.ts" },
        { path: "beta.ts", content: "beta" },
      ];
      await cache.search("query", 10, files);
      assert.ok(!seen.includes(""), "contentless files must not be embedded");
      assert.deepStrictEqual(seen.slice(1).sort(), ["alpha", "beta"]);
    });

    it("keeps alignment across multiple batches", async () => {
      const cache = new EmbeddingCache(tmpDir, SEMANTIC_EMBEDDER);
      cache.getEmbedding = async (text: string) => fakeEmbed(text);

      // 25 entries spans three BATCH_SIZE=10 batches.
      const files = Array.from({ length: 25 }, (_, i) => ({
        path: `f${i}.ts`,
        content: i % 3 === 0 ? "" : `content-${i}`,
      }));
      const results = await cache.search("content-1", 25, files);
      assert.strictEqual(results.length, 16, "only content-bearing files are scored");
      for (const r of results) {
        const idx = Number(r.path.slice(1, -3));
        assert.notStrictEqual(idx % 3, 0, `${r.path} had no content and must not be scored`);
      }
      assert.ok(
        results.every((r) => Number.isFinite(r.score) && r.score >= -1.0001 && r.score <= 1.0001),
        "every score must be a finite cosine value"
      );
    });

    it("returns nothing when no file has content", async () => {
      const cache = new EmbeddingCache(tmpDir, SEMANTIC_EMBEDDER);
      cache.getEmbedding = async () => [1, 0];
      const results = await cache.search("query", 5, [
        { path: "a.ts", content: "" },
        { path: "b.ts" },
      ]);
      assert.deepStrictEqual(results, []);
    });

    it("truncates very large file content before embedding", async () => {
      const cache = new EmbeddingCache(tmpDir, SEMANTIC_EMBEDDER);
      let maxLen = 0;
      cache.getEmbedding = async (text: string) => {
        if (text !== "query") maxLen = Math.max(maxLen, text.length);
        return [1, 0];
      };
      await cache.search("query", 1, [{ path: "big.ts", content: "x".repeat(50_000) }]);
      assert.strictEqual(maxLen, 2000, "content is sliced to the embedding window");
    });
  });

  describe("cosineSimilarity()", () => {
    it("returns 1 for identical vectors and 0 for mismatched dimensions", () => {
      const cache = new EmbeddingCache(tmpDir, SEMANTIC_EMBEDDER);
      assert.strictEqual(cache.cosineSimilarity([1, 2, 3], [1, 2, 3]), 1);
      assert.strictEqual(cache.cosineSimilarity([1, 2], [1, 2, 3]), 0);
    });

    it("returns 0 for a zero vector instead of NaN", () => {
      const cache = new EmbeddingCache(tmpDir, SEMANTIC_EMBEDDER);
      assert.strictEqual(cache.cosineSimilarity([0, 0], [1, 1]), 0);
    });
  });

  describe("model failure handling", () => {
    // A model id that cannot exist locally. Using a bogus id (rather than a
    // real one behind a missing path) keeps the test independent of whatever
    // happens to be in the shared Transformers download cache.
    const UNRESOLVABLE = {
      modelName: "alix-nonexistent/model-for-failure-test",
      label: "semantic",
      dtype: "q8" as const,
    };

    it("surfaces an actionable error when the model cannot load", async () => {
      const missing = join(tmpDir, "no-models-here");
      mkdirSync(missing, { recursive: true });
      const cache = new EmbeddingCache(tmpDir, { ...UNRESOLVABLE, modelPath: missing });
      await assert.rejects(
        () => cache.getEmbedding("will not embed"),
        (err: unknown) => {
          assert.ok(err instanceof EmbeddingUnavailableError, `expected EmbeddingUnavailableError, got ${String(err)}`);
          assert.match(err.message, /could not be loaded/);
          assert.ok(err.options?.hint, "error must carry a remediation hint");
          return true;
        }
      );
    });

    it("does not retry a terminal model failure on every call", async () => {
      const missing = join(tmpDir, "terminal-missing");
      mkdirSync(missing, { recursive: true });
      const cache = new EmbeddingCache(tmpDir, { ...UNRESOLVABLE, modelPath: missing });

      let attempts = 0;
      const original = (cache as unknown as { loadModel(): Promise<unknown> }).loadModel.bind(cache);
      (cache as unknown as { loadModel(): Promise<unknown> }).loadModel = () => {
        attempts++;
        return original();
      };

      await assert.rejects(() => cache.getEmbedding("attempt one"));
      await assert.rejects(() => cache.getEmbedding("attempt two"));
      await assert.rejects(() => cache.getEmbedding("attempt three"));
      assert.strictEqual(attempts, 1, "an unresolvable model must be attempted once, not per call");
      assert.ok(!existsSync(join(tmpDir, ".alix", "embeddings")), "no cache dir is created on failure");
    });
  });

  describe("vector validation", () => {
    /** Replace the model loader so inference output can be controlled. */
    function withModel(cache: EmbeddingCache, output: unknown): void {
      (cache as unknown as { loadModel(): Promise<unknown> }).loadModel = async () => async () => output;
    }

    it("rejects a non-finite Tensor rather than poisoning similarity", async () => {
      const cache = new EmbeddingCache(tmpDir, SEMANTIC_EMBEDDER);
      withModel(cache, { data: new Float32Array([1, Number.NaN, 3]), dims: [3] });
      await assert.rejects(() => cache.getEmbedding("nan"), /non-finite/);
    });

    it("rejects an infinite Tensor", async () => {
      const cache = new EmbeddingCache(tmpDir, SEMANTIC_EMBEDDER);
      withModel(cache, { data: new Float32Array([1, Number.POSITIVE_INFINITY]), dims: [2] });
      await assert.rejects(() => cache.getEmbedding("inf"), /non-finite/);
    });

    it("rejects an empty Tensor instead of returning a zero-length vector", async () => {
      const cache = new EmbeddingCache(tmpDir, SEMANTIC_EMBEDDER);
      withModel(cache, { data: new Float32Array([]), dims: [0] });
      await assert.rejects(() => cache.getEmbedding("empty"), /empty vector/);
    });

    it("rejects a plain array containing NaN", async () => {
      const cache = new EmbeddingCache(tmpDir, SEMANTIC_EMBEDDER);
      withModel(cache, [[1, Number.NaN]]);
      await assert.rejects(() => cache.getEmbedding("nested-nan"), /non-finite/);
    });

    it("accepts and persists a well-formed Tensor", async () => {
      const cache = new EmbeddingCache(tmpDir, SEMANTIC_EMBEDDER);
      withModel(cache, { data: new Float32Array([0.5, 0.5]), dims: [2] });
      assert.deepStrictEqual(await cache.getEmbedding("good"), [0.5, 0.5]);
    });
  });

  describe("guardrail", () => {
    it("reports similarity against the configured threshold", async () => {
      const cache = new EmbeddingCache(tmpDir, SEMANTIC_EMBEDDER);
      cache.getEmbedding = async (text: string) => fakeEmbed(text);
      const same = await cache.checkGuardrail("abcd", "abcd", 0.85);
      assert.strictEqual(same.passed, true);
      assert.ok(same.similarity > 0.99);

      const different = await cache.checkGuardrail("aaaa", "bbbb", 0.85);
      assert.strictEqual(different.passed, false);
    });
  });
});
