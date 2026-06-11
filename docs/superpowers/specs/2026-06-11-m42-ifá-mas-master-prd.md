# M0.42 — IFÁ-MAS Master PRD

**Project:** ALiX OS
**Milestone:** M0.42
**Document:** IFÁ-MAS Master Product Requirements Document
**Status:** Ratified

> The intent is not to reproduce religious Ifá divination. The intent is to study Ifá as a mature African knowledge architecture and translate its structural ideas into a modern, respectful, TypeScript-based multi-agent coordination layer.

---

## 1. Executive Summary

M0.42 introduces **IFÁ-MAS**: an Ifá-inspired symbolic multi-agent communication architecture for ALiX.

The production runtime uses ALiX-native names:

| Ifá-Inspired Concept | ALiX Runtime Name | Role |
|---|---|---|
| Olodumare | **Genesis** | Source of mission, principles, constraints, and system purpose |
| Orunmila | **Nexus** | Wisdom/orchestration layer that diagnoses, plans, and selects coordination paths |
| Esu/Elegba | **Bridge** | Protocol gateway, integrity validator, translator, and message router |
| Babalawo | **Guild** | Specialist agent collective with domain knowledge and operational capability |
| Client / Awo / Seeker | **Caller** | Request originator: user, API, scheduler, workflow, or another agent |
| Odù | **Signal** | Symbolic message frame and routing/diagnostic code |
| Ẹsẹ Ifá | **Chronicle** | Case memory, precedents, strategies, failures, and lessons |
| Ẹbọ | **Offering** | Corrective action, resource commitment, approval, or remediation |
| Ori | **Essence** | Agent identity, capability profile, constraints, affinity, and operating identity |
| Ọpọ́n Ifá | **Commons** | Shared runtime state space used for coordination and visibility |

The proposed system turns ALiX from a tool-calling orchestrator into a symbolic coordination operating system:

```text
Caller intent
  → Bridge validation
  → Nexus diagnosis
  → Signal generation
  → Chronicle retrieval
  → Guild interpretation
  → Offering prescription
  → PolicyGate enforcement
  → tool / replay / rollback / memory / research execution
  → trace + learning
```

---

## 2. Design Principles

### 2.1 Respectful Translation

IFÁ-MAS must be described as **inspired by Ifá's information architecture**, not as actual Ifá practice.

Runtime names must use ALiX-native names such as Genesis, Nexus, Bridge, Guild, Caller, Signal, Essence, Chronicle, Commons, and Offering.

Sacred names may appear only in research notes, mapping tables, and historical inspiration sections.

### 2.2 TypeScript-First Implementation

ALiX is a TypeScript stack. All implementation examples, interfaces, tests, and module names in this document are TypeScript-oriented.

No Python modules are part of the implementation plan.

### 2.3 PolicyGate Remains Supreme

The symbolic layer must not bypass existing ALiX safety systems.

All action prescriptions must still pass through:

```text
PolicyGate
ApprovalStore
RuntimeGate
ToolExecutor
Trace / replay / rollback safety layers
```

### 2.4 Symbolic Does Not Mean Unbounded

The system should make agent communication richer, not vague.

Every Signal must remain structured, auditable, testable, serializable, traceable, and policy-aware.

---

## 3. Core Philosophy

Traditional Ifá consultation has a layered structure:

```text
Source → Wisdom → Messenger → Interpreter → Seeker
```

ALiX translates this into:

```text
Genesis → Nexus → Bridge → Guild → Caller
```

A message is not merely passed between components. It is transformed into a symbolic diagnostic frame called a **Signal**. The Signal carries state, cause, risk, intent, constraints, taboos, prescription, evidence, and trace links.

---

## 4. ALiX Hierarchy

### 4.1 Genesis

Genesis is the source-of-purpose layer. It is not an executable agent. It does not route, call tools, or perform tasks.

Genesis defines mission, system values, global constraints, risk boundaries, default policy posture, and long-term objective.

Examples:

```text
Prefer local-first execution.
Preserve user data.
Never mutate files without traceability.
Require approval for side-effecting actions.
Maintain replay and rollback evidence.
```

**Responsibilities:** Mission definition, policy defaults, system identity, ethical boundary, long-horizon objective.

**Non-responsibilities:** Must not execute tools, perform routing, call providers, mutate files, or override PolicyGate.

### 4.2 Nexus

Nexus is the wisdom/orchestration layer. It is the central reasoning layer that diagnoses a request, constructs a Signal, retrieves relevant Chronicle cases, and selects the correct Guild.

**Responsibilities:** Intent analysis, state diagnosis, Signal generation, Guild selection, Offering prescription, context retrieval, coordination plan creation.

```typescript
export type NexusInput = {
  callerId: string;
  requestText: string;
  workspacePath: string;
  sessionId: string;
  runtimeState?: RuntimeStateSummary;
  traceRefs?: string[];
};

export type NexusDecision = {
  signal: SignalFrame;
  selectedGuilds: GuildSelection[];
  prescribedOfferings: OfferingPrescription[];
  recommendedRoute: "chat" | "tool" | "agent" | "research" | "replay" | "rollback";
};
```

### 4.3 Bridge

Bridge is the protocol and communication gateway. All inter-agent communication passes through Bridge.

**Responsibilities:** Message validation, Signal envelope validation, schema enforcement, protocol translation, integrity checks, routing, observability.

Bridge validates and routes. Nexus diagnoses and interprets.

### 4.4 Guild

Guild represents specialist agent collectives. A Guild may contain one or more agents with related capabilities.

Examples: Coding Guild, Research Guild, Security Guild, Memory Guild, Policy Guild, Replay Guild, Rollback Guild, DevOps Guild, TUI Guild.

A Guild is selected based on Signal domain, Signal polarity, Essence compatibility, capability match, current workload, and safety constraints.

### 4.5 Caller

Caller is the originator of a request. A Caller can be a human user, API request, scheduler, daemon, external agent, workflow, or test harness.

Caller sends an invocation, receives a prescription/result, and may approve or reject Offerings.

---

## 5. Signal System

Signal is the ALiX-native name for the symbolic coordination frame.

### 5.1 SignalFrame

```typescript
export type SignalPolarity = "ire" | "ibi" | "mixed" | "neutral";

export type SignalDomain =
  | "task" | "tool" | "policy" | "memory" | "research"
  | "replay" | "rollback" | "workspace" | "agent" | "tui"
  | "daemon" | "chronicle";

export type SignalFrame = {
  signalId: string;
  code: string;                          // 8-bit binary code
  researchAlias?: string;               // optional Ifá mapping
  polarity: SignalPolarity;
  domain: SignalDomain;
  callerId: string;
  senderEssenceId?: string;
  recipientEssenceId?: string;
  intent: string;
  cause?: string;
  diagnosis?: string;
  constraints: string[];
  taboos: string[];
  prescription?: OfferingPrescription;
  evidenceRefs: string[];
  traceId?: string;
  replayId?: string;
  rollbackId?: string;
  workspaceId?: string;
  sessionId?: string;
  createdAt: string;
};
```

### 5.2 8-Bit Signal Encoder

```typescript
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

export function encodeSignalBits(bits: SignalBits): string {
  const { intentClear, policyRisk, toolRequired, memoryRequired,
          freshnessRequired, mutationPossible, approvalRequired,
          replayRollbackContext } = bits;
  return [intentClear, policyRisk, toolRequired, memoryRequired,
          freshnessRequired, mutationPossible, approvalRequired,
          replayRollbackContext].map(v => v ? "1" : "0").join("");
}
```

### 5.3 Example Signal

```json
{
  "signalId": "sig_1718000000_abc",
  "code": "11100110",
  "polarity": "mixed",
  "domain": "replay",
  "callerId": "user",
  "intent": "Approved-live replay includes file mutation.",
  "cause": "Selected trace chain contains side-effecting tool step.",
  "constraints": ["PolicyGate required", "Approval required"],
  "taboos": ["no_unapproved_mutation", "no_untracked_rollback"],
  "prescription": {
    "action": "ask_approval",
    "offerings": ["diff_preview", "rollback_plan"],
    "successCriteria": [
      "approval resolved approved",
      "ReplayDiffStore captures before and after snapshots",
      "rollback preview available"
    ]
  },
  "evidenceRefs": ["trace_123", "replay_456"],
  "createdAt": "2026-06-11T00:00:00Z"
}
```

---

## 6. Essence System

Essence describes an agent's identity, capability, constraints, and operational affinity.

### 6.1 EssenceProfile

```typescript
export type EssenceProfile = {
  essenceId: string;
  agentId: string;
  role: "genesis" | "nexus" | "bridge" | "guild" | "caller" | "critic" | "tool";
  capabilities: string[];
  domains: SignalDomain[];
  affinities: string[];
  constraints: string[];
  taboos: string[];
  preferredOfferings: OfferingKind[];
  lineage?: {
    createdFrom?: string;
    version: string;
    rebirthCount: number;
    chronicleRefs: string[];
  };
  createdAt: string;
  updatedAt: string;
};
```

### 6.2 Essence Compatibility

```typescript
export type EssenceCompatibilityResult = {
  compatible: boolean;
  score: number;
  reasons: string[];
  violatedTaboos: string[];
};
```

---

## 7. Chronicle System

Chronicle stores structured cases and lessons — not merely vector memory.

```typescript
export type ChronicleEntry = {
  entryId: string;
  signalCode: string;
  domain: SignalDomain;
  polarity: SignalPolarity;
  problem: string;
  diagnosis: string;
  actionTaken: string;
  outcome: "success" | "failure" | "partial" | "unknown";
  lesson: string;
  taboosObserved: string[];
  offeringsUsed: string[];
  traceRefs: string[];
  replayRefs: string[];
  rollbackRefs: string[];
  createdAt: string;
};
```

---

## 8. Offering System

The action/commitment layer.

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

---

## 9. Commons System

Commons represents shared runtime state: workspace state, runtime snapshot, trace state, policy status, approval status, replay state, rollback state, guild state.

The existing `TuiRuntimeSnapshot` and `TuiStore` provide a strong foundation.

---

## 10. Rebirth System

Agent recovery through identity preservation.

```typescript
export type RebirthRecord = {
  rebirthId: string;
  oldAgentId: string;
  newAgentId: string;
  preservedEssenceId: string;
  reason: "crash" | "policy_failure" | "timeout" | "state_corruption" | "manual";
  retainedChronicleRefs: string[];
  createdAt: string;
};
```

---

## 11. Convergence System

Advanced — not for M0.42. Allows multiple Guilds to share context, memory, and task state temporarily. Documented for future reference.

---

## 12. Signal Matrix

M0.42 documents the future direction:
- 16 Primary Signals
- 256 Composite Signals

The runtime starts with 8-bit encoded Signals without needing every composite predefined.

---

## 13. Events

Future milestones may introduce:
- `signal.created`
- `signal.routed`
- `offering.prescribed`
- `offering.accepted`
- `offering.rejected`
- `essence.compatibility.checked`
- `chronicle.entry.created`

M0.42 only documents the model.

---

## 14. TUI Vision

Future TUI drilldown can show:

```text
Signal: 11100110
Domain: replay
Polarity: mixed
Diagnosis: approved-live replay includes mutation
Offering: approval + diff preview + rollback plan
Taboos: no_unapproved_mutation, no_untracked_rollback
Evidence: trace_123, replay_456
```

---

## 15. Cultural Boundary Note

ALiX must include a clear note in the documentation:

> This system is inspired by the information architecture of Ifá: symbolic encoding, corpus retrieval, interpretation, prescription, and ethical action.
>
> It is not Ifá divination.
> It does not replace initiated practitioners.
> It does not claim spiritual authority.
> The runtime uses ALiX-native technical names.

---

## 16. Success Criteria for M0.42

M0.42 is a documentation milestone. It is complete when:

1. Master PRD exists
2. ALiX implementation plan exists
3. Genesis/Nexus/Bridge/Guild/Caller terminology is canonical
4. Signal, Essence, Chronicle, Offering, Commons terms are defined
5. TypeScript-first implementation path is clear
6. Ethical/cultural boundary is documented
7. No runtime code is required for M0.42

---

## 17. Milestone Progression

```text
M0.42  IFÁ-MAS Master PRD + types + forward plans
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

## 18. Final Definition

```text
Genesis defines purpose.
Nexus diagnoses and plans.
Bridge validates and routes.
Guilds interpret and act.
Callers initiate intent.

Signals carry meaning.
Essence carries identity.
Chronicle carries memory.
Offerings carry commitment.
Commons carries shared state.
```
