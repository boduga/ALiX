# P9.6 — InvestigationRecommendation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `InvestigationRecommendation` as a parallel artifact to `GovernanceRecommendation`, with its own append-only store, generator, compatibility adapter, and CLI subcommands.

**Architecture:** 3 new source files (types, store, generator), 1 new compatibility adapter, 1 CLI modification. All additive — no existing type schema changes, no GovernanceStore mutation, no GovernanceChangeApplier path. New investigations written to `.alix/governance/investigations.jsonl`. Legacy records in `recommendations.jsonl` read-only via adapter.

**Tech Stack:** TypeScript, Node.js fs (appendFileSync/readFileSync/existsSync/mkdirSync), Vitest.

## Global Constraints

- No existing type schema changes (`governance-types.ts` unchanged).
- No GovernanceStore mutation (never write to recommendations.jsonl).
- No GovernanceChangeApplier path — P9.6 has no mutation/apply path.
- `InvestigationStore` is append-only JSONL (same pattern as `GovernanceStore`). `updateStatus` appends a new version — never rewrites in place. `list()`/`get()` resolve the latest version per `id`.
- Priority from P10.1 is a computed overlay at render time — never persisted in investigations.jsonl.
- Compatibility adapter uses deterministic `legacy-investigation-${recommendation.id}` IDs — no collision with native UUIDs.
- Legacy dedupe: `listCompatibleInvestigations` skips a legacy record if a native `InvestigationRecommendation` already exists with the same `sourceArtifactId` and `kind`.
- All existing tests must pass. No 3rd-party dependencies.

---

### Task 1: investigation-types.ts

**Files:**
- Create: `src/governance/investigation-types.ts`
- Test: `tests/governance/investigation-store.vitest.ts` (created in Task 2)

**Interfaces:**
- Produces: `InvestigationKind`, `InvestigationStatus`, `InvestigationSource`, `InvestigationRecommendation`, `InvestigationFilter`

- [ ] **Step 1: Write the type definitions**

Create `src/governance/investigation-types.ts`:

```typescript
/**
 * P9.6 — InvestigationRecommendation type definitions.
 *
 * Parallel artifact to GovernanceRecommendation/Recommendation (P9.1).
 * An InvestigationRecommendation describes an operator investigation workflow
 * — NOT a mutation-capable advisory. It cannot be applied via
 * GovernanceChangeApplier.
 *
 * @module
 */

export type InvestigationKind =
  | "chain_restoration"
  | "governance_integrity";

export type InvestigationStatus =
  | "open"
  | "in_progress"
  | "resolved"
  | "dismissed";

export type InvestigationSource =
  | "drift"
  | "integrity"
  | "health";

export interface InvestigationRecommendation {
  id: string;
  kind: InvestigationKind;
  status: InvestigationStatus;
  severity: "low" | "medium" | "high" | "critical";

  source: InvestigationSource;
  sourceArtifactId: string;
  evidenceRefs: string[];

  title: string;
  description: string;
  operatorGuidance: string;

  createdAt: string;
  updatedAt?: string;
  assignedTo?: string;
  resolvedAt?: string;
  resolution?: string;

  /** Set only for records read from GovernanceStore via compatibility adapter. */
  legacySource?: {
    store: "governance";
    recommendationId: string;
    parentReportId: string;
  };
}

export interface InvestigationFilter {
  kind?: InvestigationKind;
  status?: InvestigationStatus;
  severity?: "low" | "medium" | "high" | "critical";
}
```

- [ ] **Step 2: Run tsc to verify types compile**

Run: `npx tsc --noEmit`
Expected: clean compile (no errors)

- [ ] **Step 3: Commit**

```bash
git add src/governance/investigation-types.ts
git commit -m "feat(p9.6): add InvestigationRecommendation type definitions"
```

---

### Task 2: investigation-store.ts

**Files:**
- Create: `src/governance/investigation-store.ts`
- Create: `tests/governance/investigation-store.vitest.ts`

**Interfaces:**
- Consumes: `InvestigationRecommendation`, `InvestigationFilter`, `InvestigationStatus` from `investigation-types.js`
- Produces: `InvestigationStore` class with `save`, `get`, `list`, `updateStatus`

- [ ] **Step 1: Write the failing tests**

Create `tests/governance/investigation-store.vitest.ts`:

```typescript
/**
 * P9.6 — InvestigationStore tests.
 *
 * @module
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { InvestigationStore } from "../../src/governance/investigation-store.js";
import type { InvestigationRecommendation } from "../../src/governance/investigation-types.js";

function makeInvestigation(overrides: Partial<InvestigationRecommendation> = {}): InvestigationRecommendation {
  const base: InvestigationRecommendation = {
    id: overrides.id ?? "test-inv-001",
    kind: "chain_restoration",
    status: "open",
    severity: "high",
    source: "drift",
    sourceArtifactId: "drift-report-001",
    evidenceRefs: ["ev-001"],
    title: "Chain coverage drop detected",
    description: "Evidence chain usage dropped below threshold",
    operatorGuidance: "Investigate why proposals bypass provenance",
    createdAt: new Date().toISOString(),
  };
  return { ...base, ...overrides };
}

let storeDir: string;
let store: InvestigationStore;

beforeEach(() => {
  storeDir = mkdtempSync(join(tmpdir(), "investigation-store-"));
  store = new InvestigationStore(storeDir);
});

afterEach(() => {
  rmSync(storeDir, { recursive: true, force: true });
});

describe("InvestigationStore", () => {
  it("save writes a JSONL entry", async () => {
    const inv = makeInvestigation({ id: "inv-001" });
    await store.save(inv);
    const filePath = join(storeDir, "investigations.jsonl");
    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, "utf-8").trim();
    const parsed = JSON.parse(content);
    expect(parsed.id).toBe("inv-001");
  });

  it("get returns null for missing id", async () => {
    const result = await store.get("nonexistent");
    expect(result).toBeNull();
  });

  it("get returns saved investigation", async () => {
    const inv = makeInvestigation({ id: "inv-002" });
    await store.save(inv);
    const result = await store.get("inv-002");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("inv-002");
    expect(result!.kind).toBe("chain_restoration");
  });

  it("list returns all saved investigations", async () => {
    await store.save(makeInvestigation({ id: "inv-a" }));
    await store.save(makeInvestigation({ id: "inv-b" }));
    const results = await store.list();
    expect(results.length).toBe(2);
  });

  it("list filters by kind", async () => {
    await store.save(makeInvestigation({ id: "inv-c", kind: "chain_restoration" }));
    await store.save(makeInvestigation({ id: "inv-d", kind: "governance_integrity" }));
    const filtered = await store.list({ kind: "chain_restoration" });
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe("inv-c");
  });

  it("list filters by status", async () => {
    await store.save(makeInvestigation({ id: "inv-e", status: "open" }));
    await store.save(makeInvestigation({ id: "inv-f", status: "resolved" }));
    const filtered = await store.list({ status: "open" });
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe("inv-e");
  });

  it("list returns empty array when file missing", async () => {
    rmSync(storeDir, { recursive: true, force: true });
    // Note: mkdtempSync created storeDir; after rmSync, ensureDir recreates it on save
    const empty = await new InvestigationStore(storeDir).list();
    expect(empty).toEqual([]);
  });

  it("updateStatus appends a new version (does not rewrite in place)", async () => {
    await store.save(makeInvestigation({ id: "inv-g", status: "open" }));
    await store.updateStatus("inv-g", "in_progress");
    const result = await store.get("inv-g");
    expect(result).not.toBeNull();
    expect(result!.status).toBe("in_progress");
    expect(result!.updatedAt).toBeDefined();

    // Verify the file has 2 entries (append-only)
    const filePath = join(storeDir, "investigations.jsonl");
    const lines = readFileSync(filePath, "utf-8").trim().split("\n").filter(Boolean);
    expect(lines.length).toBe(2);
  });

  it("updateStatus with resolved sets resolvedAt and resolution", async () => {
    await store.save(makeInvestigation({ id: "inv-h", status: "open" }));
    await store.updateStatus("inv-h", "resolved", { resolution: "Fixed in PR #200" });
    const result = await store.get("inv-h");
    expect(result).not.toBeNull();
    expect(result!.status).toBe("resolved");
    expect(result!.resolvedAt).toBeDefined();
    expect(result!.resolution).toBe("Fixed in PR #200");
  });

  it("updateStatus on missing id resolves to null silently", async () => {
    // Should not throw — missing id means nothing to update
    await expect(store.updateStatus("nonexistent", "resolved")).resolves.not.toThrow();
  });

  it("list resolves latest version per id", async () => {
    await store.save(makeInvestigation({ id: "inv-i", status: "open", title: "v1" }));
    await store.updateStatus("inv-i", "in_progress");
    await store.updateStatus("inv-i", "resolved", { resolution: "Done" });
    // list should return 1 entry for inv-i (the latest version)
    const all = await store.list();
    const inv = all.find((i) => i.id === "inv-i");
    expect(inv).toBeDefined();
    expect(inv!.status).toBe("resolved");
    expect(inv!.resolution).toBe("Done");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/governance/investigation-store.vitest.ts`
Expected: FAIL — "Cannot find module" or similar (store not yet implemented)

- [ ] **Step 3: Write the InvestigationStore implementation**

Create `src/governance/investigation-store.ts`:

```typescript
/**
 * P9.6 — InvestigationStore: append-only JSONL store for InvestigationRecommendation records.
 *
 * One JSONL file `.alix/governance/investigations.jsonl`. save() appends a new record.
 * updateStatus() appends a new version — never rewrites in place. get()/list() resolve
 * the latest version per id (last-wins within ascending line order).
 *
 * @module
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  InvestigationRecommendation,
  InvestigationFilter,
  InvestigationStatus,
} from "./investigation-types.js";

const FILE_NAME = "investigations.jsonl";

export class InvestigationStore {
  constructor(
    private readonly storeDir: string = join(process.cwd(), ".alix", "governance"),
  ) {}

  private ensureDir(): void {
    if (!existsSync(this.storeDir)) {
      mkdirSync(this.storeDir, { recursive: true });
    }
  }

  private filePath(): string {
    return join(this.storeDir, FILE_NAME);
  }

  /** Read all lines, parse JSON, return array. Skips corrupt lines silently. */
  private readAll(): InvestigationRecommendation[] {
    const path = this.filePath();
    if (!existsSync(path)) return [];
    const raw = readFileSync(path, "utf-8");
    const results: InvestigationRecommendation[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        results.push(JSON.parse(trimmed));
      } catch {
        // skip corrupt lines
      }
    }
    return results;
  }

  /**
   * Resolve the latest version per id (last-wins in array order).
   */
  private resolveLatest(records: InvestigationRecommendation[]): Map<string, InvestigationRecommendation> {
    const map = new Map<string, InvestigationRecommendation>();
    for (const r of records) {
      map.set(r.id, r);
    }
    return map;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Append a new investigation record to the JSONL file.
   */
  async save(investigation: InvestigationRecommendation): Promise<void> {
    this.ensureDir();
    const line = JSON.stringify(investigation) + "\n";
    appendFileSync(this.filePath(), line, "utf-8");
  }

  /**
   * Get the latest version of an investigation by id.
   * Returns null if no record with that id exists.
   */
  async get(id: string): Promise<InvestigationRecommendation | null> {
    const all = this.readAll();
    const latest = this.resolveLatest(all);
    return latest.get(id) ?? null;
  }

  /**
   * List investigations, optionally filtered by kind/status/severity.
   * Returns the latest version per id, sorted by createdAt descending.
   */
  async list(filter?: InvestigationFilter): Promise<InvestigationRecommendation[]> {
    const all = this.readAll();
    const latest = this.resolveLatest(all);
    let results = Array.from(latest.values());

    if (filter?.kind) {
      results = results.filter((r) => r.kind === filter.kind);
    }
    if (filter?.status) {
      results = results.filter((r) => r.status === filter.status);
    }
    if (filter?.severity) {
      results = results.filter((r) => r.severity === filter.severity);
    }

    results.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    return results;
  }

  /**
   * Update the status of an investigation by appending a new version.
   * Does not rewrite the file. If no record with that id exists, the
   * call is a silent no-op.
   *
   * @param id - Investigation ID
   * @param status - New status
   * @param opts - Optional: resolution text (required when status is "resolved")
   */
  async updateStatus(
    id: string,
    status: InvestigationStatus,
    opts?: { resolution?: string; assignedTo?: string },
  ): Promise<void> {
    const existing = await this.get(id);
    if (!existing) return; // silent no-op

    const now = new Date().toISOString();
    const updated: InvestigationRecommendation = {
      ...existing,
      status,
      updatedAt: now,
      ...(opts?.assignedTo ? { assignedTo: opts.assignedTo } : {}),
      ...(status === "resolved"
        ? { resolvedAt: now, resolution: opts?.resolution ?? "Operator resolved" }
        : {}),
    };

    await this.save(updated);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/governance/investigation-store.vitest.ts`
Expected: PASS (all 11 tests)

- [ ] **Step 5: Commit**

```bash
git add src/governance/investigation-store.ts tests/governance/investigation-store.vitest.ts
git commit -m "feat(p9.6): add InvestigationStore (append-only JSONL, latest-version resolution)"
```

---

### Task 3: investigation-compat.ts — Compatibility adapter

**Files:**
- Create: `src/governance/investigation-compat.ts`
- Create: `tests/governance/investigation-compat.vitest.ts`

**Interfaces:**
- Consumes: `InvestigationStore`, `GovernanceStore`, `InvestigationRecommendation`, `InvestigationKind`, `InvestigationFilter` from `investigation-types.js`
- Produces: `listCompatibleInvestigations()` (async function)

- [ ] **Step 1: Write the failing tests**

Create `tests/governance/investigation-compat.vitest.ts`:

```typescript
/**
 * P9.6 — Investigation compatibility adapter tests.
 *
 * @module
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { InvestigationStore } from "../../src/governance/investigation-store.js";
import { GovernanceStore } from "../../src/governance/governance-store.js";
import { listCompatibleInvestigations } from "../../src/governance/investigation-compat.js";
import type { InvestigationRecommendation } from "../../src/governance/investigation-types.js";
import type { Recommendation } from "../../src/governance/governance-types.js";

function makeNativeInv(id: string, overrides: Partial<InvestigationRecommendation> = {}): InvestigationRecommendation {
  return {
    id,
    kind: "chain_restoration",
    status: "open",
    severity: "high",
    source: "drift",
    sourceArtifactId: "drift-001",
    evidenceRefs: [],
    title: "Native test inv",
    description: "Test",
    operatorGuidance: "Investigate",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeLegacyRec(id: string, overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    id,
    source: "drift",
    sourceArtifactId: "legacy-drift-001",
    priority: "high",
    confidence: 0.7,
    status: "open",
    category: "chain_restoration",
    title: "Legacy test rec",
    description: "Legacy desc",
    evidenceRefs: [],
    operatorGuidance: "Investigate legacy",
    expectedBenefit: "Fix coverage",
    risks: ["None"],
    metadata: { category: "chain_restoration", targetArtifactId: "art-001", currentRate: 50, targetRate: 80 },
    ...overrides,
  };
}

let storeDir: string;
let invStore: InvestigationStore;
let govStore: GovernanceStore;

beforeEach(() => {
  storeDir = mkdtempSync(join(tmpdir(), "investigation-compat-"));
  invStore = new InvestigationStore(join(storeDir, ".alix", "governance"));
  govStore = new GovernanceStore(join(storeDir, ".alix", "governance"));
});

afterEach(() => {
  rmSync(storeDir, { recursive: true, force: true });
});

describe("listCompatibleInvestigations", () => {
  it("returns empty array when no native or legacy records exist", async () => {
    const results = await listCompatibleInvestigations(govStore, invStore);
    expect(results).toEqual([]);
  });

  it("returns native investigations when no legacy records exist", async () => {
    await invStore.save(makeNativeInv("inv-001"));
    const results = await listCompatibleInvestigations(govStore, invStore);
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("inv-001");
    expect(results[0].legacySource).toBeUndefined();
  });

  it("wraps legacy chain_restoration recommendations with correct kind and metadata", async () => {
    await govStore.append("recommendations", {
      id: "rec-report-001",
      subject: "Test",
      outcome: "computed",
      confidence: 1,
      reasons: [],
      generatedAt: new Date().toISOString(),
      reportType: "governance_recommendation",
      recommendations: [
        makeLegacyRec("legacy-rec-001", {
          category: "chain_restoration",
          metadata: { category: "chain_restoration", targetArtifactId: "art-001", currentRate: 50, targetRate: 80 },
        }),
      ],
    });
    const results = await listCompatibleInvestigations(govStore, invStore);
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("legacy-investigation-legacy-rec-001");
    expect(results[0].kind).toBe("chain_restoration");
    expect(results[0].legacySource).toBeDefined();
    expect(results[0].legacySource!.store).toBe("governance");
    expect(results[0].legacySource!.recommendationId).toBe("legacy-rec-001");
  });

  it("wraps legacy governance_integrity recommendations correctly", async () => {
    await govStore.append("recommendations", {
      id: "rec-report-002",
      subject: "Test",
      outcome: "computed",
      confidence: 1,
      reasons: [],
      generatedAt: new Date().toISOString(),
      reportType: "governance_recommendation",
      recommendations: [
        makeLegacyRec("legacy-rec-002", {
          category: "governance_integrity",
          metadata: { category: "governance_integrity", issue: "Pipeline issue", recommendationId: "legacy-rec-002" },
        }),
      ],
    });
    const results = await listCompatibleInvestigations(govStore, invStore);
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("legacy-investigation-legacy-rec-002");
    expect(results[0].kind).toBe("governance_integrity");
  });

  it("dedupes legacy records when a native investigation exists with same sourceArtifactId and kind", async () => {
    // Native investigation from drift-001
    await invStore.save(makeNativeInv("inv-native-001", {
      sourceArtifactId: "drift-report-abc",
      kind: "chain_restoration",
    }));
    // Legacy record from same source artifact
    await govStore.append("recommendations", {
      id: "rec-report-003",
      subject: "Test",
      outcome: "computed",
      confidence: 1,
      reasons: [],
      generatedAt: new Date().toISOString(),
      reportType: "governance_recommendation",
      recommendations: [
        makeLegacyRec("legacy-rec-003", {
          sourceArtifactId: "drift-report-abc",
          category: "chain_restoration",
          metadata: { category: "chain_restoration", targetArtifactId: "art-001", currentRate: 50, targetRate: 80 },
        }),
      ],
    });
    const results = await listCompatibleInvestigations(govStore, invStore);
    // Legacy record with same sourceArtifactId + kind should be excluded
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("inv-native-001");
  });

  it("does not dedupe when kinds differ despite same sourceArtifactId", async () => {
    await invStore.save(makeNativeInv("inv-native-002", {
      sourceArtifactId: "drift-report-xyz",
      kind: "chain_restoration",
    }));
    await govStore.append("recommendations", {
      id: "rec-report-004",
      subject: "Test",
      outcome: "computed",
      confidence: 1,
      reasons: [],
      generatedAt: new Date().toISOString(),
      reportType: "governance_recommendation",
      recommendations: [
        makeLegacyRec("legacy-rec-004", {
          sourceArtifactId: "drift-report-xyz",
          category: "governance_integrity",
          metadata: { category: "governance_integrity", issue: "Issue", recommendationId: "legacy-rec-004" },
        }),
      ],
    });
    const results = await listCompatibleInvestigations(govStore, invStore);
    // Different kind — both should appear
    expect(results.length).toBe(2);
  });

  it("merges native and legacy records sorted by createdAt desc", async () => {
    const early = new Date("2026-01-01").toISOString();
    const late = new Date("2026-06-01").toISOString();
    await invStore.save(makeNativeInv("inv-native-003", { createdAt: early }));
    await govStore.append("recommendations", {
      id: "rec-report-005",
      subject: "Test",
      outcome: "computed",
      confidence: 1,
      reasons: [],
      generatedAt: late,
      reportType: "governance_recommendation",
      recommendations: [
        makeLegacyRec("legacy-rec-005", {
          sourceArtifactId: "drift-report-pqr",
          category: "chain_restoration",
          metadata: { category: "chain_restoration", targetArtifactId: "art-001", currentRate: 50, targetRate: 80 },
        }),
      ],
    });
    const results = await listCompatibleInvestigations(govStore, invStore);
    expect(results.length).toBe(2);
    // Latest first
    expect(results[0].id).toBe("legacy-investigation-legacy-rec-005");
    expect(results[1].id).toBe("inv-native-003");
  });

  it("skips legacy recommendations with non-investigation categories", async () => {
    await govStore.append("recommendations", {
      id: "rec-report-006",
      subject: "Test",
      outcome: "computed",
      confidence: 1,
      reasons: [],
      generatedAt: new Date().toISOString(),
      reportType: "governance_recommendation",
      recommendations: [
        makeLegacyRec("legacy-rec-006", {
          category: "lens_adjustment",
          metadata: { category: "lens_adjustment", operation: "demote", lens: "test-lens", currentPV: 0.5, reviewsAnalyzed: 10 },
        }),
        makeLegacyRec("legacy-rec-007", {
          category: "confidence_calibration",
          metadata: { category: "confidence_calibration", target: "test", currentCalibration: 0.6, suggestedCalibration: 0.8 },
        }),
      ],
    });
    const results = await listCompatibleInvestigations(govStore, invStore);
    expect(results.length).toBe(0);
  });

  it("handles corrupt governance store lines gracefully", async () => {
    // Direct file write to seed corrupt data
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const govDir = join(storeDir, ".alix", "governance");
    mkdirSync(govDir, { recursive: true });
    writeFileSync(join(govDir, "recommendations.jsonl"), "not-json\n", "utf-8");
    const results = await listCompatibleInvestigations(govStore, invStore);
    expect(results).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/governance/investigation-compat.vitest.ts`
Expected: FAIL — "Cannot find module" or similar (adapter not yet implemented)

- [ ] **Step 3: Write the compatibility adapter**

Create `src/governance/investigation-compat.ts`:

```typescript
/**
 * P9.6 — Investigation compatibility adapter.
 *
 * Provides a unified investigation queue by merging:
 *   1. Native InvestigationRecommendation records from InvestigationStore
 *   2. Legacy GovernanceRecommendation records with investigation categories
 *      (chain_restoration, governance_integrity) from GovernanceStore
 *
 * Read-only — never mutates GovernanceStore or writes to investigations.jsonl.
 *
 * @module
 */

import { InvestigationStore } from "./investigation-store.js";
import { GovernanceStore } from "./governance-store.js";
import type {
  InvestigationRecommendation,
  InvestigationKind,
  InvestigationFilter,
} from "./investigation-types.js";
import type { Recommendation } from "./governance-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INVESTIGATION_CATEGORIES = new Set(["chain_restoration", "governance_integrity"]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapCategoryToKind(category: string): InvestigationKind | null {
  if (category === "chain_restoration") return "chain_restoration";
  if (category === "governance_integrity") return "governance_integrity";
  return null;
}

function mapLegacySeverity(rec: Recommendation): "low" | "medium" | "high" | "critical" {
  // Carry forward the recommendation priority as severity
  if (rec.priority === "critical" || rec.priority === "high") return rec.priority;
  if (rec.priority === "medium") return "medium";
  return "low";
}

function legacyToInvestigation(
  rec: Recommendation,
  parentReportId: string,
): InvestigationRecommendation | null {
  const kind = mapCategoryToKind(rec.category);
  if (!kind) return null;

  return {
    id: `legacy-investigation-${rec.id}`,
    kind,
    status: mapLegacyStatus(rec.status),
    severity: mapLegacySeverity(rec),
    source: rec.source === "health" ? "health" : rec.source === "drift" ? "drift" : "integrity",
    sourceArtifactId: rec.sourceArtifactId,
    evidenceRefs: [...rec.evidenceRefs],
    title: rec.title,
    description: rec.description,
    operatorGuidance: rec.operatorGuidance,
    createdAt: rec.generatedAt,
    legacySource: {
      store: "governance",
      recommendationId: rec.id,
      parentReportId,
    },
  };
}

function mapLegacyStatus(status: string): "open" | "in_progress" | "resolved" | "dismissed" {
  if (status === "acknowledged") return "in_progress";
  if (status === "dismissed") return "dismissed";
  return "open";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return a unified, deduplicated list of InvestigationRecommendations from
 * both native InvestigationStore records and legacy GovernanceStore records.
 *
 * Dedupe rule: a legacy record is skipped if a native InvestigationRecommendation
 * already exists with the same `sourceArtifactId` and `kind`.
 *
 * Results are sorted by createdAt descending (newest first).
 */
export async function listCompatibleInvestigations(
  governanceStore: GovernanceStore,
  investigationStore: InvestigationStore,
  filter?: InvestigationFilter,
): Promise<InvestigationRecommendation[]> {
  // 1. Load native records
  const native = await investigationStore.list(filter);

  // 2. Build dedupe set from native records: sourceArtifactId + kind
  const dedupeKeys = new Set<string>();
  for (const n of native) {
    dedupeKeys.add(`${n.sourceArtifactId}::${n.kind}`);
  }

  // 3. Load legacy GovernanceStore records
  const allReports = await governanceStore.list("recommendations");
  const legacy: InvestigationRecommendation[] = [];

  for (const report of allReports) {
    for (const rec of report.recommendations) {
      if (!INVESTIGATION_CATEGORIES.has(rec.category)) continue;

      // Dedupe: skip if a native record already covers this source + kind
      const kind = mapCategoryToKind(rec.category);
      if (!kind) continue;
      const dedupeKey = `${rec.sourceArtifactId}::${kind}`;
      if (dedupeKeys.has(dedupeKey)) continue;

      const wrapped = legacyToInvestigation(rec, report.id);
      if (wrapped) {
        legacy.push(wrapped);
      }
    }
  }

  // 4. Merge, sort by createdAt descending
  const merged = [...native, ...legacy];
  merged.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return merged;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/governance/investigation-compat.vitest.ts`
Expected: PASS (all 10 tests)

- [ ] **Step 5: Commit**

```bash
git add src/governance/investigation-compat.ts tests/governance/investigation-compat.vitest.ts
git commit -m "feat(p9.6): add investigation compatibility adapter (native + legacy merge)"
```

---

### Task 4: investigation-generator.ts

**Files:**
- Create: `src/governance/investigation-generator.ts`
- Create: `tests/governance/investigation-generator.vitest.ts`

**Interfaces:**
- Consumes: `InvestigationStore`, `InvestigationRecommendation`, `InvestigationKind` from `investigation-types.js`; `GovernanceDriftReport`, `GovernanceIntegrityReport` from `governance-types.js`; `GovernanceStore`
- Produces: `generateDriftInvestigations()`, `generateIntegrityInvestigations()`, `generateInvestigations()` (top-level orchestrator)

- [ ] **Step 1: Write the failing tests**

Create `tests/governance/investigation-generator.vitest.ts`:

```typescript
/**
 * P9.6 — InvestigationGenerator tests.
 *
 * @module
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { InvestigationStore } from "../../src/governance/investigation-store.js";
import { GovernanceStore } from "../../src/governance/governance-store.js";
import { generateInvestigations } from "../../src/governance/investigation-generator.js";
import type { GovernanceDriftReport, GovernanceIntegrityReport } from "../../src/governance/governance-types.js";

function makeDriftReport(overrides: Partial<GovernanceDriftReport> = {}): GovernanceDriftReport {
  return {
    id: "drift-report-001",
    subject: "Drift Report",
    outcome: "computed",
    confidence: 1,
    reasons: [],
    generatedAt: new Date().toISOString(),
    reportType: "governance_drift",
    findings: [
      {
        driftType: "chain_coverage_drop",
        detectedAt: new Date().toISOString(),
        severity: "high",
        confidence: 0.6,
        evidenceRefs: ["ev-001"],
        description: "Evidence chain coverage dropped to 55%",
        recommendation: "Investigate chain coverage",
      },
    ],
    ...overrides,
  };
}

function makeIntegrityReport(overrides: Partial<GovernanceIntegrityReport> = {}): GovernanceIntegrityReport {
  return {
    id: "integrity-report-001",
    subject: "Integrity Report",
    outcome: "computed",
    confidence: 1,
    reasons: [],
    generatedAt: new Date().toISOString(),
    reportType: "governance_integrity",
    metrics: {
      totalReviews: 50,
      reviewsWithProvenance: 10,
      reviewsWithExplanations: 20,
      reviewsLinkedToOutcomes: 5,
      untraceableFindings: 3,
      provenanceRate: 20,
      explanationRate: 40,
      outcomeLinkRate: 10,
    },
    ...overrides,
  };
}

let storeDir: string;
let invStore: InvestigationStore;
let govStore: GovernanceStore;
const generatedAt = "2026-06-24T12:00:00.000Z";

beforeEach(() => {
  storeDir = mkdtempSync(join(tmpdir(), "investigation-generator-"));
  invStore = new InvestigationStore(join(storeDir, ".alix", "governance"));
  govStore = new GovernanceStore(join(storeDir, ".alix", "governance"));
});

afterEach(() => {
  rmSync(storeDir, { recursive: true, force: true });
});

describe("generateInvestigations", () => {
  it("generates chain_restoration investigation from drift finding with chain_coverage_drop", async () => {
    const drift = makeDriftReport();
    await govStore.append("drift", drift);

    const result = await generateInvestigations({ store: govStore, investigationStore: invStore, generatedAt });

    expect(result.length).toBe(1);
    expect(result[0].kind).toBe("chain_restoration");
    expect(result[0].severity).toBe("high");
    expect(result[0].source).toBe("drift");
    expect(result[0].sourceArtifactId).toBe("drift-report-001");
  });

  it("generates governance_integrity investigation from drift finding with other driftType", async () => {
    const drift = makeDriftReport({
      findings: [{
        driftType: "lens_drift",
        detectedAt: new Date().toISOString(),
        severity: "critical",
        confidence: 0.8,
        evidenceRefs: ["ev-002"],
        description: "Lens drift detected",
        recommendation: "Investigate lens drift",
      }],
    });
    await govStore.append("drift", drift);

    const result = await generateInvestigations({ store: govStore, investigationStore: invStore, generatedAt });

    expect(result.length).toBe(1);
    expect(result[0].kind).toBe("governance_integrity");
    expect(result[0].severity).toBe("critical");
  });

  it("skips drift findings with low/medium severity", async () => {
    const drift = makeDriftReport({
      findings: [{
        driftType: "chain_coverage_drop",
        detectedAt: new Date().toISOString(),
        severity: "low",
        confidence: 0.3,
        evidenceRefs: ["ev-003"],
        description: "Minor coverage drop",
        recommendation: "Monitor",
      }],
    });
    await govStore.append("drift", drift);

    const result = await generateInvestigations({ store: govStore, investigationStore: invStore, generatedAt });
    expect(result.length).toBe(0);
  });

  it("generates chain_restoration from integrity provenanceRate below 60%", async () => {
    const integrity = makeIntegrityReport();
    await govStore.append("integrity", integrity);

    const result = await generateInvestigations({ store: govStore, investigationStore: invStore, generatedAt });

    // provenanceRate (20) < 60 → chain_restoration
    const chainRecs = result.filter((r) => r.kind === "chain_restoration" && r.source === "integrity");
    expect(chainRecs.length).toBeGreaterThanOrEqual(1);
    expect(chainRecs[0].severity).toBe("high");
  });

  it("generates governance_integrity from integrity explanationRate and outcomeLinkRate below 60%", async () => {
    const integrity = makeIntegrityReport();
    await govStore.append("integrity", integrity);

    const result = await generateInvestigations({ store: govStore, investigationStore: invStore, generatedAt });

    const integRecs = result.filter((r) => r.kind === "governance_integrity" && r.source === "integrity");
    // explanationRate (40) and outcomeLinkRate (10) both below 60
    expect(integRecs.length).toBe(2);
  });

  it("skips integrity metrics at or above 60%", async () => {
    const integrity = makeIntegrityReport({
      metrics: {
        totalReviews: 50,
        reviewsWithProvenance: 40,
        reviewsWithExplanations: 35,
        reviewsLinkedToOutcomes: 30,
        untraceableFindings: 0,
        provenanceRate: 80,
        explanationRate: 70,
        outcomeLinkRate: 60,
      },
    });
    await govStore.append("integrity", integrity);

    const result = await generateInvestigations({ store: govStore, investigationStore: invStore, generatedAt });
    const fromIntegrity = result.filter((r) => r.source === "integrity");
    expect(fromIntegrity.length).toBe(0);
  });

  it("writes generated investigations to InvestigationStore", async () => {
    const drift = makeDriftReport();
    await govStore.append("drift", drift);

    await generateInvestigations({ store: govStore, investigationStore: invStore, generatedAt });

    const stored = await invStore.list();
    expect(stored.length).toBeGreaterThan(0);
  });

  it("returns empty array when no artifacts exist in governance store", async () => {
    const result = await generateInvestigations({ store: govStore, investigationStore: invStore, generatedAt });
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/governance/investigation-generator.vitest.ts`
Expected: FAIL — "Cannot find module" (generator not yet implemented)

- [ ] **Step 3: Write the InvestigationGenerator**

Create `src/governance/investigation-generator.ts`:

```typescript
/**
 * P9.6 — InvestigationGenerator.
 *
 * Produces InvestigationRecommendation records from governance analysis
 * artifacts (drift reports, integrity reports). Parallel to
 * governance-recommendation-generator.ts but writes to InvestigationStore
 * instead of GovernanceStore.
 *
 * Core invariants:
 *  - Reads from GovernanceStore (drift + integrity artifacts).
 *  - Writes only to InvestigationStore.
 *  - Does NOT write to GovernanceStore.
 *
 * @module
 */

import { GovernanceStore } from "./governance-store.js";
import { InvestigationStore } from "./investigation-store.js";
import type {
  InvestigationRecommendation,
  InvestigationKind,
} from "./investigation-types.js";
import type { GovernanceDriftReport, GovernanceIntegrityReport } from "./governance-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_WINDOW_DAYS = 30;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shortId(prefix: string, generatedAt: string): string {
  const stamp = generatedAt.replace(/[^0-9]/g, "").slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${stamp}-${rand}`;
}

function clampSeverity(priority: string): "low" | "medium" | "high" | "critical" {
  if (priority === "critical" || priority === "high") return priority;
  if (priority === "medium") return "medium";
  return "low";
}

// ---------------------------------------------------------------------------
// 1. Drift Investigations
// ---------------------------------------------------------------------------

const DRIFT_KIND_MAP: Record<string, InvestigationKind> = {
  chain_coverage_drop: "chain_restoration",
};

/**
 * For each GovernanceDriftReport, emit one InvestigationRecommendation per
 * finding with severity "high" or "critical". Low/medium findings are skipped.
 * chain_coverage_drop → chain_restoration; everything else → governance_integrity.
 */
export function generateDriftInvestigations(
  reports: GovernanceDriftReport[],
  generatedAt: string,
): InvestigationRecommendation[] {
  const results: InvestigationRecommendation[] = [];

  for (const report of reports) {
    for (const finding of report.findings) {
      if (finding.severity !== "high" && finding.severity !== "critical") continue;

      const kind = DRIFT_KIND_MAP[finding.driftType] ?? "governance_integrity";
      const id = shortId("inv_drift", generatedAt);

      results.push({
        id,
        kind,
        status: "open",
        severity: clampSeverity(finding.severity),
        source: "drift",
        sourceArtifactId: report.id,
        evidenceRefs: [...finding.evidenceRefs],
        title: finding.description.length > 60 ? finding.description.slice(0, 57) + "…" : finding.description,
        description: finding.description,
        operatorGuidance:
          kind === "chain_restoration"
            ? "Investigate why proposals are bypassing evidence chain provenance."
            : "Investigate the governance review pipeline to determine root cause.",
        createdAt: generatedAt,
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// 2. Integrity Investigations
// ---------------------------------------------------------------------------

interface IntegrityMetric {
  key: "provenanceRate" | "explanationRate" | "outcomeLinkRate";
  label: string;
  kind: InvestigationKind;
}

const INTEGRITY_METRICS: IntegrityMetric[] = [
  { key: "provenanceRate", label: "Provenance rate", kind: "chain_restoration" },
  { key: "explanationRate", label: "Explanation rate", kind: "governance_integrity" },
  { key: "outcomeLinkRate", label: "Outcome link rate", kind: "governance_integrity" },
];

/**
 * For each GovernanceIntegrityReport, emit one InvestigationRecommendation
 * per metric whose rate is below 60%.
 */
export function generateIntegrityInvestigations(
  reports: GovernanceIntegrityReport[],
  generatedAt: string,
): InvestigationRecommendation[] {
  const results: InvestigationRecommendation[] = [];

  for (const report of reports) {
    for (const m of INTEGRITY_METRICS) {
      const rate = report.metrics[m.key];
      if (!Number.isFinite(rate) || rate >= 60) continue;

      const severity: "low" | "medium" | "high" | "critical" = rate < 30 ? "high" : "medium";
      const id = shortId("inv_integrity", generatedAt);

      results.push({
        id,
        kind: m.kind,
        status: "open",
        severity,
        source: "integrity",
        sourceArtifactId: report.id,
        evidenceRefs: [report.id],
        title: `${m.label} at ${rate}%`,
        description:
          `${m.label} is ${rate}% (threshold: 60%). ` +
          `Governance review artifacts are not carrying the expected ${m.label.toLowerCase()}.`,
        operatorGuidance:
          m.kind === "chain_restoration"
            ? "Investigate why proposals are bypassing evidence chain provenance."
            : "Investigate the review pipeline to determine why this rate is below threshold.",
        createdAt: generatedAt,
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// generateInvestigations — top-level orchestrator
// ---------------------------------------------------------------------------

export async function generateInvestigations(opts: {
  cwd?: string;
  windowDays?: number;
  generatedAt?: string;
  store?: GovernanceStore;
  investigationStore?: InvestigationStore;
}): Promise<InvestigationRecommendation[]> {
  void opts.cwd;
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const genAt = opts.generatedAt ?? new Date().toISOString();
  const store = opts.store ?? new GovernanceStore();
  const invStore = opts.investigationStore ?? new InvestigationStore();

  const [drift, integrity] = await Promise.all([
    store.queryByWindow("drift", windowDays),
    store.queryByWindow("integrity", windowDays),
  ]);

  const investigations: InvestigationRecommendation[] = [
    ...generateDriftInvestigations(drift, genAt),
    ...generateIntegrityInvestigations(integrity, genAt),
  ];

  // Write each investigation to InvestigationStore
  for (const inv of investigations) {
    await invStore.save(inv);
  }

  return investigations;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/governance/investigation-generator.vitest.ts`
Expected: PASS (all 8 tests)

- [ ] **Step 5: Run full test suite to verify no regressions**

Run: `npx vitest run`
Expected: All existing tests still pass

- [ ] **Step 6: Commit**

```bash
git add src/governance/investigation-generator.ts tests/governance/investigation-generator.vitest.ts
git commit -m "feat(p9.6): add InvestigationGenerator (drift + integrity producers)"
```

---

### Task 5: CLI — `alix governance investigate` sub-namespace

**Files:**
- Modify: `src/cli/commands/governance.ts`
- Test: `tests/cli/commands/governance-cli.vitest.ts` (modified in Task 6)

**Interfaces:**
- Consumes: `InvestigationStore`, `GovernanceStore`, `listCompatibleInvestigations`, `generateInvestigations` from previous tasks

- [ ] **Step 1: Add the `investigate` subcommand handlers to `governance.ts`**

Add the following after line 235 (inside `handleGovernanceCommand`, before the `default` case):

```typescript
    case "investigate":
      return runInvestigate(rest);
```

Then add the handler functions after the existing `runGovernanceExplain` function (before the BAR line), and update the usage string.

Here's the complete code to add after line 709 (`// -- Terminal renderers --`), before the `BAR` constant:

```typescript
// ---------------------------------------------------------------------------
// runInvestigate — `alix governance investigate <subcommand> [args]`
// ---------------------------------------------------------------------------

async function runInvestigate(args: string[]): Promise<void> {
  const sub = args[0];

  switch (sub) {
    case "list":
      return runInvestigateList(args.slice(1));
    case "show":
      return runInvestigateShow(args.slice(1));
    case "update":
      return runInvestigateUpdate(args.slice(1));
    case "generate":
      return runInvestigateGenerate(args.slice(1));
    default:
      console.error(
        `Usage: alix governance investigate {list|show|update|generate} [options]`,
      );
      process.exit(2);
  }
}

async function runInvestigateList(args: string[]): Promise<void> {
  const jsonMode = args.includes("--json");
  const kindIdx = args.indexOf("--kind");
  let kind: "chain_restoration" | "governance_integrity" | undefined;
  if (kindIdx !== -1 && kindIdx + 1 < args.length) {
    const v = args[kindIdx + 1];
    if (v !== "chain_restoration" && v !== "governance_integrity") {
      console.error("Error: --kind must be 'chain_restoration' or 'governance_integrity'");
      process.exit(1);
    }
    kind = v;
  }

  const store = new GovernanceStore();
  const invStore = new InvestigationStore();

  const investigations = await listCompatibleInvestigations(
    store,
    invStore,
    kind ? { kind } : undefined,
  );

  if (jsonMode) {
    console.log(JSON.stringify(investigations, null, 2));
    return;
  }

  if (investigations.length === 0) {
    console.log(BOLD + "Investigations" + RESET);
    console.log(BAR);
    console.log(DIM + "  No investigations found." + RESET);
    return;
  }

  const resolvedCount = investigations.filter((i) => i.status === "resolved" || i.status === "dismissed").length;
  const openCount = investigations.length - resolvedCount;

  console.log(BOLD + `Investigations (${openCount} open, ${resolvedCount} resolved)` + RESET);
  console.log(BAR);

  for (const inv of investigations) {
    const statusIcon = inv.status === "open" ? "○" : inv.status === "in_progress" ? "◐" : inv.status === "resolved" ? "✓" : "✗";
    const severityColor = inv.severity === "critical" || inv.severity === "high" ? RED : inv.severity === "medium" ? YELLOW : GREEN;

    console.log(
      `  ${statusIcon} ${severityColor}[${inv.severity.toUpperCase()}]${RESET}` +
      ` ${inv.kind.replace("_", " ")}` +
      (inv.legacySource ? DIM + " (legacy)" + RESET : ""),
    );
    console.log(`    ${CYAN}${inv.id}${RESET}`);
    console.log(`    ${inv.title}`);
    console.log(`    ${DIM}Status: ${inv.status} | Source: ${inv.source}${RESET}`);
    if (inv.assignedTo) {
      console.log(`    ${DIM}Assigned: ${inv.assignedTo}${RESET}`);
    }
    console.log("");
  }
}

async function runInvestigateShow(args: string[]): Promise<void> {
  const id = args[0];
  if (!id) {
    console.error("Usage: alix governance investigate show <investigation-id>");
    process.exit(2);
  }
  const jsonMode = args.includes("--json");

  // Check both stores
  const invStore = new InvestigationStore();
  const native = await invStore.get(id);

  if (!native) {
    // Legacy ID might be in legacy-investigation-<uuid> form, but we need
    // to check via the compat adapter
    const store = new GovernanceStore();
    const all = await listCompatibleInvestigations(store, invStore);
    const found = all.find((i) => i.id === id);
    if (!found) {
      if (jsonMode) {
        console.log(JSON.stringify({ error: `Investigation not found: ${id}` }));
      } else {
        console.error(`Investigation not found: ${id}`);
      }
      process.exit(1);
    }

    if (jsonMode) {
      console.log(JSON.stringify(found, null, 2));
    } else {
      renderInvestigationDetail(found);
    }
    return;
  }

  if (jsonMode) {
    console.log(JSON.stringify(native, null, 2));
  } else {
    renderInvestigationDetail(native);
  }
}

function renderInvestigationDetail(inv: InvestigationRecommendation): void {
  console.log(BOLD + `Investigation: ${inv.id}` + RESET);
  console.log(BAR);
  console.log(`  Kind:       ${inv.kind}`);
  console.log(`  Status:     ${inv.status}`);
  console.log(`  Severity:   ${inv.severity}`);
  console.log(`  Source:     ${inv.source}`);
  console.log(`  Created:    ${inv.createdAt}`);
  if (inv.updatedAt) console.log(`  Updated:    ${inv.updatedAt}`);
  if (inv.assignedTo) console.log(`  Assigned:   ${inv.assignedTo}`);
  if (inv.resolvedAt) console.log(`  Resolved:   ${inv.resolvedAt}`);
  if (inv.resolution) console.log(`  Resolution: ${inv.resolution}`);
  console.log("");
  console.log(BOLD + "  Description" + RESET);
  console.log(`  ${inv.description}`);
  console.log("");
  console.log(BOLD + "  Operator Guidance" + RESET);
  console.log(`  ${inv.operatorGuidance}`);
  if (inv.legacySource) {
    console.log("");
    console.log(DIM + "  Legacy Source" + RESET);
    console.log(`  Store:              ${inv.legacySource.store}`);
    console.log(`  Recommendation:     ${inv.legacySource.recommendationId}`);
    console.log(`  Parent Report:      ${inv.legacySource.parentReportId}`);
  }
}

async function runInvestigateUpdate(args: string[]): Promise<void> {
  const id = args[0];
  if (!id) {
    console.error("Usage: alix governance investigate update <id> [--status <status>] [--assign <user>] [--resolution <text>]");
    process.exit(2);
  }
  const jsonMode = args.includes("--json");

  const statusIdx = args.indexOf("--status");
  let status: "open" | "in_progress" | "resolved" | "dismissed" | undefined;
  if (statusIdx !== -1 && statusIdx + 1 < args.length) {
    const v = args[statusIdx + 1];
    if (!["open", "in_progress", "resolved", "dismissed"].includes(v)) {
      console.error("Error: --status must be one of: open, in_progress, resolved, dismissed");
      process.exit(1);
    }
    status = v as typeof status;
  }

  const assignIdx = args.indexOf("--assign");
  let assignedTo: string | undefined;
  if (assignIdx !== -1 && assignIdx + 1 < args.length) {
    assignedTo = args[assignIdx + 1];
  }

  const resolutionIdx = args.indexOf("--resolution");
  let resolution: string | undefined;
  if (resolutionIdx !== -1 && resolutionIdx + 1 < args.length) {
    resolution = args[resolutionIdx + 1];
  }

  const invStore = new InvestigationStore();

  // Must have at least one update
  if (!status && !assignedTo) {
    console.error("Error: provide at least --status or --assign");
    process.exit(1);
  }

  if (status) {
    await invStore.updateStatus(id, status, { resolution, assignedTo });
  } else if (assignedTo) {
    // Update assignment by appending current state with new assignment
    const existing = await invStore.get(id);
    if (!existing) {
      if (jsonMode) {
        console.log(JSON.stringify({ error: `Investigation not found: ${id}` }));
      } else {
        console.error(`Investigation not found: ${id}`);
      }
      process.exit(1);
    }
    await invStore.updateStatus(id, existing.status, { assignedTo });
  }

  if (jsonMode) {
    const updated = await invStore.get(id);
    console.log(JSON.stringify({ ok: true, investigation: updated }));
  } else {
    console.log(`Investigation updated: ${id}`);
    if (status) console.log(`  Status:     ${status}`);
    if (assignedTo) console.log(`  Assigned:   ${assignedTo}`);
    if (resolution) console.log(`  Resolution: ${resolution}`);
  }
}

async function runInvestigateGenerate(args: string[]): Promise<void> {
  const jsonMode = args.includes("--json");
  const windowIdx = args.indexOf("--window");
  let windowDays = 30;
  if (windowIdx !== -1) {
    if (windowIdx + 1 >= args.length) {
      console.error("Error: --window requires a value (positive integer)");
      process.exit(1);
    }
    const parsed = parseInt(args[windowIdx + 1], 10);
    if (isNaN(parsed) || parsed <= 0) {
      console.error("Error: --window requires a positive integer");
      process.exit(1);
    }
    windowDays = parsed;
  }

  const store = new GovernanceStore();
  const invStore = new InvestigationStore();
  const generatedAt = new Date().toISOString();

  const investigations = await generateInvestigations({
    store,
    investigationStore: invStore,
    windowDays,
    generatedAt,
  });

  if (jsonMode) {
    console.log(JSON.stringify(investigations, null, 2));
  } else {
    console.log(`Generated ${investigations.length} investigation(s).`);
    for (const inv of investigations) {
      const severityColor = inv.severity === "critical" || inv.severity === "high" ? RED : YELLOW;
      console.log(
        `  ${severityColor}[${inv.severity.toUpperCase()}]${RESET}` +
        ` ${inv.kind.replace("_", " ")} — ${inv.title}`,
      );
    }
  }
}
```

Also add the missing import for `InvestigationStore` and `investigation-generator.ts`. At the top of the file, add these imports alongside the existing GovernanceStore import:

```typescript
import { InvestigationStore } from "../../governance/investigation-store.js";
import { generateInvestigations } from "../../governance/investigation-generator.js";
import { listCompatibleInvestigations } from "../../governance/investigation-compat.js";
import type { InvestigationRecommendation } from "../../governance/investigation-types.js";
```

- [ ] **Step 2: Run tsc to verify compile**

Run: `npx tsc --noEmit`
Expected: clean compile

- [ ] **Step 3: Update the usage message (default case)**

Replace the existing usage string:
```
"Usage: alix governance {health|drift|lens-review|integrity|recommend|propose|approve|reject|list|cleanup|explain} [--window <days>] [--json]",
```
with:
```
"Usage: alix governance {health|drift|lens-review|integrity|recommend|propose|approve|reject|list|cleanup|explain|investigate} [--window <days>] [--json]",
```

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/governance.ts
git commit -m "feat(p9.6): add investigate sub-namespace to governance CLI (list/show/update/generate)"
```

---

### Task 6: CLI tests for investigate sub-namespace

**Files:**
- Modify: `tests/cli/commands/governance-cli.vitest.ts`

**Interfaces:**
- Consumes: `handleGovernanceCommand` from `governance.js`

- [ ] **Step 1: Write the failing tests**

Append these test blocks to `tests/cli/commands/governance-cli.vitest.ts` (after the existing tests, before the final closing):

```typescript
describe("alix governance investigate list", () => {
  it("shows empty state when no investigations exist", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleGovernanceCommand(["investigate", "list"]);
    const out = log.mock.calls.map((c) => String(c[0])).join("\n");
    log.mockRestore();
    expect(out).toContain("No investigations found");
  });

  it("lists native investigations saved via generate", async () => {
    // Seed a drift report so the generator creates investigations
    const govDir = join(tempRoot, ".alix", "governance");
    mkdirSync(govDir, { recursive: true });
    writeFileSync(join(govDir, "drift.jsonl"), JSON.stringify({
      id: "drift-test",
      subject: "Test",
      outcome: "computed",
      confidence: 1,
      reasons: [],
      generatedAt: new Date().toISOString(),
      reportType: "governance_drift",
      findings: [{
        driftType: "chain_coverage_drop",
        detectedAt: new Date().toISOString(),
        severity: "high",
        confidence: 0.6,
        evidenceRefs: ["ev-test"],
        description: "Chain coverage drop",
        recommendation: "Investigate",
      }],
    }) + "\n", "utf-8");

    await handleGovernanceCommand(["investigate", "generate"]);

    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleGovernanceCommand(["investigate", "list"]);
    const out = log.mock.calls.map((c) => String(c[0])).join("\n");
    log.mockRestore();
    expect(out).toContain("Investigations");
    expect(out).toContain("chain restoration");
  });

  it("lists with --json flag", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleGovernanceCommand(["investigate", "list", "--json"]);
    const out = log.mock.calls.map((c) => String(c[0])).join("");
    log.mockRestore();
    const parsed = JSON.parse(out);
    expect(Array.isArray(parsed)).toBe(true);
  });

  it("filters by --kind flag", async () => {
    // Two investigations via governance_integrity drift finding + chain_restoration integrity
    await handleGovernanceCommand(["investigate", "list", "--kind", "chain_restoration", "--json"]);
    // No crash — just verify it returns an array
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleGovernanceCommand(["investigate", "list", "--kind", "chain_restoration", "--json"]);
    const out = log.mock.calls.map((c) => String(c[0])).join("");
    log.mockRestore();
    const parsed = JSON.parse(out);
    expect(Array.isArray(parsed)).toBe(true);
  });
});

describe("alix governance investigate show", () => {
  it("shows error for missing id", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await handleGovernanceCommand(["investigate", "show"]);
    const out = err.mock.calls.map((c) => String(c[0])).join("\n");
    err.mockRestore();
    expect(out).toContain("Usage");
  });

  it("shows not-found for nonexistent id", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await handleGovernanceCommand(["investigate", "show", "nonexistent-id"]);
    const out = err.mock.calls.map((c) => String(c[0])).join("\n");
    err.mockRestore();
    expect(out).toContain("not found");
  });
});

describe("alix governance investigate update", () => {
  it("shows error for missing id", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await handleGovernanceCommand(["investigate", "update"]);
    const out = err.mock.calls.map((c) => String(c[0])).join("\n");
    err.mockRestore();
    expect(out).toContain("Usage");
  });

  it("shows error without any status or assign flag", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await handleGovernanceCommand(["investigate", "update", "test-id"]);
    const out = err.mock.calls.map((c) => String(c[0])).join("\n");
    err.mockRestore();
    expect(out).toContain("provide at least");
  });
});

describe("alix governance investigate generate", () => {
  it("generates investigations from drift and integrity records", async () => {
    // Seed a drift report in governance store
    const govDir = join(tempRoot, ".alix", "governance");
    mkdirSync(govDir, { recursive: true });
    writeFileSync(join(govDir, "drift.jsonl"), JSON.stringify({
      id: "drift-gen-test",
      subject: "Test",
      outcome: "computed",
      confidence: 1,
      reasons: [],
      generatedAt: new Date().toISOString(),
      reportType: "governance_drift",
      findings: [{
        driftType: "chain_coverage_drop",
        detectedAt: new Date().toISOString(),
        severity: "high",
        confidence: 0.6,
        evidenceRefs: ["ev-gen"],
        description: "Production chain coverage drop",
        recommendation: "Investigate",
      }],
    }) + "\n", "utf-8");

    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleGovernanceCommand(["investigate", "generate"]);
    const out = log.mock.calls.map((c) => String(c[0])).join("\n");
    log.mockRestore();
    expect(out).toContain("Generated");
    expect(out).toContain("chain restoration");
  });

  it("generates with --json flag", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleGovernanceCommand(["investigate", "generate", "--json"]);
    const out = log.mock.calls.map((c) => String(c[0])).join("");
    log.mockRestore();
    const parsed = JSON.parse(out);
    expect(Array.isArray(parsed)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail or pass**

Run: `npx vitest run tests/cli/commands/governance-cli.vitest.ts`
Expected: Tests for `investigate` should run. Some may fail if the CLI handler hasn't been updated yet. If they pass, tests for new subcommands should exercise the handlers.

- [ ] **Step 3: Run full test suite to verify no regressions**

Run: `npx vitest run`
Expected: All existing tests pass (1689+ tests)

- [ ] **Step 4: Commit**

```bash
git add tests/cli/commands/governance-cli.vitest.ts
git commit -m "test(p9.6): add CLI tests for investigate list/show/update/generate"
```

---

### Task 7: Sentinel updates + final verification

**Files:**
- Modify: `tests/governance/governance-sentinels.vitest.ts` (add P9.6 sentinel if one exists)
- OR verify that existing sentinels don't need changes

**Context:** The existing `governance-sentinels.vitest.ts` tests enforce purity rules for governance modules. Since:
- `investigation-types.ts` is pure data types — no sentinel needed
- `investigation-store.ts` uses `writeFileSync`/`mkdirSync`/`appendFileSync`/`readFileSync`/`existsSync` — same pattern as `GovernanceStore`, which is the permitted write path for P9
- `investigation-compat.ts` is read-only — reads from GovernanceStore, never writes
- `investigation-generator.ts` reads from GovernanceStore and writes to InvestigationStore — additive only, no mutation path
- `governance.ts` CLI handlers are already covered by existing sentinel patterns

No new sentinel types are needed. The existing P9 store-write sentinel already allows `*-store.ts` patterns. Verify this.

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: Clean compile

- [ ] **Step 3: Commit if any sentinel adjustments were needed**

```bash
git add tests/governance/governance-sentinels.vitest.ts
git commit -m "chore(p9.6): update sentinels for investigation modules"
```

If no changes were needed, just verify and move on.

- [ ] **Step 4: Record progress in ledger**

Append to `.superpowers/sdd/progress.md`:

```markdown
## P9.6 — InvestigationRecommendation subagent-driven progress

Branch: feature/p9-6-investigation-recommendation (off main @ 7ed40bc5)
Plan: docs/superpowers/plans/2026-06-24-p9-6-investigation-recommendation.md

Task 1: complete (investigation-types.ts)
Task 2: complete (investigation-store.ts)
Task 3: complete (investigation-compat.ts)
Task 4: complete (investigation-generator.ts)
Task 5: complete (CLI investigate sub-namespace)
Task 6: complete (CLI tests)
Task 7: complete (sentinel verification + full suite)
```

## Self-Review

**Spec coverage check:**
- InvestigationRecommendation type with InvestigationKind, InvestigationStatus, InvestigationSource ✅ (Task 1)
- InvestigationStore append-only JSONL, updateStatus appends new version ✅ (Task 2)
- listCompatibleInvestigations native + legacy merge with dedupe ✅ (Task 3)
- Legacy ID format `legacy-investigation-${recommendation.id}` ✅ (Task 3)
- InvestigationGenerator drift + integrity producers ✅ (Task 4)
- Generator writes to InvestigationStore, not GovernanceStore ✅ (Task 4)
- CLI: `alix governance investigate list/show/update/generate` ✅ (Task 5, Task 6)
- Priority not persisted — computed overlay only ✅ (no priority in types or store)
- No GovernanceStore mutation ✅ (adapter is read-only, generator writes to InvestigationStore)
- No mutation/apply path ✅ (no GovernanceChangeApplier interaction)
- Generator coexistence rule (dedupe by sourceArtifactId + kind) ✅ (Task 3)
- Legacy provenance with `parentReportId: sourceArtifactId` ✅ (Task 3)

**No placeholders found.** All steps have complete code and exact commands.

**Type consistency check:** Types flow consistently across all tasks — `InvestigationRecommendation` from Task 1 is consumed by Task 2 (store), Task 3 (compat), Task 4 (generator), and Task 5 (CLI). No method name conflicts.
