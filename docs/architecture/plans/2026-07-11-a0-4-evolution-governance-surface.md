# A0.4 — Evolution Governance Surface Implementation Plan

**Phase:** A0 — Evolution Contract
**Slice:** A0.4 — Evolution Governance Surface

**Design Spec:**
`docs/architecture/specs/2026-07-11-a0-4-evolution-governance-surface-design.md`

**Depends On:**

* A0.1 — Evolution Contract Types
* A0.2 — Evolution Lifecycle State Machine
* A0.3 — Evolution Evidence Bridge
* X3b — ExecutionEvidenceStore
* P9.0f — CLI Dispatcher (`alix governance`)

**Checkpoint Target:**

```
alix-a0-4-evolution-governance-surface-complete
```

---

# 1. Goal

Implement the Evolution Governance Surface as a read-only CLI observation layer.

The surface exposes:

* tracked evolution instances
* lifecycle state
* lifecycle transition history
* evolution evidence records

through:

```
alix governance evolution
```

The implementation MUST preserve the primary invariant:

> The evolution CLI observes evolution artifacts but never creates, transitions, or modifies lifecycle artifacts.

---

# 2. Scope

## Included

### CLI Commands

```
alix governance evolution list

alix governance evolution show <id>

alix governance evolution evidence <id>
```

### Output Modes

Human-readable:

```
plain terminal output
```

Machine-readable:

```
--json
```

### Integration

* Existing governance command dispatcher
* Evolution lifecycle state machine
* Execution evidence store

---

## Excluded

| Capability                    | Deferred |
| ----------------------------- | -------- |
| Evolution creation            | A1       |
| Automatic proposal generation | A1       |
| Mutation commands             | A2/A3    |
| Approval workflow             | A2/A3    |
| Evolution execution           | A2       |
| Adaptation loop               | A3       |
| Persistent evolution registry | Future   |
| Web dashboard                 | Future   |

---

# 3. Implementation Files

## Create

```
src/governance/evolution-cli.*
```

Responsibilities:

* evolution command handling
* query orchestration
* output formatting
* JSON serialization

---

## Modify

```
src/cli/commands/governance.*
```

Add evolution command routing:

```
governance
    |
    └── evolution
            |
            ├── list
            ├── show
            └── evidence
```

---

## Create

```
tests/governance/evolution-cli.test.*
```

Responsibilities:

* command behavior validation
* output validation
* error handling

---

# 4. Architecture

The CLI introduces a read-only query boundary:

```
                +----------------------+
                | Governance CLI       |
                | evolution commands   |
                +----------+-----------+
                           |
                           |
                +----------v-----------+
                | Evolution Query      |
                | Surface              |
                +----------+-----------+
                           |
             +-------------+-------------+
             |                           |
+------------v-------------+  +----------v-----------+
| Evolution State Machine  |  | ExecutionEvidence    |
| Lifecycle Queries        |  | Store                |
+--------------------------+  +----------------------+
```

The CLI never owns lifecycle state.

---

# 5. Implementation Tasks

---

# Task 1 — Evolution CLI Handler

Create the evolution CLI handler.

Interface:

```text
handleEvolutionCommand(
    args,
    dependencies
)
```

Dependencies:

```
{
    stateMachine,
    evidenceStore
}
```

Responsibilities:

* parse evolution subcommands
* route commands
* retrieve data
* format output
* return CLI status

Supported commands:

```
list
show <id>
evidence <id>
```

---

# Task 2 — Implement List Command

Command:

```
alix governance evolution list
```

## Data Source

```
EvolutionStateMachine.listEvolutions()
```

The query MUST return:

* evolutionId
* current state
* target
* createdAt

---

## Human Output

Example:

```
Evolutions (3):

  evol-config-v2      APPROVED       policy             2026-07-11T10:00:00Z
  evol-retry-policy   IMPLEMENTING   runtime_config     2026-07-11T09:00:00Z
  evol-agent-x        REJECTED       agent_behavior     2026-07-11T08:00:00Z


ACTIVE: 0 | APPROVED: 1 | IMPLEMENTING: 1 | REJECTED: 1
```

---

## JSON Output

Schema:

```json
{
  "evolutions": [
    {
      "evolutionId": "evol-config-v2",
      "state": "APPROVED",
      "target": {
        "kind": "policy",
        "id": "policy-approval-threshold"
      },
      "createdAt": "2026-07-11T10:00:00Z"
    }
  ],
  "counts": {
    "total": 1,
    "byState": {
      "APPROVED": 1
    }
  }
}
```

---

## Requirements

* Sort by `createdAt` ascending
* Include state counts
* Handle empty state

Empty human output:

```
No evolutions found.
```

---

# Task 3 — Implement Show Command

Command:

```
alix governance evolution show <id>
```

Purpose:

Display complete lifecycle history.

---

## Data Sources

```
EvolutionStateMachine.getStatus(id)

EvolutionStateMachine.getHistory(id)
```

---

## Human Output

Example:

```
Evolution: evol-config-v2

Target:
  policy (policy-approval-threshold)

Origin:
  operator

Risk:
  medium

State:
  APPROVED


History (chronological):

  DRAFT → PROPOSED
      2026-07-11T10:00:00Z

  PROPOSED → UNDER_REVIEW
      2026-07-11T10:30:00Z

  UNDER_REVIEW → APPROVED
      2026-07-11T11:00:00Z
```

---

## JSON Output

Schema:

```json
{
  "evolutionId": "evol-config-v2",
  "state": "APPROVED",
  "target": {},
  "origin": "operator",
  "riskClass": "medium",
  "history": [],
  "historyLength": 3
}
```

---

## Error Handling

Unknown ID:

```
Evolution not found: <id>
```

Exit code:

```
1
```

---

# Task 4 — Implement Evidence Command

Command:

```
alix governance evolution evidence <id>
```

Purpose:

Display evidence records associated with an evolution.

---

## Data Source

```
ExecutionEvidenceStore.getByIntentId(intentId)
```

The evolution-to-intent mapping MUST use the existing A0.3/X3b contract.

The CLI MUST NOT create or transform evidence.

---

## Human Output

Example:

```
Evidence for evol-config-v2 (3 records):

  evoe-001  EvolutionProposed       2026-07-11T10:00:00Z  PARTIAL
  evoe-002  EvolutionSentForReview  2026-07-11T10:30:00Z  PARTIAL
  evoe-003  EvolutionApproved       2026-07-11T11:00:00Z  PARTIAL
```

---

## JSON Output

Schema:

```json
{
  "evolutionId": "evol-config-v2",
  "evidence": [
    {
      "evidenceId": "evoe-001",
      "eventType": "EvolutionProposed",
      "timestamp": "2026-07-11T10:00:00Z"
    }
  ],
  "totalEvidence": 1
}
```

---

# Task 5 — Governance Dispatcher Integration

Modify:

```
handleGovernanceCommand()
```

Add:

```
evolution
```

dispatch.

Validation:

```
alix governance evolution
```

must display command help.

Existing governance commands must remain unchanged.

---

# Task 6 — JSON Output Support

All commands support:

```
--json
```

Requirements:

* stdout contains only JSON
* no headers
* no formatting text
* stable schema

Example:

```
alix governance evolution list --json
```

must be directly parseable.

---

# Task 7 — Tests

## CLI Tests

| #  | Test                          | Expected Result          |
| -- | ----------------------------- | ------------------------ |
| 1  | list with empty state         | `No evolutions found`    |
| 2  | list with multiple evolutions | all evolutions displayed |
| 3  | list --json                   | valid JSON with counts   |
| 4  | show known ID                 | history displayed        |
| 5  | show unknown ID               | error + exit code 1      |
| 6  | show --json                   | valid JSON               |
| 7  | evidence without records      | `No evidence found`      |
| 8  | evidence with records         | records displayed        |
| 9  | evidence --json               | valid JSON               |
| 10 | evidence unknown ID           | error handling           |

---

# 6. Acceptance Criteria

A0.4 is complete when:

## CLI

* [ ] `alix governance evolution list` implemented
* [ ] `alix governance evolution show <id>` implemented
* [ ] `alix governance evolution evidence <id>` implemented
* [ ] `--json` supported for all commands

---

## Governance

* [ ] CLI is read-only
* [ ] No lifecycle mutation path exists
* [ ] No evidence mutation path exists

---

## Integration

* [ ] Governance dispatcher updated
* [ ] Existing governance commands unaffected
* [ ] State machine queries used as source of truth
* [ ] Evidence store used as source of truth

---

## Testing

* [ ] Unit tests pass
* [ ] CLI integration tests pass
* [ ] Error paths validated

---

# 7. Completion State

After implementation:

```
A0 — Evolution Contract

A0.1  Evolution Contract Types          ✅
A0.2  Evolution Lifecycle State Machine ✅
A0.3  Evolution Evidence Bridge         ✅
A0.4  Evolution Governance Surface      ✅
```

A0 establishes the complete controlled observation chain:

```
Evolution Artifact
        |
        v
Lifecycle State Machine
        |
        v
Execution Evidence
        |
        v
Governance CLI
```

The system is now ready for future controlled evolution phases without introducing autonomous mutation capabilities.

