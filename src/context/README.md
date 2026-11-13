# Context Assembly

## Overview
Builds the context an agent session receives: task-type outcome statistics, session outcome metrics, a lightweight symbol index for semantic lookup, subsystem-health baselines, structured case memory, and the repository map/embedding pipeline. The modules here are the read side of agent context; they observe and rank, they do not run agents.

## Interface
- `PatternRegistry` with `init`, `save`, `recordOutcome`, `getStats`, `getThresholdBias`, `clear`; `PatternOutcome` [pattern-registry.ts:PatternRegistry].
- `extractSessionOutcome(sessionDir)` with `SessionOutcome` (`success`, `reason`, `iterations`, `totalTokens`, `primaryCount`, `testCount`, `supportingCount`) [session-outcome.ts:extractSessionOutcome].
- `SemanticSearchIndex` with `init`, `indexFile`, `flush`, `search`; `SymbolKind`, `IndexedSymbol`, `SearchResult` [semantic-search.ts:SemanticSearchIndex].
- `baseline/` — subsystem health baseline providers and comparison [./baseline/README.md](./baseline/README.md).
- `chronicle/` — structured case memory for SignalFrame outcomes [./chronicle/README.md](./chronicle/README.md).
- `repomap/` — repository map, dependency graph, symbol extraction, embeddings, ranking, and budgeting pipeline [./repomap/README.md](./repomap/README.md) [repomap/context-pipeline.ts:buildRepoMap].

## Invariants
- `PatternRegistry` keeps one `TaskTypeStats` record per task type and recomputes `successRate` and averages as `count` grows; a task type with no record has no bias [pattern-registry.ts:recordOutcome].
- `getThresholdBias` maps success rate to a fixed bias: below 0.5 → 20, below 0.7 → 10, below 0.85 → 5, otherwise 0; no stats also return 0 [pattern-registry.ts:getThresholdBias].
- `init` is idempotent and loads `stats.json` when present, silently starting empty on any read or parse failure [pattern-registry.ts:init].
- `extractSessionOutcome` prefers `session.ended`'s positive integer `contextPressure.totalIterations` over the `agent.message` recount, because the recount misses tool-only turns [session-outcome.ts:extractSessionOutcome].
- A missing events file yields `{ success: false, reason: "error", iterations: 0, totalTokens: 0 }` rather than throwing [session-outcome.ts:extractSessionOutcome].
- `SemanticSearchIndex.indexFile` hashes content with SHA-1 and skips re-parsing when the stored hash matches, reusing persisted symbols [semantic-search.ts:indexFile].
- Symbol parsing is line-oriented regex detection (`function`, `class`, `interface`, `type`, `const`, and methods inside a class); it is not a full parser and only recognizes those declaration shapes [semantic-search.ts:parseSymbols].
- Search scores exact name 100, prefix 50, contains 25, plus 10 per keyword hit and 5 for a short matching name; result order is score descending then symbol name [semantic-search.ts:calculateScore].
- `TaskType` is a closed union: `bugfix`, `feature`, `refactor`, `docs`, `research`, `unknown` [../task-classifier.ts:TaskType].

## Side Effects
- `PatternRegistry.init` creates its directory; `save` and `recordOutcome` write `<dir>/stats.json`; `clear` empties stats and rewrites the file [pattern-registry.ts:save].
- `extractSessionOutcome` reads `<sessionDir>/events.jsonl`; no writes [session-outcome.ts:extractSessionOutcome].
- `SemanticSearchIndex.init` reads and `persistIndex` writes `<baseDir>/.semantic-search-index.json`; `indexFile` reads the file when content is not supplied [semantic-search.ts:persistIndex].
- `buildRepoMap` and the repomap stages read repository files and, when embeddings are enabled, may load models and read/write the embedding cache under the repomap directory [repomap/embedding-cache.ts:EmbeddingCache].

## Verification
- Run: `pnpm test`
