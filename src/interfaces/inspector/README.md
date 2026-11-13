# Inspector Read Model

## Overview

Read-side projection layer for the Inspector: it turns a session's raw event
stream (`AlixEvent[]`) into a structured `InspectorSnapshot` (summary, timeline,
diffs, terminal commands, approval/scope decisions, verification checks, token
usage) and a side-by-side `InspectorComparison` between two sessions. It performs
no writes; `session-reader.ts` supplies the events from
`.alix/sessions/<sessionId>/events.jsonl` and the projection folds them into
snapshot state.

## Interface

- `buildInspectorSnapshot(sessionId, events): InspectorSnapshot` — single fold over the event list [projection.ts:buildInspectorSnapshot]
- `compareInspectorSnapshots(left, right): InspectorComparison` — changed-file set difference plus verification status and token delta [projection.ts:compareInspectorSnapshots]
- `InvalidSessionIdError` — thrown for malformed session ids [session-reader.ts:InvalidSessionIdError]
- `isValidSessionId(sessionId): boolean` — must match `/^[A-Za-z0-9][A-Za-z0-9._-]*$/` and must not contain `..` [session-reader.ts:isValidSessionId]
- `assertValidSessionId(sessionId): string` — validates or throws [session-reader.ts:assertValidSessionId]
- `sessionEventsPath(root, sessionId): string` — `<root>/.alix/sessions/<id>/events.jsonl` [session-reader.ts:sessionEventsPath]
- `readSessionEvents(root, sessionId): Promise<AlixEvent[]>` — newline-split JSONL parse; missing file returns `[]` [session-reader.ts:readSessionEvents]
- `readSessionSnapshot(root, sessionId)` and `readSessionComparison(root, left, right)` — read + project [session-reader.ts:readSessionSnapshot]

## Invariants

- Session ids are path-safety filtered: the pattern excludes path separators and `..` is explicitly rejected before any path join [session-reader.ts:isValidSessionId]
- `readSessionEvents` returns `[]` only for `ENOENT`; all other read or parse errors propagate [session-reader.ts:readSessionEvents]
- Snapshot `status` starts `"unknown"` and is set to `"running"` by `session.started`, then to `completed`/`failed` from `session.ended` (any reason other than `"completed"` maps to `"failed"`) [projection.ts:statusForEndedSession]
- Terminal, diff, approval, and verification entries correlate by `toolCallId`; unknown ids are looked up with `findByToolCallId` and skipped when absent [projection.ts:findByToolCallId]
- `patch.rollback_completed` only mutates an already-recorded diff; it never creates one [projection.ts:buildInspectorSnapshot]
- A patch diff keeps `checkpointFiles` when `changedFiles` is empty on a retry of the same tool call [projection.ts:buildInspectorSnapshot]
- `verificationSummary` reports `"none"` for no checks, the single status for one distinct status, and `"mixed"` otherwise [projection.ts:verificationSummary]
- Token cost is computed per `model.usage` event using a fixed provider rate table; unknown providers get zero rates [projection.ts:buildInspectorSnapshot]
- Workflow/graph/node ids are read from `event.meta` (first non-empty value wins) [projection.ts:buildInspectorSnapshot]

## Side Effects

- `readSessionEvents` performs disk reads of `events.jsonl` under the configured root; no writes [session-reader.ts:readSessionEvents]
- Projection is pure in-memory mutation of the freshly built snapshot object; returned snapshots share the original event objects in `timeline` [projection.ts:buildInspectorSnapshot]
- Token cost arithmetic uses hard-coded per-million rates for google, deepseek, openai, anthropic, ollama, and local-llama [projection.ts:buildInspectorSnapshot]

## Verification

- Run: `pnpm test`
