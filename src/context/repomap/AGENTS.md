# DOX — RepoMap and Embedding Context

## Purpose

Builds the repository map and the semantically-ranked context bundle that agent
sessions receive: file inventory, dependency graph, symbol extraction, and
embedding-based semantic/code search.

## Ownership

| Path | Responsibility |
|------|----------------|
| `context-compiler.ts` | `ContextCompiler` — `warm()`, `buildEmbeddings()`, `compileContext()`; owns the semantic and code embedders |
| `context-pipeline.ts` | Pipeline stages: `RepoMapStage`, `SemanticSearchStage`, `RankingStage`, `BudgetingStage` |
| `embedding-cache.ts` | `EmbeddingCache` — model lifecycle, vector production, on-disk cache, cosine search, guardrails |
| `context-ranker.ts`, `repomap-lite.ts`, `dependency-graph.ts`, `symbol-extractor.ts`, `git-activity.ts` | Ranking heuristics, lightweight map, import graph, symbol extraction, recency boost |

## Local Contracts

- **Vector space is part of the cache key.** `EmbeddingCache` stores under
  `.alix/embeddings/<label>/<vectorSpaceId>/`, where `vectorSpaceId` hashes
  model name, revision, dtype, pooling, normalisation and
  `VECTOR_SPACE_VERSION`. Never key a vector by text alone: two runtimes that
  disagree on representation must not share entries. Changing pooling,
  normalisation or the meaning of a produced vector means bumping
  `VECTOR_SPACE_VERSION`.
- **`dtype` is load-bearing, not cosmetic.** `q8` selects
  `onnx/model_quantized.onnx`, `fp32` selects `onnx/model.onnx`. The two produce
  different vectors for the same text (cosine ≈ 0.99). ALiX pins `q8` because
  that is the representation it has always produced; `@xenova/transformers`
  defaulted to quantised, `@huggingface/transformers` defaults to `fp32`.
  Swapping the default silently changes every vector, so keep the explicit
  `dtype`.
- **Revisions are pinned.** `SEMANTIC_EMBEDDER.revision` is the immutable
  Hugging Face commit for the model. A re-tagged repo must not change vectors
  behind an unchanged model name.
- **CPU only.** The pipeline is always constructed with `device: "cpu"`. ALiX
  never selects a GPU execution provider, and the ONNX GPU postinstall download
  stays denied in `pnpm-workspace.yaml`.
- **Offline is strict, and the runtime's global settings are restored.** When a
  model path is configured, `env.allowRemoteModels = false`,
  `env.useFSCache = false` and `local_files_only: true` apply for the load.
  Disabling the filesystem cache is required: with it enabled the library
  satisfies a model absent from `modelPath` from its own cache inside
  `node_modules`, turning an offline run into an accidental online one. All
  three `env` fields are process-global and re-read after `await` points, so
  loads are serialised through `serializeLoad` and the snapshot is restored in
  `finally`. Never leave them mutated: with `useFSCache = false` a download
  cannot be returned at all (`Unable to get model file path or buffer`), and
  without serialisation two embedders with different roots corrupt each other.
- **Model failures are actionable; terminal ones are not retried.** A failed
  load raises `EmbeddingUnavailableError` with a remediation hint. A failure
  that proves the model absent or unresolvable is memoised, because retrying
  only repeats a failed resolve (and an outbound 404 for a model id that does
  not exist upstream). Transient load failures remain retryable. Failures are
  never cached as vectors.
- **Output is validated in every branch.** `toVector` rejects empty and
  non-finite vectors for Tensor, array and plain outputs alike. Validating only
  a fallback branch would let NaN reach `cosineSimilarity`, where it compares
  false against everything and silently yields an arbitrary ranking order.
- **Cache entries are validated on read.** Non-JSON, empty, non-array, or
  non-finite entries are treated as misses. A truncated vector must never reach
  `cosineSimilarity`.
- **Semantic search is optional.** `SemanticSearchStage` swallows embedder
  failures so context compilation degrades rather than failing; callers that
  need certainty must call the embedder directly.
- **`search()` skips contentless files without losing alignment.** It filters
  the batch to files with content and scores those vectors against those files;
  indexing the original batch after filtering mis-attributes every score.
  Pinned by `tests/repomap/embedding-search-sparse-batch.test.ts`.
- **`microsoft/codebert-base` has no ONNX artifacts** and cannot run on this
  runtime. `CODE_EMBEDDER` exists for API compatibility only; the context
  compiler does not construct it. `RankingStage` defaults an absent code score
  to 0, which is the same contribution the always-failing embedder made.

## Work Guidance

- Embedding changes need three lanes: deterministic tests with a stubbed
  embedder (default suite, no network), an opt-in real-inference suite, and a
  documented evidence record under `docs/security/`.
- Never commit model weights. Provision them and point
  `ALIX_EMBEDDING_MODEL_PATH` at the directory, laid out as
  `<path>/<modelName>/…`.
- When changing any representation-affecting setting, bump
  `VECTOR_SPACE_VERSION` and state the expected cache invalidation.

## Verification

- `tests/repomap/embedding-cache-deterministic.test.ts` — keys, vector-space
  isolation, corruption handling, output validation, batching, ranking, terminal
  failure memoisation; no network, no ONNX runtime. Cache-hit and corruption
  tests assert on the real `loadCached`. Verified non-vacuous by sabotage:
  forcing `loadCached` to always miss fails 4 tests, disabling the retry guard
  fails 1, and removing finite-value validation fails 3.
- `tests/repomap/embedding-cache-cpu.test.ts` — real CPU inference; skips unless
  `ALIX_EMBEDDING_MODEL_PATH` is provisioned. Asserts 384-dim, unit norm, finite
  values, determinism and ranking.
- `tests/repomap/embedding-cache.test.ts` — model-backed suite; requires network
  or a provisioned model.
- `tests/repomap/embedding-search-sparse-batch.test.ts` — batch alignment.
- Evidence and remaining risk:
  `docs/security/2026-10-31-embedding-migration-qualification.md`.

## Child DOX Index

None.
