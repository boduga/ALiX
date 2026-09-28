/**
 * tool-selection-fixtures.ts — T2-e2: recorded responses for external tools.
 *
 * An external tool (network, remote MCP) cannot be replayed in a snapshot. A
 * recorded response gives it a *hermetic substitute*: the evaluation sees the
 * response that call produced under the fixture, and nothing reaches the
 * network.
 *
 * Rules, enforced rather than documented:
 * - Exact identity only: tool and argsSignature must both match exactly. No
 *   fuzzy or "similar args" matching, and an ambiguous match is rejected
 *   rather than silently resolved to the most recent response.
 * - Fixtures apply to `external` tools only. Hermetic tools belong in an
 *   isolated snapshot; mutating tools need a snapshot plus a mutation policy.
 * - No transport. This module imports no network client, and a fixture miss is
 *   `unknown` — never a live call.
 * - A recorded response does NOT imply evidence contribution: whatever the
 *   capture recorded is what the replay reports, and `unknown` stays `unknown`.
 *
 * The `argsSignature` must come from ALiX's existing canonical signature
 * (`hashArgs` in `src/tools/executor.ts`), which hashes the canonicalized
 * arguments — never a raw serialization that could carry credentials, tokens,
 * or secret query parameters into a persisted key.
 */

import { readFileSync } from "node:fs";
import { toolSelectionDomain } from "./tool-selection-replay.js";
import type { LocalToolResolver } from "./tool-selection-candidates.js";
import {
  replayabilityOf,
  type CounterfactualReplayRunner,
  type SelectionOutcomeRecord,
} from "./tool-selection-evaluation.js";
import type { ToolSelectionScope } from "./tool-selection-replay.js";

export type ExternalReplayFixture = {
  fixtureId: string;
  /** Model-facing tool name (e.g. an `mcp__…` handle or a web tool). */
  tool: string;
  /** Exact canonical argument signature — a hash, never raw arguments. */
  argsSignature: string;
  outcome: SelectionOutcomeRecord;
  capturedAt: string;
  source: "recorded-response";
};

export type ExternalReplayFixtureStore = {
  lookup(tool: string, argsSignature: string): ExternalReplayFixture | undefined;
  list(): readonly ExternalReplayFixture[];
};

const OUTCOMES = {
  execution: ["success", "failed", "repaired"],
  selection: ["novel", "redundant"],
  evidence: ["contributed", "none", "unknown"],
};

function invalidFixtureReason(fixture: ExternalReplayFixture): string | undefined {
  if (!fixture.fixtureId) return "fixtureId missing";
  if (!fixture.tool) return "tool missing";
  if (!fixture.argsSignature) return "argsSignature missing";
  if (fixture.source !== "recorded-response") return `unsupported source: ${fixture.source}`;
  if (!OUTCOMES.execution.includes(fixture.outcome.execution)) return "invalid execution outcome";
  if (!OUTCOMES.selection.includes(fixture.outcome.selection)) return "invalid selection outcome";
  if (!OUTCOMES.evidence.includes(fixture.outcome.evidence)) return "invalid evidence contribution";
  return undefined;
}

/**
 * Build a store from captured fixtures. Invalid entries are dropped with their
 * reason so a corrupt corpus cannot silently widen matching.
 */
export function createExternalReplayFixtureStore(fixtures: readonly ExternalReplayFixture[]): {
  store: ExternalReplayFixtureStore;
  dropped: Array<{ fixtureId: string; reason: string }>;
} {
  const dropped: Array<{ fixtureId: string; reason: string }> = [];
  const valid: ExternalReplayFixture[] = [];
  for (const fixture of fixtures) {
    const reason = invalidFixtureReason(fixture);
    if (reason) dropped.push({ fixtureId: fixture.fixtureId ?? "(unnamed)", reason });
    else valid.push(fixture);
  }
  const byKey = new Map<string, ExternalReplayFixture[]>();
  for (const fixture of valid) {
    const key = `${fixture.tool}\u0000${fixture.argsSignature}`;
    byKey.set(key, [...(byKey.get(key) ?? []), fixture]);
  }
  return {
    store: {
      // Ambiguity is a rejection, not a coin flip: two captures for one
      // identity mean the corpus cannot support a defensible counterfactual.
      lookup(tool, argsSignature) {
        const matches = byKey.get(`${tool}\u0000${argsSignature}`) ?? [];
        return matches.length === 1 ? matches[0] : undefined;
      },
      list: () => valid,
    },
    dropped,
  };
}

/** Load fixtures from a JSON array on disk. Missing files yield an empty corpus. */
export function loadExternalReplayFixtures(path: string): {
  store: ExternalReplayFixtureStore;
  dropped: Array<{ fixtureId: string; reason: string }>;
} {
  let parsed: unknown = [];
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    parsed = [];
  }
  return createExternalReplayFixtureStore(Array.isArray(parsed) ? parsed as ExternalReplayFixture[] : []);
}

export type RecordedResponseReplayResult =
  | {
      basis: "replayed";
      environment: "recorded-response";
      fixture: {
        tool: string;
        argsSignature: string;
        fixtureId: string;
        capturedAt: string;
        source: "recorded-response";
      };
      network: "disabled";
      outcome: SelectionOutcomeRecord;
    }
  | { basis: "unknown"; tool: string; reason: string };

/**
 * Replay an external tool from a recorded response. Never falls back to a live
 * call: with no exact fixture the alternative stays `unknown`.
 */
export function replayFromRecordedResponse(input: {
  tool: string;
  argsSignature?: string;
  store: ExternalReplayFixtureStore;
}): RecordedResponseReplayResult {
  const replayability = replayabilityOf(input.tool);
  if (replayability !== "external") {
    return {
      basis: "unknown",
      tool: input.tool,
      reason: replayability === "hermetic"
        ? "hermetic tool: replay it in an isolated snapshot instead"
        : "mutating tool: requires an isolated snapshot plus a mutation policy",
    };
  }
  if (!input.argsSignature) {
    return {
      basis: "unknown",
      tool: input.tool,
      reason: "no recorded arguments for this alternative (fixture identity unknown)",
    };
  }
  const fixture = input.store.lookup(input.tool, input.argsSignature);
  if (!fixture) {
    // Deliberate: a miss means no recorded response, never a live request.
    return { basis: "unknown", tool: input.tool, reason: "no matching recorded response" };
  }
  return {
    basis: "replayed",
    environment: "recorded-response",
    fixture: {
      tool: fixture.tool,
      argsSignature: fixture.argsSignature,
      fixtureId: fixture.fixtureId,
      capturedAt: fixture.capturedAt,
      source: fixture.source,
    },
    network: "disabled",
    // The capture's own outcome, untouched: a recorded response is not evidence
    // of contribution unless the capture could demonstrate it.
    outcome: fixture.outcome,
  };
}

/**
 * Bind the fixture store to the evaluator's counterfactual seam. Only external
 * candidates are served; anything else reports an error so the evaluator keeps
 * it `unknown`.
 */
export function createRecordedResponseRunner(options: {
  store: ExternalReplayFixtureStore;
  /** Canonical signature for the alternative, when one is known. */
  argsSignatureFor?: (request: { scopeId: string; candidateId: string; domain: ReturnType<typeof toolSelectionDomain> }) => string | undefined;
  /**
   * LOCAL ONLY: resolve a candidate id to the tool name the fixture was
   * captured under (the executor name, never the projected candidate id).
   * Without it the candidate id is used as-is.
   */
  toolFor?: LocalToolResolver;
}): CounterfactualReplayRunner {
  return async (request) => {
    const result = replayFromRecordedResponse({
      tool: options.toolFor?.(request.candidateId) ?? request.candidateId,
      ...(options.argsSignatureFor ? { argsSignature: options.argsSignatureFor(request) } : {}),
      store: options.store,
    });
    return result.basis === "replayed"
      ? { outcome: result.outcome, replayId: `fixture_${result.fixture.fixtureId}` }
      : { error: result.reason };
  };
}

/** Scope → fixture identity helper, for callers assembling a corpus. */
export function fixtureKeyFor(scope: ToolSelectionScope, tool: string): { scopeId: string; tool: string } {
  return { scopeId: scope.scopeId, tool };
}
