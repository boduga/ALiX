# Database Manager

## Overview
Owns the local SQLite database used by ALiX kernel and observability state. `DatabaseManager` resolves the default database path under the user home, opens the connection with WAL journaling and foreign-key enforcement, applies the ordered kernel migrations, and reports schema health by listing SQLite tables and views.

## Interface
- `DatabaseManager` — connection lifecycle plus migration and health operations `[manager.ts:DatabaseManager]`.
- `DatabaseManager.open()` — create parent directory and open or create `~/.alix/alix.db` (or the constructor-supplied path) `[manager.ts:open]`.
- `DatabaseManager.migrate(sqlPath)` — execute an arbitrary SQL migration file against the open handle `[manager.ts:migrate]`.
- `DatabaseManager.migrateKernel()` — apply `0001_m09_kernel.sql` then `0002_observability_metric.sql` from the adjacent `migrations/` directory `[manager.ts:migrateKernel]`.
- `DatabaseManager.health()` — `{ ok, tables, error? }` from `sqlite_master` for tables and views `[manager.ts:health]`.
- `DatabaseManager.close()` — close the connection and null the handle `[manager.ts:close]`.
- `DatabaseManager.handle` — raw `better-sqlite3` database accessor, `null` before `open()`/after `close()` `[manager.ts:handle]`.
- SQL migration contracts: [./migrations/README.md](./migrations/README.md).

## Invariants
- The default database path is `join(homedir(), ".alix", "alix.db")`; an explicit constructor path overrides it `[manager.ts:DatabaseManager]`.
- `migrate` and `migrateKernel` throw `Database not opened` when called before `open()` `[manager.ts:migrate]`.
- `migrateKernel` silently skips a migration file that does not exist on disk rather than failing `[manager.ts:migrateKernel]`.
- `health()` returns `{ ok: false, tables: [], error: "Not opened" }` before `open()`, and converts query errors into `{ ok: false, error }` instead of throwing `[manager.ts:health]`.
- `close()` is idempotent-safe: it uses optional chaining and then resets the handle to `null` `[manager.ts:close]`.

## Side Effects
- `open()` creates the database parent directory with `mkdirSync(..., { recursive: true })` and writes/opens the SQLite file `[manager.ts:open]`.
- `open()` sets `journal_mode = WAL` and `foreign_keys = ON` on the connection `[manager.ts:open]`.
- `migrate` and `migrateKernel` read SQL files from disk and execute DDL/DML, mutating the on-disk database `[manager.ts:migrateKernel]`.
- `close()` releases the SQLite connection `[manager.ts:close]`.

## Verification
- Run: `pnpm test`
