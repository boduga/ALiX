import { describe, it, before } from "node:test";
import assert from "node:assert";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { EmbeddingCache, SEMANTIC_EMBEDDER } from "../../src/context/repomap/embedding-cache.js";

/**
 * Real CPU ONNX inference against a **pre-provisioned local model**.
 *
 * This suite is opt-in and never downloads anything:
 *
 *   ALIX_EMBEDDING_MODEL_PATH=/path/to/models pnpm test:vitest   (or node --test)
 *
 * Layout expected at that path:
 *
 *   <modelPath>/Xenova/all-MiniLM-L6-v2/{config.json,tokenizer.json,
 *     tokenizer_config.json,special_tokens_map.json,vocab.txt,
 *     onnx/model_quantized.onnx}
 *
 * When the variable is unset the suite skips, so the default test lane stays
 * hermetic. Provisioning is documented in
 * docs/security/2026-10-31-embedding-migration-qualification.md.
 */

const MODEL_ROOT = process.env.ALIX_EMBEDDING_MODEL_PATH?.trim();
const REQUIRED = join(
  MODEL_ROOT ?? "/nonexistent",
  "Xenova",
  "all-MiniLM-L6-v2",
  "onnx",
  "model_quantized.onnx"
);
const provisioned = Boolean(MODEL_ROOT) && existsSync(REQUIRED);

const INPUTS = [
  "hello world",
  "authentication and authorization",
  "function login(user)",
  "database connection pooling",
  "export function add(a, b) { return a + b; }",
];

describe(
  "EmbeddingCache real CPU inference (local model, no network)",
  { skip: provisioned ? false : "ALIX_EMBEDDING_MODEL_PATH not provisioned" },
  () => {
    let root: string;
    let cache: EmbeddingCache;

    before(() => {
      root = mkdtempSync("/tmp/alix-embedding-cpu-");
      cache = new EmbeddingCache(root, { ...SEMANTIC_EMBEDDER, modelPath: MODEL_ROOT });
    });

    it("produces 384-dimensional, L2-normalised, finite vectors", async () => {
      for (const text of INPUTS) {
        const v = await cache.getEmbedding(text);
        assert.strictEqual(v.length, 384, `unexpected dimension for "${text}"`);
        assert.ok(v.every((n) => Number.isFinite(n)), `non-finite value for "${text}"`);
        const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
        assert.ok(Math.abs(norm - 1) < 1e-3, `expected unit norm for "${text}", got ${norm}`);
      }
    });

    it("is deterministic across repeated inference and processes", async () => {
      const first = await cache.getEmbedding(INPUTS[0]);
      const second = await cache.getEmbedding(INPUTS[0]);
      assert.deepStrictEqual(first, second);

      // A fresh instance re-reads the on-disk cache; values must be identical.
      const fresh = new EmbeddingCache(root, { ...SEMANTIC_EMBEDDER, modelPath: MODEL_ROOT });
      assert.deepStrictEqual(await fresh.getEmbedding(INPUTS[0]), first);
    });

    it("ranks related files above unrelated ones", async () => {
      const files = [
        { path: "auth/login.ts", content: "export function login(user) { return authenticate(user); }" },
        { path: "db/pool.ts", content: "const pool = new Pool({ max: 20 }); await pool.connect();" },
        { path: "util/math.ts", content: "export function add(a, b) { return a + b; }" },
      ];
      const results = await cache.search("authentication and authorization", 3, files);
      assert.strictEqual(results.length, 3);
      assert.strictEqual(results[0].path, "auth/login.ts");
      assert.ok(results[0].score > results[results.length - 1].score);
    });

    it("fails closed with an actionable error when the model is absent", async () => {
      const empty = mkdtempSync("/tmp/alix-embedding-empty-");
      try {
        const broken = new EmbeddingCache(empty, { ...SEMANTIC_EMBEDDER, modelPath: empty });
        await assert.rejects(() => broken.getEmbedding("no model here"), /could not be loaded/);
      } finally {
        rmSync(empty, { recursive: true, force: true });
      }
    });
  }
);
