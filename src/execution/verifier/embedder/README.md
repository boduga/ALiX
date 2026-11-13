# Verifier Embedder

## Overview
Provides a local SQLite store for resolved verification failures, an exemplar matcher that combines stored failure scores with task/file/error context overlap, and a deterministic pseudo-embedding scorer for verification confidence. The current matcher and store are heuristic: the embedding search path does not use vector similarity yet, and the matcher passes a placeholder zero vector while rescoring stored rows by text and context.

## Interface
- `VerificationEmbedding`, `FailureRecord`, `EmbedderConfig`, `SimilarityResult`, and `EmbedderOptions`: persistence, scoring, and matcher DTOs [types.ts:VerificationEmbedding], [types.ts:FailureRecord], [types.ts:EmbedderConfig], [types.ts:SimilarityResult], [types.ts:EmbedderOptions].
- `FailureDatabase`: opens a `better-sqlite3` database and exposes `init`, `listTables`, `insertFailure`, `getFailure`, `searchByEmbedding`, `countFailures`, and `close` [failure-db.ts:FailureDatabase].
- `FailureDatabaseError`: wraps every database operation failure with an operation-specific message and optional cause [failure-db.ts:FailureDatabaseError].
- `ExemplarMatcher.findSimilar`: searches stored failures, rescored by context overlap, and returns the top-K results above a threshold [exemplar.ts:findSimilar].
- `ExemplarMatcher.recordResolution`: validates a failure id, loads the record, and rewrites it with the supplied resolution and current time [exemplar.ts:recordResolution].
- `QueryContext` and `MatchOptions`: query task/errors/files plus optional `threshold` and `topK` controls [exemplar.ts:QueryContext], [exemplar.ts:MatchOptions].
- `EmbeddingScorer`: validates positive dimensions; creates deterministic embeddings; computes cosine similarity; scores verification context; and assembles `VerificationEmbedding` records [scorer.ts:EmbeddingScorer].
- `VerificationContext` and `ScoringResult`: scoring inputs and the four-factor confidence result [scorer.ts:VerificationContext], [scorer.ts:ScoringResult].

## Invariants
- `init()` creates the `failure_records` and `embeddings` tables plus `idx_session` and `idx_resolved` indexes idempotently [failure-db.ts:init].
- `insertFailure` is an upsert keyed by `id` and stores `fileChanges` as JSON; `getFailure` restores it with an empty-array fallback [failure-db.ts:insertFailure], [failure-db.ts:getFailure].
- `searchByEmbedding` currently ignores its `_query` vector, scans at most 100 rows whose resolution is non-null, scores fixed text patterns, and caps scores at 1 [failure-db.ts:searchByEmbedding].
- `findSimilar` defaults to `threshold = 0.5` and `topK = 5`, requests `topK * 2` rows, and combines the stored score with context similarity at 50/50 [exemplar.ts:findSimilar].
- Context similarity weights task overlap at 40%, file overlap at 30%, and error matching at 30%, then normalizes by the accumulated weights [exemplar.ts:calculateContextSimilarity].
- `recordResolution` rejects an empty id and rejects an id with no stored record; successful updates preserve the other record fields [exemplar.ts:recordResolution].
- `EmbeddingScorer` rejects non-positive dimensions at construction [scorer.ts:EmbeddingScorer].
- `createEmbedding` is deterministic for the same task type and file list: it seeds an LCG from hashes, fills the vector, and normalizes it [scorer.ts:createEmbedding].
- `cosineSimilarity` returns zero for mismatched vector lengths and assumes the caller supplies normalized vectors [scorer.ts:cosineSimilarity].
- `scoreVerification` weights file complexity at 20%, error density at 30%, tool diversity at 20%, and baseline confidence at 30%, then clamps the result to 0..1 [scorer.ts:scoreVerification].
- `historicalConfidence` is currently fixed at `0.5` pending exemplar integration [scorer.ts:scoreVerification].

## Side Effects
- Constructing `FailureDatabase` opens the SQLite file at `dbPath`; `init()` executes DDL and index creation [failure-db.ts:FailureDatabase], [failure-db.ts:init].
- `insertFailure`, `recordResolution`, and `close` mutate or release the database resource [failure-db.ts:insertFailure], [exemplar.ts:recordResolution], [failure-db.ts:close].
- `createVerificationEmbedding` generates an id from `Date.now()` and `Math.random()` and records the same current time in `createdAt` [scorer.ts:createVerificationEmbedding].
- These modules make no network calls; the configured `provider` and `modelName` are declared but unused by this implementation [types.ts:EmbedderConfig].

## Verification
- Run: `pnpm test`
