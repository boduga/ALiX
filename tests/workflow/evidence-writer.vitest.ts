/**
 * P4.5d — Evidence Event Writer tests.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { EvidenceStore } from "../../src/security/evidence/evidence-store.js";
import { EvidenceEventWriter } from "../../src/workflow/evidence-writer.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDir(): string {
  const dir = join("/tmp", "ev-test-" + randomUUID().slice(0, 8));
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EvidenceEventWriter", () => {
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

  describe("issue lifecycle events", () => {
    it("records issue_selected", async () => {
      const r = await writer.recordIssueSelected(61, {
        priority: "high",
        complexity: "medium",
        labels: ["type:feature", "ready-for-agent"],
      });
      expect(r).not.toBeNull();
      expect(r!.type).toBe("issue_selected");
      expect(r!.payload.issueNumber).toBe(61);
      expect(r!.payload.priority).toBe("high");
    });

    it("records plan_generated", async () => {
      const r = await writer.recordPlanGenerated(61, {
        subtaskCount: 4,
        estimatedFiles: ["src/foo.ts", "tests/foo.test.ts"],
      });
      expect(r).not.toBeNull();
      expect(r!.type).toBe("plan_generated");
      expect(r!.payload.subtaskCount).toBe(4);
    });

    it("records plan_approved", async () => {
      const fp = "abc123def456";
      const r = await writer.recordPlanApproved(61, { planFingerprint: fp });
      expect(r).not.toBeNull();
      expect(r!.type).toBe("plan_approved");
      expect(r!.payload.planFingerprint).toBe(fp);
    });

    it("records plan_rejected", async () => {
      const r = await writer.recordPlanRejected(61, {
        reason: "Scope too large",
      });
      expect(r).not.toBeNull();
      expect(r!.type).toBe("plan_rejected");
      expect(r!.payload.reason).toBe("Scope too large");
    });
  });

  describe("execution events", () => {
    it("records execution_started", async () => {
      const r = await writer.recordExecutionStarted(61, {
        branchName: "feature/my-thing",
        subtaskId: "step-1",
      });
      expect(r).not.toBeNull();
      expect(r!.type).toBe("execution_started");
      expect(r!.payload.branchName).toBe("feature/my-thing");
    });

    it("records execution_completed", async () => {
      const r = await writer.recordExecutionCompleted(61, {
        commitSha: "a1b2c3d4",
        filesChanged: 5,
      });
      expect(r).not.toBeNull();
      expect(r!.type).toBe("execution_completed");
      expect(r!.payload.filesChanged).toBe(5);
    });
  });

  describe("review events", () => {
    it("records review_started", async () => {
      const r = await writer.recordReviewStarted(61, {
        commitSha: "a1b2c3d4",
      });
      expect(r).not.toBeNull();
      expect(r!.type).toBe("review_started");
    });

    it("records review_completed with approve", async () => {
      const r = await writer.recordReviewCompleted(61, {
        verdict: "approve",
        findingCount: 0,
      });
      expect(r).not.toBeNull();
      expect(r!.type).toBe("review_completed");
      expect(r!.payload.verdict).toBe("approve");
    });

    it("records review_completed with findings", async () => {
      const r = await writer.recordReviewCompleted(61, {
        verdict: "changes_requested",
        findingCount: 3,
      });
      expect(r).not.toBeNull();
      expect(r!.payload.findingCount).toBe(3);
    });
  });

  describe("PR events", () => {
    it("records pr_created", async () => {
      const r = await writer.recordPrCreated(61, {
        prUrl: "https://github.com/boduga/ALiX/pull/70",
        prNumber: 70,
        branchName: "feature/my-thing",
      });
      expect(r).not.toBeNull();
      expect(r!.type).toBe("pr_created");
      expect(r!.payload.prNumber).toBe(70);
    });

    it("records merge_completed", async () => {
      const r = await writer.recordMergeCompleted(61, {
        mergeCommitSha: "deadbeef",
      });
      expect(r).not.toBeNull();
      expect(r!.type).toBe("merge_completed");
    });
  });

  describe("workflow coordination events", () => {
    it("records workflow_blocked", async () => {
      const r = await writer.recordBlocked(61, {
        reason: "Waiting for CI",
        blockingItem: "ci-build-1234",
      });
      expect(r).not.toBeNull();
      expect(r!.type).toBe("workflow_blocked");
      expect(r!.payload.reason).toBe("Waiting for CI");
    });

    it("records workflow_unblocked", async () => {
      const r = await writer.recordUnblocked(61, {
        blockedDurationMs: 30000,
      });
      expect(r).not.toBeNull();
      expect(r!.type).toBe("workflow_unblocked");
      expect(r!.payload.blockedDurationMs).toBe(30000);
    });

    it("records workflow_aborted", async () => {
      const r = await writer.recordAborted(61, {
        reason: "Planner crashed",
        forcedState: "NEW",
      });
      expect(r).not.toBeNull();
      expect(r!.type).toBe("workflow_aborted");
      expect(r!.payload.forcedState).toBe("NEW");
    });
  });

  describe("context enrichment", () => {
    it("includes transition context when provided", async () => {
      const r = await writer.recordIssueSelected(61, {
        priority: "high",
        complexity: "medium",
        labels: [],
      }, {
        actor: "IssueIntakeAgent",
        from: "NEW",
        to: "SELECTED",
      });
      expect(r).not.toBeNull();
      expect(r!.payload.fromState).toBe("NEW");
      expect(r!.payload.toState).toBe("SELECTED");
      expect(r!.payload.actor).toBe("IssueIntakeAgent");
    });

    it("omits transition context when not provided", async () => {
      const r = await writer.recordPlanGenerated(61, {
        subtaskCount: 2,
        estimatedFiles: ["a.ts"],
      });
      expect(r).not.toBeNull();
      expect(r!.payload.fromState).toBeUndefined();
      expect(r!.payload.actor).toBeUndefined();
    });
  });

  describe("fingerprint chain", () => {
    it("produces verifiable evidence records", async () => {
      await writer.recordIssueSelected(61, {
        priority: "high", complexity: "small", labels: [],
      });
      await writer.recordExecutionStarted(61, {
        branchName: "feat/x", subtaskId: "step-1",
      });
      await writer.recordPrCreated(61, {
        prUrl: "http://example.com/pr", prNumber: 1, branchName: "feat/x",
      });

      const result = await store.verify();
      expect(result.ok).toBe(true);
      expect(result.total).toBe(3);
    });

    it("fingerprints are queryable by type", async () => {
      await writer.recordIssueSelected(61, {
        priority: "low", complexity: "small", labels: [],
      });
      await writer.recordPlanGenerated(61, {
        subtaskCount: 1, estimatedFiles: ["a.ts"],
      });

      const selected = await store.query({ type: "issue_selected" });
      expect(selected.records.length).toBe(1);

      const generated = await store.query({ type: "plan_generated" });
      expect(generated.records.length).toBe(1);
    });

    it("fingerprints are unique per event", async () => {
      const r1 = await writer.recordIssueSelected(61, {
        priority: "high", complexity: "medium", labels: [],
      });
      const r2 = await writer.recordIssueSelected(62, {
        priority: "low", complexity: "small", labels: [],
      });
      expect(r1!.fingerprint).not.toBe(r2!.fingerprint);
    });
  });

  describe("error handling", () => {
    it("returns null when append fails", async () => {
      const brokenWriter = new EvidenceEventWriter(async () => {
        throw new Error("Store unavailable");
      });
      const r = await brokenWriter.recordIssueSelected(61, {
        priority: "low", complexity: "small", labels: [],
      });
      expect(r).toBeNull();
    });

    it("non-null return has full EvidenceRecord shape", async () => {
      const r = await writer.recordMergeCompleted(61, {
        mergeCommitSha: "abc123",
      });
      expect(r).not.toBeNull();
      expect(r!.id).toBeTruthy();
      expect(r!.fingerprint).toBeTruthy();
      expect(r!.timestamp).toBeTruthy();
      expect(r!.version).toBe(1);
    });
  });
});
