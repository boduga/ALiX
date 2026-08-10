// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectCompressible } from "../../../src/evolution/knowledge/detectors/index.js";
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
// detectCompressible
// ---------------------------------------------------------------------------

describe("detectCompressible", () => {
  it("flags an old artifact with no evidence and no downstream references", () => {
    const artifact = makeArtifact("old-lonely");
    const findings = detectCompressible([artifact], DEFAULT_CURATION_CONFIG);
    const compressible = findings.filter((f) => f.reasonCode === "low_value_long_lived");
    assert.equal(compressible.length, 1);
    assert.equal(compressible[0].kind, "compressible");
    assert.equal(compressible[0].store, "learning");
    assert.equal(compressible[0].targetId, undefined);
  });

  it("does not flag an old artifact that is referenced by evidence or downstream", () => {
    const hasEvidence = makeArtifact("old-evidence", { evidenceRefs: ["ev-1"] });
    const hasDownstream = makeArtifact("old-downstream", { downstreamRefs: ["child-1"] });
    assert.deepEqual(
      detectCompressible([hasEvidence, hasDownstream], DEFAULT_CURATION_CONFIG),
      [],
    );
  });

  it("does not flag a fresh artifact even with no references", () => {
    const fresh = makeArtifact("fresh-lonely", { createdAt: "2099-01-01T00:00:00.000Z" });
    assert.deepEqual(detectCompressible([fresh], DEFAULT_CURATION_CONFIG), []);
  });

  it("uses the configured compressionAfterDays threshold", () => {
    const config: CurationConfig = { ...DEFAULT_CURATION_CONFIG, compressionAfterDays: 1_000_000 };
    const artifact = makeArtifact("not-old-enough");
    assert.deepEqual(detectCompressible([artifact], config), []);
  });

  it("is pure: does not mutate its input artifacts", () => {
    const artifacts = [
      makeArtifact("a"),
      makeArtifact("b", { evidenceRefs: ["ev-b"] }),
      makeArtifact("c", { createdAt: "2099-01-01T00:00:00.000Z" }),
    ];
    const snapshot = JSON.stringify(artifacts);
    const frozen = deepFreeze(artifacts);
    detectCompressible(frozen, DEFAULT_CURATION_CONFIG);
    assert.equal(JSON.stringify(frozen), snapshot);
  });
});
