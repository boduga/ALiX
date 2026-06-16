/**
 * collaboration-conflicts.integration.test.ts — End-to-end M0.78f conflict flow.
 *
 * Plan §21 "End-to-end" matrix:
 *   1. Worker A publishes structured claim
 *   2. Worker B publishes incompatible claim
 *   3. detector creates one conflict
 *   4. repeated detection updates, not duplicates
 *   5. downstream worker receives conflict summary
 *   6. run continues by default
 *   7. authorized resolver resolves conflict
 *   8. audit chain complete
 *
 * Uses real, on-disk stores in an isolated temp directory.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, readFileSync, existsSync } from "node:fs";
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
import { CollaborationContextBuilder } from "../../src/kernel/collaboration-context-builder.js";
import { renderContextSnapshot } from "../../src/kernel/collaboration-context-renderer.js";
import { systemClock } from "../../src/kernel/collaboration-freshness.js";
import { AuditStore } from "../../src/audit/audit-store.js";
import { normalizeClaim } from "../../src/kernel/collaboration-claim-normalizer.js";
import type { FindingClaim } from "../../src/kernel/collaboration-conflict-types.js";
import type { SharedFinding } from "../../src/kernel/collaboration-types.js";

function makeClaim(
  subject: string,
  predicate: string,
  value: string,
  valueType: FindingClaim["valueType"],
): FindingClaim {
  return normalizeClaim({
    subject,
    predicate,
    value,
    valueType,
    extractionMethod: "structured",
    extractionVersion: "1.0",
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
    { kind: "fact", title, content, tags: [] },
    { runId, workerId, workerAttempt: attempt },
  );
  if (claim) {
    // publishFinding does not accept a claim; attach via mutate.
    await collabStore.mutate((state: any) => {
      const found = state.findings.find((x: any) => x.id === f.id);
      if (found) found.claim = claim;
    });
  }
  return f;
}

describe("Collaboration conflict end-to-end (M0.78f §21)", () => {
  let cwd: string;
  let runId: string;
  let workerA: string;
  let workerB: string;
  let workerC: string;
  let collabStore: CollaborationStore;
  let coordStore: CoordinationStore;
  let resultStore: CoordinationResultStore;
  let repo: ConflictRepository;
  let detector: ConflictDetector;
  let auditStore: AuditStore;
  let contextBuilder: CollaborationContextBuilder;

  beforeEach(async () => {
    cwd = mkdtempSync(join(tmpdir(), "collab-e2e-"));

    // ── Coordination run with three workers (A, B, and downstream C)
    coordStore = new CoordinationStore(cwd);
    resultStore = new CoordinationResultStore(cwd);

    const run = createCoordinationRun({
      sessionId: "sess-e2e",
      rootGoal: "end-to-end conflict flow",
      coordinatorAgentId: "alix",
    });
    runId = run.id;

    const wA = createWorkerAssignment({
      coordinationRunId: runId,
      agentId: "a-research",
      taskLabel: "Research DBs",
      goalPrompt: "Pick a database",
      attempt: 1,
    });
    const wB = createWorkerAssignment({
      coordinationRunId: runId,
      agentId: "b-research",
      taskLabel: "Research DBs (alt)",
      goalPrompt: "Pick a database",
      attempt: 1,
    });
    const wC = createWorkerAssignment({
      coordinationRunId: runId,
      agentId: "c-consumer",
      taskLabel: "Implement schema",
      goalPrompt: "Implement schema based on context",
      dependencies: [wA.id, wB.id],
      attempt: 1,
    });
    workerA = wA.id;
    workerB = wB.id;
    workerC = wC.id;
    run.workers = [wA, wB, wC];
    await coordStore.save(run);

    // Pre-create shared state dir so first publishFinding can write.
    mkdirSync(join(cwd, ".alix", "coordination", "shared", runId), { recursive: true });

    collabStore = new CollaborationStore(cwd, runId);

    // Conflict detector with full dependency wiring.
    auditStore = new AuditStore(cwd);
    const adaptedAuditStore = {
      append: (e: { action: string; details?: Record<string, unknown> }) =>
        auditStore.append({ action: e.action as any, details: e.details as any }),
    };
    // Repository also records conflict.detected / conflict.resolved audit
    // entries, so it must share the same audit store.
    repo = new ConflictRepository(collabStore, undefined, adaptedAuditStore);
    const generator = new ConflictCandidateGenerator();
    const claimComp = new ClaimComparator();
    const evidenceComp = new ConflictEvidenceComparator(systemClock);

    detector = new ConflictDetector({
      collabStore,
      coordinationStore: coordStore,
      resultStore,
      candidateGenerator: generator,
      claimComparator: claimComp,
      evidenceComparator: evidenceComp,
      conflictRepo: repo,
      // ConflictDetector expects a duck-typed `auditStore` whose `append`
      // takes a loose `{ action: string; details?: ... }` shape; our concrete
      // AuditStore narrows `action` to the AuditAction union, so adapt.
      auditStore: adaptedAuditStore,
    });

    contextBuilder = new CollaborationContextBuilder(resultStore, collabStore);
  });

  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it("drives publish → detect → re-detect → inject → resolve with audit chain", async () => {
    // 1 + 2. Worker A and B publish incompatible structured claims.
    const claimA = makeClaim("db", "choice", "postgres", "enum");
    const claimB = makeClaim("db", "choice", "mysql", "enum");
    await seedFinding(
      collabStore, runId, workerA, 1,
      "A recommends postgres",
      "decision: use postgres for OLTP",
      claimA,
    );
    await seedFinding(
      collabStore, runId, workerB, 1,
      "B recommends mysql",
      "decision: use mysql for OLTP",
      claimB,
    );

    // 3. First detection — exactly one conflict.
    const r1 = await detector.detectConflicts(runId);
    assert.equal(r1.createdConflictIds.length, 1, "first pass should create one conflict");
    assert.equal(r1.updatedConflictIds.length, 0);
    assert.equal(r1.deterministicConflicts, 1);
    assert.ok(r1.warnings.length === 0, `unexpected warnings: ${r1.warnings.join("; ")}`);

    const stored = await repo.getConflicts(runId);
    assert.equal(stored.length, 1, "exactly one conflict must be persisted");
    const conflict = stored[0];
    assert.ok(
      conflict.type === "competing_decision" || conflict.type === "contradiction",
      `expected competing_decision or contradiction, got ${conflict.type}`,
    );
    assert.deepEqual(conflict.detectedBy, ["deterministic"]);
    assert.equal(conflict.findingIds.length, 2);

    // 4. Re-run detection — updates, does not duplicate.
    const r2 = await detector.detectConflicts(runId);
    assert.equal(r2.createdConflictIds.length, 0, "second pass must not create");
    assert.equal(r2.updatedConflictIds.length, 1, "second pass must update the existing one");

    const after = await repo.getConflicts(runId);
    assert.equal(after.length, 1, "still one conflict");
    // B3: history grew.
    assert.ok(after[0].history.length >= 2, "history grows on update");

    // 6. Run continues by default — the run is still active (not blocked).
    const runAfter = await coordStore.load(runId);
    assert.ok(runAfter, "run should still exist");
    assert.notEqual(runAfter?.status, "failed", "run must not fail by default");

    // 5. Downstream worker C receives a context with the conflict rendered as untrusted.
    const runForCtx = await coordStore.load(runId);
    const consumerWorker = runForCtx!.workers.find(w => w.id === workerC)!;
    const { manifest, snapshot } = await contextBuilder.build(runForCtx!, consumerWorker);

    // The conflict should be in the snapshot (it overlaps with C's dependency findings).
    assert.ok(snapshot.conflicts.length >= 1, "downstream snapshot should include the conflict");
    const present = snapshot.conflicts.find(c => c.id === conflict.id);
    assert.ok(present, "the detected conflict must be in the downstream snapshot");

    // Render and assert the untrusted + shared_conflicts markers.
    // The renderer marks every worker-supplied section (dependency_results,
    // shared_findings, shared_artifacts, shared_conflicts) with its own
    // trust="untrusted" attribute, in addition to the outer wrapper.
    snapshot.renderedText = renderContextSnapshot(manifest, snapshot);
    assert.ok(
      snapshot.renderedText.includes(`<coordination_context trust="untrusted">`),
      "rendered text must be marked untrusted",
    );
    assert.ok(
      snapshot.renderedText.includes(`<shared_conflicts trust="untrusted">`),
      "shared_conflicts section must be marked untrusted",
    );
    assert.ok(
      snapshot.renderedText.includes(`<dependency_results trust="untrusted">`),
      "dependency_results section must be marked untrusted",
    );
    // The conflict must appear in the rendered shared_conflicts block.
    const conflictsBlock = snapshot.renderedText
      .split("<shared_conflicts")[1]
      ?.split("</shared_conflicts>")[0];
    assert.ok(conflictsBlock, "shared_conflicts block must be present");
    assert.ok(
      conflictsBlock.includes(`[Conflict: ${conflict.id}]`),
      `rendered conflicts block must include [Conflict: ${conflict.id}]`,
    );

    // 7. Authorized resolver (operator) resolves the conflict.
    const resolved = await repo.resolveConflict(
      conflict.id,
      {
        decision: "Accept postgres per A (better OLTP support)",
        acceptedFindingIds: [conflict.findingIds[0]],
        rejectedFindingIds: [conflict.findingIds[1]],
        resolver: { kind: "operator", id: "test" },
        evidenceRefs: [],
        resolvedAt: new Date().toISOString(),
      },
      { kind: "operator", actorId: "test" },
    );
    assert.ok(resolved, "resolve should return the conflict");
    assert.equal(resolved!.status, "resolved");
    assert.ok(resolved!.resolution, "resolved conflict must carry a resolution");
    assert.equal(resolved!.resolution!.decision, "Accept postgres per A (better OLTP support)");

    // Re-read for the final on-disk status.
    const finalStored = await repo.getConflict(conflict.id);
    assert.equal(finalStored!.status, "resolved");

    // 8. Audit chain — at least one conflict.detected and one conflict.resolved.
    const auditPath = join(cwd, ".alix", "audit", "audit.jsonl");
    assert.ok(existsSync(auditPath), `audit file should exist at ${auditPath}`);
    const lines = readFileSync(auditPath, "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    const actions = lines.map((r: any) => r.action);
    const detected = lines.filter((r: any) => r.action === "conflict.detected");
    const resolvedAudit = lines.filter((r: any) => r.action === "conflict.resolved");
    assert.ok(
      detected.length >= 1,
      `expected >=1 conflict.detected audit entry; got actions=${actions.join(",")}`,
    );
    assert.ok(
      resolvedAudit.length >= 1,
      `expected >=1 conflict.resolved audit entry; got actions=${actions.join(",")}`,
    );

    // The audit entries should reference the conflict id.
    for (const r of detected) {
      assert.equal(r.details.conflictId, conflict.id);
      assert.equal(r.details.runId, runId);
    }
    for (const r of resolvedAudit) {
      assert.equal(r.details.conflictId, conflict.id);
      assert.equal(r.details.actorId, "test");
    }
  });
});
