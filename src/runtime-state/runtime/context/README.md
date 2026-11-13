# Runtime Context Builder

## Overview
Turns an immutable skill, a compact `ExecutionState` projection, the latest
observation, bounded evidence, and the allowed tool surface into a
constant-size prompt (`P + Σ + O + E + Tools`). Alongside it lives
`ContextRetrieval`, a read-only, file-authoritative façade over the EventLog
JSONL index and `ExecutionStateStore` checkpoints.

## Interface
- `buildExecutionContext(skill, state, observation, evidence, tools, opts?)` —
  pure mechanical builder returning `BuiltContext` (prompt, sections,
  metadata). [context-builder.ts:buildExecutionContext]
- `renderExecutionState` — compact `<execution_state>` XML-like block, never
  raw `state.json`. [context-builder.ts:renderExecutionState]
- `renderSkill`, `renderObservation`, `renderEvidence`, `renderTools` —
  individually callable renderers for each prompt section.
  [context-builder.ts:renderObservation]
- `getBuilderCaps` — model-aware caps: small-model defaults below a 32k window,
  frontier caps at or above it. [context-builder.ts:getBuilderCaps]
- `toCandidateItems` — maps the built sections onto the six assembler tiers,
  with `execution_state` protected as `current_execution_state`.
  [context-builder.ts:toCandidateItems]
- `ContextRetrieval` — sync/async lookups by execution id, evidence id, seq or
  seq range, latest observation, and checkpoint. [retrieval.ts:ContextRetrieval]
- Standalone helpers `queryEvidenceById`, `queryHistorySlice`,
  `queryEventsByExecutionId`, `queryCheckpoint`. [retrieval.ts:queryEvidenceById]

## Invariants
- The builder is pure: no I/O, no clock-derived content, and no token
  budgeting; `countTokens` ownership stays with the assembler.
  [context-builder.ts:buildExecutionContext]
- History is opt-in only; absent `opts.history` means no `<history>` section.
  [context-builder.ts:buildExecutionContext]
- Assembly order is skill, state, tools, observation, evidence, then optional
  history. [context-builder.ts:buildExecutionContext]
- State sub-lists are capped at 20 entries each (pending, artifacts,
  constraints, capabilities) and report the elided remainder.
  [context-builder.ts:MAX_PENDING_RENDER]
- Observation is hard-capped; a large payload is replaced by a preview plus an
  `...[truncated N chars; full output in evidence ref: …]` marker and
  `truncated="true"`. [context-builder.ts:renderObservation]
- Evidence ordering is score-descending when any item carries a score, else
  source order; the top-K is bounded by `MAX_EVIDENCE_ITEMS` and the char
  budget drops the tail first, never below `MIN_EVIDENCE_ITEMS`.
  [context-builder.ts:renderEvidence]
- `renderTools` suppresses tools matched by `deny_tool`, `blocked_capability`,
  or `blocked_tool`, keeping prompt and tool surface in agreement.
  [context-builder.ts:renderTools]
- `buildExecutionContext` throws on an invalid state lacking a string
  `executionId`. [context-builder.ts:requireValidState]
- Retrieval is fail-closed: missing files, malformed JSONL lines, and invalid
  arguments yield empty results or `undefined`, never a throw.
  [retrieval.ts:readEventsSync]
- Retrieval caches by EventLog file mtime and re-reads when the mtime moves;
  the file stays authoritative. [retrieval.ts:readAllSync]
- A checkpoint prefers the stored snapshot but rebuilds deterministically from
  the authoritative EventLog when the snapshot is absent or mismatched.
  [retrieval.ts:getCheckpointSync]
- Execution-id lookups treat a session directory whose basename matches the
  queried id as the index itself, otherwise filter by payload or session id and
  fall back to the whole file. [retrieval.ts:getEventsByExecutionIdSync]

## Side Effects
- `ContextRetrieval` reads `.alix/sessions/<executionId>/events.jsonl` from
  disk and reads `ExecutionStateStore` snapshots; it performs no writes.
  [retrieval.ts:ContextRetrieval]
- `primeCache` and `readAllSync` stat and read the EventLog file, caching the
  parsed events in memory. [retrieval.ts:primeCache]
- Checkpoint reads may stat or read the session event file when rebuilding a
  projection. [retrieval.ts:getCheckpoint]
- Prompt construction allocates and joins strings only; no external effects.
  [context-builder.ts:buildExecutionContext]

## Verification
- Run: `pnpm test`
