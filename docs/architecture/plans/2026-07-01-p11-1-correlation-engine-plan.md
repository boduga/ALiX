# P11.1 — Cross-Subsystem Correlation Engine Implementation

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Correlation Engine — P11.1 of the Cognitive Architecture — producing a typed, deterministic `CorrelationGraph` from baseline comparisons and trend history.

**Architecture:** A pure function `buildCorrelationGraph(comparisons, snapshots, config) → CorrelationGraph` does all edge computation. A thin `CorrelationEngine.run()` orchestrator loads data and calls it. `CorrelationGraphStore` provides atomic persisted I/O. A new `alix executive correlate` CLI command ties them together.

**Tech Stack:** TypeScript, vitest, Node.js 24+, `node:fs`, `node:path`, `node:crypto` (randomUUID for test dirs)

## Global Constraints

- LLMs are **not allowed** in correlation logic — fully deterministic
- `"demo"` subsystem is excluded from production CorrelationGraph nodes
- All confidence values are `0–1`, clamped with `clamp01()`
- All edges with `correlationConfidence < minEdgeConfidence` are filtered out
- Graph status `"insufficient_history"` when snapshots < `minSamples`
- Graph status `"stale"` when latest snapshot is older than `staleAfterWindows`
- Edge math uses **delta series** (score changes), not raw scores
- Atomic write pattern: write to `.tmp`, fsync, rename to target
- Schema version for CorrelationGraph is `"p11.1.0"`
- Existing helper: `computeHealthScore()` already exists in `src/baseline/baseline-comparator.ts` — do not duplicate
- Existing error type pattern: use `CorrelationGraphLoadError extends Error`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `src/correlation/correlation-types.ts` | `CorrelationSubsystemId`, `CorrelationNode`, `CorrelationEdge`, `CorrelationGraph`, `CorrelationGraphStatus`, `CorrelationNodeStatus`, `CorrelationDirection`, `CorrelationEngineConfig` |
| `src/correlation/correlation-config.ts` | `DEFAULT_CORRELATION_CONFIG` constant |
| `src/correlation/normalize-subsystem.ts` | `executiveToCorrelationSubsystem()` mapping, `EXECUTIVE_TO_CORRELATION` table |
| `src/correlation/build-correlation-graph.ts` | Pure `buildCorrelationGraph()` — the core algorithm |
| `src/correlation/correlation-engine.ts` | `CorrelationEngine` orchestrator — loads data, calls pure function |
| `src/correlation/correlation-graph-store.ts` | `CorrelationGraphStore` — atomic read/write + validation |
| `src/cli/commands/executive-correlate-handler.ts` | `handleCorrelateCommand()` — CLI handler for `alix executive correlate` |

### Test Files

| File | Tests |
|------|-------|
| `tests/correlation/normalize-subsystem.vitest.ts` | Executive name normalization |
| `tests/correlation/build-correlation-graph.vitest.ts` | Pure function edge cases |
| `tests/correlation/correlation-graph-store.vitest.ts` | Store read/write/validation |
| `tests/correlation/correlation-engine.vitest.ts` | Integration end-to-end |

### Modified Files

| File | Change |
|------|--------|
| `src/cli/commands/executive.ts` | Add `case "correlate"` in the switch statement |

---

### Task 1: Types and Config

**Files:**
- Create: `src/correlation/correlation-types.ts`
- Create: `src/correlation/correlation-config.ts`

**Interfaces:**
- Produces: `CorrelationSubsystemId`, `CorrelationNodeStatus`, `CorrelationDirection`, `CorrelationGraphStatus`, `CorrelationEdge`, `CorrelationNode`, `CorrelationGraph`, `CorrelationEngineConfig`, `CorrelationGraphLoadError`, `DEFAULT_CORRELATION_CONFIG`

- [ ] **Step 1: Create `src/correlation/correlation-types.ts`**

```typescript
// src/correlation/correlation-types.ts

import type { DriftItem } from "../baseline/baseline-types.js";

export type CorrelationSubsystemId =
  | "memory" | "workflow" | "skills" | "agents"
  | "tools" | "security" | "governance" | "adaptation";

export type BaselineSubsystemId = CorrelationSubsystemId | "demo";

export type CorrelationDirection = "positive" | "negative" | "none";

export type CorrelationGraphStatus = "ok" | "insufficient_history" | "stale";

export type CorrelationNodeStatus =
  | "excellent" | "healthy" | "warning" | "critical" | "unknown";

export interface CorrelationEdge {
  source: CorrelationSubsystemId;
  target: CorrelationSubsystemId;
  coOccurrenceRate: number;
  temporalLag: number;
  correlationDirection: CorrelationDirection;
  correlationConfidence: number;
  evidenceIds: string[];
}

export interface CorrelationNode {
  subsystem: CorrelationSubsystemId;
  score: number;
  status: CorrelationNodeStatus;
  drift: DriftItem[];
  evidenceIds: string[];
}

export interface CorrelationGraph {
  schemaVersion: "p11.1.0";
  generatedAt: string;
  windowSize: number;
  status: CorrelationGraphStatus;
  nodes: CorrelationNode[];
  edges: CorrelationEdge[];
  meta: {
    totalSnapshotsExamined: number;
    minConfidenceThreshold: number;
    maxLagExamined: number;
    degradationThreshold: number;
    canonicalSubsystems: CorrelationSubsystemId[];
    excludedSubsystems: string[];
  };
}

export interface CorrelationEngineConfig {
  windowSize: number;
  minSamples: number;
  maxTemporalLag: number;
  degradationDeltaThreshold: number;
  minEdgeConfidence: number;
  staleAfterWindows: number;
  canonicalSubsystems: CorrelationSubsystemId[];
  excludedSubsystems: string[];
}

export class CorrelationGraphLoadError extends Error {
  readonly code = "CORRELATION_GRAPH_LOAD_ERROR";
  constructor(message: string) {
    super(message);
    this.name = "CorrelationGraphLoadError";
  }
}
```

- [ ] **Step 2: Create `src/correlation/correlation-config.ts`**

```typescript
// src/correlation/correlation-config.ts

import type { CorrelationEngineConfig, CorrelationSubsystemId } from "./correlation-types.js";

const PRODUCTION_SUBSYSTEMS: CorrelationSubsystemId[] = [
  "memory", "workflow", "skills", "agents",
  "tools", "security", "governance", "adaptation",
];

export const DEFAULT_CORRELATION_CONFIG: CorrelationEngineConfig = {
  windowSize: 12,
  minSamples: 6,
  maxTemporalLag: 3,
  degradationDeltaThreshold: -5,
  minEdgeConfidence: 0.35,
  staleAfterWindows: 3,
  canonicalSubsystems: [...PRODUCTION_SUBSYSTEMS],
  excludedSubsystems: ["demo"],
};
```

- [ ] **Step 3: Run typecheck to verify types compile**

Run: `npm run typecheck`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add src/correlation/correlation-types.ts src/correlation/correlation-config.ts
git commit -m "feat(p11.1): add CorrelationGraph types and config"
```

---

### Task 2: Subsystem Name Normalization

**Files:**
- Create: `src/correlation/normalize-subsystem.ts`
- Test: `tests/correlation/normalize-subsystem.vitest.ts`

**Interfaces:**
- Consumes: `CorrelationSubsystemId` (from Task 1)
- Produces: `executiveToCorrelationSubsystem(name: string): CorrelationSubsystemId | null`, `EXECUTIVE_TO_CORRELATION` map

- [ ] **Step 1: Create `src/correlation/normalize-subsystem.ts`**

```typescript
// src/correlation/normalize-subsystem.ts

import type { CorrelationSubsystemId } from "./correlation-types.js";

const EXECUTIVE_TO_CORRELATION: Record<string, CorrelationSubsystemId> = {
  memory: "memory",
  workflow: "workflow",
  learning: "skills",
  agents: "agents",
  tools: "tools",
  security: "security",
  governance: "governance",
  adaptation: "adaptation",
};

export { EXECUTIVE_TO_CORRELATION };

export function executiveToCorrelationSubsystem(
  name: string,
): CorrelationSubsystemId | null {
  return EXECUTIVE_TO_CORRELATION[name] ?? null;
}
```

- [ ] **Step 2: Write tests**

```typescript
// tests/correlation/normalize-subsystem.vitest.ts

import { describe, it, expect } from "vitest";
import { executiveToCorrelationSubsystem } from "../../src/correlation/normalize-subsystem.js";

describe("executiveToCorrelationSubsystem", () => {
  it("maps 'workflow' to 'workflow'", () => {
    expect(executiveToCorrelationSubsystem("workflow")).toBe("workflow");
  });

  it("maps 'learning' to 'skills'", () => {
    expect(executiveToCorrelationSubsystem("learning")).toBe("skills");
  });

  it("maps 'memory' to 'memory'", () => {
    expect(executiveToCorrelationSubsystem("memory")).toBe("memory");
  });

  it("returns null for unknown name", () => {
    expect(executiveToCorrelationSubsystem("execution")).toBeNull();
  });

  it("returns null for 'demo'", () => {
    expect(executiveToCorrelationSubsystem("demo")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(executiveToCorrelationSubsystem("")).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/correlation/normalize-subsystem.vitest.ts`
Expected: All 6 tests pass

- [ ] **Step 4: Commit**

```bash
git add src/correlation/normalize-subsystem.ts tests/correlation/normalize-subsystem.vitest.ts
git commit -m "feat(p11.1): add subsystem name normalization"
```

---

### Task 3: CorrelationGraphStore

**Files:**
- Create: `src/correlation/correlation-graph-store.ts`
- Test: `tests/correlation/correlation-graph-store.vitest.ts`

**Interfaces:**
- Consumes: `CorrelationGraph`, `CorrelationGraphLoadError` (from Task 1), `CorrelationSubsystemId` (type)
- Produces: `CorrelationGraphStore` class with `save()`, `loadLatest()`, `exists()`

- [ ] **Step 1: Create `src/correlation/correlation-graph-store.ts`**

```typescript
// src/correlation/correlation-graph-store.ts

import { existsSync, mkdirSync, openSync, readFileSync, renameSync, fsyncSync, closeSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CorrelationGraph, CorrelationSubsystemId } from "./correlation-types.js";
import { CorrelationGraphLoadError } from "./correlation-types.js";

const CANONICAL_SUBSYSTEMS: CorrelationSubsystemId[] = [
  "memory", "workflow", "skills", "agents",
  "tools", "security", "governance", "adaptation",
];

export class CorrelationGraphStore {
  constructor(private readonly rootDir: string) {}

  get filePath(): string {
    return join(this.rootDir, "graph.json");
  }

  get tmpPath(): string {
    return join(this.rootDir, "graph.json.tmp");
  }

  async save(graph: CorrelationGraph): Promise<void> {
    if (!existsSync(this.rootDir)) {
      mkdirSync(this.rootDir, { recursive: true });
    }
    const data = JSON.stringify(graph, null, 2);
    const fd = openSync(this.tmpPath, "w");
    try {
      writeFileSync(fd, data, "utf-8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(this.tmpPath, this.filePath);
  }

  async loadLatest(
    opts?: { staleAfterMs?: number },
  ): Promise<CorrelationGraph | null> {
    if (!existsSync(this.filePath)) return null;

    let raw: string;
    try {
      raw = readFileSync(this.filePath, "utf-8");
    } catch {
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new CorrelationGraphLoadError(
        `Invalid JSON in graph file: ${this.filePath}`,
      );
    }

    const graph = parsed as Record<string, unknown>;

    if (graph.schemaVersion !== "p11.1.0") {
      throw new CorrelationGraphLoadError(
        `Unexpected schema version: ${String(graph.schemaVersion)}`,
      );
    }

    if (!Array.isArray(graph.nodes)) {
      throw new CorrelationGraphLoadError("CorrelationGraph.nodes must be an array");
    }

    if (!Array.isArray(graph.edges)) {
      throw new CorrelationGraphLoadError("CorrelationGraph.edges must be an array");
    }

    for (const node of graph.nodes as Array<Record<string, unknown>>) {
      if (!CANONICAL_SUBSYSTEMS.includes(node.subsystem as CorrelationSubsystemId)) {
        throw new CorrelationGraphLoadError(
          `Invalid subsystem ID in node: ${String(node.subsystem)}`,
        );
      }
    }

    for (const edge of graph.edges as Array<Record<string, unknown>>) {
      if (!CANONICAL_SUBSYSTEMS.includes(edge.source as CorrelationSubsystemId)) {
        throw new CorrelationGraphLoadError(
          `Invalid source subsystem ID in edge: ${String(edge.source)}`,
        );
      }
      if (!CANONICAL_SUBSYSTEMS.includes(edge.target as CorrelationSubsystemId)) {
        throw new CorrelationGraphLoadError(
          `Invalid target subsystem ID in edge: ${String(edge.target)}`,
        );
      }
      // Validate confidence bounds
      const cr = Number(edge.coOccurrenceRate);
      const cc = Number(edge.correlationConfidence);
      const lag = Number(edge.temporalLag);
      if (!Number.isFinite(cr) || cr < 0 || cr > 1) {
        throw new CorrelationGraphLoadError(
          `Edge ${String(edge.source)}→${String(edge.target)}: coOccurrenceRate out of range [0,1]`,
        );
      }
      if (!Number.isFinite(cc) || cc < 0 || cc > 1) {
        throw new CorrelationGraphLoadError(
          `Edge ${String(edge.source)}→${String(edge.target)}: correlationConfidence out of range [0,1]`,
        );
      }
      if (!Number.isFinite(lag) || lag < 0) {
        throw new CorrelationGraphLoadError(
          `Edge ${String(edge.source)}→${String(edge.target)}: temporalLag must be >= 0`,
        );
      }
    }

    const result = graph as CorrelationGraph;

    // stale check
    if (opts?.staleAfterMs !== undefined) {
      const generatedAt = new Date(result.generatedAt).getTime();
      const ageMs = Date.now() - generatedAt;
      if (ageMs > opts.staleAfterMs) {
        result.status = "stale";
      }
    }

    return result;
  }

  async exists(): Promise<boolean> {
    return existsSync(this.filePath);
  }
}
```

- [ ] **Step 2: Write store tests `tests/correlation/correlation-graph-store.vitest.ts`**

```typescript
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
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/correlation/correlation-graph-store.vitest.ts`
Expected: All 7 tests pass

- [ ] **Step 4: Commit**

```bash
git add src/correlation/correlation-graph-store.ts tests/correlation/correlation-graph-store.vitest.ts
git commit -m "feat(p11.1): add CorrelationGraphStore with atomic save and validation"
```

---

### Task 4: Core Correlation Algorithm (Pure Function)

**Files:**
- Create: `src/correlation/build-correlation-graph.ts`
- Test: `tests/correlation/build-correlation-graph.vitest.ts`

**Interfaces:**
- Consumes: `BaselineComparison[]`, `ExecutiveTrendSnapshot[]`, `CorrelationEngineConfig` (from Task 1)
- Produces: `buildCorrelationGraph(comparisons, snapshots, config): CorrelationGraph`

- [ ] **Step 1: Create `src/correlation/build-correlation-graph.ts`**

```typescript
// src/correlation/build-correlation-graph.ts

import type {
  CorrelationGraph,
  CorrelationEdge,
  CorrelationNode,
  CorrelationNodeStatus,
  CorrelationGraphStatus,
  CorrelationEngineConfig,
  CorrelationDirection,
  CorrelationSubsystemId,
} from "./correlation-types.js";
import type { BaselineComparison } from "../baseline/baseline-types.js";
import type { ExecutiveTrendSnapshot } from "../executive/trend-store.js";
import { executiveToCorrelationSubsystem } from "./normalize-subsystem.js";

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Extract subsystem scores from a trend snapshot, handling the stored shape. */
function extractSubsystemScores(
  snapshot: ExecutiveTrendSnapshot,
): Record<string, number> {
  return snapshot.subsystemScores as Record<string, number>;
}

function computeNodeStatus(score: number): CorrelationNodeStatus {
  if (score >= 90) return "excellent";
  if (score >= 70) return "healthy";
  if (score >= 40) return "warning";
  if (score >= 0) return "critical";
  return "unknown";
}

interface DeltaSeries {
  subsystem: CorrelationSubsystemId;
  deltas: number[];
  degradedMask: boolean[];
}

function buildDeltaSeries(
  subsystem: CorrelationSubsystemId,
  scores: number[],
  threshold: number,
): DeltaSeries {
  const deltas: number[] = [];
  const degradedMask: boolean[] = [];
  for (let i = 1; i < scores.length; i++) {
    const d = scores[i] - scores[i - 1];
    deltas.push(d);
    degradedMask.push(d <= threshold);
  }
  return { subsystem, deltas, degradedMask };
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

function computeEdge(
  source: DeltaSeries,
  target: DeltaSeries,
  maxLag: number,
  threshold: number,
  maxSamples: number,
  minEdgeConfidence: number,
  snapshotIds: string[],
): CorrelationEdge | null {
  const effectiveSamples = Math.min(source.deltas.length, target.deltas.length);

  // Find best lag 0..maxLag
  let bestLag = 0;
  let bestSimilarity = 0;
  let lag0Similarity = 0;
  let first = true;
  for (let lag = 0; lag <= maxLag; lag++) {
    if (effectiveSamples <= lag) break;
    const srcEnd = source.deltas.length - lag;
    const tgtStart = lag;
    const len = Math.min(srcEnd, target.deltas.length - tgtStart);
    if (len < 1) continue;
    const aSlice = source.deltas.slice(0, len);
    const bSlice = target.deltas.slice(tgtStart, tgtStart + len);
    const sim = Math.abs(cosineSimilarity(aSlice, bSlice));
    if (first) {
      lag0Similarity = sim;
      first = false;
    }
    if (sim > bestSimilarity) {
      bestSimilarity = sim;
      bestLag = lag;
    }
  }

  // Co-occurrence rate
  const alignedLen = Math.min(
    source.degradedMask.length,
    target.degradedMask.length - bestLag,
  );
  let sourceDegraded = 0;
  let bothDegraded = 0;
  for (let t = 0; t < alignedLen; t++) {
    if (source.degradedMask[t]) {
      sourceDegraded++;
      if (target.degradedMask[t + bestLag]) bothDegraded++;
    }
  }
  const coOccurrenceRate = sourceDegraded > 0
    ? bothDegraded / sourceDegraded
    : 0;

  // Direction
  const len = Math.min(source.deltas.length, target.deltas.length - bestLag);
  let meanProduct = 0;
  for (let t = 0; t < len; t++) {
    meanProduct += source.deltas[t] * target.deltas[t + bestLag];
  }
  meanProduct = len > 0 ? meanProduct / len : 0;
  const epsilon = 0.001;
  const correlationDirection: CorrelationDirection =
    meanProduct > epsilon ? "positive"
    : meanProduct < -epsilon ? "negative"
    : "none";

  // Confidence blend
  const similarityStrength = bestSimilarity;
  const sampleRatio = effectiveSamples / Math.max(maxSamples, 1);
  const lagStrength = Math.max(0, bestSimilarity - lag0Similarity);
  const correlationConfidence = clamp01(
    0.4 * coOccurrenceRate +
    0.3 * similarityStrength +
    0.2 * sampleRatio +
    0.1 * lagStrength,
  );

  if (correlationConfidence < minEdgeConfidence) return null;

  return {
    source: source.subsystem,
    target: target.subsystem,
    coOccurrenceRate,
    temporalLag: bestLag,
    correlationDirection,
    correlationConfidence,
    evidenceIds: snapshotIds,
  };
}

export function buildCorrelationGraph(
  comparisons: BaselineComparison[],
  snapshots: ExecutiveTrendSnapshot[],
  config: CorrelationEngineConfig,
): CorrelationGraph {
  const now = new Date().toISOString();
  // Sort snapshots oldest → newest so delta[t] - delta[t-1] is correct
  snapshots = [...snapshots].sort(
    (a, b) => new Date(a.generatedAt).getTime() - new Date(b.generatedAt).getTime(),
  );
  const subsystemSet = new Set(config.canonicalSubsystems);
  const excludedSet = new Set(config.excludedSubsystems);
  const nodes: CorrelationNode[] = [];
  const scoreMap = new Map<CorrelationSubsystemId, number>();

  for (const c of comparisons) {
    if (subsystemSet.has(c.subsystem as CorrelationSubsystemId)) {
      nodes.push({
        subsystem: c.subsystem as CorrelationSubsystemId,
        score: c.score,
        status: computeNodeStatus(c.score),
        drift: c.drift as any,
        evidenceIds: [],
      });
      scoreMap.set(c.subsystem as CorrelationSubsystemId, c.score);
    }
  }

  // Fill missing canonical subsystems
  for (const sub of config.canonicalSubsystems) {
    if (!scoreMap.has(sub)) {
      nodes.push({
        subsystem: sub,
        score: 0,
        status: "unknown",
        drift: [],
        evidenceIds: [],
      });
    }
  }

  // Insufficient history
  if (snapshots.length < config.minSamples) {
    return {
      schemaVersion: "p11.1.0",
      generatedAt: now,
      windowSize: config.windowSize,
      status: "insufficient_history",
      nodes,
      edges: [],
      meta: {
        totalSnapshotsExamined: snapshots.length,
        minConfidenceThreshold: config.minEdgeConfidence,
        maxLagExamined: config.maxTemporalLag,
        degradationThreshold: config.degradationDeltaThreshold,
        canonicalSubsystems: [...config.canonicalSubsystems],
        excludedSubsystems: [...config.excludedSubsystems],
      },
    };
  }

  // Build score series
  const subsystemSeries = new Map<CorrelationSubsystemId, number[]>();
  for (const snap of snapshots) {
    const scores = extractSubsystemScores(snap);
    for (const [execName, score] of Object.entries(scores)) {
      const corrName = executiveToCorrelationSubsystem(execName);
      if (corrName && subsystemSet.has(corrName) && !excludedSet.has(corrName)) {
        if (!subsystemSeries.has(corrName)) subsystemSeries.set(corrName, []);
        subsystemSeries.get(corrName)!.push(score);
      }
    }
  }

  // Compute delta series
  const deltaSeriesMap = new Map<CorrelationSubsystemId, DeltaSeries>();
  for (const [sub, scores] of subsystemSeries) {
    deltaSeriesMap.set(sub, buildDeltaSeries(sub, scores, config.degradationDeltaThreshold));
  }

  // Collect snapshot IDs for evidence traceability
  const snapshotIds = snapshots.map(s => s.id).filter(Boolean);

  // Compute pairwise edges
  const allSubs = [...deltaSeriesMap.keys()];
  const edges: CorrelationEdge[] = [];
  for (const a of allSubs) {
    const aSeries = deltaSeriesMap.get(a)!;
    for (const b of allSubs) {
      if (a === b) continue;
      const bSeries = deltaSeriesMap.get(b)!;
      const edge = computeEdge(aSeries, bSeries, config.maxTemporalLag, config.degradationDeltaThreshold, config.windowSize, config.minEdgeConfidence, snapshotIds);
      if (edge) edges.push(edge);
    }
  }

  // Determine status
  let status: CorrelationGraphStatus = "ok";
  if (snapshots.length < config.minSamples) {
    status = "insufficient_history";
  } else {
    const latest = snapshots[snapshots.length - 1];
    const latestGeneratedAt = new Date(latest.generatedAt).getTime();
    const windowDays = latest.windowDays || 7;
    const staleAfterMs = config.staleAfterWindows * windowDays * 24 * 60 * 60 * 1000;
    if (Date.now() - latestGeneratedAt > staleAfterMs) {
      status = "stale";
    }
  }

  return {
    schemaVersion: "p11.1.0",
    generatedAt: now,
    windowSize: config.windowSize,
    status,
    nodes,
    edges,
    meta: {
      totalSnapshotsExamined: snapshots.length,
      minConfidenceThreshold: config.minEdgeConfidence,
      maxLagExamined: config.maxTemporalLag,
      degradationThreshold: config.degradationDeltaThreshold,
      canonicalSubsystems: [...config.canonicalSubsystems],
      excludedSubsystems: [...config.excludedSubsystems],
    },
  };
}
```

- [ ] **Step 2: Write core function tests**

```typescript
// tests/correlation/build-correlation-graph.vitest.ts

import { describe, it, expect } from "vitest";
import { buildCorrelationGraph } from "../../src/correlation/build-correlation-graph.js";
import { DEFAULT_CORRELATION_CONFIG } from "../../src/correlation/correlation-config.js";
import type { BaselineComparison } from "../../src/baseline/baseline-types.js";
import type { ExecutiveTrendSnapshot } from "../../src/executive/trend-store.js";

function makeComparison(subsystem: string, score: number): BaselineComparison {
  const status = score >= 90 ? "excellent" : score >= 70 ? "healthy" : score >= 40 ? "warning" : "critical";
  return { subsystem: subsystem as any, score, status: status as any, drift: [] };
}

function makeSnapshot(id: string, scores: Record<string, number>): ExecutiveTrendSnapshot {
  return { id, generatedAt: new Date().toISOString(), windowDays: 7, subsystemScores: scores };
}

function stableScores(base: number, count: number): ExecutiveTrendSnapshot[] {
  return Array.from({ length: count }, (_, i) =>
    makeSnapshot(`snap-${i}`, {
      memory: base, workflow: base, skills: base,
      agents: base, tools: base, security: base,
      governance: base, adaptation: base,
    }));
}

function makeConfig(overrides: Partial<typeof DEFAULT_CORRELATION_CONFIG> = {}) {
  return { ...DEFAULT_CORRELATION_CONFIG, ...overrides };
}

describe("buildCorrelationGraph", () => {
  it("returns ok status with edges when subsystems correlate", () => {
    const comparisons = [
      makeComparison("memory", 80), makeComparison("workflow", 75),
      makeComparison("skills", 85), makeComparison("agents", 70),
      makeComparison("tools", 80), makeComparison("security", 85),
      makeComparison("governance", 80), makeComparison("adaptation", 75),
    ];
    const snapshots = Array.from({ length: 8 }, (_, t) => {
      const base = 80 - (t % 3 === 0 ? 10 : 0);
      return makeSnapshot(`snap-${t}`, {
        memory: base, workflow: base - 3, skills: 85, agents: 70,
        tools: 80, security: 85, governance: 80, adaptation: 75,
      });
    });
    const graph = buildCorrelationGraph(comparisons, snapshots, makeConfig());
    expect(graph.status).toBe("ok");
    expect(graph.nodes).toHaveLength(8);
    expect(graph.edges.length).toBeGreaterThan(0);
    for (const edge of graph.edges) {
      expect(edge.correlationConfidence).toBeGreaterThanOrEqual(0);
      expect(edge.correlationConfidence).toBeLessThanOrEqual(1);
    }
  });

  it("returns insufficient_history when < minSamples snapshots", () => {
    const comparisons = [makeComparison("memory", 80)];
    const snapshots = [makeSnapshot("snap-1", { memory: 85, workflow: 80, skills: 85, agents: 70, tools: 80, security: 85, governance: 80, adaptation: 75 })];
    const graph = buildCorrelationGraph(comparisons, snapshots, makeConfig({ minSamples: 6 }));
    expect(graph.status).toBe("insufficient_history");
    expect(graph.edges).toHaveLength(0);
  });

  it("excludes demo from nodes", () => {
    const comparisons = [makeComparison("demo", 50), makeComparison("memory", 80)];
    const snapshots = stableScores(80, 8);
    const graph = buildCorrelationGraph(comparisons, snapshots, makeConfig());
    expect(graph.nodes.every(n => n.subsystem !== ("demo" as any))).toBe(true);
    expect(graph.nodes.find(n => n.subsystem === "memory")).toBeDefined();
  });

  it("fills missing canonical subsystems as unknown", () => {
    const comparisons: BaselineComparison[] = [];
    const snapshots = stableScores(80, 8);
    const graph = buildCorrelationGraph(comparisons, snapshots, makeConfig());
    expect(graph.nodes).toHaveLength(8);
    for (const node of graph.nodes) {
      expect(node.status).toBe("unknown");
    }
  });

  it("no edges when all scores are stable", () => {
    const comparisons = [makeComparison("memory", 90), makeComparison("workflow", 90)];
    const snapshots = stableScores(90, 12);
    const graph = buildCorrelationGraph(comparisons, snapshots, makeConfig());
    expect(graph.edges).toHaveLength(0);
  });

  it("detects negative correlation", () => {
    const comparisons = [makeComparison("memory", 80), makeComparison("workflow", 70)];
    const snapshots = Array.from({ length: 8 }, (_, i) =>
      makeSnapshot(`snap-${i}`, {
        memory: 70 + i * 2, workflow: 80 - i * 2,
        skills: 85, agents: 70, tools: 80, security: 85, governance: 80, adaptation: 75,
      }));
    const graph = buildCorrelationGraph(comparisons, snapshots, makeConfig({ maxTemporalLag: 0 }));
    const negativeEdges = graph.edges.filter(e => e.correlationDirection === "negative");
    expect(negativeEdges.length).toBeGreaterThan(0);
  });

  it("confidence clamped 0-1", () => {
    const comparisons = [makeComparison("memory", 80)];
    const snapshots = stableScores(80, 8);
    const graph = buildCorrelationGraph(comparisons, snapshots, makeConfig({ minSamples: 1, minEdgeConfidence: 0 }));
    for (const edge of graph.edges) {
      expect(edge.correlationConfidence).toBeGreaterThanOrEqual(0);
      expect(edge.correlationConfidence).toBeLessThanOrEqual(1);
    }
  });

  it("lag search is bounds-safe", () => {
    const comparisons = [makeComparison("memory", 80), makeComparison("workflow", 70)];
    const snapshots = Array.from({ length: 8 }, (_, i) =>
      makeSnapshot(`snap-${i}`, {
        memory: 80 - i, workflow: 70 - i,
        skills: 85, agents: 70, tools: 80, security: 85, governance: 80, adaptation: 75,
      }));
    const graph = buildCorrelationGraph(comparisons, snapshots, makeConfig({ maxTemporalLag: 3 }));
    expect(graph.status).toBe("ok");
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/correlation/build-correlation-graph.vitest.ts`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/correlation/build-correlation-graph.ts tests/correlation/build-correlation-graph.vitest.ts
git commit -m "feat(p11.1): add pure buildCorrelationGraph function"
```

---

### Task 5: Orchestrator (CorrelationEngine)

**Files:**
- Create: `src/correlation/correlation-engine.ts`
- Test: `tests/correlation/correlation-engine.vitest.ts`

**Interfaces:**
- Consumes: `BaselineRegistry`, `ExecutiveTrendStore`, `CorrelationEngineConfig`
- Produces: `CorrelationEngine` class with `run()` method

- [ ] **Step 1: Create `src/correlation/correlation-engine.ts`**

```typescript
// src/correlation/correlation-engine.ts

import type { BaselineRegistry } from "../baseline/baseline-registry.js";
import type { ExecutiveTrendStore, ExecutiveTrendSnapshot } from "../executive/trend-store.js";
import type { CorrelationGraph, CorrelationEngineConfig } from "./correlation-types.js";
import { DEFAULT_CORRELATION_CONFIG } from "./correlation-config.js";
import { buildCorrelationGraph } from "./build-correlation-graph.js";

export class CorrelationEngine {
  constructor(
    private readonly registry: BaselineRegistry,
    private readonly trendStore: ExecutiveTrendStore,
    private readonly config: CorrelationEngineConfig = DEFAULT_CORRELATION_CONFIG,
  ) {}

  async run(): Promise<CorrelationGraph> {
    const comparisons = await this.registry.runAll();
    const snapshots = await this.loadTrendHistory();
    return buildCorrelationGraph(comparisons, snapshots, this.config);
  }

  private async loadTrendHistory(): Promise<ExecutiveTrendSnapshot[]> {
    const snapshots: ExecutiveTrendSnapshot[] = [];
    let current = await this.trendStore.loadLatest();
    if (!current) return snapshots;
    snapshots.push(current);

    for (let i = 0; i < this.config.windowSize - 1; i++) {
      const prev = await this.trendStore.findBaseline(current!.generatedAt);
      if (!prev) break;
      snapshots.unshift(prev);
      current = prev;
    }
    return snapshots;
  }
}
```

- [ ] **Step 2: Write engine integration tests `tests/correlation/correlation-engine.vitest.ts`**

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { rmSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { CorrelationEngine } from "../../src/correlation/correlation-engine.js";
import { DEFAULT_CORRELATION_CONFIG } from "../../src/correlation/correlation-config.js";
import type { BaselineRegistry } from "../../src/baseline/baseline-registry.js";
import type { ExecutiveTrendStore } from "../../src/executive/trend-store.js";

function createMockRegistry(): BaselineRegistry {
  return {
    runAll: vi.fn().mockResolvedValue([]),
    runOne: vi.fn(),
    register: vi.fn(),
    get: vi.fn(),
    list: vi.fn().mockReturnValue([]),
  } as unknown as BaselineRegistry;
}

describe("CorrelationEngine", () => {
  let dir: string;
  let trendDir: string;
  let registry: BaselineRegistry;
  let trendStore: ExecutiveTrendStore;

  beforeEach(async () => {
    dir = join(tmpdir(), `corr-engine-test-${randomUUID()}`);
    trendDir = join(dir, ".alix", "executive");
    mkdirSync(trendDir, { recursive: true });
    registry = createMockRegistry();
    const { ExecutiveTrendStore: Store } = await import("../../src/executive/trend-store.js");
    trendStore = new Store(trendDir);
  });

  afterEach(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("run() returns valid CorrelationGraph with no trend data", async () => {
    const engine = new CorrelationEngine(registry, trendStore, {
      ...DEFAULT_CORRELATION_CONFIG,
      minSamples: 6,
    });
    const graph = await engine.run();
    expect(graph.schemaVersion).toBe("p11.1.0");
    expect(typeof graph.generatedAt).toBe("string");
    expect(graph.nodes.length).toBeGreaterThanOrEqual(0);
  });

  it("run() with trend data produces correlation graph", async () => {
    const subsystemNames = ["memory", "workflow", "learning", "agents", "tools", "security", "governance", "adaptation"];
    for (let i = 0; i < 8; i++) {
      await trendStore.save({
        schemaVersion: "p10.0.0",
        generatedAt: new Date(Date.now() - i * 86400000).toISOString(),
        windowDays: 7,
        overallScore: 80,
        rankedSubsystems: subsystemNames.map(name => ({
          subsystem: name as any,
          score: 80 - i * 2,
          summary: "trend",
          status: "healthy" as const,
          topIssues: [],
        })),
      });
    }
    const engine = new CorrelationEngine(registry, trendStore, {
      ...DEFAULT_CORRELATION_CONFIG,
      minSamples: 1,
    });
    const graph = await engine.run();
    expect(graph.schemaVersion).toBe("p11.1.0");
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/correlation/correlation-engine.vitest.ts`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/correlation/correlation-engine.ts tests/correlation/correlation-engine.vitest.ts
git commit -m "feat(p11.1): add CorrelationEngine orchestrator"
```

---

### Task 6: CLI Command

**Files:**
- Create: `src/cli/commands/executive-correlate-handler.ts`
- Modify: `src/cli/commands/executive.ts` (add `case "correlate"`)

- [ ] **Step 1: Create CLI handler**

```typescript
// src/cli/commands/executive-correlate-handler.ts

import { join } from "node:path";
import { createDefaultBaselineRegistry } from "../../baseline/baseline-registry.js";
import { ExecutiveTrendStore } from "../../executive/trend-store.js";
import { CorrelationEngine } from "../../correlation/correlation-engine.js";
import { CorrelationGraphStore } from "../../correlation/correlation-graph-store.js";
import { DEFAULT_CORRELATION_CONFIG } from "../../correlation/correlation-config.js";
import type { CorrelationGraph } from "../../correlation/correlation-types.js";

export async function handleCorrelateCommand(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const executiveDir = join(cwd, ".alix", "executive");
  const correlationDir = join(cwd, ".alix", "correlation");
  const isJson = args.includes("--json");
  const isStatus = args.includes("--status");
  const store = new CorrelationGraphStore(correlationDir);

  if (isStatus) {
    const graph = await store.loadLatest();
    if (!graph) { console.log("No saved correlation graph found."); return; }
    printSummary(graph, isJson);
    return;
  }

  const registry = createDefaultBaselineRegistry();
  const trendStore = new ExecutiveTrendStore(executiveDir);
  const engine = new CorrelationEngine(registry, trendStore, DEFAULT_CORRELATION_CONFIG);
  const graph = await engine.run();
  await store.save(graph);
  printSummary(graph, isJson);
}

function printSummary(graph: CorrelationGraph, isJson: boolean): void {
  if (isJson) {
    console.log(JSON.stringify(graph, null, 2));
    return;
  }
  console.log(`Correlation Graph`);
  console.log(`Status: ${graph.status}`);
  console.log(`Generated: ${graph.generatedAt}`);
  console.log(`Nodes: ${graph.nodes.length}`);
  console.log(`Edges: ${graph.edges.length}`);
  console.log(`Window size: ${graph.windowSize}`);
  console.log(`Snapshots examined: ${graph.meta.totalSnapshotsExamined}`);
  if (graph.edges.length > 0) {
    console.log();
    const top = [...graph.edges]
      .sort((a, b) => b.correlationConfidence - a.correlationConfidence)
      .slice(0, 5);
    console.log("Top correlations:");
    top.forEach((e, i) => {
      console.log(`  ${i + 1}. ${e.source} → ${e.target}\tconfidence ${e.correlationConfidence.toFixed(2)}\tlag ${e.temporalLag}\t${e.correlationDirection}`);
    });
  }
}
```

- [ ] **Step 2: Add `case "correlate"` to executive.ts switch**

Read `src/cli/commands/executive.ts`, find the `switch (subcommand)` block, and add before `default:`:

```typescript
    case "correlate": {
      const { handleCorrelateCommand } = await import(
        "./executive-correlate-handler.js"
      );
      return handleCorrelateCommand(rest);
    }
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/executive-correlate-handler.ts src/cli/commands/executive.ts
git commit -m "feat(p11.1): add 'alix executive correlate' CLI command"
```

---

### Task 7: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All existing tests plus ~25 new P11.1 tests pass

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: Clean compile

- [ ] **Step 3: Quick smoke test**

Run: `node dist/cli.js executive correlate`
Expected: CLI runs without error (even if insufficient trend data)

- [ ] **Step 4: Commit any final fixes**

```bash
git add -A
git commit -m "chore(p11.1): final integration fixes"
```
