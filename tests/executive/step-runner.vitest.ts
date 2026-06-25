import { describe, it, expect, vi, beforeEach } from "vitest";
import { StepRunner } from "../../src/executive/step-runner.js";
import type { EvidenceEventWriter } from "../../src/workflow/evidence-writer.js";
import type { ExecutionStep } from "../../src/executive/planning-engine.js";
import type { StepRunnerResult } from "../../src/executive/executive-plan-types.js";

function makeStep(overrides: Partial<ExecutionStep> & { id: string; action: ExecutionStep["action"] }): ExecutionStep {
  return {
    id: overrides.id,
    action: overrides.action,
    title: overrides.title ?? "Test step",
    stepNumber: overrides.stepNumber ?? 1,
    targetSubsystem: overrides.targetSubsystem ?? "governance",
    dependsOn: overrides.dependsOn ?? [],
    status: overrides.status ?? "pending",
    objectiveId: overrides.objectiveId ?? "obj-1",
    priorityScore: overrides.priorityScore ?? 50,
    objectiveScore: overrides.objectiveScore ?? 50,
    riskLevel: overrides.riskLevel ?? "medium",
  };
}

describe("StepRunner", () => {
  let writer: EvidenceEventWriter;
  let runner: StepRunner;

  beforeEach(() => {
    writer = {
      recordExecutiveStepExecuted: vi.fn().mockResolvedValue({ id: "evt-1" }),
      recordExecutiveStepIntentRecorded: vi.fn().mockResolvedValue({ id: "evt-2" }),
    } as unknown as EvidenceEventWriter;
    runner = new StepRunner(writer);
  });

  it("executes a read-only step with planId", async () => {
    const step = makeStep({ id: "step-1", action: "diagnose_root_cause" });
    const result = await runner.execute("plan-1", step, "exec-1");
    expect(result.outcome).toBe("executed");
    expect(result.newStepStatus).toBe("completed");
    expect(result.warnings).toHaveLength(0);
    expect(result.retryable).toBe(false);
    expect(writer.recordExecutiveStepExecuted).toHaveBeenCalled();
    // Verify the evidence received the REAL planId, not objectiveId
    const evtCall = vi.mocked(writer.recordExecutiveStepExecuted).mock.calls[0][0];
    expect(evtCall.planId).toBe("plan-1");
  });

  it("execute audit_metrics is read-only", async () => {
    const step = makeStep({ id: "step-2", action: "audit_metrics" });
    const result = await runner.execute("plan-1", step, "exec-1");
    expect(result.outcome).toBe("executed");
    expect(result.newStepStatus).toBe("completed");
  });

  it("handles investigation step as waiting_for_bridge", async () => {
    const step = makeStep({ id: "step-3", action: "triage_investigations" });
    const result = await runner.execute("plan-1", step, "exec-1");
    expect(result.outcome).toBe("intent_recorded");
    expect(result.newStepStatus).toBe("waiting_for_bridge");
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(writer.recordExecutiveStepIntentRecorded).toHaveBeenCalled();
    const evtCall = vi.mocked(writer.recordExecutiveStepIntentRecorded).mock.calls[0][0];
    expect(evtCall.planId).toBe("plan-1");
  });

  it("handles mutation step as waiting_for_bridge", async () => {
    const step = makeStep({ id: "step-4", action: "create_remediation_proposal" });
    const result = await runner.execute("plan-1", step, "exec-1");
    expect(result.outcome).toBe("intent_recorded");
    expect(result.newStepStatus).toBe("waiting_for_bridge");
  });

  it("generates evidence IDs for read-only execution", async () => {
    const step = makeStep({ id: "step-5", action: "review_baseline_metrics" });
    const result = await runner.execute("plan-1", step, "exec-1");
    expect(result.evidenceIds.length).toBeGreaterThan(0);
  });

  it("returns retryable=false for all behaviors", async () => {
    for (const action of ["diagnose_root_cause" as const, "triage_investigations" as const, "create_remediation_proposal" as const]) {
      const step = makeStep({ id: `step-${action}`, action });
      const result = await runner.execute("plan-1", step, "exec-2");
      expect(result.retryable).toBe(false);
    }
  });

  it("all 6 read-only actions produce outcome=executed", async () => {
    const roActions: ExecutionStep["action"][] = [
      "diagnose_root_cause", "audit_metrics", "identify_optimization_targets",
      "schedule_health_check", "review_baseline_metrics", "update_documentation",
    ];
    for (const action of roActions) {
      const step = makeStep({ id: `step-${action}`, action });
      const result = await runner.execute("plan-1", step, "exec-3");
      expect(result.outcome).toBe("executed");
    }
  });

  it("all 3 investigation actions produce waiting_for_bridge", async () => {
    const invActions: ExecutionStep["action"][] = [
      "triage_investigations", "assign_investigation_ownership", "resolve_investigations",
    ];
    for (const action of invActions) {
      const step = makeStep({ id: `step-${action}`, action });
      const result = await runner.execute("plan-1", step, "exec-4");
      expect(result.newStepStatus).toBe("waiting_for_bridge");
    }
  });

  it("all 3 mutation actions produce waiting_for_bridge", async () => {
    const mutActions: ExecutionStep["action"][] = [
      "create_remediation_proposal", "apply_remediation", "implement_improvements",
    ];
    for (const action of mutActions) {
      const step = makeStep({ id: `step-${action}`, action });
      const result = await runner.execute("plan-1", step, "exec-5");
      expect(result.newStepStatus).toBe("waiting_for_bridge");
    }
  });
});
