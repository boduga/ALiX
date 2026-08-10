// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectContradictions } from "../../../src/evolution/knowledge/detectors/index.js";
import type { KnowledgeArtifact } from "../../../src/evolution/knowledge/contracts/curation-contract.js";

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
// detectContradictions
// ---------------------------------------------------------------------------

describe("detectContradictions", () => {
  it("flags two claims on the same subject with different values as a value_clash", () => {
    const a = makeArtifact("art-A", {
      claim: { subject: "router", predicate: "max_connections", value: "100" },
    });
    const b = makeArtifact("art-B", {
      claim: { subject: "router", predicate: "max_connections", value: "250" },
    });
    const findings = detectContradictions([a, b]);
    const clash = findings.filter((f) => f.reasonCode === "value_clash");
    assert.equal(clash.length, 1);
    assert.equal(clash[0].kind, "contradiction");
    assert.equal(clash[0].store, "learning");
  });

  it("does not flag claims whose values agree", () => {
    const a = makeArtifact("art-A", {
      claim: { subject: "router", predicate: "max_connections", value: "100" },
    });
    const b = makeArtifact("art-B", {
      claim: { subject: "router", predicate: "max_connections", value: "100" },
    });
    assert.deepEqual(detectContradictions([a, b]), []);
  });

  it("flags a claim contradicted by observed evidence as outcome_contradiction", () => {
    const knowledge = makeArtifact("kn-1", {
      store: "learning",
      claim: { subject: "router", predicate: "latency_p90_ms", value: "120" },
    });
    const evidence = makeArtifact("ev-1", {
      store: "evidence",
      artifactKind: "VerificationEvidence",
      evidenceRefs: ["ev-1"],
      claim: { subject: "router", predicate: "latency_p90_ms", value: "240" },
    });
    const findings = detectContradictions([knowledge, evidence]);
    const contradicted = findings.filter((f) => f.reasonCode === "outcome_contradiction");
    assert.equal(contradicted.length, 1);
    assert.equal(contradicted[0].kind, "contradiction");
  });

  it("produces no findings for artifacts without a claim", () => {
    const a = makeArtifact("art-A", { content: "routing picks slow path" });
    const b = makeArtifact("art-B", { content: "memory pressure is high" });
    assert.deepEqual(detectContradictions([a, b]), []);
  });

  it("value_clash is scoped to the same (store, artifactKind, subject) cluster", () => {
    // Same claim subject/predicate but different stores → same-cluster rule
    // excludes them: no value_clash (spec §5 "same subject cluster").
    const learning = makeArtifact("art-L", {
      store: "learning",
      claim: { subject: "agents", predicate: "delta", value: "0.5" },
    });
    const chronicle = makeArtifact("art-C", {
      store: "chronicle",
      artifactKind: "ChronicleEntry",
      claim: { subject: "agents", predicate: "delta", value: "0.1" },
    });
    assert.deepEqual(detectContradictions([learning, chronicle]), []);

    // Within the same cluster, the same conflicting claims DO clash.
    const sameCluster = makeArtifact("art-L2", {
      store: "learning",
      claim: { subject: "agents", predicate: "delta", value: "0.1" },
    });
    const findings = detectContradictions([learning, sameCluster]);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].reasonCode, "value_clash");
  });

  it("is pure: does not mutate its input artifacts", () => {
    const artifacts = [
      makeArtifact("a", { claim: { subject: "s", predicate: "p", value: "1" } }),
      makeArtifact("b", {
        store: "evidence",
        artifactKind: "VerificationEvidence",
        evidenceRefs: ["ev-b"],
        claim: { subject: "s", predicate: "p", value: "2" },
      }),
      makeArtifact("c", { claim: { subject: "other", predicate: "p", value: "9" } }),
    ];
    const snapshot = JSON.stringify(artifacts);
    const frozen = deepFreeze(artifacts);
    detectContradictions(frozen);
    assert.equal(JSON.stringify(frozen), snapshot);
  });
});
