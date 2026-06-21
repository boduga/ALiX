# P6.0 — Decision Influence Layer

> **Status:** Spec — awaiting review
> **Slice:** P6.0a (DecisionArtifact + DecisionContext)
> **Builds on:** v0.5.0 Governed Adaptation Platform + P5.7 Trustworthiness Hardening
> **Blocks:** P6.1–P6.5 (Risk, Recommendation, Queue, Strategic Briefs)
> **Risk level:** LOW — read-only, no mutation paths, no new evidence types

## Core Framing

**Core question:** Can ALiX turn its accumulated telemetry, lineage, intelligence, and governance evidence into human-usable decision support?

**Invariant:** Recommend ≠ Decide — recommendation engines are read-only consumers of governance artifacts. Read access everywhere, write access nowhere.

**Architectural rule:** Recommendation engines may read ProposalStore, EvidenceStore, LineageGraph, EffectivenessStore, IntelligenceStore, and priority rankings. They may NOT create proposals, approve proposals, apply proposals, modify stores, or trigger appliers.

**Architectural progression:**

```
P4  = Observe
P5  = Learn
P5.7 = Verify
P6  = Influence        ← here
P7  = Delegate
P8  = Governed Autonomy
```

**Six governance invariants (P5 + P6):**

```
Generate ≠ Approve
Approve ≠ Apply
Apply ≠ Mutate Topology
Observe ≠ Revert
Learn ≠ Evolve
Recommend ≠ Decide    ← P6.0
```

**Mission statement:**

> P5.7 made the system trustworthy. P6.0 makes that trust usable.

## DecisionArtifact — Common Pattern

Every P6 layer produces artifacts with the same base shape:

```typescript
interface DecisionArtifact {
  id: string;
  subject: string;
  outcome: string;
  confidence: number;
  reasons: string[];
  warnings?: string[];
  evidenceRefs?: string[];
  generatedAt: string;
}
```

Specialized forms inherit this shape and extend it per layer:

| Layer | Specialization | Extension |
|-------|---------------|-----------|
| **P6.0a** DecisionContext | Per-proposal context snapshot | LineageGraph, effectiveness trends, similar proposals |
| **P6.1** RiskScore | Multi-dimension risk assessment | `risks: RiskItem[]` (operational, governance, capability, revert, evidence quality) |
| **P6.2** Recommendation | Approval guidance | `recommendation: "approve" \| "reject" \| "defer" \| "investigate"` |
| **P6.3** QueueItem | Prioritized operator item | `priority: number`, `queuePosition` |
| **P6.4** StrategicBrief | Aggregate system view | `period: { start, end }`, `metrics: Trend[]`, `actions: BriefAction[]` |

Each layer adds judgment, but the base pattern (`outcome + confidence + reasons + evidence + warnings`) stays consistent across all of them.

## P6.0a — First Slice: DecisionContext

**Core question:** Given a proposal, what does ALiX know about it right now?

DecisionContext answers: context, not judgment. It is a read-only snapshot of everything the system knows about a single proposal at a point in time. No risk scores, no recommendations — just context.

### DecisionContext Type

```typescript
export type ContextStatus =
  | "complete_context"    // proposal found, lineage traced, evidence available
  | "partial_context"     // some data missing (e.g., no effectiveness history)
  | "stale_context"       // proposal has had no activity for >30 days
  | "insufficient_data";  // proposal not found or critical data missing

export interface SourceArtifact {
  type: "proposal" | "lineage" | "effectiveness" | "intelligence" | "priority";
  id: string;
  timestamp?: string;
}

export interface DecisionContext {
  // Artifact identity (base DecisionArtifact shape)
  id: string;
  subject: string;
  contextStatus: ContextStatus;
  /** Evidence completeness — NOT recommendation confidence.
   *  Computed from: proposal found, lineage completeness, evidence refs,
   *  effectiveness history, similar proposals, warnings count. */
  confidence: number;
  reasons: string[];
  warnings?: string[];
  evidenceRefs: string[];
  generatedAt: string;

  // Proposal state
  proposalId: string;
  proposalStatus: string;
  proposalAction: string;
  createdAt: string;
  ageDays: number;

  // Lifecycle context (consumed from LineageBuilder)
  lineage?: LineageGraph;
  lineageCompleteness: "partial" | "complete" | "broken";

  // Intelligence context — similar proposals by action type
  similarProposals: Array<{
    proposalId: string;
    action: string;
    outcome: string;
    confidence: number;
  }>;

  // Effectiveness history for this proposal's action type
  effectivenessTrend: {
    actionType: string;
    keepRate: number;
    revertRate: number;
    sampleSize: number;
  };

  // Provenance — what went into this context
  sourceArtifacts: SourceArtifact[];
}
```

### Confidence Computation

Confidence reflects **evidence completeness**, not recommendation certainty:

| Factor | Contribution |
|--------|-------------|
| Proposal found | +0.30 |
| Lineage completeness = "complete" | +0.20 |
| Lineage completeness = "partial" | +0.10 |
| Lineage completeness = "broken" | -0.10 |
| ≥1 evidence fingerprint present | +0.15 |
| Effectiveness history available | +0.15 |
| Similar proposals available | +0.10 |
| Per warning | -0.05 |
| contextStatus = "stale" | -0.10 |
| contextStatus = "insufficient_data" | 0.00 (forced) |

Final confidence is clamped to [0, 1] and rounded to 2 decimal places.

### DecisionContextBuilder

```typescript
class DecisionContextBuilder {
  constructor(
    private readonly proposalStore: ProposalStore,
    private readonly evidenceStore: EvidenceStore,
    private readonly lineageBuilder: LineageBuilder,
    private readonly effectivenessStore: EffectivenessStore,
    private readonly intelligenceStore: IntelligenceStore,
  ) {}

  async build(proposalId: string): Promise<DecisionContext>;
}
```

**Read-only rule:** `DecisionContextBuilder` may read from stores. It must never call `save()`, `update()`, `approve()`, `apply()`, `reject()`, or any applier/generator method. This is enforced by a governance sentinel test.

**Behavior per state:**

| Scenario | contextStatus | confidence | warnings |
|----------|--------------|-----------|----------|
| Proposal not found | `insufficient_data` | 0.00 | Proposal not found |
| Pending proposal | `partial_context` | 0.60+ | — |
| Applied proposal with full lineage | `complete_context` | 0.85+ | — |
| Applied proposal with effectiveness | `complete_context` | 0.95+ | — |
| No activity for >30 days | `stale_context` | calculated - 0.10 | Proposal may be stale |
| Broken lineage | `partial_context` | lower | Lineage integrity warnings propagated |

### CLI

```bash
alix decision context <proposal-id>
alix decision context <proposal-id> --json
```

Terminal output:
```
Decision Context: prop-2026-06-20-001
──────────────────────────────────────
Status: complete_context
Confidence: 0.85 (evidence complete)

Proposal: update_agent_card (applied)
Created: 2026-06-18 (2 days ago)

Lineage: complete — 4 lifecycle stages traced

Effectiveness trend (update_agent_card):
  Keep rate: 78%  (n=23)
  Revert rate: 8%

Sources:
  📄 proposal: prop-2026-06-20-001
  🔗 lineage: 4 nodes, 4 edges
  📊 effectiveness: prop-2026-06-20-001
  🧠 intelligence: report 2026-06-20

No warnings.
```

The new `alix decision` subcommand tree is created alongside existing CLI commands. Only `context` is implemented in P6.0a; other subcommands (`risk`, `recommend`, `queue`, `brief`) are added in later slices.

### File Structure

```
Create:
  src/adaptation/decision-types.ts         — DecisionArtifact, DecisionContext, ContextStatus, SourceArtifact
  src/adaptation/decision-context-builder.ts — DecisionContextBuilder
  src/cli/commands/decision.ts             — `alix decision` CLI subcommand tree
  tests/adaptation/decision-context-builder.vitest.ts
  tests/adaptation/decision-governance-sentinels.vitest.ts

Modify:
  src/cli/index.ts or equivalent router    — register `alix decision` command
```

### Governance Sentinel

A new sentinel file `tests/adaptation/decision-governance-sentinels.vitest.ts` verifies:

1. **DecisionContextBuilder must not import** `approval-gate`, `agent-card-applier`, `skill-applier`, `revert-applier`, or any generator
2. **DecisionContextBuilder may import stores** for read access only — the sentinel checks that `save`, `update` are not called (module-level grep, same pattern as P5.7a sentinels)

### Tests

| Test | Scenario |
|------|----------|
| Minimal context for pending proposal | Proposal found, `partial_context`, no lineage, no effectiveness |
| Full context for applied proposal | Applied + complete lineage + effectiveness, `complete_context` |
| Stale proposal detection | Last activity >30 days, `stale_context` |
| Missing proposal handling | Proposal not found, `insufficient_data`, warning emitted |
| Confidence reflects evidence completeness | Missing data lowers confidence, warnings lower confidence |
| Source artifacts populated | `sourceArtifacts` lists every consumed artifact |
| Similar proposals included | Intelligence store queried for matching action type |
| Read-only sentinel passes | Governance invariant verified |
| CLI terminal output | Formatted summary with sections |
| CLI --json output | Valid DecisionContext JSON |

### Acceptance Criteria

1. `DecisionContext` type matches this spec exactly (ContextStatus, SourceArtifact pattern)
2. `DecisionContextBuilder.build(id)` produces a DecisionContext for any valid proposal
3. `confidence` reflects evidence completeness (not recommendation certainty)
4. `contextStatus` correctly reports all 4 states
5. `sourceArtifacts` lists every consumed artifact
6. CLI `alix decision context <id>` renders terminal output
7. CLI `alix decision context <id> --json` outputs valid JSON
8. Governance sentinel test passes (read-only invariant)
9. All existing tests pass

## Out of Scope for P6.0a

| Feature | Layer | Reason |
|---------|-------|--------|
| Risk scoring | P6.1 | Needs DecisionContext as input |
| Approval recommendations | P6.2 | Needs DecisionContext + RiskScore |
| Operator queue views | P6.3 | Needs all previous layers |
| Strategic briefs | P6.4 | Needs aggregate across proposals |
| Store mutation | — | Violates Recommend ≠ Decide invariant |
| New evidence types | — | Not needed — DecisionContext reads existing stores |

## Release Boundary

P6.0 does not produce a new minor release. Version stays at `v0.5.0`. The milestone tag for the complete P6.0 layer (including future P6.1–P6.4) will be `alix-p6.0-complete`. P6.0a is tagged as `alix-p6.0a-complete` for intermediate tracking.
