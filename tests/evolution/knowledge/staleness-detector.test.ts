// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectStale } from "../../../src/evolution/knowledge/detectors/index.js";
import {
  DEFAULT_CURATION_CONFIG,
  type CurationConfig,
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
// detectStale
// ---------------------------------------------------------------------------

describe("detectStale", () => {
  it("flags an artifact older than staleAfterDays with reasonCode 'age'", () => {
    const artifact = makeArtifact("old-art");
    const findings = detectStale([artifact], DEFAULT_CURATION_CONFIG);
    const age = findings.find((f) => f.reasonCode === "age" && f.artifactId === "old-art");
    assert.ok(age, "expected an age finding for the old artifact");
    assert.equal(age.kind, "stale");
    assert.equal(age.store, "learning");
  });

  it("does not flag an artifact whose age is below the configurable threshold", () => {
    const config: CurationConfig = { ...DEFAULT_CURATION_CONFIG, staleAfterDays: 1_000_000 };
    const artifact = makeArtifact("young-enough");
    assert.deepEqual(detectStale([artifact], config), []);
  });

  it("flags a superseded artifact with reasonCode 'superseded' pointing at the newer artifact", () => {
    const older = makeArtifact("art-old", {
      subject: "agents",
      createdAt: "2020-01-01T00:00:00.000Z",
    });
    const newer = makeArtifact("art-new", {
      subject: "agents",
      createdAt: "2021-01-01T00:00:00.000Z",
    });
    const findings = detectStale([newer, older], DEFAULT_CURATION_CONFIG);
    const superseded = findings.find(
      (f) => f.reasonCode === "superseded" && f.artifactId === "art-old",
    );
    assert.ok(superseded, "expected a superseded finding for the older artifact");
    assert.equal(superseded.targetId, "art-new");
    assert.equal(superseded.kind, "stale");
    // The newer artifact is not superseded by anything.
    assert.ok(
      !findings.some((f) => f.reasonCode === "superseded" && f.artifactId === "art-new"),
      "newer artifact must not be superseded",
    );
  });

  it("flags an artifact whose claim is contradicted by a newer evidence artifact", () => {
    const knowledge = makeArtifact("kn-1", {
      store: "learning",
      claim: { subject: "router", predicate: "latency_p90_ms", value: "120" },
    });
    const evidence = makeArtifact("ev-1", {
      store: "evidence",
      artifactKind: "VerificationEvidence",
      createdAt: "2021-01-01T00:00:00.000Z",
      evidenceRefs: ["ev-1"],
      claim: { subject: "router", predicate: "latency_p90_ms", value: "240" },
    });
    const findings = detectStale([knowledge, evidence], DEFAULT_CURATION_CONFIG);
    const contradicted = findings.find(
      (f) => f.reasonCode === "outcome_contradiction" && f.artifactId === "kn-1",
    );
    assert.ok(contradicted, "expected an outcome_contradiction finding");
    assert.equal(contradicted.targetId, "ev-1");
    assert.equal(contradicted.kind, "stale");
  });

  it("does not flag an old artifact that has evidence of refresh (evidenceRefs)", () => {
    const refreshed = makeArtifact("old-but-refreshed", {
      evidenceRefs: ["ev-refreshed"],
    });
    assert.deepEqual(detectStale([refreshed], DEFAULT_CURATION_CONFIG), []);
  });

  it("never flags an A5 evidence projection as stale by age", () => {
    const evidence = makeArtifact("ev-1", {
      store: "evidence",
      artifactKind: "VerificationEvidence",
      createdAt: "2020-01-01T00:00:00.000Z",
      evidenceRefs: ["ev-1"],
    });
    const findings = detectStale([evidence], DEFAULT_CURATION_CONFIG);
    assert.ok(
      !findings.some((f) => f.reasonCode === "age"),
      "evidence artifacts must not produce age findings",
    );
  });

  it("flags every non-newest artifact superseded by the NEWEST in the cluster (no double-flag)", () => {
    const oldA = makeArtifact("art-a", {
      subject: "agents",
      createdAt: "2100-01-01T00:00:00.000Z",
    });
    const midB = makeArtifact("art-b", {
      subject: "agents",
      createdAt: "2101-01-01T00:00:00.000Z",
    });
    const newC = makeArtifact("art-c", {
      subject: "agents",
      createdAt: "2102-01-01T00:00:00.000Z",
    });
    const findings = detectStale([newC, midB, oldA], DEFAULT_CURATION_CONFIG);
    const superseded = findings.filter((f) => f.reasonCode === "superseded");
    // Both A and B are superseded, each pointing at the newest (C) — so B is
    // never simultaneously a superseder and superseded (no double-flag).
    assert.equal(superseded.length, 2);
    const aFinding = superseded.find((f) => f.artifactId === "art-a");
    const bFinding = superseded.find((f) => f.artifactId === "art-b");
    assert.ok(aFinding, "expected art-a superseded");
    assert.ok(bFinding, "expected art-b superseded");
    assert.equal(aFinding?.targetId, "art-c");
    assert.equal(bFinding?.targetId, "art-c");
    assert.ok(
      !findings.some((f) => f.reasonCode === "superseded" && f.artifactId === "art-c"),
      "newest artifact must not be superseded",
    );
  });

  it("returns no findings for a fresh artifact", () => {
    const fresh = makeArtifact("fresh-art", { createdAt: "2099-01-01T00:00:00.000Z" });
    assert.deepEqual(detectStale([fresh], DEFAULT_CURATION_CONFIG), []);
  });

  it("is pure: does not mutate its input artifacts", () => {
    const artifacts = [
      makeArtifact("a", { claim: { subject: "s", predicate: "p", value: "1" } }),
      makeArtifact("b", { subject: "agents", createdAt: "2021-01-01T00:00:00.000Z" }),
      makeArtifact("c", {
        store: "evidence",
        artifactKind: "VerificationEvidence",
        createdAt: "2021-02-01T00:00:00.000Z",
        evidenceRefs: ["ev-c"],
        claim: { subject: "s", predicate: "p", value: "2" },
      }),
    ];
    const snapshot = JSON.stringify(artifacts);
    const frozen = deepFreeze(artifacts);
    detectStale(frozen, DEFAULT_CURATION_CONFIG);
    assert.equal(JSON.stringify(frozen), snapshot);
  });
});
