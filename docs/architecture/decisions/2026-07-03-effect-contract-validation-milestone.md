# Effect Schema Contract Validation — Milestone Checkpoint

**Date:** 2026-07-03
**PRs:** #160–#170
**Status:** Complete — sealed, no further code changes planned in this phase.

## Summary

Delivered typed runtime contract validation for ALiX's three core boundaries — providers, planning, and adaptation — using Effect Schema. All validation is additive: existing runtime behavior is unchanged, errors still propagate normally, and no orchestration was rewritten.

## Delivered PRs

| PR | Title | Scope |
|----|-------|-------|
| #160 | chore: migrate from npm to pnpm | Lockfile, CI, workspace config, phantom deps fixed |
| #161 | chore(tool-repair): declare tsx and remove npx usage | Package-manager hygiene for workspace package |
| #162 | feat(contracts): introduce Effect Schema runtime contracts | Base schemas: ToolCallRequest, ToolResult, StrategicPlan, AdaptationProposal, NormalizedRequest/Response, decode()/parseOrThrow() helpers |
| #163 | feat(contracts): add provider tool definition schemas | ToolDefSchema, ToolParamSchema, NormalizedToolResultSchema, DeferredToolEntrySchema |
| #164 | feat(providers): validate model adapter contracts | withProviderContracts wrapper — validates request before complete(), response after |
| #165 | feat(contracts): add stream chunk schemas | StreamChunkSchema: text_delta, tool_call, usage, done, error |
| #166 | feat(providers): validate model adapter streaming contracts | Stream request and per-chunk validation in withProviderContracts |
| #167 | feat(providers): opt in contract validation for provider registry | withProviderContracts applied in createProvider() — all providers get automatic validation |
| #168 | feat(planning): validate strategic plan contracts | Effect Schema layer inside StrategicPlanStore.validatePlan(), fires on save/load |
| #169 | feat(adaptation): validate adaptation proposal contracts | Effect Schema layer inside ProposalStore.validateShape(), fires on save/load/list/update |
| #170 | feat(contracts): add contract validation observability | ContractDiagnostic type + optional onDiagnostic callbacks in all three domains |

## Protected Boundaries

| Boundary | Schema | Where validated | Enforcement |
|----------|--------|----------------|-------------|
| Provider `complete()` request | `NormalizedRequestSchema` | `withProviderContracts` | Before `adapter.complete()` |
| Provider `complete()` response | `NormalizedResponseSchema` | `withProviderContracts` | After `adapter.complete()` |
| Provider `stream()` request | `NormalizedRequestSchema` | `withProviderContracts` | Before `adapter.stream()` |
| Provider `stream()` chunk | `StreamChunkSchema` | `withProviderContracts` | Each yielded chunk |
| Provider `tools` array | `ToolDefSchema \| DeferredToolEntrySchema` | Inside `NormalizedRequestSchema` | On request validation |
| Provider `toolResults` array | `NormalizedToolResultSchema` | Inside `NormalizedRequestSchema` | On request validation |
| Strategic plans | `StrategicPlanSchema` | `StrategicPlanStore` | On `save()`, `loadLatest()`, `loadById()`, `list()` |
| Adaptation proposals | `AdaptationProposalSchema` | `ProposalStore` | On `save()`, `load()`, `list()`, `update()` |

All providers created through `createProvider()` (the central registry) are automatically wrapped with `withProviderContracts`. Individual provider adapters were not modified.

## Schema Files

```
src/contracts/
  index.ts                       — barrel re-export
  helpers.ts                    — decode(), parseOrThrow(), formatErrors()
  tool-schemas.ts               — ToolName, ToolCallRequest, ToolResult, FileMatch
  plan-schemas.ts               — StrategicPlan, PlanningObjective, CorrelationSubsystemId, CausalMechanism
  proposal-schemas.ts           — AdaptationProposal, ProposalTarget (9-variant union), ProposalAction, ProposalStatus
  llm-schemas.ts                — TokenUsage, ToolCall, NormalizedRequest, NormalizedResponse, NormalizedMessage, StreamChunk
  provider-tool-schemas.ts      — ToolDef, ToolParam, NormalizedToolResult, DeferredToolEntry
  contract-diagnostics.ts       — ContractDiagnostic type, buildDiagnostic(), formatDiagnostic()
```

## Diagnostic Shape

Contract validation failures produce structured diagnostics via the optional `onDiagnostic` callback:

```
domain:     "provider" | "planning" | "adaptation"
boundary:   "complete.request" | "complete.response" | "stream.request"
            | "stream.chunk" | "negotiate.request" | "plan.save"
            | "plan.load" | "proposal.save" | "proposal.load"
            | "proposal.list"
schema:     e.g. "NormalizedRequestSchema"
error:      formatted parse error (truncated to 200 chars)
entityId:   optional — planId, proposalId, or toolCallId when available
timestamp:  ISO 8601
```

## Non-Goals (explicitly excluded from this phase)

- **No Effect runtime workflows** — `Effect`, `Effect.gen`, `Layer`, `Scope` are not imported or used
- **No retries** — no timeout, retry, or fallback logic added
- **No cancellation** — stream/tool cancellation not implemented
- **No orchestration rewrite** — agent loop, planner, applier, and executive are unchanged
- **No MCP execution changes** — MCP tool call/result validation is not wired
- **No provider adapter modifications** — individual adapters (OpenAI, Anthropic, etc.) are unchanged
- **No streaming schema tests for `stream()` wrapper** — schema-only, adapter.stream() not wrapped with validation yet

## Next Recommended Phase

1. **Typed timeout wrapper for external side effects** — the safest first runtime-hardening PR. A small Effect wrapper around shell/filesystem/network boundaries with configurable timeout and typed error, no runtime layer yet.
2. Then: contract-driven retry policies for transient failures.
3. Then: evaluate `Effect.gen` for the tool-executor dispatch loop (narrow scope, measurable benefit).

## Verification

```bash
pnpm build
pnpm typecheck
pnpm test:vitest
```

All clean: 2664 tests, 256 files, 0 type errors.
