/** Pure read-model assembly: canonical artifacts + source health → one
 *  immutable EvolutionProjectionSnapshot (Q-S1..S4, Q-C3b). Never a domain
 *  store; never rewrites canonical identities. */
import type { A9Correlation, A9Forecast } from '../../../evolution/a9/contracts/a9-contract.js';
import type { GovernanceRecommendation } from '../../../evolution/verification/contracts/recommendation-contract.js';
import { decisionKindToTargetState, recommendationKindToDecisionKind } from '../../../evolution/governance/decision-engine.js';
import type { LearningFinding, LearningProposal } from '../../../evolution/learning/contracts/learning-contract.js';
import { buildEvolutionLinks } from './evolution-link-builder.js';
import type {
  CapabilitySpineEntry,
  CorrelationRow,
  DecisionRow,
  EvolutionProjectionSnapshot,
  ForecastRow,
  LearningPatternRow,
  LifecycleRow,
  MeasurementRow,
  StageState,
  StageStatus,
} from './evolution-projection-snapshot.js';

export interface StageInput<T> {
  readonly records: readonly T[];
  readonly status: StageStatus;
}

/** The projection's own measurement DTO (derived from relayed
 *  `capability.governance.measurement.measured` events). `eventId` is
 *  `String(event.seq)` — the dedup/restart marker (Q-C4). Contains NO
 *  proposalId / forecastId / correlationId (sentinel preserved). */
export interface MeasurementRecord {
  readonly measurementId: string;
  readonly eventId: string;
  readonly capabilityId: string;
  readonly recordedAt: string;
  readonly status: string;
  readonly outcomeKind: string;
  readonly confidence: number;
}

export interface EvolutionAssemblerInputs {
  readonly generatedAt: number;
  readonly lifecycle: StageInput<LifecycleRow>;
  readonly learning: { readonly result: LearningProposal | null; readonly unavailable: boolean };
  readonly forecasts: StageInput<A9Forecast>;
  readonly correlations: StageInput<A9Correlation>;
  readonly recommendations: StageInput<GovernanceRecommendation>;
  readonly measurements: StageInput<MeasurementRecord>;
  /** proposalId → target capabilityId (relayed proposal.submitted payloads). */
  readonly proposalTargets: Readonly<Record<string, string>>;
}

/** The capability a learning finding is about. underperformer +
 *  outcome-contradiction key findings by capabilityId; repeated-pattern-failure
 *  fingerprints as `${error}:${capabilityId}` (capabilityId is the final
 *  `:`-delimited segment). Read-model association only. */
export function learningCapabilityId(finding: LearningFinding): string | undefined {
  if (finding.kind === 'repeated-pattern-failure') {
    const idx = finding.identityKey.lastIndexOf(':');
    return idx === -1 ? undefined : finding.identityKey.slice(idx + 1);
  }
  return finding.identityKey;
}

export function assembleEvolutionSnapshot(inputs: EvolutionAssemblerInputs): EvolutionProjectionSnapshot {
  const { generatedAt } = inputs;

  const forecasts: StageState<ForecastRow> = stage(inputs.forecasts, (f) => ({
    forecastId: f.forecastId,
    kind: f.prediction.kind,
    band: f.prediction.band,
    confidence: f.confidence,
    subject: f.subject,
    subjectCapability: f.subjectCapability,
  }));

  const decisions = toDecisionStage(inputs.recommendations);

  const measurements: StageState<MeasurementRow> = stage(inputs.measurements, (m) => ({
    measurementId: m.measurementId,
    capabilityId: m.capabilityId,
    recordedAt: m.recordedAt,
    status: m.status,
    outcomeKind: m.outcomeKind,
    confidence: m.confidence,
  }));

  const correlations: StageState<CorrelationRow> = stage(inputs.correlations, (c) => ({
    correlationId: c.correlationId,
    forecastId: c.forecastId,
    measurementId: c.measurementId,
    delta: c.resolution.delta,
    band: c.resolution.band,
    forecastBand: c.resolution.forecastBand,
  }));

  const learning = toLearningStage(inputs.learning);

  const lifecycle: StageState<LifecycleRow> =
    inputs.lifecycle.status === 'available'
      ? { status: 'available', items: inputs.lifecycle.records }
      : { status: inputs.lifecycle.status, items: [] };

  const capabilityIds = collectCapabilityIds(inputs);
  const spine: CapabilitySpineEntry[] = capabilityIds.map((capabilityId) => ({
    capabilityId,
    lifecycle:
      lifecycle.status === 'available'
        ? (lifecycle.items.find((l) => l.capabilityId === capabilityId) ?? null)
        : null,
    learning: learningStageFor(inputs.learning, capabilityId),
    forecasts: { status: forecasts.status, items: forecasts.items.filter((f) => f.subjectCapability === capabilityId) },
    decisions: { status: decisions.status, items: decisions.items.filter((d) => (inputs.proposalTargets[d.proposalId] ?? '') === capabilityId) },
    measurements: { status: measurements.status, items: measurements.items.filter((m) => m.capabilityId === capabilityId) },
    correlations: { status: correlations.status, items: correlations.items.filter((c) => measurementCapabilityId(c, measurements) === capabilityId) },
  }));

  const links = buildEvolutionLinks({
    forecasts: inputs.forecasts.records,
    recommendations: inputs.recommendations.records,
    measurements: inputs.measurements.records,
    correlations: inputs.correlations.records,
    proposalTargets: inputs.proposalTargets,
  });

  return {
    generatedAt,
    stages: { lifecycle, learning, forecasts, decisions, measurements, correlations },
    spine,
    links,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function stage<T, R>(input: StageInput<T>, map: (t: T) => R): StageState<R> {
  return input.status === 'available'
    ? { status: 'available', items: input.records.map(map) }
    : { status: input.status, items: [] };
}

function toLearningPatternRow(f: LearningFinding): LearningPatternRow {
  return { findingId: f.findingId, kind: f.kind, occurrences: f.occurrences, summary: f.summary };
}

function toLearningStage(input: { result: LearningProposal | null; unavailable: boolean }): StageState<LearningPatternRow> {
  if (input.unavailable) return { status: 'unavailable', items: [] };
  const findings = input.result?.findings ?? [];
  return {
    status: findings.length > 0 ? 'available' : 'empty',
    items: findings.map(toLearningPatternRow),
  };
}

/** Per-capability learning stage — re-derives from the raw findings so the
 *  spine associates by `learningCapabilityId`, never by parsing display rows. */
function learningStageFor(input: { result: LearningProposal | null; unavailable: boolean }, capabilityId: string): StageState<LearningPatternRow> {
  if (input.unavailable) return { status: 'unavailable', items: [] };
  const findings = (input.result?.findings ?? []).filter((f) => learningCapabilityId(f) === capabilityId);
  return {
    status: findings.length > 0 ? 'available' : 'empty',
    items: findings.map(toLearningPatternRow),
  };
}

function toDecisionStage(input: StageInput<GovernanceRecommendation>): StageState<DecisionRow> {
  if (input.status !== 'available') return { status: input.status, items: [] };
  const items = input.records.map<DecisionRow>((r) => {
    const projectedDecision = recommendationKindToDecisionKind(r.kind) ?? null;
    return {
      recommendationId: r.recommendationId,
      recommendationKind: r.kind,
      proposalId: r.proposalId,
      confidence: r.confidence,
      projectedDecision,
      targetState: projectedDecision ? decisionKindToTargetState(projectedDecision) : null,
    };
  });
  return { status: 'available', items };
}

function collectCapabilityIds(inputs: EvolutionAssemblerInputs): string[] {
  const ids = new Set<string>();
  for (const l of inputs.lifecycle.records) ids.add(l.capabilityId);
  for (const f of inputs.forecasts.records) ids.add(f.subjectCapability);
  for (const m of inputs.measurements.records) ids.add(m.capabilityId);
  for (const capabilityId of Object.values(inputs.proposalTargets)) ids.add(capabilityId);
  return [...ids].sort();
}

/** Resolve a correlation's measurement to its capability (the spine groups
 *  correlations under the measured capability). Accepts the minimal structural
 *  shape (CorrelationRow or A9Correlation) — only `measurementId` is read. */
function measurementCapabilityId(c: { readonly measurementId: string }, measurements: StageState<MeasurementRow>): string | undefined {
  if (measurements.status !== 'available') return undefined;
  return measurements.items.find((m) => m.measurementId === c.measurementId)?.capabilityId;
}
