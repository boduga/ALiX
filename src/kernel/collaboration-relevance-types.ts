/**
 * collaboration-relevance-types.ts — Types for relevance scoring, budget allocation,
 * compression, and explainability.
 */

// CompressionMode is defined here rather than imported from a non-existent
// collaboration-compression module. It will be migrated when that module lands.
export type CompressionMode = "none" | "truncate" | "summarize" | "semantic";

export type CompressionMetadata = {
  mode: CompressionMode;
  originalTokens: number;
  includedTokens: number;
};

export type RelevanceScore = {
  total: number;
  components: {
    dependency: number;
    tagOverlap: number;
    capabilityMatch: number;
    confidence: number;
    recency: number;
    evidenceQuality: number;
    explicitSubscription: number;
  };
  reasons: string[];
};

export type ContextBudget = {
  totalTokens: number;
  dependencyResults: { maxTokens: number; minReservedTokens: number; maxItems: number; };
  findings: { maxTokens: number; maxItems: number; minimumScore: number; };
  artifacts: { maxTokens: number; maxItems: number; };
  systemReserveTokens: number;
  taskReserveTokens: number;
};

export const DEFAULT_CONTEXT_BUDGET: ContextBudget = {
  totalTokens: 8_000,
  dependencyResults: { maxTokens: 3_000, minReservedTokens: 1_000, maxItems: 8 },
  findings: { maxTokens: 3_000, maxItems: 20, minimumScore: 20 },
  artifacts: { maxTokens: 1_000, maxItems: 20 },
  systemReserveTokens: 500,
  taskReserveTokens: 500,
};

export type OmittedByReason = {
  budget: number;
  lowRelevance: number;
  invalidated: number;
  superseded: number;
  staleAttempt: number;
  staleDependency: number;
  staleArtifact: number;
  unauthorized: number;
  duplicate: number;
  semanticRerankLimit: number;
};

export type SelectedItem = {
  id: string;
  estimatedTokens: number;
  includedTokens: number;
  score: number;
  scoreComponents: Record<string, number>;
  selectionReasons: string[];
  compression?: CompressionMetadata;
};

export type BudgetAllocationResult = {
  selectedResults: SelectedItem[];
  selectedFindings: SelectedItem[];
  selectedArtifacts: SelectedItem[];
  tokenEstimate: number;
  bucketUsage: { dependencyResults: number; findings: number; artifacts: number; reserves: number; total: number; };
  omittedByReason: OmittedByReason;
};
