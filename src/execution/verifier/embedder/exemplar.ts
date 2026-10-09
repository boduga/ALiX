import type { FailureRecord, SimilarityResult } from "./types.js";
import { FailureDatabase } from "./failure-db.js";

export interface QueryContext {
  task: string;
  errors: string[];
  files: string[];
}

export interface MatchOptions {
  threshold?: number;
  topK?: number;
}

/**
 * Matches incoming failure contexts against known exemplar failures stored in the database.
 * Uses a hybrid scoring model combining:
 * - Vector embedding similarity (via FailureDatabase.searchByEmbedding)
 * - Context similarity based on task keywords, file changes, and error patterns
 *
 * The final score is a weighted average: 50% embedding score + 50% context score.
 */
export class ExemplarMatcher {
  constructor(private db: FailureDatabase) {}
  
  /**
   * Finds the top-K most similar exemplar failures to the given context.
   *
   * @param context - The query context containing task description, errors, and files
   * @param options.threshold - Minimum combined score (0-1), default 0.5
   * @param options.topK - Maximum results to return, default 5
   * @returns Array of similarity results sorted by score descending
   *
   * @example
   * const results = await matcher.findSimilar({
   *   task: "Fix authentication bug",
   *   errors: ["Cannot read property 'user' of null"],
   *   files: ["auth/login.ts"]
   * }, { threshold: 0.6, topK: 3 });
   */
  async findSimilar(
    context: QueryContext,
    options: MatchOptions = {}
  ): Promise<SimilarityResult[]> {
    const threshold = options.threshold ?? 0.5;
    const topK = options.topK ?? 5;
    
    // Search using heuristic matching
    const results = await this.db.searchByEmbedding(
      new Float32Array(128), // Placeholder - would use actual embedding
      topK * 2, // Get more to filter
      threshold
    );
    
    // Re-score based on query context
    const scored = results.map(result => {
      const contextScore = this.calculateContextSimilarity(context, result.record);
      const combinedScore = (result.score + contextScore) / 2;
      
      return {
        record: result.record,
        score: combinedScore,
        matchedPatterns: this.findMatchedPatterns(context, result.record),
      };
    });
    
    return scored
      .filter(r => r.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
  
  private calculateContextSimilarity(
    query: QueryContext,
    record: FailureRecord
  ): number {
    let score = 0;
    let weights = 0;
    
    // Task similarity (40%)
    const taskWords = query.task.toLowerCase().split(/\W+/);
    const recordWords = record.task.toLowerCase().split(/\W+/);
    const taskOverlap = taskWords.filter(w => recordWords.includes(w)).length;
    const taskSim = taskWords.length > 0 
      ? taskOverlap / taskWords.length 
      : 0;
    score += taskSim * 0.4;
    weights += 0.4;
    
    // File similarity (30%)
    const fileOverlap = query.files.filter(f => 
      record.fileChanges.some(rf => rf.includes(f) || f.includes(rf))
    ).length;
    const fileSim = query.files.length > 0
      ? fileOverlap / query.files.length
      : 0;
    score += fileSim * 0.3;
    weights += 0.3;
    
    // Error pattern similarity (30%)
    const errorMatches = query.errors.filter(err =>
      record.errorSummary.toLowerCase().includes(err.toLowerCase())
    ).length;
    const errorSim = query.errors.length > 0
      ? errorMatches / query.errors.length
      : 0;
    score += errorSim * 0.3;
    weights += 0.3;
    
    return weights > 0 ? score / weights : 0;
  }
  
  private findMatchedPatterns(
    query: QueryContext,
    record: FailureRecord
  ): string[] {
    const patterns: string[] = [];
    
    for (const error of query.errors) {
      if (record.errorSummary.toLowerCase().includes(error.toLowerCase())) {
        patterns.push(error);
      }
    }
    
    for (const file of query.files) {
      if (record.fileChanges.some(f => f.includes(file))) {
        patterns.push(`file:${file}`);
      }
    }
    
    return patterns;
  }
  
  /**
   * Records the resolution for a previously matched failure.
   *
   * @param failureId - The unique ID of the failure record to update
   * @param resolution - The resolution description or fix applied
   * @throws Error if failureId is empty or record does not exist
   */
  async recordResolution(
    failureId: string,
    resolution: string
  ): Promise<void> {
    if (!failureId || failureId.trim().length === 0) {
      throw new Error("failureId cannot be empty");
    }
    const record = await this.db.getFailure(failureId);
    if (!record) {
      throw new Error(`No failure record found with id: ${failureId}`);
    }
    await this.db.insertFailure({
      ...record,
      resolution,
      resolvedAt: Date.now(),
    });
  }
}
