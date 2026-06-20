# P5.6 — Capability Evolution Proposal Generator Design Spec (SDS)

> **Status:** Draft — awaiting review.
> **Plan:** `docs/superpowers/plans/2026-06-20-p5-6-capability-evolution-proposal-generation.md` (to be written after SDS approval)
> **Risk level:** LOW — proposal-only, no mutations, follows P5.2c governance pattern exactly.

## Core question

> Given a `CapabilityEvolutionReport` (P5.5), which findings warrant human investigation?

P5.5 answers "what shape should the capability graph become?"
P5.6 answers "which findings should become investigation proposals?"

This is the proposal-generation counterpart to P5.5, following the same proven pattern as P5.0→P5.1 (Reflection→Adaptation) and P5.3→P5.4 (Intelligence→Prioritization).

## Hard governance boundary (non-negotiable)

```
P5.6 generates create_improvement_issue proposals only.
P5.6 does NOT create agent cards.
P5.6 does NOT add capabilities.
P5.6 does NOT merge capabilities.
P5.6 does NOT deprecate capabilities.
P5.6 does NOT modify the capability graph.

auto-generate ≠ approve ≠ apply ≠ mutate
```

Every P5.6 output is a **pending** `create_improvement_issue` proposal that a human reviews, approves, and acts on (or rejects). P5.6 never touches `ApprovalGate`, `AgentCardApplier`, `SkillApplier`, or any mutation path.

## Architecture

```
CapabilityEvolutionReport (P5.5)
  │
  ├── healthAnalysis ──→ stagnant/deprecated/declining → issue
  ├── gapAnalysis ─────→ signalStrength >= 2          → issue
  ├── overlapAnalysis ─→ consolidationCandidate        → issue
  └── driftAnalysis ───→ splitCandidate                → issue
  │
  ▼
CapabilityEvolutionProposalGenerator
  │
  ├── apply per-finding thresholds
  ├── build create_improvement_issue proposals
  ├── save via ProposalStore
  ├── record adaptation_proposed evidence
  └── return GenerateResult
  │
  ▼
Pending AdaptationProposal[]
  status: "pending", provenance: "auto"
  ↓ human approve → human apply
```

## Generator design

### Class signature

```ts
class CapabilityEvolutionProposalGenerator {
  constructor(
    private readonly store: ProposalStore,
    private readonly writer: EvidenceEventWriter,
  ) {}

  async generateFromCapabilityEvolution(
    report: CapabilityEvolutionReport,
    opts?: CapabilityEvolutionGenerateOptions,
  ): Promise<GenerateResult>;
}
```

Follows the same pattern as `AutomaticProposalGenerator.generateFromReflection` and `generateFromEffectiveness`.

### Options

```ts
interface CapabilityEvolutionGenerateOptions {
  /** Minimum gap signal strength (default 2). */
  minGapSignalStrength?: number;
  /** Minimum drift magnitude (default 0.5, matches splitCandidate). */
  minDriftMagnitude?: number;
  /** Minimum resolution count for health-based findings (default 5). */
  minCapabilityUsage?: number;
  /** Maximum proposals generated per run (default 10, top-N by priority). */
  maxProposalsPerRun?: number;
}
```

### Finding → proposal mapping

All findings map to `action: "create_improvement_issue"`. No other action type is used.

| Finding source | Condition | Title pattern | Priority signal |
|---|---|---|---|
| `gapAnalysis[]` | `signalStrength >= minGapSignalStrength` | `Investigate adding capability for "<suggestedCapability>"` | Multi-signal convergence (strongest) |
| `overlapAnalysis[]` | `consolidationCandidate == true` | `Investigate consolidating "<capabilityA>" and "<capabilityB>"` | overlapScore |
| `healthAnalysis[]` | `lifecycleState === "deprecated"` | `Investigate removing deprecated capability "<capability>"` | resolutionCount (lowest = most urgent) |
| `healthAnalysis[]` | `lifecycleState === "stagnant"` AND `resolutionCount >= minCapabilityUsage` | `Investigate refreshing stagnant capability "<capability>"` | days since last resolution (oldest = most urgent) |
| `healthAnalysis[]` | `lifecycleState === "declining"` AND `resolutionCount >= minCapabilityUsage` | `Investigate declining capability "<capability>"` | revertRate (highest = most urgent) |
| `driftAnalysis[]` | `splitCandidate == true` AND `driftMagnitude >= minDriftMagnitude` | `Investigate splitting capability "<capability>"` | driftMagnitude (largest = most urgent) |

### Proposal payload

Each proposal carries a structured payload so the reviewer has context:

```ts
{
  capabilityEvolutionGeneratedAt: string;  // ISO timestamp of the source report
  findingType: "gap" | "overlap" | "deprecated" | "stagnant" | "declining" | "drift";
  findingDetail: string;                   // Human-readable summary of the finding
  signalStrength?: number;                 // for gaps
  overlapScore?: number;                   // for overlaps
  lifecycleState?: string;                 // for health findings
  driftMagnitude?: number;                 // for drift findings
  sourceReportTimestamp: string;           // when the report was generated
}
```

### Priority ordering (top-N)

When the number of eligible findings exceeds `maxProposalsPerRun`, order by:

1. **gap findings** (multi-signal convergence = strongest signal of real need)
2. **declining capabilities** (actively degrading — urgency)
3. **drift split candidates** (scope fragmentation)
4. **overlap consolidation candidates** (duplication)
5. **deprecated capabilities** (cleanup — low urgency)
6. **stagnant capabilities** (lowest urgency — not actively degrading)

Within each tier, sort by the priority signal column in the mapping table above (descending for numeric signals).

### Deduplication

Before generating, check if there is already a **pending** proposal with:
- `action === "create_improvement_issue"`
- `target.title` matching the proposed title (exact match)

If found, skip generation and count as skipped. This prevents re-generating the same investigation issue across multiple runs.

## CLI integration

Extends the existing `alix adaptation generate` subcommand:

```bash
alix adaptation generate --capability-evolution [--report <path>] [options]
```

Follows existing flag pattern:

| Flag | Purpose |
|---|---|
| `--capability-evolution` | Enables capability-evolution generation mode |
| `--report <path>` | Path to a CapabilityEvolutionReport JSON file (default: load latest from CapabilityEvolutionStore via `loadLatest()`)|
| `--min-gap-signal-strength <n>` | Override default threshold (default 2) |
| `--min-drift-magnitude <n>` | Override default threshold (default 0.5) |
| `--min-capability-usage <n>` | Override default threshold (default 5) |
| `--max-proposals <n>` | Override default cap (default 10) |

Output format follows the existing `generate` output pattern:

```
Generated: N proposal(s) [prop-2026-06-20-001, ...]
Skipped: M (duplicate or below threshold)
```

## Evidence recording

Reuses the existing `adaptation_proposed` evidence type with `provenance: "auto"`:

```ts
await this.writer.recordAdaptationProposed(proposal.id, {
  createdAt: proposal.createdAt,
  action: "create_improvement_issue",
  target: proposal.target,
  sourceRecommendationType: "capability_evolution_proposal",
  sourceConfidence: 1, // deterministic — derived from signal thresholds
  provenance: "auto",
  payload: proposal.payload,
});
```

No new evidence types are needed.

## Error handling

- **Missing report (no `--report`, no latest in store):** Print error and exit with code 1 (same as other generation paths).
- **Corrupt report file:** `JSON.parse` failure → print error, exit with code 1.
- **ProposalStore save failure:** Let the exception propagate (same as P5.2c).
- **Evidence recording failure:** Best-effort — log but don't abort (same as P5.2c).
- **Empty findings after thresholds:** Print `No actionable findings — 0 proposals generated` and exit cleanly.

## Testing

| Test | Description |
|---|---|
| Generator: gap finding → proposal | gap signal >= 2 → `create_improvement_issue` with correct title |
| Generator: overlap finding → proposal | consolidationCandidate → issue with both capability names |
| Generator: deprecated → proposal | lifecycleState deprecated → issue |
| Generator: stagnant (below usage threshold) → skip | resolutionCount < minCapabilityUsage → skipped |
| Generator: declining (meets thresholds) → proposal | keepRate < 0.5 → issue |
| Generator: drift split → proposal | splitCandidate → issue |
| Generator: max proposals cap | 12 eligible → top 10 generated, 2 skipped |
| Generator: deduplication | Same title already pending → skipped |
| Generator: gap below threshold → skip | signalStrength = 1 < minGapSignalStrength=2 → skipped |
| CLI: `--report <path>` | Loads from file path |
| CLI: no `--report` | Loads latest from store via CapabilityEvolutionStore |

## Explicitly out of scope

| Feature | Reason |
|---|---|
| Modifying agent cards, skills, or routing | Human-only structural topology changes |
| Auto-approving or auto-applying proposals | Governance invariant — human gate required |
| Merging or deleting capabilities | Requires P6.x capability lifecycle management |
| Creating capabilities or agents from placeholders | Insufficient information — human investigation needed first |
| Parallel execution of multiple generation sources | Each `generate` invocation handles one source at a time |
