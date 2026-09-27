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

export type ToolSelectionDomain = "builtin" | "mcp";

/** MCP model handles use the reserved `mcp__` namespace. */
export function toolSelectionDomain(tool: string): ToolSelectionDomain {
  return tool.startsWith("mcp__") ? "mcp" : "builtin";
}

export type ToolSelectionScope = {
  scopeId: string;
  iteration: number;
  offered: string[];
  requirementCandidates: Array<{ tool: string; reasons: string[] }>;
  /** The production ordering recorded with the scope (native scores). */
  deterministicRanking: Array<{ tool: string; score: number }>;
  /** Model-facing names the loop actually called on this surface, in order. */
  actualChoices: string[];
};

export type ToolSelectionScoreRequest = {
  scopeId: string;
  iteration: number;
  tool: string;
  domain: ToolSelectionDomain;
  requirementCandidates: Array<{ tool: string; reasons: string[] }>;
};

export type ToolSelectionSelector = {
  id: string;
  /** True when the selector crosses a remote trust boundary (Jev). */
  remote?: boolean;
  score(request: ToolSelectionScoreRequest): Promise<{ score: number } | { error: string }>;
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
  actualChoice?: string;
  deterministicRanking: string[];
  selectorRanking: string[];
  candidateSetPreserved: boolean;
  invalidReason?: string;
  domains: Array<{
    domain: ToolSelectionDomain;
    ranking: string[];
    candidateSetPreserved: boolean;
  }>;
};

async function scoreWithTimeout(
  selector: ToolSelectionSelector,
  request: ToolSelectionScoreRequest,
  timeoutMs: number,
): Promise<{ score: number } | { error: string }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      selector.score(request),
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

  for (const domain of ["builtin", "mcp"] as const) {
    const candidates = scope.offered.filter(tool => toolSelectionDomain(tool) === domain);
    if (candidates.length === 0) continue;

    const scored: Array<{ tool: string; score: number }> = [];
    let failure: string | undefined;
    for (const tool of candidates) {
      const outcome = await scoreWithTimeout(
        selector,
        {
          scopeId: scope.scopeId,
          iteration: scope.iteration,
          tool,
          domain,
          requirementCandidates: scope.requirementCandidates,
        },
        timeoutMs,
      );
      if ("error" in outcome) {
        failure = `selector "${selector.id}" failed for ${tool}: ${outcome.error}`;
        break;
      }
      if (!Number.isFinite(outcome.score)) {
        failure = `selector "${selector.id}" returned a non-finite score for ${tool}`;
        break;
      }
      scored.push({ tool, score: outcome.score });
    }

    if (failure) {
      invalidReasons.push(failure);
      domains.push({ domain, ranking: [], candidateSetPreserved: false });
      continue;
    }

    // ALiX sorts: score descending, ties in the offered order for stability.
    const ranking = scored
      .map((entry, index) => ({ ...entry, index }))
      .sort((a, b) => (b.score - a.score) || (a.index - b.index))
      .map(({ tool }) => tool);

    // Exact set equality, verified rather than assumed: an adapter bug must not
    // produce a "replayed" ordering over a different population.
    const preserved = ranking.length === candidates.length
      && new Set(ranking).size === candidates.length
      && candidates.every(tool => ranking.includes(tool));
    if (!preserved) invalidReasons.push(`selector "${selector.id}" did not preserve the ${domain} candidate set`);
    domains.push({ domain, ranking, candidateSetPreserved: preserved });
  }

  const candidateSetPreserved = domains.every(entry => entry.candidateSetPreserved);
  return {
    scopeId: scope.scopeId,
    selectorId: selector.id,
    ...(scope.actualChoices[0] ? { actualChoice: scope.actualChoices[0] } : {}),
    deterministicRanking: scope.deterministicRanking.map(entry => entry.tool),
    selectorRanking: domains.flatMap(entry => entry.ranking),
    candidateSetPreserved,
    ...(invalidReasons.length > 0 ? { invalidReason: invalidReasons.join("; ") } : {}),
    domains,
  };
}

type RecordedObservation = {
  scopeId?: string;
  iteration?: number;
  offered?: string[];
  chosen?: string;
  requirementCandidates?: Array<{ tool: string; reasons: string[] }>;
  ranking?: { deterministic?: Array<{ tool: string; score: number }> };
};

/**
 * Rebuild the frozen scope(s) from recorded `tool.selection.observed` events.
 * The first observation of a scope supplies the surface (it was frozen once);
 * every observation contributes its chosen tool, in order, so the actual
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
        offered: payload.offered ?? [],
        requirementCandidates: payload.requirementCandidates ?? [],
        deterministicRanking: payload.ranking?.deterministic ?? [],
        actualChoices: [],
      };
      byScope.set(scopeId, scope);
    }
    if (payload.chosen) scope.actualChoices.push(payload.chosen);
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
 * Only bounded `score` results are accepted. A Choice/Noul answer cannot rank a
 * set without ordering artifacts, so it invalidates the replay instead of being
 * coerced into a score.
 */
export function createEngineToolSelector(
  executor: DecisionExecutor,
  options: { subject: DecisionSubject; projectorVersion: string; timeoutMs?: number },
): ToolSelectionSelector {
  return {
    id: executor.engineId,
    remote: true,
    async score(request) {
      const sealed = sealForRemote(decisionSubjectString(options.subject), options.projectorVersion, {
        scopeId: request.scopeId,
        iteration: request.iteration,
        tool: request.tool,
        domain: request.domain,
        requirementCandidates: request.requirementCandidates,
      });
      const outcome = await executeWithTimeout(
        executor,
        { decision: sealed.decision, sealed, candidates: [request.tool] },
        options.timeoutMs ?? DEFAULT_REPLAY_TIMEOUT_MS,
      );
      if (outcome.kind === "failure") return { error: outcome.error };
      if (outcome.kind !== "score") return { error: `selector returned ${outcome.kind}, expected a bounded score` };
      return { score: outcome.score };
    },
  };
}
