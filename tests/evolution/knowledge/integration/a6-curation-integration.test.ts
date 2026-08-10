// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A6 — Curation Integration Test.
 *
 * End-to-end proof of the full A6 knowledge-evolution pipeline:
 *   store adapters → pure detectors → curation proposal builder → A3 decision.
 *
 * The A-series invariant under test: A6 is detect-and-recommend. The entire
 * pipeline — real read-only adapters, CurationEngine orchestration, proposal/
 * evidence/recommendation construction, and the pure A3 `generateDecision`
 * call — must NEVER write a byte to the knowledge stores. That is proven by a
 * byte-identical directory snapshot taken before and after the full flow.
 *
 * Composition notes:
 *   - The engine consumes `() => Promise<AdapterResult>`; each real adapter
 *     exposes `read()`, so each is wrapped as `() => adapter.read()`.
 *   - `detectContradictions` is `(artifacts)` only (no config); it is still a
 *     valid engine detector because fewer-parameter functions are assignable.
 *   - A3 is called at its pure seam: `generateDecision(evidence, recommendation)`
 *     — no A3 store/CLI is instantiated.
 *
 * @module a6-curation-integration
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { CurationEngine } from "../../../../src/evolution/knowledge/curation-engine.js";
import { LearningStoreAdapter } from "../../../../src/evolution/knowledge/adapters/learning-store-adapter.js";
import { ChronicleAdapter } from "../../../../src/evolution/knowledge/adapters/chronicle-adapter.js";
import { FailureMemoryAdapter } from "../../../../src/evolution/knowledge/adapters/failure-memory-adapter.js";
import { PatternRegistryAdapter } from "../../../../src/evolution/knowledge/adapters/pattern-registry-adapter.js";
import { EvidenceAdapter } from "../../../../src/evolution/knowledge/adapters/evidence-adapter.js";
import { detectStale } from "../../../../src/evolution/knowledge/detectors/staleness-detector.js";
import { detectDuplicates } from "../../../../src/evolution/knowledge/detectors/dedup-detector.js";
import { detectContradictions } from "../../../../src/evolution/knowledge/detectors/contradiction-detector.js";
import { detectCompressible } from "../../../../src/evolution/knowledge/detectors/compression-detector.js";
import { DEFAULT_CURATION_CONFIG } from "../../../../src/evolution/knowledge/contracts/curation-contract.js";
import {
  buildCurationProposal,
  buildEvidenceFromFindings,
  buildGovernanceRecommendation,
} from "../../../../src/evolution/knowledge/curation-proposal-builder.js";
import { generateDecision } from "../../../../src/evolution/governance/decision-engine.js";
import { VALID_GOVERNANCE_DECISION_KINDS } from "../../../../src/evolution/governance/contracts/decision-contract.js";
import { PatternRegistry } from "../../../../src/context/pattern-registry.js";
import { InMemoryVerificationEvidenceLedger } from "../../../../src/evolution/verification/evidence/evidence-ledger.js";

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Snapshot helper — recursive listing + raw bytes (deterministic order).
// ---------------------------------------------------------------------------

/**
 * Recursively snapshot a directory: one sorted line per entry, file contents
 * as base64 of the raw bytes so the comparison is byte-exact.
 */
function snapshotDir(dir: string): string {
  const entries: string[] = [];
  const walk = (current: string, rel: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        entries.push(`DIR ${childRel}`);
        walk(join(current, entry.name), childRel);
      } else if (entry.isFile()) {
        entries.push(
          `FILE ${childRel} ${readFileSync(join(current, entry.name)).toString("base64")}`,
        );
      }
    }
  };
  walk(dir, "");
  return entries.sort().join("\n");
}

// ---------------------------------------------------------------------------
// A6 Curation Integration
// ---------------------------------------------------------------------------

describe("A6 Curation Integration", () => {
  let storeDir: string;
  let engine: CurationEngine;

  const STALE_ID = "sig-stale-001";
  const FRESH_ID = "sig-fresh-002";
  const STALE_SIGNAL_TYPE = "overconfidence";
  const FRESH_SIGNAL_TYPE = "underconfidence";

  before(() => {
    storeDir = mkdtempSync(join(tmpdir(), "a6-integration-"));

    // Seed the P8 LearningStore with one stale + one fresh LearningSignal.
    // The stale signal's generatedAt is 200 days in the past (> staleAfterDays
    // 90); the fresh signal is 2 days old. The adapter projects createdAt from
    // generatedAt, so only the stale signal trips the "age" staleness path.
    const staleSignal = {
      id: STALE_ID,
      subject: "calibration",
      outcome: "learning",
      confidence: 0.8,
      reasons: [],
      evidenceRefs: [],
      sourceReportId: "rep-001",
      signalType: STALE_SIGNAL_TYPE,
      strength: 0.8,
      generatedAt: new Date(Date.now() - 200 * DAY_MS).toISOString(),
      summary: "systematically overestimates difficulty on planning-heavy tasks",
    };
    const freshSignal = {
      id: FRESH_ID,
      subject: "calibration",
      outcome: "learning",
      confidence: 0.7,
      reasons: [],
      evidenceRefs: [],
      sourceReportId: "rep-002",
      signalType: FRESH_SIGNAL_TYPE,
      strength: 0.7,
      generatedAt: new Date(Date.now() - 2 * DAY_MS).toISOString(),
      summary: "under-reports context window pressure during rapid file edits",
    };
    writeFileSync(
      join(storeDir, "signals.jsonl"),
      [JSON.stringify(staleSignal), JSON.stringify(freshSignal)].join("\n") + "\n",
    );

    // Wire every real read-only adapter plus all four pure detectors. The
    // file-backed adapters whose stores are absent surface as "unavailable"
    // (a diagnostic, never a proposal) without suppressing the learning store's
    // findings — that resilience is part of the composition proof.
    engine = new CurationEngine({
      adapters: [
        () => new LearningStoreAdapter(storeDir).read(),
        () => new ChronicleAdapter(storeDir).read(),
        () => new FailureMemoryAdapter(join(storeDir, "no-failure-memory")).read(),
        () =>
          new PatternRegistryAdapter(new PatternRegistry(join(storeDir, "no-patterns"))).read(),
        () => new EvidenceAdapter(new InMemoryVerificationEvidenceLedger(), []).read(),
      ],
      detectors: [detectStale, detectDuplicates, detectContradictions, detectCompressible],
    });
  });

  after(() => {
    rmSync(storeDir, { recursive: true, force: true });
  });

  it("end-to-end: adapters → detectors surface the stale signal as a stale finding", async () => {
    const result = await engine.curateAll();

    // Real LearningStoreAdapter projected the seeded signals into artifacts.
    assert.ok(
      result.storeStatus.some((s) => s.status === "available" && s.store === "learning"),
      "learning store should be reported available",
    );
    // Absent stores are diagnostics, never findings.
    assert.ok(
      result.storeStatus.some((s) => s.status === "unavailable" && s.store === "chronicle"),
      "missing chronicle store should be reported unavailable",
    );
    assert.ok(
      result.storeStatus.some(
        (s) => s.status === "unavailable" && s.store === "failure_memory",
      ),
      "missing failure-memory store should be reported unavailable",
    );
    assert.equal(result.storeStatus.length, 5, "one storeStatus per adapter");

    // The stale signal is flagged as an age-based stale finding.
    const staleAge = result.findings.filter(
      (f) => f.kind === "stale" && f.reasonCode === "age",
    );
    assert.equal(staleAge.length, 1, "exactly one age-based stale finding");
    assert.equal(staleAge[0].artifactId, STALE_ID);
    assert.equal(staleAge[0].store, "learning");
    assert.equal(staleAge[0].artifactKind, "LearningSignal");
    assert.equal(staleAge[0].severity, "medium");
    assert.equal(staleAge[0].confidence, 0.8);

    // The fresh signal is NOT flagged as stale.
    assert.ok(
      result.findings.every((f) => f.artifactId !== FRESH_ID || f.kind !== "stale"),
      "fresh signal must not be flagged stale",
    );

    // The long-lived, unreferenced stale signal is also a compression candidate —
    // proving the engine ran every detector over the combined artifact list.
    assert.ok(
      result.findings.some(
        (f) =>
          f.artifactId === STALE_ID &&
          f.kind === "compressible" &&
          f.reasonCode === "low_value_long_lived",
      ),
      "stale signal should also surface as compressible",
    );
  });

  it("builds proposal + recommendation + evidence and produces a valid A3 decision", async () => {
    const result = await engine.curateAll();
    const findings = result.findings;
    assert.ok(findings.length > 0, "findings required to exercise the A6→A3 path");

    const proposal = buildCurationProposal(findings);
    assert.ok(proposal, "non-empty findings must produce a proposal");
    assert.ok(proposal.proposalId.startsWith("cur-"), "proposalId should be content-addressed");
    assert.ok(proposal.dimension.length > 0, "proposal must list covered dimensions");
    assert.equal(proposal.findings.length, findings.length);

    const recommendation = buildGovernanceRecommendation(proposal);
    assert.equal(recommendation.kind, "APPROVE", "A6 always proposes APPROVE; A3 decides");
    assert.ok(
      recommendation.recommendationId.startsWith("rec-curate-"),
      "recommendation should be namespaced",
    );

    const evidence = buildEvidenceFromFindings(findings);
    assert.equal(evidence.evidenceClass, "projected");
    assert.equal(
      recommendation.evidenceId,
      evidence.evidenceId,
      "recommendation must reference the same evidence built from the findings",
    );

    // The A3 integration seam: call the pure decision engine directly.
    const decision = generateDecision(evidence, recommendation);
    assert.equal(typeof decision.decisionId, "string");
    assert.ok(decision.decisionId.startsWith("govd-"), "decisionId should be namespaced");
    assert.ok(
      (VALID_GOVERNANCE_DECISION_KINDS as readonly string[]).includes(decision.kind),
      `decision.kind must be one of ${VALID_GOVERNANCE_DECISION_KINDS.join(", ")}`,
    );
    assert.equal(typeof decision.confidence, "number");
    assert.ok(
      decision.confidence >= 0 && decision.confidence <= 1,
      "decision confidence must be in [0, 1]",
    );
    assert.equal(decision.evidenceId, evidence.evidenceId, "decision ties to the evidence");
    assert.equal(decision.recommendationAvailable, true, "decision records the recommendation");
    assert.ok(decision.decidedAt, "decision carries a decidedAt timestamp");
  });

  it("zero findings produce no proposal and no evidence (zero-findings invariant)", () => {
    assert.equal(buildCurationProposal([]), null, "empty findings → no proposal");

    // By construction there is no A3 path: evidence cannot exist without
    // findings, so no decision can be generated.
    assert.throws(
      () => buildEvidenceFromFindings([]),
      /at least one finding/,
      "evidence builder must refuse empty findings",
    );
  });

  it("the full pipeline never mutates knowledge stores (no-mutation snapshot)", async () => {
    const before = snapshotDir(storeDir);

    // The complete A6 flow: curateAll → proposal → recommendation → evidence → A3 decision.
    const result = await engine.curateAll();
    const proposal = buildCurationProposal(result.findings);
    if (proposal) {
      const recommendation = buildGovernanceRecommendation(proposal);
      const evidence = buildEvidenceFromFindings(result.findings);
      generateDecision(evidence, recommendation);
    }

    const after = snapshotDir(storeDir);
    assert.equal(after, before, "the A6 pipeline must never write a byte to knowledge stores");
  });

  it("is deterministic: identical findingId sets across runs on the same store", async () => {
    const first = await engine.curateAll();
    const second = await engine.curateAll();

    const firstIds = first.findings.map((f) => f.findingId).sort();
    const secondIds = second.findings.map((f) => f.findingId).sort();
    assert.deepEqual(
      secondIds,
      firstIds,
      "same store snapshot + same config → identical findings",
    );
    assert.ok(firstIds.length > 0, "determinism run must actually produce findings");
    assert.equal(
      first.storeStatus.length,
      second.storeStatus.length,
      "store status must be stable across runs",
    );
  });

  it("engine defaults to DEFAULT_CURATION_CONFIG thresholds", async () => {
    // DEFAULT_CURATION_CONFIG is the configuration the engine resolves when
    // none is supplied — the thresholds the stale seed was designed around.
    assert.equal(DEFAULT_CURATION_CONFIG.staleAfterDays, 90);
    assert.equal(DEFAULT_CURATION_CONFIG.compressionAfterDays, 180);

    const result = await engine.curateAll();
    const staleAge = result.findings.find(
      (f) => f.kind === "stale" && f.reasonCode === "age" && f.artifactId === STALE_ID,
    );
    assert.ok(staleAge, "stale age finding should exist under default thresholds");
  });
});
