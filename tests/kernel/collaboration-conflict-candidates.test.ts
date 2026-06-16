/**
 * collaboration-conflict-candidates.test.ts — Unit tests for
 * ConflictCandidateGenerator.
 *
 * Plan §21: matrix covers compatible shared-tag findings clustering
 * correctly, unrelated broad-tag findings NOT clustering, stale/invalidated/
 * superseded exclusion, bounded pair count, and deterministic pair order.
 *
 * Pure-function template: no tmp directory; we build the run + findings
 * in memory and inspect the returned pairs/report.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ConflictCandidateGenerator,
  DEFAULT_CANDIDATE_LIMITS,
} from "../../src/kernel/collaboration-conflict-candidates.js";
import { normalizeClaim, extractClaim } from "../../src/kernel/collaboration-claim-normalizer.js";
import {
  createCoordinationRun,
  createWorkerAssignment,
} from "../../src/kernel/coordination-types.js";
import type { SharedFinding, EvidenceRef } from "../../src/kernel/collaboration-types.js";
import type { FindingClaim } from "../../src/kernel/collaboration-conflict-types.js";

const baseRun = () => {
  const run = createCoordinationRun({
    sessionId: "s1",
    rootGoal: "test",
    coordinatorAgentId: "alix",
  });
  return run;
};

const addWorker = (run: ReturnType<typeof baseRun>, id: string, attempt = 1) => {
  const w = createWorkerAssignment({
    id,
    coordinationRunId: run.id,
    agentId: id,
    taskLabel: id,
    goalPrompt: "do " + id,
    attempt,
  });
  run.workers.push(w);
  return w;
};

let nextId = 0;
const mkFinding = (overrides: Partial<SharedFinding> & { runId: string; workerId: string }): SharedFinding => {
  const id = overrides.id ?? `f_${++nextId}`;
  return {
    id,
    schemaVersion: "1.0",
    runId: overrides.runId,
    workerId: overrides.workerId,
    workerAttempt: overrides.workerAttempt ?? 1,
    kind: overrides.kind ?? "fact",
    title: overrides.title ?? "title",
    content: overrides.content ?? "content",
    confidence: overrides.confidence,
    claim: overrides.claim,
    tags: overrides.tags ?? [],
    evidenceRefs: overrides.evidenceRefs ?? [],
    artifactRefs: overrides.artifactRefs ?? [],
    supersededBy: overrides.supersededBy,
    invalidatedAt: overrides.invalidatedAt,
    invalidationReason: overrides.invalidationReason,
    createdAt: overrides.createdAt ?? "2026-06-16T10:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-06-16T10:00:00.000Z",
  };
};

const claimFor = (title: string, content: string): FindingClaim =>
  normalizeClaim(extractClaim(title, content)!);

describe("ConflictCandidateGenerator", () => {
  it("clusters compatible findings that share a topic key (same claim)", () => {
    const run = baseRun();
    const w1 = addWorker(run, "w1");
    const w2 = addWorker(run, "w2");
    const w3 = addWorker(run, "w3");

    const claim = claimFor("flag", "flag is true");
    const f1 = mkFinding({ runId: run.id, workerId: w1.id, claim, createdAt: "2026-06-16T10:00:00.000Z" });
    const f2 = mkFinding({ runId: run.id, workerId: w2.id, claim, createdAt: "2026-06-16T10:00:01.000Z" });
    const f3 = mkFinding({ runId: run.id, workerId: w3.id, claim, createdAt: "2026-06-16T10:00:02.000Z" });

    const gen = new ConflictCandidateGenerator();
    const { pairs, report } = gen.generateCandidates([f1, f2, f3], run);

    // 3 findings → 3 unique pairs (i,j)
    assert.equal(pairs.length, 3);
    assert.equal(report.groups, 1);
    assert.equal(report.totalActive, 3);
    assert.equal(report.omittedPairs, 0);

    // Every pair should be from the same group, all 3 unique workers
    for (const p of pairs) {
      assert.ok([f1, f2, f3].includes(p.left));
      assert.ok([f1, f2, f3].includes(p.right));
      assert.notEqual(p.left.id, p.right.id);
    }
  });

  it("does NOT cluster unrelated broad-tag findings when claims differ", () => {
    const run = baseRun();
    const w1 = addWorker(run, "w1");
    const w2 = addWorker(run, "w2");

    // Both findings share a broad tag, but their CLAIMS are different topics.
    // The generator clusters by topic key (from claim), not by tag.
    const claimA = claimFor("alpha", "debug = on");
    const claimB = claimFor("beta", "mode = fast");
    const f1 = mkFinding({ runId: run.id, workerId: w1.id, claim: claimA, tags: ["broad"] });
    const f2 = mkFinding({ runId: run.id, workerId: w2.id, claim: claimB, tags: ["broad"] });

    const gen = new ConflictCandidateGenerator();
    const { pairs, report } = gen.generateCandidates([f1, f2], run);

    assert.equal(pairs.length, 0, "different claim topics must not cluster");
    assert.equal(report.groups, 2);
  });

  it("excludes stale attempt findings", () => {
    const run = baseRun();
    const w1 = addWorker(run, "w1");
    // Bump the worker's attempt to 2 (the candidate generator reads the
    // current attempt from the run.workers entry, not the finding itself).
    w1.attempt = 2;

    const claim = claimFor("flag", "flag is true");
    const fStale = mkFinding({ runId: run.id, workerId: w1.id, claim, workerAttempt: 1 });
    const fActive = mkFinding({ runId: run.id, workerId: w1.id, claim, workerAttempt: 2 });

    const gen = new ConflictCandidateGenerator();
    const { pairs, report } = gen.generateCandidates([fStale, fActive], run);

    assert.equal(report.totalActive, 1, "only the attempt-2 finding is active");
    assert.equal(pairs.length, 0, "stale_attempt should be filtered out");
  });

  it("excludes invalidated findings", () => {
    const run = baseRun();
    const w1 = addWorker(run, "w1");
    const w2 = addWorker(run, "w2");

    const claim = claimFor("flag", "flag is true");
    const fActive = mkFinding({ runId: run.id, workerId: w1.id, claim });
    const fInvalid = mkFinding({
      runId: run.id,
      workerId: w2.id,
      claim,
      invalidatedAt: "2026-06-16T09:00:00.000Z",
      invalidationReason: "wrong",
    });

    const gen = new ConflictCandidateGenerator();
    const { pairs, report } = gen.generateCandidates([fActive, fInvalid], run);

    assert.equal(report.totalActive, 1);
    assert.equal(pairs.length, 0, "invalidated findings must be filtered");
  });

  it("excludes superseded findings", () => {
    const run = baseRun();
    const w1 = addWorker(run, "w1");
    const w2 = addWorker(run, "w2");

    const claim = claimFor("flag", "flag is true");
    const fActive = mkFinding({ runId: run.id, workerId: w1.id, claim });
    const fSuper = mkFinding({
      runId: run.id,
      workerId: w2.id,
      claim,
      supersededBy: "f_active",
    });

    const gen = new ConflictCandidateGenerator();
    const { pairs, report } = gen.generateCandidates([fActive, fSuper], run);

    assert.equal(report.totalActive, 1);
    assert.equal(pairs.length, 0, "superseded findings must be filtered");
  });

  it("enforces bounded pair count via maxPairsPerDetectionPass", () => {
    const run = baseRun();
    const w1 = addWorker(run, "w1");
    const claim = claimFor("flag", "flag is true");
    const findings: SharedFinding[] = [];
    // 8 findings in one group → C(8,2) = 28 pairs; cap to 5
    for (let i = 0; i < 8; i++) {
      findings.push(mkFinding({
        id: `f${i}`,
        runId: run.id,
        workerId: w1.id,
        claim,
        createdAt: new Date(Date.UTC(2026, 5, 16, 10, 0, i)).toISOString(),
      }));
    }
    const gen = new ConflictCandidateGenerator({ maxFindingsPerTopic: 20, maxPairsPerDetectionPass: 5 });
    const { pairs, report } = gen.generateCandidates(findings, run);

    assert.equal(pairs.length, 5, "pair cap must be honored");
    assert.equal(report.omittedPairs, 28 - 5, "remaining pairs should be reported as omitted");
  });

  it("emits pairs in deterministic order across runs", () => {
    const run = baseRun();
    const w1 = addWorker(run, "w1");
    const w2 = addWorker(run, "w2");
    const w3 = addWorker(run, "w3");

    const claim = claimFor("flag", "flag is true");
    const f1 = mkFinding({ id: "a", runId: run.id, workerId: w1.id, claim, createdAt: "2026-06-16T10:00:02.000Z" });
    const f2 = mkFinding({ id: "b", runId: run.id, workerId: w2.id, claim, createdAt: "2026-06-16T10:00:01.000Z" });
    const f3 = mkFinding({ id: "c", runId: run.id, workerId: w3.id, claim, createdAt: "2026-06-16T10:00:01.000Z" });

    const gen = new ConflictCandidateGenerator();
    const a = gen.generateCandidates([f1, f2, f3], run).pairs;
    const b = gen.generateCandidates([f2, f3, f1], run).pairs; // input order shuffled
    const c = gen.generateCandidates([f3, f1, f2], run).pairs;

    // Same input set → same pair order
    const sig = (pairs: typeof a) => pairs.map(p => `${p.left.id}|${p.right.id}`).join(",");
    assert.equal(sig(a), sig(b));
    assert.equal(sig(b), sig(c));

    // Sort key: createdAt asc → workerId asc → id asc.
    // f2(b) and f3(c) share createdAt 10:00:01; tiebreak by workerId puts "w2" before "w3".
    // f1(a) is 10:00:02 — last.
    // Sorted: [b, c, a]. Pairs iterate i<j: (b,c), (b,a), (c,a).
    assert.equal(a[0].left.id, "b");
    assert.equal(a[0].right.id, "c");
    assert.equal(a[1].left.id, "b");
    assert.equal(a[1].right.id, "a");
    assert.equal(a[2].left.id, "c");
    assert.equal(a[2].right.id, "a");
  });

  it("uses default limits when no override is given", () => {
    // Smoke test: the default constants are sane and the generator accepts them implicitly.
    assert.equal(DEFAULT_CANDIDATE_LIMITS.maxFindingsPerTopic, 20);
    assert.equal(DEFAULT_CANDIDATE_LIMITS.maxPairsPerDetectionPass, 200);
    const gen = new ConflictCandidateGenerator();
    assert.ok(gen);
  });
});

// keep `EvidenceRef` import "used" so the test file compiles without warnings
const _typeProbe: EvidenceRef | undefined = undefined;
void _typeProbe;
