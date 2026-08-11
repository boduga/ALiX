# ALiX Capability Platform — Greenfield Design

**Status:** Proposed replacement architecture
**Date:** 2026-08-10
**Canonical ADR:** `docs/architecture/adrs/ADR-0013-capability-system-and-provider-architecture.md`
**Purpose:** Replace the split capability surfaces exposed by A7.0/A7.1 with one canonical capability system.

---

## 1. Executive decision

ALiX has **one capability system**.

The M-series `CapabilityRegistry` survives and becomes the canonical current-state authority. The A7 capability CLI survives only as an operator interface over that system. The separate A7-owned/CLI-created registry surface is removed.

```text
                         Capability Platform
                                |
                    +-----------+-----------+
                    |                       |
             CapabilityRegistry      ProviderRegistry
                    |                       |
                    +-----------+-----------+
                                |
                         CapabilityService
                                |
          +---------------------+---------------------+
          |                     |                     |
         CLI                   TUI                 Web UI
          |                     |                     |
          +---------------------+---------------------+
                                |
                       Runtime / Governance
```

The key abstraction is:

> **Capability = semantic ability. Provider = implementation.**

Tools, MCP operations, native functions, external CLIs such as GitHub CLI (`gh`) and GitNexus, daemons, agents, plugins, and remote APIs are providers behind capabilities.

---

## 2. Problem being solved

The current A7 work exposed three architectural problems:

1. the runtime registry and A7 CLI registry can be different instances;
2. A7 can approve `register` while A7.1 cannot create a capability definition;
3. `kind`/`execution.strategy` mix semantic capability identity with implementation technology.

The result is a false distinction between:

```text
runtime capabilities
```

and:

```text
A7 governance capabilities
```

There should be no such distinction.

---

## 3. Goals

### Goals

- one canonical capability registry;
- one capability identity across every ALiX interface;
- provider-independent capability identity;
- first-class provider bindings;
- native, tool, MCP, external CLI, daemon, agent, plugin, and remote providers behind one model;
- governed registration that can actually create a complete capability;
- A7 lifecycle governance over the canonical registry;
- runtime provider selection independent of capability identity;
- capability lifecycle state visible to runtime dispatch and operator interfaces;
- capability definition loading/persistence designed as part of the canonical system;
- no second capability database disguised as a CLI or governance store.

### Non-goals

- redesigning A3 governance;
- replacing A4 authorization;
- replacing A5 observation;
- redesigning P5.5/P5.6 intelligence;
- making provider health part of capability lifecycle;
- making MCP protocol plumbing user-facing capabilities;
- making an external executable itself a capability identity;
- preserving A7.1's split-registry implementation shape.

---

## 4. Terminology

### Capability

A stable semantic ability exposed to an agent/operator.

Examples:

```text
core.session.list
filesystem.file.read
github.issue.create
code.repository.query
code.repository.impact
```

### Provider

A mechanism capable of implementing a capability.

Examples:

```text
native
mcp
external-cli
plugin
daemon
remote-api
```

### Provider binding

The declarative relationship between a capability and a provider implementation.

### Executor

Runtime infrastructure that performs a provider binding. Executors are not capability identities.

### Registry

The canonical current-state authority for capability definitions, lifecycle state, and provider bindings.

### Lifecycle ledger

Append-only A7 history of proposals, decisions, applications, and measurements. It is not the current capability registry.

---

## 5. Canonical architecture

```text
                           +----------------------+
                           | Capability Sources   |
                           |----------------------|
                           | built-in definitions |
                           | tool adapters        |
                           | MCP discovery        |
                           | external providers   |
                           | plugins              |
                           | project definitions |
                           | governed registration|
                           +----------+-----------+
                                      |
                                      v
                           +----------------------+
                           | CapabilityRegistry  |
                           |----------------------|
                           | definitions         |
                           | lifecycle            |
                           | provider bindings   |
                           | availability        |
                           +----------+-----------+
                                      |
                    +-----------------+-----------------+
                    |                                   |
                    v                                   v
             CapabilityService                   Runtime Resolver
                    |                                   |
       +------------+-----------+                 Provider selection
       |            |           |                       |
       v            v           v                       v
      CLI          TUI        Web UI              Provider Executor
                                                       |
                    +----------------+----------------+----------------+
                    |                |                |                |
                 native            MCP          external-cli        daemon...

Governance path:

P5.5/P5.6 -> A7 analyzer -> EvolutionProposal -> A3 -> A4 -> Registry
                                               |
                                               +-> A5 observation
                                               |
                                               +-> A7 ledger
```

---

## 6. Canonical registry ownership

The registry owns current state:

```text
CapabilityRegistry
  ├── definitions
  ├── lifecycle state
  ├── provider bindings
  ├── provider availability snapshot
  ├── registration
  ├── unregistration
  ├── lookup/query
  └── export/import manifest
```

It does not own:

- governance decisions;
- proposal history;
- invocation history;
- provider executor instances;
- UI state;
- A7 evidence artifacts.

Those remain separate concerns.

---

## 7. Capability contract

The existing pure-data `Capability` contract is retained conceptually but refactored so semantic classification and implementation are separate.

```ts
interface Capability {
  id: string;
  version: string;

  kind: CapabilityKind;

  title: string;
  description: string;
  aliases?: string[];
  tags: string[];
  category: string;
  risk: CapabilityRisk;
  requiredPermissions: Permission[];

  argsSchema?: JsonSchema;
  resultSchema?: JsonSchema;
  examples?: string[];
  dependencies?: string[];

  providers: CapabilityProviderBinding[];
}
```

The exact semantic `CapabilityKind` set is established during implementation after auditing current consumers. It must not use implementation technologies such as `mcp`, `cli`, or `tool` as kinds.

---

## 8. Provider contract

```ts
interface CapabilityProviderBinding {
  providerId: string;
  type: CapabilityProviderType;
  priority?: number;
  constraints?: ProviderConstraints;
  config: Record<string, unknown>;
}

type CapabilityProviderType =
  | "native"
  | "tool"
  | "mcp"
  | "external-cli"
  | "daemon"
  | "agent"
  | "plugin"
  | "remote-api";
```

Provider bindings are data. Live clients, processes, MCP sessions, subprocess handles, and executor objects are runtime infrastructure and never enter the capability definition.

---

## 9. Provider examples

### Native

```text
core.session.list
  provider.type = native
  provider.reference = session.list
```

### Existing ALiX tool

```text
filesystem.file.read
  provider.type = tool
  provider.reference = file.read
```

### MCP

```text
github.issue.create
  provider.type = mcp
  provider.reference = github-mcp
  provider.operation = create_issue
```

### External CLI

```text
github.issue.create
  provider.type = external-cli
  executable = gh
  argv = ["issue", "create", ...]
```

### GitNexus

```text
code.repository.impact
  provider.type = external-cli
  executable = gitnexus
  operation = impact
```

The model requests the semantic capability. It does not need to know the provider's command syntax.

---

## 10. Provider selection

Provider selection is runtime resolution, not capability identity.

```text
Capability
    |
    v
ProviderResolver
    |
    +-- availability
    +-- permissions
    +-- project/workspace constraints
    +-- risk
    +-- provider priority
    +-- provider health
    +-- execution context
    |
    v
ExecutionPlan
```

Same capability, different providers:

```text
code.repository.query
        |
        +-- GitNexus CLI
        +-- repository MCP
        +-- native analyzer
```

A provider can disappear while the capability remains active if another provider can satisfy it.

---

## 11. Provider failure versus capability failure

These are different facts.

### Provider failure

```text
GitNexus unavailable
```

Possible response:

```text
try MCP provider
```

Capability remains active.

### Capability failure

```text
No provider can satisfy code.repository.impact
```

This is a capability availability failure.

### Capability lifecycle change

```text
code.repository.impact -> deprecated
```

This is a governed semantic change and is A7 territory.

---

## 12. Registration and creation

A capability can enter the canonical registry through several sources, but every path ends at the same registry.

```text
+---------------------+
| Built-in source     |
+---------------------+
          |
+---------------------+
| Tool/MCP discovery  |
+---------------------+
          |
+---------------------+
| Plugin/provider     |
+---------------------+
          |
+---------------------+
| Project definition  |
+---------------------+
          |
+---------------------+
| Governed register   |
+---------------------+
          |
          v
CapabilityRegistry.register(definition)
```

### Governed registration

A `register` EvolutionProposal must contain:

1. complete capability definition;
2. at least one valid provider binding;
3. provenance/evidence explaining why it should exist;
4. deterministic target identity;
5. any required permissions/risk classification;
6. enough execution information for A4 to build a real plan.

Approval therefore means:

> A3 approved creation of this specific capability definition.

A4 then registers that exact artifact. A7 does not invent missing fields during application.

---

## 13. Lifecycle model

Lifecycle state is part of canonical current capability state.

```text
emerging
   |
   v
active <-> mature
  |
  +-> stagnant
  |
  +-> declining
  |
  +-> deprecated
```

The actual transition rules continue to be defined by P5.5/P5.6 and A7. A7 does not create a second lifecycle vocabulary.

Governance state is separate:

```text
proposal -> decision -> application -> measurement
```

The two dimensions must not be conflated.

---

## 14. A7 integration

A7 consumes capability intelligence and produces governed evolution proposals.

```text
P5.5/P5.6
  |
  v
A7 analyzer
  |
  v
EvolutionProposal(target.kind = capability)
  |
  v
A3 GovernanceDecision
  |
  v
A4 authorization + execution
  |
  v
CapabilityRegistry mutation
  |
  v
A5 outcome observation
```

The A7 ledger records the governance history but does not become a second capability store.

---

## 15. Capability CLI

The namespace remains:

```text
alix capabilities
  list
  inspect <id>
  history <id>
  health
  recommend
  propose
  apply
  measure
```

The critical change is ownership:

```text
alix capabilities
      |
      v
CapabilityService
      |
      v
canonical CapabilityRegistry
```

There is no `new CapabilityRegistry()` inside the CLI command handler.

`list` and `inspect` show the same definitions the runtime can dispatch.

`history` shows A7 governance history and clearly distinguishes historical/proposed state from current registry state.

---

## 16. TUI and Web UI

The TUI and Web UI consume `CapabilityService`/read models backed by the same registry.

They do not maintain their own capability catalog.

A capability displayed as available must be resolvable from the canonical registry and provider resolver at the time of invocation.

Historical and proposed capabilities may be displayed in governance views but must carry explicit non-current state.

---

## 17. Persistence

The greenfield design requires capability definitions to have a durable source independent of process-local boot code.

The persistence architecture is:

```text
CapabilityDefinitionStore
        |
        v
CapabilityRegistry
        |
        +-- runtime providers
        +-- governance
        +-- CLI/TUI/Web
```

Built-in definitions remain seedable, but `initial-capabilities.ts` is a bootstrap source, not the long-term definition database.

The implementation must define precedence and identity rules for:

1. built-ins;
2. project-local definitions;
3. plugins;
4. provider discovery;
5. governed registrations;
6. explicit overrides.

No source may silently create a second registry.

---

## 18. MCP integration

MCP discovery produces provider bindings and, where appropriate, capability definitions.

```text
MCP Server
   |
   +-- tool A ----> Capability + MCP provider
   +-- tool B ----> Capability + MCP provider
   +-- resource --> provider resource / capability when semantically meaningful
```

MCP protocol methods remain infrastructure.

MCP server identity is not capability identity.

---

## 19. External CLI integration

External CLI providers use a common executor contract.

```ts
interface ExternalCliProvider {
  executable: string;
  operation: string;
  argumentBuilder: DeclarativeArgumentSpec;
  cwdPolicy: CwdPolicy;
  environmentPolicy: EnvironmentPolicy;
  timeoutMs?: number;
}
```

The executor owns:

- executable lookup;
- argument validation/construction;
- working directory;
- environment filtering;
- timeout;
- cancellation;
- stdout/stderr capture;
- exit-code mapping;
- provider-specific error normalization.

No capability definition embeds a live `ChildProcess` or executable handle.

---

## 20. Security boundaries

Provider type does not grant permission.

Permission remains capability-level policy:

```text
Capability
   |
   +-- risk
   +-- required permissions
   +-- provider constraints
        |
        v
A4 / runtime authorization
```

An external CLI is not trusted merely because it is installed.

MCP is not trusted merely because it is connected.

Native code is not automatically exempt from governance.

---

## 21. Testing architecture

The refactor must prove the single-surface invariant.

### Registry tests

- every source registers into the same registry;
- registration/unregistration updates current state;
- provider bindings are declarative;
- export/import round-trip;
- duplicate capability identity rejected deterministically.

### Provider tests

- native provider;
- tool provider;
- MCP provider;
- external CLI provider;
- provider failover;
- unavailable provider;
- provider-specific errors normalized.

### Cross-surface tests

- CLI list == registry list;
- TUI catalog == registry list;
- Web catalog == registry list;
- runtime resolver sees capabilities shown by CLI;
- no CLI-created second registry;
- provider replacement preserves capability identity.

### Governance tests

- register proposal contains complete definition;
- A3 approval does not mutate registry;
- A4 application registers the approved definition;
- rejection never registers;
- failed application rolls back;
- A5 measures the actual canonical capability;
- ledger history never masquerades as current registry state.

---

## 22. Migration boundary

The existing A7.0/A7.1 implementation is not extended in place.

The greenfield implementation may reuse:

- A0 `EvolutionProposal`;
- A2.5 `GovernanceRecommendation`;
- A3 `GovernanceDecision`;
- A4 authorization/planning/runtime contracts;
- A5 observation contracts;
- P5.5/P5.6 signal types;
- M-series registry primitives where they remain correct.

The following architectural assumptions are removed:

- CLI-owned empty `CapabilityRegistry`;
- lifecycle-only overlay as the effective capability representation;
- register approved-but-permanently-unexecutable state;
- provider technology encoded as capability kind;
- MCP/tool/external CLI treated as separate capability identities.

---

## 23. Success criteria

The refactor is complete when all of the following are true:

1. `alix capabilities list` shows the same current capabilities the runtime can resolve.
2. No capability CLI path constructs a second canonical registry.
3. `gh`, GitNexus, MCP tools, native functions, and existing ALiX tools can all implement capabilities through provider bindings.
4. A capability can switch providers without changing its identity.
5. A governed `register` proposal contains a complete definition and can be applied through A4.
6. A7 history never becomes the current-state authority.
7. Deprecated capabilities are visible to governance/history but are excluded from normal runtime selection according to lifecycle policy.
8. CLI/TUI/Web are consumers of the same capability system.
9. Provider failure is distinguishable from capability failure.
10. The architecture has exactly one canonical current-state capability surface.

---

## 24. Final statement

ALiX does not have a runtime capability surface and a governance capability surface.

It has **one capability system**.

```text
                   CAPABILITY
                       |
              semantic identity
                       |
        +--------------+--------------+
        |              |              |
      native          MCP       external CLI
        |              |              |
     function       server         gh/gitnexus

All are providers.
The capability is the stable thing being governed and invoked.
```

The registry is the current truth. A7 is the lifecycle governance mechanism. A4 is the mutation boundary. A5 observes outcomes. CLI/TUI/Web are views over the same system.
