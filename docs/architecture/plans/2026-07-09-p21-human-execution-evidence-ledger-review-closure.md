# P21 — Human Execution Evidence Ledger & Review Closure Implementation Plan

**Goal:** Record human-submitted evidence about what happened after manual handoffs, review closure states through audited boundaries, and report closure status — without executing, ranking, or auto-closing.

**Design spec:** `docs/architecture/specs/2026-07-09-p21-0-human-execution-evidence-ledger-review-closure-design.md`

## Implementation Boundaries

- No autonomous execution, background jobs, or scheduled tasks
- No shell, network, MCP, browser, fetch, or subprocess calls
- No execution adapters, executor imports, or tool invocations
- No policy mutation
- No operator ranking
- No handoff package mutation or deletion
- No evidence mutation or deletion after append
- No direct audit emitter imports (use audited store boundaries only)
- No automatic closure inference

## File Plan

| Slice | Source | Tests |
|-------|--------|-------|
| P21.0 | Design spec + plan | — |
| P21.1 | `src/governance/human-execution-closure-types.ts` + `human-execution-evidence-ledger.ts` | `tests/governance/human-execution-evidence-ledger.test.ts` |
| P21.2 | `src/governance/human-execution-closure-review.ts` | `tests/governance/human-execution-closure-review.test.ts` |
| P21.3 | `src/governance/audited-human-execution-closure.ts` | `tests/governance/audited-human-execution-closure.test.ts` |
| P21.4 | `src/governance/human-execution-closure-report.ts` + `src/cli/commands/governance.ts` | `tests/governance/human-execution-closure-report.test.ts` |
| P21.5 | Phase report + checkpoint docs | Boundary verification |

## Task 1: P21.0 Spec + Plan

- [ ] Create design spec and implementation plan

## Task 2: P21.1 Evidence Ledger Store

**Files:**
- Create: `src/governance/human-execution-closure-types.ts`
- Create: `src/governance/human-execution-evidence-ledger.ts`
- Create: `tests/governance/human-execution-evidence-ledger.test.ts`

- [ ] Create types file with evidence ref, ledger entry, closure review interfaces
- [ ] Implement EvidenceLedgerStore with appendEvidence, listEvidence, listEvidenceForHandoff
- [ ] 8 tests: append, list, duplicate rejection, validation, timestamps
- [ ] Commit P21.1

## Task 3: P21.2 Closure Review Model

**Files:**
- Create: `src/governance/human-execution-closure-review.ts`
- Create: `tests/governance/human-execution-closure-review.test.ts`

- [ ] Implement state transition validation, closure review store
- [ ] 10 tests: all transitions, evidence requirements, terminal enforcement
- [ ] Commit P21.2

## Task 4: P21.3 Audit-Safe Closure Recorder

**Files:**
- Create: `src/governance/audited-human-execution-closure.ts`
- Create: `tests/governance/audited-human-execution-closure.test.ts`

- [ ] Implement audited wrappers for evidence append and closure review
- [ ] 6 tests: audit event emission, auditRefs, sentinel checks
- [ ] Commit P21.3

## Task 5: P21.4 Closure Report + CLI

**Files:**
- Create: `src/governance/human-execution-closure-report.ts`
- Create: `tests/governance/human-execution-closure-report.test.ts`
- Extend: `src/cli/commands/governance.ts` (P21-CLOSURE-START/END)

- [ ] Implement buildClosureReport with derived status
- [ ] Add CLI: handoff evidence append, handoff closure review, handoff closure report
- [ ] 11 tests: totals, status, sorting, window filtering, no operator ranking
- [ ] Commit P21.4

## Task 6: P21.5 Checkpoint

- [ ] Full verification: typecheck + governance tests
- [ ] P21 sentinel checks: no execution, no unaudited path, no ranking
- [ ] Write phase report and checkpoint docs
- [ ] Tag: `alix-p21-human-execution-evidence-ledger-review-closure-complete`

## Sentinels

P21 files must reject:
- `executeAction`, `applyPolicy`, `transitionRemediation` calls
- `.append(` from CLI paths (must go through audited recorder)
- Audit emitter imports from pure modules
- Shell/network/fetch/subprocess imports
- Execution adapter imports
- Operator ranking language

## Acceptance Checklist

- [ ] P21.1 evidence ledger append-only and tested
- [ ] P21.2 closure state transitions enforced
- [ ] P21.3 audited recorder wraps all writes
- [ ] P21.4 closure report read-only, text + JSON
- [ ] No autonomous execution
- [ ] No execution adapter
- [ ] No operator ranking
- [ ] No unaudited closure path
- [ ] All tests passing, typecheck clean
- [ ] Phase report, checkpoint, tag exist
