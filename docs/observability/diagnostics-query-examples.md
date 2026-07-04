# Diagnostics Query Examples

> **Last updated:** 2026-07-04
> **Requires:** PR #197 (agent-run execution context) or later

After PR #197, the agent loop creates real `ExecutionContext` values at the run boundary and threads them into every provider call. Diagnostics emitted during agent runs now carry `runId`, `sessionId`, `workflowId`, `providerId`, and `model` — making it possible to answer "which run, agent, session, or provider produced this diagnostic?"

## Before and After

| Before #197 | After #197 |
|-------------|------------|
| Diagnostics were durable and queryable | ✅ Same |
| CLI filters for `--type`, `--boundary`, `--severity` existed | ✅ Same |
| No execution context populated from real runs | ❌ **Fixed** — agent loop creates context automatically |
| Could not filter by `runId` or `sessionId` | ✅ Can now filter by context fields |
| Could not correlate diagnostics to specific agent runs | ✅ Diagnostics include runId, sessionId, workflowId, providerId, model |

## Sample Diagnostic Event (after #197)

When a provider timeout occurs during an agent run, the JSONL event looks like this:

```json
{
  "id": "diag-abc123-0001",
  "timestamp": "2026-07-04T12:00:00.000Z",
  "type": "runtime",
  "domain": "runtime",
  "boundary": "timeout",
  "operation": "provider.complete:anthropic",
  "event": "timed out after 180000ms",
  "severity": "error",
  "timeoutMs": 180000,
  "context": {
    "runId": "run-a1b2c3d4",
    "sessionId": "sess-20260704-abc",
    "workflowId": "wf-xyz-001",
    "providerId": "anthropic",
    "model": "claude-opus-4-8"
  }
}
```

Contract validation diagnostics include the same context:

```json
{
  "id": "diag-def456-0002",
  "timestamp": "2026-07-04T12:00:01.000Z",
  "type": "contract",
  "domain": "provider",
  "boundary": "complete.response",
  "entityId": "tc-42",
  "event": "NormalizedResponse validation failed: text is wrong type",
  "severity": "error",
  "context": {
    "runId": "run-a1b2c3d4",
    "sessionId": "sess-20260704-abc",
    "workflowId": "wf-xyz-001",
    "providerId": "anthropic",
    "model": "claude-opus-4-8"
  }
}
```

## CLI Examples

### List recent diagnostics

```bash
alix observability diagnostics list --limit 10
```

Output:

```
❌ [runtime] timeout
   Time:  2026-07-04 12:00:00
   Op:    provider.complete:anthropic
   Run:   run-a1b2c3d4
   Agent: coder
   Event: timed out after 180000ms

Total: 5 (3 errors, 2 warnings)
```

### Filter by run

```bash
alix observability diagnostics list --context.runId run-a1b2c3d4
```

Shows all diagnostics emitted during a specific agent run — useful for debugging a single task execution.

### Filter by session

```bash
alix observability diagnostics list --context.sessionId sess-20260704-abc
```

Shows all diagnostics for a specific session — useful for correlating across multiple runs in the same session.

### Filter by agent

```bash
alix observability diagnostics list --context.agentId coder
```

Shows diagnostics for a specific agent. Currently `agentId` is not populated by the agent loop (PR #197 sets `runId`, `sessionId`, `workflowId`, `providerId`, `model`). `agentId` propagation is planned as a follow-up.

### Filter by workflow

```bash
alix observability diagnostics list --context.workflowId wf-xyz-001
```

Shows all diagnostics within a specific workflow.

### Filter by provider/model

The CLI does not yet support `--context.providerId` or `--context.model` filters directly, but you can use `--json` output and pipe to `jq`:

```bash
alix observability diagnostics list --json | jq '.[] | select(.context.providerId == "anthropic")'
```

### Show only runtime diagnostics

```bash
alix observability diagnostics list --type runtime
```

### Show only contract diagnostics

```bash
alix observability diagnostics list --type contract
```

### Show only errors

```bash
alix observability diagnostics list --severity error
```

### Show only timeout events

```bash
alix observability diagnostics list --boundary timeout
```

### JSON output for scripting

```bash
alix observability diagnostics list --json --limit 100 > diagnostics.json
```

### Combined example

```bash
alix observability diagnostics list \
  --type runtime \
  --severity error \
  --context.runId run-a1b2c3d4 \
  --limit 20 \
  --json
```

Shows the last 20 runtime errors from a specific run, as JSON.

## Current Limitations

- **`agentId`** is defined and supported in the CLI (`--context.agentId`) but not yet populated by the agent loop. Diagnostics will include `agentId` once the agent delegates runs to subagents.
- **`parentRunId`** is defined on `ExecutionContext` but not yet populated. Subagent/tool call lineage is planned for PR #199.
- **Provider/model CLI filters** (`--context.providerId`, `--context.model`) are not yet wired as named CLI flags. Use `--json | jq` as a workaround.
- **No dashboard** — diagnostics query is CLI-only.
- **No alerting** — diagnostics are log-based and file-based only.

## Related

- [Diagnostics Telemetry Design](../architecture/decisions/2026-07-03-diagnostics-telemetry-design.md)
- [Execution Context Design](../architecture/decisions/2026-07-03-execution-context-correlation-design.md)
- [Observability & Diagnostics Milestone](../architecture/decisions/2026-07-03-observability-diagnostics-milestone.md)
- [`alix observability diagnostics list` CLI reference](#) <!-- link to CLI docs when added -->
