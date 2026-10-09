/**
 * P6.6a — Pipeline Health Report type definitions.
 *
 * PipelineHealthReport is a read-only summary of the P6 decision-support
 * pipeline's health and activity. Produced by PipelineHealthBuilder from
 * PipelineHealthInput (assembled by PipelineHealthCollector).
 *
 * Pure data types with no storage dependencies.
 *
 * @module
 */

import type { DecisionArtifact } from "./decision-types.js";

// ---------------------------------------------------------------------------
// Health status
// ---------------------------------------------------------------------------

export type PipelineHealthStatus = "healthy" | "degraded" | "attention_needed";

// ---------------------------------------------------------------------------
// Per-scoped-proposal data for confidence averaging
// ---------------------------------------------------------------------------

export interface ScopedProposalData {
  contextConfidence: number;
  riskConfidence?: number;
  recommendationConfidence?: number;
  ageDays: number;
  lineageCompleteness: "partial" | "complete" | "broken";
  dataFreshness: { newestDays: number; oldestDays: number };
}

// ---------------------------------------------------------------------------
// PipelineHealthInput — assembled by collector, consumed by builder
// ---------------------------------------------------------------------------

export interface PipelineHealthInput {
  proposalCounts: {
    total: number;
    pending: number;
    approved: number;
    applied: number;
    rejected: number;
    failed: number;
  };

  /** Per-proposal data for scoped proposals (pending + within window). */
  scopedProposalInputs: ScopedProposalData[];

  effectivenessReports: number;
  intelligenceReports: number;

  lifecycleEvents: {
    total: number;
    inWindow: number;
  };

  strategicBrief: {
    available: boolean;
    confidence: number | null;
    findings: number;
  };

  storeAvailability: {
    proposalStore: boolean;
    evidenceStore: boolean;
    effectivenessStore: boolean;
    intelligenceStore: boolean;
  };

  /** Per-store error messages (undefined = no error). */
  storeErrors?: {
    proposalStore?: string;
    evidenceStore?: string;
    effectivenessStore?: string;
    intelligenceStore?: string;
  };
}

// ---------------------------------------------------------------------------
// PipelineHealthReport — output artifact
// ---------------------------------------------------------------------------

export interface PipelineHealthReport extends DecisionArtifact {
  windowDays: 30 | 90 | 180;
  health: PipelineHealthStatus;

  /** Structured health signals with severity. */
  healthSignals: Array<{
    severity: "info" | "warning" | "critical";
    message: string;
  }>;

  /** Per-store availability for JSON consumers. */
  storeAvailability: {
    proposalStore: boolean;
    evidenceStore: boolean;
    effectivenessStore: boolean;
    intelligenceStore: boolean;
  };

  /** Proposal lifecycle counts — all proposals. */
  proposalCounts: {
    total: number;
    pending: number;
    approved: number;
    applied: number;
    rejected: number;
    failed: number;
  };

  /** Scoped to pending proposals + those within the window. */
  scopedProposals: {
    total: number;
    staleProposals: number;
    brokenLineage: number;
    confidence: {
      contextAvg: number;
      riskAvg?: number;
      recommendationAvg?: number;
      sampleSize: number;
    };
    dataFreshness: {
      newestDays: number | null;
      oldestDays: number | null;
    };
  };

  effectivenessReports: number;
  intelligenceReports: number;

  lifecycleEvents: {
    total: number;
    inWindow: number;
  };

  strategicBrief: {
    available: boolean;
    confidence: number | null;
    findings: number;
  };

  governanceReview: {
    frameworkAvailable: true;
    liveLensExecutionAvailable: false;
    persistedReviews: false;
  };

  /** Per-store error messages (undefined = no error). */
  storeErrors?: {
    proposalStore?: string;
    evidenceStore?: string;
    effectivenessStore?: string;
    intelligenceStore?: string;
  };

  // confidence, reasons, warnings inherited from DecisionArtifact
}
