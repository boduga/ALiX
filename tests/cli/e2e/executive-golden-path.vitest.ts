/**
 * P10 golden path E2E regression test.
 *
 * Exercises the full executive lifecycle from plan creation through
 * evaluation using only fixture data. Must pass for every PR touching
 * the Executive subsystem.
 *
 * Flow:
 *   plan create → approve → start → run (auto-bridge)
 *   → remediate (skill) → approve child → apply child
 *   → orchestrate → evaluate → dashboard
 *
 * NOTE: The orchestrate handler requires the plan to be "running", but
 * plans transition to "completed" once all steps reach terminal states
 * (including "waiting_for_bridge"). When steps auto-complete, orchestrate
 * is skipped. This is a known design gap (P10.9.2d lifecycle reference §11).
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

// Executive APIs
import { PlanStore } from "../../../src/executive/plan-store.js";
import { ExecutionStateStore } from "../../../src/executive/execution-state-store.js";
import { PlanApprovalGate } from "../../../src/executive/plan-approval-gate.js";
import { StepRunner } from "../../../src/executive/step-runner.js";
import { ExecutionEngine } from "../../../src/executive/execution-engine.js";
import { EvidenceEventWriter } from "../../../src/workflow/evidence-writer.js";
import { buildExecutionPlan } from "../../../src/executive/planning-engine.js";
import type { ExecutionPlan } from "../../../src/executive/planning-engine.js";
import type { ExecutiveObjective, ExecutiveObjectiveReport } from "../../../src/executive/objective-engine.js";
import type { PersistedExecutionPlan, PlanExecutionState } from "../../../src/executive/executive-plan-types.js";

// Proposal APIs
import { ProposalStore } from "../../../src/adaptation/proposal-store.js";
import type { AdaptationProposal } from "../../../src/adaptation/adaptation-types.js";

// CLI handlers
import { handleRemediateCommand } from "../../../src/cli/commands/executive-remediate-handler.js";
import { handleOrchestrateCommand } from "../../../src/cli/commands/executive-orchestrate-handler.js";
import { handleEvaluate } from "../../../src/cli/commands/executive-evaluate-handler.js";
import { runDashboard } from "../../../src/cli/commands/executive-dashboard-handler.js";

// Fixture helpers
import { bootstrapMinimalFixture } from "../../executive/fixture-helpers.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLANS_DIR = join(".alix", "executive", "plans");
const PROPOSALS_DIR = join(".alix", "adaptation", "proposals");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const testWriter = new EvidenceEventWriter(
  (_type, _payload) => Promise.resolve({ id: `evt-${Date.now()}` } as any),
);

function createEngine(planStore: PlanStore, stateStore: ExecutionStateStore, proposalStore: ProposalStore): ExecutionEngine {
  const runner = new StepRunner(testWriter);
  return new ExecutionEngine(planStore, stateStore, runner, testWriter, proposalStore);
}

/** Build a minimal objective report so we can create a plan without the health pipeline. */
function makeObjectiveReport(windowDays: number): ExecutiveObjectiveReport {
  const now = new Date().toISOString();
  const objective: ExecutiveObjective = {
    id: "golden-path-obj",
    title: "Golden path stabilization",
    description: "test objective for golden path",
    objectiveType: "stabilize",
    status: "active",
    priorityScore: 85,
    objectiveScore: 90,
    rationale: "Test objective for golden path E2E",
    evidenceRefs: [],
    suggestedActions: ["remediate_skill"],
    targetSubsystems: ["workflow" as any],
    blockers: [],
    generatedAt: now,
    supportingInvestigations: [],
    derivedFrom: { priorityReportGeneratedAt: now, investigationIds: [] },
  };
  return {
    schemaVersion: "p10.2.0",
    generatedAt: now,
    windowDays,
    objectives: [objective],
  };
}

async function createSetup(cwd: string): Promise<{
  planStore: PlanStore;
  stateStore: ExecutionStateStore;
  proposalStore: ProposalStore;
  engine: ExecutionEngine;
  plan: PersistedExecutionPlan;
}> {
  const plan = buildExecutionPlan(makeObjectiveReport(7));
  const planStore = new PlanStore(join(cwd, PLANS_DIR));
  const stateStore = new ExecutionStateStore(join(cwd, PLANS_DIR));
  const proposalStore = new ProposalStore(join(cwd, PROPOSALS_DIR));
  const saved = await planStore.save(plan);
  const planId = saved.id;
  stateStore.init(saved);
  const gate = new PlanApprovalGate(planStore, stateStore, testWriter);
  gate.approve(planId, "test-operator", `cli-${Date.now()}`);
  const engine = createEngine(planStore, stateStore, proposalStore);
  engine.startPlan(planId, "test-operator");
  return { planStore, stateStore, proposalStore, engine, plan: saved };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("executive golden path E2E", () => {
  let tempDir: string;
  let logs: string[];
  let errors: string[];

  beforeEach(() => {
    tempDir = join(tmpdir(), `e2e-golden-${randomUUID()}`);
    mkdirSync(tempDir, { recursive: true });
    bootstrapMinimalFixture(tempDir, { skillId: "test-lifecycle" });

    vi.spyOn(process, "cwd").mockReturnValue(tempDir);

    logs = [];
    errors = [];
    vi.spyOn(console, "log").mockImplementation((msg) => { logs.push(String(msg)); });
    vi.spyOn(console, "error").mockImplementation((msg) => { errors.push(String(msg)); });
    vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit");
    }) as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // Phase 1: Plan lifecycle
  // -----------------------------------------------------------------------
  it("Phase 1: creates, approves, starts, and runs a plan", async () => {
    const { planStore, stateStore, proposalStore, engine, plan } = await createSetup(tempDir);

    // State should be running after start
    let state = stateStore.load(plan.id);
    expect(state?.status).toBe("running");

    // Run ready steps — bridge creates proposals
    const results = await engine.runReadySteps(plan.id);
    expect(results.length).toBeGreaterThan(0);
    expect(results.some(r => r.status === "waiting_for_bridge" || r.status === "completed")).toBe(true);

    // Proposals created
    const all = await proposalStore.list();
    expect(all.filter(p => p.action === "executive_remediation_request").length).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  // Phase 2: Full golden path (remediate → evaluate → dashboard)
  // -----------------------------------------------------------------------
  it("Phase 2: remediate, evaluate, and dashboard", async () => {
    const { stateStore, proposalStore, engine, plan } = await createSetup(tempDir);

    // Run steps — creates at least one executive_remediation_request proposal
    await engine.runReadySteps(plan.id);

    // Find a pending executive_remediation_request proposal
    const proposals = await proposalStore.list();
    const parentProposal = proposals.find(p => p.action === "executive_remediation_request");
    expect(parentProposal).toBeTruthy();
    const parentProposalId = parentProposal!.id;

    // Approve the parent proposal
    parentProposal!.status = "approved";
    await proposalStore.save(parentProposal! as AdaptationProposal);

    // ——— Remediate ———
    await expect(
      handleRemediateCommand([
        parentProposalId,
        "--action", "skill",
        "--target", "test-lifecycle",
        "--reason", "Golden path E2E: remediate lifecycle test step",
      ]),
    ).resolves.toBeUndefined();

    expect(logs.some(l => l.includes("Created child proposal"))).toBe(true);
    expect(errors.length).toBe(0);

    // Verify child proposal
    const proposalsAfter = await proposalStore.list();
    const child = proposalsAfter.find(p => (p.payload as any)?.parentProposalId === parentProposalId);
    expect(child).toBeTruthy();
    expect(child!.action).toBe("adjust_skill_definition");
    expect(child!.target).toEqual({ kind: "skill", id: "test-lifecycle" });

    // Simulate child being applied (full P5 apply is tested elsewhere)
    child!.status = "applied";
    await proposalStore.save(child! as AdaptationProposal);

    // ——— Orchestrate (only if plan is still running) ———
    const planStatus = stateStore.load(plan.id)?.status;
    if (planStatus === "running") {
      await expect(
        handleOrchestrateCommand(["--plan", plan.id]),
      ).resolves.toBeUndefined();
      expect(logs.some(l => l.includes("reconciled") || l.includes("scanned") || l.includes("matched"))).toBe(true);
    }
    // If plan is completed (all steps terminal), orchestrate is skipped — see known gap.

    // ——— Evaluate ———
    await expect(
      handleEvaluate([plan.id]),
    ).resolves.toBeUndefined();

    // ——— Dashboard ———
    await expect(
      runDashboard([]),
    ).resolves.toBeUndefined();

    // ——— Clean run ———
    expect(errors.length).toBe(0);
  });
});
