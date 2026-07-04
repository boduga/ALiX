# Autonomous Issue Execution Loop — Design

**Date:** 2026-07-04
**Status:** Design — implementation deferred.

## Context

Phases #160–#200 (41 PRs) delivered the ALiX foundation: typed contracts, runtime hardening, durable diagnostics, execution context, and real agent-run attribution. Phase 6 should use that foundation to deliver an end-user capability: turning a GitHub issue into an attributable agent run with evidence, diagnostics, execution context, and a proposed PR path.

## Issue Execution Lifecycle

```
Issue intake → eligibility checks → planning → agent run → evidence capture → completion summary → optional PR
```

### Stage 1: Issue intake

A GitHub issue is identified via issue number. The system fetches:
- Issue body, title, labels, milestone
- Repository metadata (default branch, allowed labels, configured paths)
- Acceptance criteria (from issue body or labels)

### Stage 2: Eligibility checks

Before any work begins:
- Issue has at least one allowed label matching the configured execution policy
- Repository is in the allowed repositories list
- Issue is not already being executed (dedup check)
- Required secrets (GitHub token) are present
- Max concurrent executions not exceeded

### Stage 3: Planning

Using the existing skill/planning infrastructure:
- Classify the issue (bug, feature, chore, docs, etc.)
- Determine affected files or areas
- Estimate scope (small/medium/large)
- Create an execution plan as a `StrategicPlan` or lightweight step list

### Stage 4: Agent run

A full agent run executes the plan:
- `runTask()` is called with an autonomous execution prompt
- `ExecutionContext` is created with:
  - `runId` — unique run identifier
  - `sessionId` — persistent session
  - `workflowId` — issue execution workflow
  - `agentId` — "autonomous-issue-agent" or the configured agent role
  - `providerId`, `model` — the configured LLM
  - `parentRunId` — if this is a sub-delegation
- All existing foundations apply:
  - Effect Schema contracts validate at provider/planning/proposal boundaries
  - `withTimeout`/`withRetry` protect external calls
  - `DiagnosticSink` captures failures via the event store
  - `consoleSink` keeps logs visible

### Stage 5: Evidence capture

As the agent runs, evidence is preserved:
- Tool calls and results → existing evidence event log
- Plan steps → existing planning store
- Proposals (if changes needed) → existing proposal store
- Diagnostics (timeouts, errors, validation failures) → existing diagnostic event store
- All events carry the same `runId` for correlation

### Stage 6: Completion summary

When the agent finishes:
- Summarize what was attempted, what succeeded, what failed
- List changed files (planned vs actual)
- List diagnostics (timeouts, retries, errors, warnings)
- Classify outcome: completed, completed_with_issues, failed, blocked

### Stage 7: Optional PR creation

If the run produced file changes:
- Create a branch with changes
- Create a pull request referencing the issue
- Add the issue execution summary as the PR body
- Apply configured labels to the PR
- Do not merge without human approval (safety gate)

## Required inputs

| Input | Source | Required |
|--------|--------|----------|
| Repository | Config or argument | Yes |
| Issue number | Config or argument | Yes |
| Allowed labels | Config (list) | Yes |
| GitHub token | Secret / env | Yes |
| Max files changed | Config | Optional (default: 10) |
| Max runtime | Config | Optional (default: 300s) |
| Agent role/behavior | Config | Optional (default: "worker") |

## Outputs

| Output | Format | Destination |
|--------|--------|-------------|
| Execution plan | Structured plan | Planning store |
| Agent events | Event log | Event log |
| Diagnostic events | JSONL | Diagnostic event store |
| Changed files summary | Structured | CLI stdout, PR body |
| Issue comment | Markdown | GitHub issue |
| Pull request | Markdown + diff | GitHub |

## Safety gates

| Gate | Default | Enforcement |
|------|---------|-------------|
| Allowed labels | `["bug", "feature", "chore"]` | Pre-execution check |
| Allowed repositories | `[]` (must be configured) | Pre-execution check |
| Max files changed | 10 | Post-execution gate |
| Max runtime | 300s | Enforcement via agent loop timeout |
| No secrets exposure | Scan tool outputs | Redact in tool executor |
| No destructive commands | Block `rm -rf`, `DROP TABLE`, etc. | Shell policy |
| Human approval before merge | Required | Approval gate |

## Foundation usage

| Foundation | Used for | Delivered in |
|------------|----------|-------------|
| Effect Schema contracts | Provider/planning/proposal validation | Phase 1 |
| `withTimeout` | External call protection | Phase 2 |
| `withRetry` | Idempotent retries | Phase 2 |
| `DiagnosticSink` + event store | Failure capture | Phase 3 |
| `ExecutionContext` | Run/session/workflow correlation | Phase 4 |
| `parentRunId` | Subagent/skill delegation lineage | Phase 5 |
| `alix observability diagnostics list` | Post-run diagnostics query | Phase 3 |

## Non-Goals

- **No fully autonomous merge** — human approval required before merge
- **No broad execution scheduler** — no cron, no event-driven trigger
- **No multi-repo execution** — single repo per run
- **No dashboard** — CLI-only
- **No OpenTelemetry** — existing diagnostics store is sufficient
- **No orchestration rewrite** — uses `runTask()` and existing agent loop

## Recommended implementation order

| Step | Title | Scope |
|------|-------|-------|
| 1 | `feat(agent): add issue execution run skeleton` | CLI command that fetches issue, checks eligibility, creates run context, calls `runTask`, reports summary |
| 2 | `feat(agent): add issue execution evidence capture` | Structured event logging for issue execution stages |
| 3 | `feat(agent): add issue execution PR creation` | Branch + PR creation from changed files |
| 4 | `docs(agent): record issue execution milestone` | Checkpoint doc |

## Verification (for implementation PRs)

```bash
pnpm build
pnpm typecheck
pnpm test:vitest
```
