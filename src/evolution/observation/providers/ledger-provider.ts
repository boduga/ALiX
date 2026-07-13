// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A5.1 — Ledger Observation Provider.
 *
 * Observes governance evidence ledger state. Checks for evidence
 * records, counts, and proposal-specific entries. Never mutates
 * the ledger.
 *
 * @module ledger-provider
 */

import type { Observation, ObservationResult, ObservationProvider } from "../contracts/observation-contract.js";
import type { ExecutionEvidenceStore } from "../../verification/evidence/evidence-store.js";

// ---------------------------------------------------------------------------
// LedgerObservationProvider
// ---------------------------------------------------------------------------

export class LedgerObservationProvider implements ObservationProvider {
  readonly name = "ledger";
  readonly capabilities = ["ledger"];

  constructor(private readonly evidenceStore: ExecutionEvidenceStore) {}

  async observe(observation: Observation): Promise<ObservationResult> {
    const params = observation.params as Record<string, unknown> | undefined;
    const check = (params?.check as string) ?? "evidence_count";

    try {
      switch (check) {
        case "evidence_count": {
          const all = await this.evidenceStore.list();
          const count = all.length;
          return this.buildResult(observation, count, { check, count });
        }

        case "has_evidence": {
          const proposalId = params?.proposalId as string | undefined;
          if (!proposalId) {
            return {
              observationId: observation.observationId,
              status: "error",
              confidence: 0,
              observedAt: new Date().toISOString(),
              evidence: { errorType: "environment_failure", message: "proposalId parameter required for has_evidence check" },
            };
          }
          const all = await this.evidenceStore.list();
          // Filter by proposalId — the store's evidence records have a proposalId field
          const matching = all.filter((e: Record<string, unknown>) => e.proposalId === proposalId);
          const hasEvidence = matching.length > 0;
          return this.buildResult(observation, hasEvidence, { check, proposalId, count: matching.length });
        }

        default:
          return {
            observationId: observation.observationId,
            status: "error",
            confidence: 0,
            observedAt: new Date().toISOString(),
            evidence: { errorType: "environment_failure", message: `Unknown check type: ${check}` },
          };
      }
    } catch (err: unknown) {
      return {
        observationId: observation.observationId,
        status: "error",
        confidence: 0,
        observedAt: new Date().toISOString(),
        evidence: {
          errorType: "provider_exception",
          message: (err as Error).message ?? String(err),
        },
      };
    }
  }

  private buildResult(
    observation: Observation,
    observed: unknown,
    evidence: Record<string, unknown>,
  ): ObservationResult {
    const expected = observation.expected;
    let status: "pass" | "fail" | "error" | "inconclusive";

    if (expected !== undefined) {
      status = observed === expected ? "pass" : "fail";
    } else {
      status = "pass";
    }

    return {
      observationId: observation.observationId,
      status,
      confidence: 1.0,
      observedAt: new Date().toISOString(),
      expected,
      observed,
      evidence,
    };
  }
}
