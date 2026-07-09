# P20 — Controlled Manual Execution Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement the plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn readiness-approved P19 plans into explicit operator handoff packages for manual execution, with evidence capture and post-action recording. No autonomous execution.

**Architecture:** Build isolated pure functions: handoff package builder, evidence validator, recording bridge, and report builder. CLI commands read explicit JSON bundle, compute all handoff artifacts in memory, and print text or JSON.

**Design spec:** `docs/architecture/specs/2026-07-09-p20-0-controlled-manual-execution-handoff-design.md`

## Implementation Boundaries

Never add:
- execution adapters, executor imports, or tool invocations;
- shell, network, MCP, browser, fetch, or subprocess calls;
- handoff package stores or persistence;
- audit emitter imports;
- policy mutation;
- automatic background invocation;
- alternate approval or lifecycle state;
- operator ranking.

Every handoff requires matching approved P17 approval and P18 lifecycle visibility. `controlledExecutionAuthorization` always equals `"not_available_in_p20"`. Every handoff package has `explicitlyManualOnly: true`.

## File Plan

| Slice | Source | Tests |
|---|---|---|
| P20.1 | `src/governance/handoff-builder.ts` | `tests/governance/handoff-builder.test.ts` |
| P20.2 | `src/governance/handoff-evidence.ts` | `tests/governance/handoff-evidence.test.ts` |
| P20.3 | `src/governance/handoff-recorder.ts` | `tests/governance/handoff-recorder.test.ts` |
| P20.4 | `src/governance/handoff-report.ts`; `src/cli/commands/governance.ts` | `tests/governance/handoff-report.test.ts`; `tests/cli/governance-handoff-cli.test.ts` |
| P20.5 | phase report, checkpoint docs | boundary verification commands |

## Task 1: P20.0 Spec + Plan

- [ ] Create `docs/architecture/specs/2026-07-09-p20-0-controlled-manual-execution-handoff-design.md`
- [ ] Create `docs/architecture/plans/2026-07-09-p20-controlled-manual-execution-handoff.md`

## Task 2: P20.1 Handoff Package Builder

**Files:**
- Create: `src/governance/handoff-builder.ts`
- Create: `tests/governance/handoff-builder.test.ts`

- [ ] **Step 1:** Create test fixtures and failing tests
- [ ] **Step 2:** Implement `buildHandoffPackage()` types and logic
- [ ] **Step 3:** Build and run — verify tests pass
- [ ] **Step 4:** Commit P20.1

## Task 3: P20.2 Evidence Capture Contract

**Files:**
- Create: `src/governance/handoff-evidence.ts`
- Create: `tests/governance/handoff-evidence.test.ts`

- [ ] **Step 1:** Create failing tests for evidence validation
- [ ] **Step 2:** Implement `validateHandoffEvidence()` types and logic
- [ ] **Step 3:** Build and run — verify tests pass
- [ ] **Step 4:** Commit P20.2

## Task 4: P20.3 Post-Handoff Recording Flow

**Files:**
- Create: `src/governance/handoff-recorder.ts`
- Create: `tests/governance/handoff-recorder.test.ts`

- [ ] **Step 1:** Create failing tests for recording flow
- [ ] **Step 2:** Implement `recordHandoffExecution()` types and logic
- [ ] **Step 3:** Build and run — verify tests pass
- [ ] **Step 4:** Commit P20.3

## Task 5: P20.4 Handoff Report + CLI

**Files:**
- Create: `src/governance/handoff-report.ts`
- Create: `tests/governance/handoff-report.test.ts`
- Append: `src/cli/commands/governance.ts` (P20-HANDOFF-START/END delimited section)
- Create: `tests/cli/governance-handoff-cli.test.ts`

- [ ] **Step 1:** Create report builder tests
- [ ] **Step 2:** Implement `buildHandoffReport()`
- [ ] **Step 3:** Add `alix governance handoff` CLI dispatcher and renderers
- [ ] **Step 4:** Add CLI integration tests
- [ ] **Step 5:** Add P20-HANDOFF-START/END sentinel markers
- [ ] **Step 6:** Build and run — verify all P20 suite + governance regression
- [ ] **Step 7:** Commit P20.4

## Task 6: P20.5 Checkpoint

- [ ] Run full verification
- [ ] Run P20 sentinel checks
- [ ] Confirm no autonomous execution
- [ ] Write phase report: `docs/architecture/reports/p20-controlled-manual-execution-handoff-report.md`
- [ ] Write checkpoint: `docs/architecture/checkpoints/2026-07-09-p20-controlled-manual-execution-handoff-complete.md`
- [ ] Merge docs and tag: `alix-p20-controlled-manual-execution-handoff-complete`

## Verification

```bash
npm run typecheck
npx tsx --test tests/governance/*.test.ts
npx tsx --test tests/cli/governance-handoff-cli.test.ts
```

## Acceptance Checklist

- [ ] P20.1 builds handoff packages from readiness-approved plans
- [ ] P20.2 validates evidence against handoff contract
- [ ] P20.3 records completed handoffs through P17 recorder
- [ ] P20.4 reports handoff statuses through read-only CLI
- [ ] No autonomous execution capability exists
- [ ] No shell/network/tool execution exists
- [ ] No execution adapter exists
- [ ] No audit emitter imports
- [ ] No operator ranking
- [ ] `explicitlyManualOnly: true` on every handoff package
- [ ] `controlledExecutionAuthorization` always `"not_available_in_p20"`
- [ ] P17 approval required
- [ ] P18 visibility required
- [ ] All tests passing
- [ ] Phase report, checkpoint, commit, and tag exist
