/**
 * P6.3 — Strategic Brief type definitions.
 *
 * StrategicBrief is the 5th and final layer of the P6 Decision Influence
 * framework. It answers "What patterns matter over time?" by synthesizing
 * temporal intelligence from existing persisted stores.
 *
 * Pure data types with no storage dependencies.
 * No proposal-ID references in output types.
 *
 * @module
 */

import type { DecisionArtifact, SourceArtifact } from "./decision-types.js";
import type { IntelligenceReport } from "./intelligence-types.js";
import type { ProposalEffectivenessReport } from "./effectiveness-types.js";
import type { EvidenceRecord } from "../security/evidence/evidence-types.js";

// ---------------------------------------------------------------------------
// TimeWindow
// ---------------------------------------------------------------------------

export interface TimeWindow {
  /** ISO 8601 — start of the rolling window (inclusive). */
  start: string;
  /** ISO 8601 — end of the rolling window (inclusive). */
  end: string;
}

// ---------------------------------------------------------------------------
// StrategicFinding
// ---------------------------------------------------------------------------

export type FindingCategory = "trend" | "hotspot" | "system_warning" | "strategic_observation";

export interface StrategicFinding {
  category: FindingCategory;
  /** One-sentence finding. */
  summary: string;
  /** Supporting detail. */
  detail: string;
  /** Confidence in this finding (0-1). */
  confidence: number;
  /** Evidence refs supporting this finding. */
  evidenceRefs: string[];
}

// ---------------------------------------------------------------------------
// Trend
// ---------------------------------------------------------------------------

export interface Trend {
  /** What is trending — e.g. "outcome keep rate". */
  metric: string;
  /** Direction of change. */
  direction: "increasing" | "decreasing" | "stable";
  /** Magnitude of change (0-1 scale). */
  magnitude: number;
  /** Sample size supporting this trend. */
  sampleSize: number;
}

// ---------------------------------------------------------------------------
// Hotspot
// ---------------------------------------------------------------------------

export interface Hotspot {
  /** Area of concern — e.g. "capability changes". */
  area: string;
  /** Risk level. */
  severity: "low" | "medium" | "high";
  /** Action types or capability areas involved. */
  relatedActionTypes: string[];
  /** Supporting evidence. */
  evidence: string;
}

// ---------------------------------------------------------------------------
// StrategicBriefInput — what the CLI assembles
// ---------------------------------------------------------------------------

export interface StrategicBriefInput {
  intelligenceReports: IntelligenceReport[];
  effectivenessReports: ProposalEffectivenessReport[];
  evidenceRecords: EvidenceRecord[];
}

// ---------------------------------------------------------------------------
// StrategicBriefOptions
// ---------------------------------------------------------------------------

export interface StrategicBriefOptions {
  /** Rolling window size in days: 30, 90, or 180. Default: 30. */
  window?: 30 | 90 | 180;
  /** Override generatedAt for deterministic testing. */
  generatedAt?: string;
}

// ---------------------------------------------------------------------------
// StrategicBrief — the output artifact
// ---------------------------------------------------------------------------

export interface StrategicBrief extends DecisionArtifact {
  /** The time window this brief covers. */
  period: TimeWindow;
  /** Strategic findings — no per-proposal references. */
  findings: StrategicFinding[];
  /** Detected trends across the window. */
  trends: Trend[];
  /** Emerging areas of concern. */
  hotspots: Hotspot[];
  /**
   * Strategic action areas — NOT per-proposal recommendations.
   * Examples:
   *   - "Review governance requirements for agent-card modifications"
   *   - "Investigate rising defer rates on skill-definition changes"
   */
  strategicActions: string[];
  /**
   * Confidence in the brief's data sufficiency — NOT confidence that any
   * action should be taken.
   *
   * Formula: min(1, sampleSize / 30).
   * sampleSize is the total count of intelligence reports, effectiveness
   * reports, and evidence records within the window.
   */
  confidence: number;
  /** Source artifacts consumed: intelligence, effectiveness, evidence. */
  sourceArtifacts: SourceArtifact[];
}
