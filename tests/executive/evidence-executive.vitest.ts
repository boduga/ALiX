/**
 * P10.4a — Executive evidence event writer tests.
 *
 * Covers all 9 executive evidence event types added in Task 2.
 * Uses the appendEvent pattern (no issueNumber), matching the
 * governance mutation evidence pattern.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { EvidenceStore } from "../../src/security/evidence/evidence-store.js";
import {
  EvidenceEventWriter,
  type ExecutivePlanSavedPayload,
  type ExecutivePlanApprovedPayload,
  type ExecutivePlanRejectedPayload,
  type ExecutivePlanStartedPayload,
  type ExecutiveStepExecutedPayload,
  type ExecutiveStepIntentRecordedPayload,
  type ExecutiveStepBlockedPayload,
  type ExecutivePlanCompletedPayload,
  type ExecutivePlanFailedPayload,
} from "../../src/workflow/evidence-writer.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDir(): string {
  const dir = join("/tmp", "ev-exec-" + randomUUID().slice(0, 8));
  mkdirSync(dir, { recursive: true, mode: 0o755 });
  return dir;
}

function makeFixture(): { writer: EvidenceEventWriter; store: EvidenceStore; dir: string } {
  const dir = tmpDir();
  const store = new EvidenceStore({ storeDir: dir });
  const writer = new EvidenceEventWriter(
    (type, payload) => store.append(type, payload),
  );
  return { writer, store, dir };
}

describe("Executive evidence events", () => {
  let dir: string;
  let store: EvidenceStore;
  let writer: EvidenceEventWriter;

  beforeEach(() => {
    const f = makeFixture();
    dir = f.dir;
    store = f.store;
    writer = f.writer;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe("executive_plan_saved", () => {
    it("records plan saved with content hash", async () => {
      const payload: ExecutivePlanSavedPayload = {
        planId: "plan-1",
        contentHash: "abc123hash",
        stepCount: 5,
        executionId: "exec-1",
      };
      const r = await writer.recordExecutivePlanSaved(payload);
      expect(r).not.toBeNull();
      expect(r!.type).toBe("executive_plan_saved");
      expect(r!.payload.planId).toBe("plan-1");
      expect(r!.payload.contentHash).toBe("abc123hash");
      expect(r!.payload.stepCount).toBe(5);
      expect(r!.payload.executionId).toBe("exec-1");
    });
  });

  describe("executive_plan_approved", () => {
    it("records plan approved with approver", async () => {
      const payload: ExecutivePlanApprovedPayload = {
        planId: "plan-1",
        approvedBy: "human-operator",
        executionId: "exec-1",
      };
      const r = await writer.recordExecutivePlanApproved(payload);
      expect(r).not.toBeNull();
      expect(r!.type).toBe("executive_plan_approved");
      expect(r!.payload.planId).toBe("plan-1");
      expect(r!.payload.approvedBy).toBe("human-operator");
    });
  });

  describe("executive_plan_rejected", () => {
    it("records plan rejected with reason", async () => {
      const payload: ExecutivePlanRejectedPayload = {
        planId: "plan-1",
        rejectedBy: "human-operator",
        reason: "Scope too large",
        executionId: "exec-1",
      };
      const r = await writer.recordExecutivePlanRejected(payload);
      expect(r).not.toBeNull();
      expect(r!.type).toBe("executive_plan_rejected");
      expect(r!.payload.reason).toBe("Scope too large");
      expect(r!.payload.rejectedBy).toBe("human-operator");
    });
  });

  describe("executive_plan_started", () => {
    it("records plan started with runnable step count", async () => {
      const payload: ExecutivePlanStartedPayload = {
        planId: "plan-1",
        runnableStepCount: 4,
        executionId: "exec-1",
      };
      const r = await writer.recordExecutivePlanStarted(payload);
      expect(r).not.toBeNull();
      expect(r!.type).toBe("executive_plan_started");
      expect(r!.payload.runnableStepCount).toBe(4);
    });
  });

  describe("executive_step_executed", () => {
    it("records step executed with duration", async () => {
      const payload: ExecutiveStepExecutedPayload = {
        planId: "plan-1",
        stepId: "step-1",
        action: "read_file",
        durationMs: 150,
        summary: "Read config file successfully",
        executionId: "exec-1",
      };
      const r = await writer.recordExecutiveStepExecuted(payload);
      expect(r).not.toBeNull();
      expect(r!.type).toBe("executive_step_executed");
      expect(r!.payload.stepId).toBe("step-1");
      expect(r!.payload.action).toBe("read_file");
      expect(r!.payload.durationMs).toBe(150);
      expect(r!.payload.summary).toBe("Read config file successfully");
    });

    it("allows optional summary to be omitted", async () => {
      const payload: ExecutiveStepExecutedPayload = {
        planId: "plan-1",
        stepId: "step-2",
        action: "stat_files",
        durationMs: 45,
        executionId: "exec-1",
      };
      const r = await writer.recordExecutiveStepExecuted(payload);
      expect(r).not.toBeNull();
      expect(r!.type).toBe("executive_step_executed");
      expect(r!.payload.summary).toBeUndefined();
    });
  });

  describe("executive_step_intent_recorded", () => {
    it("records step intent with behavior class", async () => {
      const payload: ExecutiveStepIntentRecordedPayload = {
        planId: "plan-1",
        stepId: "step-3",
        action: "create_improvement_issue",
        behaviorClass: "mutation",
        executionId: "exec-1",
      };
      const r = await writer.recordExecutiveStepIntentRecorded(payload);
      expect(r).not.toBeNull();
      expect(r!.type).toBe("executive_step_intent_recorded");
      expect(r!.payload.action).toBe("create_improvement_issue");
      expect(r!.payload.behaviorClass).toBe("mutation");
    });
  });

  describe("executive_step_blocked", () => {
    it("records step blocked with dependency list", async () => {
      const payload: ExecutiveStepBlockedPayload = {
        planId: "plan-1",
        stepId: "step-4",
        blockedBy: ["step-1", "step-2"],
        executionId: "exec-1",
      };
      const r = await writer.recordExecutiveStepBlocked(payload);
      expect(r).not.toBeNull();
      expect(r!.type).toBe("executive_step_blocked");
      expect(r!.payload.stepId).toBe("step-4");
      expect(r!.payload.blockedBy).toEqual(["step-1", "step-2"]);
    });
  });

  describe("executive_plan_completed", () => {
    it("records plan completed with total duration", async () => {
      const payload: ExecutivePlanCompletedPayload = {
        planId: "plan-1",
        totalDurationMs: 12500,
        executionId: "exec-1",
      };
      const r = await writer.recordExecutivePlanCompleted(payload);
      expect(r).not.toBeNull();
      expect(r!.type).toBe("executive_plan_completed");
      expect(r!.payload.totalDurationMs).toBe(12500);
    });
  });

  describe("executive_plan_failed", () => {
    it("records plan failed with reason", async () => {
      const payload: ExecutivePlanFailedPayload = {
        planId: "plan-1",
        reason: "Step 3 exhausted retries",
        executionId: "exec-1",
      };
      const r = await writer.recordExecutivePlanFailed(payload);
      expect(r).not.toBeNull();
      expect(r!.type).toBe("executive_plan_failed");
      expect(r!.payload.reason).toBe("Step 3 exhausted retries");
    });
  });

  describe("evidence chain integrity", () => {
    it("produces verifiable evidence across all 9 event types", async () => {
      const execId = "exec-full";

      await writer.recordExecutivePlanSaved({
        planId: "plan-full", contentHash: "hash", stepCount: 3, executionId: execId,
      });
      await writer.recordExecutivePlanApproved({
        planId: "plan-full", approvedBy: "human", executionId: execId,
      });
      await writer.recordExecutivePlanRejected({
        planId: "plan-full", rejectedBy: "human", reason: "test rejection", executionId: execId,
      });
      await writer.recordExecutivePlanStarted({
        planId: "plan-full", runnableStepCount: 2, executionId: execId,
      });
      await writer.recordExecutiveStepExecuted({
        planId: "plan-full", stepId: "s1", action: "read_file", durationMs: 10, executionId: execId,
      });
      await writer.recordExecutiveStepIntentRecorded({
        planId: "plan-full", stepId: "s2", action: "create_issue", behaviorClass: "mutation", executionId: execId,
      });
      await writer.recordExecutiveStepBlocked({
        planId: "plan-full", stepId: "s2", blockedBy: ["s1"], executionId: execId,
      });
      await writer.recordExecutivePlanCompleted({
        planId: "plan-full", totalDurationMs: 100, executionId: execId,
      });
      await writer.recordExecutivePlanFailed({
        planId: "plan-full", reason: "test failure", executionId: execId,
      });

      const result = await store.verify();
      expect(result.ok).toBe(true);
      expect(result.total).toBe(9);
    });
  });

  describe("query by type", () => {
    it("filters executive events by type", async () => {
      await writer.recordExecutivePlanSaved({
        planId: "pq", contentHash: "h", stepCount: 1, executionId: "e",
      });
      await writer.recordExecutivePlanSaved({
        planId: "pq2", contentHash: "h2", stepCount: 2, executionId: "e2",
      });
      await writer.recordExecutivePlanApproved({
        planId: "pq", approvedBy: "human", executionId: "e",
      });

      const saved = await store.query({ type: "executive_plan_saved" });
      expect(saved.records.length).toBe(2);

      const approved = await store.query({ type: "executive_plan_approved" });
      expect(approved.records.length).toBe(1);
    });
  });

  describe("fingerprint and metadata", () => {
    it("every executive event has a fingerprint and timestamp", async () => {
      const r = await writer.recordExecutivePlanStarted({
        planId: "plan-fp", runnableStepCount: 1, executionId: "exec-fp",
      });
      expect(r).not.toBeNull();
      expect(r!.fingerprint).toBeTruthy();
      expect(r!.timestamp).toBeTruthy();
      expect(r!.version).toBe(1);
    });
  });

  describe("error resilience", () => {
    it("returns null when store append fails", async () => {
      const failingAppend = async () => {
        throw new Error("store unavailable");
      };
      const writer = new EvidenceEventWriter(failingAppend as any);

      const r = await writer.recordExecutivePlanSaved({
        planId: "plan-err", contentHash: "h", stepCount: 1, executionId: "exec-err",
      });
      expect(r).toBeNull();
    });
  });
});
