/**
 * tool-selection-corpus.ts — T3 corpus + eligibility contract (PREREGISTERED).
 *
 * Frozen BEFORE corpus #2 is collected, so the definition of a usable scope and
 * the exclusion vocabulary cannot be tuned after seeing more disagreements. The
 * policy this implements is written down in
 * `docs/jev/T3-selection-evaluation-preregistration.md`; this module is the
 * executable form of it.
 *
 * Nothing here scores a selector. It defines:
 * - what each corpus row may support (two independent eligibility tracks),
 * - the closed set of exclusion codes,
 * - the blind labelling card and its deterministic rotation,
 * - the two label records (disagreement, objective-gap closure),
 * - a corpus summary that reports facts and prerequisites, never a verdict.
 */

import { createHash } from "node:crypto";
import { MCP_TOOL_PREFIX } from "./tool-selection-candidates.js";
import { candidateFor, type ToolSelectionScope } from "./tool-selection-replay.js";

/**
 * Closed vocabulary. There is no generic `bad-run`: an exclusion must name what
 * actually went wrong, and a code is added here only by changing this list.
 */
export const SELECTION_EXCLUSION_CODES = [
  "execution-context-drift",
  "incomplete-trace",
  "projection-invalid",
  "candidate-set-not-preserved",
  "replay-invalid",
  "fixture-ambiguous",
  "operator-aborted",
] as const;

export type SelectionExclusionCode = (typeof SELECTION_EXCLUSION_CODES)[number];

export function isSelectionExclusionCode(value: unknown): value is SelectionExclusionCode {
  return typeof value === "string" && (SELECTION_EXCLUSION_CODES as readonly string[]).includes(value);
}

export type TrackEligibility = "eligible" | "ineligible";

/**
 * The two tracks are independent on purpose: a run whose selection is factual
 * can still have an unclean execution result, and vice versa. `reason` is
 * present whenever either track is ineligible and is always a registered code.
 */
export type EvaluationEligibility = {
  selection: TrackEligibility;
  outcome: TrackEligibility;
  /**
   * The chosen code is `reason`; every other code that fired is kept here.
   * A row can be excluded for one reason while still carrying evidence about
   * another defect (pilot 8a0de18b: comparison excluded for a failed candidate
   * set, diagnostic `execution-context-drift`). Dropping the second code would
   * lose the only record of that defect.
   */
  diagnostics: SelectionExclusionCode[];
  reason?: SelectionExclusionCode;
};

export type EligibilityInput = {
  scope: ToolSelectionScope;
  /** The alternative ordering, when the offline scorer ran for this scope. */
  replay?: { candidateSetPreserved: boolean; invalidReason?: string };
  /**
   * Analyst-assigned exclusion (drift, ambiguity, abort). Overrides derivation
   * for the named track only — a drifted run keeps an eligible selection.
   */
  override?: { track: "selection" | "outcome" | "both"; reason: SelectionExclusionCode };
};

const CODE_PRECEDENCE: readonly SelectionExclusionCode[] = SELECTION_EXCLUSION_CODES;

function firstReason(reasons: SelectionExclusionCode[]): SelectionExclusionCode | undefined {
  return CODE_PRECEDENCE.find(code => reasons.includes(code));
}

/**
 * Derive eligibility from what the trace actually shows. Precedence, highest
 * first: projection-invalid, incomplete-trace, candidate-set-not-preserved,
 * replay-invalid; then the analyst override, which always wins for its track.
 */
export function deriveEvaluationEligibility(input: EligibilityInput): EvaluationEligibility {
  const selectionReasons: SelectionExclusionCode[] = [];
  const outcomeReasons: SelectionExclusionCode[] = [];
  const { scope, replay, override } = input;

  const unresolved = scope.offered.some(
    candidateId => candidateId.startsWith(MCP_TOOL_PREFIX) || candidateFor(scope, candidateId) === undefined,
  );
  if (scope.candidates.length === 0 || scope.offered.length === 0 || unresolved) {
    selectionReasons.push("projection-invalid");
    outcomeReasons.push("projection-invalid");
  }
  if (scope.actualCandidateIds.length === 0) outcomeReasons.push("incomplete-trace");
  if (replay && !replay.candidateSetPreserved) selectionReasons.push("candidate-set-not-preserved");
  if (replay && replay.candidateSetPreserved && replay.invalidReason) selectionReasons.push("replay-invalid");

  if (override && (override.track === "selection" || override.track === "both")) {
    selectionReasons.push(override.reason);
  }
  if (override && (override.track === "outcome" || override.track === "both")) {
    outcomeReasons.push(override.reason);
  }

  const selectionIneligible = firstReason(selectionReasons);
  const outcomeIneligible = firstReason(outcomeReasons);
  const reason = selectionIneligible ?? outcomeIneligible;
  const diagnostics = [...new Set([...selectionReasons, ...outcomeReasons])].filter(code => code !== reason);
  return {
    selection: selectionIneligible ? "ineligible" : "eligible",
    outcome: outcomeIneligible ? "ineligible" : "eligible",
    diagnostics,
    ...(reason ? { reason } : {}),
  };
}

/** Track A label. A candidate is judged on its own, never as a winner. */
export const APPROPRIATENESS_LABELS = ["appropriate", "inappropriate", "unclear"] as const;
export type AppropriatenessLabel = (typeof APPROPRIATENESS_LABELS)[number];

/** Track B label. Offline analyst judgement, never invented by the live loop. */
export const GAP_CLOSURE_LABELS = ["closed", "not_closed", "unknown"] as const;
export type GapClosure = (typeof GAP_CLOSURE_LABELS)[number];

export type DisagreementLabelRecord = {
  kind: "disagreement";
  /** `${sessionId}:${scopeId}` */
  scopeKey: string;
  /** sha256 of the objective text the operator saw — pins the card that was judged. */
  objectiveHash: string;
  /** Candidate ids in the order they were shown, as slot A and slot B. */
  order: [string, string];
  labels: { a: AppropriatenessLabel; b: AppropriatenessLabel };
  labelledAt: string;
};

export type GapClosureLabelRecord = {
  kind: "gap-closure";
  scopeKey: string;
  /** Detected requirement classes at labelling time (context, not a verdict). */
  detectedRequirements: string[];
  gapClosure: GapClosure;
  labelledAt: string;
};

export type ToolSelectionLabelRecord = DisagreementLabelRecord | GapClosureLabelRecord;

export function objectiveHash(objective: string): string {
  return `sha256:${createHash("sha256").update(objective, "utf8").digest("hex")}`;
}

/**
 * Deterministic rotation for a scope's A/B slots, derived from the scope key.
 * Deterministic so the card is reproducible and provably not operator-chosen;
 * the point of A/B is that the operator cannot tell which side is which.
 */
export function blindOrder(scopeKey: string, candidates: readonly [string, string]): [string, string] {
  const digest = createHash("sha256").update(scopeKey, "utf8").digest();
  return (digest[0] ?? 0) % 2 === 0 ? [candidates[0], candidates[1]] : [candidates[1], candidates[0]];
}

export type LabellingCardSlot = {
  slot: "A" | "B";
  candidateId: string;
  label: string;
  description?: string;
  reasons?: string[];
};

export type BlindLabellingCard = {
  scopeKey: string;
  objective: string;
  slots: [LabellingCardSlot, LabellingCardSlot];
};

/** Field names a blind card may carry. Provenance is deliberately absent. */
export const CARD_SLOT_KEYS = ["candidateId", "description", "label", "reasons", "slot"] as const;
export const CARD_KEYS = ["objective", "scopeKey", "slots"] as const;

/**
 * Build the card for an operator, WITHOUT saying which candidate came from the
 * model and which from the alternative. The caller supplies exactly two
 * candidate ids; their order is the `blindOrder` rotation, never a choice.
 */
export function buildBlindLabellingCard(input: {
  scopeKey: string;
  objective: string;
  scope: ToolSelectionScope;
  candidates: [string, string];
}): BlindLabellingCard {
  const [a, b] = blindOrder(input.scopeKey, input.candidates);
  const slot = (candidateId: string, slotName: "A" | "B"): LabellingCardSlot => {
    const candidate = candidateFor(input.scope, candidateId);
    const requirement = input.scope.requirementCandidates.find(entry => entry.candidateId === candidateId);
    return {
      slot: slotName,
      candidateId,
      label: candidate?.label ?? candidateId,
      ...(candidate?.description ? { description: candidate.description } : {}),
      ...(requirement && requirement.reasons.length > 0 ? { reasons: [...requirement.reasons] } : {}),
    };
  };
  return {
    scopeKey: input.scopeKey,
    objective: input.objective,
    slots: [slot(a, "A"), slot(b, "B")],
  };
}

function requireLabel<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) return value as T;
  throw new Error(`${field} must be one of ${allowed.join(" | ")}, got ${JSON.stringify(value)}`);
}

/** Strict validation for a stored label line. Unknown shapes are rejected. */
export function parseLabelRecord(value: unknown): ToolSelectionLabelRecord {
  if (!value || typeof value !== "object") throw new Error("label record must be an object");
  const record = value as Record<string, unknown>;
  const scopeKey = record.scopeKey;
  if (typeof scopeKey !== "string" || scopeKey.length === 0) throw new Error("label record needs a scopeKey");
  const labelledAt = record.labelledAt;
  if (typeof labelledAt !== "string" || labelledAt.length === 0) throw new Error("label record needs labelledAt");

  if (record.kind === "disagreement") {
    const order = record.order;
    if (!Array.isArray(order) || order.length !== 2 || order.some(entry => typeof entry !== "string")) {
      throw new Error("disagreement label needs a two-candidate order");
    }
    const objective = record.objectiveHash;
    if (typeof objective !== "string" || !objective.startsWith("sha256:")) {
      throw new Error("disagreement label needs the objective hash it was judged against");
    }
    const labels = record.labels as { a?: unknown; b?: unknown } | undefined;
    if (!labels) throw new Error("disagreement label needs both slot labels");
    return {
      kind: "disagreement",
      scopeKey,
      objectiveHash: objective,
      order: [order[0] as string, order[1] as string],
      labels: {
        a: requireLabel(labels.a, APPROPRIATENESS_LABELS, "labels.a"),
        b: requireLabel(labels.b, APPROPRIATENESS_LABELS, "labels.b"),
      },
      labelledAt,
    };
  }

  if (record.kind === "gap-closure") {
    const detected = record.detectedRequirements;
    if (!Array.isArray(detected) || detected.some(entry => typeof entry !== "string")) {
      throw new Error("gap-closure label needs detectedRequirements (may be empty)");
    }
    return {
      kind: "gap-closure",
      scopeKey,
      detectedRequirements: [...(detected as string[])],
      gapClosure: requireLabel(record.gapClosure, GAP_CLOSURE_LABELS, "gapClosure"),
      labelledAt,
    };
  }

  throw new Error(`unknown label record kind: ${String(record.kind)}`);
}

export type CorpusRow = {
  sessionId: string;
  scopeId: string;
  eligibility: EvaluationEligibility;
  objective: string;
  actual: { candidateId: string | null; outcome?: { execution: string; selection: string; evidence: string } };
  offered: string[];
  requirementCandidates: Array<{ candidateId: string; reasons: string[] }>;
  domains: { builtin: number; mcp: number };
  scoperRanking: string[];
  alternative?: { selectorId: string; ranking: string[]; candidateSetPreserved: boolean; invalidReason?: string };
  /**
   * Offline scorer economics for this scope. A failure aborts the attempt on the
   * first bad candidate, so `attemptedCandidates`/`failedCandidates` (from the
   * replay) say how far it got; `calls` counts the answers that came back.
   */
  scoring?: {
    calls: number;
    latencyMs: number[];
    scorerOutcome: "complete" | "failed";
    /** Calls the attempt made, and how many of them failed before it stopped. */
    attemptedCandidates?: number;
    failedCandidates?: number;
  };
};

/**
 * The four statuses T3-d records per scope. `traceComplete` and
 * `candidateSetPreserved` are facts about the run; the two comparison flags say
 * whether the row may be used in that comparison. An observed model choice stays
 * a trace fact even when the comparison is ineligible — that is why the first
 * field is separate rather than implied by the last two.
 */
export type EvaluationStatus = {
  traceComplete: boolean;
  candidateSetPreserved: boolean;
  selectionComparisonEligible: boolean;
  outcomeComparisonEligible: boolean;
};

export function comparisonStatusOf(row: CorpusRow): EvaluationStatus {
  return {
    traceComplete: Boolean(row.actual.candidateId),
    candidateSetPreserved: row.alternative?.candidateSetPreserved === true,
    selectionComparisonEligible: row.eligibility.selection === "eligible",
    outcomeComparisonEligible: row.eligibility.outcome === "eligible",
  };
}

export type LabelledDisagreement = {
  scopeKey: string;
  actual: AppropriatenessLabel;
  alternative: AppropriatenessLabel;
};

/**
 * Map a stored disagreement record onto the row's actual/alternative sides.
 * Returns undefined when the record's order does not match the row (a stale or
 * mismatched card) — such a label is ignored rather than guessed at.
 */
export function resolveDisagreementLabels(
  row: CorpusRow,
  record: DisagreementLabelRecord,
): LabelledDisagreement | undefined {
  const actualId = row.actual.candidateId;
  const alternativeId = row.alternative?.ranking[0];
  if (!actualId || !alternativeId || actualId === alternativeId) return undefined;
  const [a, b] = record.order;
  if (a === actualId && b === alternativeId) {
    return { scopeKey: record.scopeKey, actual: record.labels.a, alternative: record.labels.b };
  }
  if (a === alternativeId && b === actualId) {
    return { scopeKey: record.scopeKey, actual: record.labels.b, alternative: record.labels.a };
  }
  return undefined;
}

/** Checkpoint for the FIRST evaluation, not a promotion threshold. */
export const T3_CHECKPOINT = { eligibleScopes: 30, labelledDisagreements: 10 } as const;

export type CorpusSummary = {
  /** Scopes the run attempted, before any eligibility filtering. */
  attemptedScopes: number;
  scopes: number;
  eligibility: {
    selectionEligible: number;
    outcomeEligible: number;
    byReason: Record<string, number>;
    diagnostics: Record<string, number>;
  };
  /** The four T3-d statuses, counted. */
  status: {
    traceComplete: number;
    candidateSetPreserved: number;
    selectionComparisonEligible: number;
    outcomeComparisonEligible: number;
  };
  /** How often the alternative produced a complete, preserved ordering. */
  preservation: { attempted: number; preserved: number; rate: number | null };
  /**
   * The Jev scorer's completion behaviour, which is experiment data: a selector
   * with good judgements that frequently cannot finish a 20-25 candidate scope is
   * still unsuitable for T4.
   */
  jevCompletion: {
    attempts: number;
    fullScopeSuccess: number;
    fullScopeSuccessRate: number | null;
    candidateCalls: number;
    candidateFailures: number;
    candidateFailureRate: number | null;
  };
  agreement: { comparable: number; agree: number; disagree: number; rate: number | null };
  labelledDisagreements: {
    labelled: number;
    unlabelled: number;
    bothAppropriate: number;
    actualOnlyAppropriate: number;
    alternativeOnlyAppropriate: number;
    neitherAppropriate: number;
    unclear: number;
    unmatched: number;
  };
  outcomeDimensions: {
    execution: Record<string, number>;
    selection: Record<string, number>;
    evidence: Record<string, number>;
  };
  gapClosure: Record<string, number>;
  scoring: {
    scopesWithScoring: number;
    calls: number;
    totalLatencyMs: number;
    medianCandidateLatencyMs: number | null;
    p95CandidateLatencyMs: number | null;
    medianScopeLatencyMs: number | null;
    p95ScopeLatencyMs: number | null;
    scopesWithScorerFailure: number;
  };
  requirementContext: {
    scopesWithRequirementCandidates: number;
    byRequirementClass: Record<string, number>;
    /** The trace carries no task category today; recorded, not invented. */
    taskCategory: "not-recorded";
  };
  prerequisites: { requiredEligibleScopes: number; requiredLabelledDisagreements: number; met: boolean; missing: string[] };
};

function percentile(sorted: number[], fraction: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index] ?? null;
}

/** Ratio as a fraction, or null when there is nothing to divide by. */
function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

/**
 * Summarise a corpus and its labels. Facts only: counts, rates, latency and
 * prerequisite status. It never ranks selectors and never declares a winner —
 * that judgement is T3-f, made by the operator against this summary.
 */
export function summarizeCorpus(input: {
  rows: ReadonlyArray<CorpusRow>;
  labels: ReadonlyArray<ToolSelectionLabelRecord>;
}): CorpusSummary {
  const byReason: Record<string, number> = {};
  const byDiagnostic: Record<string, number> = {};
  for (const row of input.rows) {
    if (row.eligibility.reason) byReason[row.eligibility.reason] = (byReason[row.eligibility.reason] ?? 0) + 1;
    for (const code of row.eligibility.diagnostics) byDiagnostic[code] = (byDiagnostic[code] ?? 0) + 1;
  }

  const selectionEligibleRows = input.rows.filter(row => row.eligibility.selection === "eligible");
  const statuses = input.rows.map(comparisonStatusOf);
  const countStatus = (pick: (status: EvaluationStatus) => boolean): number =>
    statuses.filter(pick).length;
  const disagreementRecords = input.labels.filter(
    (record): record is DisagreementLabelRecord => record.kind === "disagreement",
  );
  const gapRecords = input.labels.filter(
    (record): record is GapClosureLabelRecord => record.kind === "gap-closure",
  );

  let agree = 0;
  let disagree = 0;
  const disagreements: Array<{ row: CorpusRow; actualId: string; alternativeId: string }> = [];
  for (const row of selectionEligibleRows) {
    const alternativeId = row.alternative?.ranking[0];
    const actualId = row.actual.candidateId;
    if (!alternativeId || !actualId) continue;
    if (alternativeId === actualId) agree += 1;
    else {
      disagree += 1;
      disagreements.push({ row, actualId, alternativeId });
    }
  }

  const counts = {
    labelled: 0,
    unlabelled: 0,
    bothAppropriate: 0,
    actualOnlyAppropriate: 0,
    alternativeOnlyAppropriate: 0,
    neitherAppropriate: 0,
    unclear: 0,
    unmatched: 0,
  };
  for (const { row } of disagreements) {
    const scopeKey = `${row.sessionId}:${row.scopeId}`;
    const record = disagreementRecords.find(entry => entry.scopeKey === scopeKey);
    if (!record) {
      counts.unlabelled += 1;
      continue;
    }
    const resolved = resolveDisagreementLabels(row, record);
    if (!resolved) {
      counts.unmatched += 1;
      counts.unlabelled += 1;
      continue;
    }
    counts.labelled += 1;
    if (resolved.actual === "unclear" || resolved.alternative === "unclear") counts.unclear += 1;
    else if (resolved.actual === "appropriate" && resolved.alternative === "appropriate") counts.bothAppropriate += 1;
    else if (resolved.actual === "appropriate") counts.actualOnlyAppropriate += 1;
    else if (resolved.alternative === "appropriate") counts.alternativeOnlyAppropriate += 1;
    else counts.neitherAppropriate += 1;
  }

  const execution: Record<string, number> = {};
  const selection: Record<string, number> = {};
  const evidence: Record<string, number> = {};
  for (const row of input.rows) {
    if (row.eligibility.outcome !== "eligible") continue;
    const outcome = row.actual.outcome;
    if (!outcome) continue;
    execution[outcome.execution] = (execution[outcome.execution] ?? 0) + 1;
    selection[outcome.selection] = (selection[outcome.selection] ?? 0) + 1;
    evidence[outcome.evidence] = (evidence[outcome.evidence] ?? 0) + 1;
  }

  const gapClosure: Record<string, number> = {};
  for (const record of gapRecords) {
    gapClosure[record.gapClosure] = (gapClosure[record.gapClosure] ?? 0) + 1;
  }

  const latencies: number[] = [];
  const scopeLatencies: number[] = [];
  let calls = 0;
  let totalLatencyMs = 0;
  let scopesWithScorerFailure = 0;
  let scopesWithScoring = 0;
  let fullScopeSuccess = 0;
  let candidateCalls = 0;
  let candidateFailures = 0;
  for (const row of input.rows) {
    if (!row.scoring) continue;
    scopesWithScoring += 1;
    calls += row.scoring.calls;
    if (row.scoring.scorerOutcome === "failed") scopesWithScorerFailure += 1;
    else fullScopeSuccess += 1;
    candidateCalls += row.scoring.attemptedCandidates ?? row.scoring.calls;
    candidateFailures += row.scoring.failedCandidates ?? 0;
    let scopeTotal = 0;
    for (const latency of row.scoring.latencyMs) {
      latencies.push(latency);
      totalLatencyMs += latency;
      scopeTotal += latency;
    }
    scopeLatencies.push(scopeTotal);
  }
  latencies.sort((a, b) => a - b);
  scopeLatencies.sort((a, b) => a - b);

  const preservationAttempts = input.rows.filter(row => row.alternative !== undefined).length;
  const preservationSucceeded = input.rows.filter(row => row.alternative?.candidateSetPreserved === true).length;

  const byRequirementClass: Record<string, number> = {};
  let scopesWithRequirementCandidates = 0;
  for (const row of input.rows) {
    if (row.requirementCandidates.length > 0) scopesWithRequirementCandidates += 1;
    for (const entry of row.requirementCandidates) {
      for (const reason of entry.reasons) {
        byRequirementClass[reason] = (byRequirementClass[reason] ?? 0) + 1;
      }
    }
  }

  const missing: string[] = [];
  const eligibleScopes = selectionEligibleRows.length;
  if (eligibleScopes < T3_CHECKPOINT.eligibleScopes) {
    missing.push(`eligible scopes ${eligibleScopes}/${T3_CHECKPOINT.eligibleScopes}`);
  }
  if (counts.labelled < T3_CHECKPOINT.labelledDisagreements) {
    missing.push(`labelled disagreements ${counts.labelled}/${T3_CHECKPOINT.labelledDisagreements}`);
  }

  return {
    attemptedScopes: input.rows.length,
    scopes: input.rows.length,
    eligibility: {
      selectionEligible: eligibleScopes,
      outcomeEligible: input.rows.filter(row => row.eligibility.outcome === "eligible").length,
      byReason,
      diagnostics: byDiagnostic,
    },
    status: {
      traceComplete: countStatus(status => status.traceComplete),
      candidateSetPreserved: countStatus(status => status.candidateSetPreserved),
      selectionComparisonEligible: countStatus(status => status.selectionComparisonEligible),
      outcomeComparisonEligible: countStatus(status => status.outcomeComparisonEligible),
    },
    preservation: {
      attempted: preservationAttempts,
      preserved: preservationSucceeded,
      rate: rate(preservationSucceeded, preservationAttempts),
    },
    jevCompletion: {
      attempts: scopesWithScoring,
      fullScopeSuccess,
      fullScopeSuccessRate: rate(fullScopeSuccess, scopesWithScoring),
      candidateCalls,
      candidateFailures,
      candidateFailureRate: rate(candidateFailures, candidateCalls),
    },
    agreement: { comparable: agree + disagree, agree, disagree, rate: rate(agree, agree + disagree) },
    labelledDisagreements: counts,
    outcomeDimensions: { execution, selection, evidence },
    gapClosure,
    scoring: {
      scopesWithScoring,
      calls,
      totalLatencyMs,
      medianCandidateLatencyMs: percentile(latencies, 0.5),
      p95CandidateLatencyMs: percentile(latencies, 0.95),
      medianScopeLatencyMs: percentile(scopeLatencies, 0.5),
      p95ScopeLatencyMs: percentile(scopeLatencies, 0.95),
      scopesWithScorerFailure,
    },
    requirementContext: { scopesWithRequirementCandidates, byRequirementClass, taskCategory: "not-recorded" },
    prerequisites: {
      requiredEligibleScopes: T3_CHECKPOINT.eligibleScopes,
      requiredLabelledDisagreements: T3_CHECKPOINT.labelledDisagreements,
      met: missing.length === 0,
      missing,
    },
  };
}
