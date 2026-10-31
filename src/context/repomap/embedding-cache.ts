import { env, pipeline } from "@huggingface/transformers";
import type { FeatureExtractionPipeline } from "@huggingface/transformers";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

/**
 * Embedding configuration.
 *
 * `modelName` + `revision` + `dtype` + `pooling` together define the vector
 * representation. Any change to them changes every produced vector, so the
 * tuple is folded into the cache namespace (`vectorSpaceId`) below.
 */
export type EmbedderConfig = {
  /** HuggingFace model name (e.g. "Xenova/all-MiniLM-L6-v2") */
  modelName: string;
  /** Human-readable label for this embedder ("semantic", "code", etc.) */
  label: string;
  /** Pooling strategy */
  pooling?: "mean" | "cls";
  /** Whether to normalize output vectors */
  normalize?: boolean;
  /**
   * Immutable HuggingFace commit SHA for `modelName`. Pin this so a re-tagged
   * model repo cannot silently change the vectors behind an unchanged name.
   */
  revision?: string;
  /**
   * ONNX weight precision. `q8` loads `onnx/model_quantized.onnx`, `fp32`
   * loads `onnx/model.onnx`.
   *
   * Defaults to `q8` deliberately: it is the representation ALiX has always
   * produced (`@xenova/transformers` defaulted to the quantized weights via
   * `quantized: true`). `@huggingface/transformers` defaults to `fp32`, which
   * yields *different* vectors for the same model — see `VECTOR_SPACE_VERSION`.
   */
  dtype?: EmbedderDtype;
  /**
   * Directory holding pre-downloaded model artifacts, laid out as
   * `<modelPath>/<modelName>/…`. When set, inference never reaches the network.
   */
  modelPath?: string;
};

/** Supported ONNX weight precisions. */
export type EmbedderDtype = "fp32" | "q8";

/**
 * Bump when the *meaning* of a stored vector changes without a config change
 * (e.g. a pooling or normalization bug fix). Part of the cache namespace.
 */
export const VECTOR_SPACE_VERSION = 1;

/** Default config for semantic embeddings */
export const SEMANTIC_EMBEDDER: EmbedderConfig = {
  modelName: "Xenova/all-MiniLM-L6-v2",
  label: "semantic",
  // Pinned commit of Xenova/all-MiniLM-L6-v2 (apache-2.0).
  revision: "751bff37182d3f1213fa05d7196b954e230abad9",
  dtype: "q8",
};

/**
 * Config for code-specific embeddings.
 *
 * `microsoft/codebert-base` ships **no ONNX artifacts**, so it cannot run on
 * the ONNX runtime at all. It is left unpinned and unused-by-default; the
 * context compiler only instantiates it when a caller opts in explicitly.
 */
export const CODE_EMBEDDER: EmbedderConfig = {
  modelName: "microsoft/codebert-base",
  label: "code",
};

export type SearchResult = {
  path: string;
  score: number;
  kind?: string;
  symbolName?: string;
};

/** A file offered to the cache for embedding or search. */
export type SearchableFile = {
  path: string;
  content?: string;
  kind?: string;
};

/** A file that has content to embed — the only kind search can score. */
export type ContentfulFile = SearchableFile & { content: string };

/**
 * Narrow to files that carry content.
 *
 * Search must build vectors and scores from the *same* list. Filtering in one
 * place and iterating another is what mis-aligned the scores originally, so the
 * filter lives here and both consumers call it.
 */
export function hasContent(file: SearchableFile): file is ContentfulFile {
  return Boolean(file.content);
}

/** EmbeddingModel - the return type of the transformers feature-extraction pipeline */
type EmbeddingModel = FeatureExtractionPipeline;

/** Thrown when the embedding model cannot be loaded or run. */
export class EmbeddingUnavailableError extends Error {
  constructor(
    message: string,
    readonly options?: { cause?: unknown; hint?: string }
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "EmbeddingUnavailableError";
  }
}

/** Resolve the model cache directory without importing the library eagerly. */
function defaultModelPath(): string | undefined {
  const fromEnv = process.env.ALIX_EMBEDDING_MODEL_PATH?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : undefined;
}

/** Default ONNX weight precision. See `EmbedderConfig.dtype`. */
const DEFAULT_DTYPE: EmbedderDtype = "q8";

/**
 * Apply the settings needed to resolve a model from `modelPath`.
 *
 * Three `env` fields are process-global and the library reads them while
 * resolving files — including after `await`s — so callers must serialise loads
 * (`serializeLoad`) and restore the snapshot afterwards (`restoreEnv`).
 *
 * `useFSCache` must be off during an offline resolve: the library's filesystem
 * cache is consulted *before* the local/remote decision, so a model absent from
 * `modelPath` would otherwise be satisfied from the package-local cache inside
 * `node_modules` instead of failing closed.
 */
function configureModelPath(modelPath: string): void {
  if (env.localModelPath !== modelPath) env.localModelPath = modelPath;
  env.allowRemoteModels = false;
  env.useFSCache = false;
}

type RuntimeEnvSnapshot = {
  localModelPath: string;
  allowRemoteModels: boolean;
  useFSCache: boolean;
  useBrowserCache: boolean;
};

function snapshotEnv(): RuntimeEnvSnapshot {
  return {
    localModelPath: env.localModelPath,
    allowRemoteModels: env.allowRemoteModels,
    useFSCache: env.useFSCache,
    useBrowserCache: env.useBrowserCache,
  };
}

function restoreEnv(snapshot: RuntimeEnvSnapshot): void {
  env.localModelPath = snapshot.localModelPath;
  env.allowRemoteModels = snapshot.allowRemoteModels;
  env.useFSCache = snapshot.useFSCache;
  env.useBrowserCache = snapshot.useBrowserCache;
}

/**
 * Serialises model loads so the process-global `env` is never shared mid-resolve.
 *
 * Without this, two embedders with different roots overwrite each other's
 * `env.localModelPath` while the other is still resolving, and one can silently
 * load the other's model.
 */
let loadQueue: Promise<unknown> = Promise.resolve();

function serializeLoad<T>(fn: () => Promise<T>): Promise<T> {
  const run = loadQueue.then(fn, fn);
  // Keep the chain alive even when this load rejects.
  loadQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/**
 * Stable identifier for the vector space a config produces.
 *
 * Every component that can change the numbers is included, so two runtimes
 * that disagree on representation can never read each other's cache entries.
 *
 * `modelPath` is deliberately excluded: the same model, revision and precision
 * is the same vector space regardless of which directory it was provisioned
 * into. The trade-off is that two roots holding *different weights* under the
 * same `modelName`+`revision` would share a namespace — the revision pin is
 * what makes that safe, so do not serve unpinned weights this way.
 */
export function vectorSpaceId(config: EmbedderConfig): string {
  const identity = [
    config.modelName,
    config.revision ?? "unpinned",
    config.dtype ?? DEFAULT_DTYPE,
    config.pooling ?? "mean",
    config.normalize === false ? "raw" : "normalized",
    `v${VECTOR_SPACE_VERSION}`,
  ].join("|");
  return createHash("sha256").update(identity).digest("hex").slice(0, 12);
}

/** EmbeddingCache — stores per-file embeddings in .alix/embeddings/ */
export class EmbeddingCache {
  private modelPromise: Promise<EmbeddingModel> | null = null;
  private embeddingDir: string;
  private readonly vectorSpace: string;

  constructor(root: string, private config: EmbedderConfig = SEMANTIC_EMBEDDER) {
    this.vectorSpace = vectorSpaceId(config);
    // Vectors from different model/revision/precision live in separate
    // namespaces, so a config change can never be served a stale vector.
    this.embeddingDir = join(root, ".alix", "embeddings", config.label, this.vectorSpace);
  }

  /** Exposed for tests and diagnostics: the cache namespace for this embedder. */
  getVectorSpaceId(): string {
    return this.vectorSpace;
  }

  /** Lazily initialize the embedding model. */
  private async initModel(): Promise<EmbeddingModel> {
    if (!this.modelPromise) {
      // A failed load is retried only when a retry could plausibly succeed.
      // An offline load with a missing model is terminal: retrying would
      // re-attempt a doomed resolve on every call (and, for a model id that
      // does not exist upstream, an outbound 404 per call).
      this.modelPromise = this.loadModel().catch((err: unknown) => {
        if (isRetryableFailure(err)) this.modelPromise = null;
        throw err;
      });
    }
    return this.modelPromise;
  }

  private async loadModel(): Promise<EmbeddingModel> {
    const { modelName, revision, dtype, modelPath } = this.config;
    const localPath = modelPath ?? defaultModelPath();
    // With a provisioned model directory, inference stays fully offline.
    const offline = localPath !== undefined;
    const precision = dtype ?? DEFAULT_DTYPE;

    // Serialised: the runtime's resolution settings are process-global, and
    // this also restores them afterwards (see `configureModelPath`).
    return serializeLoad(async () => {
      const snapshot = snapshotEnv();
      if (localPath) {
        configureModelPath(localPath);
      }
      try {
        return await pipeline("feature-extraction", modelName, {
          // CPU-only: ALiX never selects a GPU execution provider.
          device: "cpu",
          dtype: precision,
          local_files_only: offline,
          ...(revision ? { revision } : {}),
        });
      } catch (err) {
        throw new EmbeddingUnavailableError(
          `Embedding model "${modelName}"${revision ? `@${revision.slice(0, 12)}` : ""} could not be loaded: ${describeError(err)}`,
          {
            cause: err,
            hint: offline
              ? `Offline mode is active (modelPath=${localPath}). Provision ${modelName}/config.json, tokenizer.json and onnx/${precision === "fp32" ? "model.onnx" : "model_quantized.onnx"} there, or unset ALIX_EMBEDDING_MODEL_PATH to allow a one-time download.`
              : `The model must be downloaded once (a few tens of MB) or pre-provisioned locally. Set ALIX_EMBEDDING_MODEL_PATH to a directory containing ${modelName} to run fully offline.`,
          }
        );
      } finally {
        if (localPath) restoreEnv(snapshot);
      }
    });
  }

  /** Compute hash for a given text to use as cache key */
  private hashText(text: string): string {
    return createHash("sha256").update(text).digest("hex").slice(0, 16);
  }

  /** Load cached embedding from disk */
  private async loadCached(key: string): Promise<number[] | null> {
    try {
      const cacheFile = join(this.embeddingDir, `${key}.json`);
      const content = await readFile(cacheFile, "utf8");
      const parsed: unknown = JSON.parse(content);
      // A corrupted or truncated entry is a miss, never a crash and never a
      // silently short vector that would poison cosine similarity.
      if (!Array.isArray(parsed) || parsed.length === 0) return null;
      if (!parsed.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
      return parsed as number[];
    } catch (err) {
      // Cache miss — normal during first run. Hidden behind ALIX_LOG_LEVEL=debug.
      if (process.env.ALIX_LOG_LEVEL === "debug") {
        console.debug(`[EmbeddingCache] Cache miss for hash, computing fresh`);
      }
      return null;
    }
  }

  /** Save embedding to disk cache */
  private async saveCached(key: string, embedding: number[]): Promise<void> {
    try {
      await mkdir(this.embeddingDir, { recursive: true });
      const cacheFile = join(this.embeddingDir, `${key}.json`);
      await writeFile(cacheFile, JSON.stringify(embedding), "utf8");
    } catch (err) {
      console.warn(`[EmbeddingCache] Failed to save embedding: ${err}`);
    }
  }

  /** Get or compute embedding for a single text */
  async getEmbedding(text: string): Promise<number[]> {
    const cacheKey = this.hashText(text);
    const cached = await this.loadCached(cacheKey);
    if (cached) return cached;

    const model = await this.initModel();
    const output = await model(text, {
      pooling: this.config.pooling ?? "mean",
      normalize: this.config.normalize !== false,
    });

    const flat = toVector(output, this.config);
    await this.saveCached(cacheKey, flat);
    return flat;
  }

  /** Search for top-K semantically similar files to the query */
  async search(
    query: string,
    topK: number,
    files: SearchableFile[]
  ): Promise<SearchResult[]> {
    const queryEmbedding = await this.getEmbedding(query);

    const BATCH_SIZE = 10;
    const results: SearchResult[] = [];

    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);
      const eligibleFiles = batch.filter(hasContent);
      const embeddings = await Promise.all(
        eligibleFiles.map(file => this.getEmbedding(file.content.slice(0, 2000)))
      );

      for (let j = 0; j < eligibleFiles.length; j++) {
        const file = eligibleFiles[j];
        const similarity = this.cosineSimilarity(queryEmbedding, embeddings[j]);
        results.push({
          path: file.path,
          score: similarity,
          kind: file.kind,
        });
      }
    }

    // Sort by score descending and return top K
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  /** Cosine similarity between two vectors */
  public cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }

  /** Build embeddings for all source files (called during warm()) */
  async buildEmbeddings(files: SearchableFile[]): Promise<void> {
    await Promise.all(
      files.map(async (file) => {
        if (file.content) {
          await this.getEmbedding(file.content.slice(0, 2000));
        }
      })
    );
  }


  /** Check if proposed content is within cosine similarity guardrail of original.
   * Feature C: Cosine guardrails — prevents wildly divergent edits.
   * Returns { passed, similarity, threshold } */
  async checkGuardrail(
    originalContent: string,
    proposedContent: string,
    threshold: number = 0.85
  ): Promise<{ passed: boolean; similarity: number; threshold: number }> {
    const original = await this.getEmbedding(originalContent.slice(0, 2000));
    const proposed = await this.getEmbedding(proposedContent.slice(0, 2000));
    const similarity = this.cosineSimilarity(original, proposed);
    return { passed: similarity >= threshold, similarity, threshold };
  }

}

/**
 * Reduce a pipeline output to a flat finite, non-empty vector.
 *
 * Every branch is validated. The Tensor `.data` branch is the one a real
 * pipeline takes, so validating only the fallback would let NaN/Infinity or an
 * empty vector reach `cosineSimilarity` and silently corrupt ranking (NaN
 * compares false against everything, so it survives `sort` and yields an
 * arbitrary order).
 */
function toVector(output: unknown, config: EmbedderConfig): number[] {
  let flat: number[];
  // Tensor objects expose a flat `.data` buffer.
  if (output && typeof output === "object" && "data" in output) {
    const data = (output as { data: ArrayLike<number> }).data;
    flat = Array.from(data as Float32Array);
  } else if (Array.isArray(output)) {
    flat = (output as unknown[]).flat(Infinity) as number[];
  } else {
    flat = [...(output as unknown as number[])];
  }

  if (!Array.isArray(flat) || flat.length === 0) {
    throw new EmbeddingUnavailableError(
      `Embedding model "${config.modelName}" returned an empty vector.`
    );
  }
  if (!flat.every((v) => typeof v === "number" && Number.isFinite(v))) {
    throw new EmbeddingUnavailableError(
      `Embedding model "${config.modelName}" returned non-finite values.`
    );
  }
  return flat;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Whether a failed model load is worth retrying.
 *
 * A load that failed because the model is not present locally (offline mode)
 * or does not exist upstream is terminal — retrying only repeats the same
 * failed resolve, and for an unresolvable model id repeats an outbound request.
 * Transient failures (I/O, network blips while downloading) stay retryable, so
 * a cleared memo still recovers from those.
 */
function isRetryableFailure(err: unknown): boolean {
  if (err instanceof EmbeddingUnavailableError) {
    const cause = err.options?.cause;
    const message = describeError(cause ?? err);
    // Model genuinely absent / unresolvable: retrying cannot help.
    if (/not found locally|ModelFileNotFoundError|Entry not found|Could not locate file|\b40[34]\b/i.test(message)) {
      return false;
    }
  }
  return true;
}
