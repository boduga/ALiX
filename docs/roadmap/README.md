# Roadmap Overview

ALiX uses a three-roadmap architecture. See [MA0 — ALiX Architecture 2.0](../architecture/ma0-alix-architecture-2-0.md) for the full governance model.

| Roadmap | Purpose | Documents |
|---|---|---|
| **[M-Series](m-series-platform.md)** | Platform — runtime, coordination, context, storage, tools | Platform roadmap |
| **[P-Series](p-series-product-intelligence.md)** | Product Intelligence — workflow, adaptation, governance, learning, executive | Product roadmap |
| **[A-Series](a-series-autonomous-evolution.md)** | Autonomous Evolution — self-improvement, agent generation, code evolution | Autonomy roadmap |

## Roadmap Rules

1. **M → P → A** — dependency direction is always upward
2. Lower layers must never depend on higher layers
3. Platform primitives belong to M-Series, not P or A
4. Autonomous changes must pass through governance
