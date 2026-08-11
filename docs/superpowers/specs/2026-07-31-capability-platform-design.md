# ALiX Capability Platform — Phase 1 Design

**Status:** Historical / Superseded
**Original date:** 2026-07-31
**Current architecture:** `docs/architecture/adrs/ADR-0013-capability-system-and-provider-architecture.md`
**Current design:** `docs/superpowers/specs/2026-08-10-capability-platform-greenfield-architecture-design.md`
**Current plan:** `docs/superpowers/plans/2026-08-10-capability-platform-greenfield-refactor.md`

## Historical status

This document defined the Phase 1 Capability Platform execution substrate and remains useful as historical context for the original `CapabilityRegistry`, `ExecutionResolver`, `CapabilityRuntime`, `ExecutorRegistry`, and `EventBus` implementation.

The architecture is now superseded because the greenfield capability refactor establishes a stronger boundary between **semantic capability identity** and **provider implementation** and makes the M-series `CapabilityRegistry` the single canonical capability system across runtime, governance, CLI, TUI, and Web UI.

## Current architectural corrections

The original Phase 1 concepts remain reusable, but the following rules are now canonical:

1. There is exactly one canonical `CapabilityRegistry` per runtime composition.
2. Consumers do not create a second registry for their own catalog or governance surface.
3. A capability is a semantic ability, not an implementation technology.
4. Native functions, existing ALiX tools, MCP operations, external CLIs such as `gh` and GitNexus, daemons, agents, plugins, and remote APIs are providers behind capabilities.
5. Capability kind and provider type are separate dimensions.
6. Provider selection is runtime resolution and may change without changing capability identity.
7. A7 lifecycle governance operates on capabilities; the A7 ledger records governance history and is not the current capability database.
8. Governed registration must carry a complete capability definition and provider binding so A4 can actually create it in the canonical registry.
9. CLI/TUI/Web are views and services over the same capability system.
10. Provider failure is distinct from capability lifecycle state.

## Canonical architecture

```text
Capability definition
        |
        v
CapabilityRegistry <---- ProviderRegistry
        |
        v
CapabilityService
        |
   +----+----+----+
   |         |    |
  CLI       TUI  Web
        |
        v
ProviderResolver -> ExecutionPlan -> ProviderExecutor
        |
   +----+--------+---------+---------+
 native          MCP      external-cli  daemon/tool/plugin...
```

For the complete current contract, provider model, persistence model, governance integration, MCP rules, external CLI rules, and implementation plan, use the linked greenfield documents above.
