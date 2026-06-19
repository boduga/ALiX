import type { ReflectionMetrics } from "../reflection/reflection-types.js";

/**
 * Effectiveness types for P5.2b — measures whether an applied adaptation helped.
 *
 * Consumed by the reporter (Task 3), store (Task 4), and CLI (Task 6).
 * Pure types + one const map; no logic, no I/O.
 */

/** Keys of {@link ReflectionMetrics} that a recommendation may target. */
export type PrimaryMetricKey =
  | "workflowsAborted"
  | "workflowsBlocked"
  | "unresolvedCapabilities"
  | "capabilitiesRequested"
  | "reviewApprovalRate";

/** Whether a lower or higher value of a metric is the desired outcome. */
export type MetricDirection = "lower_is_better" | "higher_is_better";

/**
 * Outcome of assessing an applied proposal's effectiveness.
 *
 * Advisory only — "revert" recommends human action; it never executes a revert
 * (no before-snapshot is stored; executable revert is a later phase).
 */
export type EffectivenessRecommendation =
  | "keep"
  | "revert"
  | "investigate";

/** recommendation type → metric it intends to improve; null ⇒ investigate. */
export const RECOMMENDATION_METRIC_MAP: Record<
  string,
  { metric: PrimaryMetricKey; direction: MetricDirection } | null
> = {
  capability_gap: {
    metric: "unresolvedCapabilities",
    direction: "lower_is_better",
  },
  agent_card_update: {
    metric: "unresolvedCapabilities",
    direction: "lower_is_better",
  },
  routing_adjustment: {
    metric: "unresolvedCapabilities",
    direction: "lower_is_better",
  },
  skill_revision: { metric: "workflowsAborted", direction: "lower_is_better" },
  process_change: null,
};

/** Computed delta for the primary metric over the assessment window. */
export interface MetricsDelta {
  metric: PrimaryMetricKey;
  direction: MetricDirection;
  before: number;
  after: number;
  absoluteDelta: number;
  relativeDelta: number;
}

/** Report on whether an applied proposal improved its targeted metric. */
export interface ProposalEffectivenessReport {
  proposalId: string;
  assessedAt: string;
  appliedAt: string;
  windowDays: number;
  metricsBefore: ReflectionMetrics;
  metricsAfter: ReflectionMetrics;
  primary: MetricsDelta | null;
  dataSufficient: boolean;
  recommendation: EffectivenessRecommendation;
  reason: string;
}
