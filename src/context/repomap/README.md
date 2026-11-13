# RepoMap and Embedding Context

## Overview
Builds the repository map and the semantically ranked context bundle an agent
session receives: file inventory and classification, a relative-import
dependency graph, top-level symbol extraction, git-recency tracking, and
embedding-based semantic search with an on-disk vector cache. `ContextCompiler`
wires the pipeline stages (`RepoMapStage`, `SemanticSearchStage`,
`RankingStage`, `BudgetingStage`) and emits context lifecycle events when an
`EventLog` and `sessionId` are supplied.

## Interface
- `ContextCompiler`, `ContextCompilerOptions`, `ContextKind`, `ContextItem`, `ContextBundle`, `_clearCacheForTesting` [context-compiler.ts:ContextCompiler]
- `ContextCompiler.warm`, `buildEmbeddings`, `compileContext`, `pinFile`, `unpinFile` [context-compiler.ts:ContextCompiler]
- `ContextPipeline`, `ContextStage`, `RepoMapStage`, `SemanticSearchStage`, `RankingStage`, `BudgetingStage`, `buildRepoMap`, `RepoMapOutput` [context-pipeline.ts:ContextPipeline], [context-pipeline.ts:buildRepoMap]
- `EmbeddingCache`, `SEMANTIC_EMBEDDER`, `CODE_EMBEDDER`, `VECTOR_SPACE_VERSION`, `EmbeddingUnavailableError`, `vectorSpaceId`, `hasContent`, `SearchResult`, `SearchableFile`, `EmbedderConfig`, `EmbedderDtype` [embedding-cache.ts:EmbeddingCache], [embedding-cache.ts:SEMANTIC_EMBEDDER]
- `rankContextCandidate`, `RankInput`, `RankOutput` [context-ranker.ts:rankContextCandidate]
- `DependencyGraph`, `buildDependencyGraph`, `DependencyInputFile` [dependency-graph.ts:buildDependencyGraph]
- `readGitActivity`, `GitActivityOptions` [git-activity.ts:readGitActivity]
- `buildRepoMapLite`, `RepoMapLiteIndexer`, `RepoMapLite`, `RepoFileKind`, `RepoFileSummary`, `SymbolSummary`, `RepoMapOptions` [repomap-lite.ts:buildRepoMapLite]
- `SymbolExtractor`, `ExtractedSymbol`, `extractTopLevelSymbols` [symbol-extractor.ts:SymbolExtractor]

## Invariants
- The vector-space identity folds model name, revision, dtype, pooling, normalization, and `VECTOR_SPACE_VERSION` into the cache namespace, so configurations that disagree on representation never share stored vectors [embedding-cache.ts:vectorSpaceId]
- Cache entries live under `.alix/embeddings/<label>/<vectorSpaceId>/`; `q8` selects the quantized ONNX weights and `SEMANTIC_EMBEDDER` pins an immutable revision [embedding-cache.ts:SEMANTIC_EMBEDDER], [embedding-cache.ts:EmbeddingCache]
- `toVector` rejects empty and non-finite vectors on every output branch, preventing NaN from reaching `cosineSimilarity` [embedding-cache.ts:toVector]
- `loadCached` treats non-JSON, empty, non-array, or non-finite cache entries as misses [embedding-cache.ts:EmbeddingCache]
- Model loads are serialized and the process-global transformers `env` snapshot is restored in `finally`; offline mode sets `allowRemoteModels=false`, `useFSCache=false`, and `local_files_only=true` [embedding-cache.ts:EmbeddingCache], [embedding-cache.ts:serializeLoad]
- A failed model load memoizes only terminal failures (absent or unresolvable model); transient failures stay retryable and are never cached as vectors [embedding-cache.ts:isRetryableFailure]
- `search()` filters to files with content and scores against that same filtered list, preserving batch alignment [embedding-cache.ts:EmbeddingCache], [embedding-cache.ts:hasContent]
- Semantic and code vector search are optional: `SemanticSearchStage` swallows embedder failures so compilation degrades instead of failing [context-pipeline.ts:SemanticSearchStage]
- Ranking keeps candidates at or above `MIN_SCORE_THRESHOLD` plus the optional pattern-registry bias, and adds dependencies only for matches at or above `DEPENDENCY_THRESHOLD` [context-pipeline.ts:RankingStage]
- Budgeting allocates fixed primary/supporting/test weights with a research-specific split, and the bundle id is a generated `bundle-<uuid>` [context-pipeline.ts:BudgetingStage]
- The dependency graph resolves only relative import specifiers against known paths, with `.ts/.tsx/.js/.jsx` and `index` fallbacks [dependency-graph.ts:buildDependencyGraph]
- `compileContext` caches bundles in memory for `CONTEXT_CACHE_TTL_MS` keyed by task type, task text, and pinned paths [context-compiler.ts:CONTEXT_CACHE_TTL_MS]
- `RepoMapLiteIndexer` re-derives `configFiles`/`docsFiles`/`testFiles`/`sourceFiles` after any filter so index views stay consistent [repomap-lite.ts:RepoMapLiteIndexer]

## Side Effects
- `warm()` reads the repository tree and git history and appends a `context.repo_map_created` event when an `EventLog` and `sessionId` are provided [context-compiler.ts:ContextCompiler]
- `compileContext` appends a `context.bundle_created` event and writes the result into the in-memory bundle cache [context-compiler.ts:ContextCompiler]
- `pinFile` and `unpinFile` append `context.file_pinned`/`context.file_unpinned` events [context-compiler.ts:ContextCompiler]
- `EmbeddingCache` reads and writes JSON vector files on disk under `.alix/embeddings/`, creating the directory recursively [embedding-cache.ts:EmbeddingCache]
- `SemanticSearchStage` persists a semantic search index via `indexFile` and `flush()` [context-pipeline.ts:SemanticSearchStage]
- `readGitActivity` shells out to `git log` (overridable via `runGitLog`) and returns an empty map on failure [git-activity.ts:readGitActivity]
- `buildRepoMapLite` walks the filesystem, honoring `IGNORED_DIRS` and root `.gitignore`, and records a `context.compile` timing phase [repomap-lite.ts:buildRepoMapLite]

## Verification
- Run: `pnpm test`
