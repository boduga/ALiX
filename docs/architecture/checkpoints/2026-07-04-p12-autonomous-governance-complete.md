# P12 — Autonomous Governance & Control Plane Complete

**Date:** 2026-07-04
**Tag:** `alix-p12-complete`
**PRs:** #215 (P12.1), #216 (P12.4), #217 (P12.5), #218 (P12.6)

P12 completed ALiX's autonomous governance and control plane.

## Milestones

```
P12.0 design spec              ✅
P12.1 governance policy adapter ✅
P12.2 risk scoring              ✅
P12.3 approval workflow         ✅
P12.4 run ledger                ✅
P12.5 failure memory            ✅
P12.6 operator CLI              ✅
```

## What P12 provides

| Layer | Purpose |
|-------|---------|
| **P12.1 Policy Adapter** | Maps existing `allow | ask | deny` to governance decisions with match dimensions (action types, labels, repos, files, branches) |
| **P12.2 Risk Scoring** | Pure scoring module classifying autonomous runs as `low | medium | high | critical` across 5 factors. Max-score dominance — one critical factor dominates |
| **P12.3 Approval Workflow** | Pure gate-state machine: given policy + risk, determines approval gates required and manages state transitions |
| **P12.4 Run Ledger** | Append-only JSONL store persisting the full governance decision trail for every autonomous run |
| **P12.5 Failure Memory** | Append-only JSONL store recording failed governance/autonomous-run patterns. Queryable by run, issue, type, and similarity scoring |
| **P12.6 Operator CLI** | Operator console — `governance status`, `runs approve/deny/cancel`, `failures list/show/recall`. CLI orchestration only |

## Core invariants

- **P12 gives ALiX governance authority to evaluate, score, gate, record, recall, and expose operator controls — but not autonomous merge authority.**
- Merge gate remains explicitly rejected by both the pure approval layer (`approveGate` no-ops merge) and the operator CLI (clear error message).
- All run mutations go through append-only revision entries — no in-place mutation of persisted evidence.
- All score/policy/gate functions are pure and deterministic — no hidden state.
- CLI orchestration only — no new autonomous authority from the operator surface.

## Verification

- 110+ governance tests passing across all P12 modules
- `tsc --noEmit` clean
- vitest suite clean
- GitNexus: LOW risk, 0 affected processes for all P12 changes
- Append-only invariant verified by structural audit of all store implementations

## Files

### Source
- `src/governance/autonomous-policy.ts` — P12.1
- `src/governance/risk-scoring.ts` — P12.2
- `src/governance/approval-workflow.ts` — P12.3
- `src/governance/run-ledger.ts` — P12.4
- `src/governance/failure-memory.ts` — P12.5

### CLI
- `src/cli/commands/governance.ts` — P12.1/P12.6
- `src/cli/commands/runs.ts` — P12.4/P12.6
- `src/cli/commands/failures.ts` — P12.5/P12.6

### Tests
- `tests/governance/risk-scoring.test.ts` — 48 tests
- `tests/governance/approval-workflow.test.ts` — 23 tests
- `tests/governance/run-ledger.test.ts` — 17 tests
- `tests/governance/failure-memory.test.ts` — 22 tests

### Docs
- `docs/architecture/specs/2026-07-04-p12-2-risk-scoring.md`
- `docs/architecture/specs/2026-07-04-p12-4-run-ledger.md`
- `docs/architecture/plans/2026-07-04-p12-1-policy-engine.md`
- `docs/architecture/plans/2026-07-04-p12-4-run-ledger.md`
