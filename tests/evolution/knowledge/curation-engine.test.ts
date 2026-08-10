// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CurationEngine } from "../../../src/evolution/knowledge/curation-engine.js";
import {
  DEFAULT_CURATION_CONFIG,
  type CurationConfig,
  type CurationFinding,
  type CurationFindingKind,
  type CurationFindingSeverity,
  type KnowledgeArtifact,
  type KnowledgeStore,
} from "../../../src/evolution/knowledge/contracts/curation-contract.js";
import type { AdapterResult } from "../../../src/evolution/knowledge/adapters/shared.js";

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

/** A stub read-only adapter that returns a canned result. */
function stubAdapter(result: AdapterResult): () => Promise<AdapterResult> {
  return async () => result;
}

function availableAdapter(artifact: KnowledgeArtifact): () => Promise<AdapterResult> {
  return stubAdapter({
    artifacts: [artifact],
    status: { status: "available", store: artifact.store },
  });
}

function unavailableAdapter(store: KnowledgeStore): () => Promise<AdapterResult> {
  return stubAdapter({
    artifacts: [],
    status: { status: "unavailable", store, reason: "stub-store-unreachable" },
  });
}

/** A stub detector that emits one deterministic finding per artifact. */
function stubDetector(kind: CurationFindingKind, reasonCode = "stub"): (artifacts: KnowledgeArtifact[], config: CurationConfig) => CurationFinding[] {
  return (artifacts: KnowledgeArtifact[]) =>
    artifacts.map((a) => findingFor(a, kind, reasonCode));
}

function findingFor(
  artifact: KnowledgeArtifact,
  kind: CurationFindingKind,
  reasonCode: string,
  severity: CurationFindingSeverity = "medium",
): CurationFinding {
  return {
    findingId: `${kind}:${artifact.store}:${artifact.artifactId}`,
    kind,
    reasonCode,
    store: artifact.store,
    artifactId: artifact.artifactId,
    artifactKind: artifact.artifactKind,
    severity,
    rationale: `stub ${kind} finding for ${artifact.artifactId}`,
    evidenceRefs: [],
    confidence: 1,
    createdAt: new Date().toISOString(),
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
// CurationEngine
// ---------------------------------------------------------------------------

describe("CurationEngine.curateAll", () => {
  it("returns findings from an available store and a storeStatus entry for an unavailable store", async () => {
    const engine = new CurationEngine({
      adapters: [availableAdapter(makeArtifact("stale-art", { store: "learning" })), unavailableAdapter("chronicle")],
      detectors: [stubDetector("stale")],
    });

    const result = await engine.curateAll();

    // Findings come from the available store's artifact.
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].artifactId, "stale-art");
    assert.equal(result.findings[0].store, "learning");

    // Store status is reported in adapter order, unavailable included.
    assert.deepEqual(result.storeStatus, [
      { status: "available", store: "learning" },
      { status: "unavailable", store: "chronicle", reason: "stub-store-unreachable" },
    ]);
  });

  it("does not let an unavailable store suppress findings from the other stores", async () => {
    const engine = new CurationEngine({
      adapters: [
        unavailableAdapter("chronicle"),
        availableAdapter(makeArtifact("a", { store: "learning" })),
        availableAdapter(makeArtifact("b", { store: "failure_memory" })),
        availableAdapter(makeArtifact("c", { store: "pattern_registry" })),
      ],
      detectors: [stubDetector("stale")],
    });

    const result = await engine.curateAll();

    // All three available stores contribute findings despite the unavailable one.
    assert.deepEqual(result.findings.map((f) => f.artifactId), ["a", "b", "c"]);
    assert.equal(result.storeStatus.length, 4);
    assert.ok(
      result.storeStatus.some((s) => s.status === "unavailable" && s.store === "chronicle"),
      "unavailable store still reported in storeStatus",
    );
  });

  it("preserves adapter-then-detector ordering of findings", async () => {
    const seen: string[][] = [];
    const engine = new CurationEngine({
      adapters: [
        availableAdapter(makeArtifact("first", { store: "learning" })),
        availableAdapter(makeArtifact("second", { store: "failure_memory" })),
      ],
      detectors: [
        (artifacts, _config) => {
          seen.push(artifacts.map((a) => a.artifactId));
          return [findingFor(artifacts[0], "stale", "detector-a")];
        },
        (artifacts, _config) => {
          seen.push(artifacts.map((a) => a.artifactId));
          return [findingFor(artifacts[0], "duplicate", "detector-b")];
        },
      ],
    });

    const result = await engine.curateAll();

    // Both detectors see the combined artifact list in adapter order.
    assert.deepEqual(seen[0], ["first", "second"]);
    assert.deepEqual(seen[1], ["first", "second"]);
    // Adapter phase contributes no findings; detector findings keep detector order.
    assert.deepEqual(result.findings.map((f) => f.reasonCode), ["detector-a", "detector-b"]);
  });

  it("produces identical finding ids when run twice on the same input", async () => {
    const engine = new CurationEngine({
      adapters: [availableAdapter(makeArtifact("dup-a", { store: "learning" }))],
      detectors: [stubDetector("duplicate")],
    });

    const first = await engine.curateAll();
    const second = await engine.curateAll();

    assert.deepEqual(
      first.findings.map((f) => f.findingId),
      second.findings.map((f) => f.findingId),
    );
  });

  it("uses DEFAULT_CURATION_CONFIG when no config is supplied", async () => {
    let received: CurationConfig | undefined;
    const engine = new CurationEngine({
      adapters: [availableAdapter(makeArtifact("cfg-art", { store: "learning" }))],
      detectors: [
        (artifacts, config) => {
          received = config;
          return [];
        },
      ],
    });

    await engine.curateAll();

    assert.equal(received, DEFAULT_CURATION_CONFIG);
  });

  it("never mutates artifacts returned by adapters", async () => {
    const artifact = makeArtifact("frozen", { store: "learning" });
    const frozen = deepFreeze(artifact);
    const snapshot = JSON.stringify(artifact);
    const engine = new CurationEngine({
      adapters: [
        async () => ({
          artifacts: deepFreeze([frozen]),
          status: { status: "available" as const, store: "learning" as const },
        }),
      ],
      detectors: [stubDetector("stale")],
    });

    const result = await engine.curateAll();

    assert.equal(result.findings.length, 1);
    assert.equal(JSON.stringify(frozen), snapshot);
  });
});
