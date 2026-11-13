# Operations

## Overview

The operational and infrastructure layer beneath ALiX's agent surfaces: configuration truth and mutation, the persistent daemon and its task registry, the SQLite kernel database, hooks, scheduled-job approval flow, observability, prompt inventory, evaluation and benchmarking harnesses, correlation analysis, proposal explanation, and shared utilities including agent memory. These packages do not decide agent behaviour; they load and persist the state it runs on, measure it, and expose operator-facing read models.

## Subdirectories & Boundaries

- Benchmark: [./benchmark/README.md](./benchmark/README.md) - Performance sampling and baseline comparison over the `cases/` workload registry, stored under `.alix/benchmarks`.
- Config: [./config/README.md](./config/README.md) - Config load/merge/validate, canonical `models` resolution with legacy projections, context budgeting, profiles, and provenance-tracked atomic mutation with optional signing.
- Correlation: [./correlation/README.md](./correlation/README.md) - Cross-subsystem correlation graph from trend snapshots and baseline comparisons, persisted as one validated JSON document.
- Daemon: [./daemon/README.md](./daemon/README.md) - Per-user background host: local JSON-line socket API, FIFO task queue, task registry, approval polling, and coordination scheduling under `~/.alix`.
- Database: [./db/README.md](./db/README.md) - `DatabaseManager` over local SQLite: WAL journaling, foreign-key enforcement, ordered kernel migrations, and schema health.
- Evals: [./evals/README.md](./evals/README.md) - Isolated behavioral evaluation: fixture directories, scripted or real drivers, and objective filesystem-versus-reported-status verdicts.
- Explain: [./explain/README.md](./explain/README.md) - Read-only `ProposalExplanation` assembly across decision lifecycle stores, the evidence chain, and learning/calibration state.
- Hooks: [./hooks/README.md](./hooks/README.md) - Project `pre_task`/`post_task`/`on_change` hooks from `<root>/.alix/hooks.json`, run through `/bin/sh -c` with a restricted child environment.
- Observability: [./observability/README.md](./observability/README.md) - Metric registry, JSONL metric/diagnostic stores, telemetry envelopes, alert engine, cost attribution, health projection, and read-only exposure routes.
- Prompts: [./prompts/README.md](./prompts/README.md) - Versioned inventory of static model-facing prompt text with owning source files; dynamic per-turn assembly is excluded.
- Schedule: [./schedule/README.md](./schedule/README.md) - Agent-proposed recurring jobs recorded as approvals; only an approved, daemon-materialized job ever dispatches.
- Testing: [./testing/README.md](./testing/README.md) - Seeded concurrency harness for stress suites; test-only, holding no production state.
- Utils: [./utils/README.md](./utils/README.md) - Shared cache, canonical hashing, directory search, prompts, session digests, token estimation, and the project-scoped `memory/` store.
