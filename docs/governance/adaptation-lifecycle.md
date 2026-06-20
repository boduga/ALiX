# ALiX Adaptation Lifecycle

> **Audience:** Operators, integrators
> **Part of:** P5.7e Documentation Freeze
> **See also:** [Governance Model](governance-model.md), [Operational Runbook](../operations/operational-runbook.md)

## Purpose

This document describes the lifecycle of an AdaptationProposal from creation
through approval, application, measurement, revert, and intelligence analysis.

## Proposal Status Flow

```
                    ┌──────────┐
                    │ pending  │ ← All proposals start here
                    └────┬─────┘
                         │
              ┌──────────┼──────────┐
              │          │          │
        approve     reject     (discard)
              │          │
              ▼          ▼
        ┌──────────┐ ┌──────────┐
        │ approved │ │ rejected │ (terminal)
        └────┬─────┘ └──────────┘
             │
         apply
             │
        ┌────┴─────┐
        │          │
     success    error
        │          │
        ▼          ▼
   ┌─────────┐ ┌────────┐
   │ applied │ │ failed │
   └─────────┘ └────────┘
```

## Lifecycle Stages

### 1. Creation (pending)

Proposals are created via:
- `alix adaptation propose <report.json>` — manual, from a reflection report
- `alix adaptation generate --reflection` — auto-generated from reflection
- `alix adaptation generate --capability-evolution` — auto-generated from capability analysis
- `alix adaptation revert <id>` — manual, creates a revert proposal

All proposals start as `pending` with no approval metadata.

### 2. Approval (pending → approved)

```bash
alix adaptation approve <proposal-id>
alix adaptation approve <id1> <id2> ...  # batch approval
```

- Only pending proposals can be approved
- Records `adaptation_approved` evidence with approver identity
- Stamps `approvedBy` and `approvedAt` on the proposal
- A proposal can also be rejected: `alix adaptation reject <id> --reason "..."`

### 3. Application (approved → applied)

```bash
alix adaptation apply <proposal-id>
```

- Only approved proposals can be applied
- Before mutation: snapshot is taken (for update/add/adjust proposals)
- After mutation: `adaptation_applied` or `adaptation_failed` evidence recorded
- Manual actions (issues, routing weights) go through approval; after approval, they are intercepted at applier routing and guidance is printed instead of mutating

### 4. Effectiveness Measurement

```bash
alix adaptation effectiveness <proposal-id>
```

- Compares pre/post metrics for the applied proposal
- Returns recommendation: `keep`, `revert`, or `investigate`
- Records `adaptation_effectiveness` evidence

### 5. Revert

```bash
alix adaptation revert <proposal-id>       # creates revert proposal
alix adaptation approve <revert-proposal>   # approve the revert
alix adaptation apply <revert-proposal>     # execute the revert
```

- Revert is a **new proposal** — full lifecycle, never automatic
- Requires snapshot integrity verification before restore
- Only revertable for proposals that have snapshots (update/add/adjust)

### 6. Intelligence & Prioritization

```bash
alix adaptation intelligence       # cross-proposal trend analysis
alix adaptation prioritize         # rank pending proposals by priority
```

- Intelligence is read-only — no mutations
- Prioritization scores are advisory
- Lineage tracing: `alix adaptation lineage <proposal-id>`

## Related Documents

- [Governance Model](governance-model.md) — governance invariants
- [Capability Evolution Lifecycle](capability-evolution-lifecycle.md) — capability-specific lifecycle
- [Operational Runbook](../operations/operational-runbook.md) — operator procedures
