# P5.5 — Capability Evolution Intelligence Design Spec (SDS)

> **Status:** Draft — awaiting review.
> **Plan:** `docs/superpowers/plans/2026-06-19-p5-5-capability-evolution-intelligence.md` (to be written after SDS approval)
> **Risk level:** LOW — pure read + compute + save report. No mutations, no capability changes, no registry writes.

## Core question

> Is the current capability model still the right capability model?

P5.3 asks "what changes work?" P5.4 asks "what deserves attention?"  
P5.5 asks **"should the system's capability structure itself evolve?"**

This is the first phase where ALiX evaluates its own topology — moving from learning about actions to learning about its own architecture.

## Hard governance boundary (non-negotiable)

```
CapabilityEvolutionReport ≠ CapabilityEvolutionProposal
Capability finding        ≠ Capability mutation

P5.5 observes and analyzes.
P5.5 does NOT create capabilities.
P5.5 does NOT modify agents, skills, or the capability registry.
P5.5 does NOT generate proposals.

A CapabilityEvolutionReport is an observation.
Only a human may approve capability changes.
```

Same pattern as P5.3 (IntelligenceReport) and P5.4 (PriorityReport): read-only analysis.

## Summary of design decisions

| Decision | Choice |
|---|---|
| Scope | All registered capabilities across all agent cards |
| Capability lifecycle | `emerging`, `active`, `mature`, `stagnant`, `declining`, `deprecated` |
| Analyzers | 4: Health, Gap, Overlap, Drift |
| Output | `CapabilityEvolutionReport` — observations only, no proposals |
| Data sources | AgentCard registry, CapabilityResolver, IntelligenceReport byCapability bucket, ProposalStore, EvidenceStore |
| Governance | Finding ≠ Proposal ≠ Mutation. Pure read + compute + save. |
| Persistence | `.alix/adaptation/capability-evolution/<generatedAt>.json` |

## Architecture

```
AgentCard Registry ──┐  (all registered capabilities)
CapabilityResolver ──┤  (resolution patterns, missing caps)
IntelligenceStore ───┤  (byCapability bucket metrics)
ProposalStore ───────┤  (proposals targeting capabilities)
EvidenceStore ───────┤  (capability evidence events)

                      ├── CapabilityHealthAnalyzer
                      │     For each registered capability:
                      │       - usage frequency (how often resolved)
                      │       - keep rate from byCapability bucket
                      │       - revert rate from byCapability bucket
                      │       - proposal volume targeting this capability
                      │       - success trend over time
                      │       → lifecycle state assignment
                      │
                      ├── CapabilityGapAnalyzer
                      │     Analyze unresolved capability references,
                      │     reflection reports mentioning missing capabilities,
                      │     proposals with "capability" target kind
                      │       → gap candidates with evidence
                      │
                      ├── CapabilityOverlapAnalyzer
                      │     Compare capability descriptions, proposal targets,
                      │     agent assignments, resolution patterns
                      │       → overlap scores between capability pairs
                      │
                      ├── CapabilityDriftAnalyzer
                      │     Compare registered capability purpose vs actual usage
                      │     (proposal targets, resolution patterns, agent
                      │      assignments over time)
                      │       → drift flags for capabilities whose scope expanded
                      │
                      └── CapabilityEvolutionReporter
                            Orchestrate analyzers
                            Assemble CapabilityEvolutionReport
                            Persist to .alix/adaptation/capability-evolution/
                            CLI output
```

## The 10 design questions

### 1. What inputs are analyzed?

| Source | What is read | Purpose |
|---|---|---|
| AgentCard registry | All registered agent cards + their `capabilities: string[]` | List of every registered capability across all agents |
| CapabilityResolver | Resolution inputs/outputs from EvidenceStore (`capability_routed` events) | How often each capability is resolved, success rate |
| IntelligenceStore | Latest IntelligenceReport's `byCapability` buckets | Keep/revert/approval rates per capability |
| ProposalStore | All proposals where `target.kind === "capability"` or `payload.capability` is set | Proposal volume targeting specific capabilities |
| EvidenceStore | `capability_routed`, `agent_resolved` events | Resolution frequency, which capabilities are being requested |
| EvidenceStore | Reflection reports mentioning missing capabilities | Gap signals from the reflection layer |
| EvidenceStore | Goal decomposition outputs (from workflow events) | How often each capability is referenced in goal breakdowns — forward-looking demand signal |
| EffectivenessStore | Effectiveness reports for proposals targeting capabilities | Outcome data per capability |

### 2. What outputs are produced?

**CapabilityEvolutionReport:**
```ts
interface CapabilityEvolutionReport {
  generatedAt: string;
  /** Total registered capabilities across all agent cards. */
  totalCapabilities: number;
  /** Analyzed capabilities with sufficient data. */
  healthAnalysis: CapabilityHealth[];
  /** Discovered capability gaps (recurring unresolved needs). */
  gapAnalysis: CapabilityGap[];
  /** Pairwise overlap scores between capabilities. */
  overlapAnalysis: CapabilityOverlap[];
  /** Capabilities whose scope has drifted from original purpose. */
  driftAnalysis: CapabilityDrift[];
  /** Distribution of capabilities across lifecycle states. */
  lifecycleDistribution: Record<LifecycleState, number>;
  /** Natural-language executive summary. */
  executiveSummary: string;
}
```

**CapabilityHealth:**
```ts
type LifecycleState = "emerging" | "active" | "mature" | "stagnant" | "declining" | "deprecated";

interface CapabilityHealth {
  capability: string;
  /** Number of agents that register this capability. */
  agentCount: number;
  /** How many times this capability was resolved (from evidence). */
  resolutionCount: number;
  /** Resolution count in the most recent 30-day window (for trend). */
  resolutionCountRecent: number;
  /** Resolution count 30-60 days ago (for trend comparison). */
  resolutionCountPrior: number;
  /** Proposal count in the most recent 30-day window (for trend). */
  proposalCountRecent: number;
  /** Proposal count 30-60 days ago (for trend comparison). */
  proposalCountPrior: number;
  /**
   * Demand score 0-1 combining:
   *   - goal decomposition references (forward-looking)
   *   - reflection reports mentioning this capability
   *   - unresolved capability_routed events
   * Higher = more latent demand than current coverage can satisfy.
   */
  demandScore: number;
  /** Historical keep rate from IntelligenceReport byCapability bucket. */
  keepRate: number | null;
  /** Historical revert rate. */
  revertRate: number | null;
  /** Total number of proposals targeting this capability. */
  proposalCount: number;
  /** Computed lifecycle state (trend-aware — see Q3). */
  lifecycleState: LifecycleState;
  /** Rationale for the lifecycle assignment. */
  rationale: string;
}
```

**CapabilityGap:**
```ts
interface CapabilityGap {
  /** Suggested capability name (derived from evidence). */
  suggestedCapability: string;
  /** Evidence supporting this gap. */
  evidence: string[];
  /** How many distinct signals point to this gap. */
  signalStrength: number;  // 1-3: weak, medium, strong
  /** Confidence in this gap being real. */
  confidence: "high" | "medium" | "low";
}
```

**CapabilityOverlap:**
```ts
interface CapabilityOverlap {
  capabilityA: string;
  capabilityB: string;
  /** Symmetric 0-1 overlap score (combined). */
  overlapScore: number;
  /** Proportion of A's agents/proposals that also involve B (0-1). */
  coverageAtoB: number;
  /** Proportion of B's agents/proposals that also involve A (0-1). */
  coverageBtoA: number;
  /**
   * Directional asymmetry. > 0 means A is more dependent on B than vice versa;
   * < 0 means B is more dependent on A. Near 0 = symmetric overlap.
   */
  asymmetry: number;
  /** Number of shared signals. */
  sharedSignalCount: number;
  /** Whether this is a consolidation candidate (score > 0.7). */
  consolidationCandidate: boolean;
}
```

**CapabilityDrift:**
```ts
interface CapabilityDrift {
  capability: string;
  /** Original scope (from agent card description or first appearance in proposals). */
  originalScope: string;
  /** Current observed scope (from resolution patterns and proposals). */
  currentScope: string;
  /** Drift magnitude 0-1. */
  driftMagnitude: number;
  /** Whether this is a split candidate (magnitude > 0.5). */
  splitCandidate: boolean;
}
```

### 3. How is the capability lifecycle determined?

Lifecycle state is computed **deterministically with trend inputs** — not just point-in-time snapshots but also whether metrics are improving, stable, or degrading.

**Trend computation:**
- `resolutionTrend`: `resolutionCountRecent - resolutionCountPrior`. Positive = growing usage. Negative = shrinking usage.
- `proposalTrend`: `proposalCountRecent - proposalCountPrior`. Positive = increasing attention. Negative = decreasing attention.
- Three trend directions: `rising` (change > 20%), `stable` (change between -20% and 20%), `falling` (change < -20%).

| Lifecycle | Point-in-time criteria | Trend signals | Meaning |
|---|---|---|---|
| `emerging` | resolutionCount > 0 AND proposalCount < 5 | resolutionTrend = rising OR stable | New capability gaining traction, insufficient data for full assessment |
| `active` | resolutionCount ≥ 10 AND keepRate ≥ 0.6 AND revertRate < 0.15 AND proposalCount ≥ 5 | resolutionTrend ≠ falling, proposalTrend ≠ falling | Healthy, growing or stable usage |
| `mature` | resolutionCount ≥ 50 AND keepRate ≥ 0.75 AND revertRate < 0.1 AND proposalCount ≥ 20 | resolutionTrend = stable, proposalTrend = stable | Well-established, reliable, steady-state |
| `stagnant` | resolutionCount > 0 | resolutionTrend = stable AND proposalTrend = falling OR (keepRate ≥ 0.5 AND no growth signals) | Not declining but not growing — usage not increasing |
| `declining` | keepRate < 0.5 OR revertRate > 0.2 | resolutionTrend = falling OR proposalTrend = falling | Performance degrading and/or usage dropping |
| `deprecated` | resolutionCount = 0 OR agentCount = 0 | N/A (no activity to trend) | No longer used by any agent or resolution system |

**Tiebreaker rules:**
- A capability that meets criteria for both `active` and `mature` → prefers `mature` (conservative upgrade).
- A capability that meets criteria for both `active` and `declining` → prefers `declining` (falling trend overrides point-in-time health).
- A capability that meets criteria for both `stagnant` and `emerging` → prefers `emerging` (any observed usage + low count = emerging).

If insufficient data exists for a capability (no IntelligenceReport bucket, no proposals), the state defaults to `emerging` with a note explaining the data gap.

**State transitions are observations, not actions.** The report may note "capability X meets criteria for `declining` (keep rate 0.40, resolution trending down 35%)" — it does not deprecate or remove anything.

### 4. How are capability gaps detected?

Gaps are detected by aggregating three signal types:

**Signal 1 — Unresolved capabilities (from EvidenceStore):**  
Query `capability_routed` evidence events where `resolvedAgent` was empty or had zero candidates. These are capability requests that ALiX could not fulfill. Group by requested capability name → top unfulfilled requests become gap candidates.

**Signal 2 — Reflection reports (from EvidenceStore):**  
Query reflection reports mentioning missing capabilities. The existing `CapabilityAnalyzer` (P5.0) already detects `capability_gap` recommendations. Cross-reference these with gap candidates.

**Signal 3 — Proposals targeting capabilities that don't exist:**  
Query ProposalStore for proposals with `target.kind === "capability"` where the capability value doesn't match any registered capability across all agent cards. These are proposals to improve a capability that doesn't exist yet.

A gap is "strong" when all three signals converge, "medium" when two converge, "weak" when one signal exists.

### 5. How is overlap measured?

Overlap is a pairwise score between any two registered capabilities, computed **directionally** to reveal dependency and containment relationships:

```
overlapScore = 0.4 × sharedAgentProportion + 0.3 × sharedProposalProportion + 0.3 × sharedResolutionPattern
```

Where:
- **sharedAgentProportion**: ratio of agents that have BOTH capabilities to agents that have at least one. High overlap means the two capabilities are almost always paired.
- **sharedProposalProportion**: ratio of proposals that reference BOTH capabilities to proposals referencing at least one. High overlap means proposals tend to target them together.
- **sharedResolutionPattern**: ratio of resolution events where both capabilities were resolved together.

**Directional coverage** is computed to reveal which capability is the primary vs secondary:

```
coverageAtoB = agents with BOTH / agents with A
coverageBtoA = agents with BOTH / agents with B
asymmetry = coverageAtoB - coverageBtoA
```

If `coverageAtoB` is high (0.9) but `coverageBtoA` is low (0.3), capability A rarely exists without capability B, but B is frequently used without A. This suggests B may be the primary capability and A a specialization — a split or rename candidate rather than consolidation.

Only pairs with `overlapScore > 0.3` are reported (lower scores indicate no meaningful overlap). Pairs with `overlapScore > 0.7` are flagged as `consolidationCandidate: true`.

**Note on data sparsity:** Early on, agent overlap will dominate because most capabilities exist on few agents. The resolution pattern signal will be sparse. This is expected — overlap confidence improves as more data accumulates.

### 6. How is drift detected?

Drift measures whether a capability's actual usage matches its intended scope.

**Original scope:** Derived from a combination of:
- Agent card descriptions for agents that register this capability
- First proposals that referenced this capability (their reason/payload text)
- Capability name itself (e.g., "code-review" has a clear scope)

**Current scope:** Derived from:
- Recent proposals targeting this capability (last 30 days)
- Resolution patterns — what workflows/routes is this capability being resolved for?
- Agent cards — what agents register this capability and for what purpose?

Drift magnitude is computed as semantic distance between original scope keywords and current scope keywords. Since P5.5 avoids LLM calls, this uses a keyword-based approach:

1. Extract keywords from original scope (agent card descriptions + early proposals).
2. Extract keywords from current scope (recent proposals + resolution patterns).
3. Compute Jaccard distance between keyword sets: `1 - (intersection / union)`.
4. If distance > 0.5, flag as `splitCandidate: true`.

Drift is not inherently bad — a capability whose scope legitimately expanded (e.g., "routing" from simple task routing to full capability-based routing) is healthy. The report notes the drift and lets the operator decide whether a split or scope update is warranted.

### 7. What CLI command exposes it?

```
alix adaptation capability-evolution
alix adaptation capability-evolution --json
```

**Flags:**
| Flag | Type | Default | Description |
|---|---|---|---|
| `--json` | boolean | false | Output raw CapabilityEvolutionReport as JSON |

**No `--since`/`--until` flags** — P5.5 always analyzes all available data. The IntelligenceReport it reads already has a data window; P5.5 inherits that scope.

**Default output (terminal):**

```
=== Capability Evolution Intelligence Report ===
Generated: 2026-06-19T23:30:00.000Z
Capabilities registered: 24 | Health assessed: 18 | Gaps found: 3

Executive Summary:
24 registered capabilities across 8 agent cards.
18 capabilities have sufficient data for health assessment.
3 capabilities are in "declining" state — review recommended.
2 potential gaps identified: vector-search, semantic-ranking.

--- Lifecycle Distribution ---
Emerging:   4
Active:     7
Mature:     3
Stagnant:   2
Declining:  1
Deprecated: 0

--- Capability Health ---
Capability              Agents  Resolved  Keep   Revert  State
workflow.planning       3       143       0.91   0.01    mature
code-review             2       87        0.85   0.05    active
github.integration      1       42        0.78   0.08    active
capability.management   2       12        0.65   0.18    stagnant
legacy.parser           1       3         0.40   0.33    declining
...

--- Capability Gaps ---
1. vector-search
   Signal strength: STRONG
   Evidence: 12 unresolved capability_routed events, 3 reflection reports
   Confidence: HIGH

2. semantic-ranking
   Signal strength: MEDIUM
   Evidence: 5 unresolved events, 1 reflection report
   Confidence: MEDIUM

--- Capability Overlap ---
memory-search ↔ knowledge-search  overlap: 0.87  CONSOLIDATION CANDIDATE
issue.triage ↔ issue.classify     overlap: 0.72  CONSOLIDATION CANDIDATE
deploy.staging ↔ deploy.prod      overlap: 0.45

--- Capability Drift ---
workflow.planning
  Original: issue decomposition
  Current:  decomposition, prioritization, capability routing
  Drift:    0.58  SPLIT CANDIDATE
```

**JSON output (`--json`):** Full CapabilityEvolutionReport as JSON.

### 8. What evidence is recorded?

**Zero new evidence types.** P5.5 is read-only. The only write path is the report to `.alix/adaptation/capability-evolution/<generatedAt>.json`.

### 9. What recommendations may it produce?

P5.5 produces **findings**, not recommendations:

- "capability X is in `declining` state (keep rate 0.40, revert rate 0.33)"
- "capabilities A and B have 87% overlap — potential consolidation"
- "capability Y's scope has drifted significantly — split candidate"
- "vector-search appears as a recurring gap across 3 signal types"

These are observations. No proposals are created. No registry is modified.

The findings may *inform* future P5.6 CapabilityEvolutionGenerator proposals, but P5.5 itself stops at observation.

### 10. What is explicitly out of scope?

| Feature | Rationale |
|---|---|
| Creating capability evolution proposals | P5.6 — after P5.5 establishes the pattern |
| Modifying the registry | Governance violation — P5.5 observes, does not mutate |
| Creating or removing agent cards | Governance violation |
| Auto-deprecating capabilities | Human must decide lifecycle transitions |
| ML-based overlap detection | Keyword-based Jaccard is deterministic and testable |
| Cross-instance capability comparison | Single-instance analysis only |
| Capability dependency graph analysis | Future extension — requires building the dependency model first |
| Skill-level evolution analysis | P5.5 focuses on capabilities; skill evolution is a separate concern |

## Expected first-run behavior

```
=== Capability Evolution Intelligence Report ===

Executive Summary:
No IntelligenceReport found. Most capabilities lack historical outcome data.
Health assessment limited to agent coverage counts and resolution frequency.

--- Lifecycle Distribution ---
Emerging:   12     (all — insufficient data to determine lifecycle)
Active:     0
Mature:     0
Stagnant:   0
Declining:  0
Deprecated: 0

--- Capability Health ---
workflow.planning      3 agents  — insufficient outcome data
code-review            2 agents  — insufficient outcome data
github.integration     1 agent   — insufficient outcome data
...

--- Capability Gaps ---
Unable to detect gaps — no capability_routed evidence or reflection reports.
```

This is valid output. It tells the operator: "not enough data yet — keep running adaptations."

## File structure

| File | Role | Action |
|---|---|---|
| `src/adaptation/capability-evolution-types.ts` | CapabilityEvolutionReport, CapabilityHealth, CapabilityGap, CapabilityOverlap, CapabilityDrift, LifecycleState | **Create** |
| `src/adaptation/capability-evolution-store.ts` | Save/load/list reports under `.alix/adaptation/capability-evolution/` | **Create** |
| `src/adaptation/capability-health-analyzer.ts` | Compute lifecycle state for each registered capability | **Create** |
| `src/adaptation/capability-gap-analyzer.ts` | Detect recurring unresolved capability requests | **Create** |
| `src/adaptation/capability-overlap-analyzer.ts` | Compute pairwise overlap between capabilities | **Create** |
| `src/adaptation/capability-drift-analyzer.ts` | Detect scope drift in capabilities | **Create** |
| `src/adaptation/capability-evolution-reporter.ts` | Orchestrate analyzers, assemble report, persist | **Create** |
| `src/cli/commands/adaptation.ts` | Add `capability-evolution` subcommand | **Modify** |
| Tests | Per component + CLI integration | **Create** |

## Interaction with existing phases

| Phase | Relationship |
|---|---|
| P5.3 Intelligence | `byCapability` buckets provide keep/revert rates per capability |
| P5.0 Reflection | `CapabilityAnalyzer` already detects `capability_gap` — P5.5 consumes its output |
| P4.7 Capability Routing | `capability_routed` evidence events provide resolution frequency data |
| P3.4 Agent Card Registry | Agent cards define which capabilities exist |
| P1.2 Capability Resolver | Resolution patterns feed overlap and drift analysis |
