# Coordination

## Overview

Multi-agent coordination for ALiX: graph planning and detached execution, durable worker ownership, deterministic SOP graph packs, and the issue-lifecycle workflow kernel. The subtree separates runtime orchestration from the path-based write authority and the state-machine rules that constrain delegated work.

## Subdirectories & Boundaries

- Kernel: [./kernel/README.md](./kernel/README.md) - Graph runtime and scheduler: task graphs, bounded worker dispatch, completion finalization, durable stores, liveness recovery, authorization, and replanning.
- Ownership: [./ownership/README.md](./ownership/README.md) - Lease-based write authority and path-scope arithmetic shared by planning, dispatch gates, and runtime authorization.
- SOP: [./sop/README.md](./sop/README.md) - Built-in deterministic workflow packs that construct fixed `TaskGraph` procedures and persist research artifacts.
- Workflow: [./workflow/README.md](./workflow/README.md) - Issue-lifecycle state machine, workflow skills, hooks, and typed workflow evidence events.
