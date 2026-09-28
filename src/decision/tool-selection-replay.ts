/**
 * tool-selection-replay.ts — T2-c: offline replay of a recorded tool-selection
 * scope against an additional selector.
 *
 * Replay-only by construction: nothing in the live loop imports this module, so
 * it cannot influence a turn. It scores the *recorded* candidate surface — the
 * scope frozen at runtime under `scopeId` — instead of re-deriving candidates
 * from later state, so a result always describes the choice problem that
 * actually existed.
 *
 * Contract (each rule is enforced, not merely documented):
 * - Selectors score ONE candidate at a time; ALiX sorts. A selector never sees
 *   the set, so it cannot drop, add, rename, or invent a candidate.
 * - The rebuilt set must equal the offered set exactly — not merely be a subset.
 *   A candidate the selector fails to score invalidates the attempt instead of
 *   yielding a partial ordering.
 * - Builtin and MCP candidates are ranked inside their own domain: their native
 *   scores live on different scales and are never merged into one ordering.
 */

import type { DecisionType } from "./contracts.js";
import { sealForRemote, type RemoteDecisionSubject } from "./boundary.js";
import { executeWithTimeout, type DecisionExecutor } from "./executors.js";
import { DEFAULT_REPLAY_TIMEOUT_MS } from "./replay/harness.js";
import {
  toolSelectionDomain,
  type FrozenToolCandidate,
  type LocalToolBinding,
  type ToolSelectionDomain,
} from "./tool-selection-candidates.js";

export { toolSelectionDomain, type ToolSelectionDomain } from "./tool-selection-candidates.js";

export type ToolSelectionScope = {
  scopeId: string;
  iteration: number;
  /** Sanitized frozen surface, in offered order. */
  candidates: FrozenToolCandidate[];
  /** Candidate ids of the frozen surface, in offered order. */
  offered: string[];
  requirementCandidates: Array<{ candidateId: string; reasons: string[] }>;
  /**
   * The scoper's relevance ordering recorded with the scope (native scores).
   * NOT a next-tool preference: it ranks how much a tool's description overlaps
   * the task text, so a selector comparison must not present it as the
   * deterministic selection baseline without saying which question it answers.
   */
  scoperRanking: Array<{ candidateId: string; score: number }>;
  /** Candidate ids the loop actually called on this surface, in order. */
  actualCandidateIds: string[];
  /** LOCAL ONLY: candidateId -> executable machinery. Never projected. */
  bindings?: LocalToolBinding[];
  /** Recorded scoping provenance for the frozen surface, when present. */
  scoping?: {
    admitted: Array<{ candidateId: string; reasons: string[] }>;
    fallbackFull: boolean;
    excluded?: Array<{ candidateId: string; reasons: string[] }>;
  };
};

export type ToolSelectionScoreRequest = {
  scopeId: string;
  iteration: number;
  candidateId: string;
  domain: ToolSelectionDomain;
  requirementCandidates: Array<{ candidateId: string; reasons: string[] }>;
};

/** The frozen descriptor behind a candidate id, when the scope carries one. */
export function candidateFor(
  scope: ToolSelectionScope,
  candidateId: string,
): FrozenToolCandidate | undefined {
  return scope.candidates.find(candidate => candidate.candidateId === candidateId);
}

/** LOCAL ONLY: resolve a candidate to its model-facing / executor name. */
export function bindingForCandidate(
  scope: ToolSelectionScope,
  candidateId: string,
): LocalToolBinding | undefined {
  const binding = scope.bindings?.find(entry => entry.candidateId === candidateId);
  if (binding) return binding;
  const candidate = candidateFor(scope, candidateId);
  return candidate?.tool !== undefined
    ? { candidateId, domain: candidate.domain, modelName: candidate.tool }
    : undefined;
}

export type ToolSelectionSelector = {
  id: string;
  /** True when the selector crosses a remote trust boundary (Jev). */
  remote?: boolean;
  /**
   * One candidate in, one ranking value out. The field is `rankValue`, not
   * `score`: a native engine outcome (a Noul probability, say) is being used as
   * a ranking value, and provenance records the outcome kind it came from.
   */
  rank(request: ToolSelectionScoreRequest): Promise<{ rankValue: number } | { error: string }>;
};

/**
 * Identity of a selector's subject. A runtime decision is a supported
 * `DecisionType`; an offline experiment is identified only by its experiment id
 * and never becomes one. This is the promotion boundary: using a decision
 * engine is not the same as becoming a supported decision surface.
 */
export type DecisionSubject =
  | { kind: "runtime"; decision: DecisionType }
  | { kind: "experiment"; experimentId: string };

export const TOOL_SELECTION_EXPERIMENT = "tool-selection-replay";

export function decisionSubjectString(subject: DecisionSubject): RemoteDecisionSubject {
  return subject.kind === "runtime" ? subject.decision : `experiment:${subject.experimentId}`;
}

export type ToolSelectionReplay = {
  scopeId: string;
  selectorId: string;
  actualCandidateId?: string;
  /** The recorded scoper ordering, in candidate ids (relevance, not preference). */
  scoperRanking: string[];
  selectorRanking: string[];
  candidateSetPreserved: boolean;
  invalidReason?: string;
  /**
   * Candidate calls this attempt made, and how many of them failed. A failure
   * stops the attempt (a partial ranking is never returned), so these are the
   * experiment's completion numbers rather than a measure of the selector's
   * per-candidate quality: a selector that cannot finish a 20-25 candidate
   * scope is unsuitable for T4 even when its few judgements look good.
   */
  attemptedCandidates: number;
  failedCandidates: number;
  domains: Array<{
    domain: ToolSelectionDomain;
    ranking: string[];
    candidateSetPreserved: boolean;
  }>;
};

async function rankWithTimeout(
  selector: ToolSelectionSelector,
  request: ToolSelectionScoreRequest,
  timeoutMs: number,
): Promise<{ rankValue: number } | { error: string }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      selector.rank(request),
      new Promise<{ error: string }>((resolve) => {
        timer = setTimeout(
          () => resolve({ error: `selector "${selector.id}" timed out after ${timeoutMs}ms` }),
          timeoutMs,
        );
      }),
    ]);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Replay one recorded scope. Returns the counterfactual ordering — never a
 * verdict about which selector is better; that judgement needs the execution
 * trace (T2-d).
 */
export async function replayToolSelection(
  scope: ToolSelectionScope,
  selector: ToolSelectionSelector,
  options: { timeoutMs?: number } = {},
): Promise<ToolSelectionReplay> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_REPLAY_TIMEOUT_MS;
  const domains: ToolSelectionReplay["domains"] = [];
  const invalidReasons: string[] = [];
  let attemptedCandidates = 0;
  let failedCandidates = 0;

  for (const domain of ["builtin", "mcp"] as const) {
    const candidates = scope.offered.filter(candidateId => {
      const candidate = candidateFor(scope, candidateId);
      return (candidate?.domain ?? toolSelectionDomain(candidateId)) === domain;
    });
    if (candidates.length === 0) continue;

    const scored: Array<{ candidateId: string; rankValue: number }> = [];
    let failure: string | undefined;
    for (const candidateId of candidates) {
      attemptedCandidates += 1;
      const outcome = await rankWithTimeout(
        selector,
        {
          scopeId: scope.scopeId,
          iteration: scope.iteration,
          candidateId,
          domain,
          requirementCandidates: scope.requirementCandidates,
        },
        timeoutMs,
      );
      if ("error" in outcome) {
        failedCandidates += 1;
        failure = `selector "${selector.id}" failed for ${candidateId}: ${outcome.error}`;
        break;
      }
      if (!Number.isFinite(outcome.rankValue)) {
        failedCandidates += 1;
        failure = `selector "${selector.id}" returned a non-finite ranking value for ${candidateId}`;
        break;
      }
      scored.push({ candidateId, rankValue: outcome.rankValue });
    }

    if (failure) {
      invalidReasons.push(failure);
      domains.push({ domain, ranking: [], candidateSetPreserved: false });
      continue;
    }

    // ALiX sorts: ranking value descending, ties in the offered order.
    const ranking = scored
      .map((entry, index) => ({ ...entry, index }))
      .sort((a, b) => (b.rankValue - a.rankValue) || (a.index - b.index))
      .map(({ candidateId }) => candidateId);

    // Exact set equality, verified rather than assumed: an adapter bug must not
    // produce a "replayed" ordering over a different population.
    const preserved = ranking.length === candidates.length
      && new Set(ranking).size === candidates.length
      && candidates.every(candidateId => ranking.includes(candidateId));
    if (!preserved) invalidReasons.push(`selector "${selector.id}" did not preserve the ${domain} candidate set`);
    domains.push({ domain, ranking, candidateSetPreserved: preserved });
  }

  // One failed candidate invalidates the whole attempt: a domain that answered
  // cleanly must not be returned as a usable ordering while its sibling is
  // missing candidates, or a partial ranking would be read as a complete one.
  const attemptValid = invalidReasons.length === 0 && domains.every(entry => entry.candidateSetPreserved);
  if (!attemptValid) {
    for (const entry of domains) {
      entry.ranking = [];
      entry.candidateSetPreserved = false;
    }
  }
  return {
    scopeId: scope.scopeId,
    selectorId: selector.id,
    ...(scope.actualCandidateIds[0] ? { actualCandidateId: scope.actualCandidateIds[0] } : {}),
    scoperRanking: scope.scoperRanking.map(entry => entry.candidateId),
    selectorRanking: attemptValid ? domains.flatMap(entry => entry.ranking) : [],
    candidateSetPreserved: attemptValid,
    ...(invalidReasons.length > 0 ? { invalidReason: invalidReasons.join("; ") } : {}),
    attemptedCandidates,
    failedCandidates,
    domains,
  };
}

type RecordedObservation = {
  scopeId?: string;
  iteration?: number;
  candidates?: FrozenToolCandidate[];
  bindings?: LocalToolBinding[];
  offered?: string[];
  chosenCandidateId?: string;
  requirementCandidates?: Array<{ candidateId: string; reasons: string[] }>;
  ranking?: { scoper?: Array<{ candidateId: string; score: number }> };
  scoping?: {
    admitted?: Array<{ candidateId: string; reasons: string[] }>;
    fallbackFull?: boolean;
    excluded?: Array<{ candidateId: string; reasons: string[] }>;
  };
};

/**
 * Rebuild the frozen scope(s) from recorded `tool.selection.observed` events.
 * The first observation of a scope supplies the surface (it was frozen once);
 * every observation contributes its chosen candidate, in order, so the actual
 * selection sequence survives.
 */
export function extractToolSelectionScopes(
  events: ReadonlyArray<{ type: string; payload?: unknown }>,
): ToolSelectionScope[] {
  const byScope = new Map<string, ToolSelectionScope>();
  for (const event of events) {
    if (event.type !== "tool.selection.observed") continue;
    const payload = (event.payload ?? {}) as RecordedObservation;
    const scopeId = payload.scopeId;
    if (!scopeId) continue;
    let scope = byScope.get(scopeId);
    if (!scope) {
      scope = {
        scopeId,
        iteration: payload.iteration ?? 0,
        candidates: payload.candidates ?? [],
        offered: payload.offered ?? [],
        requirementCandidates: payload.requirementCandidates ?? [],
        scoperRanking: payload.ranking?.scoper ?? [],
        actualCandidateIds: [],
        ...(payload.bindings ? { bindings: payload.bindings } : {}),
        ...(payload.scoping?.admitted
          ? {
              scoping: {
                admitted: payload.scoping.admitted,
                fallbackFull: payload.scoping.fallbackFull ?? false,
                ...(payload.scoping.excluded ? { excluded: payload.scoping.excluded } : {}),
              },
            }
          : {}),
      };
      byScope.set(scopeId, scope);
    }
    if (payload.chosenCandidateId) scope.actualCandidateIds.push(payload.chosenCandidateId);
  }
  return [...byScope.values()];
}

/**
 * Adapt a decision engine executor into a per-candidate selector. The subject
 * is supplied by the caller — a runtime `DecisionType` or an offline
 * experiment id. No `DecisionType` represents tool selection yet, and the
 * experiment must not be smuggled through an unrelated runtime decision just to
 * reach an engine.
 *
 * Only bounded `score` results are accepted here: this adapter's job is to hand
 * ALiX one ranking value per candidate. A native Choice/Noul result invalidates
 * the replay instead of being coerced — an experiment that reads a Noul
 * probability as its ranking value does that conversion itself, in provenance
 * terms, and reports the outcome kind it actually used.
 */
export function createEngineToolSelector(
  executor: DecisionExecutor,
  options: { subject: DecisionSubject; projectorVersion: string; timeoutMs?: number },
): ToolSelectionSelector {
  return {
    id: executor.engineId,
    remote: true,
    async rank(request) {
      const sealed = sealForRemote(decisionSubjectString(options.subject), options.projectorVersion, {
        scopeId: request.scopeId,
        iteration: request.iteration,
        candidateId: request.candidateId,
        domain: request.domain,
        requirementCandidates: request.requirementCandidates,
      });
      const outcome = await executeWithTimeout(
        executor,
        { decision: sealed.decision, sealed, candidates: [request.candidateId] },
        options.timeoutMs ?? DEFAULT_REPLAY_TIMEOUT_MS,
      );
      if (outcome.kind === "failure") return { error: outcome.error };
      if (outcome.kind !== "score") return { error: `selector returned ${outcome.kind}, expected a bounded score` };
      if (!Number.isFinite(outcome.score)) return { error: "selector returned a non-finite score" };
      return { rankValue: outcome.score };
    },
  };
}
