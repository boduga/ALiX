// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import type { CapabilityLifecycleLedger } from "./capability-lifecycle-ledger.js";
import { toExecutionProposal } from "./capability-execution-projection.js";
import { CapabilityLifecycleStepExecutor } from "./capability-lifecycle-step-executor.js";
import { authorizeExecution } from "../execution/execution-authorization.js";
import { createExecutionPlan, createDefaultRollbackResolver } from "../execution/execution-planner.js";
import { GovernedExecutionRuntime } from "../execution/execution-runtime.js";
import type { ExecutionEnvironment, ExecutionRequest } from "../execution/contracts/execution-contract.js";
import type { CapabilityRegistry } from "../../capability/registry.js";
import { CapabilityNotExecutableError } from "./errors.js";

export interface CapabilityApplierDeps {
  ledger: CapabilityLifecycleLedger;
  registry: CapabilityRegistry;
  runtime?: GovernedExecutionRuntime;
  resolver?: ReturnType<typeof createDefaultRollbackResolver>;
  requestId?: string;
  environment?: ExecutionEnvironment;
}

export type ApplyResult =
  | { status: "applied"; executionId: string }
  | { status: "blocked"; reason: string };

export class CapabilityLifecycleApplier {
  private executor?: CapabilityLifecycleStepExecutor;
  constructor(private readonly deps: CapabilityApplierDeps) {}

  async apply(capabilityId: string): Promise<ApplyResult> {
    const { ledger, registry } = this.deps;
    // The latest DECIDED record is the authoritative rehydration source. Resolving
    // by eventType (not raw listLatestForCapability) keeps a re-apply flowing into
    // authorizeExecution check 7 once an `applied` record is the file tail.
    const all = await ledger.listByCapability(capabilityId);
    const latest = [...all].reverse().find((r) => r.eventType === "decided") ?? null;
    if (!latest) {
      return { status: "blocked", reason: `No decided transition for ${capabilityId}` };
    }
    if (latest.decisionKind !== "APPROVE") {
      return { status: "blocked", reason: `Decision for ${capabilityId} is ${latest.decisionKind}, not APPROVE` };
    }
    if (latest.intent === "register" || latest.intent === "modify") {
      return { status: "blocked", reason: new CapabilityNotExecutableError(latest.intent).message };
    }
    // The overlay is a projection over registered capabilities (spec §8) — a
    // transition can only be applied to one the registry knows. Placed after the
    // register/modify check so a deferred intent reports not-executable first.
    if (!registry.find(capabilityId)) {
      return { status: "blocked", reason: `Capability ${capabilityId} is not registered — A7.1 apply requires the capability to exist in the registry` };
    }
    if (!latest.decision) {
      return { status: "blocked", reason: `Decided record for ${capabilityId} has no persisted decision (A7.1 requires it)` };
    }

    // Authoritative rehydration
    let proposal;
    try { proposal = toExecutionProposal(latest); } catch (err) {
      return { status: "blocked", reason: err instanceof Error ? err.message : String(err) };
    }

    // Dedup: decisionIds already applied for this capability
    const completedExecutionIds = all.filter((r) => r.eventType === "applied" && r.decisionId).map((r) => r.decisionId!);

    const request: ExecutionRequest = {
      requestId: this.deps.requestId ?? `req-${capabilityId}`,
      evolutionId: proposal.evolutionId,
      requestedBy: "alix",
      requestedAt: new Date().toISOString(),
    };

    const auth = authorizeExecution({ request, proposal, decision: latest.decision, completedExecutionIds });
    if (!auth.allowed) {
      return { status: "blocked", reason: auth.reason };
    }

    // Pre-state snapshot captured immediately before execution — NEVER recalculated.
    const preState = new Map<string, import("../../adaptation/capability-evolution-types.js").LifecycleState | undefined>();
    preState.set(latest.target.capabilityId, registry.getLifecycleState(latest.target.capabilityId));
    for (const rel of latest.target.relatedCapabilityIds ?? []) {
      preState.set(rel, registry.getLifecycleState(rel));
    }

    const env = this.deps.environment ?? {
      environmentId: "a7-capability", environmentHash: "a7-capability",
      runtimeVersion: "1.0.0", agentConfiguration: {}, baselineMetrics: {},
      capabilityFingerprint: "a7",
    };
    const resolver = this.deps.resolver ?? createDefaultRollbackResolver();
    const plan = createExecutionPlan(proposal, latest.decision, env, resolver);
    const executor = new CapabilityLifecycleStepExecutor(registry, preState);
    this.executor = executor;
    const runtime = this.deps.runtime ?? new GovernedExecutionRuntime();
    const report = await runtime.execute(plan, executor);

    if (report.status !== "completed") {
      executor.rollbackApplied();
      return { status: "blocked", reason: `Execution ${report.status}` };
    }

    // COMMIT POINT — the applied ledger append
    try {
      const appliedRecord = {
        target: { ...latest.target },
        intent: latest.intent,
        eventType: "applied" as const,
        timestamp: new Date().toISOString(),
        proposalId: latest.proposalId,
        decisionId: latest.decisionId,
        executionId: report.executionId,
        evidenceRefs: [...latest.evidenceRefs],
        observedLifecycleState: latest.observedLifecycleState,
        proposedLifecycleState: latest.proposedLifecycleState,
      };
      await ledger.append(appliedRecord);
      return { status: "applied", executionId: report.executionId };
    } catch (err) {
      executor.rollbackApplied(); // compensating rollback — restore pre-state
      throw new Error(`Ledger append failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  rollbackApplied(): void { this.executor?.rollbackApplied(); }
}
