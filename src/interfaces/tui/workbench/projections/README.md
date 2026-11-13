# Workbench Projections

## Overview
EventLog-derived, renderer-neutral read models for the Workbench shell. These projections turn runtime events, timelines, and execution traces into immutable agent, task, artifact, diff, and conversation snapshots. They own presentation meaning only; runtime lifecycle truth remains in `AgentSession` and the event log.

## Interface
- `AgentRosterProjection`: `ProjectionBuilder<AgentRosterSnapshot>` with `update`, `snapshot`, and `reset`; tracks live agent state, active tools, owned paths, usage, and progress-based liveness [agent-roster-projection.ts:AgentRosterProjection].
- `TaskProjection`: `ProjectionBuilder<TaskRosterSnapshot>` for delegated-task state, dependencies, blockers, ownership, and queue/running/blocked/waiting counts [task-projection.ts:TaskProjection].
- `ArtifactProjection`: read-only index of inspectable artifacts and subagent results, with bounded previews and correlation ids [artifact-projection.ts:ArtifactProjection].
- `DiffProjection`: groups patch lifecycle events and patch tool results into per-proposal changed-file summaries [diff-projection.ts:DiffProjection].
- `ConversationProjection` and `ConversationProjectionInput`: compose timeline and trace entries into semantic transcript items, preserving source event sequence ranges [conversation-projection.ts:ConversationProjection].
- `projectConversation`, `ConversationCacheInput`, `timelineFingerprint`, and `traceFingerprint`: content-keyed memoization shared by the view-state assembler and scrollback builder [conversation-cache.ts:projectConversation].

## Invariants
- Duplicate events are ignored per projection through a seen-id or seen-sequence set; `reset()` clears both state and deduplication memory [agent-roster-projection.ts:reset], [artifact-projection.ts:reset], [diff-projection.ts:reset], [task-projection.ts:reset].
- Agent and task state use separate rosters; painters must not reconstruct either model from the other [agent-roster-projection.ts:AgentRosterProjection], [task-projection.ts:TaskProjection].
- Agent liveness is progress-based: terminal and stall-exempt states receive no liveness verdict, while active states classify as `healthy`, `warning`, or `stalled` from elapsed progress time [agent-roster-projection.ts:snapshot].
- A tool lifecycle only changes the active tool when its `toolCallId` matches; terminal agent states clear the active tool [agent-roster-projection.ts:update].
- Conversation output is ordered by source sequence, collapses only adjacent duplicate assistant prose, groups consecutive tool lifecycles, and preserves first/last source sequence ranges [conversation-projection.ts:project].
- Conversation cache keys include transcript mode, focused agent, and full-content fingerprints; equal-length content edits still invalidate the cache [conversation-cache.ts:projectConversation], [conversation-cache.ts:timelineFingerprint].
- Artifact previews are bounded to 800 characters and item availability depends on a non-empty URI for artifacts [artifact-projection.ts:ArtifactProjection].
- Snapshots return copied path arrays and usage objects rather than exposing mutable projection maps [agent-roster-projection.ts:snapshot], [task-projection.ts:snapshot].

## Side Effects
- No file, network, or process I/O; projection state is in-memory and reset explicitly.
- `snapshot()` reads the clock when `now` is omitted to calculate liveness and active-tool elapsed time [agent-roster-projection.ts:snapshot].
- `projectConversation` retains one module-level cached snapshot, so repeated frames with identical input avoid reprojection [conversation-cache.ts:projectConversation].

## Verification
- Run: `pnpm test`
