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

// Scoring weights for confidence calculation
const PASS_RATE_WEIGHT = 0.6;
const COVERAGE_WEIGHT = 0.2;
const HISTORY_WEIGHT = 0.2;
const MIN_CHECKS_FOR_FULL_COVERAGE = 3;

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

  private async calculateConfidenceScore(
    checks: VerificationCheck[],
    results: VerificationResult[]
  ): Promise<number> {
    // Base score from verification results
    const passRate = results.length > 0
      ? results.filter(r => r.status === "passed").length / results.length
      : 0;
    const baseScore = passRate * PASS_RATE_WEIGHT;

    // Factor from check coverage
    const coverageScore = Math.min(checks.length / MIN_CHECKS_FOR_FULL_COVERAGE, 1) * COVERAGE_WEIGHT;

    // Historical confidence (if we have past failures)
    const historyScore = await this.getHistoryScore();

    return Math.max(0, Math.min(1, baseScore + coverageScore + historyScore));
  }

  /**
   * Retrieves the historical confidence score based on past failure records.
   * Returns 0.2 if historical records exist, 0.1 otherwise (no history penalty).
   */
  private async getHistoryScore(): Promise<number> {
    const count = await this.db.countFailures();
    return count > 0 ? HISTORY_WEIGHT : 0.1;
  }

  /**
   * Initializes the verifier's database connection.
   * @throws Error if database initialization fails
   */
  async init(): Promise<void> {
    try {
      await this.db.init();
    } catch (error) {
      throw new Error(`Failed to initialize database: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Runs verification checks and calculates a confidence score based on
   * pass rate, coverage, and historical data.
   * @returns VerificationWithScore containing checks, results, and overall score
   */
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

  /**
   * Suggests fixes based on similar historical failures.
   * @param context - Object containing errors and files related to the failure
   * @returns Array of fix suggestions with confidence scores and matched patterns
   */
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

  /**
   * Records a verification failure for future similarity matching.
   * @param failure - The failure details including task, error, file changes, and resolution
   */
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

  /**
   * Closes the verifier's database connection and releases resources.
   */
  async close(): Promise<void> {
    await this.db.close();
  }
}