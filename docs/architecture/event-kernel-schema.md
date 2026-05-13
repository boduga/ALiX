# Event Kernel Schema

## Purpose

The event kernel is the ALiX backbone. It stores every meaningful action and observation as an immutable append-only event stream so the CLI, UI, verifier, approvals, replay, and future subagents share one source of truth.

## Design Goals

- Append-only JSONL event log.
- Deterministic replay into session state.
- Durable recovery after process crashes.
- Stable event versioning.
- Human-readable enough for debugging.
- Machine-readable enough for UI, automation, and tests.

## Core Concepts

```text
Session
  -> Run
    -> Event Stream
      -> Derived Session State
      -> UI Projection
      -> Audit Trail
```

The log is authoritative. Any mutable session state is a projection rebuilt from events.

## Storage Layout

```text
.alix/
  sessions/
    <session-id>/
      events.jsonl
      snapshots/
        <event-seq>.json
      artifacts/
        diffs/
        command-output/
        screenshots/
```

`events.jsonl` is append-only. Snapshots are optional acceleration artifacts and can be rebuilt.

## Base Event Type

```ts
type AlixEvent<TType extends string = string, TPayload = unknown> = {
  id: string;
  seq: number;
  version: 1;
  sessionId: string;
  runId?: string;
  parentEventId?: string;
  timestamp: string;
  type: TType;
  actor: "user" | "agent" | "system" | "tool" | "policy" | "verifier";
  payload: TPayload;
};
```

Rules:

- `seq` is strictly increasing within a session.
- `id` is globally unique.
- `timestamp` is ISO 8601.
- Events are never modified after append.
- Corrections are represented by new events.

## Required Event Types

### Session Events

```ts
type SessionStartedPayload = {
  cwd: string;
  cliVersion: string;
  configHash: string;
};

type SessionEndedPayload = {
  reason: "completed" | "cancelled" | "failed" | "interrupted";
  summary: string;
};
```

Events:

- `session.started`
- `session.ended`
- `session.snapshot_created`

### User And Agent Events

```ts
type UserMessagePayload = {
  text: string;
  attachments: Array<{ kind: string; path?: string; url?: string }>;
};

type AgentMessagePayload = {
  text: string;
  visibility: "user" | "internal_summary";
};

type PlanProposedPayload = {
  goal: string;
  steps: Array<{ id: string; text: string; status: "pending" | "in_progress" | "done" }>;
  requiresApproval: boolean;
};
```

Events:

- `user.message`
- `agent.message`
- `agent.thought_summary`
- `agent.plan_proposed`
- `agent.plan_updated`

### Context Events

```ts
type ContextBundleCreatedPayload = {
  bundleId: string;
  taskType: string;
  usedTokens: number;
  maxTokens: number;
  primaryFiles: ContextItemRef[];
  supportingFiles: ContextItemRef[];
  omittedCount: number;
};

type ContextItemRef = {
  path: string;
  kind: string;
  score: number;
  reason: string;
};
```

Events:

- `context.repo_map_created`
- `context.bundle_created`
- `context.file_pinned`
- `context.file_unpinned`

### Tool Events

```ts
type ToolRequestPayload = {
  toolCallId: string;
  toolName: string;
  capability: string;
  argsPreview: unknown;
};

type ToolResultPayload = {
  toolCallId: string;
  status: "success" | "error" | "cancelled";
  outputRef?: string;
  outputPreview?: string;
  error?: string;
  durationMs: number;
};
```

Events:

- `tool.requested`
- `tool.started`
- `tool.output`
- `tool.completed`
- `tool.failed`

Large output is written to `artifacts/command-output/` and referenced by path.

### Policy Events

```ts
type PolicyDecisionPayload = {
  toolCallId: string;
  capability: string;
  decision: "allow" | "ask" | "deny";
  reason: string;
  matchedRuleId?: string;
};

type ApprovalRequestedPayload = {
  approvalId: string;
  toolCallId?: string;
  patchProposalId?: string;
  prompt: string;
  choices: Array<"approve" | "deny" | "edit">;
};
```

Events:

- `policy.decision`
- `approval.requested`
- `approval.resolved`

### Patch Events

```ts
type PatchProposalPayload = {
  proposalId: string;
  format: "structured_patch" | "unified_diff" | "search_replace" | "full_file";
  provider: string;
  model: string;
  files: Array<{ path: string; operation: string; preimageHash?: string }>;
  requiresApproval: boolean;
};

type PatchAppliedPayload = {
  proposalId: string;
  checkpointId: string;
  changedFiles: string[];
  diffRef: string;
};
```

Events:

- `patch.proposed`
- `patch.parsed`
- `patch.rejected`
- `patch.checkpoint_created`
- `patch.applied`
- `patch.rolled_back`

### Verification Events

```ts
type VerificationPlanPayload = {
  planId: string;
  checks: Array<{ id: string; command: string; reason: string; required: boolean }>;
};

type VerificationResultPayload = {
  planId: string;
  status: "passed" | "failed" | "partial" | "not_run";
  residualRisk: string[];
};
```

Events:

- `verification.plan_created`
- `verification.check_started`
- `verification.check_output`
- `verification.check_finished`
- `verification.finished`

## Replay Semantics

Replay reads events in `seq` order and produces:

- Current plan.
- Current approval queue.
- Current patch state.
- Current verifier state.
- Current session summary.
- UI timeline projection.

Replay must be idempotent. Running it twice over the same events yields the same state.

## Snapshot Semantics

Snapshots are optional derived state:

```ts
type SessionSnapshot = {
  sessionId: string;
  throughSeq: number;
  createdAt: string;
  state: DerivedSessionState;
};
```

On startup:

1. Load newest snapshot if available.
2. Replay events after `throughSeq`.
3. If snapshot is invalid, replay from event 1.

## Failure Recovery

- Append events atomically.
- If the last JSONL line is corrupt, ignore only that line and emit `session.recovery_warning`.
- Tool processes must write output incrementally so partial output is visible after crashes.
- An approval that was pending before crash remains pending after replay.

## MVP Acceptance Tests

- Appending three events produces `seq` values `1`, `2`, `3`.
- Replaying a session with a plan, approval, and approval resolution produces an empty approval queue.
- A patch proposal and patch applied event reconstruct the changed-files list.
- A corrupt final JSONL line does not prevent loading earlier events.
- Reloading the local UI from `events.jsonl` reconstructs the same timeline as the CLI saw.
