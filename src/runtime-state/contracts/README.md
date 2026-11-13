# Runtime State Contracts

## Overview
Schema and authority-boundary contracts shared across ALiX runtime domains. The directory contains Effect Schema definitions that mirror provider, tool, planning, adaptation, and proposal payloads, plus R1 ports that describe authority seams without supplying implementations. It imports no Effect runtime services and performs no storage or transport work; implementations and ledger mechanics live outside this package.

## Interface
- Tool boundary schemas: `TOOL_NAME_EXECUTOR_IDS`, `ToolNameSchema`, `FileMatchSchema`, `ToolCallRequestSchema`, `ToolResultSuccessSchema`, `ToolResultErrorSchema`, `ToolResultSchema` [tool-schemas.ts:TOOL_NAME_EXECUTOR_IDS], [tool-schemas.ts:ToolResultSchema]
- Planning schemas: `PlanningObjectiveSchema`, `StrategicPlanMetaSchema`, `StrategicPlanSchema`, plus effort, impact, status, subsystem, and causal-mechanism literals [plan-schemas.ts:PlanningObjectiveSchema], [plan-schemas.ts:StrategicPlanSchema]
- Proposal schemas: `AdaptationProposalSchema`, `ProposalTargetSchema`, target variants, action/status literals, and `SystemStateSchema` [proposal-schemas.ts:AdaptationProposalSchema], [proposal-schemas.ts:ProposalTargetSchema]
- LLM schemas: `ToolCallSchema`, `NormalizedResponseSchema`, `NormalizedMessageSchema`, `NormalizedRequestSchema`, and `StreamChunkSchema` [llm-schemas.ts:ToolCallSchema], [llm-schemas.ts:NormalizedRequestSchema], [llm-schemas.ts:StreamChunkSchema]
- Provider-tool schemas: `ToolParamSchema`, `ToolDefSchema`, `NormalizedToolResultSchema`, `DeferredToolEntrySchema` [provider-tool-schemas.ts:ToolDefSchema], [provider-tool-schemas.ts:DeferredToolEntrySchema]
- Schema helpers: `decode`, `parseOrThrow`, `formatErrors` [helpers.ts:decode], [helpers.ts:parseOrThrow], [helpers.ts:formatErrors]
- Contract diagnostics: `ContractDomain`, `ContractBoundary`, `ContractDiagnostic`, `buildDiagnostic`, `formatDiagnostic` [contract-diagnostics.ts:ContractDiagnostic], [contract-diagnostics.ts:buildDiagnostic], [contract-diagnostics.ts:formatDiagnostic]
- Fact boundary: `RuntimeFactActor`, `RuntimeFact`, `RuntimeFactAppendResult`, `RuntimeFactPort` [runtime-fact-port.ts:RuntimeFact], [runtime-fact-port.ts:RuntimeFactPort]
- Versioned state boundary: `VersionedEntityState`, `RuntimeStateReader` [runtime-state-reader.ts:VersionedEntityState], [runtime-state-reader.ts:RuntimeStateReader]
- Authorization boundary: `AuthorizationSource`, `AuthorizationEnvelope`, `AuthorizedExecutionOutcome`, `AuthorizedExecutionPort` [authorized-execution-port.ts:AuthorizationEnvelope], [authorized-execution-port.ts:AuthorizedExecutionPort]
- Approval boundary: `ApprovalDecisionValue`, `ApprovalDecision`, `ApprovalDecisionPort` [approval-decision-port.ts:ApprovalDecision], [approval-decision-port.ts:ApprovalDecisionPort]
- Ownership boundary: `OwnershipClaim`, `OwnershipAuthority`, and re-exported canonical ownership types [ownership-authority.ts:OwnershipClaim], [ownership-authority.ts:OwnershipAuthority]
- Lifecycle boundary: `AgentLifecycleState`, `AgentLifecycleTransition`, `AgentLifecyclePort` [agent-lifecycle-port.ts:AgentLifecycleState], [agent-lifecycle-port.ts:AgentLifecyclePort]
- Model boundary: `ModelResolver` plus re-exported `ModelConfig` and `ModelTier` [model-resolver.ts:ModelResolver]
- Context boundary: `OutboundProvenance`, `OutboundContext`, `OutboundContextCompiler` [context-compiler.ts:OutboundContext], [context-compiler.ts:OutboundContextCompiler]
- Tool/capability boundary: `ToolCapabilityEntry`, `ToolCapabilityRegistry` [tool-capability-registry.ts:ToolCapabilityEntry], [tool-capability-registry.ts:ToolCapabilityRegistry]
- Metrics boundary: `MetricObservationType`, `MetricObservation`, `MetricsSink` [metrics-sink.ts:MetricObservation], [metrics-sink.ts:MetricsSink]
- Runtime-event envelope: `RuntimeActorType`, `RuntimeEvent` [runtime-event.ts:RuntimeActorType], [runtime-event.ts:RuntimeEvent]
- The barrel re-exports every schema module, every R1 port, and the R2 runtime-event envelope [index.ts:index.ts]

## Invariants
- `ToolNameSchema` is derived from `ALIX_BUILTIN_EXECUTORS`, so the schema admits internal executor ids rather than a hand-maintained model-facing name list [tool-schemas.ts:TOOL_NAME_EXECUTOR_IDS]
- A validated tool result is a discriminated union on `kind: "success" | "error"`; an error carries a required message and optional retryability/hint [tool-schemas.ts:ToolResultSchema]
- `StrategicPlanSchema` fixes `schemaVersion` to the literal `p11.3.0` and requires a status from the declared plan-status literals [plan-schemas.ts:StrategicPlanSchema]
- `ProposalTargetSchema` is a discriminated union whose variants pair each proposal action domain with its required identity fields [proposal-schemas.ts:ProposalTargetSchema]
- `NormalizedMessageSchema` admits a plain string or typed text/image/file content parts; `StreamChunkSchema` is discriminated by chunk `type` [llm-schemas.ts:NormalizedMessageSchema], [llm-schemas.ts:StreamChunkSchema]
- `decode` collects all schema errors and returns a `Result`; `parseOrThrow` throws on invalid input [helpers.ts:decode], [helpers.ts:parseOrThrow]
- Ports are interfaces only and describe authority, not implementation; domain types are imported rather than duplicated [runtime-fact-port.ts:RuntimeFactPort], [approval-decision-port.ts:ApprovalDecisionValue], [ownership-authority.ts:OwnershipClaim], [model-resolver.ts:ModelResolver], [tool-capability-registry.ts:ToolCapabilityEntry]
- `RuntimeFactPort.append` reports failure explicitly and makes no atomicity or transactional claim [runtime-fact-port.ts:RuntimeFactAppendResult]
- `RuntimeStateReader` exposes reads only; no mutation method exists on the port [runtime-state-reader.ts:RuntimeStateReader]
- Execution requires an `AuthorizationEnvelope`; `source: "operator"` must be explicitly issued, and a passed verification must not imply authorization [authorized-execution-port.ts:AuthorizationEnvelope]
- `ApprovalDecisionValue` extracts the decision statuses from the canonical `ApprovalStatus` rather than declaring a parallel approval vocabulary [approval-decision-port.ts:ApprovalDecisionValue]
- `OwnershipAuthority` is the single acquire/validate/renew/release boundary and reuses canonical ownership scope, mode, record, and acquire-result types [ownership-authority.ts:OwnershipAuthority]
- Lifecycle event-type strings stay in `src/runtime-state/events/types.ts`; this port does not duplicate them, so projectors and painters must consume recorded transitions rather than infer them [agent-lifecycle-port.ts:AgentLifecycleTransition]
- `ModelResolver` is the single reader for canonical `models.*` configuration; flat model reads and legacy aliases do not cross this boundary [model-resolver.ts:ModelResolver]
- `OutboundContextCompiler` makes the redaction claim explicit in both the context and per-source provenance [context-compiler.ts:OutboundContext], [context-compiler.ts:OutboundProvenance]
- A `ToolCapabilityEntry` is a `Pick` from the canonical `ToolCapability`, keeping policy and mutation metadata aligned with the tool registry [tool-capability-registry.ts:ToolCapabilityEntry]
- A gauge observation must be labelled `gauge`; otherwise observations default to counter semantics [metrics-sink.ts:MetricObservation]
- `RuntimeEvent.entityVersion` is the version after the event applies; `correlationId` groups a logical operation and `causationId` names the causing event [runtime-event.ts:RuntimeEvent]
- `RuntimeActorType` identifies who acted and is distinct from `AuthorizationSource`, which records why an action was allowed [runtime-event.ts:RuntimeActorType], [authorized-execution-port.ts:AuthorizationSource]
- Unknown runtime `eventType` values must be counted and reported by projectors rather than silently discarded [runtime-event.ts:RuntimeEvent]

## Side Effects
- Importing these modules performs no file, network, process, or store I/O; they declare schemas, types, interfaces, and pure helpers [index.ts:index.ts]
- Schema decode/parse allocates decoded values or schema errors; `parseOrThrow` raises on invalid input and `formatErrors` returns the schema error message [helpers.ts:decode], [helpers.ts:parseOrThrow], [helpers.ts:formatErrors]
- `buildDiagnostic` reads the system clock for `timestamp` and truncates error text; `formatDiagnostic` returns a formatted string without logging it [contract-diagnostics.ts:buildDiagnostic], [contract-diagnostics.ts:formatDiagnostic]

## Verification
- Run: `pnpm test`
