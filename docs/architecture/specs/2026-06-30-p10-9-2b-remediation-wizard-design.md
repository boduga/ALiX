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
alix executive remediate <proposalId> [--action <type> --target <id> --reason <text> --payload <file> --json --dry-run]
         │
         ▼
  handleRemediateCommand(args)
         │
         ├─ load parent proposal (ProposalStore.load)
         ├─ guard: validateRemediationParent(parent)
         │     (approved + needs_specification + executive_bridge)
         │
         ├─ --dry-run?                        ───→ print preview, exit
         │
         ├─ interactive (no flags) ─── non-interactive (flags present)
         │     │                             │
         │     ▼                             ▼
         │  runRemediateWizard()      parse flags directly
         │  (remediator.promptSpec.)   (--action required)
         │                             (--target required)
         │                             (--reason required)
         │     │                             │
         │     └─────────┬───────────────────┘
         │               ▼
         │    buildRemediationChildDraft(parent, spec, context)
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

interface RemediationContext {
  actor: string;
  timestamp?: string;
  mode: "interactive" | "noninteractive";
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

## Section 2: Provider Interface & Registry

```typescript
interface ProposalRemediator {
  /** Unique identifier for this remediator. */
  readonly id: string;

  /** Human-readable description. */
  readonly description: string;

  /** Proposal source types this remediator supports. */
  readonly supportedSources: string[];

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
    context: RemediationContext,
  ): ChildProposalDraft;

  /**
   * Optional interactive specification prompts for this remediator.
   * Returns a RemediationSpec, or null if cancelled.
   */
  promptSpecification?(parent: AdaptationProposal): Promise<RemediationSpec | null>;
}
```

Registry:

```typescript
const REMEDIATORS: ProposalRemediator[] = [
  new ExecutiveBridgeRemediator(),
];
```

Lookup:

```typescript
const remediator = REMEDIATORS.find(r => r.supports(parent));
if (!remediator) {
  // "No remediator supports proposal <id>"
  return;
}
```

P10.9.2b registers exactly one implementation:

```typescript
class ExecutiveBridgeRemediator implements ProposalRemediator {
  id = "executive-bridge";
  description = "Remediate executive bridge recommendations";
  supportedSources = ["executive_bridge"];

  supports(proposal: AdaptationProposal): boolean {
    return isExecutiveBridgeProposal(proposal);
  }

  buildDraft(parent: AdaptationProposal, spec: RemediationSpec, context: RemediationContext): ChildProposalDraft;

  async promptSpecification(parent: AdaptationProposal): Promise<RemediationSpec | null> {
    // "What kind of remediation?" (1-4)
    // "Target ID:"
    // "Reason:"
    // Returns null if cancelled (Ctrl+C or "n" at confirm)
  }
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

### `mergeLineagePayload`

Reusable helper, unit-tested once, used by all future providers:

```typescript
function mergeLineagePayload(
  additional: Record<string, unknown> | undefined,
  lineage: Record<string, unknown>,
): Record<string, unknown> {
  // additional first, lineage second (lineage always wins)
  return { ...(additional ?? {}), ...lineage };
}
```

### `buildRemediationChildDraft`

```typescript
function buildRemediationChildDraft(
  parent: AdaptationProposal,
  spec: RemediationSpec,
  context: RemediationContext,
): ChildProposalDraft {
  const actionSpec = REMEDIATION_ACTIONS[spec.actionName];

  // Build lineage payload — these fields are immutable,
  // copied from parent, never overridable by --payload
  const parentPayload = parent.payload as Record<string, unknown>;
  const lineagePayload = {
    // Core lineage
    parentProposalId: parent.id,
    parentAction: parent.action,
    parentTarget: parent.target,
    source: "executive_remediate",

    // "Why" lineage — self-describing audit
    derivedFrom: "executive_remediation",
    remediationType: spec.actionName,
    remediationReason: spec.reason,

    // Inherited plan context
    planId: parentPayload?.planId ?? undefined,
    stepId: parentPayload?.stepId ?? undefined,
    objectiveId: parentPayload?.objectiveId ?? undefined,
    subsystem: parentPayload?.subsystem ?? undefined,

    // Preserved recommendation metadata
    recommendationId: parentPayload?.recommendationId ?? undefined,
    evaluationId: parentPayload?.evaluationId ?? undefined,
    reflectionId: parentPayload?.reflectionId ?? undefined,
  };

  // Merge: additionalPayload first, lineagePayload second (lineage wins)
  const mergedPayload = mergeLineagePayload(spec.additionalPayload, lineagePayload);

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
| `--dry-run` | Previews | Previews | Show child draft without saving |
| `--json` | ❌ (errors only) | Optional | Structured JSON output |

`--json` implies non-interactive: if required flags are missing, returns a structured error JSON and exits (no prompts). `--dry-run` never writes to the proposal store.

### Interactive wizard (terminal output)

```
$ alix executive remediate prop-007

Parent proposal
───────────────────────────────────────
  ID:            prop-007
  Status:        approved
  Readiness:     needs_specification
  Source:        executive_bridge

  Subsystem:     workflow
  Plan:          p10_exec
  Objective:     obj-3
  Step:          create_remediation
  Risk:          high

  Recommendation:
    Increase planner maxIterations from 5 to 10

What kind of remediation?
  1) governance change   → creates: governance_change proposal
  2) agent card update   → creates: update_agent_card proposal
  3) skill update        → creates: update_skill proposal
  4) manual issue        → creates: create_issue proposal
> 3

Target ID: skill-agent-planner
Reason: increase maxIterations from 5 to 10

── Summary ──
  Action:        update_skill
  Target:        skill-agent-planner
  Reason:        increase maxIterations from 5 to 10
  Parent:        prop-007
  Remediation:   skill

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

### Dry-run path

```bash
alix executive remediate prop-007 \
  --action skill \
  --target planner \
  --reason "Increase iterations" \
  --dry-run
```

Output:

```
Child proposal
───────────────────────────────────────
  Action:        update_skill
  Target:        planner
  Payload:       { parentProposalId: "prop-007", ... }
  Status:        pending
  Readiness:     needs_approval

Nothing written.
```

### Cancellation

```
Proceed? [Y/n] n

Cancelled.

No proposal created.
```

`Ctrl+C` also produces `"Cancelled."` with exit code 0. Tested.

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

Dry-run JSON:

```json
{
  "ok": true,
  "dryRun": true,
  "parentProposalId": "prop-007",
  "childAction": "update_skill",
  "childTarget": { "kind": "skill", "id": "planner" },
  "childReadiness": "needs_approval"
}
```

### Error cases

| Condition | Output |
|-----------|--------|
| Proposal not found | `"Proposal not found: <id>"` |
| Not remediable | `"Proposal <id> is not eligible for remediation (requires: status=approved, readiness=needs_specification, source=executive_bridge)"` |
| No remediator supports | `"No remediator supports proposal <id>"` |
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
source
derivedFrom
remediationType
remediationReason
planId
objectiveId
stepId
subsystem
recommendationId
evaluationId
reflectionId
```

Enforced by `mergeLineagePayload`: `additionalPayload` first, lineage payload second (lineage always wins).

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

`buildRemediationChildDraft(parent, spec, context)`:
- Never reads the filesystem
- Never generates ids
- Never generates timestamps
- Never mutates the parent
- Never saves proposals
- Always returns identical output for identical inputs

### R5 — Handler contract

The handler owns every side effect:

```
load proposal → validate → find remediator → collect specification
→ build draft → assign id → assign timestamps → save → print
```

No side effects in the pure layer.

## Section 6: Files

| File | Action | Purpose |
|------|--------|---------|
| `src/executive/executive-remediate.ts` | **Create** | Pure types, constants, `ProposalRemediator` interface + registry, `ExecutiveBridgeRemediator`, `validateRemediationParent`, `mergeLineagePayload`, `buildRemediationChildDraft` |
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
- ✅ `--dry-run` never writes to the proposal store
- ✅ Interactive cancellation never creates a child proposal
- ✅ Multiple remediation providers can coexist without modifying `handleRemediateCommand()`
