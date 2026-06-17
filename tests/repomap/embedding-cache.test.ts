import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { EmbeddingCache } from "../../src/repomap/embedding-cache.js";

// Embedding tests download a model from HuggingFace at runtime.
// CI runners may not have network access (HTTP 429), so skip when offline.
function canReachHuggingFace(): boolean {
  try {
    execSync("curl -sI https://huggingface.co -o /dev/null -w '%{http_code}' --connect-timeout 3", { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

const hasNetwork = canReachHuggingFace();

describe("EmbeddingCache", { skip: !hasNetwork }, () => {
  const tmpDir = join("/tmp", `embedding-cache-test-${Date.now()}`);
  let cache: EmbeddingCache;

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
    cache = new EmbeddingCache(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("getEmbedding()", () => {
    it("returns an embedding vector for text", async () => {
      const embedding = await cache.getEmbedding("hello world");
      assert.ok(Array.isArray(embedding), "embedding should be an array");
      assert.ok(embedding.length > 0, "embedding should have dimensions");
      assert.ok(embedding.every(n => typeof n === "number"), "all elements should be numbers");
    });

    it("returns the same embedding for the same text (cached)", async () => {
      const first = await cache.getEmbedding("hello world");
      const second = await cache.getEmbedding("hello world");
      assert.deepStrictEqual(first, second);
    });

    it("returns different embeddings for different texts", async () => {
      const first = await cache.getEmbedding("hello world");
      const second = await cache.getEmbedding("goodbye world");
      assert.ok(
        first.some((n, i) => n !== second[i]),
        "embeddings for different texts should differ"
      );
    });
  });

  describe("search()", () => {
    it("returns top-K semantically similar results", async () => {
      const files = [
        { path: "auth/login.ts", content: "function login(user: string) { return user; }", kind: "source" },
        { path: "auth/logout.ts", content: "function logout() { return true; }", kind: "source" },
        { path: "utils/math.ts", content: "function add(a: number, b: number) { return a + b; }", kind: "source" },
      ];

      const results = await cache.search("authentication", 2, files);
      assert.ok(results.length <= 2, "should return at most topK results");
      // auth files should be more similar to "authentication" than math
      const paths = results.map(r => r.path);
      assert.ok(
        paths.some(p => p.includes("login") || p.includes("logout")),
        "auth files should appear in results for 'authentication' query"
      );
    });

    it("returns results with score between 0 and 1", async () => {
      const files = [
        { path: "test.ts", content: "export function test() { return true; }", kind: "source" },
      ];

      const results = await cache.search("testing", 1, files);
      assert.ok(results.length > 0, "should have at least one result");
      assert.ok(
        results.every(r => r.score >= 0 && r.score <= 1),
        "similarity scores should be between 0 and 1"
      );
    });

    it("respects topK limit", async () => {
      const files = [
        { path: "a.ts", content: "function a() {}", kind: "source" },
        { path: "b.ts", content: "function b() {}", kind: "source" },
        { path: "c.ts", content: "function c() {}", kind: "source" },
        { path: "d.ts", content: "function d() {}", kind: "source" },
      ];

      const results = await cache.search("function", 2, files);
      assert.strictEqual(results.length, 2, "should return exactly topK results");
    });
  });

  describe("buildEmbeddings()", () => {
    it("computes embeddings for multiple files", async () => {
      const files = [
        { path: "src/a.ts", content: "export function a() {}", kind: "source" },
        { path: "src/b.ts", content: "export function b() {}", kind: "source" },
      ];

      await cache.buildEmbeddings(files);
      // Verify embeddings were cached by fetching them again
      const embedding = await cache.getEmbedding(files[0].content);
      assert.ok(Array.isArray(embedding), "embedding should exist after build");
    });
  });

  describe("cosine similarity", () => {
    it("returns 1 for identical vectors", async () => {
      const files = [
        { path: "same.ts", content: "function same() {}", kind: "source" },
      ];

      const results = await cache.search("function same() {}", 1, files);
      assert.ok(results[0].score > 0.99, "identical text should have near-1 similarity");
    });
  });
});
