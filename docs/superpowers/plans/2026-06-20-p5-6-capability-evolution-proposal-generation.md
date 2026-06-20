# P5.6 — Capability Evolution Proposal Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate `create_improvement_issue` proposals from CapabilityEvolutionReport findings — gaps, overlaps, deprecated/stagnant/declining health, and drift split candidates.

**Architecture:** A new `CapabilityEvolutionProposalGenerator` class (following `AutomaticProposalGenerator`'s pattern) iterates each analysis section in the P5.5 report, applies per-finding thresholds and type-based confidence scores, emits `create_improvement_issue` proposals only, then wires into the existing `alix adaptation generate --capability-evolution` CLI path.

**Tech Stack:** TypeScript, existing `ProposalStore`, `EvidenceEventWriter`, `GenerateResult` (reused from P5.2c). No new evidence types, no new action types.

**SDS:** `docs/superpowers/specs/2026-06-20-p5-6-capability-evolution-proposal-generation-design.md`

## Global Constraints

- **ALL proposals must use `action: "create_improvement_issue"`** — no other action type.
- **ALL proposals must have `provenance: "auto"`** and `status: "pending"`.
- **NEVER import `ApprovalGate`, `AgentCardApplier`, or `SkillApplier`** — governance invariant.
- **NEVER produce `create_agent_card`, `add_capability`, `update_agent_card`, `adjust_skill_definition`, or `suggest_routing_weight` proposals.**
- **sourceConfidence** varies by finding type per the mapping table (0.65-0.90).
- **dedupeKey** is a structured string in the proposal payload, not matched by title.
- **Evidence recording** uses existing `adaptation_proposed` with `sourceRecommendationType: "capability_evolution_proposal"`.

---
## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/adaptation/capability-evolution-proposal-generator.ts` | **Create** | Generator class, options interface, payload builder, dedup check |
| `src/cli/commands/adaptation.ts` | **Modify** | Add `--capability-evolution` to `runGenerate`, import + route, print result |
| `tests/adaptation/capability-evolution-proposal-generator.vitest.ts` | **Create** | Full test suite per the 11-test spec table |

---

### Task 1: CapabilityEvolutionProposalGenerator

**Files:**
- Create: `src/adaptation/capability-evolution-proposal-generator.ts`
- Test: `tests/adaptation/capability-evolution-proposal-generator.vitest.ts`

**Interfaces:**
- Consumes: `CapabilityEvolutionReport` (from `capability-evolution-types.ts`), `ProposalStore`, `EvidenceEventWriter`, `GenerateResult` (from `auto-proposal-generator.ts`)
- Produces: `CapabilityEvolutionProposalGenerator` class with `generateFromCapabilityEvolution(report, opts)` method returning `GenerateResult`

#### Types

No new standalone type definitions are needed — the options interface is defined on the class params. But the proposal payload needs a helper type:

```ts
interface CapabilityEvolutionProposalPayload {
  capabilityEvolutionGeneratedAt: string;
  findingType: "gap" | "overlap" | "deprecated" | "stagnant" | "declining" | "drift";
  findingDetail: string;
  signalStrength?: number;
  overlapScore?: number;
  lifecycleState?: string;
  driftMagnitude?: number;
  sourceReportTimestamp: string;
  dedupeKey: string;
}
```

#### Imports needed

```ts
import type { AdaptationProposal } from "./adaptation-types.js";
import type { ProposalStore } from "./proposal-store.js";
import type { EvidenceEventWriter } from "../workflow/evidence-writer.js";
import type { CapabilityEvolutionReport } from "./capability-evolution-types.js";
import { nextProposalId } from "./recommendation-to-proposal.js";
import type { GenerateResult } from "./auto-proposal-generator.js";
```

#### CapabilityEvolutionGenerateOptions

```ts
export interface CapabilityEvolutionGenerateOptions {
  /** Minimum gap signal strength (default 2). */
  minGapSignalStrength?: number;
  /** Minimum drift magnitude (default 0.5). */
  minDriftMagnitude?: number;
  /** Minimum resolution count for health-based findings (default 5). */
  minCapabilityUsage?: number;
  /** Maximum proposals generated per run (default 10). */
  maxProposalsPerRun?: number;
}
```

#### Confidence mapping

```ts
const FINDING_CONFIDENCE: Record<string, number> = {
  gap: 0.90,
  declining: 0.85,
  drift: 0.80,
  overlap: 0.75,
  deprecated: 0.70,
  stagnant: 0.65,
};
```

#### Overlap dedupe key helper

```ts
/** Build a normalized dedupeKey for a capability pair (sorted lexicographically). */
function buildOverlapKey(a: string, b: string): string {
  const [first, second] = a < b ? [a, b] : [b, a];
  return `capability-overlap:${first}:${second}`;
}
```

#### Finding → candidate collection

The method builds a flat array of `FindingCandidate` objects:

```ts
interface FindingCandidate {
  priority: number;        // tier 0-5, lower = higher priority
  sortKey: number;         // secondary sort (descending)
  findingType: string;     // "gap" | "declining" | "drift" | "overlap" | "deprecated" | "stagnant"
  dedupeKey: string;
  title: string;
  detail: string;
  sourceConfidence: number;
  extraPayload: Record<string, unknown>;
}
```

Collection logic:

1. **gapAnalysis**: for each entry where `signalStrength >= opts.minGapSignalStrength` → push with priority=0, sortKey=`signalStrength`, dedupeKey=`capability-gap:<suggestedCapability>`, title=`Investigate adding capability for "<suggestedCapability>"`
2. **healthAnalysis declining**: for each where `lifecycleState === "declining"` AND `resolutionCount >= opts.minCapabilityUsage` → priority=1, sortKey=`revertRate ?? 0`, dedupeKey=`capability-health:declining:<capability>`
3. **driftAnalysis**: for each where `splitCandidate === true` AND `driftMagnitude >= opts.minDriftMagnitude` → priority=2, sortKey=`driftMagnitude`, dedupeKey=`capability-drift:<capability>`
4. **overlapAnalysis**: for each where `consolidationCandidate === true` → priority=3, sortKey=`overlapScore`, dedupeKey=`buildOverlapKey(a, b)` using a dedicated helper that sorts A < B lexicographically to prevent duplicate keys like `capability-overlap:ml:vision` vs `capability-overlap:vision:ml`
5. **healthAnalysis deprecated**: for each where `lifecycleState === "deprecated"` → priority=4, sortKey=`-resolutionCount` (lowest first), dedupeKey=`capability-health:deprecated:<capability>`
6. **healthAnalysis stagnant**: for each where `lifecycleState === "stagnant"` AND `resolutionCount >= opts.minCapabilityUsage` → priority=5, sortKey=`-resolutionCountRecent` (least recent first), dedupeKey=`capability-health:stagnant:<capability>`

#### Sorting and top-N

Sort candidates by `(priority, -sortKey)`. Take the first `maxProposalsPerRun`.

#### Deduplication

Load all pending proposals from the store, filter to those with `action === "create_improvement_issue"` and a `payload.dedupeKey`. Build a Set of existing dedupeKeys. Skip any candidate whose key is in the set, counting as skipped.

#### Proposal construction

For each surviving candidate, build:

```ts
const proposal: AdaptationProposal = {
  id: nextProposalId(),
  createdAt: new Date().toISOString(),
  status: "pending",
  action: "create_improvement_issue",
  target: { kind: "issue", title: candidate.title },
  payload: {
    capabilityEvolutionGeneratedAt: report.generatedAt,
    findingType: candidate.findingType,
    findingDetail: candidate.detail,
    sourceReportTimestamp: report.generatedAt,
    dedupeKey: candidate.dedupeKey,
    ...candidate.extraPayload,
  },
  sourceRecommendationType: "capability_evolution_proposal",
  sourceConfidence: candidate.sourceConfidence,
  provenance: "auto",
  reason: candidate.title,
};
```

#### Save + evidence

For each proposal: `await this.store.save(proposal)` then `await this.writer.recordAdaptationProposed(proposal.id, { ... })` with the evidence payload including `sourceReportTimestamp`.

If evidence recording fails, catch and log but don't abort — the proposal is already saved.

#### Returns + skipped tracking

Returns `{ generated: N, skipped: M, proposals: [...] }` via `GenerateResult`.

Internally, track skipped reasons for telemetry:

```ts
interface SkippedDetail {
  duplicate: number;
  belowThreshold: number;
  capped: number;
}
```

The `GenerateResult` interface only has `skipped: number`, so store detailed counts in an internal field. The CLI prints the aggregate `Generated: N / Skipped: M` only. Detailed breakdown is available for future P5.7/P6 analytics by exposing via the generator or logging.

During candidate collection, increment `belowThreshold` for findings that fail threshold checks. During deduplication, increment `duplicate` for already-pending proposals. After top-N truncation, set `capped` to the count of candidates dropped by the limit.

#### Steps

- [ ] **Step 1: Write the failing test for gap finding → proposal**

```ts
// tests/adaptation/capability-evolution-proposal-generator.vitest.ts
import { describe, it, expect } from "vitest";
import { CapabilityEvolutionProposalGenerator } from "../../src/adaptation/capability-evolution-proposal-generator.js";
import type { CapabilityEvolutionReport } from "../../src/adaptation/capability-evolution-types.js";

function makeMinimalReport(overrides?: Partial<CapabilityEvolutionReport>): CapabilityEvolutionReport {
  return {
    generatedAt: "2026-06-20T12:00:00.000Z",
    totalCapabilities: 0,
    healthAnalysis: [],
    gapAnalysis: [],
    overlapAnalysis: [],
    driftAnalysis: [],
    lifecycleDistribution: { emerging:0, active:0, mature:0, stagnant:0, declining:0, deprecated:0 },
    executiveSummary: "Test",
    ...overrides,
  };
}

describe("CapabilityEvolutionProposalGenerator", () => {
  it("generates proposal from gap finding with signal >= 2", async () => {
    const store = { list: async () => [], save: async () => {} };
    const writer = { recordAdaptationProposed: async () => null };
    const gen = new CapabilityEvolutionProposalGenerator(store as any, writer as any);
    const report = makeMinimalReport({
      gapAnalysis: [{ suggestedCapability: "ml-training", evidence: ["5 unresolved requests"], signalStrength: 2, confidence: "medium" }],
    });
    const result = await gen.generateFromCapabilityEvolution(report);
    expect(result.generated).toBe(1);
    // Assert on deterministic fields only — proposal IDs evolve over time
    expect(result.proposals[0].action).toBe("create_improvement_issue");
    expect(result.proposals[0].target).toEqual({ kind: "issue", title: 'Investigate adding capability for "ml-training"' });
    expect(result.proposals[0].sourceConfidence).toBe(0.90);
    expect(result.proposals[0].provenance).toBe("auto");
    expect(result.proposals[0].payload.dedupeKey).toBe("capability-gap:ml-training");
    expect(result.proposals[0].payload.findingType).toBe("gap");
    expect(result.proposals[0].payload.sourceReportTimestamp).toBe("2026-06-20T12:00:00.000Z");
    // Do NOT assert on proposal.id — nextProposalId() uses a date+counter that shifts over time
  });
});
```

Run: `npx vitest run tests/adaptation/capability-evolution-proposal-generator.vitest.ts -t "gap finding" 2>&1 | tail -10`
Expected: FAIL — class not defined

- [ ] **Step 3: Write the full generator implementation in `src/adaptation/capability-evolution-proposal-generator.ts`**

Include the class with:
- Constructor taking `store: ProposalStore` and `writer: EvidenceEventWriter`
- `generateFromCapabilityEvolution(report, opts)` method
- `#collectCandidates(report, opts)` private method returning `FindingCandidate[]`
- `#buildProposal(candidate, report)` private method
- `#isDuplicate(dedupeKey, existing)` private method checking pending proposals
- All finding-type branches per the mapping table
- Top-N priority sort per the tier ordering
- Deduplication against pending proposals

- [ ] **Step 4: Run the gap test to verify it passes**

Run: `npx vitest run tests/adaptation/capability-evolution-proposal-generator.vitest.ts -t "gap finding" 2>&1 | tail -10`
Expected: PASS

- [ ] **Step 5: Write remaining tests and verify they pass**

Add tests for:

```ts
// overlap consolidationCandidate → proposal
it("generates proposal from overlap consolidation candidate", async () => { ... });
// Expected: action=create_improvement_issue, sourceConfidence=0.75, dedupeKey="capability-overlap:cap-a:cap-b"

// deprecated lifecycle → proposal
it("generates proposal from deprecated capability", async () => { ... });
// Expected: sourceConfidence=0.70, dedupeKey="capability-health:deprecated:old-cap"

// stagnant below usage threshold → skipped
it("skips stagnant capability below minCapabilityUsage", async () => { ... });
// Expected: result.generated === 0, result.skipped === 1

// declining meets thresholds → proposal
it("generates proposal from declining capability", async () => { ... });
// Expected: sourceConfidence=0.85, dedupeKey="capability-health:declining:weak-cap"

// drift split candidate → proposal
it("generates proposal from drift split candidate", async () => { ... });
// Expected: sourceConfidence=0.80, dedupeKey="capability-drift:overgrown-cap"

// max proposals cap (12 eligible → top 10)
it("caps proposals at maxProposalsPerRun", async () => { ... });

// deduplication by dedupeKey
it("skips duplicate dedupeKey already pending", async () => { ... });

// gap below signal strength threshold → skip
it("skips gap with signalStrength below minGapSignalStrength", async () => { ... });

// gap missing extra payload fields
it("includes finding-specific payload fields for each finding type", async () => { ... });
```

Run: `npx vitest run tests/adaptation/capability-evolution-proposal-generator.vitest.ts 2>&1 | tail -15`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add src/adaptation/capability-evolution-proposal-generator.ts tests/adaptation/capability-evolution-proposal-generator.vitest.ts
git commit -m "feat: CapabilityEvolutionProposalGenerator — gap/overlap/health/drift findings
to create_improvement_issue proposals with type-based confidence and dedupeKey"
```

---

### Task 2: CLI integration

**Files:**
- Modify: `src/cli/commands/adaptation.ts`
- Test: existing `tests/cli/commands/adaptation-generate.vitest.ts` (or extend if it exists)

**Interfaces:**
- Consumes: `CapabilityEvolutionProposalGenerator`, `CapabilityEvolutionStore`, `GenerateResult`
- Produces: extended `runGenerate()` that handles `--capability-evolution` flag

#### Changes to `src/cli/commands/adaptation.ts`

**1. Add imports:**

```ts
import { CapabilityEvolutionProposalGenerator } from "../../adaptation/capability-evolution-proposal-generator.js";
import { CapabilityEvolutionStore } from "../../adaptation/capability-evolution-store.js";
```

**2. Update `runGenerate` function:**

- Add `capabilityEvolutionIdx = args.indexOf("--capability-evolution")` to the flag checks
- Update the source flags validation to include the new flag:

```ts
const sourceFlagsPresent = [
  reflectionIdx >= 0,
  effectivenessIdx >= 0,
  allEffIdx >= 0,
  capabilityEvolutionIdx >= 0,
].filter(Boolean).length;
```

- Update error message to include `--capability-evolution` in the options list
- Add handler block after the `--all-effectiveness` block:

```ts
if (capabilityEvolutionIdx >= 0) {
  const capabilityEvolutionStore = new CapabilityEvolutionStore(join(cwd, ".alix", "adaptation", "capability-evolution"));
  const generator = new CapabilityEvolutionProposalGenerator(store, writer);

  const reportIdx = args.indexOf("--report");
  let report: CapabilityEvolutionReport;
  if (reportIdx >= 0) {
    const reportPath = args[reportIdx + 1];
    if (!reportPath) {
      console.error("Missing value for --report <path>");
      process.exit(1);
    }
    if (!existsSync(reportPath)) {
      console.error(`Report file not found: ${reportPath}`);
      process.exit(1);
    }
    try {
      report = JSON.parse(readFileSync(reportPath, "utf-8")) as CapabilityEvolutionReport;
    } catch (err) {
      console.error(`Failed to parse report: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  } else {
    const latest = await capabilityEvolutionStore.loadLatest();
    if (!latest) {
      console.error("No CapabilityEvolutionReport found. Run 'alix adaptation capability-evolution' first, or pass --report <path>.");
      process.exit(1);
    }
    report = latest;
  }

  const opts: CapabilityEvolutionGenerateOptions = {};
  const mgssIdx = args.indexOf("--min-gap-signal-strength");
  if (mgssIdx >= 0) opts.minGapSignalStrength = Number(args[mgssIdx + 1]);
  const mdmIdx = args.indexOf("--min-drift-magnitude");
  if (mdmIdx >= 0) opts.minDriftMagnitude = Number(args[mdmIdx + 1]);
  const mcuIdx = args.indexOf("--min-capability-usage");
  if (mcuIdx >= 0) opts.minCapabilityUsage = Number(args[mcuIdx + 1]);
  const mpIdx = args.indexOf("--max-proposals");
  if (mpIdx >= 0) opts.maxProposalsPerRun = Number(args[mpIdx + 1]);

  const result = await generator.generateFromCapabilityEvolution(report, opts);
  printGenerateSummary(result);
  return;
}
```

**3. Update the generate usage line** (in `printUsage`):

Add `--capability-evolution` to the existing generate line:
```
"  generate --reflection <path> | --effectiveness <id> | --all-effectiveness | --capability-evolution [--report <path>] [options]"
```

#### Steps

- [ ] **Step 1: Add imports and update source-flag validation in `runGenerate`**

Add the `capabilityEvolutionIdx` variable and update the source flags count and error message.

- [ ] **Step 2: Add the `--capability-evolution` handler block**

Write the full handler with `--report` path loading and store-based fallback.

- [ ] **Step 3: Update usage line in `printUsage`**

Add `--capability-evolution` with its flags to the generate usage line.

- [ ] **Step 4: Run full test suite to verify no regressions**

Run: `npx vitest run 2>&1 | tail -5`
Expected: All tests pass

- [ ] **Step 5: Run TypeScript check**

Run: `npx tsc --noEmit 2>&1 | grep -E 'capability-evolution-proposal|src/cli/commands/adaptation'`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/adaptation.ts
git commit -m "feat: CLI — alix adaptation generate --capability-evolution"
```

---

### Task 3: Verification + PR

**Files:** All of the above.

- [ ] **Step 1: Run full test suite**

```bash
npx vitest run 2>&1 | tail -10
```
Expected: All tests pass

- [ ] **Step 2: Run TypeScript check**

```bash
npx tsc --noEmit 2>&1 | head -20
```
Expected: No P5.6-related errors

- [ ] **Step 3: Run gitnexus detect_changes**

```bash
npx gitnexus detect_changes repo ALiX scope all
```
Expected: Low risk, 0 affected processes

- [ ] **Step 4: Create branch, push, PR, tag**

```bash
git checkout -b feature/p5.6-capability-evolution-proposal-generation
git push origin feature/p5.6-capability-evolution-proposal-generation
gh pr create --title "P5.6: Capability Evolution Proposal Generator" --body "..."
git tag alix-p5.6-complete <sha>
git push origin alix-p5.6-complete
```
