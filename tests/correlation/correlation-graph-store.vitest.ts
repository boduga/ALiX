import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { CorrelationGraphStore } from "../../src/correlation/correlation-graph-store.js";
import { CorrelationGraphLoadError } from "../../src/correlation/correlation-types.js";
import type { CorrelationGraph } from "../../src/correlation/correlation-types.js";

function makeGraph(overrides: Partial<CorrelationGraph> = {}): CorrelationGraph {
  return {
    schemaVersion: "p11.1.0",
    generatedAt: new Date().toISOString(),
    windowSize: 12,
    status: "ok",
    nodes: [],
    edges: [],
    meta: {
      totalSnapshotsExamined: 0,
      minConfidenceThreshold: 0.35,
      maxLagExamined: 3,
      degradationThreshold: -5,
      canonicalSubsystems: [
        "memory", "workflow", "skills", "agents",
        "tools", "security", "governance", "adaptation",
      ],
      excludedSubsystems: ["demo"],
    },
    ...overrides,
  };
}

describe("CorrelationGraphStore", () => {
  let dir: string;
  let store: CorrelationGraphStore;

  beforeEach(() => {
    dir = join(tmpdir(), `corr-store-test-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    store = new CorrelationGraphStore(dir);
  });

  afterEach(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it("writeThenRead round-trips", async () => {
    const graph = makeGraph({
      nodes: [{ subsystem: "memory", score: 85, status: "healthy", drift: [], evidenceIds: [] }],
      edges: [{
        source: "memory", target: "workflow",
        coOccurrenceRate: 0.5, temporalLag: 1,
        correlationDirection: "positive", correlationConfidence: 0.6,
        evidenceIds: ["snap-1"],
      }],
      meta: { ...makeGraph().meta, totalSnapshotsExamined: 10 },
    });
    await store.save(graph);
    const loaded = await store.loadLatest();
    expect(loaded).not.toBeNull();
    expect(loaded!.schemaVersion).toBe("p11.1.0");
    expect(loaded!.nodes).toHaveLength(1);
    expect(loaded!.edges).toHaveLength(1);
    expect(loaded!.edges[0].correlationConfidence).toBe(0.6);
  });

  it("exists() returns false for missing graph", async () => {
    expect(await store.exists()).toBe(false);
  });

  it("loadLatest() returns null for missing graph", async () => {
    expect(await store.loadLatest()).toBeNull();
  });

  it("loadLatest() throws on invalid schemaVersion", async () => {
    writeFileSync(
      store.filePath,
      JSON.stringify({ schemaVersion: "p10.0.0", nodes: [], edges: [], meta: {} }),
      "utf-8",
    );
    await expect(store.loadLatest()).rejects.toThrow(CorrelationGraphLoadError);
  });

  it("loadLatest() throws on invalid subsystem ID in node", async () => {
    const graph = makeGraph({
      nodes: [{ subsystem: "invalid" as never, score: 50, status: "warning", drift: [], evidenceIds: [] }],
    });
    await store.save(graph);
    await expect(store.loadLatest()).rejects.toThrow(CorrelationGraphLoadError);
  });

  it("loadLatest() throws on invalid JSON", async () => {
    writeFileSync(store.filePath, "{broken", "utf-8");
    await expect(store.loadLatest()).rejects.toThrow(CorrelationGraphLoadError);
  });

  it("loadLatest() marks stale when staleAfterMs passed", async () => {
    const oldDate = new Date(Date.now() - 5000).toISOString();
    const graph = makeGraph({ generatedAt: oldDate });
    await store.save(graph);
    const loaded = await store.loadLatest({ staleAfterMs: 1000 });
    expect(loaded).not.toBeNull();
    expect(loaded!.status).toBe("stale");
  });

  it("failed write does not corrupt previous graph", async () => {
    const graph = makeGraph();
    await store.save(graph);
    // Write corrupt tmp but don't rename — saved file is intact
    writeFileSync(store.tmpPath, "corrupt", "utf-8");
    const loaded = await store.loadLatest();
    expect(loaded).not.toBeNull();
    expect(loaded!.schemaVersion).toBe("p11.1.0");
  });
});
