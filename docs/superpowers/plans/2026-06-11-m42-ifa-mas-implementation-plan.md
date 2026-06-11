# M0.42a ALiX Implementation Plan — IFÁ-MAS Symbolic Coordination Layer

**Project:** ALiX Nexus OS
**Document:** Implementation Plan
**Related PRD:** M0.42 IFÁ-MAS Master PRD
**Status:** ✅ Completed (M0.42)
**Stack:** TypeScript-first. No Python runtime modules.

---

## 1. Purpose

This implementation plan translates the IFÁ-MAS Master PRD into incremental ALiX engineering milestones.

The goal is to introduce symbolic agent communication without disrupting the existing stable runtime stack:

```
PolicyGate
Approval UX
Trace Viewer
Replay Preview
Replay Execution
Approved-Live Replay
Replay Diff
Rollback Execution
Replay/Rollback Reliability
Operations Dashboard
Batch Replay/Rollback Selection
```

M0.42 itself is documentation-only. Implementation begins in M0.43.

---

## 2. Naming Standard

Runtime code must use ALiX-native names:

| Runtime Name | Purpose |
|---|---|
| Genesis | mission and constraints layer |
| Nexus | diagnosis and orchestration layer |
| Bridge | protocol gateway and validator |
| Guild | specialist agent collective |
| Caller | request originator |
| Signal | symbolic message frame |
| Essence | agent identity/capability profile |
| Chronicle | structured case memory |
| Offering | prescribed corrective action/resource commitment |
| Commons | shared runtime state |

The research terms may appear in comments or docs only when needed for mapping.

---

## 3. Milestone Breakdown

```
M0.42  Documentation: IFÁ-MAS Master PRD + ALiX plan
M0.43  Signal Frame Encoder Prototype
M0.44  Offering Planner
M0.45  Essence Profiles
M0.46  Chronicle Store
M0.47  Commons Integration
M0.48  Nexus Diagnostic Router
M0.49  Bridge Protocol Gateway
M0.50  Guild Selection Engine
```

---

## 4. M0.42 — Documentation Milestone

### Deliverables

```
docs/superpowers/specs/2026-06-11-m42-ifa-mas-master-prd.md
docs/superpowers/plans/2026-06-11-m42-ifa-mas-implementation-plan.md
```

### Acceptance Criteria

1. Master PRD defines Genesis/Nexus/Bridge/Guild/Caller
2. Plan defines TypeScript implementation path
3. Ethical/cultural boundary note included
4. No Python implementation snippets
5. No runtime code required

---

## 5. M0.43 — Signal Frame Encoder Prototype

### Goal

Add a TypeScript module that converts runtime/task/policy/replay state into an 8-bit Signal.

### New Files

```
src/runtime/signal-frame.ts
tests/runtime/signal-frame.test.ts
```

### Types

```typescript
export type SignalPolarity = "ire" | "ibi" | "mixed" | "neutral";

export type SignalDomain =
  | "task" | "tool" | "policy" | "memory" | "research"
  | "replay" | "rollback" | "workspace" | "agent" | "tui"
  | "daemon" | "chronicle";

export type SignalBits = {
  intentClear: boolean;
  policyRisk: boolean;
  toolRequired: boolean;
  memoryRequired: boolean;
  freshnessRequired: boolean;
  mutationPossible: boolean;
  approvalRequired: boolean;
  replayRollbackContext: boolean;
};

export type SignalFrame = {
  signalId: string;
  code: string;
  polarity: SignalPolarity;
  domain: SignalDomain;
  intent: string;
  cause?: string;
  constraints: string[];
  taboos: string[];
  evidenceRefs: string[];
  traceId?: string;
  replayId?: string;
  rollbackId?: string;
  createdAt: string;
};
```

### Functions

```typescript
export function encodeSignalBits(bits: SignalBits): string;
export function decodeSignalCode(code: string): SignalBits;
export function inferSignalPolarity(bits: SignalBits): SignalPolarity;
export function createSignalFrame(input: {
  bits: SignalBits;
  domain: SignalDomain;
  intent: string;
  cause?: string;
  evidenceRefs?: string[];
  traceId?: string;
  replayId?: string;
  rollbackId?: string;
}): SignalFrame;
```

### Test Cases

```
encode all false => "00000000"
encode all true  => "11111111"
decode "11111111" => all bits true
decode "00000000" => all bits false
policyRisk + mutationPossible + approvalRequired => infer "ibi"
all safe bits => infer "ire"
replayRollbackContext true sets domain correctly
decode rejects non-binary characters (edge: returns zeros for bad chars)
```

### Commit

```bash
git add src/runtime/signal-frame.ts tests/runtime/signal-frame.test.ts
git commit -m "feat(runtime): add SignalFrame encoder prototype"
```

---

## 6. M0.44 — Offering Planner

### Goal

Convert SignalFrames into concrete ALiX actions.

### New Files

```
src/runtime/offering-planner.ts
tests/runtime/offering-planner.test.ts
```

### Types

```typescript
export type OfferingKind =
  | "approval" | "compute_budget" | "token_budget" | "memory_context"
  | "diff_preview" | "rollback_plan" | "test_run" | "human_confirmation"
  | "fresh_research" | "workspace_lock";

export type OfferingAction =
  | "ask_approval" | "reroute" | "rollback" | "rollback_dry_run"
  | "replay_preview" | "replay_dry_run" | "fetch_memory" | "run_test"
  | "reduce_scope" | "pause" | "escalate" | "proceed";

export type OfferingPrescription = {
  action: OfferingAction;
  offerings: OfferingKind[];
  successCriteria: string[];
  failureMode?: string;
};
```

### Planner Rules

| Signal Condition | Prescription |
|---|---|
| policyRisk + approvalRequired | ask_approval |
| mutationPossible + replayRollbackContext | diff_preview + rollback_plan |
| memoryRequired | fetch_memory |
| freshnessRequired | fresh_research |
| toolRequired + policyRisk | reduce_scope or ask_approval |
| rollback domain | rollback_dry_run |
| replay domain | replay_preview or replay_dry_run |

### Function

```typescript
export function prescribeOffering(signal: SignalFrame): OfferingPrescription;
```

### Commit

```bash
git add src/runtime/offering-planner.ts tests/runtime/offering-planner.test.ts
git commit -m "feat(runtime): add Offering planner for SignalFrames"
```

---

## 7. M0.45 — Essence Profiles

### Goal

Add TypeScript agent identity profiles for agent routing and compatibility checks.

### New Files

```
src/agents/essence-profile.ts
tests/agents/essence-profile.test.ts
```

### Types

```typescript
export type EssenceRole =
  | "genesis" | "nexus" | "bridge" | "guild" | "caller"
  | "critic" | "tool";

export type EssenceProfile = {
  essenceId: string;
  agentId: string;
  role: EssenceRole;
  capabilities: string[];
  domains: SignalDomain[];
  affinities: string[];
  constraints: string[];
  taboos: string[];
  lineage?: {
    createdFrom?: string;
    version: string;
    rebirthCount: number;
    chronicleRefs: string[];
  };
  createdAt: string;
  updatedAt: string;
};

export type EssenceCompatibilityResult = {
  compatible: boolean;
  score: number;
  reasons: string[];
  violatedTaboos: string[];
};
```

### Functions

```typescript
export function createEssenceProfile(input: {
  agentId: string;
  role: EssenceRole;
  capabilities?: string[];
  domains?: SignalDomain[];
  affinities?: string[];
  constraints?: string[];
  taboos?: string[];
}): EssenceProfile;

export function checkEssenceCompatibility(
  profile: EssenceProfile,
  signal: SignalFrame,
): EssenceCompatibilityResult;
```

### Commit

```bash
git add src/agents/essence-profile.ts tests/agents/essence-profile.test.ts
git commit -m "feat(agents): add Essence profiles and compatibility checks"
```

---

## 8. M0.46 — Chronicle Store

### Goal

Add structured case memory for SignalFrame outcomes.

### New Files

```
src/chronicle/chronicle-store.ts
src/chronicle/types.ts
tests/chronicle/chronicle-store.test.ts
```

### Types

```typescript
export type ChronicleOutcome = "success" | "failure" | "partial" | "unknown";

export type ChronicleEntry = {
  entryId: string;
  signalCode: string;
  domain: SignalDomain;
  polarity: SignalPolarity;
  problem: string;
  diagnosis: string;
  actionTaken: string;
  outcome: ChronicleOutcome;
  lesson: string;
  taboosObserved: string[];
  offeringsUsed: string[];
  traceRefs: string[];
  replayRefs: string[];
  rollbackRefs: string[];
  createdAt: string;
};
```

### Storage

```
.alix/chronicle/index.json
.alix/chronicle/entries/<entryId>.json
```

### Class

```typescript
export class ChronicleStore {
  constructor(rootDir: string);

  append(entry: Omit<ChronicleEntry, "entryId" | "createdAt">): Promise<ChronicleEntry>;

  get(entryId: string): Promise<ChronicleEntry | undefined>;

  search(query: {
    signalCode?: string;
    domain?: SignalDomain;
    polarity?: SignalPolarity;
    outcome?: ChronicleOutcome;
    limit?: number;
  }): Promise<ChronicleEntry[]>;
}
```

### Commit

```bash
git add src/chronicle tests/chronicle
git commit -m "feat(chronicle): add structured case memory store"
```

---

## 9. M0.47 — Commons Integration

### Goal

Expose Signal, Essence, Offering, and Chronicle state through existing runtime snapshot and TUI infrastructure.

### Modified Files

```
src/tui/store.ts
src/tui/runtime-snapshot.ts
src/tui/trace-detail.ts
src/tui/panel-renderer.ts
src/events/types.ts
src/runtime/trace-events.ts
```

### New Event Types

```
signal.created
signal.routed
offering.prescribed
essence.compatibility.checked
chronicle.entry.created
```

### TUI Display

Trace drilldown should show:

```
Signal
  Code: 11100110
  Domain: replay
  Polarity: mixed
  Intent: Approved-live replay contains mutation
  Offering: ask_approval
  Evidence: trace_123, replay_456
```

### Commit

```bash
git add src/tui src/events src/runtime
git commit -m "feat(tui): surface Signal and Offering metadata in runtime views"
```

---

## 10. M0.48 — Nexus Diagnostic Router

### Goal

Introduce a diagnostic routing layer that can create SignalFrames before route execution.

### New Files

```
src/runtime/nexus-router.ts
tests/runtime/nexus-router.test.ts
```

### Flow

```
input request
  → existing TaskRouter classification
  → SignalFrame creation
  → Offering prescription
  → optional Chronicle lookup
  → route execution
```

### Interface

```typescript
export type NexusRouteDecision = {
  route: TaskRoute;
  signal: SignalFrame;
  offering?: OfferingPrescription;
  chronicleRefs: string[];
};

export class NexusRouter {
  route(input: {
    task: string;
    cwd: string;
    sessionId: string;
    traceRefs?: string[];
  }): Promise<NexusRouteDecision>;
}
```

### Commit

```bash
git add src/runtime/nexus-router.ts tests/runtime/nexus-router.test.ts
git commit -m "feat(runtime): add Nexus diagnostic router"
```

---

## 11. M0.49 — Bridge Protocol Gateway

### Goal

Add a gateway layer for SignalFrame validation and inter-agent protocol translation.

### New Files

```
src/runtime/bridge-gateway.ts
tests/runtime/bridge-gateway.test.ts
```

### Responsibilities

- validate SignalFrame schema
- enforce required fields
- attach integrity metadata
- translate between internal and external message shapes
- reject malformed inter-agent messages

### Interface

```typescript
export type BridgeValidationResult = {
  valid: boolean;
  errors: string[];
};

export class BridgeGateway {
  validateSignal(signal: SignalFrame): BridgeValidationResult;
  wrapMessage(input: { signal: SignalFrame; payload: unknown }): BridgeEnvelope;
  unwrapMessage(envelope: BridgeEnvelope): { signal: SignalFrame; payload: unknown };
}
```

### Commit

```bash
git add src/runtime/bridge-gateway.ts tests/runtime/bridge-gateway.test.ts
git commit -m "feat(runtime): add Bridge protocol gateway"
```

---

## 12. M0.50 — Guild Selection Engine

### Goal

Select specialist agents based on SignalFrame + EssenceProfile compatibility.

### New Files

```
src/agents/guild-selector.ts
tests/agents/guild-selector.test.ts
```

### Interface

```typescript
export type GuildCandidate = {
  profile: EssenceProfile;
  score: number;
  reasons: string[];
};

export class GuildSelector {
  select(signal: SignalFrame, candidates: EssenceProfile[]): GuildCandidate[];
}
```

### Commit

```bash
git add src/agents/guild-selector.ts tests/agents/guild-selector.test.ts
git commit -m "feat(agents): add Guild selection engine"
```

---

## 13. Implementation Order

Recommended exact order:

1. M0.42 docs
2. M0.43 SignalFrame
3. M0.44 OfferingPlanner
4. M0.45 EssenceProfile
5. M0.46 ChronicleStore
6. M0.47 TUI/Trace integration
7. M0.48 NexusRouter
8. M0.49 BridgeGateway
9. M0.50 GuildSelector

---

## 14. Testing Requirements

Each milestone should include unit tests. Integration tests should wait until M0.47 or later.

Testing philosophy:

- Symbolic encoding must be deterministic.
- Offering prescription must be explainable.
- Essence compatibility must show reasons.
- Chronicle retrieval must be auditable.
- Bridge validation must reject malformed frames.

---

## 15. Risks

### 15.1 Over-symbolization

Risk: The Signal system becomes poetic but not useful.

Mitigation: Keep all Signal fields structured and testable.

### 15.2 Cultural Misuse

Risk: Users think ALiX performs Ifá.

Mitigation: Use ALiX-native runtime names and include boundary note.

### 15.3 Safety Bypass

Risk: Offerings are treated as permission.

Mitigation: PolicyGate remains mandatory for execution.

### 15.4 Complexity

Risk: Too many abstractions too fast.

Mitigation: Implement in small milestones: Signal → Offering → Essence → Chronicle → Commons.

---

## 16. Definition of Done

The full IFÁ-MAS symbolic coordination foundation is complete when:

1. Runtime can create SignalFrames
2. Runtime can prescribe Offerings
3. Agents can expose Essence profiles
4. Chronicle can store structured lessons
5. TUI can show Signal/Offering metadata
6. Nexus can route with Signal context
7. Bridge can validate and wrap messages
8. GuildSelector can select agents from Essence compatibility

---

## 17. Final Engineering Summary

The implementation does not replace ALiX's current runtime.
It layers symbolic coordination over it.

```
Current ALiX:
  task → route → execute → trace

IFÁ-MAS ALiX:
  task → Signal → Offering → route → execute → trace → Chronicle
```

This keeps the system practical, TypeScript-native, testable, and compatible with the existing replay/rollback safety architecture.
