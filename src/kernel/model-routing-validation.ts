/**
 * model-routing-validation.ts — Types and scoring for M0.9-F model routing validation.
 *
 * Defines the shared types that validation cases, runners, and tests import.
 * The actual validation logic lives in scripts/ -- this module is pure types +
 * the scoring summary function.
 */

// ─── Types ──────────────────────────────────────────────────────────────

export interface ModelRoutingCase {
  id: string;
  prompt: string;
  expectedDomain: string;
  expectedIntent: string;
  expectedRisk: string;
}

export interface ModelRoutingResult {
  caseId: string;
  model: string;
  validJson: boolean;
  domainCorrect: boolean;
  intentCorrect: boolean;
  riskCorrect: boolean;
  rawOutput: string;
}

export interface ModelRoutingSummary {
  total: number;
  validJsonCount: number;
  domainCorrectCount: number;
  intentCorrectCount: number;
  riskCorrectCount: number;
  validJsonRate: number;
  domainAccuracy: number;
  intentAccuracy: number;
  riskAccuracy: number;
  passedFastTierThreshold: boolean;
}

// ─── Scoring ────────────────────────────────────────────────────────────

/**
 * Summarise an array of ModelRoutingResult into aggregate accuracy metrics.
 * Handles empty arrays without division by zero.
 */
export function summarizeRoutingResults(results: ModelRoutingResult[]): ModelRoutingSummary {
  const total = results.length;

  if (total === 0) {
    return {
      total: 0,
      validJsonCount: 0,
      domainCorrectCount: 0,
      intentCorrectCount: 0,
      riskCorrectCount: 0,
      validJsonRate: 0,
      domainAccuracy: 0,
      intentAccuracy: 0,
      riskAccuracy: 0,
      passedFastTierThreshold: false,
    };
  }

  const validJsonCount = results.filter((r) => r.validJson).length;
  const domainCorrectCount = results.filter((r) => r.domainCorrect).length;
  const intentCorrectCount = results.filter((r) => r.intentCorrect).length;
  const riskCorrectCount = results.filter((r) => r.riskCorrect).length;

  const validJsonRate = validJsonCount / total;
  const domainAccuracy = domainCorrectCount / total;
  const intentAccuracy = intentCorrectCount / total;
  const riskAccuracy = riskCorrectCount / total;

  const passedFastTierThreshold =
    validJsonRate >= 0.95 && domainAccuracy >= 0.90 && intentAccuracy >= 0.85;

  return {
    total,
    validJsonCount,
    domainCorrectCount,
    intentCorrectCount,
    riskCorrectCount,
    validJsonRate,
    domainAccuracy,
    intentAccuracy,
    riskAccuracy,
    passedFastTierThreshold,
  };
}
