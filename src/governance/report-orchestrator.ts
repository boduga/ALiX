/**
 * P15.4 — Governance Observability Report: pure composition layer.
 *
 * Aggregates P15.1 trends, P15.2 anomalies, P15.3a effectiveness into
 * one unified report object. Zero store imports, zero CLI I/O.
 */

import type { GovernanceAuditEvent } from "./audit-types.js";
import type { OperatorDecision } from "./decision-capture.js";
import type { OperatorReview } from "./operator-review.js";
import type { GovernanceActionProposal, ActionProposalStatusTransition } from "./action-queue.js";
import {
  eventTypeDistribution,
  decisionRates,
  riskDistribution,
  timeWindowedCounts,
  topActors,
  topSubjects,
  policyActivity,
  traceVolume,
} from "./audit-metrics.js";
import { detectAnomalies } from "./audit-anomalies.js";
import { computeEffectiveness } from "./operator-effectiveness.js";

export interface ReportOptions {
  since: string;
  until: string;
  now: string;
  staleThresholdDays: number;
  sections: ("trends" | "anomalies" | "effectiveness")[];
}

export interface GovernanceReport {
  windowStart: string;
  windowEnd: string;
  sections: string[];
  trends?: Record<string, unknown>;
  anomalies?: unknown[];
  effectiveness?: Record<string, unknown>;
}

export function buildReport(
  auditEvents: GovernanceAuditEvent[],
  decisions: OperatorDecision[],
  reviews: OperatorReview[],
  proposals: GovernanceActionProposal[],
  transitions: ActionProposalStatusTransition[],
  options: ReportOptions,
): GovernanceReport {
  const report: GovernanceReport = {
    windowStart: options.since,
    windowEnd: options.until,
    sections: [...options.sections],
  };

  const windowMs = Math.max(
    (new Date(options.until).getTime() - new Date(options.since).getTime()) / (60 * 1000),
    1,
  );

  for (const section of options.sections) {
    switch (section) {
      case "trends": {
        report.trends = {
          totalEvents: auditEvents.length,
          eventTypeDistribution: eventTypeDistribution(auditEvents),
          decisionRates: decisionRates(auditEvents),
          riskDistribution: riskDistribution(auditEvents),
          timeBuckets: timeWindowedCounts(auditEvents, windowMs * 60 * 1000),
          topActors: topActors(auditEvents, 10),
          topSubjects: topSubjects(auditEvents, 10),
          policyActivity: policyActivity(auditEvents),
          traceVolume: traceVolume(auditEvents),
        };
        break;
      }
      case "anomalies": {
        const windowLenMs = new Date(options.until).getTime() - new Date(options.since).getTime();
        const baselineStart = new Date(new Date(options.since).getTime() - windowLenMs).toISOString();
        const currentEvents = auditEvents.filter(
          (e) => e.timestamp >= options.since && e.timestamp < options.until,
        );
        const baselineEvents = auditEvents.filter(
          (e) => e.timestamp >= baselineStart && e.timestamp < options.since,
        );
        report.anomalies = detectAnomalies(
          currentEvents,
          baselineEvents.length > 0 ? baselineEvents : undefined,
        );
        break;
      }
      case "effectiveness": {
        const filteredDecisions = decisions.filter(
          (d) => d.createdAt >= options.since && d.createdAt < options.until,
        );
        const filteredReviews = reviews.filter(
          (r) => r.createdAt >= options.since && r.createdAt < options.until,
        );
        report.effectiveness = computeEffectiveness(
          auditEvents,
          filteredDecisions,
          filteredReviews,
          proposals,
          transitions,
          { staleThresholdDays: options.staleThresholdDays, now: options.now },
        ) as unknown as Record<string, unknown>;
        break;
      }
    }
  }

  return report;
}
