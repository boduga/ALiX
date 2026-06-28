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
M0.47  Bridge Protocol Envelope
M0.48  Nexus Diagnostic Router
M0.49  Bridge Protocol Gateway
M0.50  Guild Selection Engine
M0.51  IFÁ-MAS Passive Diagnostic Pipeline
M0.52  IFÁ-MAS TUI Panel
M0.53  IFÁ-MAS Trace Persistence
M0.54  Chronicle Learning Loop
M0.55  Chronicle Recall Panel
```

All 14 milestones (M0.42–M0.55) are complete on `main` as of 2026-06-11.

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

## 9. M0.47 — Bridge Protocol Envelope

### Goal

Wrap SignalFrame + OfferingPlan + optional EssenceCompatibility + Chronicle refs into a transport envelope for the ALiX pipeline.

### New Files

```
src/runtime/bridge-envelope.ts
tests/runtime/bridge-envelope.test.ts
```

### Core Type

```typescript
export type BridgeEnvelope = {
  envelopeId: string;
  signal: SignalFrame;
  offering: OfferingPlan;
  essence?: EssenceCompatibility;
  chronicleRefs: string[];
  routeHint?: {
    targetRole?: "genesis" | "nexus" | "bridge" | "guild" | "caller";
    targetAgentId?: string;
    reason?: string;
  };
  safety: {
    requiresPolicyGate: boolean;
    requiresApproval: boolean;
    mutationPossible: boolean;
    taboos: string[];
  };
  createdAt: string;
};
```

### Builder

```typescript
export function buildBridgeEnvelope(input: {
  signal: SignalFrame;
  offering: OfferingPlan;
  essence?: EssenceCompatibility;
  chronicleRefs?: string[];
  routeHint?: BridgeEnvelope["routeHint"];
}): BridgeEnvelope;
```

Safety fields are derived from decoded signal bits and offering action. Passive — does not execute tools or policy gates.

### Commit

```bash
git add src/runtime/bridge-envelope.ts tests/runtime/bridge-envelope.test.ts
git commit -m "feat(runtime): add BridgeEnvelope protocol wrapper"
```

---

## 10. M0.48 — Nexus Diagnostic Router

### Goal

Consume a BridgeEnvelope and produce a passive routing recommendation — which agent role should handle the envelope next.

### New Files

```
src/runtime/nexus-router.ts
tests/runtime/nexus-router.test.ts
```

### Flow

```
BridgeEnvelope
  → 6 priority-ordered rules
  → routeHint (targetRole, confidence, reason)
  → optional ChronicleStore failure lookup
  → optional Essence score annotation
```

### Interface

```typescript
export type NexusRouteDecision = {
  envelope: BridgeEnvelope;
  routeHint: {
    targetRole: "genesis" | "nexus" | "bridge" | "guild" | "caller";
    confidence: number;
    reason: string;
  };
  chronicleEntries: ChronicleEntry[];
};

export async function routeViaNexus(input: {
  envelope: BridgeEnvelope;
  chronicleStore?: ChronicleStore;
  essence?: EssenceCompatibility;
}): Promise<NexusRouteDecision>;
```

### Commit

```bash
git add src/runtime/nexus-router.ts tests/runtime/nexus-router.test.ts
git commit -m "feat(runtime): add Nexus diagnostic router"
```

---

## 11. M0.49 — Bridge Protocol Gateway

### Goal

Validate BridgeEnvelopes and provide message wrapping/unwrapping utilities. The validation boundary for the runtime pipeline.

### New Files

```
src/runtime/bridge-gateway.ts
tests/runtime/bridge-gateway.test.ts
```

### Interface

```typescript
export type BridgeValidationResult = {
  valid: boolean;
  errors: string[];
};

export class BridgeGateway {
  validateEnvelope(envelope: BridgeEnvelope): BridgeValidationResult;
  wrapMessage(input: { signal: SignalFrame; offering: OfferingPlan; payload: unknown }): BridgeMessage;
  unwrapMessage(message: BridgeMessage): { signal: SignalFrame; offering: OfferingPlan; payload: unknown };
}
```

Validates 6 structural rule groups (envelopeId, signal, offering, safety, chronicleRefs, createdAt) collecting ALL errors.

### Commit

```bash
git add src/runtime/bridge-gateway.ts tests/runtime/bridge-gateway.test.ts
git commit -m "feat(runtime): add Bridge protocol gateway"
```

---

## 12. M0.50 — Guild Selection Engine

### Goal

Select specialist agents based on EssenceProfile compatibility with a BridgeEnvelope.

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
  compatible: boolean;
  reasons: string[];
};

export class GuildSelector {
  select(input: { envelope: BridgeEnvelope; candidates: EssenceProfile[] }): GuildCandidate[];
}
```

Uses `checkEssenceCompatibility()` per candidate. Sorts compatible first, then by score descending.

### Commit

```bash
git add src/agents/guild-selector.ts tests/agents/guild-selector.test.ts
git commit -m "feat(agents): add Guild selection engine"
```

---

## 13. M0.51 — IFÁ-MAS Passive Diagnostic Pipeline

### Goal

Chain all 8 modules (M0.43–M0.50) into a single end-to-end diagnostic pipeline.

### New Files

```
src/runtime/ifamas-pipeline.ts
tests/runtime/ifamas-pipeline.test.ts
```

### Core Type

```typescript
export type IfamasDiagnostic = {
  signal: SignalFrame;
  offering: OfferingPlan;
  envelope: BridgeEnvelope;
  routeDecision: NexusRouteDecision;
  gatewayValidation: BridgeValidationResult;
  guildCandidates: GuildCandidate[];
};
```

### Pipeline Steps

```
SignalFrame → prescribeOffering → buildBridgeEnvelope
  → BridgeGateway.validateEnvelope → routeViaNexus → GuildSelector.select
```

Optional: `eventLog` for trace event emission, `chronicleStore` for past-case lookup.

### Commit

```bash
git add src/runtime/ifamas-pipeline.ts tests/runtime/ifamas-pipeline.test.ts
git commit -m "feat(runtime): add IFÁ-MAS passive diagnostic pipeline"
```

---

## 14. M0.52 — IFÁ-MAS TUI Panel

### Goal

Surface IFÁ-MAS diagnostic artifacts in the TUI. Operator types `/ifamas` to see Signal code, polarity, Offering action, Route target, Gateway status, and Guild candidates.

### New Files

```
src/tui/ifamas-panel.ts
tests/tui/ifamas-panel.test.ts
```

### Modified Files

```
src/tui/store.ts           — +"ifamas" panel type
src/tui/panel-renderer.ts  — +ifamas render branch
src/tui/runtime-snapshot.ts — +carry ifamasPanelData
src/cli/commands/tui.ts    — +/ifamas command
```

Read-only display. No execution changes.

### Commit

```bash
git add src/tui/ifamas-panel.ts src/tui/store.ts src/tui/panel-renderer.ts src/tui/runtime-snapshot.ts src/cli/commands/tui.ts tests/tui/ifamas-panel.test.ts
git commit -m "feat(tui): add IFÁ-MAS diagnostic panel and /ifamas command"
```

---

## 15. M0.53 — IFÁ-MAS Trace Persistence

### Goal

Record IFÁ-MAS diagnostic artifacts into the event log as structured trace events so they persist beyond the live TUI session.

### Modified Files

```
src/runtime/trace-events.ts     — +"ifamas" source type, ifamasPayload, normalizer
src/runtime/ifamas-pipeline.ts  — +optional eventLog emission
src/cli/commands/tui.ts         — +wire tuiLog into /ifamas
tests/runtime/trace-events-ifamas.test.ts — new
```

Non-fatal — diagnostics succeed even if event emission fails.

### Commit

```bash
git add src/runtime/trace-events.ts src/runtime/ifamas-pipeline.ts src/cli/commands/tui.ts tests/runtime/trace-events-ifamas.test.ts tests/runtime/ifamas-pipeline.test.ts
git commit -m "feat(runtime): persist IFÁ-MAS diagnostic as trace events"
```

---

## 16. M0.54 — Chronicle Learning Loop

### Goal

After each IFÁ-MAS diagnostic run, automatically append a Chronicle entry recording what was diagnosed, what offering was prescribed, and what route was recommended.

### Modified Files

```
src/runtime/ifamas-pipeline.ts — +chronicleStore.append after diagnostic
tests/runtime/ifamas-pipeline.test.ts — +2 tests
```

Non-fatal — diagnostics succeed even if Chronicle writing fails.

### Commit

```bash
git add src/runtime/ifamas-pipeline.ts tests/runtime/ifamas-pipeline.test.ts
git commit -m "feat(chronicle): add learning loop to IFÁ-MAS diagnostic pipeline"
```

---

## 17. M0.55 — Chronicle Recall Panel

### Goal

Let operators search historical IFÁ-MAS Chronicle entries and diagnostic artifacts by signal code, trace ID, offering action, or route target.

### New Files

```
src/tui/chronicle-panel.ts
tests/tui/chronicle-panel.test.ts
```

### Modified Files

```
src/tui/store.ts              — +"chronicle" panel type
src/tui/panel-renderer.ts     — +chronicle render branch
src/tui/runtime-snapshot.ts   — +carry chroniclePanelData
src/cli/commands/tui.ts       — +/chronicle command
```

Commands: `/chronicle`, `/chronicle signal:<code>`, `/chronicle trace:<id>`, `/chronicle offering:<action>`, `/chronicle route:<target>`.

### Commit

```bash
git add src/tui/chronicle-panel.ts src/tui/store.ts src/tui/panel-renderer.ts src/tui/runtime-snapshot.ts src/cli/commands/tui.ts tests/tui/chronicle-panel.test.ts
git commit -m "feat(tui): add IFÁ-MAS Chronicle recall panel and /chronicle command"
```

---

## 18. Implementation Order

Recommended exact order (completed):

1. M0.42 docs
2. M0.43 SignalFrame
3. M0.44 OfferingPlanner
4. M0.45 EssenceProfile
5. M0.46 ChronicleStore
6. M0.47 BridgeEnvelope
7. M0.48 NexusRouter
8. M0.49 BridgeGateway
9. M0.50 GuildSelector
10. M0.51 IfamasPipeline
11. M0.52 TUI Panel
12. M0.53 Trace Persistence
13. M0.54 Chronicle Learning
14. M0.55 Chronicle Recall

---

## 19. Testing Requirements

Each milestone includes unit tests. Integration tests start from M0.47 onward.

Testing philosophy:

- Symbolic encoding must be deterministic.
- Offering prescription must be explainable.
- Essence compatibility must show reasons.
- Chronicle retrieval must be auditable.
- Bridge validation must reject malformed frames.

---

## 20. Risks

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

## 21. Definition of Done

The full IFÁ-MAS symbolic coordination foundation is complete when:

1. Runtime can create SignalFrames
2. Runtime can prescribe Offerings
3. Agents can expose Essence profiles
4. Chronicle can store structured lessons
5. TUI can show Signal/Offering metadata
6. Nexus can route with Signal context
7. Bridge can validate and wrap messages
8. GuildSelector can select agents from Essence compatibility
9. Passive pipeline chains all modules end-to-end (M0.51)
10. TUI can display diagnostics live (M0.52)
11. Diagnostics persist as trace events (M0.53)
12. Chronicle automatically records diagnostic outcomes (M0.54)
13. Operator can recall past diagnostics by filter (M0.55)

---

## 22. Passive Boundary Guarantees

The entire IFÁ-MAS overlay (M0.43–M0.55) respects these hard boundaries:

| Component | Changes |
|-----------|---------|
| **ToolExecutor** | **Zero** — no imports, no references, no behavioral changes |
| **PolicyGate** | **Zero** — no imports, no references, no behavioral changes |
| **ApprovalStore** | **Zero** — no imports, no references, no behavioral changes |
| **Runtime routing** | **Zero** — no routing mutation, no task dispatch changes |
| **Replay execution** | **Zero** — no replay/rollback execution changes |
| **File/network I/O** | Read-only via ChronicleStore and EventLog |

The overlay produces diagnostics, recommendations, and structured memory. It does not execute anything.

---

## 23. Final Engineering Summary

The implementation does not replace ALiX's current runtime.
It layers symbolic coordination over it.

```
Current ALiX:
  task → route → execute → trace

IFÁ-MAS ALiX (passive):
  Signal → Offering → Envelope → Route → Validate → Select
       ↓
  Display (TUI) → Persist (trace) → Learn (Chronicle) → Recall (/chronicle)
```

This keeps the system practical, TypeScript-native, testable, and compatible with the existing replay/rollback safety architecture. All 14 milestones (M0.42–M0.55) are complete on `main` as of 2026-06-11.
