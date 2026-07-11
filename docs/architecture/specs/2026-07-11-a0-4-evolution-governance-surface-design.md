# A0.4 — Evolution Governance Surface Design Specification

**Date:** 2026-07-11
**Status:** Design Specification
**Phase:** A0 — Evolution Contract
**Slice:** A0.4 — Evolution Governance Surface

**Depends On:**
- A0.1 — Evolution Contract Types
- A0.2 — Evolution Lifecycle State Machine
- A0.3 — Evolution Evidence Bridge
- P9.0f — CLI dispatcher (`alix governance`)

**Checkpoint Target:** `alix-a0-4-evolution-governance-surface-complete`

---

## 1. Purpose

A0.4 exposes evolution state and evidence through the existing `alix governance` CLI. Operators can list active evolutions, inspect their lifecycle history, and view evolution evidence — all read-only, no mutation.

---

## 2. Primary Invariant

> The evolution CLI is read-only. It observes evolution state and evidence but never creates, transitions, or modifies evolution lifecycle artifacts.

---

## 3. Commands

```
alix governance evolution

alix governance evolution list            — List all tracked evolutions
alix governance evolution show <id>       — Show lifecycle history for one evolution
alix governance evolution evidence <id>   — Show evidence for one evolution
alix governance evolution --json          — Machine-readable output for all commands
```

---

## 4. Command Definitions

### `list`

Lists all evolutions with their current state.

**Output (human-readable):**

```
Evolutions (3):

  evol-config-v2     APPROVED    policy             2026-07-11T10:00:00Z
  evol-retry-policy  IMPLEMENTING runtime_config     2026-07-11T09:00:00Z
  evol-agent-x       REJECTED    agent_behavior     2026-07-11T08:00:00Z

ACTIVE: 0 | APPROVED: 1 | IMPLEMENTING: 1 | REJECTED: 1
```

**Output (`--json`):**

```json
{
  "evolutions": [
    { "evolutionId": "evol-config-v2", "state": "APPROVED", "target": { "kind": "policy", "id": "..." }, "createdAt": "..." }
  ],
  "counts": { "total": 3, "byState": { "APPROVED": 1, "IMPLEMENTING": 1, "REJECTED": 1 } }
}
```

### `show <id>`

Shows the full lifecycle history for one evolution.

**Output (human-readable):**

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

**Output (`--json`):**

```json
{
  "evolutionId": "evol-config-v2",
  "state": "APPROVED",
  "target": { "kind": "policy", "id": "policy-approval-threshold" },
  "origin": "operator",
  "riskClass": "medium",
  "history": [
    { "from": "DRAFT", "to": "PROPOSED", "timestamp": "..." },
    { "from": "PROPOSED", "to": "UNDER_REVIEW", "timestamp": "..." },
    { "from": "UNDER_REVIEW", "to": "APPROVED", "timestamp": "..." }
  ],
  "historyLength": 3
}
```

### `evidence <id>`

Shows evidence records for one evolution.

**Output (human-readable):**

```
Evidence for evol-config-v2 (3 records):

  evoe-xxxx  EvolutionProposed      2026-07-11T10:00:00Z  PARTIAL
  evoe-yyyy  EvolutionSentForReview 2026-07-11T10:30:00Z  PARTIAL
  evoe-zzzz  EvolutionApproved      2026-07-11T11:00:00Z  PARTIAL
```

**Output (`--json`):**

```json
{
  "evolutionId": "evol-config-v2",
  "evidence": [
    { "evidenceId": "evoe-xxxx", "eventType": "EvolutionProposed", "timestamp": "..." }
  ],
  "totalEvidence": 1
}
```

---

## 5. Data Sources

| Command | Data Source | Mechanism |
|---------|-------------|-----------|
| `list` | `EvolutionStateMachine` | Queries in-memory state via `getStatus()` |
| `show` | `EvolutionStateMachine` | Queries history via `getHistory()` |
| `evidence` | `ExecutionEvidenceStore` | Queries persisted evidence via `getByIntentId()` |

---

## 6. Output Rules

- Human output uses plain text (no colors required)
- JSON output uses `--json` flag
- Lists sorted by `createdAt` ascending (oldest first)
- Empty lists print "No evolutions found." (human) or `[]` (JSON)
- Unknown evolution ID prints "Evolution not found: <id>" and exits with code 1

---

## 7. Non-Goals

A0.4 does **not** include:

- Mutation commands (`create`, `transition`, `approve`, `reject`)
- Automatic evolution proposal generation (A1)
- Evolution sandbox (A2)
- Governed adaptation loop (A3)
- Persistent storage of evolution state (in-memory state machine only)
- Web UI or dashboard
