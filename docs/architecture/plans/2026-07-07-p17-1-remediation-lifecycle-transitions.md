# P17.1 — Remediation Lifecycle Transitions

**Date:** 2026-07-07
**Status:** Plan
**Spec:** `docs/architecture/specs/2026-07-07-p17-0-execution-lifecycle-design.md`

## Overview

Pure domain module implementing the remediation proposal state machine. No stores, no CLI, no execution plans. Only lifecycle validation + transition.

## State machine

```
open → accepted
open → dismissed
open → superseded
accepted → resolved
accepted → superseded
```

Invalid transitions throw clear errors. Terminal states (dismissed, resolved, superseded) reject all transitions.

## Task 1 — remediation-lifecycle.ts

```typescript
export type RemediationLifecycleState = "open" | "accepted" | "dismissed" | "resolved" | "superseded";

export function transitionRemediationState(
  currentState: RemediationLifecycleState,
  targetState: RemediationLifecycleState,
  options?: { now?: string },
): { newState: RemediationLifecycleState; transitionedAt: string }
```

Throws on invalid transition. Pure — no store access. No audit imports.

## Task 2 — Tests

| # | Test |
|---|------|
| 1 | open → accepted — valid |
| 2 | open → dismissed — valid |
| 3 | open → superseded — valid |
| 4 | accepted → resolved — valid |
| 5 | accepted → superseded — valid |
| 6 | dismissed → accepted — invalid (terminal) |
| 7 | resolved → accepted — invalid (terminal) |
| 8 | superseded → resolved — invalid (terminal) |
| 9 | accepted → dismissed — invalid (not allowed) |
| 10 | open → resolved — invalid (skips accepted) |

## Acceptance

All valid transitions succeed. Invalid transitions throw clear error. Terminal states block all transitions. Pure module: zero store/audit imports. No CLI, no execution plans.
