// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectDuplicates } from "../../../src/evolution/knowledge/detectors/index.js";
import {
  DEFAULT_CURATION_CONFIG,
  type KnowledgeArtifact,
} from "../../../src/evolution/knowledge/contracts/curation-contract.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeArtifact(id: string, overrides: Partial<KnowledgeArtifact> = {}): KnowledgeArtifact {
  return {
    store: "learning",
    artifactId: id,
    artifactKind: "LearningSignal",
    subject: "agents",
    content: `content for ${id}`,
    createdAt: "2020-01-01T00:00:00.000Z",
    evidenceRefs: [],
    downstreamRefs: [],
    ...overrides,
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

// ---------------------------------------------------------------------------
// detectDuplicates
// ---------------------------------------------------------------------------

describe("detectDuplicates", () => {
  it("flags two artifacts with the same (store, artifactKind, subject) as an exact duplicate", () => {
    const a = makeArtifact("art-A", {
      content: "completely unrelated content about parsing",
    });
    const b = makeArtifact("art-B", {
      content: "totally different topic on memory management",
    });
    const findings = detectDuplicates([a, b], DEFAULT_CURATION_CONFIG);
    const exact = findings.filter((f) => f.reasonCode === "exact");
    assert.equal(exact.length, 1);
    assert.equal(exact[0].kind, "duplicate");
    assert.equal(exact[0].store, "learning");
    // Far-apart content must not additionally be flagged near-duplicate.
    assert.ok(!findings.some((f) => f.reasonCode === "near"));
  });

  it("flags two artifacts with near-identical content above the similarity threshold", () => {
    const a = makeArtifact("art-A", {
      subject: "agents",
      content: "routing chooses the slow path when queue is deep",
    });
    const b = makeArtifact("art-B", {
      subject: "routing",
      content: "routing chooses a slow path when queue is deep",
    });
    const findings = detectDuplicates([a, b], DEFAULT_CURATION_CONFIG);
    const near = findings.filter((f) => f.reasonCode === "near");
    assert.equal(near.length, 1);
    assert.equal(near[0].kind, "duplicate");
    assert.ok(near[0].confidence >= DEFAULT_CURATION_CONFIG.duplicateSimilarityThreshold);
    // Different subjects must not trigger the exact branch.
    assert.ok(!findings.some((f) => f.reasonCode === "exact"));
  });

  it("canonicalizes pairs: targetId is the lexicographically-smaller id regardless of input order", () => {
    const big = makeArtifact("art-Z", {
      subject: "agents",
      content: "routing chooses the slow path when queue is deep",
    });
    const small = makeArtifact("art-A", {
      subject: "routing",
      content: "routing chooses a slow path when queue is deep",
    });
    const forward = detectDuplicates([big, small], DEFAULT_CURATION_CONFIG);
    const reverse = detectDuplicates([small, big], DEFAULT_CURATION_CONFIG);

    const f = forward.filter((x) => x.reasonCode === "near");
    const r = reverse.filter((x) => x.reasonCode === "near");
    assert.equal(f.length, 1);
    assert.equal(r.length, 1);
    // "art-A" < "art-Z" lexicographically, so targetId is always "art-A".
    assert.equal(f[0].targetId, "art-A");
    assert.equal(r[0].targetId, "art-A");
    assert.equal(f[0].artifactId, "art-Z");
    assert.equal(r[0].artifactId, "art-Z");
    // Identical deterministic finding IDs regardless of input order.
    assert.equal(f[0].findingId, r[0].findingId);
  });

  it("is pure: does not mutate its input artifacts", () => {
    const artifacts = [
      makeArtifact("a", { subject: "s", content: "routing chooses the slow path" }),
      makeArtifact("b", { subject: "s", content: "routing chooses a slow path" }),
      makeArtifact("c", { subject: "other", content: "unrelated content here" }),
    ];
    const snapshot = JSON.stringify(artifacts);
    const frozen = deepFreeze(artifacts);
    detectDuplicates(frozen, DEFAULT_CURATION_CONFIG);
    assert.equal(JSON.stringify(frozen), snapshot);
  });

  it("emits exactly one exact finding (not near) when a pair is both same-cluster and content-similar", () => {
    const a = makeArtifact("art-A", {
      subject: "agents",
      content: "routing chooses the slow path when queue is deep",
    });
    const b = makeArtifact("art-B", {
      subject: "agents",
      content: "routing chooses a slow path when queue is deep",
    });
    const findings = detectDuplicates([a, b], DEFAULT_CURATION_CONFIG);
    // Same (store, artifactKind, subject) AND near-identical content — exact
    // wins, and the near pass must skip the pair so the findingId is emitted once.
    assert.equal(findings.length, 1);
    assert.equal(findings[0].reasonCode, "exact");
    assert.equal(findings[0].kind, "duplicate");
    // Every findingId is unique — nothing collapsed or duplicated.
    const ids = new Set(findings.map((f) => f.findingId));
    assert.equal(ids.size, findings.length);
  });

  it("does not group distinct (store, artifactKind, subject) triples that would collide without a delimiter", () => {
    // Delimiter-less concatenation would map both (kind="X", subject="Y") and
    // (kind="XY", subject="") to the same key "learningXY" and collapse all four
    // artifacts into one exact cluster (6 findings). With a field separator the
    // two real clusters stay apart: A+C and B+D → exactly two exact findings.
    const a = makeArtifact("art-A", {
      artifactKind: "X",
      subject: "Y",
      content: "alpha content",
    });
    const b = makeArtifact("art-B", {
      artifactKind: "XY",
      subject: "",
      content: "beta content",
    });
    const c = makeArtifact("art-C", {
      artifactKind: "X",
      subject: "Y",
      content: "gamma content",
    });
    const d = makeArtifact("art-D", {
      artifactKind: "XY",
      subject: "",
      content: "delta content",
    });
    const findings = detectDuplicates([a, b, c, d], DEFAULT_CURATION_CONFIG);
    const exact = findings.filter((f) => f.reasonCode === "exact");
    assert.equal(exact.length, 2);
    // Content differs enough that no near findings are emitted either.
    assert.equal(findings.length, 2);
  });
});
