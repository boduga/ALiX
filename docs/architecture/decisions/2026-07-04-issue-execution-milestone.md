# Autonomous Issue Execution — Milestone Checkpoint

**Date:** 2026-07-04
**PRs:** #201–#205
**Status:** Complete — design, skeleton, evidence, dry-run, issue commenting.

## Summary

Delivered the first end-user capability built on the 5-phase foundation: autonomous GitHub issue execution. The `alix issue run` command fetches an issue, checks eligibility, creates execution context with diagnostics attribution, runs the agent, captures evidence, and optionally posts a structured comment to the issue — all without modifying files in dry-run mode.

## Delivered PRs

| PR | Title | Scope |
|----|-------|-------|
| #201 | docs(agent): design autonomous issue execution loop | Design doc — 7-stage lifecycle, safety gates, foundation mapping |
| #202 | feat(agent): add issue execution run skeleton | `alix issue run` CLI command, eligibility checks, context creation, runTask call, summary |
| #203 | feat(agent): add structured evidence events to issue execution | EventLog for lifecycle events: fetch, eligibility, context, run, completion |
| #204 | feat(agent): add dry-run mode to issue execution | `--dry-run` flag, read-only prompt, summary indication |
| #205 | feat(agent): add GitHub issue comment with run summary | `--comment` flag, structured markdown comment via `gh issue comment` |

## CLI usage

```bash
# Live execution (mutates files if agent makes changes)
alix issue run --repo owner/repo --issue 123

# Dry-run preview (no file mutations)
alix issue run --repo owner/repo --issue 123 --dry-run

# Post structured comment to the issue
alix issue run --repo owner/repo --issue 123 --comment
alix issue run --repo owner/repo --issue 123 --dry-run --comment
```

## Issue execution lifecycle

```
Issue intake (gh issue view)
  → Fetch: title, body, state, labels, URL
  → Eligibility: open, allowed label, not blocked
  → Context: runId, sessionId, workflowId
  → Agent runTask with issue-derived prompt (+ read-only directive if --dry-run)
  → Evidence events for every stage
  → Structured summary + optional GitHub comment
```

## Safety gates

| Gate | Enforced | Since |
|------|----------|-------|
| Issue must be open | ✅ | #202 |
| Must have allowed label | ✅ | #202 |
| Must not have blocked label | ✅ | #202 |
| Dry-run mode (no file changes) | ✅ | #204 |
| Comment posting is opt-in (`--comment`) | ✅ | #205 |
| Comment failure is non-blocking | ✅ | #205 |

## Foundation usage

| Foundation | Used by | Delivered in |
|------------|---------|-------------|
| Effect Schema contracts | Provider validation during agent run | Phase 1 |
| `withTimeout` | External call protection | Phase 2 |
| `DiagnosticSink` + event store | Failure capture | Phase 3 |
| `ExecutionContext` | Run/session/workflow correlation | Phase 4 |
| `parentRunId` | Run lineage | Phase 5 |
| `runTask` | Agent execution | Core |
| EventLog | Lifecycle evidence events | Core |

## Files changed

```
src/cli.ts                                          — issue run command dispatch
src/cli/commands/issue-run-handler.ts               — full handler (~230 lines)
tests/cli/commands/issue-run-handler.test.ts         — 13 tests
docs/architecture/decisions/2026-07-04-autonomous-issue-execution-loop-design.md
```

## Non-Goals

- **No automated PR creation** — deferred to follow-up phase
- **No scheduler/cron** — CLI-triggered only
- **No multi-repo execution** — single repo per invocation
- **No dashboard** — CLI-only
- **No `agentId` population** — context field exists but not set
- **No parentRunId from callers** — field exists but callers haven't been updated

## Verification

```bash
pnpm build
pnpm typecheck
pnpm test:vitest
```

All clean: 2669+ tests, 256+ files, 0 type errors.
