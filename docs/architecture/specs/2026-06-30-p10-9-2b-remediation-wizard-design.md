# P10.9.2b — Remediation Wizard

> **Status:** Design — approved for implementation
> **Spoke to:** P10.9.2a (Proposal Readiness), P10.7c (Executive Bridge)
> **Builds on:** `computeProposalReadiness`, `needs_specification` readiness, `isExecutiveBridgeProposal`
> **Protected files touched:** None (no ADR-0004 schema changes)

## Goal

Turn `needs_specification` proposals into concrete applyable child proposals via a remediation wizard. This is Gate 2 in the three-gate lifecycle (approve → specify → apply), bridging the gap between "approved in principle" and "ready to execute."

## Scope

**P10.9.2b supports:**
- `executive_remediation_request` → concrete applyable child proposal
- 3 applyable action families: `governance`, `agent_card`, `skill`
- 1 manual action family: `issue`

**P10.9.2b rejects:**
- Non-executive `needs_specification` proposals → `"unsupported remediation source"`

## Architecture

```
alix executive remediate <proposalId> [--action <type> --target <id> --reason <text> --payload <file> --json]
         │
         ▼
  handleRemediateCommand(args)
         │
         ├─ load parent proposal (ProposalStore.load)
         ├─ guard: validateRemediationParent(parent)
         │     (approved + needs_specification + executive_bridge)
         │
         ├─ interactive (no flags) ─── non-interactive (flags present)
         │     │                             │
         │     ▼                             ▼
         │  runRemediateWizard()      parse flags directly
         │  prompt: action type       (--action required)
         │  prompt: target ID         (--target required)
         │  prompt: reason            (--reason required)
         │     │                             │
         │     └─────────┬───────────────────┘
         │               ▼
         │    buildRemediationChildDraft(parent, spec)
         │               │  (pure — no I/O, no ids, no timestamps)
         │               ▼
         │    assign id (nextProposalId)
         │    assign createdAt (ISO timestamp)
         │               │
         │               ▼
         │    ProposalStore.save(child)
         │    evidence: adaptation_proposed
         │               │
         │               ▼
         │    console output / JSON
```

## Section 1: Types & Constants

```typescript
// New file: src/executive/executive-remediate.ts

interface ActionSpec {
  action: ProposalAction;
  targetKind: ProposalTarget["kind"];
}

const REMEDIATION_ACTIONS: Record<string, ActionSpec> = {
  governance: { action: "governance_change", targetKind: "governance" },
  agent_card: { action: "update_agent_card", targetKind: "agent_card" },
  skill:      { action: "update_skill",       targetKind: "skill" },
  issue:      { action: "create_issue",       targetKind: "issue" },
};

interface RemediationSpec {
  actionName: keyof typeof REMEDIATION_ACTIONS;
  targetId: string;
  reason: string;
  additionalPayload?: Record<string, unknown>;
}

interface ChildProposalDraft {
  action: ProposalAction;
  target: ProposalTarget;
  payload: Record<string, unknown>;
  sourceRecommendationType: string;
  sourceConfidence: number;
  reason: string;
}
```

## Section 2: Provider Interface & Implementation

```typescript
interface ProposalRemediator {
  /** Whether this remediator handles the given proposal. */
  supports(proposal: AdaptationProposal): boolean;

  /**
   * Build a child proposal draft from a parent proposal and specification.
   * Pure — never reads filesystem, never generates ids/timestamps,
   * never mutates parent, always returns identical output for identical inputs.
   */
  buildDraft(
    parent: AdaptationProposal,
    specification: RemediationSpec,
  ): ChildProposalDraft;
}
```

P10.9.2b registers exactly one implementation:

```typescript
class ExecutiveBridgeRemediator implements ProposalRemediator {
  supports(proposal: AdaptationProposal): boolean {
    return isExecutiveBridgeProposal(proposal);
  }

  buildDraft(parent: AdaptationProposal, spec: RemediationSpec): ChildProposalDraft;
}
```

Future extensions (not implemented in P10.9.2b):
- `LearningRemediator`
- `CapabilityRemediator`
- `GovernanceRemediator`

## Section 3: Pure Functions

### `validateRemediationParent`

```typescript
function validateRemediationParent(
  proposal: AdaptationProposal | undefined
): { valid: true } | { valid: false; reason: string } {
  // 1. proposal exists (not undefined)
  // 2. status === "approved"
  // 3. computeProposalReadiness(proposal).readiness === "needs_specification"
  // 4. isExecutiveBridgeProposal(proposal)
}
```

### `buildRemediationChildDraft`

```typescript
function buildRemediationChildDraft(
  parent: AdaptationProposal,
  spec: RemediationSpec,
): ChildProposalDraft {
  const actionSpec = REMEDIATION_ACTIONS[spec.actionName];

  // Build lineage payload — these fields are immutable,
  // copied from parent, never overridable by --payload
  const lineagePayload = {
    parentProposalId: parent.id,
    parentAction: parent.action,
    parentTarget: parent.target,
    source: "executive_remediate",
    planId: (parent.payload as Record<string, unknown>)?.planId ?? undefined,
    stepId: (parent.payload as Record<string, unknown>)?.stepId ?? undefined,
    objectiveId: (parent.payload as Record<string, unknown>)?.objectiveId ?? undefined,
    subsystem: (parent.payload as Record<string, unknown>)?.subsystem ?? undefined,
  };

  // Merge: additionalPayload first, lineagePayload second (lineage wins)
  const mergedPayload = {
    ...(spec.additionalPayload ?? {}),
    ...lineagePayload,
  };

  return {
    action: actionSpec.action,
    target: { kind: actionSpec.targetKind, id: spec.targetId },
    payload: mergedPayload,
    sourceRecommendationType: parent.sourceRecommendationType,
    sourceConfidence: parent.sourceConfidence,
    reason: spec.reason,
  };
}
```

**Pure builder contract:**
- Never reads the filesystem
- Never generates ids or timestamps
- Never mutates the parent proposal
- Never saves proposals
- Always returns identical output for identical inputs

## Section 4: CLI Surface

### Routing

Add case to `src/cli/commands/executive.ts` dispatcher:

```typescript
case "remediate":
  return handleRemediateCommand(args.slice(1));
```

### Command

```
alix executive remediate <proposalId> [flags]
```

### Flags

| Flag | Interactive | Non-interactive | Description |
|------|-------------|-----------------|-------------|
| `--action` | Menu-picked | Required | `governance`, `agent_card`, `skill`, `issue` |
| `--target` | Prompted | Required | Target ID string |
| `--reason` | Prompted | Required | Human-readable reason |
| `--payload` | N/A | Optional | Path to JSON file merged into child payload |
| `--json` | ❌ (errors only) | Optional | Structured JSON output |

### Interactive wizard (terminal output)

```
$ alix executive remediate prop-007

Inspecting prop-007 (executive_remediation | approved | needs_specification)...

Context: plan p10_exec, recommendation "increase maxIterations"

What kind of remediation?
  1) governance change   → creates: governance_change proposal
  2) agent card update   → creates: update_agent_card proposal
  3) skill update        → creates: update_skill proposal
  4) manual issue        → creates: create_issue proposal
> 3

Target ID: skill-agent-planner
Reason: increase maxIterations from 5 to 10

── Summary ──
  Action:  update_skill
  Target:  skill-agent-planner
  Reason:  increase maxIterations from 5 to 10

Proceed? [Y/n] y

✓ Created child proposal prop-008
  alix adaptation show prop-008
  alix adaptation approve prop-008
  alix adaptation apply prop-008
```

### Non-interactive path

```bash
alix executive remediate prop-007 \
  --action skill \
  --target skill-agent-planner \
  --reason "increase maxIterations from 5 to 10"
```

### JSON output (`--json`)

```json
{
  "ok": true,
  "parentProposalId": "prop-007",
  "childProposalId": "prop-008",
  "childAction": "update_skill",
  "childReadiness": "needs_approval"
}
```

### Error cases

| Condition | Output |
|-----------|--------|
| Proposal not found | `"Proposal not found: <id>"` |
| Not remediable | `"Proposal <id> is not eligible for remediation (requires: status=approved, readiness=needs_specification, source=executive_bridge)"` |
| `--action` missing (flag mode) | `"--action is required. Supported: governance, agent_card, skill, issue"` |
| Unknown `--action` | `"Invalid action: <x>. Supported: governance, agent_card, skill, issue"` |
| `--target` missing (flag mode) | `"--target is required"` |
| `--reason` missing (flag mode) | `"--reason is required"` |
| `--json` without required flags | Structured error JSON, no prompts |
| `--payload` file not found | `"Payload file not found: <path>"` |

## Section 5: Invariants

### R1 — Parent immutability

The parent `executive_remediation` proposal is never modified by the remediation wizard. Remediation always creates exactly one child proposal. The parent remains the permanent audit record of the original executive request.

### R2 — Child lineage is immutable

The following fields are copied from the parent and MUST NOT be modified by the operator or by `--payload`:

```
parentProposalId
parentAction
parentTarget
source = "executive_remediate"
planId
objectiveId
stepId
subsystem
```

Enforced by merge order: `additionalPayload` first, lineage payload second (lineage wins).

### R3 — One-way lifecycle

The child proposal never affects the parent's status or lifecycle. No automatic status changes on the parent.

```
Parent                              Child
──────                              ─────
approved (needs_specification)      pending (needs_approval)
                                    → approved (ready_to_apply)
                                    → applied (completed)
```

True until P10.9.2c introduces orchestration.

### R4 — Pure builder contract

`buildRemediationChildDraft(parent, spec)`:
- Never reads the filesystem
- Never generates ids
- Never generates timestamps
- Never mutates the parent
- Never saves proposals
- Always returns identical output for identical inputs

### R5 — Handler contract

The handler owns every side effect:

```
load proposal → validate → collect specification → build draft
→ assign id → assign timestamps → save → print
```

No side effects in the pure layer.

## Section 6: Files

| File | Action | Purpose |
|------|--------|---------|
| `src/executive/executive-remediate.ts` | **Create** | Pure types, constants, `ProposalRemediator` interface, `ExecutiveBridgeRemediator`, `validateRemediationParent`, `buildRemediationChildDraft` |
| `tests/executive/executive-remediate.vitest.ts` | **Create** | Unit tests for pure functions |
| `src/cli/commands/executive-remediate-handler.ts` | **Create** | `handleRemediateCommand`, `runRemediateWizard` |
| `tests/cli/commands/executive-remediate-cli.vitest.ts` | **Create** | CLI integration tests |
| `src/cli/commands/executive.ts` | **Modify** | Add `"remediate"` case to dispatcher |
| Executive purity sentinel | **Modify** | Add both new files to `EXECUTIVE_FILES` allowlist |

## Section 7: Success Criteria

- ✅ Parent proposal remains unchanged (immutable)
- ✅ Child proposal is created with `status = "pending"`
- ✅ Child passes existing readiness computation (`needs_approval` → `ready_to_apply` after approval)
- ✅ Existing appliers apply the child without modification
- ✅ No new persistence layer
- ✅ No ADR-0004 protected files modified
- ✅ Full test suite green
- ✅ Executive purity sentinel green
- ✅ 100% unit coverage of pure builder and validation functions
