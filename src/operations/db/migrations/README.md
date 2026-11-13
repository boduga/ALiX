# SQLite Kernel Migrations

## Overview

Ordered SQL DDL applied by `DatabaseManager.migrateKernel()` to the local
`~/.alix/alix.db` SQLite database. The migrations establish the M0.9 kernel
tables (workflows, task graphs, task nodes, events, policy decisions, metrics)
and then copy the legacy `m09_metrics` rows into the canonical `metrics` table
for the observability layer. Each file is written to be idempotent: tables and
indexes use `CREATE ... IF NOT EXISTS` and the metrics copy uses `INSERT OR
IGNORE`.

## Interface

- Migration enumeration and execution order `["0001_m09_kernel.sql", "0002_observability_metric.sql"]` in `migrateKernel` [../manager.ts:migrateKernel]
- `workflows` table — `id`, `schema_version`, `session_id`, `goal`, `mode`, `status`, `budget_json`, `policy_context_json`, `created_at`, `updated_at` [0001_m09_kernel.sql:workflows]
- `task_graphs` table — `id`, `schema_version`, `workflow_id`, `root_goal`, `status`, `strategy`, `created_at`, `updated_at` [0001_m09_kernel.sql:task_graphs]
- `task_nodes` table — `id`, `graph_id`, `title`, `goal`, `domain`, `status`, `dependencies_json`, `required_capabilities_json`, `risk_level`, `approval_mode`, `inputs_json`, `artifacts_json`, `memory_refs_json`, `created_at`, `updated_at` [0001_m09_kernel.sql:task_nodes]
- `events` table — `id`, `schema_version`, `timestamp`, `session_id`, `workflow_id`, `graph_id`, `node_id`, `actor_type`, `actor_id`, `event_type`, `payload_json`, `visibility`, `causality_json`, `integrity_json` [0001_m09_kernel.sql:events]
- `policy_decisions` table — `id`, `request_id`, `capability`, `actor_id`, `resource`, `decision`, `risk_tier`, `reasons_json`, `argument_hash`, `scope`, `valid_for_tool_id`, `valid_for_node_id`, `created_at`, `expires_at` [0001_m09_kernel.sql:policy_decisions]
- `m09_metrics` table (legacy) — autoincrement `id`, `name`, `type`, `value`, `labels_json`, `timestamp` [0001_m09_kernel.sql:m09_metrics]
- `metrics` table (canonical) — same column shape as `m09_metrics`, created by the observability migration [0002_observability_metric.sql:metrics]
- Indexes `idx_events_session_time` on `events(session_id, timestamp)`, `idx_events_workflow_time` on `events(workflow_id, timestamp)`, `idx_task_nodes_graph_status` on `task_nodes(graph_id, status)` [0001_m09_kernel.sql:idx_events_session_time]
- `migrate(sqlPath)` runs an arbitrary SQL file against the opened handle [../manager.ts:migrate]
- `health()` reports `{ ok, tables, error? }` from `sqlite_master` over both tables and views [../manager.ts:health]

## Invariants

- Every table and index is created with `IF NOT EXISTS`, so repeated migration runs are safe [0001_m09_kernel.sql:workflows]
- `events.id` is the primary key; `actor_type`, `actor_id`, `event_type`, and `visibility` are `NOT NULL` [0001_m09_kernel.sql:events]
- `policy_decisions.argument_hash` and `scope` are `NOT NULL`; `expires_at` is nullable [0001_m09_kernel.sql:policy_decisions]
- The metrics copy is guarded by `WHERE EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='m09_metrics')`, so it is a no-op on a fresh database and idempotent on an existing one (paired with `INSERT OR IGNORE` on the primary key) [0002_observability_metric.sql:INSERT OR IGNORE INTO metrics]
- `migrateKernel` skips a migration file that is absent from disk rather than failing [../manager.ts:migrateKernel]
- `migrateKernel` and `migrate` throw `Database not opened` when called before `open()` [../manager.ts:migrateKernel]
- `0002` does not drop `m09_metrics`; legacy rows and the legacy table remain in place [0002_observability_metric.sql:INSERT OR IGNORE INTO metrics]

## Side Effects

- `open()` creates the database parent directory with `mkdirSync(..., { recursive: true })`, then sets `journal_mode = WAL` and `foreign_keys = ON` [../manager.ts:open]
- `migrate` / `migrateKernel` execute raw DDL+DML via `db.exec`, mutating the on-disk SQLite file [../manager.ts:migrateKernel]
- `close()` closes the connection and nulls the handle; `handle` exposes the raw `better-sqlite3` database [../manager.ts:close]
- No application data is inserted beyond the idempotent `m09_metrics` → `metrics` copy [0002_observability_metric.sql:INSERT OR IGNORE INTO metrics]

## Verification

- Run: `pnpm test`
