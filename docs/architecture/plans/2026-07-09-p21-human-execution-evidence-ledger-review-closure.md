# P21 — Human Execution Evidence Ledger & Review Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement the plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the loop after manual operator action by persisting evidence in an append-only ledger, assigning closure states, and recording through audited store boundaries. No autonomous execution.

**Design spec:** `docs/architecture/specs/2026-07-09-p21-0-human-execution-evidence-ledger-review-closure-design.md`

## Implementation Boundaries

Never add:
- autonomous execution, background jobs, or scheduled tasks;
- shell, network, MCP, browser, fetch, or subprocess calls;
- execution adapters, executor imports, or tool invocations;
- policy mutation;
- operator ranking;
- handoff package mutation or deletion;
- evidence mutation or deletion after append;
- direct audit emitter imports (use audited store boundaries).

Evidence ledger is append-only. Closure decisions use audited store boundaries only.

## File Plan

| Slice | Source | Tests |
|---|---|---|
| P21.1 | `src/governance/evidence-ledger-store.ts` | `tests/governance/evidence-ledger-store.test.ts` |
| P21.2 | `src/governance/closure-review.ts` | `tests/governance/closure-review.test.ts` |
| P21.3 | `src/governance/closure-recorder.ts` | `tests/governance/closure-recorder.test.ts` |
| P21.4 | `src/governance/closure-report.ts`; `src/cli/commands/governance.ts` | `tests/governance/closure-report.test.ts`; `tests/cli/governance-closure-cli.test.ts` |
| P21.5 | phase report, checkpoint docs | boundary verification commands |

## Task 1: P21.0 Spec + Plan

- [ ] Create design spec and implementation plan

## Task 2: P21.1 Evidence Ledger Store

**Files:**
- Create: `src/governance/evidence-ledger-store.ts`
- Create: `tests/governance/evidence-ledger-store.test.ts`

- [ ] **Step 1:** Create failing tests for append-only store
- [ ] **Step 2:** Implement `EvidenceLedgerStore` with `append`, `getByHandoffId`, `list`
- [ ] **Step 3:** Build and run — verify tests pass
- [ ] **Step 4:** Commit P21.1

## Task 3: P21.2 Closure Review Model

**Files:**
- Create: `src/governance/closure-review.ts`
- Create: `tests/governance/closure-review.test.ts`

- [ ] **Step 1:** Create failing tests for closure state transitions
- [ ] **Step 2:** Implement `ClosureReview`, state machine, transition validation
- [ ] **Step 3:** Build and run — verify tests pass
- [ ] **Step 4:** Commit P21.2

## Task 4: P21.3 Audit-Safe Closure Recorder

**Files:**
- Create: `src/governance/closure-recorder.ts`
- Create: `tests/governance/closure-recorder.test.ts`

- [ ] **Step 1:** Create failing tests for audited recording
- [ ] **Step 2:** Implement `recordClosureReview` — validates transitions, appends via store
- [ ] **Step 3:** Build and run — verify tests pass
- [ ] **Step 4:** Commit P21.3

## Task 5: P21.4 Closure Report + CLI

**Files:**
- Create: `src/governance/closure-report.ts`
- Create: `tests/governance/closure-report.test.ts`
- Append: `src/cli/commands/governance.ts` (P21-CLOSURE-START/END delimited section)

- [ ] **Step 1:** Create report builder tests
- [ ] **Step 2:** Implement `buildClosureReport()`
- [ ] **Step 3:** Add `alix governance closure` CLI dispatcher and renderers
- [ ] **Step 4:** Build and run — verify all P21 tests pass
- [ ] **Step 5:** Commit P21.4

## Task 6: P21.5 Checkpoint

- [ ] Run full verification
- [ ] Run P21 sentinel checks
- [ ] Confirm no autonomous execution
- [ ] Write phase report and checkpoint docs
- [ ] Merge docs and tag: `alix-p21-human-execution-evidence-ledger-review-closure-complete`

## Verification

```bash
npm run typecheck
npx tsx --test tests/governance/*.test.ts
```

## Acceptance Checklist

- [ ] P21.1 append-only evidence ledger operational
- [ ] P21.2 closure state transitions validated
- [ ] P21.3 closure decisions recorded through audited stores
- [ ] P21.4 closure report + CLI operational
- [ ] No autonomous execution capability exists
- [ ] No execution adapter exists
- [ ] No handoff package mutation
- [ ] No operator ranking
- [ ] All tests passing
- [ ] Phase report, checkpoint, commit, and tag exist
