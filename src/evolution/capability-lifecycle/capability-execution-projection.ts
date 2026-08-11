// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import type { EvolutionProposal } from "../contracts/evolution-contract.js";
import type { LifecycleState } from "../../adaptation/capability-evolution-types.js";
import type { CapabilityLifecycleRecord } from "./contracts/lifecycle-contract.js";

export interface CapabilityChangeStep {
  operation: "capability.transition";
  parameters: { capabilityId: string; to: LifecycleState };
  idempotent: true;
  preconditions: Record<string, unknown>;
  postconditions: Record<string, unknown>;
}

/** A7.1 execution projection — `EvolutionProposal` is a closed interface (no
 *  `changes` field); the changes array lives here so A4's `resolveSteps` maps
 *  them to plan steps. */
export type CapabilityExecutionProposal = EvolutionProposal & { changes: CapabilityChangeStep[] };

const INTENT_TO_STATE: Record<string, (r: CapabilityLifecycleRecord) => CapabilityChangeStep[]> = {
  promote: (r) => [step(r.target.capabilityId, r.proposedLifecycleState)],
  deprecate: (r) => [step(r.target.capabilityId, r.proposedLifecycleState)],
  consolidate: (r) => (r.target.relatedCapabilityIds ?? []).map((rel) => step(rel, "deprecated")),
};

function step(capabilityId: string, to: LifecycleState): CapabilityChangeStep {
  return { operation: "capability.transition", parameters: { capabilityId, to }, idempotent: true, preconditions: {}, postconditions: {} };
}

export function toExecutionProposal(decided: CapabilityLifecycleRecord): CapabilityExecutionProposal {
  const builder = INTENT_TO_STATE[decided.intent];
  if (!builder) {
    throw new Error(`capability:${decided.intent} is not executable in A7.1`);
  }
  const changes = builder(decided);
  const change = `${decided.intent}: ${decided.target.capabilityId} → ${decided.proposedLifecycleState}`;
  return {
    proposalId: decided.proposalId!,
    evolutionId: decided.proposalId!,
    title: `${decided.intent} capability ${decided.target.capabilityId}`,
    description: `Governed ${decided.intent} for ${decided.target.capabilityId}`,
    change,
    beforeHash: null,
    afterHash: null,
    createdAt: decided.timestamp,
    changes,
  };
}
