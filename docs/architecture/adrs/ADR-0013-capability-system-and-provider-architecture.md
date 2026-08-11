# ADR-0013 — Canonical Capability System and Provider Architecture

**Status:** Accepted
**Date:** 2026-08-10
**Supersedes:** the split capability-surface assumptions introduced by A7.0/A7.1; those documents remain historical records and are explicitly superseded by this ADR.
**Scope:** Capability Platform, M-series registry, runtime providers, A7 lifecycle governance, CLI/TUI/Web consumers

---

## Context

ALiX currently has a strong Capability Platform foundation, but the A7 marketplace work exposed an architectural split: the runtime uses the M-series `CapabilityRegistry`, while the A7 capability CLI can be composed around a separate registry instance. That creates two apparent capability surfaces and makes governed capability creation ambiguous.

The greenfield decision is to eliminate that split.

A capability is the semantic ability ALiX exposes to an agent/operator. A tool, MCP operation, native function, daemon, plugin, external CLI such as `gh` or GitNexus, remote API, or other backend is an implementation provider for that capability. Providers are not capability identities.

---

## Decision

### 1. One canonical capability system

There is exactly one canonical `CapabilityRegistry` per ALiX runtime/application composition.

It is the authoritative current-state source for:

- which capabilities exist;
- capability definitions and metadata;
- current lifecycle state;
- registration and unregistration;
- provider bindings and their availability;
- capability discovery.

No CLI, TUI, Web UI, governance module, or test composition may create a parallel capability registry to represent the same runtime's capabilities.

### 2. `alix capabilities` survives as a consumer

The CLI namespace remains first-class, but it is a view/controller over the canonical capability system:

```text
alix capabilities
        |
        v
CapabilityService
        |
        +---- CapabilityRegistry
        +---- CapabilityProviderRegistry
        +---- P5.5/P5.6 intelligence
        +---- A7 lifecycle ledger
        +---- A3/A4/A5
```

The CLI does not own capability definitions and does not construct a second registry.

### 3. Capability identity is semantic

A capability answers:

> What can ALiX do?

Examples:

- `github.issue.create`
- `code.repository.query`
- `core.session.list`
- `filesystem.file.read`

Capability identity remains stable when its implementation provider changes.

### 4. Providers are implementations

A provider answers:

> How does ALiX perform this capability?

Supported provider classes include:

- `native` — built-in TypeScript/runtime implementation;
- `tool` — existing ALiX tool adapter;
- `mcp` — MCP server/tool binding;
- `external-cli` — executable such as `gh`, `gitnexus`, `kubectl`, `terraform`, or `docker`;
- `daemon` — local or remote daemon;
- `agent` — delegated agent/subagent implementation;
- `plugin` — plugin-provided implementation;
- `remote-api` — HTTP/API backend;
- future provider types as needed.

A provider is not itself a capability.

### 5. Provider switching does not rename the capability

For example:

```text
code.repository.impact
        |
        +-- GitNexus CLI
        +-- MCP repository analyzer
        +-- native analyzer
```

The capability remains `code.repository.impact`; provider selection is a runtime concern.

### 6. Capability kind and provider type are separate dimensions

The existing `kind` field must not encode implementation technology.

The greenfield contract separates:

```ts
kind: CapabilityKind
provider: CapabilityProvider
```

`kind` describes the semantic form of the capability, while `provider.type` describes its implementation mechanism.

The exact `CapabilityKind` vocabulary is established by the greenfield capability contract; it must not use `tool`, `mcp`, `cli`, or other implementation technologies as semantic kinds.

### 7. Capability creation is a real registry operation

A governed `register` proposal must carry a complete capability definition and an executable provider binding. An approval without a definition is not an executable registration.

The governed path is:

```text
candidate
  -> EvolutionProposal
  -> A3 GovernanceDecision(APPROVE)
  -> A4 authorization
  -> A4 execution plan
  -> CapabilityRegistry.register(definition)
  -> capability exists in the canonical registry
```

There is no permanent `APPROVED_PENDING_APPLICATION` dead-end for registration once the greenfield implementation is complete.

### 8. A7 governs capabilities, not providers by default

A7 lifecycle governance operates on capability identity. Provider health and provider selection are separate concerns.

Deprecating `code.repository.impact` is a capability lifecycle change.

Replacing GitNexus with an MCP implementation is a provider binding change and does not inherently deprecate the capability.

Provider governance may be introduced later as a separate, explicit contract if needed; it must not be smuggled into capability lifecycle semantics.

### 9. Current state and history remain separate

The registry is authoritative for current runtime capability state.

The A7 ledger is authoritative for lifecycle history and governance transition records.

The ledger never replaces the registry as the current-state authority.

```text
CapabilityRegistry
  = current truth

A7 Ledger
  = governed history

Projections
  = derived views
```

### 10. Runtime and operator interfaces consume the same objects

TUI, CLI, Web UI, agents, MCP-facing interfaces, and automation all resolve capabilities from the same capability system.

A user must never see a capability in one surface that does not exist in the canonical registry used by runtime dispatch, except where the UI is explicitly showing historical or proposed entities and labels them as such.

---

## Capability model

The greenfield conceptual model is:

```text
Capability
  |
  +-- identity
  +-- semantic definition
  +-- lifecycle
  +-- permissions
  +-- risk
  +-- schemas
  +-- dependencies
  +-- provider bindings
             |
             +-- native
             +-- tool
             +-- MCP
             +-- external CLI
             +-- daemon
             +-- agent
             +-- plugin
             +-- remote API
```

A capability definition remains pure data. Provider bindings are also declarative data; live provider handles/executors remain runtime infrastructure.

---

## External CLI rule

External CLIs are providers, not capabilities.

For example:

```text
Capability: github.issue.create
Provider:
  type: external-cli
  executable: gh
  operation: [issue, create]
```

and:

```text
Capability: code.repository.impact
Provider:
  type: external-cli
  executable: gitnexus
  operation: [impact]
```

The model-facing contract should expose the semantic capability rather than requiring the model to know the executable's command syntax.

The provider executor owns executable resolution, argument construction, environment handling, timeout, cancellation, stdout/stderr capture, exit-code interpretation, and provider-specific errors.

---

## MCP rule

An MCP server is an integration/provider boundary. MCP protocol operations are not automatically capabilities.

An MCP tool that represents an intentional agent operation should normally be represented as a capability with an MCP provider binding.

MCP transport/protocol plumbing (`initialize`, `list_tools`, session negotiation, etc.) is infrastructure and must not be registered as user-facing capabilities.

MCP resources may become capabilities when they represent a meaningful semantic operation; otherwise they remain provider data access.

---

## Consequences

### Positive

- eliminates the two-registry/two-surface ambiguity;
- runtime, TUI, CLI, and Web UI see the same capability catalog;
- provider replacement does not change capability identity;
- A7 can govern semantic abilities instead of implementation technology;
- governed registration becomes a real operation rather than a proposal that can never apply;
- external CLIs and MCP integrations fit the same architecture as native execution;
- capability discovery and governance become composable.

### Negative

- the M-series registry becomes a more important architectural hub;
- provider binding needs a first-class contract;
- existing `kind`/`execution.strategy` fields require migration;
- A7's current implementation must be refactored rather than incrementally patched;
- capability-definition persistence/loading must be designed as part of the canonical registry lifecycle.

---

## Migration rule

This is a greenfield refactor of the capability architecture, not an attempt to preserve the A7.1 split.

Existing A7.0/A7.1 implementation artifacts are historical and must not be extended as the new architecture's foundation.

The replacement implementation may reuse proven A0/A3/A4/A5 contracts and proven registry/runtime primitives, but the capability ownership and provider boundaries are rebuilt around this ADR.

---

## Non-negotiable invariants

1. Exactly one canonical capability registry per runtime composition.
2. No consumer creates a second registry to represent the same capabilities.
3. Capability identity is semantic and provider-independent.
4. MCP, tools, external CLIs, native functions, daemons, plugins, and APIs are providers/implementations.
5. Provider changes do not silently change capability identity.
6. A7 lifecycle governance never directly becomes runtime mutation; A4 remains the mutation boundary.
7. Registry current state and A7 historical governance state are distinct authorities.
8. A governed registration must contain enough definition/provider information for A4 to execute it.
9. Runtime dispatch consumes the same canonical registry surfaced by operator interfaces.
10. Historical/proposed capabilities are never presented as current runtime capabilities without an explicit state label.
