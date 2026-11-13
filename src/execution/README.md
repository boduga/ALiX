# Execution

## Overview

The execution subsystem turns approved intent into bounded workspace effects. It separates one-shot executive planning, deny-only filesystem authority, patch parsing and application, durable-store recovery, run orchestration, and two complementary verification layers.

## Subdirectories & Boundaries

- Executive: [./executive/README.md](./executive/README.md) - Health-driven plan compilation, approval, DAG execution, remediation handoff, and outcome evaluation for subsystem improvement.
- Filesystem: [./filesystem/README.md](./filesystem/README.md) - The deliberately inert, deny-only governed filesystem authority seam; no module here authorizes production I/O.
- Patch: [./patch/README.md](./patch/README.md) - Parses, validates, contains, checkpoints, applies, and reports model-proposed edits.
- Recovery: [./recovery/README.md](./recovery/README.md) - Read-only integrity scanning plus audited, idempotent repair of durable ALiX and daemon stores.
- Run: [./run/README.md](./run/README.md) - Run contracts, tool-surface construction, approval and tool-call handlers, context pressure, progress, intent, and plan generation above the task loop.
- Verification: [./verification/README.md](./verification/README.md) - Discovers probable test commands, executes them with bounded timeouts, and aggregates results into a reporter.
- Verifier: [./verifier/README.md](./verifier/README.md) - Change-aware verification planning, package-script discovery, test mapping, dependency reachability, risk reporting, and failure-history scoring.
