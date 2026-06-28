# P5.5 — Capability Evolution Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task.
> **Plan home:** `docs/superpowers/plans/2026-06-19-p5-5-capability-evolution-intelligence.md`
> **SDS:** `docs/superpowers/specs/2026-06-19-p5-5-capability-evolution-intelligence-design.md`

**Goal:** Evaluate whether the current capability model is still the right capability model — health, gaps, overlap, and drift analysis across all registered capabilities.

**Risk:** LOW — pure read + compute + save report. No mutations, no registry writes, no capability changes.

## Global Constraints

- **P5.5 observes. P5.5 does NOT mutate.** No capabilities created, no registry modified, no agent cards changed, no proposals generated.
- **Read-only analysis.** Reads from AgentCard registry, IntelligenceStore, ProposalStore, EvidenceStore. Writes only the report to `.alix/adaptation/capability-evolution/`.
- **Deterministic.** All four analyzers use deterministic computation — no LLM calls, no ML.
- **Graceful degradation.** Without IntelligenceReport, analyze what's available (agent coverage, resolution counts). State defaults to `emerging`.
- **Trend-aware.** Lifecycle states use `resolutionCountRecent - resolutionCountPrior` and `proposalCountRecent - proposalCountPrior` for rising/stable/falling trends.
- **Do not touch** the 5 pre-existing uncommitted files.

## File Structure

| File | Action |
|---|---|
| `src/adaptation/capability-evolution-types.ts` | **Create** — CapabilityEvolutionReport, CapabilityHealth, CapabilityGap, CapabilityOverlap, CapabilityDrift, LifecycleState |
| `src/adaptation/capability-evolution-store.ts` | **Create** — save/load/list under `.alix/adaptation/capability-evolution/` |
| `src/adaptation/capability-health-analyzer.ts` | **Create** — compute lifecycle state with trend awareness |
| `src/adaptation/capability-gap-analyzer.ts` | **Create** — detect recurring unresolved capability requests |
| `src/adaptation/capability-overlap-analyzer.ts` | **Create** — directional pairwise overlap + asymmetry |
| `src/adaptation/capability-drift-analyzer.ts` | **Create** — keyword Jaccard distance for scope drift |
| `src/adaptation/capability-evolution-reporter.ts` | **Create** — orchestrate, assemble, persist |
| `src/cli/commands/adaptation.ts` | **Modify** — add `capability-evolution` subcommand |
| Tests | Per component + CLI |

## Task 1: Types + Store

**Create:** `src/adaptation/capability-evolution-types.ts`
- `LifecycleState = "emerging" | "active" | "mature" | "stagnant" | "declining" | "deprecated"`
- `CapabilityHealth` — capability, agentCount, resolutionCount, resolutionCountRecent, resolutionCountPrior, proposalCountRecent, proposalCountPrior, demandScore, keepRate, revertRate, proposalCount, lifecycleState, rationale
- `CapabilityGap` — suggestedCapability, evidence[], signalStrength (1-3), confidence
- `CapabilityOverlap` — capabilityA, capabilityB, overlapScore, coverageAtoB, coverageBtoA, asymmetry, sharedSignalCount, consolidationCandidate
- `CapabilityDrift` — capability, originalScope, currentScope, driftMagnitude, splitCandidate
- `CapabilityEvolutionReport` — full report with all sections + lifecycleDistribution + executiveSummary

**Create:** `src/adaptation/capability-evolution-store.ts` — same pattern as PriorityStore / IntelligenceStore.

**Test:** `tests/adaptation/capability-evolution-store.vitest.ts`

## Task 2: CapabilityHealthAnalyzer

**Create:** `src/adaptation/capability-health-analyzer.ts`

**Inputs (constructor):**
- `agentCards: AgentCard[]` — all registered agent cards (loaded by caller)
- `intelligenceReport: IntelligenceReport | null` — P5.3 report (graceful degradation)
- `proposals: AdaptationProposal[]` — all proposals
- `evidenceEvents: EvidenceRecord[]` — capability_routed events

**Behavior:**
1. Extract all unique capabilities from all agent cards' `capabilities: string[]`.
2. For each capability:
   a. `agentCount`: count of agents that register this capability.
   b. `resolutionCount`: total `capability_routed` events where the resolved capability matches.
   c. `resolutionCountRecent`: events in last 30 days.
   d. `resolutionCountPrior`: events 30-60 days ago.
   e. `resolutionTrend`: `resolutionCountRecent - resolutionCountPrior`.
   f. `proposalCountRecent`: proposals in last 30 days targeting this capability.
   g. `proposalCountPrior`: proposals 30-60 days ago.
   h. `proposalTrend`: `proposalCountRecent - proposalCountPrior`.
   i. `demandScore`: combined from goal decomposition references + reflection reports + unresolved capability_routed events (0-1).
   j. `keepRate`/`revertRate` from IntelligenceReport's byCapability bucket (null if no report).
   k. `proposalCount`: total proposals targeting this capability.
   l. `lifecycleState`: computed using the condition table in Q3 (trend-aware).
   m. `rationale`: human-readable explanation.

**Lifecycle computation:**
Use the table from Q3. Check criteria in order:
1. If `resolutionCount === 0 || agentCount === 0` → `deprecated`
2. If `keepRate < 0.5 || revertRate > 0.2 || resolutionTrend === "falling" || proposalTrend === "falling"` → `declining`
3. If `resolutionCount >= 50 && keepRate >= 0.75 && revertRate < 0.1 && proposalCount >= 20 && resolutionTrend === "stable" && proposalTrend === "stable"` → `mature`
4. If `resolutionCount >= 10 && keepRate >= 0.6 && revertRate < 0.15 && proposalCount >= 5 && resolutionTrend !== "falling" && proposalTrend !== "falling"` → `active`
5. If `resolutionCount > 0 && resolutionTrend === "stable" && proposalTrend === "falling"` → `stagnant`
6. If `resolutionCount > 0 && (keepRate >= 0.7 || insufficient data) && proposalCount < 5` → `emerging`
7. Default → `stagnant`

**Test:** `tests/adaptation/capability-health-analyzer.vitest.ts`

## Task 3: CapabilityGapAnalyzer

**Create:** `src/adaptation/capability-gap-analyzer.ts`

**Inputs:** evidence events, proposals, reflection reports, registered capabilities.

**Behavior:**
Collect three signal types:
1. `capability_routed` events with `resolvedAgent === ""` or zero candidates → unresolved capability requests. Group by requested capability name.
2. Proposals with `target.kind === "capability"` where the target capability doesn't match any registered capability.
3. Reflection evidence events mentioning missing or unresolved capabilities.

For each gap candidate:
- `signalStrength`: count of distinct signal types (1-3).
- `confidence`: 3 signals → `"high"`, 2 → `"medium"`, 1 → `"low"`.
- `evidence`: array of supporting text snippets.
- Only include gaps with signalStrength >= 1.

**Test:** `tests/adaptation/capability-gap-analyzer.vitest.ts`

## Task 4: CapabilityOverlapAnalyzer

**Create:** `src/adaptation/capability-overlap-analyzer.ts`

**Behavior:**
For every pair of registered capabilities:
1. `sharedAgentProportion`: (agents with both) / (agents with A or B).
2. `sharedProposalProportion`: (proposals targeting both) / (proposals targeting A or B).
3. `sharedResolutionPattern`: (resolution events with both) / (resolution events with A or B).
4. `overlapScore = 0.4 × sharedAgentProportion + 0.3 × sharedProposalProportion + 0.3 × sharedResolutionPattern`.
5. `coverageAtoB`: agents with both / agents with A.
6. `coverageBtoA`: agents with both / agents with B.
7. `asymmetry = coverageAtoB - coverageBtoA`.
8. `consolidationCandidate = overlapScore > 0.7`.

Only include pairs where `overlapScore > 0.3`.

**Test:** `tests/adaptation/capability-overlap-analyzer.vitest.ts`

## Task 5: CapabilityDriftAnalyzer

**Create:** `src/adaptation/capability-drift-analyzer.ts`

**Behavior:**
For each registered capability:
1. Original scope keywords:
   - From agent card descriptions for agents that have this capability.
   - From first 3 proposals mentioning this capability (their reason/payload text).
2. Current scope keywords:
   - From recent proposals (last 30 days) mentioning this capability.
   - From resolution pattern descriptions.
3. Compute Jaccard distance: `1 - (keywordIntersection / keywordUnion)`.
4. If distance > 0.5, flag as `splitCandidate: true`.

Keyword extraction: split on whitespace and punctuation, lowercase, filter stopwords (`the`, `a`, `an`, `for`, `to`, `in`, `of`, `and`, `or`, `is`, `are`, `was`, `were`, `be`, `been`, `being`, `have`, `has`, `had`, `do`, `does`, `did`, `will`, `would`, `can`, `could`, `should`, `may`, `might`, `shall`, `not`, `no`, `nor`, `with`, `at`, `from`, `by`, `on`, `as`, `it`, `its`, `this`, `that`, `these`, `those`).

**Test:** `tests/adaptation/capability-drift-analyzer.vitest.ts`

## Task 6: CapabilityEvolutionReporter

**Create:** `src/adaptation/capability-evolution-reporter.ts`

**Behavior:**
1. Load all agent cards from CardStore (cards directory).
2. Load latest IntelligenceReport from IntelligenceStore.
3. Load proposals from ProposalStore.
4. Query EvidenceStore for capability_routed events.
5. Delegate to the four analyzers.
6. Compute `lifecycleDistribution` (count per state).
7. Generate `executiveSummary`.
8. Assemble `CapabilityEvolutionReport`.
9. Save via CapabilityEvolutionStore.
10. Return report.

**Note on CardStore loading:** The reporter needs a way to read agent cards. Use `readdirSync` + `readFileSync` from the cards directory (`.alix/cards/agents/`) to get all AgentCard JSON files. Parse each to extract `capabilities: string[]`.

**Test:** `tests/adaptation/capability-evolution-reporter.vitest.ts`

## Task 7: CLI subcommand

**Modify:** `src/cli/commands/adaptation.ts`

Add:
```ts
case "capability-evolution":
  await runCapabilityEvolution(cwd, store, evidenceStore, rest);
  return;
```

**`runCapabilityEvolution`**:
1. Wire up all components.
2. Call `reporter.generateReport()`.
3. If `--json`: print JSON.
4. Otherwise: print formatted sections:
   - Header + executive summary
   - Lifecycle distribution table
   - Capability health table
   - Capability gaps (if any)
   - Capability overlap (if any)
   - Capability drift (if any)

**Test:** `tests/cli/commands/adaptation-capability-evolution.vitest.ts`

## Task 8: Verification + PR

```bash
npx vitest run tests/adaptation/capability-evolution-* tests/cli/commands/adaptation-capability-evolution* --config vitest.config.mts
npx vitest run --config vitest.config.mts
npx tsc --noEmit
gitnexus_detect_changes
```

Branch: `feature/p5.5-capability-evolution-intelligence`.
Tag: `alix-p5.5-complete`.
