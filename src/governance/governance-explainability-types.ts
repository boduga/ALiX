/**
 * P28.1 — Governance explainability type definitions.
 *
 * Foundation types consumed by the governance explainability pipeline (Tasks 2-4).
 * Defines the section model and boundary-flag-carried GovernanceExplanation.
 * Pure data types with no store or filesystem dependencies.
 *
 * Core invariant: GovernanceExplanation carries 5 readonly boundary flags that
 * constrain downstream mutation — no mutation logic exists in this file.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// ExplanationSectionKind
// ---------------------------------------------------------------------------

/**
 * Discriminated section kind for a GovernanceExplanation section.
 *
 * Each kind represents a distinct lens onto a governance decision:
 * - `signal_origin` — which signals and adapters produced the recommendation
 * - `candidate_lifecycle` — lifecycle of the candidate action/proposal
 * - `outcome_summary` — aggregate outcome data
 * - `peer_comparison` — comparison against peer decisions or baselines
 * - `learning_synthesis` — synthesized learning signals
 */
export type ExplanationSectionKind =
  | "signal_origin"
  | "candidate_lifecycle"
  | "outcome_summary"
  | "peer_comparison"
  | "learning_synthesis";

// ---------------------------------------------------------------------------
// ExplanationSection
// ---------------------------------------------------------------------------

/**
 * A single section within a GovernanceExplanation.
 *
 * Each section is self-contained: it carries its own heading, body text,
 * evidence references, and optional quantitative data points.
 */
export interface ExplanationSection {
  kind: ExplanationSectionKind;
  heading: string;
  body: string;
  evidenceRefs: string[];
  dataPoints?: Record<string, number | string | boolean>;
}

// ---------------------------------------------------------------------------
// GovernanceExplanation
// ---------------------------------------------------------------------------

/**
 * A complete governance explanation artifact.
 *
 * Produced by the explainability assembler (Task 2), consumed by dashboard
 * rendering (Task 3) and feedback capture (Task 4).
 *
 * Boundary flags are all readonly and all default to `true` — they form a
 * single immutable permission profile that downstream consumers must respect
 * but can never change.
 */
export interface GovernanceExplanation {
  /** Unique identifier for this explanation. */
  explanationId: string;

  /** ISO-8601 timestamp when this explanation was generated. */
  generatedAt: string;

  /** Human-readable subject label (e.g. proposal id or signal id). */
  subject: string;

  /** Ordered sections that compose the explanation narrative. */
  sections: ExplanationSection[];

  /** Trace identifiers linking back to the originating pipeline. */
  traceIds: string[];

  // -----------------------------------------------------------------------
  // Boundary flags — all readonly, all default to true
  // -----------------------------------------------------------------------

  /** Explanation is read-only — no edits are permitted. */
  readonly readOnly: true;

  /** Governance policy mutation from this explanation is forbidden. */
  readonly noPolicyMutation: true;

  /** Threshold changes based on this explanation are forbidden. */
  readonly noThresholdChange: true;

  /** Automatic adoption of any suggestion in this explanation is forbidden. */
  readonly noAutoAdoption: true;

  /** Re-ranking of signals based on this explanation is forbidden. */
  readonly noRanking: true;
}
