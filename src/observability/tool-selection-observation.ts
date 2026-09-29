/**
 * tool-selection-observation.ts — the neutral observation DTO, its assembly,
 * and its emitter.
 *
 * Boundary: this module owns the *structural* machine only — the payload shape,
 * the pure assembly from supplied facts, and appending the event. It must not
 * decide what the candidate surface should contain.
 *
 * | Layer | Owns |
 * |---|---|
 * | `src/decision` | candidate semantics, freezer, experiment/replay logic, Jev scoring |
 * | this module | DTO, `buildSelectionObservation`, `emitSelectionObservation` |
 * | agent / runtime / daemon | the actual provider choice, execution facts, passing already-frozen candidates |
 * | `src/run/task-loop` | normal-path freezing, requirement derivation, scoping, ranking |
 *
 * That split is why this module exists: the grounded external path makes a real
 * model choice among the tools it passes to `provider.complete(...)`, but its
 * dispatcher lives in `src/agent` / `src/daemon`, which never import
 * `src/decision/`. Both paths share this assembly instead of growing a second
 * interpretation of what a selection observation means.
 */

import type { EventLog } from "../events/event-log.js";
import { TOOL_EVENT_TYPES } from "../events/types.js";

export type CandidateDomain = "builtin" | "mcp";

/** Structural descriptor of a candidate the model was offered. */
export type FrozenCandidateDescriptor = {
  candidateId: string;
  domain: CandidateDomain;
  label: string;
  /**
   * Required, mirroring the frozen candidate contract the decision layer
   * already uses: a candidate without a description cannot be projected to a
   * remote scorer, so the shape forbids it rather than silently dropping it.
   */
  description: string;
};

/** A requirement a candidate could close, keyed by frozen candidate id. */
export type RequirementCandidateRef = { candidateId: string; reasons: string[] };

/**
 * LOCAL-ONLY resolution of a candidate to executable machinery. Never part of
 * a remote projection; carried so a reader can map an id back to a tool name.
 */
export type CandidateBindingDescriptor = {
  candidateId: string;
  domain: CandidateDomain;
  modelName: string;
  executorName?: string;
};

export type ExecutionOutcome = "success" | "repaired" | "failed";
export type EvidenceContribution = "contributed" | "none" | "unknown";
export type SelectionOutcome = "novel" | "redundant";

export type ScopingProvenance = {
  admitted: RequirementCandidateRef[];
  fallbackFull: boolean;
  /** Debug-only: exclusions can explode, so they are opt-in. */
  excluded?: RequirementCandidateRef[];
};

export type SelectionRanking = {
  scoper: Array<{ candidateId: string; score: number }>;
  /** A different scale from `scoper`; deliberately never interleaved with it. */
  mcpSelector?: Array<{ candidateId: string; score: number }>;
};

export type SelectionObservation = {
  scopeId: string;
  iteration: number;
  invocationId?: string;
  /** The exact surface offered to the model, as frozen. */
  candidates: FrozenCandidateDescriptor[];
  offered: string[];
  /** LOCAL ONLY: model-facing bindings, never part of a remote projection. */
  candidateBindings?: CandidateBindingDescriptor[];
  chosen: string;
  chosenCandidateId: string;
  executor: string;
  argsSignature: string;
  selection: { outcome: SelectionOutcome; repeatCount: number };
  execution: { status: ExecutionOutcome };
  evidence: { contribution: EvidenceContribution };
  requirementCandidates: RequirementCandidateRef[];
  scoping: ScopingProvenance;
  ranking?: SelectionRanking;
  /**
   * Set when the chosen tool could not be resolved against the frozen surface.
   * Recorded as a fact; no candidate is ever manufactured after the choice.
   */
  invalidSelection?: { toolName: string; reason: string };
};

export type SelectionObservationInput = {
  scopeId: string;
  iteration: number;
  invocationId?: string;
  /** The exact surface passed to the provider, in order. */
  candidates: readonly FrozenCandidateDescriptor[];
  candidateBindings?: readonly CandidateBindingDescriptor[];
  chosen: string;
  chosenCandidateId: string;
  executor: string;
  argsSignature: string;
  seenSignatures: Map<string, number>;
  executorSuccess: boolean;
  repaired?: boolean;
  /** Provable no-op: the call succeeded without doing or reporting anything. */
  noOp?: boolean;
  /** The result carried content (any rendered body). */
  hasContent?: boolean;
  requirementCandidates?: readonly RequirementCandidateRef[];
  scoping?: ScopingProvenance;
  ranking?: SelectionRanking;
  invalidSelection?: { toolName: string; reason: string };
};

/**
 * Assemble one observation from supplied facts. Pure apart from the
 * repeat-signature counter the caller owns.
 */
export function buildSelectionObservation(input: SelectionObservationInput): SelectionObservation {
  const repeatCount = (input.seenSignatures.get(input.argsSignature) ?? 0) + 1;
  input.seenSignatures.set(input.argsSignature, repeatCount);
  const repaired = input.repaired === true;
  const status: ExecutionOutcome = !input.executorSuccess ? "failed" : repaired ? "repaired" : "success";
  const contribution: EvidenceContribution = !input.executorSuccess || input.noOp === true
    ? "none"
    : input.hasContent === true
      ? "contributed"
      : "unknown";
  return {
    scopeId: input.scopeId,
    iteration: input.iteration,
    ...(input.invocationId ? { invocationId: input.invocationId } : {}),
    candidates: [...input.candidates],
    offered: input.candidates.map(candidate => candidate.candidateId),
    ...(input.candidateBindings ? { candidateBindings: [...input.candidateBindings] } : {}),
    chosen: input.chosen,
    chosenCandidateId: input.chosenCandidateId,
    executor: input.executor,
    argsSignature: input.argsSignature,
    selection: { outcome: repeatCount > 1 ? "redundant" : "novel", repeatCount },
    execution: { status },
    evidence: { contribution },
    requirementCandidates: (input.requirementCandidates ?? []).map(entry => ({
      candidateId: entry.candidateId,
      reasons: [...entry.reasons],
    })),
    scoping: {
      admitted: (input.scoping?.admitted ?? []).map(entry => ({
        candidateId: entry.candidateId,
        reasons: [...entry.reasons],
      })),
      fallbackFull: input.scoping?.fallbackFull ?? false,
      ...(input.scoping?.excluded ? { excluded: input.scoping.excluded.map(e => ({ ...e, reasons: [...e.reasons] })) } : {}),
    },
    ...(input.ranking ? { ranking: input.ranking } : {}),
    ...(input.invalidSelection ? { invalidSelection: input.invalidSelection } : {}),
  };
}

/**
 * Append the observation. The single emitter both the task loop and the
 * grounded external path call, so the two can never describe a selection
 * differently.
 */
export async function emitSelectionObservation(
  log: EventLog,
  session: { sessionId: string; actor: "system" },
  input: SelectionObservationInput,
): Promise<SelectionObservation> {
  const observation = buildSelectionObservation(input);
  await log.append({
    ...session,
    actor: "system",
    type: TOOL_EVENT_TYPES.SELECTION_OBSERVED,
    payload: observation,
  });
  return observation;
}
