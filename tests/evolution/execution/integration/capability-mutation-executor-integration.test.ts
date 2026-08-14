// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-6 Task 8 — full A4 flow integration: authorize → plan → runtime → executor.
 *
 * End-to-end proof of every acceptance criterion in ticket #490:
 *   1. create through A4 — complete definition published, lifecycle emerging.
 *   2. update through A4 — new immutable `id@version` (higher), old retained.
 *   3. transition through A4 — correct `from` advances; stale `from` refuses
 *      (report not completed, state unchanged).
 *   4. consolidate through A4 — target published (real definition mutation),
 *      sources deprecated.
 *   5. remove through A4 — capability gone from catalog + registry.
 *   6. rejection — invalid/stale mutation: no mutation applied, report not
 *      completed, byte-identical pre-state preserved.
 *   7. rollback — record-sink throw inside atomic boundary restores pre-state
 *      (CAP-4 fail-safe stop: mutation completes end-to-end or fails cleanly).
 *   8. evidence — `buildExecutionEvidence` produces a 64-char SHA-256
 *      integrity hash over an immutable artifact set.
 *
 * Each test gets a fresh catalog + registry via `beforeEach` (shared
 * `before` would collide on `id@version` duplicates across the five
 * mutation paths). `afterEach` cleans the temp dir.
 *
 * @module capability-mutation-executor-integration
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CapabilityCatalog } from "../../../../src/capability/canonical/catalog.js";
import { CapabilityDefinitionStore } from "../../../../src/capability/canonical/catalog-store.js";
import { CapabilityRegistry } from "../../../../src/capability/registry.js";
import { authorizeExecution } from "../../../../src/evolution/execution/execution-authorization.js";
import { createExecutionPlan } from "../../../../src/evolution/execution/execution-planner.js";
import { GovernedExecutionRuntime } from "../../../../src/evolution/execution/execution-runtime.js";
import { buildExecutionEvidence } from "../../../../src/evolution/execution/execution-evidence-bridge.js";
import {
  CapabilityMutationExecutor,
  createCapabilityRollbackResolver,
  toCapabilityMutationChange,
  type GovernanceRecordSink,
} from "../../../../src/evolution/execution/capability-mutation-executor.js";
import { computeDecisionIntegrityHash } from "../../../../src/evolution/governance/decision-engine.js";
import type { GovernanceDecision } from "../../../../src/evolution/governance/contracts/decision-contract.js";
import type { EvolutionProposal } from "../../../../src/evolution/contracts/evolution-contract.js";
import type {
  ExecutionEnvironment,
  ExecutionRequest,
  EvolutionExecutionEvidence,
} from "../../../../src/evolution/execution/contracts/execution-contract.js";
import type { CapabilityMutation } from "../../../../src/capability/mutation-contract.js";
import type { CapabilityDefinition } from "../../../../src/capability/canonical/definition.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function def(id: string, overrides: Partial<CapabilityDefinition> = {}): CapabilityDefinition {
  return {
    id,
    version: "1.0.0",
    kind: "operation" as const,
    title: `Cap ${id}`,
    description: `${id} description`,
    tags: [id.split(".").pop() ?? "x"],
    category: "files",
    risk: "low" as const,
    requiredPermissions: ["operator" as const],
    dependencies: [],
    bindings: [{ type: "tool" as const, id: `${id}-binding` }],
    ...overrides,
  };
}

let evolutionSeq = 0;
let proposalSeq = 0;
let decisionSeq = 0;

function makeProposal(evolutionId: string, mutation: CapabilityMutation): EvolutionProposal & { changes: ReturnType<typeof toCapabilityMutationChange>[] } {
  const proposalId = `prop-${++proposalSeq}`;
  const base: EvolutionProposal = {
    proposalId,
    evolutionId,
    title: `CAP-6 integration: ${mutation.operation}`,
    description: `End-to-end A4 integration: ${mutation.operation} for ${evolutionId}`,
    change: `Apply ${mutation.operation}`,
    beforeHash: null,
    afterHash: null,
    createdAt: "2026-08-11T00:00:00.000Z",
  };
  return Object.assign(base, { changes: [toCapabilityMutationChange(mutation)] });
}

function makeDecision(evolutionId: string, proposalId: string, kind: GovernanceDecision["kind"] = "APPROVE"): GovernanceDecision {
  const decisionId = `govd-${++decisionSeq}-${evolutionId}`;
  const base: Omit<GovernanceDecision, "integrityHash"> = {
    decisionId,
    proposalId,
    evolutionId,
    kind,
    confidence: 0.95,
    reasoning: "CAP-6 A4 integration test approval",
    risks: [],
    evidenceId: `evd-${evolutionId}`,
    recommendationAvailable: false,
    followedRecommendation: false,
    policySnapshot: {
      policyName: "cap-6-integration",
      minApproveConfidence: 0.8,
      minMonitorConfidence: 0.5,
      rejectConfidenceThreshold: 0.3,
      maxAllowedRegressions: 0,
      escalateBehavior: "request_evidence",
      failClosedOnExpiredEvidence: true,
      minReproducibilityLevel: 2,
    },
    targetState: kind === "APPROVE" ? "APPROVED" : kind === "REJECT" ? "REJECTED" : "UNDER_REVIEW",
    decidedAt: "2026-08-11T00:00:00.000Z",
    decidedBy: "operator",
  };
  return { ...base, integrityHash: computeDecisionIntegrityHash(base) };
}

function makeRequest(evolutionId: string): ExecutionRequest {
  return {
    requestId: `req-${evolutionId}`,
    evolutionId,
    requestedBy: "cap6-integration-test",
    requestedAt: "2026-08-11T00:00:00.000Z",
    reason: "CAP-6 Task 8 A4 end-to-end",
  };
}

function makeEnvironment(evolutionId: string): ExecutionEnvironment {
  return {
    environmentId: `env-${evolutionId}`,
    environmentHash: `envhash-${evolutionId}`,
    runtimeVersion: "1.0.0",
    agentConfiguration: {},
    baselineMetrics: {},
    capabilityFingerprint: `cfp-${evolutionId}`,
  };
}

// Single mutation's full A4 flow; returns the report, plan, etc. for assertions.
async function runMutation(
  catalog: CapabilityCatalog,
  registry: CapabilityRegistry,
  mutation: CapabilityMutation,
  record?: (r: unknown) => Promise<void> | void,
  kind: GovernanceDecision["kind"] = "APPROVE",
): Promise<{
  report: Awaited<ReturnType<GovernedExecutionRuntime["execute"]>>;
  executor: CapabilityMutationExecutor;
  plan: ReturnType<typeof createExecutionPlan>;
  environment: ExecutionEnvironment;
  decision: GovernanceDecision;
  proposal: EvolutionProposal & { changes: ReturnType<typeof toCapabilityMutationChange>[] };
}> {
  const evolutionId = `evol-cap6-${++evolutionSeq}`;
  const proposal = makeProposal(evolutionId, mutation);
  const decision = makeDecision(evolutionId, proposal.proposalId, kind);
  const request: ExecutionRequest = makeRequest(evolutionId);
  const auth = authorizeExecution({ request, proposal, decision });
  assert.equal(
    auth.allowed,
    true,
    `authorization failed: ${"reason" in auth ? auth.reason : "n/a"}`,
  );
  const environment: ExecutionEnvironment = makeEnvironment(evolutionId);
  const sink: GovernanceRecordSink | undefined = record
    ? { record: (r) => Promise.resolve(record(r)) }
    : undefined;
  const executor = new CapabilityMutationExecutor({ catalog, registry, record: sink });
  const plan = createExecutionPlan(proposal, decision, environment, createCapabilityRollbackResolver());
  const runtime = new GovernedExecutionRuntime();
  const report = await runtime.execute(plan, executor);
  return { report, executor, plan, environment, decision, proposal };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("CAP-6 A4 end-to-end", () => {
  let dir: string;
  let catalog: CapabilityCatalog;
  let registry: CapabilityRegistry;
  // Track sink calls; tests inspect what executor committed.
  const recorded: unknown[] = [];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cap6-int-"));
    catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
    registry = new CapabilityRegistry(catalog);
    recorded.length = 0;
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  // -----------------------------------------------------------------------
  // AC #1 — create through A4
  // -----------------------------------------------------------------------
  it("create: approved mutation publishes complete definition; no fail-dead-end", async () => {
    const { report } = await runMutation(catalog, registry, {
      operation: "capability.create",
      definition: def("tool.file.read"),
      initialLifecycle: "emerging",
    }, (r) => { recorded.push(r); });

    assert.equal(report.status, "completed");
    assert.equal(report.rollbackTriggered, false);
    const published = catalog.get("tool.file.read");
    assert.ok(published, "definition must be published to catalog");
    assert.equal(published.title, "Cap tool.file.read"); // complete, not a placeholder
    assert.equal(registry.getLifecycleState("tool.file.read"), "emerging");
    // Atomic boundary committed exactly ONE immutable artifact.
    assert.equal(recorded.length, 1);
    const result = (recorded[0] as { operation: string; artifactId: string });
    assert.equal(result.operation, "capability.create");
    assert.match(result.artifactId, /^[a-f0-9]{64}$/);
  });

  // -----------------------------------------------------------------------
  // AC #2 — update through A4
  // -----------------------------------------------------------------------
  it("update: approved mutation publishes new immutable id@version, old publication retained", async () => {
    // Seed the source publication.
    await runMutation(catalog, registry, {
      operation: "capability.create",
      definition: def("tool.file.write"),
      initialLifecycle: "emerging",
    });
    assert.equal(catalog.get("tool.file.write")!.version, "1.0.0");

    const before = catalog.list().filter((d) => d.id === "tool.file.write");
    assert.equal(before.length, 1);

    const { report } = await runMutation(catalog, registry, {
      operation: "capability.update",
      capabilityId: "tool.file.write",
      sourceVersion: "1.0.0",
      patch: { description: "updated description through A4" },
    });
    assert.equal(report.status, "completed");

    const cur = catalog.get("tool.file.write")!;
    // Description-only patch → PATCH bump (per CAP-5 #479/#480 bump matrix).
    assert.equal(cur.version, "1.0.1");
    assert.notEqual(cur.version, "1.0.0");

    const all = catalog.list().filter((d) => d.id === "tool.file.write");
    assert.equal(all.length, 2); // old 1.0.0 + new
    assert.ok(all.some((d) => d.version === "1.0.0" && d.description === "tool.file.write description"));
    assert.ok(all.some((d) => d.version === cur.version && d.description === "updated description through A4"));
  });

  // -----------------------------------------------------------------------
  // AC #3 — transition through A4 + stale `from`
  // -----------------------------------------------------------------------
  it("transition: correct from advances; stale from refuses (state unchanged)", async () => {
    await runMutation(catalog, registry, {
      operation: "capability.create",
      definition: def("tool.file.trans"),
    });
    // emerging → active is a legal transition per #481.
    const ok = await runMutation(catalog, registry, {
      operation: "capability.transition",
      capabilityId: "tool.file.trans",
      from: "emerging",
      to: "active",
    });
    assert.equal(ok.report.status, "completed");
    assert.equal(registry.getLifecycleState("tool.file.trans"), "active");

    // active → mature is legal; this one should also complete.
    const mature = await runMutation(catalog, registry, {
      operation: "capability.transition",
      capabilityId: "tool.file.trans",
      from: "active",
      to: "mature",
    });
    assert.equal(mature.report.status, "completed");
    assert.equal(registry.getLifecycleState("tool.file.trans"), "mature");

    // Stale `from` — A4 must refuse; report not "completed", state unchanged.
    const stale = await runMutation(catalog, registry, {
      operation: "capability.transition",
      capabilityId: "tool.file.trans",
      from: "emerging", // current state is mature
      to: "active",
    });
    assert.notEqual(stale.report.status, "completed");
    assert.equal(registry.getLifecycleState("tool.file.trans"), "mature");
  });

  // -----------------------------------------------------------------------
  // AC #4 — consolidate through A4 (real definition mutation)
  // -----------------------------------------------------------------------
  it("consolidate: approved mutation publishes target definition, sources deprecated", async () => {
    await runMutation(catalog, registry, {
      operation: "capability.create",
      definition: def("tool.file.a", { dependencies: [] }),
    });
    await runMutation(catalog, registry, {
      operation: "capability.create",
      definition: def("tool.file.b", { dependencies: [] }),
    });

    const merged = def("tool.file.ab", {
      version: "1.0.0",
      dependencies: ["tool.file.a", "tool.file.b"],
      requiredPermissions: ["operator"],
      risk: "low" as const,
      bindings: [{ type: "tool" as const, id: "tool-file-ab-binding" }],
    });

    const { report } = await runMutation(catalog, registry, {
      operation: "capability.consolidate",
      sources: ["tool.file.a", "tool.file.b"],
      target: "tool.file.ab",
      definition: merged,
      sourceDisposition: "deprecate",
    });

    assert.equal(report.status, "completed");
    // Target published with the proposed definition (real mutation, not a deprecate-only stub).
    const target = catalog.get("tool.file.ab")!;
    assert.ok(target, "consolidated target must be in catalog");
    assert.equal(target.title, "Cap tool.file.ab");
    assert.deepEqual(target.dependencies, ["tool.file.a", "tool.file.b"]);
    // Sources deprecate (lifecycle) — they remain in catalog but their state moves to deprecated.
    assert.equal(registry.getLifecycleState("tool.file.a"), "deprecated");
    assert.equal(registry.getLifecycleState("tool.file.b"), "deprecated");
  });

  // -----------------------------------------------------------------------
  // AC #5 — remove through A4
  // -----------------------------------------------------------------------
  it("remove: approved mutation removes capability from catalog + registry", async () => {
    await runMutation(catalog, registry, {
      operation: "capability.create",
      definition: def("tool.file.rm"),
    });
    assert.ok(catalog.has("tool.file.rm"));
    assert.ok(registry.get("tool.file.rm"));

    const { report } = await runMutation(catalog, registry, {
      operation: "capability.remove",
      capabilityId: "tool.file.rm",
      reason: "obsolete after consolidation",
    });

    assert.equal(report.status, "completed");
    assert.equal(catalog.has("tool.file.rm"), false);
    assert.equal(registry.get("tool.file.rm"), undefined);
  });

  // -----------------------------------------------------------------------
  // AC #6 — rejection: stale transition does not mutate
  // -----------------------------------------------------------------------
  it("rejection: invalid/stale mutation leaves catalog + registry byte-identical", async () => {
    await runMutation(catalog, registry, {
      operation: "capability.create",
      definition: def("tool.file.rej"),
    });
    const catBefore = JSON.stringify(catalog.list());
    const regBefore = JSON.stringify(registry.listLifecycleStates());

    // Stale transition: capability is in emerging, request asks from "deprecated".
    const { report } = await runMutation(catalog, registry, {
      operation: "capability.transition",
      capabilityId: "tool.file.rej",
      from: "deprecated",
      to: "active",
    });

    // A4 refused: report did NOT complete; the catalog/registry state must be
    // byte-identical to before.
    assert.notEqual(report.status, "completed");
    assert.equal(JSON.stringify(catalog.list()), catBefore);
    assert.equal(JSON.stringify(registry.listLifecycleStates()), regBefore);
  });

  // -----------------------------------------------------------------------
  // AC #7 — rollback on record-sink failure (no dead-end state)
  // -----------------------------------------------------------------------
  it("rollback: record-sink throw inside atomic boundary restores pre-state, A4 reports rolled_back", async () => {
    await runMutation(catalog, registry, {
      operation: "capability.create",
      definition: def("tool.file.rb"),
    });
    const catBefore = JSON.stringify(catalog.list());
    const regBefore = JSON.stringify(registry.listLifecycleStates());

    // A record sink that throws AFTER the durable mutation — the executor
    // must restore pre-state inside the boundary, and the runtime must
    // surface that as a `rolled_back` report (NOT leave the system in
    // an undetected fail-dead-end state).
    const throwingSink = async (): Promise<void> => { throw new Error("sink boom"); };
    const { report, executor } = await runMutation(
      catalog,
      registry,
      {
        operation: "capability.transition",
        capabilityId: "tool.file.rb",
        from: "emerging",
        to: "active",
      },
      throwingSink,
    );

    assert.equal(report.status, "rolled_back");
    assert.equal(report.rollbackTriggered, true);
    assert.ok(report.rollbackResult, "rollback result must exist");
    // Pre-state restored byte-identical. (catalog unchanged — only lifecycle flips.)
    assert.equal(JSON.stringify(catalog.list()), catBefore);
    assert.equal(JSON.stringify(registry.listLifecycleStates()), regBefore);
    // And the executor must be able to re-run a mutation successfully afterward
    // (no corrupted internal state from the failed attempt).
    const executor2 = new CapabilityMutationExecutor({ catalog, registry });
    const ok = await executor2.executeStep(
      {
        stepId: "s2",
        operation: "capability.transition",
        parameters: {
          operation: "capability.transition",
          capabilityId: "tool.file.rb",
          from: "emerging",
          to: "active",
        },
        idempotent: false,
        preconditions: {},
        postconditions: {},
      },
      {},
    );
    assert.equal(ok.success, true);
    void executor;
  });

  // -----------------------------------------------------------------------
  // AC #8 — immutable artifacts + evidence bridge
  // -----------------------------------------------------------------------
  it("immutable artifacts + evidence: result is deep-frozen, evidence hash is 64-char SHA-256", async () => {
    const { report, plan, environment, decision, proposal, executor } = await runMutation(
      catalog,
      registry,
      { operation: "capability.create", definition: def("tool.file.ev") },
      (r) => { recorded.push(r); },
    );
    assert.equal(report.status, "completed");

    // Read the recorded immutable artifact from the running executor.
    // `runMutation` registered the sink with the same closure that fills
    // `recorded`, but we need the artifact object; fetch via a fresh
    // transition sink that simply re-publishes it.
    const result = recorded[recorded.length - 1] as {
      artifactId: string;
      operation: string;
      mutation: unknown;
      preState: unknown;
      post: unknown;
    };
    assert.ok(Object.isFrozen(result), "the result artifact must be deep-frozen");
    assert.ok(Object.isFrozen(result.mutation), "the mutation field must be frozen");
    assert.ok(Object.isFrozen(result.preState), "the preState field must be frozen");
    assert.ok(Object.isFrozen(result.post), "the post field must be frozen");
    assert.match(result.artifactId, /^[a-f0-9]{64}$/);

    // Bridge: build evidence from plan + report + decision + proposal + environment.
    const evidence: EvolutionExecutionEvidence = buildExecutionEvidence({
      executionPlan: plan,
      executionReport: report,
      environment,
      decision,
      proposal,
    });
    assert.equal(evidence.evidenceClass, "executed");
    assert.equal(evidence.proposalId, proposal.proposalId);
    assert.equal(evidence.decisionId, decision.decisionId);
    assert.equal(evidence.executionPlan.planId, plan.planId);
    assert.equal(evidence.executionReport.reportId, report.reportId);
    assert.match(evidence.integrityHash, /^[a-f0-9]{64}$/);
    // Lineage chain anchors every artifact in the evidence.
    assert.ok(evidence.lineage.length >= 4);
    void executor;
  });
});
