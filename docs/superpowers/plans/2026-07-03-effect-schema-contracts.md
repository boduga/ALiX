# Effect Schema Runtime Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce typed runtime contracts using Effect Schema for ALiX's highest-value boundaries — tool calls, plan steps, proposals, and LLM output — without changing orchestration behavior.

**Architecture:** Each contract boundary gets its own schema file in `src/contracts/`, mirroring the existing TypeScript types with Effect Schema's `Schema` combinators. A shared `helpers.ts` provides typed `decode`/`parse` wrappers. No `Effect.gen`, no runtime layers, no LLM/tool executor rewrites.

**Tech Stack:** Effect Schema (`effect/Schema`), TypeScript 5.9, Node 24, pnpm

## Global Constraints

- `pnpm add effect` — pin exact version
- All schemas go in `src/contracts/` — do not touch `src/tools/`, `src/planning/`, `src/adaptation/`, `src/providers/`
- Do NOT import Effect's runtime (`Effect`, `Effect.gen`, `Layer`, `Scope`) — only `Schema` and `ParseResult`
- Do NOT modify any existing type definitions or runtime code
- Each schema file must have a corresponding test file in `tests/contracts/`
- Helper functions return typed `Either` (via `ParseResult`) — no thrown exceptions
- Run tests via `pnpm exec vitest run ... --config vitest.config.mts` (not `npx vitest` — repo uses pnpm)
- Mirror real type shapes exactly — use the actual discriminated unions and literal values from source types

---
## File Structure

```
src/contracts/
  index.ts          — re-exports all schemas and helpers
  tool-schemas.ts   — ToolCallRequest, ToolResult, ToolName schemas
  plan-schemas.ts   — PlanningObjective, StrategicPlan schemas
  proposal-schemas.ts — AdaptationProposal, ProposalTarget schemas
  llm-schemas.ts    — ToolCall, NormalizedResponse, NormalizedRequest schemas
  helpers.ts        — decode(), parse(), formatErrors() wrappers

tests/contracts/
  tool-schemas.test.ts
  plan-schemas.test.ts
  proposal-schemas.test.ts
  llm-schemas.test.ts
  helpers.test.ts
```

---

### Task 1: Add effect dependency and scaffold contracts directory

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml` (auto-updated via `pnpm add`)
- Create: `src/contracts/index.ts`

**Interfaces:**
- Produces: re-export barrel file at `src/contracts/index.ts` (empty initially, filled by subsequent tasks)

- [ ] **Step 1: Add effect dependency**

```bash
pnpm add effect
```

Expected: `effect` added to `package.json` dependencies, `pnpm-lock.yaml` updated.

- [ ] **Step 2: Create `src/contracts/index.ts`**

```typescript
// src/contracts/index.ts
//
// Effect Schema runtime contracts for ALiX boundaries.
// Schema-only — no Effect runtime, no orchestration changes.
//
// Each domain has its own file; this barrel re-exports everything.

export {};
```

- [ ] **Step 3: Verify install**

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
```

Expected: clean build and typecheck.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml src/contracts/
git commit -m "feat(contracts): add effect dependency and scaffold src/contracts/"
```

---

### Task 2: Tool schemas

**Files:**
- Create: `src/contracts/tool-schemas.ts`
- Create: `tests/contracts/tool-schemas.test.ts`

**Interfaces:**
- Produces: `ToolCallRequestSchema`, `ToolResultSchema`, `ToolNameSchema` — Effect Schema equivalents of existing types
- Consumes: existing `ToolName`, `ToolCallRequest`, `ToolResult` from `src/tools/types.ts` (for type reference only, not schema derivation)

- [ ] **Step 1: Create `src/contracts/tool-schemas.ts`**

```typescript
// src/contracts/tool-schemas.ts
//
// Effect Schema contracts for tool execution boundaries.
// Mirrors src/tools/types.ts ToolName, ToolCallRequest, ToolResult.

import { Schema } from "effect";

// ---------------------------------------------------------------------------
// ToolName — literal union
// ---------------------------------------------------------------------------

export const ToolNameSchema = Schema.Literal(
  "file.read",
  "file.create",
  "file.delete",
  "file.exists",
  "dir.search",
  "shell.run",
  "patch.apply",
  "done",
);
export type ToolNameFromSchema = typeof ToolNameSchema.Type;

// ---------------------------------------------------------------------------
// FileMatch
// ---------------------------------------------------------------------------

export const FileMatchSchema = Schema.Struct({
  path: Schema.String,
  lineNumber: Schema.Number,
  line: Schema.String,
});
export type FileMatchFromSchema = typeof FileMatchSchema.Type;

// ---------------------------------------------------------------------------
// ToolCallRequest
// ---------------------------------------------------------------------------

export const ToolCallRequestSchema = Schema.Struct({
  toolCallId: Schema.String,
  name: Schema.String,
  args: Schema.Record({
    key: Schema.String,
    value: Schema.Unknown,
  }),
  agentId: Schema.optional(Schema.String),
  sessionId: Schema.optional(Schema.String),
});
export type ToolCallRequestFromSchema = typeof ToolCallRequestSchema.Type;

// ---------------------------------------------------------------------------
// ToolResult — discriminated union
// ---------------------------------------------------------------------------

export const ToolResultSuccessSchema = Schema.Struct({
  kind: Schema.Literal("success"),
  content: Schema.optional(Schema.String),
  output: Schema.optional(Schema.String),
  value: Schema.optional(Schema.String),
  matches: Schema.optional(Schema.Array(FileMatchSchema)),
  changedFiles: Schema.optional(Schema.Array(Schema.String)),
  exitCode: Schema.optional(Schema.Number),
  createdPath: Schema.optional(Schema.String),
  deletedPath: Schema.optional(Schema.String),
  exists: Schema.optional(Schema.Boolean),
  completed: Schema.optional(Schema.Boolean),
});

export const ToolResultErrorSchema = Schema.Struct({
  kind: Schema.Literal("error"),
  message: Schema.String,
  retryable: Schema.optional(Schema.Boolean),
  hint: Schema.optional(Schema.String),
});

export const ToolResultSchema = Schema.Union(
  ToolResultSuccessSchema,
  ToolResultErrorSchema,
);
export type ToolResultFromSchema = typeof ToolResultSchema.Type;
```

- [ ] **Step 2: Write tests**

```typescript
// tests/contracts/tool-schemas.test.ts

import { describe, it, assert } from "vitest";
import { Schema } from "effect";
import {
  ToolNameSchema,
  ToolCallRequestSchema,
  ToolResultSchema,
} from "../../src/contracts/tool-schemas.js";

describe("ToolNameSchema", () => {
  it("decodes valid tool names", () => {
    assert.doesNotThrow(() =>
      Schema.decodeSync(ToolNameSchema)("file.read")
    );
    assert.doesNotThrow(() =>
      Schema.decodeSync(ToolNameSchema)("shell.run")
    );
    assert.doesNotThrow(() =>
      Schema.decodeSync(ToolNameSchema)("done")
    );
  });

  it("rejects invalid tool names", () => {
    assert.throws(() =>
      Schema.decodeSync(ToolNameSchema)("invalid.tool")
    );
    assert.throws(() =>
      Schema.decodeSync(ToolNameSchema)(42)
    );
  });
});

describe("ToolCallRequestSchema", () => {
  it("decodes a valid request", () => {
    const req = Schema.decodeSync(ToolCallRequestSchema)({
      toolCallId: "call-1",
      name: "file.read",
      args: { path: "/tmp/test.txt" },
    });
    assert.strictEqual(req.toolCallId, "call-1");
    assert.strictEqual(req.name, "file.read");
  });

  it("accepts optional fields", () => {
    const req = Schema.decodeSync(ToolCallRequestSchema)({
      toolCallId: "call-2",
      name: "shell.run",
      args: { command: "ls" },
      agentId: "agent-1",
      sessionId: "session-1",
    });
    assert.strictEqual(req.agentId, "agent-1");
  });

  it("rejects missing required fields", () => {
    assert.throws(() =>
      Schema.decodeSync(ToolCallRequestSchema)({
        name: "file.read",
      })
    );
  });
});

describe("ToolResultSchema", () => {
  it("decodes a success result", () => {
    const result = Schema.decodeSync(ToolResultSchema)({
      kind: "success",
      content: "done",
    });
    assert.strictEqual(result.kind, "success");
  });

  it("decodes an error result", () => {
    const result = Schema.decodeSync(ToolResultSchema)({
      kind: "error",
      message: "file not found",
      retryable: false,
    });
    assert.strictEqual(result.kind, "error");
    assert.strictEqual(result.message, "file not found");
  });

  it("rejects unknown kind", () => {
    assert.throws(() =>
      Schema.decodeSync(ToolResultSchema)({
        kind: "unknown",
      })
    );
  });
});
```

- [ ] **Step 3: Run tests to verify they pass**

```bash
pnpm exec vitest run tests/contracts/tool-schemas.test.ts --config vitest.config.mts
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/contracts/tool-schemas.ts tests/contracts/tool-schemas.test.ts src/contracts/index.ts
git commit -m "feat(contracts): add tool call schemas with tests"
```

---

### Task 3: Plan schemas

**Files:**
- Create: `src/contracts/plan-schemas.ts`
- Create: `tests/contracts/plan-schemas.test.ts`

**Interfaces:**
- Produces: `PlanningObjectiveSchema`, `StrategicPlanSchema` — Effect Schema equivalents
- Consumes: existing `PlanningObjective`, `StrategicPlan` type shapes

- [ ] **Step 1: Create `src/contracts/plan-schemas.ts`**

```typescript
// src/contracts/plan-schemas.ts
//
// Effect Schema contracts for strategic planning boundaries.
// Mirrors src/planning/planning-types.ts.

import { Schema } from "effect";

// ---------------------------------------------------------------------------
// Enums / literals
// ---------------------------------------------------------------------------

export const EffortEstimateSchema = Schema.Literal("low", "medium", "high");
export const StrategicImpactSchema = Schema.Literal("direct", "indirect", "compound");
export const PlanStatusSchema = Schema.Literal(
  "ok",
  "no_degradation",
  "insufficient_analysis",
  "no_objectives",
);

export const CorrelationSubsystemIdSchema = Schema.Literal(
  "memory", "workflow", "skills", "agents",
  "tools", "security", "governance", "adaptation",
);

export const CausalMechanismSchema = Schema.Literal(
  "temporal_cascade",
  "concurrent_degradation",
  "inverse_correlation",
  "degradation_chain",
);

// ---------------------------------------------------------------------------
// PlanningObjective
// ---------------------------------------------------------------------------

export const PlanningObjectiveSchema = Schema.Struct({
  id: Schema.String,
  targetSubsystem: CorrelationSubsystemIdSchema,
  targetMetric: Schema.NullOr(Schema.String),
  topCauseSubsystem: Schema.NullOr(CorrelationSubsystemIdSchema),
  currentScore: Schema.Number,
  urgencyScore: Schema.Number,
  expectedImpact: StrategicImpactSchema,
  improvesSubsystems: Schema.Array(CorrelationSubsystemIdSchema),
  estimatedEffort: EffortEstimateSchema,
  effortRationale: Schema.String,
  prerequisites: Schema.Array(Schema.String),
  confidence: Schema.NullOr(Schema.Number),
  mechanism: Schema.NullOr(CausalMechanismSchema),
  sourceFindingSubsystem: CorrelationSubsystemIdSchema,
  rationale: Schema.String,
});
export type PlanningObjectiveFromSchema = typeof PlanningObjectiveSchema.Type;

// ---------------------------------------------------------------------------
// StrategicPlanMeta
// ---------------------------------------------------------------------------

export const StrategicPlanMetaSchema = Schema.Struct({
  totalSubsystemsEvaluated: Schema.Number,
  prioritizedObjectives: Schema.Number,
  objectivesLow: Schema.Number,
  objectivesMedium: Schema.Number,
  objectivesHigh: Schema.Number,
});

// ---------------------------------------------------------------------------
// StrategicPlan
// ---------------------------------------------------------------------------

export const StrategicPlanSchema = Schema.Struct({
  schemaVersion: Schema.Literal("p11.3.0"),
  planId: Schema.String,
  generatedAt: Schema.String,
  rootCauseAnalysisId: Schema.String,
  correlationGraphId: Schema.String,
  status: PlanStatusSchema,
  objectives: Schema.Array(PlanningObjectiveSchema),
  meta: StrategicPlanMetaSchema,
});
export type StrategicPlanFromSchema = typeof StrategicPlanSchema.Type;
```

- [ ] **Step 2: Write tests**

```typescript
// tests/contracts/plan-schemas.test.ts

import { describe, it, assert } from "vitest";
import { Schema } from "effect";
import {
  PlanningObjectiveSchema,
  StrategicPlanSchema,
  EffortEstimateSchema,
  PlanStatusSchema,
} from "../../src/contracts/plan-schemas.js";

describe("EffortEstimateSchema", () => {
  it("accepts valid efforts", () => {
    assert.doesNotThrow(() => Schema.decodeSync(EffortEstimateSchema)("low"));
    assert.doesNotThrow(() => Schema.decodeSync(EffortEstimateSchema)("medium"));
    assert.doesNotThrow(() => Schema.decodeSync(EffortEstimateSchema)("high"));
  });
  it("rejects invalid efforts", () => {
    assert.throws(() => Schema.decodeSync(EffortEstimateSchema)("extreme"));
  });
});

describe("PlanningObjectiveSchema", () => {
  it("decodes a valid objective", () => {
    const obj = Schema.decodeSync(PlanningObjectiveSchema)({
      id: "strat-obj-1",
      targetSubsystem: "memory",
      targetMetric: null,
      topCauseSubsystem: "tools",
      currentScore: 65,
      urgencyScore: 72,
      expectedImpact: "compound",
      improvesSubsystems: ["workflow", "agents"],
      estimatedEffort: "medium",
      effortRationale: "Requires cross-subsystem inspection",
      prerequisites: [],
      confidence: 0.8,
      mechanism: "degradation_chain",
      sourceFindingSubsystem: "memory",
      rationale: "Memory subsystem is degraded",
    });
    assert.strictEqual(obj.targetSubsystem, "memory");
  });

  it("rejects missing required fields", () => {
    assert.throws(() =>
      Schema.decodeSync(PlanningObjectiveSchema)({ id: "obj-1" })
    );
  });
});

describe("StrategicPlanSchema", () => {
  it("decodes a valid plan", () => {
    const plan = Schema.decodeSync(StrategicPlanSchema)({
      schemaVersion: "p11.3.0",
      planId: "strat-1",
      generatedAt: "2026-07-03T00:00:00.000Z",
      rootCauseAnalysisId: "rca-1",
      correlationGraphId: "cg-1",
      status: "ok",
      objectives: [],
      meta: {
        totalSubsystemsEvaluated: 8,
        prioritizedObjectives: 0,
        objectivesLow: 0,
        objectivesMedium: 0,
        objectivesHigh: 0,
      },
    });
    assert.strictEqual(plan.planId, "strat-1");
  });
});
```

- [ ] **Step 3: Run tests**

```bash
pnpm exec vitest run tests/contracts/plan-schemas.test.ts --config vitest.config.mts
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/contracts/plan-schemas.ts tests/contracts/plan-schemas.test.ts src/contracts/index.ts
git commit -m "feat(contracts): add plan schemas with tests"
```

---

### Task 4: Proposal schemas

**Files:**
- Create: `src/contracts/proposal-schemas.ts`
- Create: `tests/contracts/proposal-schemas.test.ts`

**Interfaces:**
- Produces: `ProposalTargetSchema`, `AdaptationProposalSchema`, `ProposalStatusSchema`, `ProposalActionSchema` — Effect Schema equivalents of the real types
- Consumes: existing `ProposalTarget`, `AdaptationProposal`, `ProposalStatus`, `ProposalAction` shapes from `src/adaptation/adaptation-types.ts`

- [ ] **Step 1: Create `src/contracts/proposal-schemas.ts`**

```typescript
// src/contracts/proposal-schemas.ts
//
// Effect Schema contracts for adaptation proposal boundaries.
// Mirrors src/adaptation/adaptation-types.ts exactly.

import { Schema } from "effect";

// ---------------------------------------------------------------------------
// LearningArea
// ---------------------------------------------------------------------------

export const LearningAreaSchema = Schema.Literal(
  "recommendation", "risk", "governance", "routing",
);

// ---------------------------------------------------------------------------
// ExecutiveSubsystemName
// ---------------------------------------------------------------------------

export const ExecutiveSubsystemNameSchema = Schema.Literal(
  "governance", "learning", "adaptation", "agents",
  "tools", "workflow", "memory", "security",
);

// ---------------------------------------------------------------------------
// ProposalAction
// ---------------------------------------------------------------------------

export const ProposalActionSchema = Schema.Literal(
  "create_agent_card",
  "update_agent_card",
  "add_capability",
  "adjust_skill_definition",
  "create_improvement_issue",
  "suggest_routing_weight",
  "revert_proposal",
  "learning_adjustment",
  "governance_change",
  "executive_remediation_request",
);

// ---------------------------------------------------------------------------
// ProposalStatus
// ---------------------------------------------------------------------------

export const ProposalStatusSchema = Schema.Literal(
  "pending", "approved", "rejected", "applied", "failed",
);

// ---------------------------------------------------------------------------
// ProposalTarget — discriminated union
// ---------------------------------------------------------------------------

export const AgentCardTargetSchema = Schema.Struct({
  kind: Schema.Literal("agent_card"),
  id: Schema.String,
});

export const SkillTargetSchema = Schema.Struct({
  kind: Schema.Literal("skill"),
  id: Schema.String,
});

export const CapabilityTargetSchema = Schema.Struct({
  kind: Schema.Literal("capability"),
  capability: Schema.String,
  agentId: Schema.optional(Schema.String),
});

export const IssueTargetSchema = Schema.Struct({
  kind: Schema.Literal("issue"),
  title: Schema.String,
});

export const RoutingWeightTargetSchema = Schema.Struct({
  kind: Schema.Literal("routing_weight"),
  capability: Schema.String,
});

export const RevertTargetSchema = Schema.Struct({
  kind: Schema.Literal("revert"),
  sourceProposalId: Schema.String,
});

export const LearningTargetSchema = Schema.Struct({
  kind: Schema.Literal("learning"),
  area: LearningAreaSchema,
});

export const GovernanceTargetSchema = Schema.Struct({
  kind: Schema.Literal("governance"),
  recommendationId: Schema.String,
});

export const ExecutiveRemediationTargetSchema = Schema.Struct({
  kind: Schema.Literal("executive_remediation"),
  planId: Schema.String,
  stepId: Schema.String,
  objectiveId: Schema.String,
  subsystem: ExecutiveSubsystemNameSchema,
});

export const ProposalTargetSchema = Schema.Union(
  AgentCardTargetSchema,
  SkillTargetSchema,
  CapabilityTargetSchema,
  IssueTargetSchema,
  RoutingWeightTargetSchema,
  RevertTargetSchema,
  LearningTargetSchema,
  GovernanceTargetSchema,
  ExecutiveRemediationTargetSchema,
);

// ---------------------------------------------------------------------------
// SystemState
// ---------------------------------------------------------------------------

export const SystemStateSchema = Schema.Struct({
  orphaned: Schema.Literal(true),
  reason: Schema.String,
  cleaned: Schema.optional(Schema.Boolean),
});

// ---------------------------------------------------------------------------
// AdaptationProposal
// ---------------------------------------------------------------------------

export const AdaptationProposalSchema = Schema.Struct({
  id: Schema.String,
  createdAt: Schema.String,
  status: ProposalStatusSchema,
  action: ProposalActionSchema,
  target: ProposalTargetSchema,
  payload: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  sourceRecommendationType: Schema.String,
  sourceConfidence: Schema.Number,
  evidenceFingerprints: Schema.Array(Schema.String),
  reason: Schema.String,
  approvedBy: Schema.optional(Schema.String),
  approvedAt: Schema.optional(Schema.String),
  appliedAt: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
  provenance: Schema.optional(Schema.Literal("auto", "manual")),
  systemState: Schema.optional(SystemStateSchema),
});
export type AdaptationProposalFromSchema = typeof AdaptationProposalSchema.Type;
```

- [ ] **Step 2: Write tests**

```typescript
// tests/contracts/proposal-schemas.test.ts

import { describe, it, assert } from "vitest";
import { Schema } from "effect";
import {
  ProposalStatusSchema,
  ProposalActionSchema,
  ProposalTargetSchema,
  AdaptationProposalSchema,
} from "../../src/contracts/proposal-schemas.js";

describe("ProposalStatusSchema", () => {
  it("accepts valid statuses", () => {
    for (const s of ["pending", "approved", "rejected", "applied", "failed"]) {
      assert.doesNotThrow(() => Schema.decodeSync(ProposalStatusSchema)(s));
    }
  });
  it("rejects invalid statuses", () => {
    assert.throws(() => Schema.decodeSync(ProposalStatusSchema)("implemented"));
    assert.throws(() => Schema.decodeSync(ProposalStatusSchema)("cancelled"));
  });
});

describe("ProposalActionSchema", () => {
  it("accepts governance_change", () => {
    assert.doesNotThrow(() =>
      Schema.decodeSync(ProposalActionSchema)("governance_change")
    );
  });
  it("rejects unknown actions", () => {
    assert.throws(() =>
      Schema.decodeSync(ProposalActionSchema)("unknown_action")
    );
  });
});

describe("ProposalTargetSchema", () => {
  it("decodes an agent_card target", () => {
    const t = Schema.decodeSync(ProposalTargetSchema)({
      kind: "agent_card", id: "card-1",
    });
    assert.strictEqual(t.kind, "agent_card");
  });
  it("decodes an executive_remediation target", () => {
    const t = Schema.decodeSync(ProposalTargetSchema)({
      kind: "executive_remediation",
      planId: "plan-1",
      stepId: "step-1",
      objectiveId: "obj-1",
      subsystem: "memory",
    });
    assert.strictEqual(t.kind, "executive_remediation");
  });
  it("rejects unknown target kind", () => {
    assert.throws(() =>
      Schema.decodeSync(ProposalTargetSchema)({ kind: "unknown", id: "x" })
    );
  });
});

describe("AdaptationProposalSchema", () => {
  it("decodes a minimal valid proposal", () => {
    const p = Schema.decodeSync(AdaptationProposalSchema)({
      id: "prop-1",
      createdAt: "2026-07-03T00:00:00.000Z",
      status: "pending",
      action: "governance_change",
      target: { kind: "governance", recommendationId: "rec-1" },
      payload: { key: "value" },
      sourceRecommendationType: "health_dashboard",
      sourceConfidence: 0.85,
      evidenceFingerprints: ["fp-1", "fp-2"],
      reason: "System health degraded",
    });
    assert.strictEqual(p.id, "prop-1");
    assert.strictEqual(p.status, "pending");
    assert.strictEqual(p.action, "governance_change");
  });

  it("decodes a proposal with optional fields", () => {
    const p = Schema.decodeSync(AdaptationProposalSchema)({
      id: "prop-2",
      createdAt: "2026-07-03T00:00:00.000Z",
      status: "approved",
      action: "create_improvement_issue",
      target: { kind: "issue", title: "Fix memory leak" },
      payload: { labels: ["bug"] },
      sourceRecommendationType: "trend_analysis",
      sourceConfidence: 0.7,
      evidenceFingerprints: [],
      reason: "Memory usage growing",
      approvedBy: "bot",
      approvedAt: "2026-07-03T01:00:00.000Z",
      provenance: "auto",
    });
    assert.strictEqual(p.approvedBy, "bot");
    assert.strictEqual(p.provenance, "auto");
  });

  it("rejects missing required fields", () => {
    assert.throws(() =>
      Schema.decodeSync(AdaptationProposalSchema)({ id: "prop-3" })
    );
  });
});
```

- [ ] **Step 3: Run tests**

```bash
pnpm exec vitest run tests/contracts/proposal-schemas.test.ts --config vitest.config.mts
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/contracts/proposal-schemas.ts tests/contracts/proposal-schemas.test.ts src/contracts/index.ts
git commit -m "feat(contracts): add proposal schemas with tests"
```

---

### Task 5: LLM schemas

**Files:**
- Create: `src/contracts/llm-schemas.ts`
- Create: `tests/contracts/llm-schemas.test.ts`

**Interfaces:**
- Produces: `ToolCallSchema`, `NormalizedResponseSchema`, `NormalizedRequestSchema` — Effect Schema equivalents
- Consumes: existing `ToolCall`, `NormalizedResponse`, `NormalizedRequest` shapes from `src/providers/types.ts`

- [ ] **Step 1: Create `src/contracts/llm-schemas.ts`**

```typescript
// src/contracts/llm-schemas.ts
//
// Effect Schema contracts for LLM provider boundaries.
// Mirrors src/providers/types.ts ToolCall, NormalizedResponse, NormalizedRequest.

import { Schema } from "effect";

// ---------------------------------------------------------------------------
// TokenUsage
// ---------------------------------------------------------------------------

export const TokenUsageSchema = Schema.Struct({
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
});
export type TokenUsageFromSchema = typeof TokenUsageSchema.Type;

// ---------------------------------------------------------------------------
// ToolCall
// ---------------------------------------------------------------------------

export const ToolCallSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  args: Schema.Record({
    key: Schema.String,
    value: Schema.Unknown,
  }),
});
export type ToolCallFromSchema = typeof ToolCallSchema.Type;

// ---------------------------------------------------------------------------
// NormalizedResponse
// ---------------------------------------------------------------------------

export const NormalizedResponseSchema = Schema.Struct({
  text: Schema.String,
  toolCalls: Schema.Array(ToolCallSchema),
  usage: Schema.optional(TokenUsageSchema),
  finishReason: Schema.optional(Schema.String),
});
export type NormalizedResponseFromSchema = typeof NormalizedResponseSchema.Type;

// ---------------------------------------------------------------------------
// NormalizedMessage
// ---------------------------------------------------------------------------

export const TextPartSchema = Schema.Struct({
  type: Schema.Literal("text"),
  text: Schema.String,
});

export const ImagePartSchema = Schema.Struct({
  type: Schema.Literal("image"),
  source: Schema.String,
  mediaType: Schema.optional(Schema.String),
});

export const FilePartSchema = Schema.Struct({
  type: Schema.Literal("file"),
  source: Schema.String,
  mediaType: Schema.String,
  filename: Schema.String,
});

export const ContentPartSchema = Schema.Union(TextPartSchema, ImagePartSchema, FilePartSchema);

export const NormalizedMessageSchema = Schema.Struct({
  role: Schema.Literal("user", "assistant"),
  content: Schema.Union(Schema.String, Schema.Array(ContentPartSchema)),
});

// ---------------------------------------------------------------------------
// NormalizedRequest
// ---------------------------------------------------------------------------

export const NormalizedRequestSchema = Schema.Struct({
  systemPrompt: Schema.String,
  messages: Schema.Array(NormalizedMessageSchema),
  tools: Schema.optional(Schema.Array(Schema.Unknown)),
  toolResults: Schema.optional(Schema.Array(Schema.Unknown)),
  temperature: Schema.optional(Schema.Number),
  maxOutputTokens: Schema.optional(Schema.Number),
  stream: Schema.optional(Schema.Boolean),
  structuredOutputSchema: Schema.optional(Schema.Unknown),
});
export type NormalizedRequestFromSchema = typeof NormalizedRequestSchema.Type;
```

- [ ] **Step 2: Write tests**

```typescript
// tests/contracts/llm-schemas.test.ts

import { describe, it, assert } from "vitest";
import { Schema } from "effect";
import {
  ToolCallSchema,
  TokenUsageSchema,
  NormalizedResponseSchema,
  NormalizedMessageSchema,
} from "../../src/contracts/llm-schemas.js";

describe("ToolCallSchema", () => {
  it("decodes a valid tool call", () => {
    const tc = Schema.decodeSync(ToolCallSchema)({
      id: "call-1",
      name: "file.read",
      args: { path: "/tmp/test.txt" },
    });
    assert.strictEqual(tc.id, "call-1");
    assert.strictEqual(tc.name, "file.read");
  });

  it("rejects missing id", () => {
    assert.throws(() =>
      Schema.decodeSync(ToolCallSchema)({
        name: "file.read",
        args: {},
      })
    );
  });
});

describe("TokenUsageSchema", () => {
  it("decodes token usage", () => {
    const tu = Schema.decodeSync(TokenUsageSchema)({
      inputTokens: 100,
      outputTokens: 50,
    });
    assert.strictEqual(tu.inputTokens, 100);
  });
});

describe("NormalizedResponseSchema", () => {
  it("decodes a response with tool calls", () => {
    const resp = Schema.decodeSync(NormalizedResponseSchema)({
      text: "Here you go",
      toolCalls: [
        { id: "tc-1", name: "file.read", args: { path: "x" } },
      ],
      usage: { inputTokens: 10, outputTokens: 20 },
      finishReason: "tool_use",
    });
    assert.strictEqual(resp.text, "Here you go");
    assert.strictEqual(resp.toolCalls.length, 1);
    assert.strictEqual(resp.finishReason, "tool_use");
  });

  it("decodes a response without optional fields", () => {
    const resp = Schema.decodeSync(NormalizedResponseSchema)({
      text: "Hello",
      toolCalls: [],
    });
    assert.strictEqual(resp.text, "Hello");
    assert.strictEqual(resp.usage, undefined);
  });
});

describe("NormalizedMessageSchema", () => {
  it("decodes a simple text message", () => {
    const msg = Schema.decodeSync(NormalizedMessageSchema)({
      role: "user",
      content: "Hello",
    });
    assert.strictEqual(msg.role, "user");
  });

  it("decodes a message with content parts", () => {
    const msg = Schema.decodeSync(NormalizedMessageSchema)({
      role: "user",
      content: [
        { type: "text", text: "What's in this image?" },
        { type: "image", source: "data:image/png;base64,..." },
      ],
    });
    assert.strictEqual(msg.role, "user");
    assert.strictEqual(Array.isArray(msg.content), true);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
pnpm exec vitest run tests/contracts/llm-schemas.test.ts --config vitest.config.mts
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/contracts/llm-schemas.ts tests/contracts/llm-schemas.test.ts src/contracts/index.ts
git commit -m "feat(contracts): add LLM schemas with tests"
```

---

### Task 6: Decode/parse helpers

**Files:**
- Create: `src/contracts/helpers.ts`
- Create: `tests/contracts/helpers.test.ts`

**Interfaces:**
- Produces: `decode<A>(schema, input)` → `Either<ParseError, A>`, `parseOrThrow<A>(schema, input)` → `A`, `formatErrors(e)` → `string`
- Consumes: schemas from Tasks 2-5

- [ ] **Step 1: Create `src/contracts/helpers.ts`**

```typescript
// src/contracts/helpers.ts
//
// Typed decode/parse wrappers around Effect Schema.
// Returns Either for safe decoding — never throws unless explicitly called.

import { Schema, Either, ParseResult } from "effect";

/**
 * Safely decode an unknown input against a schema.
 * Returns Either<ParseError, A> — no thrown exceptions.
 */
export function decode<A, I, R>(
  schema: Schema.Schema<A, I, R>,
  input: unknown,
): Either.Either<ParseResult.ParseError, A> {
  return Schema.decodeUnknownEither(schema)(input);
}

/**
 * Decode and throw on failure.
 * Use in test helpers and trusted contexts; prefer `decode()` for production.
 */
export function parseOrThrow<A, I, R>(
  schema: Schema.Schema<A, I, R>,
  input: unknown,
): A {
  return Schema.decodeUnknownSync(schema)(input);
}

/**
 * Format a ParseError into a human-readable string.
 */
export function formatErrors(error: ParseResult.ParseError): string {
  return ParseResult.TreeFormatter.formatErrorSync(error);
}
```

- [ ] **Step 2: Write tests**

```typescript
// tests/contracts/helpers.test.ts

import { describe, it, assert } from "vitest";
import { Schema, Either } from "effect";
import { decode, parseOrThrow, formatErrors } from "../../src/contracts/helpers.js";
import { ToolCallRequestSchema } from "../../src/contracts/tool-schemas.js";

const TestSchema = Schema.Struct({
  name: Schema.String,
  age: Schema.Number,
});

describe("decode", () => {
  it("returns Right for valid input", () => {
    const result = decode(TestSchema, { name: "Alice", age: 30 });
    assert.isTrue(Either.isRight(result));
    if (Either.isRight(result)) {
      assert.strictEqual(result.right.name, "Alice");
    }
  });

  it("returns Left for invalid input", () => {
    const result = decode(TestSchema, { name: "Alice" });
    assert.isTrue(Either.isLeft(result));
  });

  it("works with ToolCallRequestSchema", () => {
    const result = decode(ToolCallRequestSchema, {
      toolCallId: "call-1",
      name: "file.read",
      args: { path: "/tmp/x" },
    });
    assert.isTrue(Either.isRight(result));
  });
});

describe("parseOrThrow", () => {
  it("returns decoded value for valid input", () => {
    const v = parseOrThrow(TestSchema, { name: "Bob", age: 25 });
    assert.strictEqual(v.name, "Bob");
  });

  it("throws for invalid input", () => {
    assert.throws(() => parseOrThrow(TestSchema, { name: "Bob" }));
  });
});

describe("formatErrors", () => {
  it("formats a parse error as a readable string", () => {
    const result = decode(TestSchema, { name: 42 });
    assert.isTrue(Either.isLeft(result));
    if (Either.isLeft(result)) {
      const msg = formatErrors(result.left);
      assert.isTrue(msg.length > 0);
      assert.include(msg, "name");
    }
  });
});
```

- [ ] **Step 3: Run tests**

```bash
pnpm exec vitest run tests/contracts/ --config vitest.config.mts
```

Expected: all contract tests pass.

- [ ] **Step 4: Commit + update barrel export**

Update `src/contracts/index.ts`:

```typescript
export * from "./tool-schemas.js";
export * from "./plan-schemas.js";
export * from "./proposal-schemas.js";
export * from "./llm-schemas.js";
export * from "./helpers.js";
```

```bash
git add src/contracts/ tests/contracts/
git commit -m "feat(contracts): add decode/parse helpers and barrel exports"
```

---

### Task 7: Final validation

- [ ] **Step 1: Run full validation**

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm test:vitest
```

Expected: all clean — 2580+ existing tests + ~50 new contract tests.

- [ ] **Step 2: Commit any final fixes**

```bash
git add -A
git commit -m "chore: finalize contract schemas"
```

---

## Verification

```bash
pnpm install --frozen-lockfile  # lockfile integrity
pnpm build                      # compiles cleanly
pnpm typecheck                  # 0 type errors
pnpm test:vitest                # all tests pass (existing + new)
```
