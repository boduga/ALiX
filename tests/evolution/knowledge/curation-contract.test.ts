// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CURATION_CONFIG,
  isCurationFinding,
  isKnowledgeArtifact,
  type CurationFinding,
  type CurationProposal,
  type KnowledgeArtifact,
} from "../../../src/evolution/knowledge/contracts/curation-contract.js";

describe("DEFAULT_CURATION_CONFIG", () => {
  it("has the expected default threshold values", () => {
    assert.deepEqual(DEFAULT_CURATION_CONFIG, {
      staleAfterDays: 90,
      duplicateSimilarityThreshold: 0.9,
      compressionAfterDays: 180,
    });
  });
});

describe("isKnowledgeArtifact", () => {
  const validArtifact: KnowledgeArtifact = {
    store: "learning",
    artifactId: "art-1",
    artifactKind: "LearningSignal",
    subject: "agents",
    content: "normalized text for similarity + dedup",
    createdAt: "2026-08-10T00:00:00.000Z",
    evidenceRefs: [],
    downstreamRefs: [],
  };

  it("accepts a valid KnowledgeArtifact", () => {
    assert.ok(isKnowledgeArtifact(validArtifact));
  });

  it("rejects an object missing store", () => {
    const { store: _store, ...missingStore } = validArtifact;
    assert.ok(!isKnowledgeArtifact(missingStore));
  });
});

describe("isCurationFinding", () => {
  const validFinding: CurationFinding = {
    findingId: "find-1",
    kind: "stale",
    reasonCode: "age",
    store: "learning",
    artifactId: "art-1",
    artifactKind: "LearningSignal",
    severity: "medium",
    rationale: "older than staleAfterDays with no evidence of refresh",
    evidenceRefs: [],
    confidence: 0.9,
    createdAt: "2026-08-10T00:00:00.000Z",
  };

  it("accepts a valid CurationFinding", () => {
    assert.ok(isCurationFinding(validFinding));
  });
});

describe("CurationProposal shape", () => {
  it("does NOT extend DecisionArtifact (no required outcome field)", () => {
    const proposal: CurationProposal = {
      proposalId: "prop-1",
      findings: [],
      summary: "0 stale, 0 duplicate, 0 contradiction, 0 compressible",
      dimension: [],
      createdAt: "2026-08-10T00:00:00.000Z",
    };
    assert.ok(!("outcome" in proposal));
  });
});
