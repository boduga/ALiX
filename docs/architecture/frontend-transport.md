# Frontend Transport Design

## Purpose

The vanilla JavaScript inspector UI should observe and control the same runtime used by the CLI. It must not duplicate agent logic. The local server exposes session events, artifacts, approvals, and limited control actions.

## Transport Choice

MVP uses:

- Server-Sent Events for runtime event streaming.
- HTTP POST endpoints for user actions.

WebSockets can be added later if bidirectional low-latency interaction becomes necessary.

Why SSE first:

- Simple browser API.
- Automatic reconnect.
- Good fit for append-only event streams.
- Easy to debug with plain HTTP.

## Local Server

Default bind:

```text
127.0.0.1:4137
```

The server must bind to localhost by default. Remote access requires explicit config.

## Endpoints

```text
GET  /                 -> inspector UI
GET  /api/sessions     -> list sessions
GET  /api/sessions/:id -> session metadata and current projection
GET  /api/sessions/:id/events -> SSE event stream
GET  /api/artifacts/:artifactId -> artifact content

POST /api/sessions/:id/approvals/:approvalId/approve
POST /api/sessions/:id/approvals/:approvalId/deny
POST /api/sessions/:id/approvals/:approvalId/edit
POST /api/sessions/:id/cancel
POST /api/sessions/:id/rollback
```

## SSE Event Shape

```text
event: alix
id: <event-seq>
data: {"id":"...","seq":42,"type":"tool.completed","payload":{...}}
```

Reconnect behavior:

- Browser sends `Last-Event-ID`.
- Server resumes from the next event sequence.
- If requested event has been compacted into a snapshot, server sends snapshot projection then resumes live events.

## UI Projections

The frontend maintains projections from events:

- Timeline.
- Plan state.
- Approval queue.
- Current patch proposals.
- Changed files.
- Terminal output.
- Verification status.
- Session summary.

The UI projection is disposable. Reloading the page must rebuild it from server state and event replay.

## Artifact Handling

Large payloads stay out of event bodies.

Artifacts include:

- Full command output.
- Diffs.
- Screenshots.
- Raw provider responses.
- Repo maps.

Events reference artifacts by ID.

```ts
type ArtifactRef = {
  artifactId: string;
  kind: "diff" | "command_output" | "screenshot" | "raw_response" | "repo_map";
  path: string;
  sizeBytes: number;
};
```

## Approval Flow

1. Runtime emits `approval.requested`.
2. UI shows approval card.
3. User chooses approve, deny, or edit.
4. UI sends POST action.
5. Runtime appends `approval.resolved`.
6. Agent loop resumes or adjusts.

Approval actions must be idempotent. Re-sending an already resolved approval returns the existing resolution.

## Security

- Bind to `127.0.0.1` by default.
- Generate per-session CSRF token.
- Require token for POST endpoints.
- Never expose environment variables through UI.
- Redact secrets in event payloads before streaming.
- Disable remote origins by default.

## MVP Acceptance Tests

- Opening `/` loads the inspector UI.
- Connecting to `/events` receives existing session events in order.
- Reconnecting with `Last-Event-ID` resumes without duplicate events.
- Approving a pending action appends `approval.resolved`.
- Large command output is served through an artifact endpoint, not embedded in the event.
- Reloading the UI reconstructs timeline, approvals, and verification status.
