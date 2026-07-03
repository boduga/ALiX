# P10.9.2a — Proposal State Machine & Readiness

> **Status:** Design — approved for implementation
> **Spoke to:** P10.9.1 (Operational Completeness)
> **Depends on:** Nothing — standalone pure function layer
> **Protected files touched:** None (no ADR-0004 schema changes)

## Goal

Make proposal lifecycle state queryable by deriving operational readiness from stored `ProposalStatus` + action + target + payload — without touching protected adaptation types.

The P10 analytics pipeline (plans, evaluation, recommendations, bridge, effectiveness, correlation) produces sound data, but the operator workflow to *act* on proposals still has opaque states: `executive_remediation` proposals show `approved` but `apply` throws "No applier registered", and there is no way to scan which proposals are actionable vs. blocked vs. waiting for input.

P10.9.2a fixes this by adding a **pure, derived readiness layer** consumed by `list`, `show`, `apply`, and a new `bridge status` subcommand. Nothing is persisted; everything is computed on read.

## Architecture

```
Proposal. status + action + target.kind + payload
                     ↓
        computeProposalReadiness(proposal)
                     ↓
          ProposalReadinessInfo
         /       |        \
    list()    show()    apply() → readiness gate
                             \
                      bridge status (aggregate filtered proposals)
```

**Derived state only.** `ProposalStatus` remains the single source of truth for lifecycle persistence. `ProposalReadiness` is a read-time computation with no cache, no write path, no schema migration.

## Section 1: Type Model

### Stored (untouched)

```typescript
// In adaptation-types.ts — unchanged
type ProposalStatus = "pending" | "approved" | "rejected" | "applied" | "failed";
```

### Derived (new — pure, no persistence)

```typescript
// New file: src/adaptation/proposal-readiness.ts

type ProposalReadiness =
  | "needs_approval"        // pending, has applier → needs human approve
  | "needs_specification"   // approved, unsupported, requiresHumanSpecification
  | "ready_to_apply"        // approved, has applier
  | "manual_action"         // approved, manual kind (intentional non-applyable)
  | "blocked"               // approved, unsupported, no remediation hint
  | "completed";            // applied / rejected / failed

interface ApplySupport {
  supported: boolean;
  kind: "registered_applier" | "manual_kind" | "unsupported";
  reason?: string;
  nextCommand?: string;
}

interface ProposalReadinessInfo {
  /** The canonical stored status — always reflects what's on disk. */
  status: ProposalStatus;
  /**
   * Derived operational readiness. What can the operator do next?
   * Never persisted — computed from status + action + target + payload.
   */
  readiness: ProposalReadiness;
  /** Whether `alix adaptation apply` will succeed on this proposal. */
  applyable: boolean;
  /** Human-readable guidance for the operator's next step. */
  nextAction: string;
  /** Why the proposal is not applyable (when readiness !== ready_to_apply). */
  blocker?: string;
  /** Applier support classification, for routing decisions. */
  support: ApplySupport;
}
```

### Design notes

- `manual_action` is intentionally distinct from `blocked`. Manual kinds (`capability`, `issue`, `routing_weight`) are intentional non-applyable workflows — the operator performs them outside ALiX. `blocked` means "unexpected unsupported or incomplete" — a signal that something is wrong or missing.
- `completed` readiness has a different `nextAction` per terminal status:
  - `applied` → "Assess effectiveness with: `alix adaptation effectiveness <proposalId>`"
  - `rejected` → "No further action required."
  - `failed` → "Inspect failure with: `alix adaptation show <proposalId>`"
- `nextCommand` on `ApplySupport` provides the CLI command to resolve an unsupported state (e.g., `alix executive remediate <proposalId>`). This is available even before the remediate command exists — making the UX future-facing.
- Every `ApplySupport` example includes `kind` to make the classification explicit:
  ```typescript
  { supported: false, kind: "unsupported", reason: "requires human specification", nextCommand: "alix executive remediate <proposalId>" }
  ```

## Section 2: Derivation Rules

The design exposes one pure function as the single entry point:

```typescript
function computeProposalReadiness(proposal: AdaptationProposal): ProposalReadinessInfo
```

### Decision table

| `status` | `target.kind` | `requiresHumanSpecification` | **Readiness** | **Applyable** |
|---|---|---|---|---|
| `pending` | any | any | `needs_approval` | no |
| `approved` | `agent_card` / `skill` / `revert` / `governance` | false/absent | `ready_to_apply` | yes |
| `approved` | `executive_remediation` | `true` | `needs_specification` | no |
| `approved` | `capability` / `issue` / `routing_weight` | any | `manual_action` | no |
| `approved` | `learning` | any | `blocked` | no |
| `approved` | `executive_remediation` | false/absent | `blocked` | no |
| `applied` | any | any | `completed` | no |
| `rejected` | any | any | `completed` | no |
| `failed` | any | any | `completed` | no |

### ApplySupport mapping

| `target.kind` | `supported` | `kind` | `reason` | `nextCommand` |
|---|---|---|---|---|
| `agent_card` | `true` | `registered_applier` | — | — |
| `skill` | `true` | `registered_applier` | — | — |
| `revert` | `true` | `registered_applier` | — | — |
| `governance` | `true` | `registered_applier` | — | — |
| `capability` | `false` | `manual_kind` | — | — |
| `issue` | `false` | `manual_kind` | — | — |
| `routing_weight` | `false` | `manual_kind` | — | — |
| `executive_remediation` | `false` | `unsupported` | "requires human specification" | `alix executive remediate <proposalId>` |
| `learning` | `false` | `unsupported` | "learning proposal application deferred to P8.9/P9" | — |

### `getApplySupport` — safe helper

```typescript
function getApplySupport(proposal: AdaptationProposal): ApplySupport
```

A pure switch that maps `proposal.target.kind` to the ApplySupport table above. Exposed separately so consumers that only need routing classification (e.g., `bridge status` aggregation) can call it without computing the full readiness decision tree.

### `nextAction` derivation

| Readiness | nextAction logic |
|---|---|
| `needs_approval` | `` `Run: alix adaptation approve ${proposal.id}` `` |
| `ready_to_apply` | `` `Run: alix adaptation apply ${proposal.id}` `` |
| `needs_specification` | Use `support.nextCommand` if set, else `` `Proposal ${proposal.id} requires human specification` `` |
| `manual_action` | Use descriptive text: "This is a manual action. See: `alix adaptation show <id>`" |
| `blocked` | `blocker` text: "Proposal is blocked: <reason>" |
| `completed` | Per terminal status (see Section 1 design notes) |

## Section 3: Surface Changes

### 3a. `alix adaptation list`

New default columns — replaces the bare `Status` column with `Status` (stored) + `Readiness` (derived) + `Applyable`:

```
ID                         Status     Readiness            Applyable  Action                     Target
--------------------------------------------------------------------------------------------------------------
prop-2026-06-29-001        pending    needs_approval       no         update_agent_card          agent_card:x
prop-2026-06-29-002        approved   ready_to_apply       yes        governance_change          governance:y
prop-2026-06-29-003        approved   needs_specification  no         executive_remediation      exec:step-1@p10_exec
prop-2026-06-29-004        approved   manual_action        no         create_improvement_issue   issue:Fix X
prop-2026-06-29-005        applied    completed             no         update_agent_card          agent_card:z
```

Formatting:
- **Readiness** column width: 20 chars (padded)
- **Applyable** column width: 10 chars (`yes` / `no`)
- Read-only change — no new flags

### 3b. `alix adaptation show <id>`

Append these lines to the existing `printProposal()` output:

```
Readiness:      needs_specification
Applyable:      no
Blocker:        requires human specification
Next action:    alix executive remediate <proposalId>
```

When readiness is `ready_to_apply`, `Blocker` is omitted and `Next action` shows the apply command.

### 3c. `alix adaptation apply <id>` — readiness gate

In `runApply()`, before calling `selectApplier()`:

| Readiness | Behavior |
|---|---|
| `ready_to_apply` | Proceed to `selectApplier()` → apply normally |
| `needs_approval` | Refuse: "Proposal `<id>` is not yet approved. Run `alix adaptation approve <proposalId>` first." |
| `needs_specification` | Refuse: "Proposal `<id>` requires human specification. Run `alix executive remediate <proposalId>` to fill in details." |
| `manual_action` | Route to existing `printManualAction()` — clean exit, no throw |
| `blocked` | Refuse: "Proposal `<id>` is blocked: `<blocker>`" |
| `completed` | Refuse: "Proposal `<id>` has already been `<applied/rejected/failed>`." |

This replaces `selectApplier` as the user-facing error boundary. After the readiness gate, `selectApplier` is an internal execution detail that only sees `ready_to_apply` proposals.

### 3d. `alix executive bridge status` — new read-only subcommand

```
Usage: alix executive bridge status [--json] [--plan <planId>]
```

Output:

```
Bridge Summary
──────────────
Needs specification:  3
Ready to apply:       0
Manual action:        1
Blocked:              0

Detail:
  prop-c45e  needs_specification  governance    alix executive remediate prop-c45e
  prop-b961  needs_specification  learning       alix executive remediate prop-b961
  prop-33d   manual_action        workflow
```

**Aggregation logic:** Load all proposals via `ProposalStore.list()` whose `sourceRecommendationType` is `"executive_remediation"` or whose `payload.source === "executive_bridge"`. For each matching proposal, compute `computeProposalReadiness()` and group by readiness. This scopes `bridge status` to executive bridge-related proposals by default. A future `--all` flag can extend scope to all proposals.

The `--plan <planId>` filter narrows to proposals whose `payload.planId` matches the given `planId` (canonical — executive remediation proposals store `planId` in `payload`, not `target`). Optionally also checks `target.id` / `target` string as fallback, but `payload` is the primary lookup.

**`--json` output:**

```json
{
  "needsSpecification": 3,
  "readyToApply": 0,
  "manualAction": 1,
  "blocked": 0,
  "details": [
    { "id": "prop-c45e", "readiness": "needs_specification", "subsystem": "governance", "nextCommand": "alix executive remediate prop-c45e" }
  ]
}
```

## Section 4: Three-Gate Lifecycle

P10.9.2a formalizes the three-gate model for proposals that require human specification:

```
pending
    │  alix adaptation approve <id>        ← Gate 1: Policy approval
    ▼
approved (readiness: needs_specification)
    │  alix executive remediate <id>       ← Gate 2: Content specification (P10.9.2b)
    ▼
specified (readiness: ready_to_apply)
    │  alix adaptation apply <id>          ← Gate 3: Execution
    ▼
applied (readiness: completed)
```

- **approve** = "this remediation request is legitimate"
- **specify** = "this is the concrete mutation to perform"
- **apply** = "execute the concrete mutation"

P10.9.2a implements gates 1 and 3 as readiness-aware surfaces. Gate 2 (the remediate wizard) is deferred to P10.9.2b.

## Section 5: Boundaries (explicitly out of scope)

| Feature | Deferred to |
|---|---|
| `alix executive remediate <id>` interactive wizard | P10.9.2b |
| Auto-concretization of `executive_remediation` proposals | P10.9.2b |
| Plan resume after bridge satisfied | P10.9.2c |
| End-to-end lineage plan→proposal→apply→effectiveness | P10.9.2c |
| Promoting derived readiness into stored `ProposalStatus` | Future (if derived proves insufficient) |
| Bridge health panel in Executive Dashboard | Future dashboard iteration |

## Section 6: Implementation Plan — File Map

| File | Action | Purpose |
|---|---|---|
| `src/adaptation/proposal-readiness.ts` | **Create** | Pure types + `computeProposalReadiness()` + `getApplySupport()` |
| `tests/adaptation/proposal-readiness.vitest.ts` | **Create** | Unit tests: every row of the decision table + edge cases |
| `src/cli/commands/adaptation.ts` | **Modify** | `list` columns, `show` readiness block, `runApply` readiness gate |
| `src/cli/commands/executive-bridge-handler.ts` | **Modify** | Add `status` subcommand handler + routing |
| `tests/cli/commands/executive-bridge-status.vitest.ts` | **Create** | Bridge status CLI tests: summary counts, detail rendering, `--json`, `--plan` |
| `tests/cli/commands/adaptation-readiness.vitest.ts` | **Create** | CLI integration tests: list columns, show readiness, apply gate |

**Not modified:** `adaptation-types.ts`, `proposal-store.ts`, `approval-gate.ts`, `executive-plan-types.ts`, or any ADR-0004 protected file.

## Section 7: Risks and Mitigations

| Risk | Mitigation |
|---|---|
| `getApplySupport` duplicates the routing logic in `selectApplier` | Deliberate. `selectApplier` throws on unsupported kinds; `getApplySupport` introspects. They share the same target.kind → applier mapping. A future refactor could unify them, but the risk of drift is low (both are in adjacent files). |
| `bridge status` load all proposals | Proposal count is small (tens, not thousands). O(n) on n < 200 is negligible. No pagination needed. |
| Readiness drift from stored status over time | Not possible — readiness is derived on every read. There is no cached value to go stale. |
