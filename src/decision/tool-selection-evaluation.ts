/**
 * tool-selection-evaluation.ts — T2-d: compare selections without inventing
 * counterfactual outcomes.
 *
 * The recorded trace tells us what happened to the tool that actually ran. It
 * cannot tell us what would have happened had a different tool run. So a
 * selection evaluation is one of exactly three things:
 *
 *   observed  — the tool ran, and we have its recorded outcome
 *   replayed  — the alternative was honestly re-run by a supplied runner
 *   unknown   — neither, with the reason recorded
 *
 * No selector receives a quality label from a counterfactual that was never
 * observed, replayed, or operator-labelled. This module produces comparison
 * data only; it never ranks selectors.
 */

import type {
  EvidenceContribution,
  ExecutionOutcome,
  SelectionOutcome,
} from "./selection-outcome.js";
import type { ToolSelectionDomain, ToolSelectionScope } from "./tool-selection-replay.js";
import { bindingForCandidate, candidateFor } from "./tool-selection-replay.js";

/** The three recorded dimensions, deliberately never collapsed into one. */
export type SelectionOutcomeRecord = {
  execution: ExecutionOutcome;
  selection: SelectionOutcome;
  evidence: EvidenceContribution;
};

export type SelectionEvaluation =
  | { basis: "observed"; candidateId: string; label?: string; domain: ToolSelectionDomain; outcome: SelectionOutcomeRecord }
  | { basis: "replayed"; candidateId: string; label?: string; domain: ToolSelectionDomain; outcome: SelectionOutcomeRecord; replayId: string }
  | { basis: "unknown"; candidateId: string; label?: string; domain: ToolSelectionDomain; reason: string };

/** How an alternative tool could be evaluated honestly, if at all. */
export type ToolReplayability = "hermetic" | "mutating" | "external";

const HERMETIC = new Set([
  "alix_file_read",
  "alix_file_exists",
  "alix_grep_search",
  "alix_glob_match",
  "alix_state_query",
  "alix_verify_claim",
  "alix_coordination_status",
  "alix_coordination_list",
  "alix_coordination_results",
  "alix_mcp_search_tools",
  "alix_collaboration_query_findings",
  "alix_collaboration_get_dependency_results",
  "alix_collaboration_list_conflicts",
]);

const MUTATING = new Set([
  "alix_file_create",
  "alix_file_delete",
  "alix_patch_apply",
  "alix_schedule_propose",
  "alix_delegate",
  "alix_coordination_run",
  "alix_create_hook",
  "alix_create_skill",
  "alix_execution_state_propose",
  "alix_collaboration_publish_finding",
  "alix_collaboration_publish_artifact",
  "alix_collaboration_report_conflict",
  // Arbitrary side effects. Classified with mutating because the isolation
  // requirement (snapshot workspace) is what makes any replay honest; a shell
  // command may additionally reach the network, so a fixture is required too.
  "alix_shell_run",
]);

/**
 * Replayability class of a tool. `external` covers tools whose effects leave
 * the machine (network or a remote MCP server): only fixtures or recorded
 * responses can evaluate them, otherwise the alternative stays `unknown`.
 */
export function replayabilityOf(tool: string): ToolReplayability {
  if (MUTATING.has(tool)) return "mutating";
  if (HERMETIC.has(tool)) return "hermetic";
  // Unknown tools are never assumed harmless.
  return "external";
}

/**
 * Replayability of a frozen candidate. Identity is the candidate id; the local
 * binding (never projected) is what resolves executable machinery, and an MCP
 * candidate stays `external` because its effects leave the machine.
 */
export function replayabilityOfCandidate(
  scope: ToolSelectionScope,
  candidateId: string,
): ToolReplayability {
  if (candidateFor(scope, candidateId)?.domain === "mcp") return "external";
  const binding = bindingForCandidate(scope, candidateId);
  return replayabilityOf(binding?.modelName ?? candidateFor(scope, candidateId)?.tool ?? candidateId);
}

export type CounterfactualReplayRunner = (request: {
  scopeId: string;
  candidateId: string;
  domain: ToolSelectionDomain;
}) => Promise<{ outcome: SelectionOutcomeRecord; replayId: string } | { error: string }>;

export type ToolSelectionComparison = {
  scopeId: string;
  actual: SelectionEvaluation;
  /**
   * Top of the recorded scoper ordering. Named for what it is: a relevance
   * ordering, not a selector's next-tool preference.
   */
  scoperTop: SelectionEvaluation;
  selectorTop?: SelectionEvaluation;
  selectorId?: string;
  /** Factual observations only — never a verdict about which selector is better. */
  notes: string[];
};

function observedOrUnknown(
  scope: ToolSelectionScope,
  candidateId: string,
  outcome: SelectionOutcomeRecord | undefined,
  reasonForMissing: string,
): SelectionEvaluation {
  const candidate = candidateFor(scope, candidateId);
  const domain = candidate?.domain ?? "builtin";
  const label = candidate?.label;
  return outcome
    ? { basis: "observed", candidateId, ...(label ? { label } : {}), domain, outcome }
    : { basis: "unknown", candidateId, ...(label ? { label } : {}), domain, reason: reasonForMissing };
}

async function evaluateAlternative(input: {
  scope: ToolSelectionScope;
  candidateId: string;
  actualCandidateId: string | undefined;
  actualOutcome: SelectionOutcomeRecord | undefined;
  replay?: CounterfactualReplayRunner;
}): Promise<SelectionEvaluation> {
  const candidate = candidateFor(input.scope, input.candidateId);
  const domain = candidate?.domain ?? "builtin";
  const label = candidate?.label;
  // Same candidate the model ran: its recorded outcome IS the observation, no
  // counterfactual is involved at all.
  if (input.candidateId === input.actualCandidateId) {
    return observedOrUnknown(
      input.scope,
      input.candidateId,
      input.actualOutcome,
      "no recorded outcome for the executed choice",
    );
  }
  const replayability = replayabilityOfCandidate(input.scope, input.candidateId);
  if (replayability !== "hermetic") {
    return {
      basis: "unknown",
      candidateId: input.candidateId,
      ...(label ? { label } : {}),
      domain,
      reason: replayability === "mutating"
        ? "mutating tool: replay requires an isolated snapshot"
        : "external tool: replay requires fixtures or recorded responses",
    };
  }
  if (!input.replay) {
    return { basis: "unknown", candidateId: input.candidateId, ...(label ? { label } : {}), domain, reason: "no replay runner supplied" };
  }
  const replayed = await input.replay({ scopeId: input.scope.scopeId, candidateId: input.candidateId, domain });
  if ("error" in replayed) {
    return { basis: "unknown", candidateId: input.candidateId, ...(label ? { label } : {}), domain, reason: `replay failed: ${replayed.error}` };
  }
  return { basis: "replayed", candidateId: input.candidateId, ...(label ? { label } : {}), domain, outcome: replayed.outcome, replayId: replayed.replayId };
}

/**
 * Join the recorded actual selection to its outcome and evaluate the top choice
 * of each alternative ordering. Alternatives resolve to `unknown` unless a
 * runner can honestly replay them.
 */
export async function evaluateToolSelection(input: {
  scope: ToolSelectionScope;
  /** Recorded outcome of the executed choice, when the trace has one. */
  actualOutcome?: SelectionOutcomeRecord;
  /** Alternative ordering from `replayToolSelection`. */
  selectorRanking?: string[];
  selectorId?: string;
  replay?: CounterfactualReplayRunner;
}): Promise<ToolSelectionComparison> {
  const actualCandidateId = input.scope.actualCandidateIds[0];
  const actual = actualCandidateId
    ? observedOrUnknown(input.scope, actualCandidateId, input.actualOutcome, "no recorded outcome for the executed choice")
    : { basis: "unknown" as const, candidateId: "(none)", domain: "builtin" as const, reason: "the scope recorded no executed choice" };

  const notes: string[] = [];
  if (actual.basis === "observed" && actual.outcome.evidence !== "contributed") {
    notes.push("actual selection: execution recorded without demonstrated evidence contribution");
  }

  // The recorded scoper ordering answers "how much does this tool's description
  // overlap the task text" — not "what should run next". It is reported as the
  // scoper's top, never as a selector baseline.
  const scoperTopCandidate = input.scope.scoperRanking[0]?.candidateId;
  const scoperTop = scoperTopCandidate
    ? await evaluateAlternative({
        scope: input.scope,
        candidateId: scoperTopCandidate,
        actualCandidateId,
        actualOutcome: input.actualOutcome,
        replay: input.replay,
      })
    : { basis: "unknown" as const, candidateId: "(none)", domain: "builtin" as const, reason: "scope recorded no scoper ranking" };

  const selectorTopCandidate = input.selectorRanking?.[0];
  const selectorTop = selectorTopCandidate
    ? await evaluateAlternative({
        scope: input.scope,
        candidateId: selectorTopCandidate,
        actualCandidateId,
        actualOutcome: input.actualOutcome,
        replay: input.replay,
      })
    : undefined;

  if (scoperTopCandidate && selectorTopCandidate && scoperTopCandidate === selectorTopCandidate) {
    notes.push(`scoper and ${input.selectorId ?? "selector"} orderings agree on ${selectorTopCandidate}`);
  } else if (scoperTopCandidate && selectorTopCandidate) {
    notes.push(`orderings differ: scoper top ${scoperTopCandidate} (relevance, not next-tool preference), ${input.selectorId ?? "selector"} top ${selectorTopCandidate}`);
  }
  if (scoperTop.basis === "unknown" || selectorTop?.basis === "unknown") {
    notes.push("at least one alternative remains unevaluated (counterfactual unknown)");
  }

  return {
    scopeId: input.scope.scopeId,
    actual,
    scoperTop,
    ...(selectorTop ? { selectorTop } : {}),
    ...(input.selectorId ? { selectorId: input.selectorId } : {}),
    notes,
  };
}

/** Map a recorded `tool.selection.observed` payload to the outcome record. */
export function selectionOutcomeFromObservation(payload: {
  execution?: { status?: string };
  selection?: { outcome?: string };
  evidence?: { contribution?: string };
}): SelectionOutcomeRecord | undefined {
  const execution = payload.execution?.status;
  const selection = payload.selection?.outcome;
  const evidence = payload.evidence?.contribution;
  if (!execution || !selection || !evidence) return undefined;
  if (!["success", "repaired", "failed"].includes(execution)) return undefined;
  if (!["novel", "redundant"].includes(selection)) return undefined;
  if (!["contributed", "none", "unknown"].includes(evidence)) return undefined;
  return {
    execution: execution as ExecutionOutcome,
    selection: selection as SelectionOutcome,
    evidence: evidence as EvidenceContribution,
  };
}
