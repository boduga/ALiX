/**
 * replan-validator.test.ts -- Unit tests for ReplanValidator.
 *
 * Covers all structural checks:
 * - Required fields (triggerKind, triggerEvidence)
 * - Known trigger kind
 * - Duplicate draftWorkerIds
 * - Unresolvable dependency references
 * - Cancel/modify/replace target existence
 *
 * All imports use .js extensions (NodeNext).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ReplanValidator } from "../../src/kernel/replan-validator.js";
import { createWorkerAssignment } from "../../src/kernel/coordination-types.js";
import type { PlanRevisionDraft } from "../../src/kernel/replan-types.js";

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeExistingWorker(id: string, deps: string[] = []) {
  return createWorkerAssignment({
    id,
    coordinationRunId: "run_1",
    agentId: "agent_a",
    taskLabel: `Worker ${id}`,
    goalPrompt: `Do ${id}`,
    dependencies: deps,
  });
}

function makeValidDraft(overrides: Partial<PlanRevisionDraft> = {}): PlanRevisionDraft {
  return {
    triggerKind: "worker_completed",
    triggerEvidence: {
      workerId: "w1",
      findingIds: [],
      conflictIds: [],
      reason: "Worker completed successfully",
    },
    workersToAdd: [],
    workersToReplace: [],
    workersToCancel: [],
    workersToModify: [],
    dependencyRewiring: [],
    expectedBenefit: "Improved workflow",
    confidence: 0.85,
    unresolvedConcerns: [],
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("ReplanValidator", () => {
  describe("validate", () => {
    // ── Required fields ────────────────────────────────────────────────

    it("accepts a well-formed draft with existing workers", () => {
      const existing = [makeExistingWorker("w1"), makeExistingWorker("w2")];
      const draft = makeValidDraft();
      const result = ReplanValidator.validate(draft, existing);
      assert.equal(result.valid, true);
      assert.equal(result.errors.length, 0);
    });

    it("accepts a draft with no changes (empty arrays)", () => {
      const existing: ReturnType<typeof makeExistingWorker>[] = [];
      const draft = makeValidDraft();
      const result = ReplanValidator.validate(draft, existing);
      assert.equal(result.valid, true);
      assert.equal(result.errors.length, 0);
    });

    it("rejects missing triggerKind (undefined)", () => {
      const draft = makeValidDraft({ triggerKind: undefined as any });
      const result = ReplanValidator.validate(draft, []);
      assert.equal(result.valid, false);
      assert.equal(result.errors.length, 1);
      assert.equal(result.errors[0].code, "missing_trigger_kind");
    });

    it("rejects null triggerKind", () => {
      const draft = makeValidDraft({ triggerKind: null as any });
      const result = ReplanValidator.validate(draft, []);
      assert.equal(result.valid, false);
      assert.equal(result.errors.length, 1);
      assert.equal(result.errors[0].code, "missing_trigger_kind");
    });

    it("rejects missing triggerEvidence", () => {
      const draft = makeValidDraft({ triggerEvidence: undefined as any });
      const result = ReplanValidator.validate(draft, []);
      assert.equal(result.valid, false);
      assert.equal(result.errors.length, 1);
      assert.equal(result.errors[0].code, "missing_trigger_evidence");
    });

    it("rejects null triggerEvidence", () => {
      const draft = makeValidDraft({ triggerEvidence: null as any });
      const result = ReplanValidator.validate(draft, []);
      assert.equal(result.valid, false);
      assert.equal(result.errors.length, 1);
      assert.equal(result.errors[0].code, "missing_trigger_evidence");
    });

    // ── Known trigger kind ─────────────────────────────────────────────

    it("rejects unknown triggerKind", () => {
      const draft = makeValidDraft({ triggerKind: "unknown_kind" as any });
      const result = ReplanValidator.validate(draft, []);
      assert.equal(result.valid, false);
      assert.equal(result.errors.length, 1);
      assert.equal(result.errors[0].code, "unknown_trigger_kind");
    });

    it("accepts all known trigger kinds", () => {
      const kinds = [
        "worker_completed",
        "worker_failed",
        "conflict_detected",
        "finding_published",
        "manual",
      ] as const;
      for (const kind of kinds) {
        const draft = makeValidDraft({ triggerKind: kind });
        const result = ReplanValidator.validate(draft, []);
        assert.equal(result.valid, true, `Expected valid for triggerKind "${kind}"`);
      }
    });

    // ── Duplicate draft IDs ────────────────────────────────────────────

    it("rejects duplicate draftWorkerId in workersToAdd", () => {
      const draft = makeValidDraft({
        workersToAdd: [
          {
            draftWorkerId: "d1",
            taskLabel: "Task A",
            goalPrompt: "Do A",
            requiredCapabilities: [],
            dependencies: [],
            verificationRequirements: [],
          },
          {
            draftWorkerId: "d1",
            taskLabel: "Task B",
            goalPrompt: "Do B",
            requiredCapabilities: [],
            dependencies: [],
            verificationRequirements: [],
          },
        ],
      });
      const result = ReplanValidator.validate(draft, []);
      assert.equal(result.valid, false);
      assert.equal(result.errors.length, 1);
      assert.equal(result.errors[0].code, "duplicate_draft_id");
    });

    it("rejects duplicate draftWorkerId across workersToReplace", () => {
      const existing = [makeExistingWorker("w1"), makeExistingWorker("w2")];
      const draft = makeValidDraft({
        workersToReplace: [
          {
            targetWorkerId: "w1",
            replacement: {
              draftWorkerId: "d1",
              taskLabel: "Replacement A",
              goalPrompt: "Do A",
              requiredCapabilities: [],
              dependencies: [],
              verificationRequirements: [],
            },
            reason: "Better approach",
          },
          {
            targetWorkerId: "w2",
            replacement: {
              draftWorkerId: "d1",
              taskLabel: "Replacement B",
              goalPrompt: "Do B",
              requiredCapabilities: [],
              dependencies: [],
              verificationRequirements: [],
            },
            reason: "Different approach",
          },
        ],
      });
      const result = ReplanValidator.validate(draft, existing);
      assert.equal(result.valid, false);
      assert.equal(result.errors.length, 1);
      assert.equal(result.errors[0].code, "duplicate_draft_id");
    });

    it("rejects duplicate draftWorkerId between workersToAdd and workersToReplace", () => {
      const existing = [makeExistingWorker("w1")];
      const draft = makeValidDraft({
        workersToAdd: [
          {
            draftWorkerId: "d1",
            taskLabel: "New worker",
            goalPrompt: "Do new",
            requiredCapabilities: [],
            dependencies: [],
            verificationRequirements: [],
          },
        ],
        workersToReplace: [
          {
            targetWorkerId: "w1",
            replacement: {
              draftWorkerId: "d1",
              taskLabel: "Replacement",
              goalPrompt: "Do replacement",
              requiredCapabilities: [],
              dependencies: [],
              verificationRequirements: [],
            },
            reason: "Upgrade",
          },
        ],
      });
      const result = ReplanValidator.validate(draft, existing);
      assert.equal(result.valid, false);
      assert.equal(result.errors.length, 1);
      assert.equal(result.errors[0].code, "duplicate_draft_id");
    });

    // ── Dependency resolvability ───────────────────────────────────────

    it("rejects unresolvable dependency in workersToAdd", () => {
      const existing = [makeExistingWorker("w1")];
      const draft = makeValidDraft({
        workersToAdd: [
          {
            draftWorkerId: "d1",
            taskLabel: "New worker",
            goalPrompt: "Do new",
            requiredCapabilities: [],
            dependencies: ["nonexistent_worker"],
            verificationRequirements: [],
          },
        ],
      });
      const result = ReplanValidator.validate(draft, existing);
      assert.equal(result.valid, false);
      assert.equal(result.errors.length, 1);
      assert.equal(result.errors[0].code, "unresolvable_dependency");
    });

    it("accepts dependency on existing worker", () => {
      const existing = [makeExistingWorker("w1")];
      const draft = makeValidDraft({
        workersToAdd: [
          {
            draftWorkerId: "d1",
            taskLabel: "New worker",
            goalPrompt: "Do new",
            requiredCapabilities: [],
            dependencies: ["w1"],
            verificationRequirements: [],
          },
        ],
      });
      const result = ReplanValidator.validate(draft, existing);
      assert.equal(result.valid, true);
    });

    it("accepts dependency on another draft worker (same draft)", () => {
      const draft = makeValidDraft({
        workersToAdd: [
          {
            draftWorkerId: "d1",
            taskLabel: "First",
            goalPrompt: "Do first",
            requiredCapabilities: [],
            dependencies: [],
            verificationRequirements: [],
          },
          {
            draftWorkerId: "d2",
            taskLabel: "Second",
            goalPrompt: "Do second",
            requiredCapabilities: [],
            dependencies: ["d1"],
            verificationRequirements: [],
          },
        ],
      });
      const result = ReplanValidator.validate(draft, []);
      assert.equal(result.valid, true);
    });

    it("rejects unresolvable dependency in workersToReplace", () => {
      const existing = [makeExistingWorker("w1")];
      const draft = makeValidDraft({
        workersToReplace: [
          {
            targetWorkerId: "w1",
            replacement: {
              draftWorkerId: "d1",
              taskLabel: "Replacement",
              goalPrompt: "Do replacement",
              requiredCapabilities: [],
              dependencies: ["nonexistent"],
              verificationRequirements: [],
            },
            reason: "Upgrade",
          },
        ],
      });
      const result = ReplanValidator.validate(draft, existing);
      assert.equal(result.valid, false);
      assert.equal(result.errors.length, 1);
      assert.equal(result.errors[0].code, "unresolvable_dependency");
    });

    // ── Cancel target existence ────────────────────────────────────────

    it("rejects workersToCancel referencing non-existing worker", () => {
      const draft = makeValidDraft({ workersToCancel: ["nonexistent"] });
      const result = ReplanValidator.validate(draft, []);
      assert.equal(result.valid, false);
      assert.equal(result.errors.length, 1);
      assert.equal(result.errors[0].code, "invalid_cancel_target");
    });

    it("accepts workersToCancel referencing existing worker", () => {
      const existing = [makeExistingWorker("w1")];
      const draft = makeValidDraft({ workersToCancel: ["w1"] });
      const result = ReplanValidator.validate(draft, existing);
      assert.equal(result.valid, true);
    });

    // ── Modify target existence ────────────────────────────────────────

    it("rejects workersToModify referencing non-existing worker", () => {
      const draft = makeValidDraft({
        workersToModify: [{ workerId: "nonexistent" }],
      });
      const result = ReplanValidator.validate(draft, []);
      assert.equal(result.valid, false);
      assert.equal(result.errors.length, 1);
      assert.equal(result.errors[0].code, "invalid_modify_target");
    });

    it("accepts workersToModify referencing existing worker", () => {
      const existing = [makeExistingWorker("w1")];
      const draft = makeValidDraft({
        workersToModify: [{ workerId: "w1", goalPrompt: "Updated prompt" }],
      });
      const result = ReplanValidator.validate(draft, existing);
      assert.equal(result.valid, true);
    });

    // ── Replace target existence ───────────────────────────────────────

    it("rejects workersToReplace with non-existing targetWorkerId", () => {
      const draft = makeValidDraft({
        workersToReplace: [
          {
            targetWorkerId: "nonexistent",
            replacement: {
              draftWorkerId: "d1",
              taskLabel: "Replacement",
              goalPrompt: "Do replacement",
              requiredCapabilities: [],
              dependencies: [],
              verificationRequirements: [],
            },
            reason: "Upgrade",
          },
        ],
      });
      const result = ReplanValidator.validate(draft, []);
      assert.equal(result.valid, false);
      assert.equal(result.errors.length, 1);
      assert.equal(result.errors[0].code, "invalid_replace_target");
    });

    it("accepts workersToReplace with existing targetWorkerId", () => {
      const existing = [makeExistingWorker("w1")];
      const draft = makeValidDraft({
        workersToReplace: [
          {
            targetWorkerId: "w1",
            replacement: {
              draftWorkerId: "d1",
              taskLabel: "Replacement",
              goalPrompt: "Do replacement",
              requiredCapabilities: [],
              dependencies: [],
              verificationRequirements: [],
            },
            reason: "Upgrade",
          },
        ],
      });
      const result = ReplanValidator.validate(draft, existing);
      assert.equal(result.valid, true);
    });

    // ── Multiple errors accumulation ───────────────────────────────────

    it("accumulates multiple errors for different violations", () => {
      const draft = makeValidDraft({
        triggerKind: "bogus" as any,
        workersToCancel: ["nonexistent_cancel"],
        workersToModify: [{ workerId: "nonexistent_modify" }],
        workersToReplace: [
          {
            targetWorkerId: "nonexistent_replace",
            replacement: {
              draftWorkerId: "d1",
              taskLabel: "Replacement",
              goalPrompt: "Do replacement",
              requiredCapabilities: [],
              dependencies: [],
              verificationRequirements: [],
            },
            reason: "Upgrade",
          },
        ],
      });
      const result = ReplanValidator.validate(draft, []);
      assert.equal(result.valid, false);
      // Expect at least 4 errors: unknown_trigger_kind, invalid_cancel_target,
      // invalid_modify_target, invalid_replace_target
      assert.ok(result.errors.length >= 4);
      const codes = result.errors.map((e) => e.code);
      assert.ok(codes.includes("unknown_trigger_kind"));
      assert.ok(codes.includes("invalid_cancel_target"));
      assert.ok(codes.includes("invalid_modify_target"));
      assert.ok(codes.includes("invalid_replace_target"));
    });

    // ── Warnings ───────────────────────────────────────────────────────

    it("returns empty warnings array for valid draft", () => {
      const draft = makeValidDraft();
      const result = ReplanValidator.validate(draft, []);
      assert.deepEqual(result.warnings, []);
    });
  });
});
