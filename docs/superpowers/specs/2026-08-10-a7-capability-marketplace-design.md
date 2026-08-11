# A7 — Capability Marketplace Design — Superseded

**Status:** Superseded
**Date:** 2026-08-10
**Superseded by:** `docs/architecture/adrs/ADR-0013-capability-system-and-provider-architecture.md`
**Replacement design:** `docs/superpowers/specs/2026-08-10-capability-platform-greenfield-architecture-design.md`
**Replacement plan:** `docs/superpowers/plans/2026-08-10-capability-platform-greenfield-refactor.md`

## Historical record

This document described the original A7.0 capability lifecycle architecture and its Propose → Decide → Record boundary. It is retained by filename as a migration marker, but it is **not an active architectural specification**.

The greenfield refactor resolves the architectural issue discovered during A7.1: the capability CLI must not construct or own a second `CapabilityRegistry`. The M-series `CapabilityRegistry` is the single canonical current-state capability system.

The replacement architecture also establishes that:

- capability identity is semantic;
- tools, MCP operations, external CLIs, native functions, daemons, agents, plugins, and APIs are providers/implementations;
- `alix capabilities` is a consumer/view over the canonical registry;
- governed registration must carry a complete capability definition and provider binding;
- A7 owns lifecycle governance/history, while the registry owns current capability state;
- A4 remains the mutation boundary and A5 remains the outcome-observation boundary.

Do not implement new work from this document. Use the replacement design and plan above.
