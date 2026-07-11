# A0.4 — Evolution Governance Surface Implementation Plan

**Phase:** A0 — Evolution Contract
**Slice:** A0.4 — Evolution Governance Surface
**Design Spec:** `docs/architecture/specs/2026-07-11-a0-4-evolution-governance-surface-design.md`

**Depends On:**
- A0.2 — Evolution Lifecycle State Machine
- A0.3 — Evolution Evidence Bridge
- X3b — ExecutionEvidenceStore (for evidence queries)
- P9.0f — CLI dispatcher (`alix governance`)

**Checkpoint Target:** `alix-a0-4-evolution-governance-surface-complete`

---

## 1. Purpose

A0.4 exposes evolution state and evidence through the existing `alix governance` CLI. Read-only — observes evolution lifecycle artifacts without mutation.

---

## 2. Scope

### Implemented

- `alix governance evolution list` — list evolutions with current state
- `alix governance evolution show <id>` — lifecycle history for one evolution
- `alix governance evolution evidence <id>` — evidence records for one evolution
- `--json` flag for machine-readable output
- Human-readable terminal output
- Integration with existing CLI dispatcher

### Deferred

| Capability | Deferred To |
|------------|-------------|
| Mutation commands | A2/A3 (sandbox + adaptation loop) |
| Web UI or dashboard | Future |
| Evolution proposal generation | A1 |

---

## 3. File Changes

| Action | File |
|--------|------|
| CREATE | `src/governance/evolution-cli.ts` |
| MODIFY | `src/cli/commands/governance.ts` (add dispatch) |
| CREATE | `tests/governance/evolution-cli.test.ts` |

---

## 4. Implementation Tasks

### Task 1 — CLI Handler (`evolution-cli.ts`)

```
export function handleEvolutionCommand(
  args: string[],
  deps: { stateMachine: EvolutionStateMachine; evidenceStore: ExecutionEvidenceStore },
): Promise<void>
```

Subcommand dispatch:

```
list      → print all evolutions with state
show <id> → print lifecycle history for one evolution
evidence <id> → print evidence for one evolution
```

### Task 2 — List Command

Iterate known evolution IDs, print table of id + state + target + createdAt.

Human format — `list`:

```
Evolutions (3):

  evol-config-v2     APPROVED    policy             2026-07-11T10:00:00Z
  evol-retry-policy  IMPLEMENTING runtime_config     2026-07-11T09:00:00Z
  evol-agent-x       REJECTED    agent_behavior     2026-07-11T08:00:00Z

ACTIVE: 0 | APPROVED: 1 | IMPLEMENTING: 1 | REJECTED: 1
```

JSON format:

```json
{
  "evolutions": [ { "evolutionId": "...", "state": "...", ... } ],
  "counts": { "total": 3, "byState": {} }
}
```

### Task 3 — Show Command

Print full lifecycle for one evolution.

Human format — `show <id>`:

```
Evolution: evol-config-v2
  Target:   policy (policy-approval-threshold)
  Origin:   operator
  Risk:     medium
  State:    APPROVED

History (chronological):
  DRAFT → PROPOSED     2026-07-11T10:00:00Z  Proposed
  PROPOSED → UNDER_REVIEW 2026-07-11T10:30:00Z  Sent for review
  UNDER_REVIEW → APPROVED 2026-07-11T11:00:00Z  Approved
```

### Task 4 — Evidence Command

Query `ExecutionEvidenceStore.getByIntentId(id)` and print results.

### Task 5 — Dispatch

Add `case "evolution"` to `handleGovernanceCommand` in `governance.ts`.

### Task 6 — Tests

| # | Test | Verification |
|---|------|-------------|
| 1 | `list` with empty state | "No evolutions found" |
| 2 | `list` with 2 evolutions | Both shown with correct state |
| 3 | `list --json` with 2 evolutions | JSON array with correct counts |
| 4 | `show <id>` with known id | Full history printed |
| 5 | `show <id>` with unknown id | Error message, exit code 1 |
| 6 | `show <id> --json` | JSON output |
| 7 | `evidence <id>` with no evidence | "No evidence found" |
| 8 | `evidence <id>` with records | Evidence list printed |
| 9 | `evidence <id> --json` | JSON output |
| 10 | `evidence <id>` with unknown id | Error message |
