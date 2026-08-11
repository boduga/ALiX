# ALiX Capability Platform — Greenfield Refactor Plan

**Status:** Proposed
**Date:** 2026-08-10
**Design:** `docs/superpowers/specs/2026-08-10-capability-platform-greenfield-design.md`
**ADR:** `docs/architecture/adrs/ADR-0013-capability-system-and-provider-architecture.md`
**Goal:** Replace the split A7 capability surfaces with one canonical capability system.

---

## 1. Plan rules

This is a greenfield refactor of the capability architecture. Do not extend the current A7.0/A7.1 split merely to make it work.

Reuse existing contracts where they remain correct, but establish the new ownership model first:

```text
ONE CapabilityRegistry
ONE capability identity
MANY providers
MANY consumers
ONE current-state authority
```

The implementation is complete only when runtime dispatch, CLI, TUI, and Web UI consume the same capability system.

---

## 2. Target architecture

```text
Capability Sources
       |
       v
CapabilityDefinitionStore ---> CapabilityRegistry <--- ProviderRegistry
                                    |
                                    v
                              CapabilityService
                                    |
                 +------------------+------------------+
                 |                  |                  |
                CLI                TUI               Web
                                    |
                                    v
                              Runtime Resolver
                                    |
                              ExecutionPlan
                                    |
                           Provider Executor
                                    |
             +----------+------------+-------------+----------+
             |          |            |             |          |
           native      tool         MCP       external-cli  daemon...

Governance:
P5.5/P5.6 -> A7 -> A3 -> A4 -> CapabilityRegistry -> A5
                         |
                         +-> A7 lifecycle ledger
```

---

## 3. Workstream 0 — Freeze the architectural decision

### Task 0.1 — Accept ADR-0013

Files:

- `docs/architecture/adrs/ADR-0013-capability-system-and-provider-architecture.md`
- `docs/architecture/README.md`

Actions:

1. Add ADR-0013 to the architecture index.
2. Add Capability Platform ownership to the subsystem table.
3. Add a "Changing capabilities/providers" section to the navigation guide.
4. Link the greenfield design and plan.

Acceptance:

- ADR status is `Accepted`.
- It is the canonical architectural authority for capability/provider boundaries.

---

## 4. Workstream 1 — Canonical capability contract

### Task 1.1 — Separate semantic kind from provider type

Audit `src/capability/types.ts` and all consumers of `Capability.kind` and `execution.strategy`.

Replace implementation-shaped classification with:

```ts
interface Capability {
  id: string;
  version: string;
  kind: CapabilityKind;
  ...
  providers: CapabilityProviderBinding[];
}
```

Provider type must be a separate union.

Acceptance:

- no semantic capability kind means `tool`, `mcp`, `cli`, `gh`, or `gitnexus`;
- provider technology is represented by provider bindings;
- all current capabilities can be represented without information loss.

### Task 1.2 — Provider binding contract

Create the provider contract and validation functions.

Required provider classes:

```text
native
 tool
mcp
external-cli
daemon
agent
plugin
remote-api
```

Validation must reject:

- empty provider IDs;
- malformed provider types;
- non-serializable runtime handles;
- missing required configuration for the provider class.

Acceptance:

- provider bindings are pure data;
- validation is deterministic;
- live executor instances cannot be embedded in capability definitions.

---

## 5. Workstream 2 — Make CapabilityRegistry canonical

### Task 2.1 — Define registry ownership

Refactor `src/capability/registry.ts` so the registry owns:

- definitions;
- lifecycle state;
- provider bindings;
- current provider availability snapshot;
- registration;
- unregistration;
- lookup/query;
- export/import.

It must not own A7 history or invocation history.

### Task 2.2 — Lifecycle state becomes current registry state

Move the greenfield lifecycle representation into the canonical registry model.

Do not retain an A7-only lifecycle overlay as an independent authority.

Required APIs:

```ts
register(capability)
unregister(id)
get(id)
list()
query(filter)
getLifecycleState(id)
setLifecycleState(id, state)
getProviders(id)
getAvailableProviders(id, context)
export()
import()
```

Mutation APIs used by A7 must still be reached through A4 execution rather than direct governance bypasses.

### Task 2.3 — Single-instance composition

Audit all composition roots:

- runtime;
- TUI;
- CLI;
- Web UI;
- daemon/server;
- tests.

Establish one capability-platform composition per runtime process.

Consumers receive the platform/service by dependency injection.

Acceptance:

- no consumer constructs a second canonical registry;
- identity comparisons can prove CLI/TUI/runtime share the same registry instance in-process;
- separate processes load the same durable definition source.

---

## 6. Workstream 3 — Capability definition persistence

### Task 3.1 — Definition store

Introduce a durable `CapabilityDefinitionStore` abstraction.

Responsibilities:

- load definitions;
- save definitions;
- atomic updates;
- validation;
- deterministic ordering;
- corruption handling;
- versioning.

The store is the persistence mechanism, not a second registry.

### Task 3.2 — Source precedence

Define deterministic source precedence:

1. built-in definitions;
2. project-local definitions;
3. plugins;
4. provider discovery;
5. governed registrations;
6. explicit overrides, where allowed.

A source must produce a definition/binding and submit it to the canonical registry.

### Task 3.3 — Replace bootstrap-only definition ownership

`src/capability/initial-capabilities.ts` becomes a seed provider rather than the only source of truth.

The migration must preserve all current definitions:

- `core.session.list`;
- `core.session.show`;
- `core.session.summary`;
- `tool.file.read`;
- `tool.shell.run`;
- all other currently registered capabilities.

Acceptance:

```text
fresh runtime
  -> load definitions
  -> canonical registry
  -> runtime + CLI + TUI all see same catalog
```

---

## 7. Workstream 4 — Provider registry and resolution

### Task 4.1 — Provider registry

Introduce `CapabilityProviderRegistry`/equivalent runtime service.

It maps provider binding types to executors/adapters without changing capability identity.

### Task 4.2 — Provider resolver

Refactor `ExecutionResolver` so provider selection is explicit.

Inputs:

```text
Capability
InvocationContext
ProviderRegistry
```

Outputs:

```text
ExecutionPlan
```

Selection criteria may include:

- permission compatibility;
- lifecycle availability;
- provider availability;
- workspace/project constraints;
- configured priority;
- risk policy;
- provider health;
- cancellation/timeout support.

Provider selection must be deterministic for equivalent inputs.

### Task 4.3 — Provider fallback

Support fallback between providers for one capability.

Example:

```text
code.repository.query
  1. gitnexus
  2. MCP analyzer
  3. native analyzer
```

A provider outage must not automatically change the capability lifecycle.

---

## 8. Workstream 5 — Native and existing tool providers

### Task 5.1 — Native provider migration

Migrate current native capabilities to explicit native provider bindings.

Example:

```text
core.session.list
  kind: operation
  provider: native/session.list
```

### Task 5.2 — Existing ToolExecutor migration

Map current tool capabilities to:

```text
provider.type = tool
```

Preserve existing tool safety/permission behavior.

Acceptance:

- runtime behavior remains unchanged for existing capabilities;
- no capability identity changes solely because provider representation changed.

---

## 9. Workstream 6 — MCP provider

### Task 6.1 — MCP discovery adapter

MCP discovery produces provider bindings/capabilities through the canonical registration path.

Do not register MCP protocol operations as capabilities.

### Task 6.2 — MCP tool mapping

For each MCP tool that represents an intentional semantic operation:

```text
MCP tool
  -> capability definition
  -> MCP provider binding
```

Preserve tool schemas and descriptions as provider/definition metadata where appropriate.

### Task 6.3 — MCP resource rule

Resources remain provider resources unless they represent a meaningful semantic capability.

Acceptance:

- MCP server identity is not capability identity;
- MCP protocol lifecycle is not shown in `alix capabilities list`.

---

## 10. Workstream 7 — External CLI provider

### Task 7.1 — Generic external CLI executor

Introduce a provider executor for external executables.

Required behavior:

- executable resolution;
- explicit argv construction;
- cwd policy;
- environment filtering;
- timeout;
- cancellation;
- stdout/stderr capture;
- exit-code normalization;
- typed provider errors.

### Task 7.2 — GitHub CLI

Represent GitHub operations as semantic capabilities backed by `gh`.

Example:

```text
github.issue.create
  provider.type = external-cli
  executable = gh
  operation = issue create
```

### Task 7.3 — GitNexus

Represent GitNexus operations as semantic code-analysis capabilities.

Examples:

```text
code.repository.query
code.repository.context
code.repository.impact
```

Provider:

```text
external-cli / gitnexus
```

Acceptance:

- the model/runtime invokes a capability, not a raw shell command;
- executable details remain provider infrastructure;
- provider replacement preserves capability identity.

---

## 11. Workstream 8 — CapabilityService

### Task 8.1 — Canonical service facade

Create/reshape `CapabilityService` as the consumer-facing facade.

Responsibilities:

- list/query/inspect;
- resolve provider;
- invoke;
- expose lifecycle state;
- expose governance history as a separate read model;
- provide safe registration APIs for authorized callers.

It must not become a second store.

### Task 8.2 — Consumer contract

All UI/CLI consumers use this service or an explicit read-model adapter.

No consumer imports a provider executor directly for ordinary capability invocation.

---

## 12. Workstream 9 — Rebuild A7 around the canonical registry

### Task 9.1 — Preserve A7 intelligence boundary

Keep P5.5/P5.6 as owners of:

- health;
- gaps;
- overlap;
- drift.

A7 consumes those signals and creates `EvolutionProposal`s.

### Task 9.2 — Register becomes executable

A `register` proposal must contain the complete capability artifact.

A7 proposal construction must not produce a placeholder that A4 cannot execute.

Required payload:

```text
CapabilityDefinition
ProviderBindings
LifecycleState
EvidenceReferences
```

### Task 9.3 — A4 execution binding

A4 receives the approved proposal and registers the exact approved definition in the canonical registry.

No gate-then-mutate shortcut.

### Task 9.4 — Existing lifecycle intents

Implement semantic transitions over the canonical registry.

`promote`, `deprecate`, and other intents must have explicit definitions. `modify` is only executable when a real metadata/provider mutation contract exists; otherwise it remains a proposal-only intent until that contract is designed.

`consolidate` must be a true governed definition merge/rewrite if it is called consolidation. Do not silently redefine consolidation as merely deprecating related capabilities.

This is an intentional correction to the A7.1 implementation.

### Task 9.5 — A7 ledger

Keep the append-only ledger for:

- intent;
- proposal;
- decision;
- application;
- measurement.

The ledger contains references to registry artifacts and governance artifacts; it does not become the current registry.

---

## 13. Workstream 10 — CLI/TUI/Web unification

### Task 10.1 — CLI

Refactor `alix capabilities` to consume the canonical `CapabilityService`.

Required invariant:

```text
CLI list == canonical registry list
```

### Task 10.2 — TUI

The Capabilities view and command palette consume the same service/registry.

### Task 10.3 — Web UI

The Web UI consumes the same service/read model and must not create another catalog store.

### Task 10.4 — Historical state presentation

Governance views may show:

- proposed capability;
- approved capability;
- rejected proposal;
- applied transition;
- measured outcome.

They must label these as governance/history state and never present them as current registry state unless the registry confirms it.

---

## 14. Workstream 11 — Runtime lifecycle enforcement

### Task 11.1 — Provider resolver respects lifecycle

Normal runtime resolution must exclude capabilities whose current lifecycle state is `deprecated`, subject to an explicit administrative override contract.

### Task 11.2 — Availability is distinct from lifecycle

A capability may be `active` while its preferred provider is unavailable.

The resolver may fail over or report unavailable provider state without mutating lifecycle.

### Task 11.3 — Governance application changes runtime behavior

After A4 applies a lifecycle transition to the canonical registry, runtime resolution must immediately observe the new state in the same process.

---

## 15. Workstream 12 — Tests and invariants

### Contract tests

- semantic kind/provider separation;
- provider binding validation;
- serialization;
- backward compatibility where required.

### Registry tests

- registration;
- unregistration;
- duplicate identity;
- lifecycle transitions;
- definition store round-trip;
- source precedence.

### Provider tests

- native;
- tool;
- MCP;
- external CLI;
- fallback;
- provider failure;
- capability failure distinction.

### Cross-surface tests

- CLI/TUI/Web catalog parity;
- runtime resolver parity;
- same registry instance in one composition;
- no second registry creation in consumers.

### Governance tests

- complete register proposal;
- A3 approval without mutation;
- A4 register mutation;
- rejection no mutation;
- rollback;
- A5 measurement;
- ledger/current-state separation.

### Critical end-to-end test

```text
create/register capability
    -> provider binding
    -> runtime list
    -> CLI list
    -> TUI/Web list
    -> invoke
    -> A7 health signal
    -> propose
    -> A3 approve
    -> A4 apply
    -> registry changes
    -> runtime behavior changes
    -> A5 measure
```

---

## 16. Workstream 13 — Remove the split surface

Delete or refactor code that creates an A7-only capability registry.

Search targets include:

```text
new CapabilityRegistry()
CapabilityRegistry construction in CLI handlers
A7 registry-only overlay assumptions
registerInitialCapabilities used as the sole definition database
```

The test suite should include a structural sentinel preventing the CLI capability command from constructing a second registry.

---

## 17. Workstream 14 — Documentation migration

### Update

- `docs/architecture/README.md`
- `docs/architecture/adrs/ADR-0013-capability-system-and-provider-architecture.md`
- `docs/superpowers/specs/2026-08-10-capability-platform-greenfield-design.md`
- `docs/superpowers/plans/2026-08-10-capability-platform-greenfield-refactor.md`
- `docs/capability-platform.md`
- `docs/superpowers/specs/2026-07-31-capability-platform-design.md`
- A7/A7.1 design and plan documents
- A7/A7.1 checkpoint documents

### Rule

Historical documents are not rewritten to pretend the old implementation never existed. Instead, they receive an explicit `Superseded` notice pointing to ADR-0013 and the greenfield design.

Active architecture references must point to the greenfield design.

---

## 18. Workstream 15 — Checkpoint

Create a new checkpoint only after implementation and tests prove:

```text
alix-capability-greenfield-complete
```

Checkpoint must record:

- canonical registry ownership;
- provider abstraction;
- definition persistence;
- CLI/TUI/Web parity;
- governed registration;
- provider examples (`gh`, GitNexus, MCP);
- lifecycle/runtime enforcement;
- test totals;
- migration of old A7 artifacts.

---

## 19. Execution order

The implementation order is deliberately contract-first:

```text
1. ADR + docs freeze
2. Capability contract
3. Provider contract
4. Canonical registry
5. Definition persistence
6. Single composition root
7. Provider registry/resolver
8. Native/tool migration
9. MCP provider
10. External CLI provider
11. CapabilityService
12. A7 rebuild
13. A4 governed registration
14. A5 measurement
15. CLI/TUI/Web unification
16. Runtime lifecycle enforcement
17. Cross-surface/integration tests
18. Remove old split implementation
19. Documentation/checkpoint
20. tag
```

Do not implement A7 before the canonical registry/provider architecture exists. Otherwise the same split will be recreated.

---

## 20. Hard acceptance criteria

The branch cannot be declared complete unless all are true:

- [ ] exactly one canonical capability registry per runtime composition;
- [ ] CLI does not create a second registry;
- [ ] TUI and Web UI do not maintain duplicate catalogs;
- [ ] capability identity is provider-independent;
- [ ] MCP is a provider/integration boundary;
- [ ] external CLI tools are providers;
- [ ] `gh` can implement a capability;
- [ ] GitNexus can implement a capability;
- [ ] provider fallback works without changing capability identity;
- [ ] current capability state comes from the registry;
- [ ] A7 ledger is history/governance, not current capability state;
- [ ] A7 `register` can be approved and actually applied;
- [ ] registration applies a complete definition, not a placeholder;
- [ ] A4 remains the mutation boundary;
- [ ] A5 measures actual post-application outcomes;
- [ ] deprecated capabilities are excluded from normal runtime selection;
- [ ] CLI/runtime catalog parity test is green;
- [ ] provider failure/capability failure distinction is tested;
- [ ] documentation no longer presents A7.0/A7.1 split-registry assumptions as active architecture.

---

## 21. Final implementation principle

Do not ask:

> "Where should the capability CLI store its capabilities?"

Ask:

> "Which canonical capability system is every surface consuming?"

The answer must always be the same:

```text
CapabilityRegistry
```

Everything else is a consumer, provider, projection, governance artifact, or execution mechanism.
