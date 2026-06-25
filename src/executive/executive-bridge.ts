/**
 * P10.4b — Executive Proposal Bridge.
 *
 * Bridges P10.4a `create_remediation_proposal` step kind into existing
 * P5/P9 `AdaptationProposal` lifecycle as **pending** proposal.
 *
 * HARD BOUNDARY: this module may only CREATE pending proposals.
 * It may not approve, apply, or reject proposals.
 *
 * Two functions:
 * - `buildExecutiveRemediationProposal` (pure) — produces an `AdaptationProposal`
 * - `bridgeCreateRemediationProposal` (effectful) — wraps pure builder + save
 *
 * Idempotency is caller-driven: `ExecutionEngine` checks
 * `stepState.generatedArtifacts` before calling the bridge.
 *
 * @module
 */

import type { AdaptationProposal } from "../adaptation/adaptation-types.js";
import type { PersistedExecutionPlan } from "./executive-plan-types.js";
import type { ExecutionStep } from "./planning-engine.js";
import type { ExecutiveSubsystemName } from "./executive-health.js";
import type { GeneratedArtifactRef } from "./executive-plan-types.js";

/** Bump when bridge payload schema changes. Persisted on every proposal. */
export const EXECUTIVE_BRIDGE_VERSION = "1.0";

const VALID_SUBSYSTEMS: readonly ExecutiveSubsystemName[] = [
  "governance",
  "security",
  "adaptation",
  "learning",
  "memory",
  "tools",
  "workflow",
  "agents",
];

/**
 * PURE: build a pending `AdaptationProposal` that bridges an executive step
 * into the existing P5/P9 mutation lifecycle.
 *
 * The returned proposal is **intentionally incomplete** — `payload.action`,
 * `payload.target`, and `payload.payload` are filled by a human via the
 * existing `alix adaptation` lifecycle. The proposal surfaces
 * `requiresHumanSpecification: true` with an explicit `requestedFields` list
 * so the human-facing surface can guide the user.
 *
 * The caller supplies the canonical proposal ID — `ProposalStore.save()`
 * validates `id` as a non-empty string and writes under `${id}.json`. The
 * wrapper captures `draft.id` (already known, no post-save read).
 *
 * @throws when proposalId is empty
 * @throws when step.action is not `create_remediation_proposal`
 * @throws when step.objectiveId is empty
 * @throws when step.targetSubsystem is not a valid ExecutiveSubsystemName
 */
export function buildExecutiveRemediationProposal(
  plan: PersistedExecutionPlan,
  step: ExecutionStep,
  proposalId: string,
  now: string,
): AdaptationProposal {
  if (!proposalId) {
    throw new Error("Executive bridge requires non-empty proposalId");
  }
  if (step.action !== "create_remediation_proposal") {
    throw new Error(
      `Executive bridge requires action="create_remediation_proposal"; received "${step.action}"`,
    );
  }
  if (!step.objectiveId) {
    throw new Error(
      `Executive bridge requires step.objectiveId; step "${step.id}" has none`,
    );
  }
  if (!VALID_SUBSYSTEMS.includes(step.targetSubsystem)) {
    throw new Error(
      `Executive bridge received invalid subsystem "${String(step.targetSubsystem)}" on step "${step.id}"`,
    );
  }

  return {
    id: proposalId,
    status: "pending",
    action: "executive_remediation_request",
    target: {
      kind: "executive_remediation",
      planId: plan.id,
      stepId: step.id,
      objectiveId: step.objectiveId,
      subsystem: step.targetSubsystem,
    },
    provenance: "manual",
    sourceRecommendationType: "executive_remediation",
    reason: `Executive remediation requested by plan "${plan.id}" step "${step.id}"`,
    createdAt: now,
    evidenceFingerprints: [],
    sourceConfidence: 0,
    payload: {
      source: "executive_bridge",
      bridgeVersion: EXECUTIVE_BRIDGE_VERSION,
      planId: plan.id,
      stepId: step.id,
      objectiveId: step.objectiveId,
      subsystem: step.targetSubsystem,
      riskLevel: step.riskLevel,
      requiresHumanSpecification: true,
      requestedFields: ["action", "target", "payload"],
    },
  };
}

/** Result bridging one executive step into proposal lifecycle. */
export interface ExecutiveBridgeResult {
  /** saved proposal — `proposal.id` reflects canonical ID assigned by `ProposalStore.save`. */
  proposal: AdaptationProposal;
  /** Durable cross-reference key appended `StepRuntimeState.generatedArtifacts`. */
  artifactRef: GeneratedArtifactRef;
}

/**
 * EFFECTFUL: wrap `buildExecutiveRemediationProposal` `ProposalStore.save`
 * callback return durable reference engine should append
 * `StepRuntimeState.generatedArtifacts`.
 *
 * wrapper does NOT mutate any global state — caller drives
 * `StepRuntimeState`. function only persists one proposal returns
 * reference caller should record.
 *
 * @throws any error thrown by `append` — caller decides whether retry.
 */
export async function bridgeCreateRemediationProposal(
  plan: PersistedExecutionPlan,
  step: ExecutionStep,
  proposalId: string,
  now: string,
  append: (proposal: AdaptationProposal) => Promise<void>,
): Promise<ExecutiveBridgeResult> {
  const draft = buildExecutiveRemediationProposal(plan, step, proposalId, now);
  await append(draft);
  return {
    proposal: draft,
    artifactRef: { type: "proposal", id: proposalId },
  };
}
