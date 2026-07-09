# P22 — Closure Intelligence & Handoff Quality Signals Implementation Plan

**Goal:** Learn from completed, rejected, incomplete, and follow-up-required handoffs to improve future governance quality — without executing, ranking operators, or mutating policy.

**Design spec:** `docs/architecture/specs/2026-07-09-p22-0-closure-intelligence-handoff-quality-signals-design.md`

## Implementation Boundaries

- No autonomous execution, background jobs, or scheduled tasks
- No shell, network, MCP, browser, fetch, or subprocess calls
- No execution adapters, executor imports, or tool invocations
- No policy mutation or readiness threshold mutation
- No automatic adoption of calibration into readiness
- No operator ranking, productivity scoring, or leaderboard
- No auto-close or closure review modification
- No bypass around P17/P18/P19/P20/P21

## File Plan

| Slice | Source | Tests |
|-------|--------|-------|
| P22.0 | Design spec + plan | — |
| P22.1 | `src/governance/handoff-intelligence-types.ts` + `handoff-outcome-aggregate.ts` | `tests/governance/handoff-outcome-aggregate.test.ts` |
| P22.2 | `src/governance/handoff-quality-signals.ts` | `tests/governance/handoff-quality-signals.test.ts` |
| P22.3 | `src/governance/handoff-readiness-calibration.ts` | `tests/governance/handoff-readiness-calibration.test.ts` |
| P22.4 | `src/governance/handoff-intelligence-report.ts` + `src/cli/commands/governance.ts` | `tests/governance/handoff-intelligence-report.test.ts` |
| P22.5 | Phase report + checkpoint docs | Boundary verification |

## Task 1: P22.0 Spec + Plan

- [ ] Create design spec
- [ ] Create implementation plan

## Task 2: P22.1 Closure Outcome Metrics

- [ ] Create pure types file: `handoff-intelligence-types.ts`
- [ ] Implement `aggregateClosureOutcomes()` — grouping by status, readiness, evidence
- [ ] 6 tests: empty, counts, grouping, window, no operator identity
- [ ] Build and run — verify tests pass

## Task 3: P22.2 Handoff Quality Signals

- [ ] Implement `detectHandoffQualitySignals()` — 6 signal types
- [ ] 8 tests: evidence gap, incomplete, follow-up, repeated, slow, no false positives
- [ ] Build and run — verify tests pass

## Task 4: P22.3 Readiness Calibration

- [ ] Implement `calibrateReadiness()` — overconfident/underconfident/accurate
- [ ] 7 tests: all calibration labels, unknown level excluded, no operator identity
- [ ] Build and run — verify tests pass

## Task 5: P22.4 Intelligence Report + CLI

- [ ] Implement `buildIntelligenceReport()` — composes all three stages
- [ ] CLI: `alix governance intelligence {outcomes|signals|calibration|report}`
- [ ] P22-INTELLIGENCE-START/END delimited section
- [ ] 6 tests: empty, composition, JSON, no ranking, text, CLI read-only
- [ ] Build and run — verify all P22 tests pass

## Task 6: P22.5 Checkpoint

- [ ] Full verification: typecheck + governance tests
- [ ] P22 sentinel checks: no execution, no policy mutation, no ranking
- [ ] Write phase report and checkpoint docs
- [ ] Tag: `alix-p22-closure-intelligence-handoff-quality-signals-complete`

## Acceptance Checklist

- [ ] P22.1 closure outcome metrics aggregate correctly
- [ ] P22.2 quality signals detect all 6 signal types
- [ ] P22.3 readiness calibration produces correct labels
- [ ] P22.4 intelligence report is read-only, text + JSON, no ranking
- [ ] No execution capability
- [ ] No policy mutation
- [ ] No operator ranking
- [ ] No automatic adoption or closure mutation
- [ ] All tests passing, typecheck clean
- [ ] Phase report, checkpoint, tag exist
