import type { LearningSignal, CalibrationProfile } from "../learning/learning-types.js";
import type { OutcomeValue } from "../adaptation/outcome-types.js";
import type { GovernanceVerdict, LensName } from "../adaptation/governance-review-types.js";
import type { RiskDimension, RiskOutcome } from "../adaptation/risk-score-types.js";

export type JoinPath = "evidence_chain" | "direct_id" | "proposal_fallback" | "string_heuristic";

export interface ProposalExplanation {
  proposalId: string;
  generatedAt: string;
  windowDays: number;
  outcome: OutcomeLayer | UnavailableLayer;
  recommendation: RecommendationLayer | UnavailableLayer;
  risk: RiskLayer | UnavailableLayer;
  governance: GovernanceLayer | UnavailableLayer;
  learning: LearningLayer;
  calibration: CalibrationLayer;
  explanationIntegrity: ExplanationIntegrity;
  learningRefreshHint: string | null;
}

export interface UnavailableLayer {
  status: "not_available";
  reason: string;
}

export interface OutcomeLayer {
  status: "available";
  outcome: OutcomeValue;
  observedAt: string;
  /** Per-layer source list, NOT the Evidence Chain graph. Named sourceArtifactIds
   * (not evidenceRefs) to avoid semantic collision with the learning subsystem. */
  sourceArtifactIds: string[];
  joinPath: JoinPath;
}

export interface RecommendationLayer {
  status: "available";
  recommendationId: string;
  decision: string;
  confidence: number | undefined;    // undefined = P7.5p.1 missing
  reasons: string[];
  sourceArtifactIds: string[];
  joinPath: JoinPath;
}

export interface RiskLayer {
  status: "available";
  riskScoreId: string;
  overallRisk: number;
  outcome: RiskOutcome;
  dimensions: { dimension: RiskDimension; score: number; confidence: number; reasons: string[] }[];
  sourceArtifactIds: string[];
  joinPath: JoinPath;
}

export interface GovernanceLayer {
  status: "available";
  reviewId: string;
  verdict: GovernanceVerdict;
  concerns: string[];
  lensScores: { lens: LensName; verdict: GovernanceVerdict; confidence: number }[];
  sourceArtifactIds: string[];
  joinPath: JoinPath;
}

export interface LearningLayer {
  /** Registry-aligned: keys mirror the P8.5a.2 AdapterRegistry. For P8.5c the
   * keys are "recommendation", "risk", "governance". Future adapters drop in
   * as new keys without schema or renderer changes. */
  signalsByAdapter: Record<string, LearningSignal[]>;
  adaptersWithSignals: string[];
  totalSignals: number;
}

export interface CalibrationLayer {
  profilesByTarget: Record<string, CalibrationProfile[]>;
  adjustments: { target: string; previousValue: number; suggestedValue: number; reason: string }[];
}

export interface ExplanationIntegrity {
  outcomeFound: boolean;
  recommendationFound: boolean;
  riskFound: boolean;
  governanceFound: boolean;
  learningFound: boolean;
  calibrationFound: boolean;
  evidenceChainUsed: boolean;
  fallbackJoinsUsed: boolean;
  incompleteChainLayers: number;
  totalLayers: number;
  layersAvailable: number;
  /** Pre-computed: (layersAvailable / totalLayers) * 100, rounded to 1dp. */
  completenessPercent: number;
}
