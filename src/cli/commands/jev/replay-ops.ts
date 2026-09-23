/**
 * replay-ops.ts — Fixture building and dry-run replay for `alix jev`.
 *
 * Fixtures come from each decision's built-in corpus, so baseline and Jev can
 * be compared on identical, deterministic inputs (J1 exit criterion). Replay
 * is the J5 harness: offline, no tools, no governance, no journal writes.
 */

import { mkdirSync } from "node:fs";
import {
  CLAIM_VERDICTS,
  CLAIM_VERIFICATION_CORPUS,
  CONTEXT_RELEVANCE_CORPUS,
  MODEL_TIER_CORPUS,
  RISK_ESCALATION_CORPUS,
  RISK_TIERS,
  compareEngineRuns,
  createJevExecutor,
  createLocalBaselineExecutor,
  evaluatePromotionGate,
  exportReplayFixture,
  listEnabledTiers,
  listReplayFixtures,
  projectClaimVerification,
  projectContextRelevance,
  projectModelTier,
  projectRiskEscalation,
  replaySuite,
  saveReplayFixture,
  type DecisionConfig,
  type DecisionExecutor,
  type DecisionType,
  type ExecutorOutcome,
  type ReplayFixture,
  type ReplayRun,
} from "../../../decision/index.js";
import type { AlixConfig } from "../../../config/schema.js";
import { getSavedApiKey } from "../../helpers/api-keys.js";
import {
  JEV_KEY_PROVIDER_ID,
  JevOperatorError,
  type JevPaths,
} from "./ops.js";

export const LOCAL_ENGINE = "local";
export const JEV_ENGINE = "jev";

/** Build one fixture per corpus entry for a decision, and persist them. */
export function buildFixtures(
  config: Pick<AlixConfig, "models">,
  paths: JevPaths,
  decision: DecisionType,
  opts: { now?: number } = {},
): ReplayFixture[] {
  mkdirSync(paths.fixtures, { recursive: true });
  const now = opts.now ?? Date.now();
  const fixtures: ReplayFixture[] = [];

  const push = (fixture: ReplayFixture): void => {
    saveReplayFixture(`${paths.fixtures}/${fixture.id}.json`, fixture);
    fixtures.push(fixture);
  };

  switch (decision) {
    case "claim-verification":
      for (const entry of CLAIM_VERIFICATION_CORPUS) {
        push(
          exportReplayFixture(
            projectClaimVerification(
              { claim: entry.claim, evidence: entry.evidence ?? [] },
              { now },
            ),
            {
              id: `claim-${entry.id}`,
              decision,
              candidates: [...CLAIM_VERDICTS],
              expected: entry.expected,
              now,
            },
          ),
        );
      }
      return fixtures;

    case "context-relevance":
      for (const entry of CONTEXT_RELEVANCE_CORPUS) {
        push(
          exportReplayFixture(
            projectContextRelevance(
              { objective: entry.objective, item: { id: entry.id, text: entry.item } },
              { now },
            ),
            // `expected` here is relevant/irrelevant, not a Noul value, so it is
            // metadata only — accuracy is omitted for this decision.
            { id: `relevance-${entry.id}`, decision, expected: entry.expected, now },
          ),
        );
      }
      return fixtures;

    case "model-tier": {
      const candidates = listEnabledTiers(config);
      // A bounded Choice needs a real choice: with fewer than two enabled tiers
      // every task falls through to the same one and the corpus proves nothing.
      if (candidates.length < 2) {
        throw new JevOperatorError(
          `model-tier fixtures need at least two enabled tiers (found ${candidates.length}: ${candidates.join(", ") || "none"}); configure models.<tier> first`,
        );
      }
      for (const entry of MODEL_TIER_CORPUS) {
        push(
          exportReplayFixture(
            projectModelTier(
              {
                taskKind: entry.taskKind,
                promptChars: entry.promptChars,
                needsTools: entry.needsTools,
                needsVision: entry.needsVision,
                longContext: entry.longContext,
              },
              { now },
            ),
            {
              id: `tier-${entry.id}`,
              decision,
              candidates,
              ...(entry.expected !== null ? { expected: entry.expected } : {}),
              now,
            },
          ),
        );
      }
      return fixtures;
    }

    case "risk-escalation":
      for (const entry of RISK_ESCALATION_CORPUS) {
        push(
          exportReplayFixture(
            projectRiskEscalation(
              {
                capability: entry.capability,
                summary: entry.summary,
                ...(entry.detail !== undefined ? { detail: entry.detail } : {}),
              },
              { now },
            ),
            {
              id: `risk-${entry.id}`,
              decision,
              candidates: [...RISK_TIERS],
              expected: entry.expected,
              now,
            },
          ),
        );
      }
      return fixtures;
  }
}

export function loadFixtures(paths: JevPaths, decision?: DecisionType): ReplayFixture[] {
  const all = listReplayFixtures(paths.fixtures);
  return decision === undefined ? all : all.filter((fixture) => fixture.decision === decision);
}

/** Executor for an engine id. Jev needs the store-only key and remote opt-in. */
export async function makeExecutor(
  engineId: string,
  config: DecisionConfig,
  opts: { timeoutMs?: number } = {},
): Promise<DecisionExecutor> {
  if (engineId === LOCAL_ENGINE) return createLocalBaselineExecutor();
  if (engineId !== JEV_ENGINE) {
    throw new JevOperatorError(`unknown engine: ${engineId} (expected ${LOCAL_ENGINE} or ${JEV_ENGINE})`);
  }
  if (config.remote.jev.enabled !== true) {
    throw new JevOperatorError(
      "remote Jev is disabled; set decision.remote.jev.enabled=true in config before replaying on jev",
    );
  }
  const apiKey = await getSavedApiKey(JEV_KEY_PROVIDER_ID);
  if (apiKey === null) {
    throw new JevOperatorError(
      `no Jev API key in the credential store (expected apiKeys.${JEV_KEY_PROVIDER_ID})`,
    );
  }
  return createJevExecutor({
    enabled: true,
    apiKey,
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
  });
}

export type ReplayOptions = {
  engineId: string;
  compareEngineId?: string;
  gate?: boolean;
  timeoutMs?: number;
  /** Restrict the run to one decision's fixtures. */
  decision?: DecisionType;
};

export type ReplayReport = {
  fixtures: number;
  engineId: string;
  runs: ReplayRun[];
  accuracy?: number;
  malformed: number;
  comparison?: ReturnType<typeof compareEngineRuns>;
  gate?: ReturnType<typeof evaluatePromotionGate>;
};

/**
 * Correctness predicate — only meaningful when the fixture's expectation IS one
 * of its offered candidates. A Noul decision (context relevance) has no
 * candidates and a judgement label, so comparing it to a probability would
 * report a meaningless 0%; accuracy is omitted for it instead.
 */
function correctnessPredicate(
  fixtures: readonly ReplayFixture[],
): ((fixtureId: string, outcome: ExecutorOutcome) => boolean) | undefined {
  const comparable = fixtures.filter(
    (fixture) =>
      Array.isArray(fixture.candidates) &&
      fixture.candidates.length > 0 &&
      (fixture.candidates as readonly unknown[]).includes(fixture.expected),
  );
  if (comparable.length === 0) return undefined;
  const byId = new Map(comparable.map((fixture) => [fixture.id, fixture.expected]));
  return (fixtureId, outcome) => {
    const expected = byId.get(fixtureId);
    if (expected === undefined) return false;
    return outcome.kind === "choice" && outcome.choice === expected;
  };
}

export async function runReplay(
  config: DecisionConfig,
  paths: JevPaths,
  opts: ReplayOptions,
): Promise<ReplayReport> {
  const fixtures = loadFixtures(paths, opts.decision);
  if (fixtures.length === 0) {
    throw new JevOperatorError(
      `no fixtures in ${paths.fixtures}; run 'alix jev fixture build --decision <d>' first`,
    );
  }

  const isCorrect = correctnessPredicate(fixtures);
  const primary = await makeExecutor(opts.engineId, config, {
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
  });
  const primaryRuns = (await replaySuite(fixtures, [primary], {
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
  }))[opts.engineId];

  const malformed = primaryRuns.filter((run) => run.outcome.kind === "failure").length;
  const accuracy = isCorrect
    ? primaryRuns.filter((run) => isCorrect(run.fixtureId, run.outcome)).length / primaryRuns.length
    : undefined;

  const report: ReplayReport = {
    fixtures: fixtures.length,
    engineId: opts.engineId,
    runs: primaryRuns,
    malformed,
    ...(accuracy !== undefined ? { accuracy } : {}),
  };

  if (opts.compareEngineId === undefined) return report;

  const other = await makeExecutor(opts.compareEngineId, config, {
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
  });
  const otherRuns = (await replaySuite(fixtures, [other], {
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
  }))[opts.compareEngineId];

  const comparisonInput = {
    fixtures,
    baseline: otherRuns,
    candidate: primaryRuns,
    baselineEngineId: opts.compareEngineId,
    candidateEngineId: opts.engineId,
    ...(isCorrect !== undefined ? { isCorrect } : {}),
  };
  report.comparison = compareEngineRuns(comparisonInput);
  if (opts.gate === true) {
    report.gate = evaluatePromotionGate(comparisonInput);
  }
  return report;
}
