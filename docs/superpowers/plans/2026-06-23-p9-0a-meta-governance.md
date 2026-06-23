# P9.0a — Meta-Governance (Analysis Layer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build P9.0 — the read-only governance analysis layer that consumes P8 outputs (persistence stores, Explain assembler, Dashboard aggregator, EvidenceChainStore, LearningStore) and produces 5 analysis artifact types: GovernanceHealthReport, GovernanceAssessment, GovernanceDriftReport, LensLifecycleReview, GovernanceIntegrityReport.

**Architecture:** Pure read-only analysis. 6 builders, each consuming specific P8 outputs via existing interfaces. Outputs stored in GovernanceStore (append-only JSONL, per-artifact JSONL files). A single CLI surface (`alix governance {health,drift,lens-review,integrity}`) renders results. P9.0 generates NO proposals — analysis artifacts only, verified by purity sentinel.

**Tech Stack:** TypeScript, vitest, node:fs (append-only write to GovernanceStore only).

## Global Constraints

- **P9 may write only GovernanceStore.** All 6 P8 stores are explicitly forbidden: OutcomeStore, RecommendationStore, RiskScoreStore, GovernanceReviewStore, LearningStore, EvidenceChainStore. Sentinel-enforced.
- **P9.0 produces reports only, not proposals.** No ProposalStore, no ApprovalGate, no appliers, no AutomaticProposalGenerator imports. Self-mutation risk structurally eliminated.
- **P9 builders consume stores, explain assemblers, and dashboard aggregators only.** No CLI renderers, no terminal formatters, no dashboard presentation code in builders.
- **GovernanceStore uses per-artifact JSONL files:** `health.jsonl`, `assessment.jsonl`, `drift.jsonl`, `lens-reviews.jsonl`, `integrity.jsonl`. Applies existing P7.5p JSONL patterns.
- **6 protected type files remain byte-identical to main:** `risk-score-types.ts`, `governance-review-types.ts`, `adaptation-types.ts`, `decision-types.ts`, `learning-types.ts`, `outcome-types.ts`. The new `governance-types.ts` is a NEW file.
- **Existing test patterns:** mirror `risk-score-store.vitest.ts` for temp-dir JSONL writing; mirror `learning-dashboard.vitest.ts` for builder tests with store seeding + vi.spyOn(process, "cwd").

---

## File Structure

| Path | Purpose |
|---|---|
| `src/governance/governance-types.ts` (new) | 5 report types + helpers. Pure types, no runtime. |
| `src/governance/governance-store.ts` (new) | Append-only JSONL store (5 files, per artifact type). Mirror P7.5p pattern. |
| `src/governance/governance-health-builder.ts` (new) | Pure: reads DashboardReport + LearningStore + GovernanceReviewStore + OutcomeStore → HealthReport; Assessment consumes HealthReport only |
| `src/governance/governance-integrity.ts` (new) | Pure: reads EvidenceChain + ProposalExplanation + GovernanceReviewStore → IntegrityReport |
| `src/governance/governance-drift-detector.ts` (new) | Pure: reads LearningSignals + Dashboard metrics → DriftReport |
| `src/governance/governance-lens-review.ts` (new) | Pure: reads LearningStore calibration profiles → LensLifecycleReview |
| `src/cli/commands/governance.ts` (new) | CLI dispatcher + terminal renderer |
| `tests/governance/governance-store.vitest.ts` (new) | Store tests |
| `tests/governance/governance-health-builder.vitest.ts` (new) | Health builder tests |
| `tests/governance/governance-integrity.vitest.ts` (new) | Integrity builder tests |
| `tests/governance/governance-drift-detector.vitest.ts` (new) | Drift detector tests |
| `tests/governance/governance-lens-review.vitest.ts` (new) | Lens review tests |
| `tests/governance/governance-sentinels.vitest.ts` (new) | Purity sentinel |
| `tests/cli/commands/governance-cli.vitest.ts` (new) | CLI tests |

---

## Task Decomposition (6 tasks, per P9.0a-0f)

Recommended execution order: Infrastructure → Integrity → Health → Drift → Lens → CLI.
Integrity first because it validates the provenance substrate; everything else builds on that.

### Task 1: P9.0a — Infrastructure (types + store + sentinel)

**Files:**
- Create: `src/governance/governance-types.ts`
- Create: `src/governance/governance-store.ts`
- Create: `tests/governance/governance-store.vitest.ts`

**Step-by-step:**

- [ ] **Step 1: Create `src/governance/governance-types.ts`**

All 5 report type interfaces from the SDS. Pure types, no runtime. Import `DecisionArtifact` from `../adaptation/decision-types.js`, `LensName` from `../adaptation/governance-review-types.js`.

```ts
import type { DecisionArtifact } from "../adaptation/decision-types.js";
import type { LensName } from "../adaptation/governance-review-types.js";

export interface GovernanceHealthReport extends DecisionArtifact {
  reportType: "governance_health";
  totalReviews: number;
  totalProposals: number;
  lensEffectiveness: Record<string, number>;
  policyCoverage: number;
  sourceMetrics: {
    dashboardIntegrityScore: number | null;
    explanationCompleteness: number | null;
    evidenceChainUsage: number | null;
    incompleteChainLayers: number;
  };
}

export interface GovernanceAssessment extends DecisionArtifact {
  reportType: "governance_assessment";
  governanceConfidence: number;
  unresolvedGovernanceIssues: number;
  assessmentNotes: string[];
}

export interface GovernanceDriftReport extends DecisionArtifact {
  reportType: "governance_drift";
  findings: DriftFinding[];
}

export interface DriftFinding {
  driftType: "lens_drift" | "policy_drift" | "confidence_drift" | "chain_coverage_drop";
  detectedAt: string;
  severity: "low" | "medium" | "high" | "critical";
  confidence: number;
  evidenceRefs: string[];
  description: string;
  recommendation: string;
}

export interface LensLifecycleReview extends DecisionArtifact {
  reportType: "lens_lifecycle";
  lensReviews: {
    lens: LensName;
    predictiveValue: number;
    reviewsAnalyzed: number;
    falseAlarms: number;
    missedFailures: number;
    recommendation: "keep" | "promote" | "demote" | "retire";
    reason: string;
  }[];
}

export interface GovernanceIntegrityReport extends DecisionArtifact {
  reportType: "governance_integrity";
  metrics: {
    totalReviews: number;
    reviewsWithProvenance: number;
    reviewsWithExplanations: number;
    reviewsLinkedToOutcomes: number;
    untraceableFindings: number;
    provenanceRate: number;
    explanationRate: number;
    outcomeLinkRate: number;
  };
}
```

- [ ] **Step 2: Create `src/governance/governance-store.ts`**

Append-only JSONL store with per-artifact JSONL files. Mirrors the P7.5p store pattern but with 5 files instead of 1:

```ts
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const STORE_DIR = join(".alix", "governance");

const FILES: Record<string, string> = {
  health: "health.jsonl",
  assessment: "assessment.jsonl",
  drift: "drift.jsonl",
  lensReviews: "lens-reviews.jsonl",
  integrity: "integrity.jsonl",
};

type ArtifactType = keyof typeof FILES;

export class GovernanceStore {
  constructor(
    private readonly storeDir: string = join(process.cwd(), STORE_DIR),
  ) {}

  private ensureDir(): void {
    if (!existsSync(this.storeDir)) mkdirSync(this.storeDir, { recursive: true });
  }

  private filePath(type: ArtifactType): string {
    return join(this.storeDir, FILES[type]);
  }

  async append(type: "health", record: GovernanceHealthReport): Promise<void>;
  async append(type: "assessment", record: GovernanceAssessment): Promise<void>;
  async append(type: "drift", record: GovernanceDriftReport): Promise<void>;
  async append(type: "lensReviews", record: LensLifecycleReview): Promise<void>;
  async append(type: "integrity", record: GovernanceIntegrityReport): Promise<void>;
  async append(type: ArtifactType, record: any): Promise<void> {
    this.ensureDir();
    const line = JSON.stringify(record) + "\n";
    appendFileSync(this.filePath(type), line, "utf-8");
  }

  async list(type: "health"): Promise<GovernanceHealthReport[]>;
  async list(type: "assessment"): Promise<GovernanceAssessment[]>;
  async list(type: "drift"): Promise<GovernanceDriftReport[]>;
  async list(type: "lensReviews"): Promise<LensLifecycleReview[]>;
  async list(type: "integrity"): Promise<GovernanceIntegrityReport[]>;
  async list(type: ArtifactType): Promise<any[]> {
    const path = this.filePath(type);
    if (!existsSync(path)) return [];
    const raw = readFileSync(path, "utf-8");
    const results: any[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try { results.push(JSON.parse(trimmed)); } catch { /* skip corrupt */ }
    }
    return results;
  }

  async queryByWindow(type: ArtifactType, windowDays: number): Promise<any[]> {
    const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
    const all = await this.list(type);
    return all.filter((r) => new Date(r.generatedAt).getTime() >= cutoff);
  }
}
```

- [ ] **Step 3: Write store test**

```ts
// tests/governance/governance-store.vitest.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GovernanceStore } from "../../src/governance/governance-store.js";

let cwdSpy: ReturnType<typeof vi.spyOn>;
let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "gov-store-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
});
afterEach(() => { cwdSpy.mockRestore(); rmSync(tempRoot, { recursive: true, force: true }); });

describe("GovernanceStore", () => {
  it("appends and lists health records", async () => {
    const store = new GovernanceStore();
    await store.append("health", {
      id: "health-1", subject: "Health", outcome: "computed", confidence: 0.9, reasons: [],
      generatedAt: "2026-06-23T00:00:00.000Z",
      reportType: "governance_health", totalReviews: 10, totalProposals: 5,
      lensEffectiveness: { red_team: 0.72 }, policyCoverage: 85,
      sourceMetrics: { dashboardIntegrityScore: 92, explanationCompleteness: 83.3, evidenceChainUsage: 81, incompleteChainLayers: 0 },
      evidenceRefs: [],
    } as any);
    const records = await store.list("health");
    expect(records.length).toBe(1);
    expect(records[0].totalReviews).toBe(10);
  });

  it("appends and lists drift records", async () => { /* similar pattern */ });
  it("appends and lists integrity records", async () => { /* similar pattern */ });
  it("returns empty list for missing file", async () => {
    const store = new GovernanceStore();
    expect(await store.list("health")).toEqual([]);
  });
});
```

- [ ] **Step 4: Run + commit**

Run: `npx vitest run tests/governance/governance-store.vitest.ts && npx tsc --noEmit`
Expected: all pass, tsc clean.

```bash
git add src/governance/governance-types.ts src/governance/governance-store.ts tests/governance/governance-store.vitest.ts
git commit -m "feat(p9.0a): governance types + store (5 artifact JSONL files)"
```

---

### Task 2: P9.0c — GovernanceIntegrityBuilder

**Files:**
- Create: `src/governance/governance-health-builder.ts`
- Create: `src/governance/governance-assessment.ts`
- Create: `tests/governance/governance-health-builder.vitest.ts`

**Step-by-step:**

- [ ] **Step 1: Write failing tests**

```ts
// tests/governance/governance-health-builder.vitest.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildGovernanceHealth } from "../../src/governance/governance-health-builder.js";
import { buildGovernanceAssessment } from "../../src/governance/governance-assessment.js";

let cwdSpy: ReturnType<typeof vi.spyOn>;
let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "gov-health-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
});
afterEach(() => { cwdSpy.mockRestore(); rmSync(tempRoot, { recursive: true, force: true }); });

describe("buildGovernanceHealth", () => {
  it("returns empty health report when no P8 data exists", async () => {
    const report = await buildGovernanceHealth({ cwd: tempRoot, windowDays: 90 });
    expect(report.totalReviews).toBe(0);
    expect(report.totalProposals).toBe(0);
    expect(report.sourceMetrics.dashboardIntegrityScore).toBe(0);
  });
});

describe("buildGovernanceAssessment", () => {
  it("returns low confidence from a GovernanceHealthReport", async () => {
    // Assessment consumes the health report, not stores — preserves objective → interpretation separation.
    const report = await buildGovernanceHealth({ cwd: tempRoot, windowDays: 90 });
    const assessment = buildGovernanceAssessment(report);
    expect(assessment.governanceConfidence).toBeLessThanOrEqual(1);
    expect(assessment.unresolvedGovernanceIssues).toBe(0);
  });
});
```

- [ ] **Step 2: Implement `governance-health-builder.ts`**

Consumes:
- `buildDashboardReport` (from `learning/learning-dashboard.js`) → aggregated integrity + dashboardIntegrityScore
- `GovernanceReviewStore.queryByWindow(windowDays)` → totalReviews
- Count from OutcomeStore for totalProposals (unique subjectIds). Uses operationally-observed proposals only — proposals that never reach an outcome are outside the governed surface.
- Per-lens predictiveValue from calibration profiles in LearningStore

Returns `GovernanceHealthReport` with objective measurements only.

- [ ] **Step 3: Implement `governance-assessment.ts`**

Consumes the `GovernanceHealthReport` and interprets it:
- `governanceConfidence` = weighted function of sourceMetrics (dashboardIntegrityScore * 0.4 + explanationCompleteness/100 * 0.3 + evidenceChainUsage/100 * 0.3)
- `unresolvedGovernanceIssues` = incompleteChainLayers + totalReviews - reviewsWithOutcomes
- `assessmentNotes` = human-readable summary notes

Pure function — takes HealthReport, returns Assessment. Testable independently.

- [ ] **Step 4: Run + commit**

Run: `npx vitest run tests/governance/governance-health-builder.vitest.ts && npx tsc --noEmit`
Expected: all pass, tsc clean.

```bash
git add src/governance/governance-health-builder.ts src/governance/governance-assessment.ts tests/governance/governance-health-builder.vitest.ts
git commit -m "feat(p9.0b): governance health builder + assessment"
```

---

### Task 3: P9.0b — GovernanceHealthBuilder + Assessment

**Files:**
- Create: `src/governance/governance-integrity.ts`
- Create: `tests/governance/governance-integrity.vitest.ts`

**Step-by-step:**

- [ ] **Step 1: Write failing test**

```ts
// tests/governance/governance-integrity.vitest.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildGovernanceIntegrity } from "../../src/governance/governance-integrity.js";

let cwdSpy: ReturnType<typeof vi.spyOn>;
let tempRoot: string;
beforeEach(() => { tempRoot = mkdtempSync(join(tmpdir(), "gov-int-")); cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot); });
afterEach(() => { cwdSpy.mockRestore(); rmSync(tempRoot, { recursive: true, force: true }); });

describe("buildGovernanceIntegrity", () => {
  it("returns 0% rates when no governance reviews exist", async () => {
    const report = await buildGovernanceIntegrity({ cwd: tempRoot, windowDays: 90 });
    expect(report.metrics.totalReviews).toBe(0);
    expect(report.metrics.provenanceRate).toBe(0);
    expect(report.metrics.explanationRate).toBe(0);
    expect(report.metrics.outcomeLinkRate).toBe(0);
  });
});
```

- [ ] **Step 2: Implement `governance-integrity.ts`**

Consumes `ProposalExplanation` (Explain output) — does NOT reconstruct explanation state.

```ts
/**
 * GovernanceIntegrityBuilder consumes explanation outputs, not raw stores.
 * Reads GovernanceReviewStore for review count, then calls the Explain
 * assembler for each review's proposal. All integrity metrics derive from
 * the explanation's explanationIntegrity field:
 *
 *   - provenanceRate:  propos where explanationIntegrity.evidenceChainUsed === true
 *   - explanationRate: proposals where explanationIntegrity.totalLayers >= 1
 *   - outcomeLinkRate: proposals where explanationIntegrity.outcomeFound === true
 *   - untraceable:     none of the above
 *
 * P9 does not rebuild Explain logic. The Explain assembler is canonical.
 */
```

Metrics computed from `ProposalExplanation.explanationIntegrity`:
- `provenanceRate` = proposals where `evidenceChainUsed === true` / total
- `explanationRate` = proposals where at least 1 layer is available / total  
- `outcomeLinkRate` = proposals where `outcomeFound === true` / total
- `untraceableFindings` = proposals where none of the above

- [ ] **Step 3: Run + commit**

- [ ] **Step 3: Run + commit**

```bash
git add src/governance/governance-integrity.ts tests/governance/governance-integrity.vitest.ts
git commit -m "feat(p9.0c): governance integrity builder"
```

---

### Task 4: P9.0d — DriftDetector

**Files:**
- Create: `src/governance/governance-drift-detector.ts`
- Create: `tests/governance/governance-drift-detector.vitest.ts`

**Step-by-step:**

- [ ] **Step 1: Write failing test**

```ts
// tests/governance/governance-drift-detector.vitest.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectGovernanceDrift } from "../../src/governance/governance-drift-detector.js";

let cwdSpy: ReturnType<typeof vi.spyOn>;
let tempRoot: string;
beforeEach(() => { tempRoot = mkdtempSync(join(tmpdir(), "gov-drift-")); cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot); });
afterEach(() => { cwdSpy.mockRestore(); rmSync(tempRoot, { recursive: true, force: true }); });

describe("detectGovernanceDrift", () => {
  it("returns no findings when no signals exist", async () => {
    const report = await detectGovernanceDrift({ cwd: tempRoot, windowDays: 90 });
    expect(report.findings).toEqual([]);
  });
});
```

- [ ] **Step 2: Implement `governance-drift-detector.ts`**

Three detector functions:

**Confidence drift:** `LearningStore.querySignals({ signalTypes: ["overconfidence", "underconfidence"] })`. Calculate overconfidence ratio = overconfidence / (overconfidence + underconfidence). If ratio > 0.6 and total signals > 10, emit `confidence_drift` finding with severity scaled by ratio and `confidence` based on sample size.

**Chain coverage drop:** `buildDashboardReport().explanationIntegrity.evidenceChainUsage`. If < 60%, emit `chain_coverage_drop` finding. Severity: `warning` if within 40-60%, `high` if < 40%.

**Lens drift:** `LearningStore.queryProfiles({ windowDays })` → calculate per-lens predictive value from calibration profiles. P8 adapters already convert raw review data into calibrated observations; P9 should consume the calibrated layer, not raw governance artifacts. If any lens shows degraded predictiveValue (below 0.4), emit `lens_drift`.

Each finding includes `confidence: number` (0-1) for rankability.

- [ ] **Step 3: Run + commit**

```bash
git add src/governance/governance-drift-detector.ts tests/governance/governance-drift-detector.vitest.ts
git commit -m "feat(p9.0d): governance drift detector (confidence + chain + lens)"
```

---

### Task 5: P9.0e — LensLifecycleReview

**Files:**
- Create: `src/governance/governance-lens-review.ts`
- Create: `tests/governance/governance-lens-review.vitest.ts`

**Step-by-step:**

- [ ] **Step 1: Write failing test**

```ts
// tests/governance/governance-lens-review.vitest.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { reviewLenses } from "../../src/governance/governance-lens-review.js";

let cwdSpy: ReturnType<typeof vi.spyOn>;
let tempRoot: string;
beforeEach(() => { tempRoot = mkdtempSync(join(tmpdir(), "gov-lens-")); cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot); });
afterEach(() => { cwdSpy.mockRestore(); rmSync(tempRoot, { recursive: true, force: true }); });

describe("reviewLenses", () => {
  it("returns empty review when no calibration data exists", async () => {
    const review = await reviewLenses({ cwd: tempRoot, windowDays: 90 });
    expect(review.lensReviews).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Implement `governance-lens-review.ts`**

Consumes `LearningStore.queryProfiles({ windowDays })` for calibration profiles. P8 adapters already convert raw review data into calibrated observations; the lens review consumes the calibrated layer, not raw governance artifacts.

For each lens:
- `predictiveValue`: from calibration profile's `adjustment` or the profile's `target` field matching the lens name
- `reviewsAnalyzed`: from the calibration profile metadata or `LearningStore.querySignals({ signalTypes })` for the lens
- `falseAlarms`: reviews where lens warned but outcome was success
- `missedFailures`: reviews where lens didn't warn but outcome was failure

Thresholds (from SDS):
- PV > 0.7 and reviewsAnalyzed > 20 → `promote`
- PV < 0.4 and reviewsAnalyzed > 20 → `demote`
- PV < 0.2 and reviewsAnalyzed > 30 → `retire`
- falseAlarms > 10 and falseAlarmRate > 0.4 → `demote`
- Default: `keep`

- [ ] **Step 3: Run + commit**

```bash
git add src/governance/governance-lens-review.ts tests/governance/governance-lens-review.vitest.ts
git commit -m "feat(p9.0e): lens lifecycle review (promote/demote/retire/keep)"
```

---

### Task 6: P9.0f — CLI + sentinel + final review

**Files:**
- Create: `src/cli/commands/governance.ts` (dispatcher + renderer)
- Create: `tests/governance/governance-sentinels.vitest.ts`
- Create: `tests/cli/commands/governance-cli.vitest.ts`

**Step-by-step:**

- [ ] **Step 1: Create `src/cli/commands/governance.ts`**

Four subcommands:
- `alix governance health [--window <days>] [--json]` — runs health builder + assessment, renders
- `alix governance drift [--window <days>] [--json]` — runs drift detector, renders findings with severity colors
- `alix governance lens-review [--window <days>] [--json]` — runs lens review, renders per-lens recommendations
- `alix governance integrity [--window <days>] [--json]` — runs integrity builder, renders metrics with rates

Each subcommand uses dynamic `await import()` for its builder, then renders via a private `render*` function. Terminal renderer uses ANSI coloring (green/yellow/red per severity). JSON mode outputs the raw artifact.

- [ ] **Step 2: Write purity sentinel**

```ts
// tests/governance/governance-sentinels.vitest.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FORBIDDEN_IMPORTS = [
  "OutcomeStore",
  "ApprovalRecommendationStore",
  "RiskScoreStore",
  "GovernanceReviewStore",
  "LearningStore",
  "EvidenceChainStore",
  "ProposalStore",
  "ApprovalGate",
  "AdaptationProposalStore",
  "AutomaticProposalGenerator",
  "AgentCardApplier",
  "SkillApplier",
  "RevertApplier",
  "runLearningRefresh",
  // P9.1/P9.2 symbols — forbid even though they don't exist yet.
  // P9.0's strongest guarantee is "reports only"; future contributors
  // should not accidentally start implementing P9.1 behavior inside P9.0.
  "GovernanceRecommendation",
  "GovernanceProposal",
  "governance_change",
  "createGovernanceProposal",
];

const FORBIDDEN_WRITE_CALLS = [
  ".appendSignal(",
  ".appendProfile(",
  ".appendReport(",
  ".appendChain(",
  ".write(",
  ".writeFile(",
  ".appendFile(",
  ".save(",
  ".recordOutcome(",
  ".createProposal(",
  ".approveProposal(",
  ".applyProposal(",
  ".rejectProposal(",
  "runLearningRefresh(",
];

const GOVERNANCE_BUILDERS = [
  "src/governance/governance-health-builder.ts",
  "src/governance/governance-assessment.ts",
  "src/governance/governance-integrity.ts",
  "src/governance/governance-drift-detector.ts",
  "src/governance/governance-lens-review.ts",
];

// GovernanceStore and CLI may write to GovernanceStore (append only)
// but must NOT import P8 mutation surface
const ALL_FILES = [
  ...GOVERNANCE_BUILDERS,
  "src/governance/governance-store.ts",
  "src/cli/commands/governance.ts",
];

describe("P9.0 purity sentinel", () => {
  for (const file of ALL_FILES) {
    it(`${file} has no forbidden imports`, () => {
      const src = readFileSync(join(process.cwd(), file), "utf-8");
      // Governance builders legitimately read from P8 stores — check write methods, not imports
      if (GOVERNANCE_BUILDERS.includes(file)) return;
      const importLines = src.split("\n").filter((l) => l.trim().startsWith("import"));
      for (const line of importLines) {
        for (const forbidden of FORBIDDEN_IMPORTS) {
          expect(line, `${file} imports ${forbidden}`).not.toContain(forbidden);
        }
      }
    });
  }

  // All governance files must never call P8 write methods
  for (const file of ALL_FILES) {
    it(`${file} never calls P8 mutation methods`, () => {
      const src = readFileSync(join(process.cwd(), file), "utf-8");
      for (const call of FORBIDDEN_WRITE_CALLS) {
        expect(src, `${file} contains ${call}`).not.toContain(call);
      }
    });
  }

  // GovernanceStore may append to its own files only
  it("governance-store.ts only appends to governance JSONL files", () => {
    const src = readFileSync(join(process.cwd(), "src/governance/governance-store.ts"), "utf-8");
    // It may use appendFileSync (its own store)
    // But must not reference any P8 store path strings
    expect(src).not.toContain("outcomes");
    expect(src).not.toContain("recommendations");
    expect(src).not.toContain("risk-scores");
    expect(src).not.toContain("governance-reviews");
    expect(src).not.toContain("learning");
    expect(src).not.toContain("evidence-chains");
  });
});
```

- [ ] **Step 3: Write CLI tests**

```ts
// tests/cli/commands/governance-cli.vitest.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { handleGovernanceCommand } from "../../../src/cli/commands/governance.js";

describe("alix governance CLI", () => {
  it("health subcommand renders output with no data", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleGovernanceCommand(["health"]);
    const output = log.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(output).toContain("Governance Health");
    log.mockRestore();
  });

  it("drift subcommand renders output with no data", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleGovernanceCommand(["drift"]);
    const output = log.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(output).toContain("Drift");
    log.mockRestore();
  });

  it("errors on unknown subcommand", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    await handleGovernanceCommand(["bogus"]);
    expect(err).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
    err.mockRestore();
    exit.mockRestore();
  });
});
```

- [ ] **Step 4: Run full suite + tsc + commit**

```bash
npx vitest run tests/governance/ tests/cli/commands/governance-cli.vitest.ts && npx tsc --noEmit && git diff main --stat -- 'src/learning/*-types.ts' 'src/adaptation/*-types.ts'
```
Expected: all pass, tsc clean, 6 protected type files unchanged.

```bash
git add src/governance/ src/cli/commands/governance.ts tests/governance/ tests/cli/commands/governance-cli.vitest.ts
git commit -m "feat(p9.0f): governance CLI + purity sentinel + final review"
```

---

## Summary

| Metric | Value |
|---|---|
| Tasks | 6 (P9.0a-0f) |
| New files | ~18 (5 type+store, 5 builders, 1 CLI, 6 test files, 1 sentinel) |
| Modified files | 0 (P8 code untouched) |
| Tests added | ~25 (store + 4 builders + CLI + sentinel) |
| Protected type files | 0 changed |
| New stores | 1 (GovernanceStore, 5 per-artifact JSONL files) |
| New authority | 0 — analysis only, no proposals, sentinel-enforced |
