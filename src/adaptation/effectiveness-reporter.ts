/**
 * P5.2b.3 — EffectivenessReporter. Pure read + compute; never mutates.
 * @module
 */
import type { EvidenceStore } from "../security/evidence/evidence-store.js";
import { computeMetricsSnapshot } from "../reflection/metrics-snapshot.js";
import type { ReflectionMetrics } from "../reflection/reflection-types.js";
import type { AdaptationProposal } from "./adaptation-types.js";
import type { ProposalEffectivenessReport, MetricsDelta, PrimaryMetricKey, MetricDirection, EffectivenessRecommendation } from "./effectiveness-types.js";
import { RECOMMENDATION_METRIC_MAP } from "./effectiveness-types.js";

export interface EffectivenessOptions {
  windowDays?: number;  // default 7
  minSample?: number;   // default 1
  now?: string;         // injection for deterministic tests
}

const DEFAULT_WINDOW_DAYS = 7;
const DEFAULT_MIN_SAMPLE = 1;
const REGRESSION_THRESHOLD = 0.1;

export class EffectivenessReporter {
  constructor(private readonly store: EvidenceStore) {}

  async assess(proposal: AdaptationProposal, opts: EffectivenessOptions = {}): Promise<ProposalEffectivenessReport> {
    if (proposal.status !== "applied" || !proposal.appliedAt) {
      throw new Error(`EffectivenessReporter: proposal ${proposal.id} is "${proposal.status}", expected "applied"`);
    }
    const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
    const minSample = opts.minSample ?? DEFAULT_MIN_SAMPLE;
    const now = opts.now ?? new Date().toISOString();
    const T = proposal.appliedAt;

    const metricsBefore = await computeMetricsSnapshot(this.store, { after: shiftDays(T, -windowDays), before: T });
    const metricsAfter = await computeMetricsSnapshot(this.store, { after: T, before: now });

    const mapping = RECOMMENDATION_METRIC_MAP[proposal.sourceRecommendationType] ?? null;
    const primary = mapping ? delta(mapping.metric, mapping.direction, metricsBefore, metricsAfter) : null;
    const dataSufficient = sufficient(metricsBefore, minSample) && sufficient(metricsAfter, minSample);
    const { recommendation, reason } = decide(primary, dataSufficient);

    return { proposalId: proposal.id, assessedAt: now, appliedAt: T, windowDays, metricsBefore, metricsAfter, primary, dataSufficient, recommendation, reason };
  }
}

function shiftDays(iso: string, days: number): string { const d = new Date(iso); d.setUTCDate(d.getUTCDate() + days); return d.toISOString(); }
function delta(metric: PrimaryMetricKey, direction: MetricDirection, b: ReflectionMetrics, a: ReflectionMetrics): MetricsDelta {
  const before = b[metric]; const after = a[metric];
  const absoluteDelta = after - before;
  // When before === 0 the true ratio is undefined; carry the sign of the
  // absolute delta so direction-aware regression/improvement checks still
  // fire (e.g. 0 → 5 unresolved is a regression, not a no-op).
  const relativeDelta = before !== 0 ? absoluteDelta / before : (absoluteDelta > 0 ? 1 : absoluteDelta < 0 ? -1 : 0);
  return { metric, direction, before, after, absoluteDelta, relativeDelta };
}
function sufficient(m: ReflectionMetrics, minSample: number): boolean {
  return (m.workflowsCompleted + m.workflowsAborted + m.workflowsBlocked + m.capabilitiesRequested) >= minSample;
}
function decide(primary: MetricsDelta | null, dataSufficient: boolean): { recommendation: EffectivenessRecommendation; reason: string } {
  if (!primary) return { recommendation: "investigate", reason: "No auto-measurable primary metric for this proposal type; manual review required." };
  if (!dataSufficient) return { recommendation: "investigate", reason: "Insufficient evidence in one or both windows to compare reliably." };
  const improved = primary.direction === "lower_is_better" ? primary.absoluteDelta < 0 : primary.absoluteDelta > 0;
  const regressed = primary.direction === "lower_is_better" ? primary.relativeDelta > REGRESSION_THRESHOLD : primary.relativeDelta < -REGRESSION_THRESHOLD;
  if (regressed) return { recommendation: "revert", reason: `${primary.metric} moved ${primary.before} → ${primary.after} (Δ${(primary.relativeDelta * 100).toFixed(0)}%); regression beyond ${(REGRESSION_THRESHOLD * 100).toFixed(0)}%.` };
  if (improved) return { recommendation: "keep", reason: `${primary.metric} improved ${primary.before} → ${primary.after}.` };
  return { recommendation: "keep", reason: `${primary.metric} unchanged (${primary.before} → ${primary.after}); no regression.` };
}
