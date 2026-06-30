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
         ├─ validate: validateRemediationParent(parent)
         │     → structured error codes (NOT_FOUND, NOT_APPROVED, etc.)
         │
         ├─ find provider: registry.find(parent)
         │     → fails if 0 or >1 match
         │
         ├─ --dry-run?                     ───→ full pipeline, skip save, print
         │
         ├─ interactive (no flags) ─── non-interactive (flags present)
         │     │                             │
         │     ▼                             ▼
         │  provider.promptSpecification()   parse flags directly
         │  (preselects based on context)     (--action required)
         │                                    (--target required)
         │                                    (--reason required)
         │     │                             │
         │     └─────────┬───────────────────┘
         │               ▼
         │    validateSpecification(spec, provider)
         │    validatePayload(additionalPayload)
         │         (reject reserved lineage keys with clear error)
         │               │
         │               ▼
         │    provider.buildDraft(parent, spec, context)
         │       (pure — no I/O, no ids, no timestamps
         │        dry-run uses identical pipeline)
         │               │
         │               ▼
         │    assign id (nextProposalId)
         │    assign createdAt (ISO timestamp)
         │               │
         │               ▼
         │    ProposalStore.save(child)  [skipped in --dry-run]
         │    evidence: adaptation_proposed
         │               │
         │               ▼
         │    console output / JSON
```

## Section 1: Types

```typescript
// New file: src/executive/executive-remediate.ts

interface ActionSpec {
  action: ProposalAction;
  targetKind: ProposalTarget["kind"];
}

interface RemediationSpec {
  actionName: string;
  targetId: string;
  reason: string;
  additionalPayload?: Record<string, unknown>;
}

interface RemediationContext {
  actor: string;
  timestamp?: string;
  mode: "interactive" | "noninteractive";
}

type ValidationErrorCode =
  | "NOT_FOUND"
  | "NOT_APPROVED"
  | "NOT_EXECUTIVE"
  | "WRONG_READINESS";

interface ValidationResult {
  valid: boolean;
  code?: ValidationErrorCode;
  message?: string;
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
interface RemediationProvider {
  /** Unique identifier. */
  readonly id: string;

  /** Human-readable description. */
  readonly description: string;

  /** Proposal source types this provider supports. */
  readonly supportedSources: string[];

  /** Dispatch priority (lower = first). */
  readonly priority: number;

  /** Schema version for lineage payload. */
  readonly version: string;

  /** Actions this provider can produce. */
  supportedActions(): readonly ActionSpec[];

  /** Whether this provider handles the given proposal. */
  supports(proposal: AdaptationProposal): boolean;

  /** Build a child proposal draft. Pure — deterministic, no I/O, no ids, no timestamps. */
  buildDraft(
    parent: AdaptationProposal,
    specification: RemediationSpec,
    context: RemediationContext,
  ): ChildProposalDraft;

  /** Optional interactive specification prompts. Returns null if cancelled. */
  promptSpecification?(parent: AdaptationProposal): Promise<RemediationSpec | null>;
}
```

Registry:

```typescript
class RemediatorRegistry {
  register(provider: RemediationProvider): void;
  unregister(id: string): void;
  find(proposal: AdaptationProposal): RemediationProvider;
    // Throws if 0 matches: "No remediator supports proposal <id>"
    // Throws if >1 matches: "Multiple remediators support proposal <id>: ..."
  list(): readonly RemediationProvider[];
}
```

Registration:

```typescript
const registry = new RemediatorRegistry();
registry.register(new ExecutiveBridgeRemediator());
```

P10.9.2b registers exactly one provider:

```typescript
class ExecutiveBridgeRemediator implements RemediationProvider {
  id = "executive-bridge";
  description = "Remediate executive bridge recommendations";
  supportedSources = ["executive_bridge"];
  priority = 100;
  version = "1.0.0";

  supportedActions(): readonly ActionSpec[] {
    return [
      { action: "governance_change", targetKind: "governance" },
      { action: "update_agent_card",  targetKind: "agent_card" },
      { action: "update_skill",       targetKind: "skill" },
      { action: "create_issue",       targetKind: "issue" },
    ];
  }

  supports(proposal: AdaptationProposal): boolean {
    return isExecutiveBridgeProposal(proposal);
  }

  buildDraft(parent: AdaptationProposal, spec: RemediationSpec, context: RemediationContext): ChildProposalDraft { ... }

  async promptSpecification(parent: AdaptationProposal): Promise<RemediationSpec | null> {
    // "What kind of remediation?" with suggested action preselected
    // "Target ID:"
    // "Reason:"
    // Returns null if cancelled (Ctrl+C or "n" at confirm)
  }
}
```

## Section 3: Pure Functions

### `validateRemediationParent`

```typescript
function validateRemediationParent(
  proposal: AdaptationProposal | undefined
): ValidationResult {
  if (!proposal)
    return { valid: false, code: "NOT_FOUND", message: "Proposal not found" };
  if (proposal.status !== "approved")
    return { valid: false, code: "NOT_APPROVED", message: `Proposal status is "${proposal.status}", expected "approved"` };
  if (!isExecutiveBridgeProposal(proposal))
    return { valid: false, code: "NOT_EXECUTIVE", message: "Proposal is not an executive bridge proposal" };
  if (computeProposalReadiness(proposal).readiness !== "needs_specification")
    return { valid: false, code: "WRONG_READINESS", message: `Proposal readiness is "${computeProposalReadiness(proposal).readiness}", expected "needs_specification"` };
  return { valid: true };
}
```

### `validatePayload` — reserved key guard

```typescript
const RESERVED_PAYLOAD_KEYS = new Set([
  "parentProposalId", "parentAction", "parentTarget",
  "source", "derivedFrom", "remediationType", "remediationReason",
  "planId", "stepId", "objectiveId", "subsystem",
  "recommendationId", "evaluationId", "reflectionId",
  "parentCreatedAt", "parentStatus", "parentReadiness",
  "lineageType", "lineageDepth", "lineageSchemaVersion",
  "orchestrationState",
]);

function validatePayload(payload: Record<string, unknown>): string | null {
  for (const key of Object.keys(payload)) {
    if (RESERVED_PAYLOAD_KEYS.has(key)) {
      return `"${key}" is a reserved lineage field and cannot be set via --payload`;
    }
  }
  return null; // valid
}
```

### `validateSpecification`

```typescript
function validateSpecification(spec: RemediationSpec, provider: RemediationProvider): string | null {
  const actions = provider.supportedActions();
  if (!actions.some(a => a.action === spec.actionName && a.targetKind === spec.targetKind))
    return `Action "${spec.actionName}" is not supported by provider "${provider.id}"`;
  if (!spec.targetId || spec.targetId.trim().length === 0)
    return "targetId is required";
  if (!spec.reason || spec.reason.trim().length < 10)
    return "reason is required and must be at least 10 characters";
  return null; // valid
}
```

### `mergeLineagePayload`

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
  const provider = registry.find(parent);
  const actionSpec = provider.supportedActions().find(a => a.action === spec.actionName)!;

  // Build immutable lineage payload
  const parentPayload = parent.payload as Record<string, unknown>;
  const readiness = computeProposalReadiness(parent);
  const lineagePayload = {
    // Core lineage
    parentProposalId: parent.id,
    parentAction: parent.action,
    parentTarget: parent.target,
    source: "executive_remediate",

    // Parent version snapshot
    parentCreatedAt: parent.createdAt,
    parentStatus: parent.status,
    parentReadiness: readiness.readiness,

    // "Why" lineage
    derivedFrom: "executive_remediation",
    remediationType: spec.actionName,
    remediationReason: spec.reason,

    // Graph-friendly lineage
    lineageType: "remediation",
    lineageDepth: 1,
    lineageSchemaVersion: 1,

    // Inherited plan context
    planId: parentPayload?.planId ?? undefined,
    stepId: parentPayload?.stepId ?? undefined,
    objectiveId: parentPayload?.objectiveId ?? undefined,
    subsystem: parentPayload?.subsystem ?? undefined,

    // Preserved recommendation metadata
    recommendationId: parentPayload?.recommendationId ?? undefined,
    evaluationId: parentPayload?.evaluationId ?? undefined,
    reflectionId: parentPayload?.reflectionId ?? undefined,

    // Reserved for P10.9.2c orchestration
    orchestrationState: undefined,
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
| `--action` | Menu-picked (suggested) | Required | One of provider's `supportedActions()` |
| `--target` | Prompted | Required | Target ID string |
| `--reason` | Prompted | Required | Human-readable reason (min 10 chars) |
| `--payload` | N/A | Optional | Path to JSON file merged into child payload |
| `--dry-run` | Previews | Previews | Full pipeline, no save |
| `--json` | ❌ (errors only) | Optional | Structured JSON output |

`--json` implies non-interactive: if required flags are missing, returns a structured error JSON and exits (no prompts). `--dry-run` executes the identical validation and build pipeline as a normal execution. The only omitted step is persistence.

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
  [1] Skill Update  ← recommended
  [2] Governance
  [3] Agent Card
  [4] Issue
> 1

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
  --action update_skill \
  --target skill-agent-planner \
  --reason "increase maxIterations from 5 to 10"
```

### Dry-run path

```bash
alix executive remediate prop-007 \
  --action update_skill \
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

`Ctrl+C` also produces `"Cancelled."` with exit code 0.

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
| Not remediable | Structured error with code + message |
| No provider | `"No remediator supports proposal <id>"` |
| Multiple providers | `"Multiple remediators support proposal <id>: ..."` |
| `--action` missing (flag mode) | `"--action is required"` |
| Unknown `--action` | `"Invalid action. Supported: ..."` |
| Residual payload key | `"<key> is a reserved lineage field"` |
| `--json` without required flags | Structured error JSON, no prompts |
| `--payload` file not found | `"Payload file not found"` |

## Section 5: Invariants

### R1 — Parent immutability

The parent `executive_remediation` proposal is never modified by the remediation wizard. Remediation always creates exactly one child proposal. The parent remains the permanent audit record of the original executive request.

### R2 — Child lineage is immutable

The following fields are copied from the parent and MUST NOT be modified by the operator or by `--payload`:

```
parentProposalId, parentAction, parentTarget, parentCreatedAt, parentStatus, parentReadiness
source, derivedFrom, remediationType, remediationReason
lineageType, lineageDepth, lineageSchemaVersion
planId, objectiveId, stepId, subsystem
recommendationId, evaluationId, reflectionId
orchestrationState
```

Enforced by `mergeLineagePayload`: `additionalPayload` first, lineage payload second (lineage always wins). Additionally, `validatePayload()` rejects attempts to set reserved keys before they reach the merge.

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
load proposal → validate → find provider → collect specification
→ validate spec → validate payload → build draft
→ assign id → assign timestamps → save [skip for dry-run] → print
```

No side effects in the pure layer.

### R6 — Exactly-one provider

At most one `RemediationProvider` may support any given proposal. If zero match, fail with `"No remediator supports proposal <id>"`. If more than one match, fail with `"Multiple remediators support proposal <id>: ..."`.

## Section 6: Files

| File | Action | Purpose |
|------|--------|---------|
| `src/executive/executive-remediate.ts` | **Create** | Types, interfaces, `RemediatorRegistry`, `ExecutiveBridgeRemediator`, pure functions, constants |
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
- ✅ `--dry-run` never writes to the proposal store (identical pipeline, skip save)
- ✅ Interactive cancellation never creates a child proposal
- ✅ Multiple remediation providers can coexist without modifying `handleRemediateCommand()`
- ✅ Idempotence: same inputs produce identical outputs
- ✅ Payload override protection: reserved lineage keys rejected with clear error
- ✅ Registry dispatch: correct provider selected; 0 or >1 match fails fast
