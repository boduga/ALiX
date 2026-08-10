// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ChronicleAdapter,
  EvidenceAdapter,
  FailureMemoryAdapter,
  LearningStoreAdapter,
  PatternRegistryAdapter,
} from "../../../src/evolution/knowledge/adapters/index.js";
import { PatternRegistry } from "../../../src/context/pattern-registry.js";
import { InMemoryVerificationEvidenceLedger } from "../../../src/evolution/verification/evidence/evidence-ledger.js";
import { createVerificationEvidence } from "../../../src/evolution/verification/evidence/verification-evidence.js";
import type { CalibrationProfile, LearningReport, LearningSignal } from "../../../src/learning/learning-types.js";
import type { ChronicleEntry } from "../../../src/chronicle/chronicle-store.js";
import type { FailureRecord } from "../../../src/governance/failure-memory.js";
import type { KnowledgeArtifact } from "../../../src/evolution/knowledge/contracts/curation-contract.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const signal1: LearningSignal = {
  id: "ls-1",
  subject: "routing",
  outcome: "calibrate",
  confidence: 0.7,
  reasons: ["observed overconfidence"],
  generatedAt: "2026-08-01T00:00:00.000Z",
  sourceReportId: "lr-1",
  signalType: "routing_quality_poor",
  strength: 0.8,
  summary: "routing picked slow path",
  evidenceRefs: ["ev-1"],
  delta: { expected: 0.9, observed: 0.7, unit: "rate" },
};

const signal2: LearningSignal = {
  id: "ls-2",
  subject: "governance",
  outcome: "calibrate",
  confidence: 0.6,
  reasons: ["lens miss"],
  generatedAt: "2026-08-02T00:00:00.000Z",
  sourceReportId: "lr-1",
  signalType: "lens_low_predictive_value",
  strength: 0.5,
  summary: "lens missed a case",
  evidenceRefs: [],
};

const profile: CalibrationProfile = {
  id: "cp-1",
  subject: "recommendation calibration",
  outcome: "adjust",
  confidence: 0.8,
  reasons: ["observed gap"],
  generatedAt: "2026-08-01T00:00:00.000Z",
  target: "recommendation_confidence_multiplier",
  targetName: "recommendation",
  previousValue: 1.0,
  suggestedValue: 0.9,
  reason: "overconfidence",
  evidenceRefs: ["ev-1"],
  sourceSignalIds: ["ls-1"],
};

const report: LearningReport = {
  id: "lr-1",
  subject: "weekly learning",
  outcome: "report",
  confidence: 0.6,
  reasons: ["routine"],
  generatedAt: "2026-08-01T00:00:00.000Z",
  windowDays: 7,
  windowStart: "2026-07-25T00:00:00.000Z",
  windowEnd: "2026-08-01T00:00:00.000Z",
  signals: [signal1],
  profiles: [profile],
  sections: [],
};

const chronicleEntry: ChronicleEntry = {
  entryId: "e1",
  signalCode: "SC-001",
  domain: "tool",
  polarity: "neutral",
  problem: "shell hang",
  diagnosis: "blocked on read",
  actionTaken: "applied timeout",
  outcome: "success",
  lesson: "always apply a timeout",
  taboosObserved: [],
  offeringsUsed: [],
  traceRefs: [],
  replayRefs: [],
  rollbackRefs: [],
  createdAt: "2026-08-01T00:00:00.000Z",
};

const failureRecord: FailureRecord = {
  runId: "run-1",
  issueId: "issue-1",
  failureType: "policy_denied",
  detail: "policy denied command",
  timestamp: "2026-08-01T00:00:00.000Z",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "a6-knowledge-"));
}

/** Seed a learning store dir with signals/profiles/reports JSONL files. */
async function seedLearningDir(dir: string): Promise<void> {
  await writeFile(
    join(dir, "signals.jsonl"),
    `${JSON.stringify(signal1)}\n${JSON.stringify(signal2)}\n`,
    "utf-8",
  );
  await writeFile(join(dir, "profiles.jsonl"), `${JSON.stringify(profile)}\n`, "utf-8");
  await writeFile(join(dir, "reports.jsonl"), `${JSON.stringify(report)}\n`, "utf-8");
}

/** Seed a chronicle store root dir (.alix/chronicle/index.json + entries/). */
async function seedChronicleDir(root: string): Promise<void> {
  const chronicleDir = join(root, ".alix", "chronicle");
  await mkdir(join(chronicleDir, "entries"), { recursive: true });
  await writeFile(
    join(chronicleDir, "index.json"),
    JSON.stringify([
      {
        entryId: chronicleEntry.entryId,
        domain: chronicleEntry.domain,
        polarity: chronicleEntry.polarity,
        outcome: chronicleEntry.outcome,
        createdAt: chronicleEntry.createdAt,
        problem: chronicleEntry.problem,
        actionTaken: chronicleEntry.actionTaken,
        lesson: chronicleEntry.lesson,
      },
    ]),
    "utf-8",
  );
  await writeFile(join(chronicleDir, "entries", `${chronicleEntry.entryId}.json`), JSON.stringify(chronicleEntry), "utf-8");
}

/** Recursively snapshot a dir tree into { relPath -> content }. */
async function snapshotTree(root: string): Promise<Array<[string, string]>> {
  const out: Array<[string, string]> = [];
  async function walk(dir: string, base: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = join(dir, e.name);
      const rel = base ? join(base, e.name) : e.name;
      if (e.isDirectory()) {
        await walk(full, rel);
      } else {
        out.push([rel, await readFile(full, "utf-8")]);
      }
    }
  }
  await walk(root, "");
  out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return out;
}

// ---------------------------------------------------------------------------
// LearningStoreAdapter
// ---------------------------------------------------------------------------

describe("LearningStoreAdapter", () => {
  it("projects signals.jsonl lines into LearningSignal artifacts", async () => {
    const dir = await makeTempDir();
    await writeFile(
      join(dir, "signals.jsonl"),
      `${JSON.stringify(signal1)}\n${JSON.stringify(signal2)}\n`,
      "utf-8",
    );

    const result = await new LearningStoreAdapter(dir).read();

    assert.equal(result.status.status, "available");
    assert.equal(result.status.store, "learning");
    assert.equal(result.artifacts.length, 2);
    const a = result.artifacts[0];
    assert.equal(a.store, "learning");
    assert.equal(a.artifactKind, "LearningSignal");
    assert.equal(a.subject, "routing_quality_poor");
    assert.equal(a.artifactId, "ls-1");
    assert.equal(a.createdAt, signal1.generatedAt);
    assert.deepEqual(a.claim, { subject: "routing_quality_poor", predicate: "delta", value: JSON.stringify(signal1.delta) });
  });

  it("projects profiles.jsonl and reports.jsonl into CalibrationProfile and LearningReport artifacts", async () => {
    const dir = await makeTempDir();
    await seedLearningDir(dir);

    const result = await new LearningStoreAdapter(dir).read();

    const kinds = result.artifacts.map((a) => a.artifactKind);
    assert.ok(kinds.includes("CalibrationProfile"));
    assert.ok(kinds.includes("LearningReport"));

    const profileArtifact = result.artifacts.find((a) => a.artifactKind === "CalibrationProfile");
    assert.ok(profileArtifact);
    assert.equal(profileArtifact.subject, "recommendation_confidence_multiplier+recommendation");
    assert.deepEqual(profileArtifact.claim, {
      subject: "recommendation_confidence_multiplier",
      predicate: "value",
      value: "0.9",
    });

    const reportArtifact = result.artifacts.find((a) => a.artifactKind === "LearningReport");
    assert.ok(reportArtifact);
    assert.equal(reportArtifact.store, "learning");
  });

  it("skips corrupt JSONL lines without suppressing valid neighbors", async () => {
    const dir = await makeTempDir();
    await writeFile(join(dir, "signals.jsonl"), `{ this is not valid json\n${JSON.stringify(signal1)}\n`, "utf-8");

    const result = await new LearningStoreAdapter(dir).read();

    assert.equal(result.status.status, "available");
    assert.equal(result.artifacts.length, 1);
    assert.equal(result.artifacts[0].artifactId, "ls-1");
  });

  it("skips a valid-JSON signal missing a claim/content field instead of projecting undefined", async () => {
    const dir = await makeTempDir();
    await writeFile(
      join(dir, "signals.jsonl"),
      `${JSON.stringify({ id: "ls-bad", generatedAt: "2026-08-01T00:00:00.000Z", summary: "no signalType" })}\n${JSON.stringify(signal1)}\n`,
      "utf-8",
    );

    const result = await new LearningStoreAdapter(dir).read();

    assert.equal(result.status.status, "available");
    assert.equal(result.artifacts.length, 1);
    assert.equal(result.artifacts[0].artifactId, "ls-1");
    assert.ok(result.artifacts.every((a) => a.subject !== "undefined"));
  });

  it("returns unavailable on a missing directory", async () => {
    const result = await new LearningStoreAdapter(join(tmpdir(), "no-learning-a6")).read();

    assert.deepEqual(result.artifacts, []);
    assert.equal(result.status.status, "unavailable");
    assert.equal(result.status.store, "learning");
  });

  it("returns available with zero artifacts on an existing empty directory", async () => {
    const dir = await makeTempDir();

    const result = await new LearningStoreAdapter(dir).read();

    assert.equal(result.status.status, "available");
    assert.equal(result.artifacts.length, 0);
  });
});

// ---------------------------------------------------------------------------
// ChronicleAdapter
// ---------------------------------------------------------------------------

describe("ChronicleAdapter", () => {
  it("projects index + entry files into ChronicleEntry artifacts with an outcome claim", async () => {
    const root = await makeTempDir();
    await seedChronicleDir(root);

    const result = await new ChronicleAdapter(root).read();

    assert.equal(result.status.status, "available");
    assert.equal(result.status.store, "chronicle");
    assert.equal(result.artifacts.length, 1);
    const a = result.artifacts[0];
    assert.equal(a.store, "chronicle");
    assert.equal(a.artifactKind, "ChronicleEntry");
    assert.equal(a.artifactId, "e1");
    assert.equal(a.createdAt, chronicleEntry.createdAt);
    assert.deepEqual(a.claim, { subject: "SC-001", predicate: "outcome", value: "success" });
  });

  it("skips corrupt entry files without suppressing valid neighbors", async () => {
    const root = await makeTempDir();
    const chronicleDir = join(root, ".alix", "chronicle");
    await mkdir(join(chronicleDir, "entries"), { recursive: true });
    await writeFile(
      join(chronicleDir, "index.json"),
      JSON.stringify([
        { entryId: "e-bad", domain: "tool", polarity: "neutral", outcome: "failure", createdAt: "2026-08-01T00:00:00.000Z", problem: "p", actionTaken: "a", lesson: "l" },
        { entryId: "e1", domain: "tool", polarity: "neutral", outcome: "success", createdAt: "2026-08-01T00:00:00.000Z", problem: "p", actionTaken: "a", lesson: "l" },
      ]),
      "utf-8",
    );
    await writeFile(join(chronicleDir, "entries", "e-bad.json"), "{ not json", "utf-8");
    await writeFile(join(chronicleDir, "entries", "e1.json"), JSON.stringify(chronicleEntry), "utf-8");

    const result = await new ChronicleAdapter(root).read();

    assert.equal(result.status.status, "available");
    assert.equal(result.artifacts.length, 1);
    assert.equal(result.artifacts[0].artifactId, "e1");
  });

  it("returns unavailable on a missing directory", async () => {
    const result = await new ChronicleAdapter(join(tmpdir(), "no-chronicle-a6")).read();

    assert.deepEqual(result.artifacts, []);
    assert.equal(result.status.status, "unavailable");
    assert.equal(result.status.store, "chronicle");
  });
});

// ---------------------------------------------------------------------------
// FailureMemoryAdapter
// ---------------------------------------------------------------------------

describe("FailureMemoryAdapter", () => {
  it("projects FailureRecord fields into claim when failureType present", async () => {
    const dir = await makeTempDir();
    await writeFile(join(dir, "failure-memory.jsonl"), `${JSON.stringify(failureRecord)}\n`, "utf-8");

    const result = await new FailureMemoryAdapter(dir).read();

    assert.equal(result.status.status, "available");
    assert.equal(result.artifacts.length, 1);
    const a = result.artifacts[0];
    assert.equal(a.store, "failure_memory");
    assert.equal(a.artifactKind, "FailureRecord");
    assert.equal(a.subject, "policy_denied");
    assert.equal(a.createdAt, failureRecord.timestamp);
    assert.deepEqual(a.claim, { subject: "policy_denied", predicate: "failureType", value: "policy denied command" });
  });

  it("returns unavailable on a missing directory", async () => {
    const result = await new FailureMemoryAdapter(join(tmpdir(), "no-fm-a6")).read();

    assert.deepEqual(result.artifacts, []);
    assert.equal(result.status.status, "unavailable");
    assert.equal(result.status.store, "failure_memory");
  });
});

// ---------------------------------------------------------------------------
// PatternRegistryAdapter
// ---------------------------------------------------------------------------

describe("PatternRegistryAdapter", () => {
  it("projects in-memory registry stats into Pattern artifacts per task type", async () => {
    const dir = await makeTempDir();
    const registry = new PatternRegistry(dir);
    await registry.recordOutcome("bugfix", { success: true, iterations: 2, totalTokens: 500 });

    const result = await new PatternRegistryAdapter(registry).read();

    assert.equal(result.status.status, "available");
    assert.equal(result.status.store, "pattern_registry");
    assert.equal(result.artifacts.length, 1);
    const a = result.artifacts[0];
    assert.equal(a.store, "pattern_registry");
    assert.equal(a.artifactKind, "Pattern");
    assert.equal(a.subject, "bugfix");
    assert.equal(a.artifactId, "pattern:bugfix");
    assert.ok(a.content.includes("successRate"));
  });

  it("returns available with zero artifacts for an empty registry", async () => {
    const dir = await makeTempDir();
    const registry = new PatternRegistry(dir);

    const result = await new PatternRegistryAdapter(registry).read();

    assert.equal(result.status.status, "available");
    assert.equal(result.artifacts.length, 0);
  });

  it("never throws — returns unavailable when the registry getter throws", async () => {
    const throwingRegistry = {
      getStats: () => {
        throw new Error("registry boom");
      },
    } as unknown as PatternRegistry;

    const result = await new PatternRegistryAdapter(throwingRegistry).read();

    assert.deepEqual(result.artifacts, []);
    assert.equal(result.status.status, "unavailable");
    assert.equal(result.status.store, "pattern_registry");
    assert.equal(result.status.reason, "registry boom");
  });

  it("skips a partially-malformed stats record instead of projecting undefined fields", async () => {
    const dir = await makeTempDir();
    const registry = new PatternRegistry(dir);
    await registry.recordOutcome("bugfix", { success: true, iterations: 2, totalTokens: 500 });
    // Corrupt the in-memory stats to drop a field consumed into content.
    (registry as unknown as { stats: Map<string, unknown> }).stats.set("bugfix", { count: 1 });

    const result = await new PatternRegistryAdapter(registry).read();

    assert.equal(result.status.status, "available");
    assert.equal(result.artifacts.length, 0);
    assert.ok(result.artifacts.every((a) => !String(a.content).includes("undefined")));
  });
});

// ---------------------------------------------------------------------------
// EvidenceAdapter
// ---------------------------------------------------------------------------

describe("EvidenceAdapter", () => {
  it("projects VerificationEvidence into artifacts with store evidence", async () => {
    const ledger = new InMemoryVerificationEvidenceLedger();
    const evidence = createVerificationEvidence({
      verificationId: "ver-1",
      proposalId: "prop-1",
      replayDatasetId: "dataset-1",
      proposalSnapshotHash: "snap-1",
      environmentHash: "env-1",
      baselineMetrics: { accuracy: 0.8 },
      candidateMetrics: { accuracy: 0.85 },
      metricDeltas: { accuracy: 0.05 },
      behavioralChanges: ["improved accuracy"],
      confidenceProfile: {
        replayFidelity: 0.9,
        coverage: 0.8,
        determinism: 0.9,
        historicalSimilarity: 0.8,
        overallConfidence: 0.85,
      },
      reproducibilityLevel: 2,
      lineage: [
        { step: "replay", sourceId: "dataset-1", sourceType: "replay_dataset", timestamp: "2026-08-01T00:00:00.000Z" },
      ],
      verifiedAt: "2026-08-01T00:00:00.000Z",
    });
    await ledger.store(evidence);

    const result = await new EvidenceAdapter(ledger, [evidence.proposalId]).read();

    assert.equal(result.status.status, "available");
    assert.equal(result.status.store, "evidence");
    assert.equal(result.artifacts.length, 1);
    const a = result.artifacts[0];
    assert.equal(a.store, "evidence");
    assert.equal(a.artifactKind, "VerificationEvidence");
    assert.equal(a.artifactId, evidence.evidenceId);
    assert.equal(a.createdAt, evidence.verifiedAt);
    assert.deepEqual(a.evidenceRefs, [evidence.evidenceId]);
  });

  it("projects a structured claim from the observed metric deltas", async () => {
    const ledger = new InMemoryVerificationEvidenceLedger();
    const evidence = createVerificationEvidence({
      verificationId: "ver-claim",
      proposalId: "prop-claim",
      replayDatasetId: "dataset-1",
      proposalSnapshotHash: "snap-1",
      environmentHash: "env-1",
      baselineMetrics: { accuracy: 0.8 },
      candidateMetrics: { accuracy: 0.85 },
      metricDeltas: { accuracy: 0.05, latency: -2 },
      behavioralChanges: [],
      confidenceProfile: {
        replayFidelity: 0.9,
        coverage: 0.8,
        determinism: 0.9,
        historicalSimilarity: 0.8,
        overallConfidence: 0.85,
      },
      reproducibilityLevel: 2,
      lineage: [],
      verifiedAt: "2026-08-01T00:00:00.000Z",
    });
    await ledger.store(evidence);

    const [a] = (await new EvidenceAdapter(ledger, ["prop-claim"]).read()).artifacts;
    // Lexicographically-first metric delta (deterministic): accuracy → 0.05.
    assert.deepEqual(a.claim, { subject: "accuracy", predicate: "delta", value: "0.05" });
  });

  it("enumerates every proposal when no proposal list is supplied", async () => {
    const ledger = new InMemoryVerificationEvidenceLedger();
    const e1 = createVerificationEvidence({
      verificationId: "ver-1",
      proposalId: "prop-1",
      replayDatasetId: "dataset-1",
      proposalSnapshotHash: "snap-1",
      environmentHash: "env-1",
      baselineMetrics: {},
      candidateMetrics: {},
      metricDeltas: {},
      behavioralChanges: [],
      confidenceProfile: {
        replayFidelity: 0.9,
        coverage: 0.8,
        determinism: 0.9,
        historicalSimilarity: 0.8,
        overallConfidence: 0.85,
      },
      reproducibilityLevel: 2,
      lineage: [],
      verifiedAt: "2026-08-01T00:00:00.000Z",
    });
    const e2 = createVerificationEvidence({
      verificationId: "ver-2",
      proposalId: "prop-2",
      replayDatasetId: "dataset-1",
      proposalSnapshotHash: "snap-1",
      environmentHash: "env-1",
      baselineMetrics: {},
      candidateMetrics: {},
      metricDeltas: {},
      behavioralChanges: [],
      confidenceProfile: {
        replayFidelity: 0.9,
        coverage: 0.8,
        determinism: 0.9,
        historicalSimilarity: 0.8,
        overallConfidence: 0.85,
      },
      reproducibilityLevel: 2,
      lineage: [],
      verifiedAt: "2026-08-01T00:00:00.000Z",
    });
    await ledger.store(e1);
    await ledger.store(e2);

    const result = await new EvidenceAdapter(ledger).read();
    assert.equal(result.status.status, "available");
    assert.equal(result.artifacts.length, 2);
    assert.deepEqual(
      result.artifacts.map((a) => a.artifactId).sort(),
      [e1.evidenceId, e2.evidenceId].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// Read-only snapshot — adapters must never write
// ---------------------------------------------------------------------------

describe("Read-only adapters", () => {
  it("leave store dirs byte-identical and in-memory sources unchanged after read()", async () => {
    const tmp = await makeTempDir();

    // Learning store
    const learningDir = join(tmp, "learning");
    await mkdir(learningDir, { recursive: true });
    await seedLearningDir(learningDir);

    // Chronicle store
    const chronicleRoot = join(tmp, "chronicle-root");
    await seedChronicleDir(chronicleRoot);

    // Failure memory
    const fmDir = join(tmp, "failure-memory");
    await mkdir(fmDir, { recursive: true });
    await writeFile(join(fmDir, "failure-memory.jsonl"), `${JSON.stringify(failureRecord)}\n`, "utf-8");

    // Pattern registry (persists stats.json to its dir)
    const registryDir = join(tmp, "pattern-registry");
    const registry = new PatternRegistry(registryDir);
    await registry.recordOutcome("bugfix", { success: true, iterations: 2, totalTokens: 500 });

    // Evidence ledger (in-memory)
    const ledger = new InMemoryVerificationEvidenceLedger();
    const evidence = createVerificationEvidence({
      verificationId: "ver-1",
      proposalId: "prop-1",
      replayDatasetId: "dataset-1",
      proposalSnapshotHash: "snap-1",
      environmentHash: "env-1",
      baselineMetrics: { accuracy: 0.8 },
      candidateMetrics: { accuracy: 0.85 },
      metricDeltas: { accuracy: 0.05 },
      behavioralChanges: ["improved accuracy"],
      confidenceProfile: {
        replayFidelity: 0.9,
        coverage: 0.8,
        determinism: 0.9,
        historicalSimilarity: 0.8,
        overallConfidence: 0.85,
      },
      reproducibilityLevel: 2,
      lineage: [
        { step: "replay", sourceId: "dataset-1", sourceType: "replay_dataset", timestamp: "2026-08-01T00:00:00.000Z" },
      ],
      verifiedAt: "2026-08-01T00:00:00.000Z",
    });
    await ledger.store(evidence);

    // Snapshot state before
    const treeBefore = await snapshotTree(tmp);
    const registryBefore = registry.getStats("bugfix");
    const ledgerBefore = await ledger.listByProposal(evidence.proposalId, { includeExpired: true });

    // Run every adapter
    const results: KnowledgeArtifact[][] = [];
    results.push((await new LearningStoreAdapter(learningDir).read()).artifacts);
    results.push((await new ChronicleAdapter(chronicleRoot).read()).artifacts);
    results.push((await new FailureMemoryAdapter(fmDir).read()).artifacts);
    results.push((await new PatternRegistryAdapter(registry).read()).artifacts);
    results.push((await new EvidenceAdapter(ledger, [evidence.proposalId]).read()).artifacts);

    // Every adapter projected at least one artifact (seeded inputs are non-empty)
    for (const artifacts of results) {
      assert.ok(artifacts.length > 0, "seeded store should project artifacts");
    }

    // Snapshot state after
    const treeAfter = await snapshotTree(tmp);

    assert.deepEqual(treeAfter, treeBefore, "store dirs must be byte-identical after read()");
    assert.deepEqual(registry.getStats("bugfix"), registryBefore, "pattern registry must not mutate");
    assert.deepEqual(
      await ledger.listByProposal(evidence.proposalId, { includeExpired: true }),
      ledgerBefore,
      "evidence ledger must not mutate",
    );
  });
});
