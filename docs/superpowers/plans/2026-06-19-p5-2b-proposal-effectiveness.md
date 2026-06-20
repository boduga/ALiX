# P5.2b — ProposalEffectivenessReport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Plan home (on approval):** `docs/superpowers/plans/2026-06-19-p5-2b-proposal-effectiveness.md` (project convention, matching P5.1).

**Goal:** Let ALiX measure whether an *applied* AdaptationProposal actually improved the outcome it targeted, and emit an advisory `keep | revert | investigate` recommendation — closing the P5.1 gap ("can change itself, can't tell if changes helped").

**Architecture:** Recompute `ReflectionMetrics` for a before-window `[T-window, T)` and after-window `[T, now)` around the proposal's `appliedAt`, compare the **primary metric** mapped from `sourceRecommendationType`, and decide. Pure read + compute — **never mutates**. "revert" is advisory only (appliers store no before-snapshot; executable revert is deferred to a later phase). Report persisted under `.alix/adaptation/effectiveness/`, one `adaptation_effectiveness` evidence event per assessment.

**Tech Stack:** TypeScript (ESM/TSX), P4.4 `EvidenceStore`, P5.0 `ReflectionMetrics`, P5.1 `ProposalStore`/`AdaptationProposal`, Vitest.

## Global Constraints

- **No mutation.** P5.2b only reads evidence + proposals and writes effectiveness reports. It does NOT touch agent cards, skills, or proposal status.
- **"revert" is advisory.** The report recommends; a human acts. Do not add before-snapshotting, revert actions, or any applier changes (decided with user — executable revert is a later phase).
- **Every assessment records evidence** (`adaptation_effectiveness`) so the loop is auditable.
- **Windows are configurable** (default 7 days each side). Insufficient evidence in either window → `investigate` (never a false `keep`/`revert`).
- Reuse, don't duplicate: extract the existing `ReflectionAgent.computeMetrics()` logic into a shared windowed function (Task 1); mirror `ProposalStore` for `EffectivenessStore` (Task 4); mirror `recordAdaptationApplied` for the new evidence writer method (Task 5).
- **Run `gitnexus_impact` (repo `ALiX`) before editing any indexed symbol** — `ReflectionAgent.computeMetrics` (Task 1), `evidence-types.ts`/`evidence-writer.ts` (Task 5), `adaptation.ts` (Task 6). Report blast radius; proceed only if not HIGH/CRITICAL, else surface it.

---

## Grounding (established by exploration — do not re-derive)

- `ReflectionAgent.computeMetrics()` (`src/reflection/reflection-agent.ts:83-108`) derives all six `ReflectionMetrics` from `EvidenceStore.query()` counts: `workflowsCompleted`←`merge_completed`, `workflowsBlocked`←`workflow_blocked`, `workflowsAborted`←`workflow_aborted`, `capabilitiesRequested`←`capability_routed.total`, `unresolvedCapabilities`←`capability_routed` records with `payload.candidates===0`, `reviewApprovalRate`←`verdict==="approve"` / total. It passes **no time window** today.
- `EvidenceStore.query()` (`src/security/evidence/evidence-store.ts:177-222`) streams the JSONL and returns `{ records (capped to limit), total (TRUE uncapped count), truncated }`. `matches()` (`:391-397`): `after` keeps `timestamp > after` (exclusive), `before` keeps `timestamp < before` (exclusive). So `{after: T-7d, before: T}` vs `{after: T, before: now}` partitions cleanly around `T`.
- `ApprovalGate.apply(id, applier)` sets `status:"applied"` + `appliedAt` and records `adaptation_applied` (carries `proposalId`+`appliedAt`) — the anchor for the before/after boundary.
- `AdaptationProposal.sourceRecommendationType` is preserved by `RecommendationToProposal.convert()` (`src/adaptation/recommendation-to-proposal.ts:108`) → maps each proposal to its intended metric.
- Goals (`src/workflow/goal-types.ts`) have **no outcome tracking** — effectiveness leans on `ReflectionMetrics`, not goals.

---

## File Structure

| File | Role |
|------|------|
| `src/reflection/metrics-snapshot.ts` | **Create** — `computeMetricsSnapshot(store, window?)`; shared windowed metrics fn |
| `src/reflection/reflection-agent.ts` | **Modify** — `computeMetrics()` delegates to the new fn (behavior-identical) |
| `src/adaptation/effectiveness-types.ts` | **Create** — `ProposalEffectivenessReport`, `MetricsDelta`, `RECOMMENDATION_METRIC_MAP` |
| `src/adaptation/effectiveness-reporter.ts` | **Create** — `EffectivenessReporter.assess(proposal, opts)` (pure compute) |
| `src/adaptation/effectiveness-store.ts` | **Create** — `save/load/list` for reports (mirrors `ProposalStore`) |
| `src/security/evidence/evidence-types.ts` | **Modify** — add `adaptation_effectiveness` to `EvidenceType` + `EVIDENCE_TYPES` |
| `src/workflow/evidence-writer.ts` | **Modify** — add `recordAdaptationEffectiveness()` (mirrors `recordAdaptationApplied`) |
| `src/cli/commands/adaptation.ts` | **Modify** — `effectiveness <id>` + `--all` subcommand |
| tests | `tests/reflection/metrics-snapshot.vitest.ts`, `tests/adaptation/effectiveness-*.vitest.ts`, extend `tests/cli/commands/adaptation.vitest.ts` |

---

## Task 1: P5.2b.1 — Windowed MetricsSnapshot (extract + reuse)

**Files:**
- Create: `src/reflection/metrics-snapshot.ts`
- Modify: `src/reflection/reflection-agent.ts` (delegation only)
- Test: `tests/reflection/metrics-snapshot.vitest.ts`

**Interfaces:**
- Produces: `computeMetricsSnapshot(store: EvidenceStore, window?: MetricsWindow): Promise<ReflectionMetrics>`, `MetricsWindow { after?: string; before?: string }`

- [ ] **Step 0: Impact analysis** — run `gitnexus_impact({ target: "computeMetrics", direction: "upstream", repo: "ALiX" })` (and on `ReflectionAgent`). Report blast radius. Expected LOW (private method, one caller `generateReport`).

- [ ] **Step 1: Write failing test** — `tests/reflection/metrics-snapshot.vitest.ts`

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EvidenceStore } from "../../src/security/evidence/evidence-store.js";
import { computeMetricsSnapshot } from "../../src/reflection/metrics-snapshot.js";

let n = 0;
function line(type: string, ts: string, payload: Record<string, unknown> = {}) {
  return JSON.stringify({ version: 1, id: `${type}-${n++}`, type, timestamp: ts, fingerprint: `fp-${n}`, payload });
}

describe("computeMetricsSnapshot", () => {
  let dir: string; let store: EvidenceStore;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "metrics-")); store = new EvidenceStore({ storeDir: dir }); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("counts all-time metrics when no window is given", async () => {
    writeFileSync(join(dir, "evidence.jsonl"), [
      line("merge_completed", "2026-06-01T00:00:00Z"),
      line("merge_completed", "2026-06-02T00:00:00Z"),
      line("workflow_aborted", "2026-06-03T00:00:00Z"),
      line("capability_routed", "2026-06-03T00:00:00Z", { candidates: 0 }),
      line("capability_routed", "2026-06-03T00:00:00Z", { candidates: 3 }),
      line("review_completed", "2026-06-03T00:00:00Z", { verdict: "approve" }),
      line("review_completed", "2026-06-03T00:00:00Z", { verdict: "reject" }),
    ].join("\n") + "\n");
    const m = await computeMetricsSnapshot(store);
    expect(m.workflowsCompleted).toBe(2);
    expect(m.workflowsAborted).toBe(1);
    expect(m.capabilitiesRequested).toBe(2);
    expect(m.unresolvedCapabilities).toBe(1);
    expect(m.reviewApprovalRate).toBe(0.5);
  });

  it("restricts counts to the given window (exclusive bounds)", async () => {
    writeFileSync(join(dir, "evidence.jsonl"), [
      line("merge_completed", "2026-06-01T00:00:00Z"),
      line("merge_completed", "2026-06-10T00:00:00Z"),
      line("merge_completed", "2026-06-20T00:00:00Z"),
    ].join("\n") + "\n");
    const m = await computeMetricsSnapshot(store, { after: "2026-06-05T00:00:00Z", before: "2026-06-15T00:00:00Z" });
    expect(m.workflowsCompleted).toBe(1); // only the 06-10 event is strictly inside
  });

  it("returns zeroed metrics for an empty/windowed-out store", async () => {
    const m = await computeMetricsSnapshot(store, { after: "2026-06-01T00:00:00Z" });
    expect(m.workflowsCompleted).toBe(0);
    expect(m.reviewApprovalRate).toBe(1); // no reviews → default 1
  });
});
```

- [ ] **Step 2: Run test → FAIL** — `npx vitest run tests/reflection/metrics-snapshot.vitest.ts` (module not found).

- [ ] **Step 3: Implement** — `src/reflection/metrics-snapshot.ts`

```typescript
/**
 * P5.2b.1 — Windowed metrics snapshot.
 *
 * Extracts ReflectionMetrics computation so it can be recomputed for an
 * arbitrary [after, before] window — the foundation for P5.2b before/after
 * effectiveness measurement. No window ⇒ identical to the original all-time
 * computation (behavior-preserving refactor of ReflectionAgent.computeMetrics).
 *
 * @module
 */
import type { EvidenceStore } from "../security/evidence/evidence-store.js";
import type { EvidenceQuery } from "../security/evidence/evidence-types.js";
import type { ReflectionMetrics } from "./reflection-types.js";

export interface MetricsWindow {
  /** ISO 8601 — only records with timestamp > after are counted. */
  after?: string;
  /** ISO 8601 — only records with timestamp < before are counted. */
  before?: string;
}

const PAYLOAD_LIMIT = 5000;

export async function computeMetricsSnapshot(
  store: EvidenceStore,
  window?: MetricsWindow,
): Promise<ReflectionMetrics> {
  const base: EvidenceQuery = {};
  if (window?.after) base.after = window.after;
  if (window?.before) base.before = window.before;

  const completed = await store.query({ type: "merge_completed", limit: 1, ...base });
  const blocked = await store.query({ type: "workflow_blocked", limit: 1, ...base });
  const aborted = await store.query({ type: "workflow_aborted", limit: 1, ...base });
  const routed = await store.query({ type: "capability_routed", limit: PAYLOAD_LIMIT, ...base });
  const reviews = await store.query({ type: "review_completed", limit: PAYLOAD_LIMIT, ...base });

  const unresolvedCapabilities = routed.records.filter(
    (r) => (r.payload.candidates as number) === 0,
  ).length;
  const approvedReviews = reviews.records.filter(
    (r) => r.payload.verdict === "approve",
  ).length;

  return {
    workflowsCompleted: completed.total,
    workflowsBlocked: blocked.total,
    workflowsAborted: aborted.total,
    capabilitiesRequested: routed.total,
    unresolvedCapabilities,
    reviewApprovalRate: reviews.total > 0 ? approvedReviews / reviews.total : 1,
  };
}
```

- [ ] **Step 4: Refactor `ReflectionAgent`** — in `src/reflection/reflection-agent.ts`, replace the body of `private async computeMetrics()` with `return computeMetricsSnapshot(this.storeForMetrics);` and add `import { computeMetricsSnapshot } from "./metrics-snapshot.js";`. No other change. Run the existing reflection suite to confirm behavior is identical.

- [ ] **Step 5: Run tests → PASS** — `npx vitest run tests/reflection/` (new + existing reflection tests green).

- [ ] **Step 6: Commit**
```bash
git add src/reflection/metrics-snapshot.ts src/reflection/reflection-agent.ts tests/reflection/metrics-snapshot.vitest.ts
git commit -m "feat(p5.2b.1): extract windowed computeMetricsSnapshot for before/after measurement"
```

---

## Task 2: P5.2b.2 — Effectiveness types + metric map

**Files:**
- Create: `src/adaptation/effectiveness-types.ts`
- Test: `tests/adaptation/effectiveness-types.vitest.ts`

**Interfaces:**
- Produces: `ProposalEffectivenessReport`, `MetricsDelta`, `EffectivenessRecommendation`, `PrimaryMetricKey`, `MetricDirection`, `RECOMMENDATION_METRIC_MAP`

- [ ] **Step 1: Write failing test** — `tests/adaptation/effectiveness-types.vitest.ts`

```typescript
import { describe, it, expect } from "vitest";
import { RECOMMENDATION_METRIC_MAP } from "../../src/adaptation/effectiveness-types.js";
import type { ProposalEffectivenessReport } from "../../src/adaptation/effectiveness-types.js";

describe("effectiveness types", () => {
  it("maps capability proposals to unresolvedCapabilities (lower is better)", () => {
    expect(RECOMMENDATION_METRIC_MAP.capability_gap).toEqual({ metric: "unresolvedCapabilities", direction: "lower_is_better" });
    expect(RECOMMENDATION_METRIC_MAP.agent_card_update?.metric).toBe("unresolvedCapabilities");
  });

  it("maps skill revisions to workflowsAborted", () => {
    expect(RECOMMENDATION_METRIC_MAP.skill_revision).toEqual({ metric: "workflowsAborted", direction: "lower_is_better" });
  });

  it("maps manual-action process_change to null (investigate)", () => {
    expect(RECOMMENDATION_METRIC_MAP.process_change).toBeNull();
  });

  it("constructs a valid report shape", () => {
    const r: ProposalEffectivenessReport = {
      proposalId: "prop-1", assessedAt: "2026-06-19T00:00:00.000Z", appliedAt: "2026-06-12T00:00:00.000Z",
      windowDays: 7,
      metricsBefore: { workflowsCompleted: 0, workflowsBlocked: 0, workflowsAborted: 0, capabilitiesRequested: 0, unresolvedCapabilities: 5, reviewApprovalRate: 1 },
      metricsAfter: { workflowsCompleted: 0, workflowsBlocked: 0, workflowsAborted: 0, capabilitiesRequested: 0, unresolvedCapabilities: 2, reviewApprovalRate: 1 },
      primary: { metric: "unresolvedCapabilities", direction: "lower_is_better", before: 5, after: 2, absoluteDelta: -3, relativeDelta: -0.6 },
      dataSufficient: true, recommendation: "keep", reason: "improved",
    };
    expect(r.recommendation).toBe("keep");
  });
});
```

- [ ] **Step 2: Run → FAIL** (module not found).

- [ ] **Step 3: Implement** — `src/adaptation/effectiveness-types.ts`

```typescript
/**
 * P5.2b.2 — ProposalEffectivenessReport types.
 *
 * Captures whether an applied AdaptationProposal improved the outcome it
 * targeted. ADVISORY ONLY — recommends keep/revert/investigate, never mutates.
 *
 * @module
 */
import type { ReflectionMetrics } from "../reflection/reflection-types.js";

export type EffectivenessRecommendation = "keep" | "revert" | "investigate";

export type PrimaryMetricKey = Pick<ReflectionMetrics,
  "workflowsAborted" | "workflowsBlocked" | "unresolvedCapabilities"
  | "capabilitiesRequested" | "reviewApprovalRate">[never] extends never
  ? keyof Pick<ReflectionMetrics, "workflowsAborted" | "workflowsBlocked" | "unresolvedCapabilities" | "capabilitiesRequested" | "reviewApprovalRate">
  : never;

export type MetricDirection = "lower_is_better" | "higher_is_better";

/** recommendation type → the metric it intends to improve; null ⇒ investigate. */
export const RECOMMENDATION_METRIC_MAP: Record<string, {
  metric: PrimaryMetricKey; direction: MetricDirection;
} | null> = {
  capability_gap: { metric: "unresolvedCapabilities", direction: "lower_is_better" },
  agent_card_update: { metric: "unresolvedCapabilities", direction: "lower_is_better" },
  routing_adjustment: { metric: "unresolvedCapabilities", direction: "lower_is_better" },
  skill_revision: { metric: "workflowsAborted", direction: "lower_is_better" },
  process_change: null,
};

export interface MetricsDelta {
  metric: PrimaryMetricKey;
  direction: MetricDirection;
  before: number;
  after: number;
  absoluteDelta: number;
  relativeDelta: number;
}

export interface ProposalEffectivenessReport {
  proposalId: string;
  assessedAt: string;
  appliedAt: string;
  windowDays: number;
  metricsBefore: ReflectionMetrics;
  metricsAfter: ReflectionMetrics;
  primary: MetricsDelta | null;
  dataSufficient: boolean;
  recommendation: EffectivenessRecommendation;
  reason: string;
}
```

> Note: the `PrimaryMetricKey` definition above is over-engineered. Use the simpler form:
> `export type PrimaryMetricKey = "workflowsAborted" | "workflowsBlocked" | "unresolvedCapabilities" | "capabilitiesRequested" | "reviewApprovalRate";`

- [ ] **Step 4: Run → PASS**, **Step 5: Commit** — `git commit -m "feat(p5.2b.2): add ProposalEffectivenessReport types and recommendation→metric map"` (stage the two files).

---

## Task 3: P5.2b.3 — EffectivenessReporter (pure compute)

**Files:**
- Create: `src/adaptation/effectiveness-reporter.ts`
- Test: `tests/adaptation/effectiveness-reporter.vitest.ts`

**Interfaces:**
- Consumes: `computeMetricsSnapshot` (Task 1), `AdaptationProposal`, types (Task 2)
- Produces: `EffectivenessReporter.assess(proposal, opts?) => Promise<ProposalEffectivenessReport>`

- [ ] **Step 1: Write failing test** — seed an EvidenceStore with events on both sides of `appliedAt`, assert recommendation logic. Cover: improving→keep, regressing >10%→revert, insufficient data→investigate, process_change→investigate, non-applied→throws.

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EvidenceStore } from "../../src/security/evidence/evidence-store.js";
import { EffectivenessReporter } from "../../src/adaptation/effectiveness-reporter.js";
import type { AdaptationProposal } from "../../src/adaptation/adaptation-types.js";

let n = 0;
function line(type: string, ts: string, payload: Record<string, unknown> = {}) {
  return JSON.stringify({ version: 1, id: `${type}-${n++}`, type, timestamp: ts, fingerprint: `fp-${n}`, payload });
}
const T = "2026-06-12T00:00:00.000Z"; // appliedAt boundary
function proposal(sourceRecommendationType: string): AdaptationProposal {
  return { id: "prop-1", createdAt: "2026-06-11T00:00:00.000Z", status: "applied", action: "create_agent_card", target: { kind: "agent_card", id: "x" }, payload: {}, sourceRecommendationType, sourceConfidence: 0.9, evidenceFingerprints: [], reason: "r", appliedAt: T };
}

describe("EffectivenessReporter", () => {
  let dir: string; let store: EvidenceStore;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "eff-")); store = new EvidenceStore({ storeDir: dir }); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("recommends keep when unresolvedCapabilities drops", async () => {
    writeFileSync(join(dir, "evidence.jsonl"), [
      ...Array.from({ length: 5 }, () => line("capability_routed", "2026-06-10T00:00:00Z", { candidates: 0 })), // before: 5 unresolved
      ...Array.from({ length: 5 }, () => line("capability_routed", "2026-06-15T00:00:00Z", { candidates: 2 })),   // after: 0 unresolved
    ].join("\n") + "\n");
    const r = await new EffectivenessReporter(store).assess(proposal("capability_gap"), { now: "2026-06-19T00:00:00.000Z" });
    expect(r.primary?.metric).toBe("unresolvedCapabilities");
    expect(r.recommendation).toBe("keep");
  });

  it("recommends revert on >10% regression", async () => {
    writeFileSync(join(dir, "evidence.jsonl"), [
      ...Array.from({ length: 2 }, () => line("capability_routed", "2026-06-10T00:00:00Z", { candidates: 2 })),  // before: 0 unresolved
      ...Array.from({ length: 5 }, () => line("capability_routed", "2026-06-15T00:00:00Z", { candidates: 0 })),   // after: 5 unresolved (regression)
    ].join("\n") + "\n");
    const r = await new EffectivenessReporter(store).assess(proposal("capability_gap"), { now: "2026-06-19T00:00:00.000Z" });
    expect(r.recommendation).toBe("revert");
  });

  it("recommends investigate with insufficient data", async () => {
    const r = await new EffectivenessReporter(store).assess(proposal("capability_gap"), { now: "2026-06-19T00:00:00.000Z" });
    expect(r.recommendation).toBe("investigate");
  });

  it("recommends investigate for manual-action process_change", async () => {
    writeFileSync(join(dir, "evidence.jsonl"), line("merge_completed", "2026-06-10T00:00:00Z") + "\n" + line("merge_completed", "2026-06-15T00:00:00Z") + "\n");
    const r = await new EffectivenessReporter(store).assess(proposal("process_change"), { now: "2026-06-19T00:00:00.000Z" });
    expect(r.recommendation).toBe("investigate");
    expect(r.primary).toBeNull();
  });

  it("throws on a non-applied proposal", async () => {
    const p = proposal("capability_gap"); p.status = "pending"; delete p.appliedAt;
    await expect(new EffectivenessReporter(store).assess(p)).rejects.toThrow(/expected "applied"/);
  });
});
```

- [ ] **Step 2: Run → FAIL**. **Step 3: Implement** `src/adaptation/effectiveness-reporter.ts`:

```typescript
/**
 * P5.2b.3 — EffectivenessReporter. Pure read + compute; never mutates.
 * @module
 */
import type { EvidenceStore } from "../security/evidence/evidence-store.js";
import { computeMetricsSnapshot } from "../reflection/metrics-snapshot.js";
import type { ReflectionMetrics } from "../reflection/reflection-types.js";
import type { AdaptationProposal } from "./adaptation-types.js";
import type { ProposalEffectivenessReport, MetricsDelta, PrimaryMetricKey, MetricDirection, EffectivenessRecommendation } from "./effectiveness-types.js";
import { RECOMMENDATION_METRIC_MAP } from "./effectiveness-types.js";

export interface EffectivenessOptions {
  windowDays?: number;  // default 7
  minSample?: number;   // default 1
  now?: string;         // injection for deterministic tests
}

const DEFAULT_WINDOW_DAYS = 7;
const DEFAULT_MIN_SAMPLE = 1;
const REGRESSION_THRESHOLD = 0.1;

export class EffectivenessReporter {
  constructor(private readonly store: EvidenceStore) {}

  async assess(proposal: AdaptationProposal, opts: EffectivenessOptions = {}): Promise<ProposalEffectivenessReport> {
    if (proposal.status !== "applied" || !proposal.appliedAt) {
      throw new Error(`EffectivenessReporter: proposal ${proposal.id} is "${proposal.status}", expected "applied"`);
    }
    const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
    const minSample = opts.minSample ?? DEFAULT_MIN_SAMPLE;
    const now = opts.now ?? new Date().toISOString();
    const T = proposal.appliedAt;

    const metricsBefore = await computeMetricsSnapshot(this.store, { after: shiftDays(T, -windowDays), before: T });
    const metricsAfter = await computeMetricsSnapshot(this.store, { after: T, before: now });

    const mapping = RECOMMENDATION_METRIC_MAP[proposal.sourceRecommendationType] ?? null;
    const primary = mapping ? delta(mapping.metric, mapping.direction, metricsBefore, metricsAfter) : null;
    const dataSufficient = sufficient(metricsBefore, minSample) && sufficient(metricsAfter, minSample);
    const { recommendation, reason } = decide(primary, dataSufficient);

    return { proposalId: proposal.id, assessedAt: now, appliedAt: T, windowDays, metricsBefore, metricsAfter, primary, dataSufficient, recommendation, reason };
  }
}

function shiftDays(iso: string, days: number): string { const d = new Date(iso); d.setUTCDate(d.getUTCDate() + days); return d.toISOString(); }
function delta(metric: PrimaryMetricKey, direction: MetricDirection, b: ReflectionMetrics, a: ReflectionMetrics): MetricsDelta {
  const before = b[metric]; const after = a[metric];
  return { metric, direction, before, after, absoluteDelta: after - before, relativeDelta: before !== 0 ? (after - before) / before : 0 };
}
function sufficient(m: ReflectionMetrics, minSample: number): boolean {
  return (m.workflowsCompleted + m.workflowsAborted + m.workflowsBlocked + m.capabilitiesRequested) >= minSample;
}
function decide(primary: MetricsDelta | null, dataSufficient: boolean): { recommendation: EffectivenessRecommendation; reason: string } {
  if (!primary) return { recommendation: "investigate", reason: "No auto-measurable primary metric for this proposal type; manual review required." };
  if (!dataSufficient) return { recommendation: "investigate", reason: "Insufficient evidence in one or both windows to compare reliably." };
  const improved = primary.direction === "lower_is_better" ? primary.absoluteDelta < 0 : primary.absoluteDelta > 0;
  const regressed = primary.direction === "lower_is_better" ? primary.relativeDelta > REGRESSION_THRESHOLD : primary.relativeDelta < -REGRESSION_THRESHOLD;
  if (regressed) return { recommendation: "revert", reason: `${primary.metric} moved ${primary.before} → ${primary.after} (Δ${(primary.relativeDelta * 100).toFixed(0)}%); regression beyond ${(REGRESSION_THRESHOLD * 100).toFixed(0)}%.` };
  if (improved) return { recommendation: "keep", reason: `${primary.metric} improved ${primary.before} → ${primary.after}.` };
  return { recommendation: "keep", reason: `${primary.metric} unchanged (${primary.before} → ${primary.after}); no regression.` };
}
```

- [ ] **Step 4: Run → PASS**, **Step 5: Commit** — `feat(p5.2b.3): add EffectivenessReporter — before/after metrics + keep/revert/investigate`.

---

## Task 4: P5.2b.4 — EffectivenessStore (persistence)

**Files:**
- Create: `src/adaptation/effectiveness-store.ts`
- Test: `tests/adaptation/effectiveness-store.vitest.ts`

**Interfaces:** mirrors `ProposalStore`. Produces `EffectivenessStore` with `save(report) / load(proposalId) / list()`.

- [ ] **Step 1: Failing test** — round-trip save→load; list returns saved; load missing → null. Mirror `tests/adaptation/proposal-store.vitest.ts` style (mkdtemp, afterEach rm).
- [ ] **Step 2: Run → FAIL**. **Step 3: Implement** `src/adaptation/effectiveness-store.ts` (copy `ProposalStore` structure; key files by `report.proposalId`; `save/load(proposalId)/list()`).
```typescript
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ProposalEffectivenessReport } from "./effectiveness-types.js";

export class EffectivenessStore {
  constructor(private readonly dir: string) {}
  async save(report: ProposalEffectivenessReport): Promise<void> {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    writeFileSync(join(this.dir, `${report.proposalId}.json`), JSON.stringify(report, null, 2), "utf-8");
  }
  async load(proposalId: string): Promise<ProposalEffectivenessReport | null> {
    const path = join(this.dir, `${proposalId}.json`);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8")) as ProposalEffectivenessReport;
  }
  async list(): Promise<ProposalEffectivenessReport[]> {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir).filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(join(this.dir, f), "utf-8")) as ProposalEffectivenessReport);
  }
}
```
- [ ] **Step 4: Run → PASS**, **Step 5: Commit** — `feat(p5.2b.4): add EffectivenessStore — persist effectiveness reports`.

---

## Task 5: P5.2b.5 — `adaptation_effectiveness` evidence event

**Files:**
- Modify: `src/security/evidence/evidence-types.ts` (add type + set entry)
- Modify: `src/workflow/evidence-writer.ts` (add writer method)
- Test: `tests/security/evidence/evidence-writer.adaptation.vitest.ts` (extend or create)

- [ ] **Step 0: Impact analysis** — `gitnexus_impact({ target: "EvidenceType", ... })` and on the writer. Expected LOW (additive enum member + new method).

- [ ] **Step 1: Failing test** — `writer.recordAdaptationEffectiveness(proposalId, { recommendation, primaryMetric, assessedAt })` appends an `adaptation_effectiveness` record; `store.query({type:"adaptation_effectiveness"}).total === 1` and payload carries `proposalId`.

- [ ] **Step 2: Run → FAIL**. **Step 3: Implement**:
  - In `evidence-types.ts`: add `| "adaptation_effectiveness"` to the `EvidenceType` union (after `adaptation_failed`) and `"adaptation_effectiveness"` to the `EVIDENCE_TYPES` set.
  - In `evidence-writer.ts`: add (mirroring `recordAdaptationApplied`, using `appendEvent`):
```typescript
async recordAdaptationEffectiveness(
  proposalId: string,
  payload: { recommendation: string; primaryMetric: string | null; assessedAt: string },
): Promise<EvidenceRecord | null> {
  return this.appendEvent("adaptation_effectiveness", { proposalId, ...payload });
}
```
- [ ] **Step 4: Run → PASS** (writer test + `tests/security/evidence/`), **Step 5: Commit** — `feat(p5.2b.5): record adaptation_effectiveness evidence per assessment`.

---

## Task 6: P5.2b.6 — CLI `alix adaptation effectiveness <id> | --all`

**Files:**
- Modify: `src/cli/commands/adaptation.ts` (new subcommand + helper + help line + `EFFECTIVENESS_DIR` constant)
- Test: extend `tests/cli/commands/adaptation.vitest.ts`

- [ ] **Step 0: Impact analysis** — `gitnexus_impact({ target: "handleAdaptationCommand", ... })`. The function is CLI-internal; additive `case` branch.

- [ ] **Step 1: Failing test** — seed an applied proposal + evidence, invoke the effectiveness path, assert: report printed to stdout, persisted to EffectivenessStore, one `adaptation_effectiveness` evidence event, no mutation of proposal status. Also test `--all` iterates applied proposals and unknown-id errors cleanly. Mirror the existing `runApply`/`runPropose` test style.

- [ ] **Step 2: Run → FAIL**. **Step 3: Implement** in `adaptation.ts`:
  - Add `const EFFECTIVENESS_DIR = ".alix/adaptation/effectiveness";` near `PROPOSALS_DIR`.
  - Wire `case "effectiveness": await runEffectiveness(cwd, store, evidenceStore, rest); return;` in the switch; add a help line in `printUsage`.
```typescript
async function runEffectiveness(cwd: string, store: ProposalStore, evidenceStore: EvidenceStore, args: string[]): Promise<void> {
  const all = args.includes("--all");
  const id = args.find((a) => !a.startsWith("-"));
  const reporter = new EffectivenessReporter(evidenceStore);
  const effStore = new EffectivenessStore(join(cwd, EFFECTIVENESS_DIR));
  const writer = new EvidenceEventWriter((type, payload) => evidenceStore.append(type, payload));

  const targets: AdaptationProposal[] = [];
  if (all) targets.push(...(await store.list("applied")));
  else {
    if (!id) { console.error("Usage: alix adaptation effectiveness <id> | --all"); process.exit(1); }
    const p = await store.load(id);
    if (!p) { console.error(`Proposal not found: ${id}`); process.exit(1); }
    targets.push(p);
  }
  if (targets.length === 0) { console.log("No applied proposals to assess."); return; }

  for (const p of targets) {
    const report = await reporter.assess(p);
    await effStore.save(report);
    await writer.recordAdaptationEffectiveness(p.id, { recommendation: report.recommendation, primaryMetric: report.primary?.metric ?? null, assessedAt: report.assessedAt });
    printEffectiveness(report);
  }
}

function printEffectiveness(r: ProposalEffectivenessReport): void {
  console.log(`Proposal:     ${r.proposalId}`);
  console.log(`Applied at:   ${r.appliedAt}  (window ±${r.windowDays}d)`);
  console.log(`Recommendation: ${r.recommendation.toUpperCase()}  — ${r.reason}`);
  if (r.primary) console.log(`Primary:      ${r.primary.metric} ${r.primary.before} → ${r.primary.after}`);
  else console.log(`Primary:      (none — manual-action proposal)`);
  console.log(`Data sufficient: ${r.dataSufficient}`);
  console.log("");
}
```
- [ ] **Step 4: Run → PASS** (`tests/cli/commands/adaptation.vitest.ts`), **Step 5: Commit** — `feat(p5.2b.6): add alix adaptation effectiveness CLI (single + --all)`.

---

## Task 7: P5.2b.7 — Integration verify + docs

- [ ] **Step 1: Full suite** — `npx vitest run tests/adaptation/ tests/reflection/ tests/security/evidence/ tests/cli/  --config vitest.config.mts` and `npx tsc --noEmit`. All green.
- [ ] **Step 2: Smoke** — manually: create a proposal, mark applied (via the gate in a test/script), seed evidence, run `alix adaptation effectiveness <id>`, confirm a report prints and `.alix/adaptation/effectiveness/<id>.json` is written.
- [ ] **Step 3: detect_changes** — `gitnexus_detect_changes({ scope: "all", repo: "ALiX" })`; confirm only the expected adaptation/reflection/evidence/cli symbols changed, risk LOW.
- [ ] **Step 4: Commit** any docs/changelog touch, then open PR (base `main`) summarizing the loop: applied proposal → windowed before/after metrics → advisory keep/revert/investigate → persisted + `adaptation_effectiveness` evidence.

---

## Verification (end-to-end)

```bash
npx vitest run tests/adaptation/ tests/reflection/ tests/security/evidence/ tests/cli/ --config vitest.config.mts
npx tsc --noEmit
```
Manual: `alix adaptation effectiveness <id>` on an applied proposal prints `KEEP/REVERT/INVESTIGATE` with the primary-metric delta; `--all` covers every applied proposal; each assessment writes a report file and one `adaptation_effectiveness` evidence record; **no agent card, skill, or proposal status is mutated**.

---

## Self-Review

- **Spec coverage:** measurement ✓ (Task 1+3), types ✓ (2), persistence ✓ (4), evidence ✓ (5), CLI ✓ (6), verify ✓ (7). Advisory-only revert per user decision ✓ (no applier/snapshot changes). Primary-metric mapping per `sourceRecommendationType` ✓.
- **Placeholders:** none — every code step shows real code; the `PrimaryMetricKey` over-engineering is flagged inline with the simpler form to use.
- **Type consistency:** `computeMetricsSnapshot`/`MetricsWindow` (T1) consumed identically in T3; `RECOMMENDATION_METRIC_MAP`/`MetricsDelta`/`ProposalEffectivenessReport` (T2) match T3/T4/T6 usage; `recordAdaptationEffectiveness` (T5) matches the T6 call; `EffectivenessStore.save/load(proposalId)/list` consistent across T4/T6.
- **Reuse:** T1 extracts (no duplication of metric logic); T4 mirrors ProposalStore; T5 mirrors recordAdaptationApplied; T6 mirrors existing CLI subcommand structure.
- **Governance:** no mutation anywhere; "revert" advisory; evidence at the assessment stage.
