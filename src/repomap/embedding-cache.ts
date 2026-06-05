import { pipeline } from "@xenova/transformers";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

export type SearchResult = {
  path: string;
  score: number;
  kind?: string;
  symbolName?: string;
};

// EmbeddingModel - the return type of the transformers pipeline
type EmbeddingModel = Awaited<ReturnType<typeof pipeline>>;

/** EmbeddingCache — stores per-file embeddings in .alix/embeddings/ */
export class EmbeddingCache {
  private modelPromise: Promise<EmbeddingModel> | null = null;
  private embeddingDir: string;

  constructor(root: string) {
    this.embeddingDir = join(root, ".alix", "embeddings");
  }

  /** Lazily initialize the embedding model */
  private async initModel(): Promise<EmbeddingModel> {
    if (!this.modelPromise) {
      // Use the smallest, fastest embedding model (all-MiniLM-L6-v2)
      this.modelPromise = pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
        pooling: "mean",
        normalize: true,
      } as Parameters<typeof pipeline>[2]);
    }
    return this.modelPromise;
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
      return JSON.parse(content);
    } catch (err) {
      console.warn(`[EmbeddingCache] Failed to load cached embedding: ${err}`);
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const output = await (model as any)(text, { pooling: "mean", normalize: true });

    // Extract the embedding data from the Tensor object
    let flat: number[];
    if (output && typeof output === "object" && "data" in output) {
      // Tensor object with data property
      flat = Array.from(output.data as Float32Array);
    } else if (Array.isArray(output)) {
      flat = (output.flat() as unknown as number[]);
    } else {
      // Assume it's a plain array of numbers
      flat = [...(output as unknown as number[])];
    }

    await this.saveCached(cacheKey, flat);
    return flat;
  }

  /** Search for top-K semantically similar files to the query */
  async search(
    query: string,
    topK: number,
    files: { path: string; content?: string; kind?: string }[]
  ): Promise<SearchResult[]> {
    const queryEmbedding = await this.getEmbedding(query);

    const BATCH_SIZE = 10;
    const results: SearchResult[] = [];

    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);
      const embeddings = await Promise.all(
        batch
          .filter(f => f.content)
          .map(f => this.getEmbedding(f.content!.slice(0, 2000)))
      );

      for (let j = 0; j < batch.length; j++) {
        const file = batch[j];
        if (!file.content) continue;
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
  async buildEmbeddings(
    files: { path: string; content?: string; kind?: string }[]
  ): Promise<void> {
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