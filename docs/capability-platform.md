# ALiX Capability Platform

**Architecture:** `docs/architecture/adrs/ADR-0013-capability-system-and-provider-architecture.md`
**Greenfield design:** `docs/superpowers/specs/2026-08-10-capability-platform-greenfield-architecture-design.md`

## What it is

The Capability Platform is ALiX's single semantic execution system.

A **capability** describes what ALiX can do. A **provider** describes how that capability is implemented.

```text
CapabilityRegistry
      |
      +-- semantic capabilities
      |
      +-- lifecycle state
      |
      +-- provider bindings
      |
      v
ProviderResolver -> ExecutionPlan -> ProviderExecutor
```

There is exactly one canonical `CapabilityRegistry` for a runtime composition.

CLI, TUI, Web UI, agents, automation, and governance consume that registry. No interface creates a second registry for its own catalog.

## Capability examples

```text
core.session.list
filesystem.file.read
github.issue.create
code.repository.query
code.repository.impact
```

These are semantic identities. Their implementations can change without changing the capability identity.

## Provider examples

### Native

```text
core.session.list
  -> native provider
```

### Existing ALiX tool

```text
filesystem.file.read
  -> tool provider
```

### MCP

```text
github.issue.create
  -> MCP provider -> GitHub MCP server
```

### External CLI

```text
github.issue.create
  -> external-cli provider -> gh

code.repository.impact
  -> external-cli provider -> gitnexus
```

The model/runtime asks for `github.issue.create` or `code.repository.impact`; it does not need to know the provider's command syntax.

## Consumer example

```typescript
import { CapabilityPlatform } from "./capability/index.js";

const platform = createCapabilityPlatform();

const capability = platform.registry.find("github.issue.create");

const invocation = platform.invoke(
  "github.issue.create",
  { title: "Example" },
  { actor: "operator", cwd: "/workspace" },
);

const result = await invocation.wait();
```

The consumer sees a capability and invocation. It does not receive an executor-specific handle.

## Provider selection

A capability can have multiple providers:

```text
code.repository.query
       |
       +-- GitNexus CLI
       +-- repository MCP
       +-- native analyzer
```

The provider resolver chooses an available implementation using permissions, provider availability, project/workspace constraints, risk, priority, and execution context.

A provider failure does not automatically mean the capability is deprecated. Another provider may satisfy the same capability.

## Governance

A7 governs capability lifecycle; it does not create a second capability store.

```text
P5.5/P5.6 intelligence
        |
        v
A7 proposal
        |
        v
A3 decision
        |
        v
A4 governed execution
        |
        v
CapabilityRegistry
        |
        v
A5 observation
```

The A7 lifecycle ledger is append-only governance history. The registry remains authoritative for current capability state.

A governed `register` proposal must contain a complete capability definition and provider binding. A3 approval followed by A4 execution can therefore create the capability in the same canonical registry used by runtime dispatch and every operator interface.

## Migration rule

`src/capability/initial-capabilities.ts` remains a valid bootstrap source during migration, but it is not the long-term definition database. Built-in definitions, project definitions, plugins, MCP discovery, external providers, and governed registrations all converge on the same registry.

Do not add another registry to solve a consumer-specific problem.
