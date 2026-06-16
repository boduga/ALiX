import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CollaborationStore } from "../../src/kernel/collaboration-store.js";
import { CoordinationStore } from "../../src/kernel/coordination-store.js";
import { CoordinationResultStore } from "../../src/kernel/coordination-result-store.js";
import { createCoordinationRun, createWorkerAssignment } from "../../src/kernel/coordination-types.js";
import { ConflictDetector } from "../../src/kernel/collaboration-conflict-detector.js";
import { ConflictCandidateGenerator } from "../../src/kernel/collaboration-conflict-candidates.js";
import { ClaimComparator } from "../../src/kernel/collaboration-claim-comparator.js";
import { ConflictEvidenceComparator } from "../../src/kernel/collaboration-evidence-comparator.js";
import { ConflictRepository } from "../../src/kernel/collaboration-conflict-repository.js";
import { systemClock } from "../../src/kernel/collaboration-freshness.js";
import { extractClaim, normalizeClaim } from "../../src/kernel/collaboration-claim-normalizer.js";
import type { ModelConflictComparator } from "../../src/kernel/collaboration-model-conflict-comparator.js";
import type { SharedFinding } from "../../src/kernel/collaboration-types.js";
import type { FindingClaim } from "../../src/kernel/collaboration-conflict-types.js";

function makeClaim(subject: string, predicate: string, value: string, valueType: any): FindingClaim {
  return normalizeClaim({
    subject, predicate, value, valueType,
    extractionMethod: "deterministic", extractionVersion: "1.0.0",
  });
}

async function seedFinding(
  collabStore: CollaborationStore,
  runId: string,
  workerId: string,
  attempt: number,
  title: string,
  content: string,
  claim?: FindingClaim,
): Promise<SharedFinding> {
  const f = await collabStore.publishFinding(
    {
      kind: "fact",
      title,
      content,
      tags: [],
    },
    { runId, workerId, workerAttempt: attempt },
  );
  if (claim) {
    // publishFinding doesn't accept claim; attach via direct mutate.
    await collabStore.mutate((state: any) => {
      const found = state.findings.find((x: any) => x.id === f.id);
      if (found) found.claim = claim;
    });
  }
  return f;
}

describe("ConflictDetector", () => {
  let cwd: string;
  let runId: string;
  let workerA: string;
  let workerB: string;
  let collabStore: CollaborationStore;
  let coordStore: CoordinationStore;
  let resultStore: CoordinationResultStore;
  let repo: ConflictRepository;
  let detector: ConflictDetector;
  let generator: ConflictCandidateGenerator;
  let claimComp: ClaimComparator;
  let evidenceComp: ConflictEvidenceComparator;

  beforeEach(async () => {
    cwd = mkdtempSync(join(tmpdir(), "detector-"));
    coordStore = new CoordinationStore(cwd);
    resultStore = new CoordinationResultStore(cwd);

    const run = createCoordinationRun({
      sessionId: "s1", rootGoal: "test", coordinatorAgentId: "alix",
    });
    runId = run.id;
    const wA = createWorkerAssignment({
      coordinationRunId: runId, agentId: "a1", taskLabel: "T1", goalPrompt: "do A", attempt: 1,
    });
    const wB = createWorkerAssignment({
      coordinationRunId: runId, agentId: "a2", taskLabel: "T2", goalPrompt: "do B", attempt: 1,
    });
    workerA = wA.id;
    workerB = wB.id;
    run.workers = [wA, wB];
    await coordStore.save(run);

    // Pre-create shared dir so first publishFinding can write.
    mkdirSync(join(cwd, ".alix", "coordination", "shared", runId), { recursive: true });
    collabStore = new CollaborationStore(cwd, runId);
    repo = new ConflictRepository(collabStore);
    generator = new ConflictCandidateGenerator();
    claimComp = new ClaimComparator();
    evidenceComp = new ConflictEvidenceComparator(systemClock);
    detector = new ConflictDetector({
      collabStore,
      coordinationStore: coordStore,
      resultStore,
      candidateGenerator: generator,
      claimComparator: claimComp,
      evidenceComparator: evidenceComp,
      conflictRepo: repo,
    });
  });

  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it("creates one conflict on first detection, updates (not duplicates) on second pass", async () => {
    const claimA = makeClaim("feature", "enabled", "true", "boolean");
    const claimB = makeClaim("feature", "enabled", "false", "boolean");
    await seedFinding(collabStore, runId, workerA, 1, "claim A", "feature is true", claimA);
    await seedFinding(collabStore, runId, workerB, 1, "claim B", "feature is false", claimB);

    const r1 = await detector.detectConflicts(runId);
    assert.equal(r1.createdConflictIds.length, 1);
    assert.equal(r1.updatedConflictIds.length, 0);
    assert.equal(r1.deterministicConflicts, 1);

    const conflicts1 = await repo.getConflicts(runId);
    assert.equal(conflicts1.length, 1);
    assert.equal(conflicts1[0].history.length, 1);
    assert.equal(conflicts1[0].history[0].action, "created");

    const r2 = await detector.detectConflicts(runId);
    assert.equal(r2.createdConflictIds.length, 0);
    assert.equal(r2.updatedConflictIds.length, 1);

    const conflicts2 = await repo.getConflicts(runId);
    assert.equal(conflicts2.length, 1);
    // B3: history grows on update
    assert.ok(conflicts2[0].history.length >= 2);
  });

  it("model-assisted path marks detectedBy with model_assisted", async () => {
    // Use 'uncertain' claim shape: same subject/predicate, same scope, but
    // version value type returns 'uncertain' from the deterministic comparator.
    const claimA = makeClaim("version", "detected", "1.2.3", "version");
    const claimB = makeClaim("version", "detected", "1.3.0", "version");
    await seedFinding(collabStore, runId, workerA, 1, "v1", "version = 1.2.3", claimA);
    await seedFinding(collabStore, runId, workerB, 1, "v2", "version = 1.3.0", claimB);

    const modelComparator: ModelConflictComparator = {
      compare: async () => ({
        compatibility: "incompatible",
        confidence: 0.9,
        reasons: ["unit test"],
      }),
    };

    const detectorWithModel = new ConflictDetector({
      collabStore,
      coordinationStore: coordStore,
      resultStore,
      candidateGenerator: generator,
      claimComparator: claimComp,
      evidenceComparator: evidenceComp,
      conflictRepo: repo,
      modelComparator,
    });

    const r = await detectorWithModel.detectConflicts(runId, { useModelAssistance: true });
    assert.equal(r.modelAssistedConflicts, 1);
    assert.equal(r.createdConflictIds.length, 1);

    const conflicts = await repo.getConflicts(runId);
    assert.equal(conflicts.length, 1);
    assert.ok(conflicts[0].detectedBy.includes("model_assisted"));
  });
});
