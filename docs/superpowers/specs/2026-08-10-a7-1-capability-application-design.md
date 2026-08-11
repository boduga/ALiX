# A7.1 Capability Application Design — Superseded

**Status:** Superseded
**Superseded by:** `docs/architecture/adrs/ADR-0013-capability-system-and-provider-architecture.md`
**Replacement design:** `docs/superpowers/specs/2026-08-10-capability-platform-greenfield-architecture-design.md`
**Replacement plan:** `docs/superpowers/plans/2026-08-10-capability-platform-greenfield-refactor.md`

## Historical record

This document describes the original A7.1 Apply → Measure implementation, including the lifecycle overlay, A4 binding, compensating rollback, and the deferred `register`/`modify` boundary. It is retained as a historical implementation record, but it is **not an active architecture or implementation specification**.

The greenfield refactor supersedes the split-surface assumptions that led to this implementation. In the replacement architecture:

- the M-series `CapabilityRegistry` is the single canonical current-state system;
- the CLI does not construct a second registry;
- lifecycle state is part of canonical capability state rather than an A7-only effective overlay;
- capability definitions are durable artifacts, not bootstrap-only code literals;
- `register` is a real governed operation when its proposal contains the complete capability definition and provider binding;
- `modify` and `consolidate` must have explicit semantic mutation contracts rather than being reduced to artificial lifecycle transitions;
- tools, MCP, external CLIs such as `gh` and GitNexus, native functions, daemons, agents, and plugins are providers behind capabilities;
- A4 remains the mutation boundary and A5 remains the outcome-observation boundary.

Do not extend this A7.1 implementation shape. Use the replacement design and plan.
