/**
 * replan-proposal-store.test.ts — Unit tests for replan types and proposal store.
 *
 * Tests:
 * - Type constructors and helper functions
 * - Fingerprint computation (stability, determinism)
 * - Proposal store CRUD operations
 * - Atomic write integrity (tmp + rename)
 * - Status transitions with guards
 * - Impact analysis attachment
 * - List operations (by run, all)
 * - Edge cases (missing run, corrupt files, missing proposals)
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ReplanProposalStore } from "../../src/kernel/replan-proposal-store.js";
import {
  computeFingerprint,
  createTriggerEvidence,
  createDraftWorkerSpec,
  createProposalRecord,
} from "../../src/kernel/replan-types.js";
import type {
  PlanRevisionDraft,
  ProposalRecord,
  ImpactAnalysis,
  ValidationResult,
  SimulatedGraph,
  TriggerEvidence,
} from "../../src/kernel/replan-types.js";

// ─── Helpers ──────────────────────────────────────────────────────────

function makeDraft(overrides?: Partial<PlanRevisionDraft>): PlanRevisionDraft {
  return {
    triggerKind: "worker_completed",
    triggerEvidence: createTriggerEvidence({
      workerId: "worker-1",
      findingIds: ["finding-1"],
      conflictIds: [],
      reason: "Worker completed successfully",
    }),
    workersToAdd: [],
    workersToReplace: [],
    workersToCancel: [],
    workersToModify: [],
    dependencyRewiring: [],
    expectedBenefit: "Improved parallelism",
    confidence: 0.85,
    unresolvedConcerns: [],
    ...overrides,
  };
}

function makeImpactAnalysis(overrides?: Partial<ImpactAnalysis>): ImpactAnalysis {
  return {
    riskLevel: "low",
    agentsAssigned: 2,
    capabilitiesAdded: ["code-review"],
    capabilitiesRemoved: [],
    ownershipChanges: [],
    activeLeaseConflicts: [],
    protectedScopeViolations: [],
    policyDecisions: [],
    requiresApproval: false,
    summary: "Low risk replan with minor changes",
    ...overrides,
  };
}

function makeValidationResult(overrides?: Partial<ValidationResult>): ValidationResult {
  return {
    valid: true,
    errors: [],
    warnings: [],
    ...overrides,
  };
}

function makeSimulatedGraph(overrides?: Partial<SimulatedGraph>): SimulatedGraph {
  return {
    workers: [],
    edges: [],
    idMap: {},
    valid: true,
    errors: [],
    warnings: [],
    ...overrides,
  };
}

// ─── Types Tests ──────────────────────────────────────────────────────

describe("replan types", () => {
  describe("createTriggerEvidence", () => {
    it("creates with full fields", () => {
      const ev = createTriggerEvidence({
        workerId: "w1",
        findingIds: ["f1", "f2"],
        conflictIds: ["c1"],
        reason: "Conflict detected",
      });
      assert.equal(ev.workerId, "w1");
      assert.deepEqual(ev.findingIds, ["f1", "f2"]);
      assert.deepEqual(ev.conflictIds, ["c1"]);
      assert.equal(ev.reason, "Conflict detected");
    });

    it("defaults missing arrays to empty", () => {
      const ev = createTriggerEvidence({ workerId: "w1", reason: "test" });
      assert.deepEqual(ev.findingIds, []);
      assert.deepEqual(ev.conflictIds, []);
    });
  });

  describe("createDraftWorkerSpec", () => {
    it("creates with full fields", () => {
      const spec = createDraftWorkerSpec({
        draftWorkerId: "dw-1",
        taskLabel: "Review code",
        goalPrompt: "Review the changes",
        requiredCapabilities: ["code-review"],
        dependencies: ["dw-0"],
        verificationRequirements: ["tests-pass"],
      });
      assert.equal(spec.draftWorkerId, "dw-1");
      assert.deepEqual(spec.requiredCapabilities, ["code-review"]);
      assert.deepEqual(spec.dependencies, ["dw-0"]);
      assert.deepEqual(spec.verificationRequirements, ["tests-pass"]);
    });

    it("defaults missing arrays to empty", () => {
      const spec = createDraftWorkerSpec({
        draftWorkerId: "dw-1",
        taskLabel: "Task",
        goalPrompt: "Do it",
      });
      assert.deepEqual(spec.requiredCapabilities, []);
      assert.deepEqual(spec.dependencies, []);
      assert.deepEqual(spec.verificationRequirements, []);
    });
  });

  describe("createProposalRecord", () => {
    it("creates with full fields", () => {
      const draft = makeDraft();
      const fprint = computeFingerprint(draft);
      const rec = createProposalRecord({
        id: "prop-1",
        runId: "run-1",
        expectedPlanRevision: 2,
        trigger: "worker_completed",
        evidence: draft.triggerEvidence,
        draft,
        draftFingerprint: fprint,
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
        usage: { inputTokens: 500, outputTokens: 200, totalTokens: 700 },
      });
      assert.equal(rec.id, "prop-1");
      assert.equal(rec.runId, "run-1");
      assert.equal(rec.status, "proposed");
      assert.equal(rec.expectedPlanRevision, 2);
      assert.equal(rec.draftFingerprint, fprint);
      assert.equal(rec.provider, "anthropic");
      assert.equal(rec.model, "claude-sonnet-4-20250514");
      assert.equal(rec.usage?.totalTokens, 700);
      assert.ok(rec.createdAt);
      assert.ok(rec.updatedAt);
    });

    it("auto-generates id if not provided", () => {
      const draft = makeDraft();
      const rec = createProposalRecord({
        runId: "run-1",
        expectedPlanRevision: 1,
        trigger: "manual",
        evidence: draft.triggerEvidence,
        draft,
        draftFingerprint: "abc",
      });
      assert.ok(rec.id.startsWith("replan_proposal_"));
    });

    it("defaults validationResult and simulatedGraph", () => {
      const draft = makeDraft();
      const rec = createProposalRecord({
        runId: "run-1",
        expectedPlanRevision: 1,
        trigger: "manual",
        evidence: draft.triggerEvidence,
        draft,
        draftFingerprint: "abc",
      });
      assert.ok(rec.validationResult.valid);
      assert.deepEqual(rec.validationResult.errors, []);
      assert.ok(rec.simulatedGraph.valid);
      assert.deepEqual(rec.simulatedGraph.errors, []);
    });
  });

  describe("computeFingerprint", () => {
    it("produces deterministic SHA-256 hex string", () => {
      const obj = { foo: "bar", num: 42 };
      const h1 = computeFingerprint(obj);
      const h2 = computeFingerprint(obj);
      assert.equal(h1, h2);
      assert.equal(h1.length, 64); // SHA-256 hex
    });

    it("produces different hashes for different inputs", () => {
      const a = computeFingerprint({ a: 1 });
      const b = computeFingerprint({ a: 2 });
      assert.notEqual(a, b);
    });

    it("handles nested objects", () => {
      const nested = { a: { b: [1, 2, 3], c: { d: "deep" } } };
      const hash = computeFingerprint(nested);
      assert.equal(hash.length, 64);
    });

    it("handles empty objects and arrays", () => {
      const h1 = computeFingerprint({});
      const h2 = computeFingerprint([]);
      const h3 = computeFingerprint(null);
      assert.ok(h1.length === 64);
      assert.ok(h2.length === 64);
      assert.ok(h3.length === 64);
    });
  });
});

// ─── Proposal Store Tests ─────────────────────────────────────────────

describe("ReplanProposalStore", () => {
  let tmpDir: string;
  let store: ReplanProposalStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "replan-proposal-test-"));
    store = new ReplanProposalStore(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeRecord(overrides?: Partial<ProposalRecord>): ProposalRecord {
    const draft = makeDraft();
    return createProposalRecord({
      id: `prop_${Math.random().toString(36).slice(2)}`,
      runId: "run-test-1",
      expectedPlanRevision: 1,
      trigger: "worker_completed",
      evidence: draft.triggerEvidence,
      draft,
      draftFingerprint: computeFingerprint(draft),
      ...overrides,
    });
  }

  // ── Create & Load ─────────────────────────────────────────────────

  describe("create", () => {
    it("persists a proposal and loads it back", async () => {
      const record = makeRecord();
      const saved = await store.create(record);
      assert.equal(saved.id, record.id);
      assert.equal(saved.runId, record.runId);

      const loaded = await store.load(record.runId, record.id);
      assert.ok(loaded);
      assert.equal(loaded!.id, record.id);
      assert.equal(loaded!.draft.triggerKind, "worker_completed");
    });

    it("computes draftFingerprint if not provided", async () => {
      const draft = makeDraft();
      const record = createProposalRecord({
        runId: "run-test-1",
        expectedPlanRevision: 1,
        trigger: "manual",
        evidence: draft.triggerEvidence,
        draft,
        draftFingerprint: "", // empty string should trigger auto-compute
      });
      const saved = await store.create(record);
      assert.ok(saved.draftFingerprint);
      assert.equal(saved.draftFingerprint.length, 64);

      const loaded = await store.load(record.runId, record.id);
      assert.equal(loaded!.draftFingerprint, saved.draftFingerprint);
      assert.equal(loaded!.draftFingerprint, computeFingerprint(draft));
    });

    it("creates the run directory structure", async () => {
      const { mkdir } = await import("node:fs/promises");
      const { join } = await import("node:path");
      const { existsSync } = await import("node:fs");

      const record = makeRecord();
      await store.create(record);

      const expectedDir = join(tmpDir, ".alix", "coordination", "replans", record.runId);
      assert.ok(existsSync(expectedDir));
    });
  });

  // ── Load ───────────────────────────────────────────────────────────

  describe("load", () => {
    it("returns null for missing proposal", async () => {
      const loaded = await store.load("run-nonexistent", "prop-nonexistent");
      assert.equal(loaded, null);
    });

    it("returns null for corrupt proposal file", async () => {
      const record = makeRecord();
      await store.create(record);

      // Corrupt the file
      const { writeFileSync } = await import("node:fs");
      const path = join(tmpDir, ".alix", "coordination", "replans", record.runId, `${record.id}.json`);
      writeFileSync(path, "not valid json", "utf-8");

      const loaded = await store.load(record.runId, record.id);
      assert.equal(loaded, null);
    });
  });

  // ── Update Status ──────────────────────────────────────────────────

  describe("updateStatus", () => {
    it("updates status and timestamps", async () => {
      const record = makeRecord();
      await store.create(record);

      const updated = await store.updateStatus(record.runId, record.id, "awaiting_approval");
      assert.ok(updated);
      assert.equal(updated!.status, "awaiting_approval");
      assert.ok(new Date(updated!.updatedAt) > new Date(record.createdAt));

      const loaded = await store.load(record.runId, record.id);
      assert.equal(loaded!.status, "awaiting_approval");
    });

    it("can set error message", async () => {
      const record = makeRecord();
      await store.create(record);

      const updated = await store.updateStatus(record.runId, record.id, "failed", { error: "Validation failed" });
      assert.ok(updated);
      assert.equal(updated!.status, "failed");
      assert.equal(updated!.error, "Validation failed");
    });

    it("can set approvalId", async () => {
      const record = makeRecord();
      await store.create(record);

      const updated = await store.updateStatus(record.runId, record.id, "awaiting_approval", { approvalId: "appr_123" });
      assert.ok(updated);
      assert.equal(updated!.status, "awaiting_approval");
      assert.equal(updated!.approvalId, "appr_123");
    });

    it("returns null for missing proposal", async () => {
      const result = await store.updateStatus("run-nonexistent", "prop-nonexistent", "approved");
      assert.equal(result, null);
    });
  });

  // ── Transition Status ──────────────────────────────────────────────

  describe("transitionStatus", () => {
    it("transitions when expected status matches", async () => {
      const record = makeRecord();
      await store.create(record);

      const updated = await store.transitionStatus(record.runId, record.id, "proposed", "invalid");
      assert.ok(updated);
      assert.equal(updated!.status, "invalid");
    });

    it("returns null when expected status does not match", async () => {
      const record = makeRecord();
      await store.create(record);

      const result = await store.transitionStatus(record.runId, record.id, "approved", "applying");
      assert.equal(result, null);

      // Status unchanged
      const loaded = await store.load(record.runId, record.id);
      assert.equal(loaded!.status, "proposed");
    });

    it("returns null for missing proposal", async () => {
      const result = await store.transitionStatus("run-nonexistent", "prop-nonexistent", "proposed", "invalid");
      assert.equal(result, null);
    });

    it("supports full lifecycle transitions", async () => {
      const record = makeRecord();
      await store.create(record);

      // proposed -> awaiting_approval
      let r = await store.transitionStatus(record.runId, record.id, "proposed", "awaiting_approval", { approvalId: "appr_1" });
      assert.equal(r?.status, "awaiting_approval");

      // awaiting_approval -> approved
      r = await store.transitionStatus(record.runId, record.id, "awaiting_approval", "approved");
      assert.equal(r?.status, "approved");

      // approved -> applying
      r = await store.transitionStatus(record.runId, record.id, "approved", "applying");
      assert.equal(r?.status, "applying");

      // applying -> applied
      r = await store.transitionStatus(record.runId, record.id, "applying", "applied");
      assert.equal(r?.status, "applied");
    });
  });

  // ── Attach Impact Analysis ─────────────────────────────────────────

  describe("attachImpactAnalysis", () => {
    it("attaches impact analysis and computes fingerprint", async () => {
      const record = makeRecord();
      await store.create(record);

      const impact = makeImpactAnalysis({ riskLevel: "high", requiresApproval: true });
      const updated = await store.attachImpactAnalysis(record.runId, record.id, impact);
      assert.ok(updated);
      assert.equal(updated!.impactAnalysis.riskLevel, "high");
      assert.equal(updated!.impactAnalysis.requiresApproval, true);
      assert.ok(updated!.impactFingerprint);
      assert.equal(updated!.impactFingerprint, computeFingerprint(impact));
    });

    it("returns null for missing proposal", async () => {
      const result = await store.attachImpactAnalysis("run-nonexistent", "prop-nonexistent", makeImpactAnalysis());
      assert.equal(result, null);
    });
  });

  // ── Attach Model Metadata ──────────────────────────────────────────

  describe("attachModelMetadata", () => {
    it("attaches provider/model/usage", async () => {
      const record = makeRecord();
      await store.create(record);

      const metadata = {
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
        usage: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 },
      };
      const updated = await store.attachModelMetadata(record.runId, record.id, metadata);
      assert.ok(updated);
      assert.equal(updated!.provider, "anthropic");
      assert.equal(updated!.model, "claude-sonnet-4-20250514");
      assert.equal(updated!.usage?.totalTokens, 1500);
    });
  });

  // ── List ───────────────────────────────────────────────────────────

  describe("listByRunId", () => {
    it("lists proposals for a run newest first", async () => {
      const draft = makeDraft();
      const rec1 = makeRecord({ id: "prop-1", runId: "run-list-test" });
      const rec2 = makeRecord({ id: "prop-2", runId: "run-list-test" });
      await store.create(rec1);
      await store.create(rec2);

      const list = await store.listByRunId("run-list-test");
      assert.equal(list.length, 2);
      // newest first
      assert.ok(list[0].createdAt >= list[1].createdAt);
    });

    it("returns empty array for run with no proposals", async () => {
      const list = await store.listByRunId("run-empty");
      assert.deepEqual(list, []);
    });
  });

  describe("listAll", () => {
    it("lists proposals across all runs", async () => {
      const rec1 = makeRecord({ id: "prop-a", runId: "run-a" });
      const rec2 = makeRecord({ id: "prop-b", runId: "run-b" });
      await store.create(rec1);
      await store.create(rec2);

      const all = await store.listAll();
      assert.equal(all.length, 2);
    });

    it("returns empty when no proposals exist", async () => {
      const all = await store.listAll();
      assert.deepEqual(all, []);
    });
  });

  // ── Delete ─────────────────────────────────────────────────────────

  describe("delete", () => {
    it("deletes a proposal", async () => {
      const record = makeRecord();
      await store.create(record);

      const deleted = await store.delete(record.runId, record.id);
      assert.equal(deleted, true);

      const loaded = await store.load(record.runId, record.id);
      assert.equal(loaded, null);
    });

    it("returns false for missing proposal", async () => {
      const result = await store.delete("run-nonexistent", "prop-nonexistent");
      assert.equal(result, false);
    });
  });

  // ── Atomic Write Integrity ─────────────────────────────────────────

  describe("atomic write integrity", () => {
    it("does not leave tmp files after create", async () => {
      const record = makeRecord();
      await store.create(record);

      const dir = join(tmpDir, ".alix", "coordination", "replans", record.runId);
      const files = await import("node:fs/promises").then(f => f.readdir(dir));
      const tmpFiles = files.filter(f => f.includes(".tmp."));
      assert.equal(tmpFiles.length, 0);
    });

    it("does not leave tmp files after updateStatus", async () => {
      const record = makeRecord();
      await store.create(record);
      await store.updateStatus(record.runId, record.id, "approved");

      const dir = join(tmpDir, ".alix", "coordination", "replans", record.runId);
      const files = await import("node:fs/promises").then(f => f.readdir(dir));
      const tmpFiles = files.filter(f => f.includes(".tmp."));
      assert.equal(tmpFiles.length, 0);
    });

    it("persisted file is valid JSON", async () => {
      const record = makeRecord();
      await store.create(record);

      const path = join(tmpDir, ".alix", "coordination", "replans", record.runId, `${record.id}.json`);
      const content = await import("node:fs/promises").then(f => f.readFile(path, "utf-8"));
      assert.doesNotThrow(() => JSON.parse(content));
    });
  });

  // ── Fingerprint Verification ──────────────────────────────────────

  describe("fingerprint verification", () => {
    it("draftFingerprint matches recomputed hash", async () => {
      const record = makeRecord();
      await store.create(record);

      const loaded = await store.load(record.runId, record.id);
      const recomputed = computeFingerprint(loaded!.draft);
      assert.equal(loaded!.draftFingerprint, recomputed);
    });

    it("impactFingerprint matches recomputed hash", async () => {
      const record = makeRecord();
      await store.create(record);

      const impact = makeImpactAnalysis({ riskLevel: "medium" });
      await store.attachImpactAnalysis(record.runId, record.id, impact);

      const loaded = await store.load(record.runId, record.id);
      const recomputed = computeFingerprint(loaded!.impactAnalysis);
      assert.equal(loaded!.impactFingerprint, recomputed);
    });
  });

  // ── Edge Cases ─────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("handles proposals with different runIds in separate dirs", async () => {
      const rec1 = makeRecord({ id: "p1", runId: "run-x" });
      const rec2 = makeRecord({ id: "p2", runId: "run-y" });
      await store.create(rec1);
      await store.create(rec2);

      const listX = await store.listByRunId("run-x");
      assert.equal(listX.length, 1);
      assert.equal(listX[0].id, "p1");

      const listY = await store.listByRunId("run-y");
      assert.equal(listY.length, 1);
      assert.equal(listY[0].id, "p2");
    });

    it("propagates complete draft with all fields through persistence", async () => {
      const draft: PlanRevisionDraft = {
        triggerKind: "conflict_detected",
        triggerEvidence: createTriggerEvidence({
          workerId: "w-detector",
          findingIds: ["f1", "f2", "f3"],
          conflictIds: ["c1", "c2"],
          reason: "Ownership overlap detected",
        }),
        workersToAdd: [
          createDraftWorkerSpec({
            draftWorkerId: "dw-new",
            taskLabel: "Resolve conflict",
            goalPrompt: "Resolve the ownership conflict",
            requiredCapabilities: ["conflict-resolution"],
            dependencies: ["w-detector"],
            verificationRequirements: ["conflicts-cleared"],
          }),
        ],
        workersToReplace: [],
        workersToCancel: ["w-old"],
        workersToModify: [{ workerId: "w-existing", dependencies: ["dw-new"] }],
        dependencyRewiring: [{
          dependentWorkerRef: "w-downstream",
          removeDependencyRef: "w-old",
          addDependencyRef: "dw-new",
          reason: "Replaced by new conflict resolver",
        }],
        expectedBenefit: "Clear ownership boundaries",
        confidence: 0.92,
        unresolvedConcerns: ["May need human review"],
      };

      const record = makeRecord({ draft, draftFingerprint: computeFingerprint(draft) });
      await store.create(record);

      const loaded = await store.load(record.runId, record.id);
      assert.equal(loaded!.draft.triggerKind, "conflict_detected");
      assert.equal(loaded!.draft.triggerEvidence.workerId, "w-detector");
      assert.deepEqual(loaded!.draft.triggerEvidence.findingIds, ["f1", "f2", "f3"]);
      assert.equal(loaded!.draft.workersToAdd.length, 1);
      assert.equal(loaded!.draft.workersToAdd[0].taskLabel, "Resolve conflict");
      assert.deepEqual(loaded!.draft.workersToCancel, ["w-old"]);
      assert.equal(loaded!.draft.workersToModify.length, 1);
      assert.equal(loaded!.draft.workersToModify[0].workerId, "w-existing");
      assert.equal(loaded!.draft.dependencyRewiring.length, 1);
      assert.equal(loaded!.draft.dependencyRewiring[0].dependentWorkerRef, "w-downstream");
      assert.equal(loaded!.draft.confidence, 0.92);
      assert.equal(loaded!.draftFingerprint, computeFingerprint(draft));
    });

    it("skips corrupt files in list operations", async () => {
      const record = makeRecord();
      await store.create(record);

      // Write a corrupt file in the same run dir
      const dir = join(tmpDir, ".alix", "coordination", "replans", record.runId);
      writeFileSync(join(dir, "corrupt.json"), "not json", "utf-8");

      const list = await store.listByRunId(record.runId);
      assert.equal(list.length, 1); // corrupt file skipped
      assert.equal(list[0].id, record.id);
    });
  });

  // ── ProposalStatus type coverage ───────────────────────────────────

  describe("ProposalStatus lifecycle", () => {
    const ALL_STATUSES = [
      "proposed", "invalid", "awaiting_approval",
      "approved", "denied", "applying", "applied",
      "failed", "superseded",
    ] as const;

    for (const status of ALL_STATUSES) {
      it(`supports status: ${status}`, async () => {
        const record = makeRecord();
        await store.create(record);

        const updated = await store.updateStatus(record.runId, record.id, status);
        assert.equal(updated!.status, status);

        const loaded = await store.load(record.runId, record.id);
        assert.equal(loaded!.status, status);
      });
    }
  });
});
