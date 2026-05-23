import { discoverVerification, runVerification, type VerificationCheck, type VerificationResult } from "./verifier.js";
import { FailureDatabase } from "./embedder/failure-db.js";
import { EmbeddingScorer } from "./embedder/scorer.js";
import { ExemplarMatcher } from "./embedder/exemplar.js";
import type { SimilarityResult } from "./embedder/types.js";

export interface EnhancedVerifierOptions {
  cwd: string;
  embedderDb: string;
  embedderDimensions?: number;
}

export interface VerificationWithScore {
  checks: VerificationCheck[];
  results: VerificationResult[];
  score: number;
  existingChecks: boolean;
}

export interface FixSuggestion {
  resolution: string;
  confidence: number;
  matchedPatterns: string[];
  source: string;
}

export class EnhancedVerifier {
  private db: FailureDatabase;
  private scorer: EmbeddingScorer;
  private matcher: ExemplarMatcher;

  constructor(private options: EnhancedVerifierOptions) {
    this.db = new FailureDatabase(options.embedderDb);
    this.scorer = new EmbeddingScorer({
      dimensions: options.embedderDimensions ?? 128,
      modelName: "alix-embedder-v1",
      provider: "local",
    });
    this.matcher = new ExemplarMatcher(this.db);
  }

  async init(): Promise<void> {
    await this.db.init();
  }

  async verifyAndScore(): Promise<VerificationWithScore> {
    const checks = await discoverVerification(this.options.cwd);

    if (checks.length === 0) {
      return {
        checks: [],
        results: [],
        score: 1.0, // No verification needed
        existingChecks: false,
      };
    }

    const results: VerificationResult[] = [];
    let allPassed = true;

    for (const check of checks) {
      const result = await runVerification(this.options.cwd, check);
      results.push(result);
      if (result.status !== "passed") {
        allPassed = false;
      }
    }

    // Calculate embedder-based confidence score
    const score = await this.calculateConfidenceScore(checks, results);

    return {
      checks,
      results,
      score,
      existingChecks: true,
    };
  }

  private async calculateConfidenceScore(
    checks: VerificationCheck[],
    results: VerificationResult[]
  ): Promise<number> {
    // Base score from verification results
    const passRate = results.length > 0
      ? results.filter(r => r.status === "passed").length / results.length
      : 0;
    const baseScore = passRate * 0.6;

    // Factor from check coverage
    const coverageScore = Math.min(checks.length / 3, 1) * 0.2;

    // Historical confidence (if we have past failures)
    const historyScore = 0.2; // Placeholder

    return Math.max(0, Math.min(1, baseScore + coverageScore + historyScore));
  }

  async suggestFixes(context: { errors: string[]; files: string[] }): Promise<FixSuggestion[]> {
    const similar = await this.matcher.findSimilar({
      task: "",
      errors: context.errors,
      files: context.files,
    });

    return similar.map(s => ({
      resolution: s.record.resolution,
      confidence: s.score,
      matchedPatterns: s.matchedPatterns,
      source: `Historical failure: ${s.record.task}`,
    }));
  }

  async recordFailure(failure: {
    task: string;
    errorSummary: string;
    fileChanges: string[];
    resolution: string;
  }): Promise<void> {
    const id = `fail-${Date.now()}`;
    const sessionId = `session-${Date.now()}`;

    const embedding = await this.scorer.createVerificationEmbedding(
      sessionId,
      "unknown",
      {
        taskType: "unknown",
        files: failure.fileChanges,
        errors: [failure.errorSummary],
        tools: [],
      }
    );

    await this.db.insertFailure({
      id,
      sessionId,
      task: failure.task,
      errorSummary: failure.errorSummary,
      fileChanges: failure.fileChanges,
      resolution: failure.resolution,
      resolvedAt: Date.now(),
      embeddingId: embedding.id,
    });
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}