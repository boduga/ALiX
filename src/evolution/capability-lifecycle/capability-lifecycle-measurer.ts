// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { createHash } from "node:crypto";
import type { CapabilityLifecycleLedger } from "./capability-lifecycle-ledger.js";
import { CapabilityEvolutionStore } from "../../adaptation/capability-evolution-store.js";
import { buildObservationEvidence } from "../observation/observation-evidence-bridge.js";

export interface CapabilityMeasurerDeps { ledger: CapabilityLifecycleLedger; store: CapabilityEvolutionStore; }
export type MeasureResult =
  | { status: "measured"; measurementId: string; stateTransition: string }
  | { status: "blocked"; reason: string };

export class CapabilityLifecycleMeasurer {
  constructor(private readonly deps: CapabilityMeasurerDeps) {}

  async measure(capabilityId: string): Promise<MeasureResult> {
    const { ledger, store } = this.deps;
    const latest = await ledger.listLatestForCapability(capabilityId);
    if (!latest || latest.eventType !== "applied") {
      return { status: "blocked", reason: `No applied transition for ${capabilityId}` };
    }

    const report = await store.loadLatest();
    const post = report?.healthAnalysis.find((h) => h.capability === capabilityId);
    const postState = post?.lifecycleState ?? latest.observedLifecycleState;

    // A5 post-application observation evidence
    const evidence = buildObservationEvidence({
      proposalId: latest.proposalId ?? "a7-measure",
      evolutionId: latest.proposalId ?? "a7-measure",
      environmentHash: "a7-capability",
      observations: [{
        observationId: `a7-obs-${capabilityId}`,
        status: "pass", observed: postState, expected: latest.proposedLifecycleState, confidence: 1,
        observedAt: new Date().toISOString(), evidence: {},
      }],
    });

    const measurementId = `a7-meas-${hash16(`a7-meas|${capabilityId}|${latest.executionId ?? ""}`)}`;
    const stateTransition = `${latest.observedLifecycleState ?? "none"} → ${postState}`;

    const measured = {
      target: { ...latest.target }, intent: latest.intent, eventType: "measured" as const,
      timestamp: new Date().toISOString(), proposalId: latest.proposalId, decisionId: latest.decisionId,
      executionId: latest.executionId, measurementId,
      baselineEvidenceRefs: [latest.decisionId ?? "a7-baseline"], postObservationRefs: [evidence.evidenceId],
      evidenceRefs: [...latest.evidenceRefs], observedLifecycleState: latest.observedLifecycleState,
      proposedLifecycleState: latest.proposedLifecycleState,
    };
    await ledger.append(measured);
    return { status: "measured", measurementId, stateTransition };
  }
}

function hash16(input: string): string { return createHash("sha256").update(input, "utf-8").digest("hex").slice(0, 16); }
