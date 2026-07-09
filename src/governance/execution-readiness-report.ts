/**
 * P19.4 — Readiness Report (read-only domain function).
 *
 * Builds a time-windowed, deterministically-sorted report over P19.1–P19.3
 * outputs with P18 lifecycle trace correlation.
 */

import type { WorkbenchLifecycleTrace } from "./governance-workbench.js";
import type {
  ExecutionReadinessAssessment,
  ExecutionReadinessLevel,
} from "./execution-readiness.js";
import type { DryRunSimulation } from "./dry-run-simulator.js";
import type { ReadinessGateDecision, ReadinessDisposition } from "./readiness-policy-gate.js";

export interface ExecutionReadinessReportInput {
  assessments: ExecutionReadinessAssessment[];
  simulations: DryRunSimulation[];
  decisions: ReadinessGateDecision[];
  lifecycleTraces: WorkbenchLifecycleTrace[];
  options?: {
    since?: string;
    until?: string;
    now?: string;
  };
}

export interface ExecutionReadinessReportItem {
  remediationId: string;
  planId: string;
  approvalId: string;
  assessmentId: string;
  simulationId: string | null;
  decisionId: string | null;
  readinessLevel: ExecutionReadinessLevel;
  disposition: ReadinessDisposition | "not_evaluated";
  simulationStatus: string;
  p18TracePresent: boolean;
  futureControlledExecutionCandidate: boolean;
  controlledExecutionAuthorization: "not_available_in_p19";
  requiresAttention: boolean;
  reasonCodes: string[];
  updatedAt: string;
}

export interface ExecutionReadinessReportTotals {
  blocked: number;
  manualOnly: number;
  dryRunAllowed: number;
  notEvaluated: number;
  externalSideEffecting: number;
  irreversible: number;
  reversible: number;
  dryRunCapable: number;
  missingP18Visibility: number;
  futureCandidates: number;
}

export interface ExecutionReadinessReport {
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  totals: ExecutionReadinessReportTotals;
  items: ExecutionReadinessReportItem[];
}

export class ReadinessReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReadinessReportError";
  }
}

function parseIso(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new ReadinessReportError(`invalid ISO timestamp "${value}"`);
  }
  return parsed;
}

function traceMatches(
  trace: WorkbenchLifecycleTrace | undefined,
  item: ExecutionReadinessAssessment,
): boolean {
  if (!trace || trace.remediationId !== item.remediationId) return false;
  return (
    trace.hops.some(
      (hop) => hop.kind === "plan" && hop.id === item.planId && !hop.gap,
    ) &&
    trace.hops.some(
      (hop) => hop.kind === "approval" && hop.id === item.approvalId && !hop.gap,
    )
  );
}

const DISPOSITION_ORDER: Record<
  ExecutionReadinessReportItem["disposition"],
  number
> = {
  blocked: 0,
  manual_only: 1,
  dry_run_allowed: 2,
  not_evaluated: 3,
};

export function buildExecutionReadinessReport(
  input: ExecutionReadinessReportInput,
): ExecutionReadinessReport {
  const generatedAt = input.options?.now ?? new Date().toISOString();
  const windowEnd = input.options?.until ?? generatedAt;
  const windowStart =
    input.options?.since ??
    new Date(parseIso(windowEnd) - 7 * 24 * 60 * 60 * 1000).toISOString();

  const windowStartMs = parseIso(windowStart);
  const windowEndMs = parseIso(windowEnd);

  // Index simulations and decisions by assessmentId for O(1) join
  const simByAssessment = new Map<string, DryRunSimulation>();
  for (const sim of input.simulations) {
    simByAssessment.set(sim.assessmentId, sim);
  }
  const decByAssessment = new Map<string, ReadinessGateDecision>();
  for (const dec of input.decisions) {
    decByAssessment.set(dec.assessmentId, dec);
  }

  // Index lifecycle traces by remediationId
  const traceByRemediation = new Map<string, WorkbenchLifecycleTrace>();
  for (const trace of input.lifecycleTraces) {
    traceByRemediation.set(trace.remediationId, trace);
  }

  const items: ExecutionReadinessReportItem[] = [];

  for (const assessment of input.assessments) {
    const assessedAtMs = parseIso(assessment.assessedAt);
    if (assessedAtMs < windowStartMs || assessedAtMs >= windowEndMs) continue;

    const simulation = simByAssessment.get(assessment.assessmentId) ?? null;
    const decision = decByAssessment.get(assessment.assessmentId) ?? null;
    const trace = traceByRemediation.get(assessment.remediationId);
    const p18TracePresent = traceMatches(trace, assessment);
    const disposition: ExecutionReadinessReportItem["disposition"] =
      decision?.disposition ?? "not_evaluated";
    const reasonCodes = [
      ...(decision?.reasonCodes ?? []),
      ...(!p18TracePresent ? ["p18_visibility_missing"] : []),
    ].filter((value, index, all) => all.indexOf(value) === index).sort();
    const updatedAt =
      decision?.evaluatedAt ??
      simulation?.simulatedAt ??
      assessment.assessedAt;

    items.push({
      remediationId: assessment.remediationId,
      planId: assessment.planId,
      approvalId: assessment.approvalId,
      assessmentId: assessment.assessmentId,
      simulationId: simulation?.simulationId ?? null,
      decisionId: decision?.decisionId ?? null,
      readinessLevel: assessment.readinessLevel,
      disposition,
      simulationStatus: simulation?.status ?? "not_simulated",
      p18TracePresent,
      futureControlledExecutionCandidate:
        p18TracePresent && (decision?.futureControlledExecutionCandidate ?? false),
      controlledExecutionAuthorization: "not_available_in_p19",
      requiresAttention:
        !p18TracePresent ||
        disposition === "blocked" ||
        disposition === "not_evaluated",
      reasonCodes,
      updatedAt,
    });
  }

  items.sort(
    (left, right) =>
      Number(right.requiresAttention) - Number(left.requiresAttention) ||
      DISPOSITION_ORDER[left.disposition] - DISPOSITION_ORDER[right.disposition] ||
      left.updatedAt.localeCompare(right.updatedAt) ||
      left.remediationId.localeCompare(right.remediationId) ||
      left.planId.localeCompare(right.planId),
  );

  const countDisposition = (value: ExecutionReadinessReportItem["disposition"]) =>
    items.filter((item) => item.disposition === value).length;
  const countLevel = (value: ExecutionReadinessLevel) =>
    items.filter((item) => item.readinessLevel === value).length;

  return {
    generatedAt,
    windowStart,
    windowEnd,
    totals: {
      blocked: countDisposition("blocked"),
      manualOnly: countDisposition("manual_only"),
      dryRunAllowed: countDisposition("dry_run_allowed"),
      notEvaluated: countDisposition("not_evaluated"),
      externalSideEffecting: countLevel("external_side_effecting"),
      irreversible: countLevel("irreversible"),
      reversible: countLevel("reversible"),
      dryRunCapable: countLevel("dry_run_capable"),
      missingP18Visibility: items.filter((i) => !i.p18TracePresent).length,
      futureCandidates: items.filter((i) => i.futureControlledExecutionCandidate).length,
    },
    items,
  };
}
