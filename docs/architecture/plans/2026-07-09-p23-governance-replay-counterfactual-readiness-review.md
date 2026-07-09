# P23 — Governance Replay & Counterfactual Readiness Review Implementation Plan

**Goal:** Replay historical governance decisions, readiness projections, handoffs, closure evidence, and closure intelligence inside a sandboxed counterfactual evaluator — without executing, mutating policy, mutating thresholds, or persisting counterfactuals as live state.

**Design spec:** `docs/architecture/specs/2026-07-09-p23-0-governance-replay-counterfactual-readiness-review-design.md`

## Implementation Boundaries

- No autonomous execution, background jobs, or scheduled tasks
- No shell, network, MCP, browser, fetch, or subprocess calls
- No execution adapters, executor imports, or tool invocations
- No policy mutation or readiness threshold mutation
- No approval, handoff, closure review, or audit event mutation
- No persisting counterfactuals as live governance state
- No operator ranking, productivity scoring, or leaderboard
- No auto-adoption, auto-close, or bypass around P17–P22

## File Plan

| Slice | Source | Tests |
|-------|--------|-------|
| P23.0 | Design spec + plan | — |
| P23.1 | `src/governance/replay/replay-input-assembler.ts` + `src/governance/replay/types.ts` | `tests/governance/replay-input-assembler.test.ts` |
| P23.2 | `src/governance/replay/counterfactual-readiness-evaluator.ts` | `tests/governance/counterfactual-readiness-evaluator.test.ts` |
| P23.3 | `src/governance/replay/replay-diff-model.ts` | `tests/governance/replay-diff-model.test.ts` |
| P23.4 | `src/governance/replay/replay-report.ts` + `src/cli/commands/governance-replay.ts` | `tests/governance/replay-report.test.ts` |
| P23.5 | Phase report + checkpoint docs | Boundary verification |

## Task 1: P23.0 Spec + Plan

- [x] Create design spec
- [x] Create implementation plan

## Task 2: P23.1 Replay Input Assembler

- [ ] Create types file: `src/governance/replay/types.ts`
  - `GovernanceReplayDataset`, `ReplayApprovalRecord`, `ReplayReadinessProjectionRecord`, `ReplayHandoffRecord`, `ReplayClosureReviewRecord`, `ReplayClosureIntelligenceRecord`, `ReplaySourceSummary`
  - `CounterfactualScenario`, `CounterfactualReadinessAssumptions`, `CounterfactualEvidenceAssumptions`, `CounterfactualHandoffAssumptions`, `CounterfactualClosureAssumptions`
  - `createdForReplayOnly: true` on every scenario
- [ ] Implement `assembleReplayDataset(lifecycleId, sources)` — read-only assembler from P17–P22 allowed sources
- [ ] Handle missing optional records gracefully (null/empty, not throw)
- [ ] Deterministic sorting: timestamp ascending, stable id ascending for ties
- [ ] 8 tests: assembles records, missing optional, preserves source ids, no mutation, sorts deterministically, rejects unallowed source, empty dataset, idempotent
- [ ] Build and run — verify tests pass

## Task 3: P23.2 Counterfactual Readiness Evaluator

- [ ] Implement `evaluateCounterfactual(dataset, scenario)` — pure function, returns `CounterfactualReplayOutcome`
  - Applies scenario readiness/evidence/handoff/closure assumptions in memory only
  - Does not mutate source records or live thresholds
- [ ] Implement `ReplayOriginalOutcome` and `ReplayCounterfactualOutcome` structs
- [ ] Implement `ReplayRiskDelta` — before/after risk comparison
- [ ] Implement `ReplayCandidateLesson` — advisory, `requiresHumanReview: true`
- [ ] Deterministic: same dataset + same scenario → same outcome every time
- [ ] No randomness, no model calls, no external calls
- [ ] 7 tests: deterministic outcome, applies assumptions, no threshold mutation, no source mutation, missing evidence safe, empty dataset ok, readOnly:true on output
- [ ] Build and run — verify tests pass

## Task 4: P23.3 Replay Diff Model

- [ ] Implement `computeReplayDiff(originalOutcome, counterfactualOutcome)` — pure function
- [ ] All 8 diff categories: `unchanged`, `readiness_changed`, `handoff_quality_changed`, `closure_risk_changed`, `evidence_gap_changed`, `review_path_changed`, `blocked_in_counterfactual`, `advanced_in_counterfactual`
- [ ] Sort details by category, then source id ascending
- [ ] No mutation of input objects
- [ ] 6 tests: unchanged, readiness change, handoff quality change, closure risk change, evidence gap change, deterministic sort
- [ ] Build and run — verify tests pass

## Task 5: P23.4 Replay Report + CLI

- [ ] Implement `buildReplayReport(outcome)` — composes replay output into formatted report
  - replay id, source lifecycle id, scenario name, source records used
  - original outcome summary, counterfactual outcome summary
  - diff category, risk delta, changed readiness/handoff/closure signals
  - candidate lessons
  - boundary verification footer
- [ ] Required footer: "P23 replay report is read-only. No policy, approval, readiness, handoff, closure, audit, or execution state was mutated. Counterfactual outputs are advisory and require governed human review before any future adoption."
- [ ] CLI: `alix governance replay` command group (or implement in `governance.ts`)
  - `alix governance replay assemble <lifecycleId>`
  - `alix governance replay evaluate <lifecycleId> --scenario <scenarioId>`
  - `alix governance replay report <lifecycleId> --scenario <scenarioId>`
  - `alix governance replay report <lifecycleId> --scenario <scenarioId> --json`
  - Optional flags: `--strict-evidence`, `--strict-handoff`, `--closure-risk-sensitive`, `--require-complete-review`
- [ ] CLI is read-only — prints reports, no writes to governance stores
- [ ] P23-REPLAY-START/END delimited section for output parsing
- [ ] 8 tests: report fields present, empty scenario, JSON output, text output, footer present, no store writes, no adapter imports, CLI read-only
- [ ] Build and run — verify all P23 tests pass

## Task 6: P23.5 Checkpoint

- [ ] Full verification: typecheck + governance tests
- [ ] P23 sentinel checks:
  - no execution adapter imports in replay modules
  - no fs/child_process/network imports in pure modules
  - no policy/readiness/approval/handoff/closure writer imports from replay modules
  - no audit emitter imports from replay pure modules
  - no operator ranking or productivity scoring
  - no auto-adoption or auto-close
- [ ] Write phase report and checkpoint docs
- [ ] Tag: `alix-p23-governance-replay-counterfactual-readiness-review-complete`

## Acceptance Checklist

- [ ] P23.1 replay input assembler assembles datasets deterministically from allowed sources
- [ ] P23.2 counterfactual evaluator produces deterministic outcomes without mutating thresholds
- [ ] P23.3 diff model detects all 8 diff categories with stable sorting
- [ ] P23.4 replay report is read-only, text + JSON, no store writes, includes boundary footer
- [ ] No execution capability
- [ ] No policy mutation
- [ ] No readiness threshold mutation
- [ ] No approval, handoff, closure, or audit event mutation
- [ ] No operator ranking or auto-adoption
- [ ] Counterfactuals not persisted as live governance state
- [ ] All tests passing, typecheck clean
- [ ] Phase report, checkpoint, tag exist
