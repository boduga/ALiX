# Runtime State

## Overview

Shared runtime-state substrate for ALiX: schema and authority ports, the append-only session event log, governed execution state and replay, and durable storage primitives including the SQLite runtime ledger. This subtree defines state vocabulary and durability; domain packages retain their own validation and business vocabulary.

## Subdirectories & Boundaries

- Contracts: [./contracts/README.md](./contracts/README.md) - Effect schemas and authority-boundary ports shared across runtime, tool, planning, adaptation, and proposal domains.
- Events: [./events/README.md](./events/README.md) - The append-only `events.jsonl` writer, sequence and cursor authority, and canonical event-type vocabulary.
- Runtime: [./runtime/README.md](./runtime/README.md) - Governed execution intent, route selection, parallel tool scheduling, replay and rollback, ledger continuation, and the runtime event index.
- Storage: [./storage/README.md](./storage/README.md) - Mutation admission, JSONL and atomic JSON I/O, and the transactional SQLite runtime ledger.
