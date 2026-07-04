# Issue-to-PR Proposal Loop — Design

**Date:** 2026-07-04
**Status:** Design — implementation deferred.

## Context

Phases #160–#206 (47 PRs) delivered contracts, runtime hardening, observability, execution context, agent-loop context, and autonomous issue execution with evidence, dry-run mode, and GitHub issue commenting. Phase 7 adds controlled patch execution and PR proposal without autonomous merge.

## Issue-to-PR Lifecycle

```
Issue intake → eligibility → context → plan → patch proposal
  → working tree changes → changed-files summary → verification
  → evidence capture → draft PR → issue comment (optional)
```

### Stage 1: Issue intake (from Phase 6)

Same as #202: fetch issue via `gh issue view`, extract title, body, labels, state, URL. Reuse existing eligibility checks from `checkEligibility()`.

### Stage 2: Eligibility (from Phase 6)

Same gates as #202: issue must be open, have an allowed label, not have a blocked label.

### Stage 3: Execution context (from Phase 6)

Same as #202–#203: `ExecutionContext` with `runId`, `sessionId`, `workflowId`. Evidence events for each stage.

### Stage 4: Plan generation (NEW)

Before executing changes, the agent produces a structured plan:
- Files to modify (paths)
- Nature of each change (create, edit, delete)
- Estimated impact (small, medium, large)
- Verification steps needed (build, typecheck, tests)

The plan is captured as evidence. In `--dry-run` mode, execution stops here.

### Stage 5: Patch proposal (NEW)

The agent creates file patches. Each patch has:
- File path
- Original content hash
- New content
- Diff summary (lines added/removed)

Patches are captured as evidence but may not be applied yet — this is a PREVIEW.

### Stage 6: Working tree changes (APPLY only)

When changes are applied:
- Files are written to the working tree
- No commits are made
- Working tree state is captured

Guardrails checked before writing:
- Max files changed (default: 10)
- Allowed file paths (must be within workspace)
- Blocked file paths (no `.env`, `.git/config`, secrets)
- Max patch size (default: 500 lines)
- No file deletes outside allowed scope

### Stage 7: Changed-files summary (NEW)

After changes, the handler prints:
- Files changed (created, modified, deleted)
- Lines added/removed per file
- Total diff stats
- Guardrail compliance

### Stage 8: Verification (NEW)

Commands run after changes:
- `pnpm build` (or equivalent)
- `pnpm typecheck`
- `pnpm test:vitest` (or equivalent)
- Custom verification commands from config

Results captured as evidence. Verification failure blocks PR creation (unless `--force` is passed).

### Stage 9: Evidence capture (from Phase 6)

Events emitted for every stage: plan_generated, patches_created, changes_applied, verification_started, verification_passed, verification_failed, pr_created.

### Stage 10: Draft PR creation (NEW, behind --pr flag)

When changes pass verification:
- Create a branch named `alix/issue-<number>-<short-desc>`
- Commit changes with structured commit message
- Push branch to remote
- Create a draft PR via `gh pr create --draft`
- PR body includes:
  - Structured summary of changes
  - Evidence event references
  - Verification results
  - Link to original issue
  - `🤖 Generated with ALiX` footer

### Stage 11: Issue comment (from Phase 6)

Post structured comment to the issue with run ID, changed files summary, verification results, and PR link (if PR was created).

## Guardrails

| Gate | Default | Stage | Behavior on violation |
|------|---------|-------|---------------------|
| Max changed files | 10 | Patch proposal | Block with message |
| Max patch size (lines) | 500 | Patch proposal | Block with message |
| Allowed file paths | Workspace | Working tree | Block with message |
| Blocked file paths | `.env`, secrets, `.git/` | Working tree | Block with message |
| No file deletes | Allowed only for created files | Working tree | Block with message |
| Build must pass | Required | Verification | Block PR creation |
| Typecheck must pass | Required | Verification | Block PR creation |
| Tests must pass | Required | Verification | Block PR creation |
| No destructive commands | Enforced | Any | Shell policy blocks |
| No secrets exposure | Enforced | Any | Tool executor redacts |
| Draft PR only | Required | PR creation | No `--no-draft` flag |
| Human approval before merge | Required | Post-PR | GitHub branch protection |

## Config

Proposed config block in `.alix/config.json`:

```json
{
  "issueExecution": {
    "maxChangedFiles": 10,
    "maxPatchSize": 500,
    "blockedPaths": [".env", ".git", "**/secrets/**"],
    "verificationCommands": ["pnpm build", "pnpm typecheck", "pnpm test:vitest"],
    "labels": ["bug", "feature", "chore", "enhancement", "docs"],
    "branchPrefix": "alix/"
  }
}
```

## Outputs

| Output | Format | When |
|--------|--------|------|
| Plan | Structured evidence | After stage 4 |
| Patches | Diff summaries, evidence | After stage 5 |
| Changed files | List with stats | After stage 7 |
| Verification results | Pass/fail per command | After stage 8 |
| Draft PR URL | URL string | After stage 10 (if `--pr`) |
| Issue comment | Markdown (via `--comment`) | After stage 11 |

## CLI usage (proposed)

```bash
# Preview: plan + patch summary, no file changes
alix issue run --repo owner/repo --issue 123 --plan-only

# Dry-run: plan + patches + working tree changes (no commit/PR)
alix issue run --repo owner/repo --issue 123 --dry-run --plan

# Full: plan + patches + apply + verify + PR
alix issue run --repo owner/repo --issue 123 --plan --verify --pr --comment
```

## Foundation usage

| Foundation | Used for | Delivered in |
|------------|----------|-------------|
| Effect Schema contracts | Plan/proposal validation | Phase 1 |
| `withTimeout` | Shell/patch tool calls | Phase 2 |
| `withRetry` | Retries on transient failures | Phase 2 |
| `DiagnosticSink` + event store | Phase failure capture | Phase 3 |
| `ExecutionContext` | Run/session/workflow correlation | Phase 4 |
| `parentRunId` | Sub-delegation lineage | Phase 5 |
| `runTask` | Agent execution | Core |
| EventLog | Lifecycle evidence | Core |
| Issue skeleton | Intake, eligibility, context | Phase 6 |

## Non-Goals

- **No autonomous merge** — draft PR + human approval required
- **No broad execution scheduler** — no cron, no event-driven trigger
- **No multi-repo execution** — single repo per invocation
- **No dashboard** — CLI-only
- **No OpenTelemetry** — existing diagnostics store is sufficient
- **No orchestration rewrite** — uses `runTask()` and existing agent loop

## Recommended implementation order

| # | Title | Scope |
|---|-------|-------|
| 207 | (this doc) | Design |
| 208 | `feat(agent): add issue patch proposal dry run` | Plan + patch generation, `--plan-only`, `--plan` flags |
| 209 | `feat(agent): add changed-files guardrail` | Max files, paths, patch size enforcement |
| 210 | `feat(agent): add verification command runner` | Build/typecheck/test auto-run after changes |
| 211 | `feat(agent): add draft PR creation` | Branch, commit, push, draft PR via `gh pr create --draft` |
| 212 | `docs(agent): record issue-to-PR milestone` | Checkpoint doc |

## Verification (for implementation PRs)

```bash
pnpm build
pnpm typecheck
pnpm test:vitest
```
