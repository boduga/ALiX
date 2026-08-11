# A7.1 Capability Application Plan — Superseded

**Status:** Superseded
**Superseded by:** `docs/superpowers/plans/2026-08-10-capability-platform-greenfield-refactor.md`
**Canonical architecture:** `docs/architecture/adrs/ADR-0013-capability-system-and-provider-architecture.md`
**Canonical design:** `docs/superpowers/specs/2026-08-10-capability-platform-greenfield-design.md`

This plan is retained as a historical record of the original A7.1 Apply → Measure implementation. It is not the active plan for capability-platform work.

The replacement plan intentionally rebuilds the capability system from the canonical M-series registry outward. It does not add another overlay-owned capability surface or preserve the old deferred-registration boundary. Governed registration, provider bindings, definition persistence, runtime resolution, and CLI/TUI/Web parity are established before the A7 lifecycle loop is rebuilt.

Use the replacement plan for all new A7/capability-platform implementation.
