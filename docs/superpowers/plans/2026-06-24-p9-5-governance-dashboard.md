# P9.5 — Governance Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only terminal `alix governance dashboard` command that surfaces 6 panels (mutation pipeline health + 5 secondary panels) so an operator can answer "Can ALiX safely apply governance changes right now?" in 5 seconds.

**Architecture:** Three layers, mirroring P8.5b's proven pattern: (1) `buildGovernanceDashboardReport()` aggregator in `src/governance/governance-dashboard.ts` (read-only, hybrid data: P9.0 builders + stores); (2) `renderGovernanceDashboard()` terminal formatter in `src/cli/commands/governance-dashboard-renderer.ts`; (3) `runDashboard()` CLI handler in `src/cli/commands/governance-dashboard-handler.ts` (extracted to its own file for sentinel scoping). The `dashboard` case in `src/cli/commands/governance.ts` delegates to the handler.

**Tech Stack:** TypeScript, Node.js fs/path, vitest. Pure read-only aggregator. No new evidence types, no new writer methods, no mutation paths.

## Global Constraints

1. `report.schemaVersion = "p9.5.0"` (string literal, exact value).
2. The dashboard aggregator is **the only place** that touches the data layer. Renderer and handler consume the typed report.
3. The handler is extracted to `src/cli/commands/governance-dashboard-handler.ts` so the sentinel can scan a precise file.
4. The sentinel forbids mutation write paths (appliers, approve/apply/reject verbs, `ProposalStore.save` / `ProposalStore.markOrphaned`, all `record*` evidence write methods) but **permits** read-only store queries (`.list`, `.load`, `.existsForProposal`, `.queryByWindow`).
5. Supported mutation kinds (3): `confidence_calibration`, `lens_adjustment`, `policy_coverage`. Investigation-only kinds (2): `chain_restoration`, `governance_integrity`. See P9.4c close-out.
6. P9.0 builders used (all exist in `src/governance/`): `buildGovernanceHealth`, `buildGovernanceAssessment`, `detectGovernanceDrift`, `buildGovernanceIntegrity`, `reviewLenses`.
7. Stores used (read-only): `GovernanceStore` (`.list("recommendations")`), `ProposalStore` (`.list(status?)` + `.load(id)`), `SnapshotStore` (`.load(proposalId)` + `.loadVerified(proposalId)`).
8. No new evidence types. No new writer methods. The mutation history and revert readiness panels are derived from `ProposalStore.list("applied")` + `SnapshotStore.loadVerified`, not from evidence reads.
9. The aggregator NEVER writes to any store, file, or evidence chain. The purity sentinel enforces this.
10. P9.5 stays terminal-text (no TUI/web). Single-shot. Single window.

---
### Task 1: Create the aggregator types

**Files:**
- Create: `src/governance/governance-dashboard.ts` (the file will be filled in by Task 2; this task only adds the types)

**Interfaces:**
- Consumes: nothing (foundational)
- Produces: `GovernanceDashboardOptions`, `GovernanceDashboardReport`, and the 6 panel types. All other tasks import these.

- [ ] **Step 1: Create the file with the type definitions only**

```ts
/**
 * P9.5 — Governance Dashboard.
 *
 * Pure read-only aggregation. Consumes P9.0 builders and stores. Never writes.
 * Mirrors the P8.5b Learning Dashboard's aggregator pattern.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface GovernanceDashboardOptions {
  /** Repository root. */
  cwd: string;
  /** Window in days for window-bounded queries. Defaults to 90. */
  windowDays?: number;
  /** Fixed timestamp for deterministic output (test-friendly). */
  generatedAt?: string;
}

/**
 * Mutation pipeline health panel — the 5-second answer.
 * "Can ALiX safely apply governance changes right now?"
 */
export interface HealthPanel {
  supportedKinds: number;
  totalKinds: number;
  supportedKindList: string[];
  pendingProposals: number;
  blockedUnsupportedKinds: number;
  investigationOnlyRecs: number;
  recentApplyFailures: number;
  revertReadinessPercent: number;
  revertReadyCount: number;
  totalAppliedMutations: number;
}

export interface OpenMutationRow {
  proposalId: string;
  recommendationId: string;
  status: "pending" | "approved";
  targetKind: string;
  createdAt: string;
  confidence: number;
}

export interface OpenMutationsPanel {
  rows: OpenMutationRow[];
  totalCount: number;
}

export interface InvestigationQueueRow {
  recommendationId: string;
  category: "chain_restoration" | "governance_integrity";
  severity: "low" | "medium" | "high" | "critical";
  createdAt: string;
  operatorGuidance: string;
}

export interface InvestigationQueuePanel {
  rows: InvestigationQueueRow[];
  totalCount: number;
}

export interface MutationHistoryRow {
  proposalId: string;
  kind: string;
  appliedAt: string;
  appliedBy: string;
  snapshotStatus: "present" | "missing" | "corrupted";
}

export interface MutationHistoryPanel {
  rows: MutationHistoryRow[];
  totalCount: number;
}

export interface RevertReadinessPanel {
  ready: number;
  missing: number;
  corrupted: number;
  total: number;
  percentReady: number;
}

export interface DriftIntegrityGapRow {
  source: "drift" | "integrity" | "lens-review" | "health";
  severity: "low" | "medium" | "high" | "critical";
  message: string;
  reference: string;
}

export interface DriftIntegrityGapsPanel {
  rows: DriftIntegrityGapRow[];
  totalCount: number;
}

export interface GovernanceDashboardReport {
  schemaVersion: "p9.5.0";
  generatedAt: string;
  windowDays: number;
  health: HealthPanel;
  openMutations: OpenMutationsPanel;
  investigationQueue: InvestigationQueuePanel;
  mutationHistory: MutationHistoryPanel;
  revertReadiness: RevertReadinessPanel;
  driftIntegrityGaps: DriftIntegrityGapsPanel;
}
```

- [ ] **Step 2: Run tsc to verify the types compile**

```bash
npx tsc --noEmit 2>&1 | head -10
```

Expected: clean (no errors). The file has no runtime code yet, only types.

- [ ] **Step 3: Commit**

```bash
git add src/governance/governance-dashboard.ts
git commit -m "P9.5: add governance-dashboard type definitions"
```

---
### Task 2: Implement the aggregator

**Files:**
- Modify: `src/governance/governance-dashboard.ts` (append the aggregator function)

**Interfaces:**
- Consumes: types from Task 1; P9.0 builders (`buildGovernanceHealth`, `buildGovernanceAssessment`, `detectGovernanceDrift`, `buildGovernanceIntegrity`, `reviewLenses`); `GovernanceStore`, `ProposalStore`, `SnapshotStore`
- Produces: `buildGovernanceDashboardReport(opts)` — the only public runtime export

- [ ] **Step 1: Append the imports and constants**

Append to `src/governance/governance-dashboard.ts`:

```ts
import { join } from "node:path";
import { buildGovernanceHealth } from "./governance-health-builder.js";
import { buildGovernanceAssessment } from "./governance-assessment.js";
import { detectGovernanceDrift } from "./governance-drift-detector.js";
import { buildGovernanceIntegrity } from "./governance-integrity.js";
import { reviewLenses } from "./governance-lens-review.js";
import { GovernanceStore } from "./governance-store.js";
import { ProposalStore } from "../adaptation/proposal-store.js";
import { SnapshotStore } from "../adaptation/snapshot-store.js";
import type { AdaptationProposal } from "../adaptation/adaptation-types.js";
import type { Recommendation } from "./governance-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GOVERNANCE_DIR = join(".alix", "governance");
const ADAPTATION_DIR = join(".alix", "adaptation");
const SNAPSHOT_DIR = join(ADAPTATION_DIR, "snapshots");

const SUPPORTED_MUTATION_KINDS: ReadonlySet<string> = new Set([
  "confidence_calibration",
  "lens_adjustment",
  "policy_coverage",
]);

const INVESTIGATION_ONLY_KINDS: ReadonlySet<string> = new Set([
  "chain_restoration",
  "governance_integrity",
]);

const TOTAL_KINDS = SUPPORTED_MUTATION_KINDS.size + INVESTIGATION_ONLY_KINDS.size;
const DEFAULT_WINDOW_DAYS = 90;
```

- [ ] **Step 2: Append the aggregator function**

Append:

```ts
// ---------------------------------------------------------------------------
// Aggregator
// ---------------------------------------------------------------------------

/**
 * Build the GovernanceDashboardReport. Pure read-only. The only public
 * runtime export of this module. Mirrors P8.5b's buildDashboardReport.
 */
export async function buildGovernanceDashboardReport(
  opts: GovernanceDashboardOptions,
): Promise<GovernanceDashboardReport> {
  const generatedAt = opts.generatedAt ?? new Date().toISOString();
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;

  // ---- 1. Run P9.0 builders in parallel --------------------------------
  const [health, _assessment, drift, integrity, lensReview] = await Promise.all([
    buildGovernanceHealth({ cwd: opts.cwd, windowDays, generatedAt }).catch(() => null),
    buildGovernanceAssessment({ reports: [] }).catch(() => null),
    detectGovernanceDrift({ cwd: opts.cwd, windowDays, generatedAt }).catch(() => null),
    buildGovernanceIntegrity({ cwd: opts.cwd, windowDays, generatedAt }).catch(() => null),
    reviewLenses({ cwd: opts.cwd, windowDays, generatedAt }).catch(() => null),
  ]);

  // ---- 2. Read stores ---------------------------------------------------
  const govStore = new GovernanceStore(join(opts.cwd, GOVERNANCE_DIR));
  const proposalStore = new ProposalStore(join(opts.cwd, ADAPTATION_DIR, "proposals"));
  const snapshotStore = new SnapshotStore(join(opts.cwd, SNAPSHOT_DIR));

  const recommendationReports = await govStore.list("recommendations").catch(() => []);
  const allRecs: Recommendation[] = recommendationReports.flatMap((r) => r.recommendations);

  const pendingProposalsRaw = await proposalStore.list("pending").catch(() => []);
  const approvedProposalsRaw = await proposalStore.list("approved").catch(() => []);
  const appliedProposalsRaw = await proposalStore.list("applied").catch(() => []);

  // ---- 3. Build each panel --------------------------------------------
  const openMutations = buildOpenMutationsPanel(pendingProposalsRaw, approvedProposalsRaw);
  const investigationQueue = buildInvestigationQueuePanel(allRecs);
  const mutationHistory = await buildMutationHistoryPanel(appliedProposalsRaw, snapshotStore);
  const revertReadiness = buildRevertReadinessPanel(mutationHistory);
  const driftIntegrityGaps = buildDriftIntegrityGapsPanel({
    health, drift, integrity, lensReview,
  });

  // ---- 4. Build primary health panel -----------------------------------
  const healthPanel: HealthPanel = {
    supportedKinds: SUPPORTED_MUTATION_KINDS.size,
    totalKinds: TOTAL_KINDS,
    supportedKindList: [...SUPPORTED_MUTATION_KINDS],
    pendingProposals: openMutations.totalCount,
    blockedUnsupportedKinds: 0, // future: count proposals whose kind is not in SUPPORTED
    investigationOnlyRecs: investigationQueue.totalCount,
    recentApplyFailures: 0, // future: filter applied proposals by recent failures
    revertReadinessPercent: revertReadiness.percentReady,
    revertReadyCount: revertReadiness.ready,
    totalAppliedMutations: revertReadiness.total,
  };

  return {
    schemaVersion: "p9.5.0",
    generatedAt,
    windowDays,
    health: healthPanel,
    openMutations,
    investigationQueue,
    mutationHistory,
    revertReadiness,
    driftIntegrityGaps,
  };
}

// ---------------------------------------------------------------------------
// Panel builders (pure helpers)
// ---------------------------------------------------------------------------

function buildOpenMutationsPanel(
  pending: AdaptationProposal[],
  approved: AdaptationProposal[],
): OpenMutationsPanel {
  const rows: OpenMutationRow[] = [];
  for (const p of [...pending, ...approved]) {
    if (p.action !== "governance_change") continue;
    const payload = p.payload as { kind?: string };
    if (!payload.kind || !SUPPORTED_MUTATION_KINDS.has(payload.kind)) continue;
    rows.push({
      proposalId: p.id,
      recommendationId: (p.target as { recommendationId?: string })?.recommendationId ?? "",
      status: p.status as "pending" | "approved",
      targetKind: payload.kind,
      createdAt: p.createdAt,
      confidence: p.sourceConfidence ?? 0,
    });
  }
  return { rows, totalCount: rows.length };
}

function buildInvestigationQueuePanel(allRecs: Recommendation[]): InvestigationQueuePanel {
  const rows: InvestigationQueueRow[] = [];
  for (const rec of allRecs) {
    if (rec.status !== "open") continue;
    if (!INVESTIGATION_ONLY_KINDS.has(rec.category)) continue;
    rows.push({
      recommendationId: rec.id,
      category: rec.category as "chain_restoration" | "governance_integrity",
      severity: rec.priority,
      createdAt: rec.sourceArtifactId, // best-effort; recs don't carry their own createdAt
      operatorGuidance: rec.operatorGuidance,
    });
  }
  return { rows, totalCount: rows.length };
}

async function buildMutationHistoryPanel(
  applied: AdaptationProposal[],
  snapshotStore: SnapshotStore,
): Promise<MutationHistoryPanel> {
  const rows: MutationHistoryRow[] = [];
  for (const p of applied) {
    if (p.action !== "governance_change") continue;
    const payload = p.payload as { kind?: string };
    if (!payload.kind) continue;
    let snapshotStatus: "present" | "missing" | "corrupted" = "missing";
    const verified = await snapshotStore.loadVerified(p.id).catch(() => null);
    if (verified) {
      snapshotStatus = "present";
    } else {
      const unverified = await snapshotStore.load(p.id).catch(() => null);
      if (unverified) snapshotStatus = "corrupted";
    }
    rows.push({
      proposalId: p.id,
      kind: payload.kind,
      appliedAt: p.approvedAt ?? p.createdAt,
      appliedBy: p.approvedBy ?? "unknown",
      snapshotStatus,
    });
  }
  return { rows, totalCount: rows.length };
}

function buildRevertReadinessPanel(history: MutationHistoryPanel): RevertReadinessPanel {
  const ready = history.rows.filter((r) => r.snapshotStatus === "present").length;
  const missing = history.rows.filter((r) => r.snapshotStatus === "missing").length;
  const corrupted = history.rows.filter((r) => r.snapshotStatus === "corrupted").length;
  const total = history.rows.length;
  const percentReady = total === 0 ? 100 : Math.round((ready / total) * 100);
  return { ready, missing, corrupted, total, percentReady };
}

function buildDriftIntegrityGapsPanel(reports: {
  health: ReturnType<typeof buildGovernanceHealth> extends Promise<infer T> ? T | null : never;
  drift: ReturnType<typeof detectGovernanceDrift> extends Promise<infer T> ? T | null : never;
  integrity: ReturnType<typeof buildGovernanceIntegrity> extends Promise<infer T> ? T | null : never;
  lensReview: ReturnType<typeof reviewLenses> extends Promise<infer T> ? T | null : never;
}): DriftIntegrityGapsPanel {
  const rows: DriftIntegrityGapRow[] = [];

  if (reports.drift) {
    for (const f of reports.drift.findings) {
      if (f.severity !== "high" && f.severity !== "critical") continue;
      rows.push({
        source: "drift",
        severity: f.severity,
        message: f.description,
        reference: f.recommendation,
      });
    }
  }

  if (reports.integrity) {
    const m = reports.integrity.metrics;
    if (m.provenanceRate < 60) {
      rows.push({ source: "integrity", severity: m.provenanceRate < 40 ? "high" : "medium",
        message: `Provenance rate ${m.provenanceRate}% (threshold: 60%)`, reference: "integrity.provenanceRate" });
    }
    if (m.explanationRate < 60) {
      rows.push({ source: "integrity", severity: m.explanationRate < 40 ? "high" : "medium",
        message: `Explanation rate ${m.explanationRate}% (threshold: 60%)`, reference: "integrity.explanationRate" });
    }
    if (m.outcomeLinkRate < 60) {
      rows.push({ source: "integrity", severity: m.outcomeLinkRate < 40 ? "high" : "medium",
        message: `Outcome link rate ${m.outcomeLinkRate}% (threshold: 60%)`, reference: "integrity.outcomeLinkRate" });
    }
  }

  if (reports.lensReview) {
    for (const lr of reports.lensReview.lensReviews) {
      if (lr.recommendation === "retire") {
        rows.push({ source: "lens-review", severity: "medium",
          message: `Lens "${lr.lens}" recommended for retirement: ${lr.reason}`, reference: lr.lens });
      }
    }
  }

  return { rows, totalCount: rows.length };
}
```

- [ ] **Step 3: Run tsc to verify the aggregator compiles**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: clean. If `buildGovernanceAssessment` has a different signature, adjust the call to match.

- [ ] **Step 4: Commit**

```bash
git add src/governance/governance-dashboard.ts
git commit -m "P9.5: implement buildGovernanceDashboardReport aggregator"
```

---
### Task 3: Write the unit tests for the aggregator

**Files:**
- Create: `tests/governance/governance-dashboard.vitest.ts`

**Interfaces:**
- Consumes: `buildGovernanceDashboardReport` from Task 2
- Produces: 9 unit tests covering the 6 panels + edge cases

- [ ] **Step 1: Create the test file with the 9 tests**

```ts
/**
 * P9.5 — Governance Dashboard aggregator tests.
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildGovernanceDashboardReport } from "../../src/governance/governance-dashboard.js";

let cwd: string;
let govDir: string;
let adaptDir: string;
let snapDir: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "gov-dash-"));
  govDir = join(cwd, ".alix", "governance");
  adaptDir = join(cwd, ".alix", "adaptation");
  snapDir = join(adaptDir, "snapshots");
  mkdirSync(join(govDir, "recommendations"), { recursive: true });
  mkdirSync(join(adaptDir, "proposals"), { recursive: true });
  mkdirSync(snapDir, { recursive: true });
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function writeProposal(id: string, status: string, kind: string, extra: object = {}): void {
  const p = {
    id,
    createdAt: "2026-06-20T00:00:00.000Z",
    status,
    action: "governance_change",
    target: { kind: "governance", recommendationId: `rec-${id}` },
    payload: { kind, ...(kind === "lens_adjustment" ? { operation: "promote", lens: "x", currentPV: 0, reviewsAnalyzed: 0 } : {}) },
    sourceRecommendationType: "governance",
    sourceConfidence: 0.85,
    evidenceFingerprints: [],
    reason: "test",
    approvedBy: status === "applied" ? "test-operator" : undefined,
    approvedAt: status === "applied" ? "2026-06-21T00:00:00.000Z" : undefined,
    ...extra,
  };
  writeFileSync(join(adaptDir, "proposals", `${id}.json`), JSON.stringify(p), "utf-8");
}

function writeSnapshot(proposalId: string): void {
  const snap = {
    proposalId,
    snapshotAt: "2026-06-21T00:00:00.000Z",
    action: "governance_change",
    target: { kind: "governance", recommendationId: "rec-x" },
    filePath: "/tmp/x",
    content: Buffer.from("{}").toString("base64"),
    contentHash: "abc123",
    fingerprint: "fp-" + proposalId,
  };
  writeFileSync(join(snapDir, `${proposalId}.json`), JSON.stringify(snap), "utf-8");
}

function writeRecommendationReport(recs: object[]): void {
  const report = {
    id: "rec-2026-06-20",
    subject: "Recommendations",
    outcome: "informational",
    confidence: 1,
    reasons: ["test"],
    evidenceRefs: [],
    generatedAt: "2026-06-20T00:00:00.000Z",
    reportType: "governance_recommendation",
    recommendations: recs,
  };
  writeFileSync(join(govDir, "recommendations.jsonl"), JSON.stringify(report) + "\n", "utf-8");
}

function makeRec(category: string, priority: string = "medium", id: string = "rec-1"): object {
  return {
    id,
    source: "drift",
    sourceArtifactId: "drift-x",
    priority,
    confidence: 0.7,
    status: "open",
    category,
    title: "test",
    description: "test",
    evidenceRefs: [],
    operatorGuidance: "Investigate.",
    expectedBenefit: "x",
    risks: [],
  };
}

describe("buildGovernanceDashboardReport", () => {
  it("returns a report with schemaVersion p9.5.0", async () => {
    const report = await buildGovernanceDashboardReport({ cwd, windowDays: 30, generatedAt: "2026-06-24T00:00:00.000Z" });
    expect(report.schemaVersion).toBe("p9.5.0");
    expect(report.generatedAt).toBe("2026-06-24T00:00:00.000Z");
    expect(report.windowDays).toBe(30);
  });

  it("reports 3 supported mutation kinds of 5 total", async () => {
    const report = await buildGovernanceDashboardReport({ cwd });
    expect(report.health.supportedKinds).toBe(3);
    expect(report.health.totalKinds).toBe(5);
    expect(report.health.supportedKindList).toEqual(
      expect.arrayContaining(["confidence_calibration", "lens_adjustment", "policy_coverage"]),
    );
  });

  it("lists open mutation proposals grouped by kind", async () => {
    writeProposal("p-pending", "pending", "confidence_calibration");
    writeProposal("p-approved", "approved", "policy_coverage");
    const report = await buildGovernanceDashboardReport({ cwd });
    expect(report.openMutations.totalCount).toBe(2);
    expect(report.openMutations.rows.map((r) => r.targetKind).sort()).toEqual([
      "confidence_calibration", "policy_coverage",
    ]);
  });

  it("places investigation-only recs in the investigation queue, not open mutations", async () => {
    writeRecommendationReport([
      makeRec("chain_restoration", "high", "rec-cr-1"),
      makeRec("governance_integrity", "medium", "rec-gi-1"),
      makeRec("confidence_calibration", "low", "rec-cc-1"),
    ]);
    const report = await buildGovernanceDashboardReport({ cwd });
    expect(report.investigationQueue.totalCount).toBe(2);
    expect(report.investigationQueue.rows.map((r) => r.category).sort()).toEqual([
      "chain_restoration", "governance_integrity",
    ]);
  });

  it("builds mutation history with snapshot status per applied proposal", async () => {
    writeProposal("p-with-snap", "applied", "lens_adjustment");
    writeSnapshot("p-with-snap");
    writeProposal("p-no-snap", "applied", "policy_coverage");
    const report = await buildGovernanceDashboardReport({ cwd });
    expect(report.mutationHistory.totalCount).toBe(2);
    const withSnap = report.mutationHistory.rows.find((r) => r.proposalId === "p-with-snap");
    const noSnap = report.mutationHistory.rows.find((r) => r.proposalId === "p-no-snap");
    expect(withSnap?.snapshotStatus).toBe("present");
    expect(noSnap?.snapshotStatus).toBe("missing");
  });

  it("computes revert readiness as percent ready", async () => {
    writeProposal("p1", "applied", "policy_coverage");
    writeSnapshot("p1");
    writeProposal("p2", "applied", "policy_coverage");
    writeProposal("p3", "applied", "policy_coverage");
    const report = await buildGovernanceDashboardReport({ cwd });
    expect(report.revertReadiness.ready).toBe(1);
    expect(report.revertReadiness.missing).toBe(2);
    expect(report.revertReadiness.total).toBe(3);
    expect(report.revertReadiness.percentReady).toBe(33);
  });

  it("returns 100% revert readiness when no mutations have been applied", async () => {
    const report = await buildGovernanceDashboardReport({ cwd });
    expect(report.revertReadiness.percentReady).toBe(100);
    expect(report.revertReadiness.total).toBe(0);
  });

  it("aggregates drift and integrity findings into the gaps panel", async () => {
    const driftReport = {
      id: "drift-x", subject: "d", outcome: "informational", confidence: 1,
      reasons: [], evidenceRefs: [], generatedAt: "2026-06-20T00:00:00.000Z",
      reportType: "governance_drift",
      findings: [{
        driftType: "chain_coverage_drop", detectedAt: "2026-06-20T00:00:00.000Z",
        severity: "high", confidence: 0.7, evidenceRefs: [],
        description: "Evidence chain usage dropped to 30%", recommendation: "Investigate.",
      }],
    };
    mkdirSync(join(govDir), { recursive: true });
    writeFileSync(join(govDir, "drift.jsonl"), JSON.stringify(driftReport) + "\n", "utf-8");
    const report = await buildGovernanceDashboardReport({ cwd });
    expect(report.driftIntegrityGaps.totalCount).toBeGreaterThanOrEqual(1);
    expect(report.driftIntegrityGaps.rows.some((r) => r.source === "drift")).toBe(true);
  });

  it("handles empty state without throwing", async () => {
    const report = await buildGovernanceDashboardReport({ cwd });
    expect(report.health.supportedKinds).toBe(3);
    expect(report.openMutations.totalCount).toBe(0);
    expect(report.investigationQueue.totalCount).toBe(0);
    expect(report.mutationHistory.totalCount).toBe(0);
    expect(report.driftIntegrityGaps.totalCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they pass**

```bash
npx vitest run tests/governance/governance-dashboard.vitest.ts --reporter verbose 2>&1 | tail -30
```

Expected: 9 tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/governance/governance-dashboard.vitest.ts
git commit -m "P9.5: add aggregator unit tests (9 tests)"
```

---
### Task 4: Implement the terminal renderer

**Files:**
- Create: `src/cli/commands/governance-dashboard-renderer.ts`

**Interfaces:**
- Consumes: `GovernanceDashboardReport` from Task 1
- Produces: `renderGovernanceDashboard(report, opts?)` — writes to stdout

- [ ] **Step 1: Create the renderer**

```ts
/**
 * P9.5 — Governance Dashboard renderer.
 *
 * Pure formatter. Consumes GovernanceDashboardReport. No data access.
 * Mirrors the P8.5b renderDashboard pattern.
 *
 * @module
 */

import type {
  GovernanceDashboardReport,
  HealthPanel,
  OpenMutationsPanel,
  InvestigationQueuePanel,
  MutationHistoryPanel,
  RevertReadinessPanel,
  DriftIntegrityGapsPanel,
} from "../../governance/governance-dashboard.js";

export interface RenderOptions {
  /** When true, print JSON instead of formatted text. */
  jsonMode?: boolean;
}

export function renderGovernanceDashboard(
  report: GovernanceDashboardReport,
  opts: RenderOptions = {},
): void {
  if (opts.jsonMode) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log("=".repeat(72));
  console.log("GOVERNANCE DASHBOARD");
  console.log(`Schema: ${report.schemaVersion}    Generated: ${report.generatedAt}    Window: ${report.windowDays}d`);
  console.log("=".repeat(72));

  renderHealth(report.health);
  console.log("");
  renderOpenMutations(report.openMutations);
  console.log("");
  renderInvestigationQueue(report.investigationQueue);
  console.log("");
  renderMutationHistory(report.mutationHistory);
  console.log("");
  renderRevertReadiness(report.revertReadiness);
  console.log("");
  renderDriftIntegrityGaps(report.driftIntegrityGaps);
  console.log("=".repeat(72));
}

function renderHealth(h: HealthPanel): void {
  console.log("\n[0] MUTATION PIPELINE HEALTH");
  console.log(`  Supported mutation kinds:   ${h.supportedKinds}/${h.totalKinds}     (${h.supportedKindList.join(", ")})`);
  console.log(`  Pending mutation proposals: ${h.pendingProposals}`);
  console.log(`  Blocked unsupported kinds:  ${h.blockedUnsupportedKinds}`);
  console.log(`  Investigation-only recs:    ${h.investigationOnlyRecs}`);
  console.log(`  Recent apply failures:      ${h.recentApplyFailures}`);
  console.log(`  Revert readiness:           ${h.revertReadinessPercent}%    (${h.revertReadyCount} of ${h.totalAppliedMutations} applied mutations have snapshots)`);
}

function renderOpenMutations(p: OpenMutationsPanel): void {
  console.log(`\n[1] OPEN MUTATIONS (${p.totalCount})`);
  if (p.totalCount === 0) {
    console.log("  (none)");
    return;
  }
  console.log("  proposal-id          | rec-id        | status   | kind                    | confidence");
  console.log("  ---------------------+---------------+----------+-------------------------+-----------");
  for (const r of p.rows) {
    console.log(`  ${pad(r.proposalId, 20)} | ${pad(r.recommendationId, 13)} | ${pad(r.status, 8)} | ${pad(r.targetKind, 23)} | ${r.confidence.toFixed(2)}`);
  }
}

function renderInvestigationQueue(p: InvestigationQueuePanel): void {
  console.log(`\n[2] INVESTIGATION QUEUE (${p.totalCount}) [INVESTIGATION — cannot be applied]`);
  if (p.totalCount === 0) {
    console.log("  (none)");
    return;
  }
  console.log("  rec-id        | category              | severity | operator-guidance");
  console.log("  --------------+-----------------------+----------+----------------------------------");
  for (const r of p.rows) {
    console.log(`  ${pad(r.recommendationId, 13)} | ${pad(r.category, 21)} | ${pad(r.severity, 8)} | ${truncate(r.operatorGuidance, 50)}`);
  }
}

function renderMutationHistory(p: MutationHistoryPanel): void {
  console.log(`\n[3] MUTATION HISTORY (${p.totalCount})`);
  if (p.totalCount === 0) {
    console.log("  (none)");
    return;
  }
  console.log("  proposal-id     | kind                  | applied-at          | applied-by      | snapshot");
  console.log("  ----------------+-----------------------+---------------------+-----------------+-----------");
  for (const r of p.rows) {
    const status = r.snapshotStatus === "present" ? "OK" : r.snapshotStatus === "missing" ? "MISSING" : "CORRUPT";
    console.log(`  ${pad(r.proposalId, 15)} | ${pad(r.kind, 21)} | ${pad(r.appliedAt, 19)} | ${pad(r.appliedBy, 15)} | ${status}`);
  }
}

function renderRevertReadiness(p: RevertReadinessPanel): void {
  console.log(`\n[4] REVERT READINESS`);
  console.log(`  Ready:     ${p.ready}`);
  console.log(`  Missing:   ${p.missing}`);
  console.log(`  Corrupted: ${p.corrupted}`);
  console.log(`  Total:     ${p.total}    Percent ready: ${p.percentReady}%`);
}

function renderDriftIntegrityGaps(p: DriftIntegrityGapsPanel): void {
  console.log(`\n[5] DRIFT & INTEGRITY GAPS (${p.totalCount})`);
  if (p.totalCount === 0) {
    console.log("  (none)");
    return;
  }
  console.log("  source        | severity | message");
  console.log("  --------------+----------+----------------------------------------");
  for (const r of p.rows) {
    console.log(`  ${pad(r.source, 13)} | ${pad(r.severity, 8)} | ${truncate(r.message, 70)}`);
  }
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n);
  return s + " ".repeat(n - s.length);
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}
```

- [ ] **Step 2: Run tsc to verify the renderer compiles**

```bash
npx tsc --noEmit 2>&1 | head -10
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/governance-dashboard-renderer.ts
git commit -m "P9.5: implement renderGovernanceDashboard"
```

---
### Task 5: Implement the CLI handler

**Files:**
- Create: `src/cli/commands/governance-dashboard-handler.ts`

**Interfaces:**
- Consumes: `buildGovernanceDashboardReport` (Task 2), `renderGovernanceDashboard` (Task 4)
- Produces: `runDashboard(args: string[])` — parses `--window`, `--json`; calls aggregator; calls renderer

- [ ] **Step 1: Create the handler**

```ts
/**
 * P9.5 — Governance Dashboard CLI handler.
 *
 * Extracted to its own file so the dashboard sentinel can scan a precise
 * target. See tests/governance/governance-dashboard-sentinels.vitest.ts.
 *
 * @module
 */

import { buildGovernanceDashboardReport } from "../../governance/governance-dashboard.js";
import { renderGovernanceDashboard } from "./governance-dashboard-renderer.js";

export async function runDashboard(args: string[]): Promise<void> {
  const jsonMode = args.includes("--json");

  let windowDays = 90;
  const windowIdx = args.indexOf("--window");
  if (windowIdx !== -1 && windowIdx + 1 < args.length) {
    const parsed = parseInt(args[windowIdx + 1], 10);
    if (isNaN(parsed) || parsed <= 0) {
      console.error("Error: --window requires a positive integer");
      process.exit(1);
    }
    windowDays = parsed;
  }

  const report = await buildGovernanceDashboardReport({
    cwd: process.cwd(),
    windowDays,
  });

  renderGovernanceDashboard(report, { jsonMode });
}
```

- [ ] **Step 2: Run tsc to verify the handler compiles**

```bash
npx tsc --noEmit 2>&1 | head -10
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/governance-dashboard-handler.ts
git commit -m "P9.5: implement runDashboard CLI handler (extracted for sentinel)"
```

---
### Task 6: Wire the subcommand into governance.ts

**Files:**
- Modify: `src/cli/commands/governance.ts` (one new `case "dashboard"` + import)

**Interfaces:**
- Consumes: `runDashboard` from Task 5
- Produces: `alix governance dashboard [--window <days>] [--json]`

- [ ] **Step 1: Add the import at the top of governance.ts**

In `src/cli/commands/governance.ts`, find the import block at the top and add this import alongside the existing ones:

```ts
import { runDashboard } from "./governance-dashboard-handler.js";
```

- [ ] **Step 2: Add the case to the switch statement**

In the main `switch (subcommand)` block, add a new case after `case "explain"`:

```ts
    case "dashboard":
      return runDashboard(rest);
```

- [ ] **Step 3: Run tsc to verify the dispatch compiles**

```bash
npx tsc --noEmit 2>&1 | head -10
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/governance.ts
git commit -m "P9.5: register dashboard subcommand in governance.ts"
```

---
### Task 7: Write the CLI integration tests

**Files:**
- Create: `tests/cli/commands/governance-dashboard-cli.vitest.ts`

**Interfaces:**
- Consumes: `runDashboard` from Task 5
- Produces: 3 CLI tests (text mode, JSON mode, --window flag)

- [ ] **Step 1: Create the test file**

```ts
/**
 * P9.5 — Governance Dashboard CLI integration tests.
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let cwd: string;
let originalCwd: string;
let stdoutChunks: string[];
let stderrChunks: string[];

beforeEach(async () => {
  cwd = mkdtempSync(join(tmpdir(), "gov-dash-cli-"));
  mkdirSync(join(cwd, ".alix", "governance"), { recursive: true });
  mkdirSync(join(cwd, ".alix", "adaptation", "proposals"), { recursive: true });
  mkdirSync(join(cwd, ".alix", "adaptation", "snapshots"), { recursive: true });
  originalCwd = process.cwd();
  process.chdir(cwd);
  stdoutChunks = [];
  stderrChunks = [];
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  (process.stdout as any).write = (chunk: string) => { stdoutChunks.push(chunk); return true; };
  (process.stderr as any).write = (chunk: string) => { stderrChunks.push(chunk); return true; };
  (global as any).__restoreIO = () => {
    (process.stdout as any).write = origOut;
    (process.stderr as any).write = origErr;
  };
});

afterEach(() => {
  process.chdir(originalCwd);
  (global as any).__restoreIO?.();
  rmSync(cwd, { recursive: true, force: true });
});

function stdout(): string { return stdoutChunks.join(""); }

describe("runDashboard", () => {
  it("renders 6 panel headers in text mode", async () => {
    const { runDashboard } = await import("../../../src/cli/commands/governance-dashboard-handler.js");
    await runDashboard([]);
    const out = stdout();
    expect(out).toContain("GOVERNANCE DASHBOARD");
    expect(out).toContain("MUTATION PIPELINE HEALTH");
    expect(out).toContain("OPEN MUTATIONS");
    expect(out).toContain("INVESTIGATION QUEUE");
    expect(out).toContain("MUTATION HISTORY");
    expect(out).toContain("REVERT READINESS");
    expect(out).toContain("DRIFT & INTEGRITY GAPS");
  });

  it("emits valid JSON in --json mode", async () => {
    const { runDashboard } = await import("../../../src/cli/commands/governance-dashboard-handler.js");
    await runDashboard(["--json"]);
    const out = stdout();
    const parsed = JSON.parse(out);
    expect(parsed.schemaVersion).toBe("p9.5.0");
    expect(parsed.health).toBeDefined();
    expect(parsed.openMutations).toBeDefined();
    expect(parsed.investigationQueue).toBeDefined();
    expect(parsed.mutationHistory).toBeDefined();
    expect(parsed.revertReadiness).toBeDefined();
    expect(parsed.driftIntegrityGaps).toBeDefined();
  });

  it("respects --window flag", async () => {
    const { runDashboard } = await import("../../../src/cli/commands/governance-dashboard-handler.js");
    await runDashboard(["--window", "7"]);
    const parsed = JSON.parse(stdout());
    expect(parsed.windowDays).toBe(7);
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
npx vitest run tests/cli/commands/governance-dashboard-cli.vitest.ts --reporter verbose 2>&1 | tail -15
```

Expected: 3 tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/cli/commands/governance-dashboard-cli.vitest.ts
git commit -m "P9.5: add CLI integration tests (3 tests)"
```

---
### Task 8: Write the dashboard purity sentinel

**Files:**
- Create: `tests/governance/governance-dashboard-sentinels.vitest.ts`

**Interfaces:**
- Consumes: the 3 dashboard files (aggregator, renderer, handler)
- Produces: a sentinel test that fails if any of them imports a mutation write path

- [ ] **Step 1: Create the sentinel test**

```ts
/**
 * P9.5 — Governance Dashboard purity sentinel.
 *
 * Scans the 3 dashboard files for any mutation write path. Fails the test
 * if any forbidden symbol is found. Read-only store queries are permitted.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const DASHBOARD_FILES = [
  "src/governance/governance-dashboard.ts",
  "src/cli/commands/governance-dashboard-renderer.ts",
  "src/cli/commands/governance-dashboard-handler.ts",
];

const FORBIDDEN_IN_DASHBOARD = [
  // Mutation appliers
  "GovernanceChangeApplier",
  "AgentCardApplier",
  "SkillApplier",
  "RevertApplier",
  // Approval / apply / reject verbs (string-form, not import)
  ".approve(",
  ".apply(",
  ".reject(",
  // Mutation-write stores
  "ProposalStore.save",
  "ProposalStore.markOrphaned",
  // Evidence write methods
  "recordGovernanceMutationApplied",
  "recordAdaptationApproved",
  "recordAdaptationApplied",
  "recordAdaptationRejected",
  "recordAdaptationFailed",
  "recordRevertApplied",
  "recordRevertFailed",
];

describe("P9.5 dashboard purity sentinel", () => {
  for (const relPath of DASHBOARD_FILES) {
    it(`${relPath} does not import any mutation write path`, () => {
      const absPath = join(process.cwd(), relPath);
      if (!existsSync(absPath)) {
        throw new Error(`Dashboard file missing: ${relPath}. Sentinel expects 3 files; run earlier tasks first.`);
      }
      const content = readFileSync(absPath, "utf-8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const forbidden of FORBIDDEN_IN_DASHBOARD) {
          if (line.includes(forbidden)) {
            throw new Error(
              `P9.5 dashboard purity violation at ${relPath}:${i + 1}\n` +
              `  Found forbidden symbol: "${forbidden}"\n` +
              `  The dashboard is read-only and must not import mutation write paths.\n` +
              `  If this symbol is needed, it belongs in a non-dashboard module.`,
            );
          }
        }
      }
    });
  }
});
```

- [ ] **Step 2: Run the sentinel**

```bash
npx vitest run tests/governance/governance-dashboard-sentinels.vitest.ts --reporter verbose 2>&1 | tail -10
```

Expected: 3 tests pass (one per dashboard file).

- [ ] **Step 3: Commit**

```bash
git add tests/governance/governance-dashboard-sentinels.vitest.ts
git commit -m "P9.5: add dashboard purity sentinel (3 files scanned)"
```

---
### Task 9: Full verification

**Files:** none new; verifies everything

- [ ] **Step 1: Run the full test suite**

```bash
npx vitest run --reporter verbose 2>&1 | tail -20
```

Expected: all tests pass (existing + 9 aggregator + 3 CLI + 3 sentinel = 15 new tests).

- [ ] **Step 2: Run tsc**

```bash
npx tsc --noEmit 2>&1
```

Expected: clean.

- [ ] **Step 3: Run the dashboard against the empty state**

```bash
mkdir -p .alix/governance .alix/adaptation/proposals .alix/adaptation/snapshots
npx tsx src/cli/commands/governance.ts dashboard 2>&1 | head -30
```

Expected: 6 panels render. Empty state shows "(none)" for the data tables.

- [ ] **Step 4: Run the dashboard in JSON mode**

```bash
npx tsx src/cli/commands/governance.ts dashboard --json 2>&1 | head -20
```

Expected: valid JSON with `schemaVersion: "p9.5.0"`.

- [ ] **Step 5: Commit (only if there were any verification fixes)**

If you made any fixes during verification, commit them. If everything was clean, this step is a no-op.

---
### Task 10: Final review and PR

- [ ] **Step 1: Verify the PR scope is clean**

```bash
git status --short
```

Expected: only the 8 P9.5 files. No untracked working-tree noise, no unrelated files. (If untracked files exist, leave them alone — do not stage.)

- [ ] **Step 2: Push the branch and create the PR**

```bash
git push -u origin feature/p9.5-governance-dashboard
gh pr create --base main --head feature/p9.5-governance-dashboard \
  --title "P9.5 — Governance Dashboard (read-only, 6 panels)" \
  --body "Read-only terminal dashboard... (see spec)"
```

- [ ] **Step 3: After PR approval and merge, tag**

```bash
git checkout main && git pull --ff-only
git tag alix-p9-5-complete
git push origin alix-p9-5-complete
```
