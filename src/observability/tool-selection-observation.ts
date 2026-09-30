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
// Type-only, so the emitted JS carries no runtime edge from the neutral seam
// into `src/decision` — the layering constraint F4 records for this module.
// These are the SAME types, not copies: the decision layer owns the vocabulary
// and both the task loop and the offline experiment read it from there.
import type {
  EvidenceContribution,
  ExecutionOutcome,
  SelectionOutcome,
} from "../decision/selection-outcome.js";
import type { ToolSelectionDomain as CandidateDomain } from "../decision/tool-selection-candidates.js";

export type { EvidenceContribution, ExecutionOutcome, SelectionOutcome } from "../decision/selection-outcome.js";
export type { ToolSelectionDomain as CandidateDomain } from "../decision/tool-selection-candidates.js";

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

/**
 * Scoping provenance keyed by FROZEN CANDIDATE ID, which is what an observation
 * records. Distinct from `config/tool-scoping.ts`'s `ScopingProvenance`, which
 * is keyed by tool NAME because the scoper runs before the surface is frozen;
 * `run/task-loop/main.ts` translates between them. The two were previously
 * declared under one name with incompatible element types, so a reader who
 * imported either silently assumed the other. This is the id-keyed shape.
 */
export type FrozenScopingProvenance = {
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

/**
 * An already-frozen surface handed down to a path that will let the model
 * choose: identity, the exact candidates offered, and their local bindings.
 * The receiving layer adds only its own facts (the choice and its outcome).
 */
export type FrozenToolSelectionContext = {
  scopeId: string;
  iteration: number;
  candidates: readonly FrozenCandidateDescriptor[];
  candidateBindings?: readonly CandidateBindingDescriptor[];
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
  scoping: FrozenScopingProvenance;
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
  scoping?: FrozenScopingProvenance;
  ranking?: SelectionRanking;
  invalidSelection?: { toolName: string; reason: string };
};

export type ToolSelectionNotApplicable = {
  type: "tool.selection.not_applicable";
  scopeId: string;
  iteration: number;
  route: "grounded" | "task-loop";
  reason: "no_tool_call" | "no_tools_offered" | "non_selection_turn";
};

export type SelectionNotApplicableInput = Omit<ToolSelectionNotApplicable, "type">;

/**
 * An MCP `chosen` is the opaque `mcp__<handle>` the model emitted. F4 requires
 * that a raw handle never reaches a frozen scope or a Jev projection, so it is
 * masked to the candidate id here — the same id space every other field uses.
 * The handle itself stays reachable through the LOCAL-ONLY `candidateBindings`.
 * Builtin names are already meaningful and carry no secret, so they pass
 * through unchanged (the grounded route relies on this: its `chosen` is the
 * provider-facing name it normalised to).
 */
function maskChosen(chosen: string, chosenCandidateId: string, candidates: readonly FrozenCandidateDescriptor[]): string {
  const domain = candidates.find(candidate => candidate.candidateId === chosenCandidateId)?.domain;
  return domain === "mcp" ? chosenCandidateId : chosen;
}

/**
 * A name that is NOT among the offered candidates is judged by its own shape:
 * an `mcp__` prefix is the handle form by construction, and such a call is
 * invalid by definition so it can never be found in `candidates` to classify it.
 * Returns the masked form for a handle, otherwise the name unchanged.
 */
function maskUnofferedToolName(toolName: string): string {
  return toolName.startsWith("mcp__") ? `mcp:unregistered(${toolName.length})` : toolName;
}

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
    chosen: maskChosen(input.chosen, input.chosenCandidateId, input.candidates),
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
    ...(input.invalidSelection
      ? {
          invalidSelection: {
            toolName: maskUnofferedToolName(input.invalidSelection.toolName),
            reason: input.invalidSelection.reason,
          },
        }
      : {}),
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

export async function emitSelectionNotApplicable(
  log: EventLog,
  session: { sessionId: string; actor: "system" },
  input: SelectionNotApplicableInput,
): Promise<ToolSelectionNotApplicable> {
  const record: ToolSelectionNotApplicable = {
    type: "tool.selection.not_applicable",
    ...input,
  };
  await log.append({
    ...session,
    actor: "system",
    type: TOOL_EVENT_TYPES.SELECTION_NOT_APPLICABLE,
    payload: record,
  });
  return record;
}
