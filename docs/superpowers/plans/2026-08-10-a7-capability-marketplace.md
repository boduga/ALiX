# A7.0 Capability Marketplace Plan — Superseded

**Status:** Superseded
**Superseded by:** `docs/superpowers/plans/2026-08-10-capability-platform-greenfield-refactor.md`
**Canonical architecture:** `docs/architecture/adrs/ADR-0013-capability-system-and-provider-architecture.md`
**Canonical design:** `docs/superpowers/specs/2026-08-10-capability-platform-greenfield-architecture-design.md`

This plan is retained as a historical record of the original A7.0 implementation approach. It must not be used as the implementation plan for the greenfield capability architecture.

The replacement plan deliberately rebuilds the capability boundary before rebuilding A7. It removes the split registry/surface model, introduces a provider abstraction, makes capability definitions durable, and makes governed `register` an executable operation through A4.

Use the replacement plan for all new capability-platform work.
