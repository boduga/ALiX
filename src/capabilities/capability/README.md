# Capability Platform

## Overview
Runtime projection of the canonical capability catalog: one definition store,
one registry, a provider-executor registry, a lifecycle-aware resolver, and an
invocation runtime, composed by a single `CapabilityPlatform` instance.
`CapabilityService` is the mandated surface for CLI and tool callers; the
registry and runtime are internal wiring. Lifecycle eligibility (is this
capability selectable?) and availability (does a provider exist?) are separate
axes and must never be conflated.

## Interface
- Legacy data model: `Capability`, `CapabilityStatus`, `CapabilityContext`, `Invocation`, `InvocationResult`, `InvocationStatus`, `CapabilityEvent`, `Permission`, plus the bounded `AsyncEventQueue` [types.ts:Capability], [types.ts:CapabilityEvent], [types.ts:CapabilityContext], [types.ts:AsyncEventQueue].
- Typed errors with stable semantics: `CapabilityNotFoundError`, `CapabilityValidationError`, `ProviderUnavailableError`, `PermissionDeniedError`, `InvocationCancelledError` [errors.ts:CapabilityNotFoundError], [errors.ts:ProviderUnavailableError], [errors.ts:InvocationCancelledError].
- `EventBus` with isolated subscribers, and `toAlixEvent` mapping a `CapabilityEvent` onto the EventLog row shape [event-bus.ts:EventBus], [event-bus.ts:toAlixEvent].
- `NativeExecutor` maps capability id to handler; an unregistered id yields `{ error }` rather than throwing [executors.ts:NativeExecutor].
- `HookRegistry` / `CapabilityHooks` hold validate/canInvoke/before/after hooks outside capability metadata [hook-registry.ts:HookRegistry], [hook-registry.ts:CapabilityHooks].
- Lifecycle policy: `LIFECYCLE_ELIGIBILITY`, `isLifecycleEligible`, and the narrow `LifecycleEligibility` step annotation [lifecycle-eligibility.ts:LIFECYCLE_ELIGIBILITY], [lifecycle-eligibility.ts:isLifecycleEligible], [lifecycle-eligibility.ts:LifecycleEligibility].
- `ProviderExecutorRegistry` keyed by provider type, exposing `register`/`get`/`has`/`listTypes` [provider-registry.ts:ProviderExecutorRegistry], [provider-registry.ts:ProviderCandidate].
- Provider executors and error taxonomy: `ProviderExecutor`, `ProviderRunResult`, `ProviderErrorKind`, `isFallbackEligibleKind`, `classifyErrorKind`, and the `NativeProviderExecutor` / `ToolProviderExecutor` / `UnavailableProviderExecutor` / `McpProviderExecutor` / `ExternalCliProviderExecutor` implementations [provider-executor.ts:ProviderExecutor], [provider-executor.ts:isFallbackEligibleKind], [provider-executor.ts:classifyErrorKind], [provider-executor.ts:UnavailableProviderExecutor].
- Resolution: `ResolverContext`, `ProviderPlanStep`, `ProviderPlan`, `ProviderResolver`, `CapabilityResolver` [provider-resolver.ts:ResolverContext], [provider-resolver.ts:ProviderPlanStep], [provider-resolver.ts:ProviderResolver], [provider-resolver.ts:CapabilityResolver].
- Registry: `CapabilityAvailability`, `RegisteredCapability`, `CapabilityQuery`, `CapabilityManifest`, `CapabilityRegistry` [registry.ts:CapabilityAvailability], [registry.ts:RegisteredCapability], [registry.ts:CapabilityRegistry].
- Tool projection: `toolCapabilityId`, `projectToolCapability`, `projectRegistryTools`, `registerRegistryToolCapabilities` [registry-capabilities.ts:toolCapabilityId], [registry-capabilities.ts:registerRegistryToolCapabilities].
- Mutation port: `CapabilityMutationPort` and the catalog-backed `CatalogBackedCapabilityMutationPort` [mutation-port.ts:CapabilityMutationPort], [mutation-port.ts:CatalogBackedCapabilityMutationPort].
- Mutation contract: `LEGAL_LIFECYCLE_TRANSITIONS`, `isLegalTransition`, `CapabilityDefinitionPatch`, the mutation payload types, `classifyUpdateBump`, `classifySchemaChange`, `validateConsolidateMerge`, `validateCapabilityMutation` [mutation-contract.ts:LEGAL_LIFECYCLE_TRANSITIONS], [mutation-contract.ts:isLegalTransition], [mutation-contract.ts:CapabilityDefinitionPatch], [mutation-contract.ts:validateCapabilityMutation].
- Composition and execution: `CapabilityPlatform` (builds registry, port, providers, resolver, runtime, service, signal channel, observation/measurement wiring) and `CapabilityRuntime` [platform.ts:CapabilityPlatform], [runtime.ts:CapabilityRuntime].
- Service surface: `CapabilityService` (`list`, `inspect`, `search`, `recommend`, `history`, `health`, `apply`, `propose`, `proposeDirect`, `proposeConsolidation`, `governance`, `reject`, `measure`) and `candidateToExecutionStep` [capability-service.ts:CapabilityService], [capability-service.ts:candidateToExecutionStep].
- Bootstrap and adapters: `registerInitialCapabilities`, `legacyToCanonicalDefinition`/`canonicalToLegacyCapability`/`buildLegacyBindings`, `createToolProviderExecutor` [initial-capabilities.ts:registerInitialCapabilities], [legacy-adapter.ts:legacyToCanonicalDefinition], [tool-adapter.ts:createToolProviderExecutor].
- `./canonical/README.md` — canonical definition, provider binding, SemVer, and catalog contracts.
- `./types/README.md` — readonly service result shapes.
- `./errors/README.md` — measurement/proposal domain error classes.
- `./evolution/README.md` — evolution signals, candidates, and proposal generation.
- `governance/` — `GovernanceProposalStore`, governance event types/payloads, and `computeProposalId`: [./governance/README.md](./governance/README.md).
- `measurement/` — `CapabilityMeasurementEngine`, measurement contract, event types, and the outcome discriminated union: [./measurement/README.md](./measurement/README.md).

## Invariants
- The registry holds no independent definitions; entries are refreshed from the catalog and legacy `Capability` values are derived on demand, never stored in a parallel map [registry.ts:CapabilityRegistry], [registry.ts:RegisteredCapability].
- Exactly one `CapabilityRegistry` exists per runtime universe and only the platform constructs it [platform.ts:CapabilityPlatform], [registry.ts:CapabilityRegistry].
- Availability is a two-value axis — `missing_binding` or `provider_unavailable` — and is never expressed as a lifecycle state [registry.ts:CapabilityAvailability], [lifecycle-eligibility.ts:LIFECYCLE_ELIGIBILITY].
- `deprecated` is the only lifecycle-ineligible state, and the six-state transition graph is acyclic with `deprecated` terminal [lifecycle-eligibility.ts:LIFECYCLE_ELIGIBILITY], [mutation-contract.ts:LEGAL_LIFECYCLE_TRANSITIONS].
- Resolution applies the lifecycle gate first and the provider gate second; `allowDeprecated` overrides only the lifecycle axis and reports `overrideUsed` without implying provider availability [provider-resolver.ts:CapabilityResolver], [provider-resolver.ts:ProviderPlanStep].
- A circular capability dependency throws, and a missing dependency raises `CapabilityNotFoundError` [provider-resolver.ts:ProviderResolver].
- `allowFallbacks: false` pins resolution to `bindings[0]`; candidate `bindingIndex` keeps the original bindings position, not the filtered index [provider-resolver.ts:ProviderResolver].
- Registering a second executor for the same provider type throws [provider-registry.ts:ProviderExecutorRegistry].
- All register/unregister traffic goes through the mutation port; `register` is idempotent and `unregister` is a silent no-op on an unknown id [mutation-port.ts:CatalogBackedCapabilityMutationPort].
- Capability ids must match the canonical dotted lowercase pattern, and new entries default to lifecycle `emerging` [registry.ts:CAPABILITY_ID], [registry.ts:DEFAULT_LIFECYCLE].
- `id`, `version`, and `kind` are immutable across mutations; an update patch that names one is rejected [mutation-contract.ts:CapabilityDefinitionPatch], [mutation-contract.ts:validateCapabilityMutation].
- `CapabilityService` is frozen after construction and reports `service.list` as the authoritative view over registry state [capability-service.ts:CapabilityService].
- Fallback eligibility is limited to timeout, rate-limit, http-5xx, and unavailable errors; unclassifiable failures fail closed as `fatal` [provider-executor.ts:isFallbackEligibleKind], [provider-executor.ts:classifyErrorKind].
- `UnavailableProviderExecutor` is a registered stub for `daemon`, `agent`, `plugin`, and `remote-api`; it never reports a capability as executable [platform.ts:CapabilityPlatform], [provider-executor.ts:UnavailableProviderExecutor].
- A subscriber throwing never interrupts event delivery [event-bus.ts:EventBus].

## Side Effects
- Construction creates or loads a durable definition catalog, defaulting to `.alix/capabilities`, and a governance store directory defaulting to `.alix/governance` [platform.ts:CapabilityPlatform].
- Platform construction throws when no `EventLog` is supplied, because the log is the authoritative event sink [platform.ts:CapabilityPlatform].
- Capability events are emitted through the `EventBus` and can be projected into the EventLog via `toAlixEvent` [event-bus.ts:EventBus], [event-bus.ts:toAlixEvent].
- The runtime allocates an `AbortController` per invocation and aborts in-flight provider work on cancellation, emitting `InvocationCancelled` [runtime.ts:CapabilityRuntime].
- `invoke` throws `CapabilityNotFoundError` for an unknown capability and `ProviderUnavailableError` when a single-step plan has no eligible candidate [runtime.ts:CapabilityRuntime].
- `apply`, `propose`, `proposeConsolidation`, `reject`, `measure`, and `governance` read or mutate durable proposal and measurement state through the injected stores and event log [capability-service.ts:CapabilityService].
- Mutations append a new immutable `id@version` to the catalog (never an in-place catalog update) after bumping SemVer through the mutation executor wired by the platform [mutation-port.ts:CatalogBackedCapabilityMutationPort], [mutation-contract.ts:classifyUpdateBump], [../../planning/evolution/execution/capability-mutation-executor.ts:bumpSemVer].

## Verification
- Run: `pnpm test`
