// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildObservationEvidence } from "../../../src/evolution/observation/observation-evidence-bridge.js";
import type { ObservationResult } from "../../../src/evolution/observation/contracts/observation-contract.js";

const BASE_TIME = "2026-07-12T00:00:00.000Z";

function makeResult(overrides?: Record<string, unknown>): ObservationResult {
  return {
    observationId: "obs-1",
    status: "pass",
    confidence: 1.0,
    observedAt: BASE_TIME,
    evidence: { cmd: "test" },
    ...overrides,
  } as ObservationResult;
}

describe("buildObservationEvidence", () => {
  it("produces evidence with observed class", () => {
    const evidence = buildObservationEvidence({
      proposalId: "prop-001",
      evolutionId: "evol-001",
      environmentHash: "env-hash",
      observations: [makeResult()],
    });

    assert.equal(evidence.evidenceClass, "observed");
    assert.equal(evidence.proposalId, "prop-001");
  });

  it("computes aggregate metrics from observations", () => {
    const evidence = buildObservationEvidence({
      proposalId: "prop-001",
      evolutionId: "evol-001",
      environmentHash: "env-hash",
      observations: [
        makeResult({ observationId: "o1", status: "pass", confidence: 1.0 }),
        makeResult({ observationId: "o2", status: "fail", confidence: 0.9 }),
        makeResult({ observationId: "o3", status: "error", confidence: 0 }),
      ],
    });

    // baselineMetrics should contain aggregate pass/fail counts
    assert.equal(typeof evidence.baselineMetrics.passCount, "number");
    assert.equal(evidence.baselineMetrics.passCount, 1);
    assert.equal(evidence.baselineMetrics.failCount, 1);
    assert.equal(evidence.baselineMetrics.errorCount, 1);
    assert.equal(typeof evidence.baselineMetrics.meanConfidence, "number");
  });

  it("populates behavioralChanges from observation descriptions", () => {
    const evidence = buildObservationEvidence({
      proposalId: "prop-001",
      evolutionId: "evol-001",
      environmentHash: "env-hash",
      observations: [
        makeResult({ observationId: "o1", status: "pass", description: "CLI exited with code 0" }),
        makeResult({ observationId: "o2", status: "fail", description: "File not found", expected: true, observed: false }),
      ],
    });

    assert.ok(evidence.behavioralChanges.length > 0);
    // Behavioral changes should be faithful projections, not interpretations
    const hasFaithfulProjection = evidence.behavioralChanges.some(
      (c) => c.includes("CLI exited with code 0") || c.includes("File not found"),
    );
    assert.ok(hasFaithfulProjection);
  });

  it("computes integrity hash", () => {
    const evidence = buildObservationEvidence({
      proposalId: "prop-001",
      evolutionId: "evol-001",
      environmentHash: "env-hash",
      observations: [makeResult()],
    });

    assert.equal(typeof evidence.integrityHash, "string");
    assert.ok(evidence.integrityHash.length > 0);
  });

  it("preserves lineage from observations to evidence", () => {
    const evidence = buildObservationEvidence({
      proposalId: "prop-001",
      evolutionId: "evol-001",
      environmentHash: "env-hash",
      observations: [
        makeResult({ observationId: "obs-1" }),
        makeResult({ observationId: "obs-2" }),
      ],
    });

    assert.ok(evidence.lineage.length > 0);
    const obsLineage = evidence.lineage.find((l) => l.step === "observation");
    assert.ok(obsLineage);
  });

  it("deterministic: same inputs produce same outputs", () => {
    const input = {
      proposalId: "prop-001",
      evolutionId: "evol-001",
      environmentHash: "env-hash",
      observations: [makeResult({ observationId: "o1", status: "pass" })],
    };

    const a = buildObservationEvidence(input);
    const b = buildObservationEvidence(input);

    assert.equal(a.evidenceId, b.evidenceId);
    assert.equal(a.integrityHash, b.integrityHash);
  });
});
