/**
 * ops.ts — Decision-subsystem operator operations (J4 surface).
 *
 * Reads and writes the decision journal, outcome labels, and threshold-profile
 * registry. Nothing here touches the agent runtime, tools, or governance. The
 * only write that can change behavior is a profile promotion, and that
 * requires an explicit approval flag (arch §10).
 */

import {
  CONTEXT_RELEVANCE_PROFILES,
  DEFAULT_DECISION_CONFIG,
  JEV_ENGINE_ID,
  JEV_KEY_PROVIDER_ID,
  LOCAL_ENGINE_ID,
  activeProfile,
  computeReliability,
  createDecisionJournalStore,
  createOutcomeLabel,
  createOutcomeLabelStore,
  createProfileRegistry,
  deriveThresholdProfile,
  exportCalibrationDataset,
  indexLabelsByDecisionId,
  loadProfileRegistry,
  promoteProfile,
  resolveDecisionPaths,
  rollbackProfile,
  saveProfileRegistry,
  type CalibrationExport,
  type DecisionConfig,
  type DecisionJournalRecord,
  type DecisionPaths,
  type DecisionType,
  type LabelErrorType,
  type OutcomeLabel,
  type ReliabilityReport,
  type RiskContext,
  type ThresholdProfile,
} from "../../../decision/index.js";
import { loadConfig } from "../../../config/loader.js";
import { getSavedApiKey } from "../../helpers/api-keys.js";

export { JEV_KEY_PROVIDER_ID };

export type JevPaths = DecisionPaths;

export function resolveJevPaths(cwd: string): JevPaths {
  return resolveDecisionPaths(cwd);
}

export class JevOperatorError extends Error {
  readonly code = "JEV_OPERATOR";
  constructor(message: string) {
    super(message);
    this.name = "JevOperatorError";
  }
}

/**
 * Subsystem errors (calibration/profile validation) carry a `code` and a
 * human message; present them as operator errors instead of stack traces.
 */
function asOperatorError(error: unknown): never {
  if (error instanceof JevOperatorError) throw error;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && (error as Error).message) {
    throw new JevOperatorError((error as Error).message);
  }
  throw error;
}

const DECISION_TYPES: readonly DecisionType[] = [
  "claim-verification",
  "context-relevance",
  "model-tier",
  "risk-escalation",
];

export function parseDecisionType(value: string): DecisionType {
  if (!(DECISION_TYPES as readonly string[]).includes(value)) {
    throw new JevOperatorError(
      `unknown decision: ${value} (expected ${DECISION_TYPES.join(", ")})`,
    );
  }
  return value as DecisionType;
}

export async function loadAlixConfig(cwd: string = process.cwd()) {
  return loadConfig(cwd, { requireModel: false, suppressWarnings: true });
}

export async function loadDecisionConfig(cwd: string = process.cwd()): Promise<DecisionConfig> {
  return (await loadAlixConfig(cwd)).decision ?? DEFAULT_DECISION_CONFIG;
}

export async function hasJevKey(): Promise<boolean> {
  return (await getSavedApiKey(JEV_KEY_PROVIDER_ID)) !== null;
}

// ─── Status ───────────────────────────────────────────────────────────

export type RouteStatus = {
  decision: DecisionType;
  engine: string;
  fallback: string;
  enabled: boolean;
  thresholdProfile: string;
};

export type JevStatus = {
  remoteJevEnabled: boolean;
  keyPresent: boolean;
  journalRecords: number;
  labels: number;
  malformedLabels: number;
  profiles: readonly ThresholdProfile[];
  shippedProfiles: readonly ThresholdProfile[];
  routes: RouteStatus[];
};

export async function buildStatus(paths: JevPaths): Promise<JevStatus> {
  const config = await loadDecisionConfig();
  const labelRead = await createOutcomeLabelStore(paths.dir).readAll();
  const routes: RouteStatus[] = (
    [
      ["claim-verification", config.claimVerification],
      ["context-relevance", config.contextRelevance],
      ["model-tier", config.modelTier],
      ["risk-escalation", config.riskEscalation],
    ] as const
  ).map(([decision, route]) => ({
    decision,
    engine: route.engine,
    fallback: route.fallback,
    enabled: route.enabled === true,
    thresholdProfile: route.thresholdProfile,
  }));

  return {
    remoteJevEnabled: config.remote.jev.enabled === true,
    keyPresent: await hasJevKey(),
    journalRecords: createDecisionJournalStore(paths.dir).readAll().length,
    labels: labelRead.labels.length,
    malformedLabels: labelRead.malformed,
    profiles: loadProfileRegistry(paths.profiles).profiles,
    shippedProfiles: [
      ...shippedProfiles("context-relevance"),
    ],
    routes,
  };
}

// ─── Labels ───────────────────────────────────────────────────────────

export type LabelResult = {
  decisionId: string;
  knownDecisionId: boolean;
};

export async function labelDecision(
  paths: JevPaths,
  input: {
    decisionId: string;
    decision: DecisionType;
    label: OutcomeLabel;
    errorType?: LabelErrorType;
    observedAt?: number;
    note?: string;
  },
): Promise<LabelResult> {
  const known = createDecisionJournalStore(paths.dir)
    .readAll()
    .some((record) => record.decisionId === input.decisionId);
  const label = createOutcomeLabel({
    decisionId: input.decisionId,
    decision: input.decision,
    label: input.label,
    ...(input.errorType !== undefined ? { errorType: input.errorType } : {}),
    ...(input.observedAt !== undefined ? { observedAt: input.observedAt } : {}),
    ...(input.note !== undefined ? { note: input.note } : {}),
  });
  await createOutcomeLabelStore(paths.dir).append(label);
  return { decisionId: label.decisionId, knownDecisionId: known };
}

// ─── Calibration ──────────────────────────────────────────────────────

export async function exportDataset(
  paths: JevPaths,
  opts: { decision?: DecisionType; engineId?: string; outPath?: string } = {},
): Promise<CalibrationExport> {
  return exportCalibrationDataset(
    { journal: createDecisionJournalStore(paths.dir), labels: createOutcomeLabelStore(paths.dir) },
    opts,
  );
}

export async function reliabilityReport(
  paths: JevPaths,
  opts: { decision: DecisionType; engineId: string; bins?: number },
): Promise<ReliabilityReport> {
  const dataset = await exportDataset(paths, {
    decision: opts.decision,
    engineId: opts.engineId,
  });
  try {
    return computeReliability(dataset.samples, opts.bins !== undefined ? { bins: opts.bins } : undefined);
  } catch (error) {
    asOperatorError(error);
  }
}

// ─── Threshold profiles ───────────────────────────────────────────────

export function listProfiles(paths: JevPaths): readonly ThresholdProfile[] {
  return loadProfileRegistry(paths.profiles).profiles;
}

/**
 * Uncalibrated defaults that ship in code rather than on disk. They are
 * `shadow`, so they never apply and cannot be promoted (no provenance) — they
 * exist so an operator can see the starting threshold for a decision.
 */
export function shippedProfiles(decision: DecisionType): readonly ThresholdProfile[] {
  return decision === "context-relevance" ? CONTEXT_RELEVANCE_PROFILES.profiles : [];
}

export async function deriveProfile(
  paths: JevPaths,
  opts: {
    decision: DecisionType;
    engineId: string;
    targetAccuracy: number;
    id: string;
    datasetId: string;
    risk?: RiskContext;
    now?: number;
  },
): Promise<ThresholdProfile> {
  const report = await reliabilityReport(paths, {
    decision: opts.decision,
    engineId: opts.engineId,
  });
  const derived = deriveThresholdProfile({
    report,
    datasetId: opts.datasetId,
    id: opts.id,
    decision: opts.decision,
    engineId: opts.engineId,
    targetAccuracy: opts.targetAccuracy,
    ...(opts.risk !== undefined ? { risk: opts.risk } : {}),
    ...(opts.now !== undefined ? { computedAt: opts.now } : {}),
  });
  const registry = createProfileRegistry([
    ...listProfiles(paths).filter((profile) => profile.id !== derived.id),
    derived,
  ]);
  saveProfileRegistry(paths.profiles, registry);
  return derived;
}

/**
 * Promote a profile to active. Requires `approved: true` — promotion changes
 * which items get selected, so it is a governance action (arch §10), not a
 * configuration edit.
 */
export function promoteProfileById(
  paths: JevPaths,
  id: string,
  opts: { approved: boolean; approvedBy?: string; now?: number },
): readonly ThresholdProfile[] {
  if (opts.approved !== true) {
    throw new JevOperatorError(
      "promotion changes decision behavior and requires explicit approval; re-run with --approve",
    );
  }
  try {
    const promoted = promoteProfile(loadProfileRegistry(paths.profiles), id, {
      approved: true,
      ...(opts.approvedBy !== undefined ? { approvedBy: opts.approvedBy } : {}),
      ...(opts.now !== undefined ? { now: opts.now } : {}),
    });
    saveProfileRegistry(paths.profiles, promoted);
    return promoted.profiles;
  } catch (error) {
    asOperatorError(error);
  }
}

export function rollbackProfiles(
  paths: JevPaths,
  scope: { decision: DecisionType; engineId: string; risk?: RiskContext },
  opts: { now?: number } = {},
): readonly ThresholdProfile[] {
  try {
    const rolledBack = rollbackProfile(loadProfileRegistry(paths.profiles), scope, opts);
    saveProfileRegistry(paths.profiles, rolledBack);
    return rolledBack.profiles;
  } catch (error) {
    asOperatorError(error);
  }
}

/** The profile a decision/engine would apply today, or undefined. */
export function activeProfileFor(
  paths: JevPaths,
  scope: { decision: DecisionType; engineId: string; risk?: RiskContext },
): ThresholdProfile | undefined {
  return activeProfile(loadProfileRegistry(paths.profiles), scope);
}

// ─── Disagreements ────────────────────────────────────────────────────

export type DisagreementSide = {
  engineId: string;
  decisionId: string;
  verdict: string;
  label?: OutcomeLabel;
};

export type DisagreementPair = {
  projectionHash: string;
  /** Exactly two sides: Jev, then local baseline (plan amendment 2). */
  sides: DisagreementSide[];
};

export type DisagreementsReport = {
  decision: DecisionType;
  invocations: number;
  paired: number;
  agreements: number;
  disagreements: number;
  disagreementRate: string; // "27.5%" or "n/a"
  labelled: number;
  unlabelled: number;
  jevCorrect: number;
  baselineCorrect: number;
  bothWrong: number;
  pairs: DisagreementPair[];
};

/** projectionHash -> engineId -> most recent Choice record (spec §15). */
export function groupChoiceByEngine(
  records: readonly DecisionJournalRecord[],
  decision: DecisionType,
): Map<string, Map<string, DecisionJournalRecord>> {
  const groups = new Map<string, Map<string, DecisionJournalRecord>>();
  for (const record of records) {
    if (record.decision !== decision || record.outcome.kind !== "choice") continue;
    const byEngine = groups.get(record.projectionHash) ?? new Map<string, DecisionJournalRecord>();
    const previous = byEngine.get(record.engineId);
    if (previous === undefined || record.timestamp >= previous.timestamp) {
      byEngine.set(record.engineId, record);
    }
    groups.set(record.projectionHash, byEngine);
  }
  return groups;
}

export async function buildDisagreements(
  paths: JevPaths,
  opts: { decision?: DecisionType },
): Promise<DisagreementsReport> {
  const decision = opts.decision ?? "claim-verification";
  const records = createDecisionJournalStore(paths.dir).readAll();
  // invocations = EVERY group of this decision (spec §17 shows invocations=42,
  // paired=40) — failure-only groups count as invocations but can never pair.
  const invocations = new Set(
    records.filter((record) => record.decision === decision).map((record) => record.projectionHash),
  ).size;
  const groups = groupChoiceByEngine(records, decision);
  const labels = indexLabelsByDecisionId(
    (await createOutcomeLabelStore(paths.dir).readAll()).labels,
  );

  let paired = 0;
  let disagreements = 0;
  const pairs: DisagreementPair[] = [];
  let labelled = 0;
  let jevCorrect = 0;
  let baselineCorrect = 0;
  let bothWrong = 0;

  for (const [projectionHash, byEngine] of groups) {
    // The experiment is Jev vs the local baseline ONLY (plan amendment 2).
    // A group that lacks either — or that has a third engine instead of one
    // of them — is not a comparable experiment pair. Third-engine records
    // stay journalled; they never enter the denominator or the tallies.
    const jevRecord = byEngine.get(JEV_ENGINE_ID);
    const baselineRecord = byEngine.get(LOCAL_ENGINE_ID);
    if (jevRecord === undefined || baselineRecord === undefined) continue;
    paired += 1;
    const sides: DisagreementSide[] = [jevRecord, baselineRecord].map((record) => ({
      engineId: record.engineId,
      decisionId: record.decisionId,
      verdict: String((record.outcome as { choice: unknown }).choice),
      label: labels.get(record.decisionId)?.label,
    }));

    if (sides[0].verdict === sides[1].verdict) continue; // agreement

    disagreements += 1;
    pairs.push({ projectionHash, sides });

    const allLabelled = sides.every((side) => side.label !== undefined);
    if (!allLabelled) continue;
    labelled += 1;
    if (sides[0].label === "correct") jevCorrect += 1;
    if (sides[1].label === "correct") baselineCorrect += 1;
    if (sides.every((side) => side.label === "incorrect")) bothWrong += 1;
  }

  return {
    decision,
    invocations,
    paired,
    agreements: paired - disagreements,
    disagreements,
    disagreementRate: paired > 0 ? `${((disagreements / paired) * 100).toFixed(1)}%` : "n/a",
    labelled,
    unlabelled: disagreements - labelled,
    jevCorrect,
    baselineCorrect,
    bothWrong,
    pairs,
  };
}
