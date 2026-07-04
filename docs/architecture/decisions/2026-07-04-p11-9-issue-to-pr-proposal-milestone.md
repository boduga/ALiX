# P11.9 Issue-to-PR Proposal Loop — Milestone Checkpoint

**Date:** 2026-07-04
**PRs:** #207–#212
**Status:** Complete — design, proposal, guardrails, verification, draft PR.

## Summary

Delivered the P11.9 issue-to-PR proposal loop. ALiX can now take an eligible GitHub issue through a complete safe chain: intake → eligibility → proposal → changed-file guardrails → verification → draft PR. No autonomous merge — human approval required at PR stage.

## Delivered PRs

| PR | Title | Scope |
|----|-------|-------|
| #207 | docs(agent): design issue-to-PR proposal loop | 11-stage lifecycle design, 13 guardrails, safety gates |
| #208 | docs(architecture): align post-effect work with P11 roadmap | Canonical P11.7/P11.8/P11.9 mapping |
| #209 | feat(agent): add P11.9 issue patch proposal dry run | `--proposal` flag, structured change plan, proposal evidence events |
| #210 | feat(agent): add P11.9 changed-files guardrail | `evaluateChangedFilesGuardrail()`, configurable limits/paths |
| #211 | feat(agent): add P11.9 verification command runner | `runVerificationSuite()`, allowlist/blocklist, safe defaults |
| #212 | feat(agent): add P11.9 draft PR creation | `--pr` flag, branch/commit/push/draft PR via `gh pr create --draft` |

## Safe chain

```
Issue intake (gh issue view)
  → Eligibility check (open, allowed label, not blocked)
  → Execution context (runId, sessionId, workflowId)
  → Proposal (--proposal) — structured change plan, no file changes
  → Changed-files guardrail (max 10 files, blocked/allowed paths)
  → Verification (--verify) — allowed commands with allowlist/blocklist
  → Draft PR (--pr) — branch, commit, push, gh pr create --draft
  → Issue comment (--comment) — post summary to GitHub issue
```

## Guardrails enforced

| Gate | Default | Enforced Since |
|------|---------|----------------|
| Issue must be open | Required | #202 |
| Allowed label required | bug/feature/chore/enhancement/docs | #202 |
| Blocked label rejected | blocked/do-not-merge/wontfix | #202 |
| Max changed files | 10 | #210 |
| Blocked paths | .env, .git/, node_modules/, dist/, .alix/ | #210 |
| Allowed paths (optional) | Configurable | #210 |
| Verification command allowlist | Build, typecheck, test | #211 |
| Verification command blocklist | rm -rf, sudo, git push, git commit | #211 |
| Draft PR only (no auto-merge) | Enforced | #212 |
| Comment posting opt-in (--comment) | Off by default | #205 |

## CLI usage

```bash
# Proposal dry-run (no file changes)
alix issue run --repo owner/repo --issue 123 --proposal

# Proposal + guardrail + verification + draft PR + comment
alix issue run --repo owner/repo --issue 123 --proposal --verify --pr --comment
```

## Files changed

```
src/cli/commands/
  issue-run-handler.ts              — P11.9 flags: --proposal, --pr
  issue-changed-files-guardrail.ts  — Guardrail evaluation
  issue-verification-runner.ts      — Command suite runner
  issue-draft-pr.ts                 — Branch/commit/push/draft PR

tests/cli/commands/
  issue-changed-files-guardrail.test.ts  — 12 tests
  issue-verification-runner.test.ts     – 11 tests
  issue-draft-pr.test.ts                — 4 tests

docs/architecture/decisions/
  2026-07-04-issue-to-pr-proposal-loop-design.md  — Design
  2026-07-04-p11-post-effect-roadmap-alignment.md — Roadmap
  2026-07-04-p11-9-issue-to-pr-proposal-milestone.md  — This doc
```

## Non-Goals

- **No autonomous merge** — draft PR + human approval required
- **No broad scheduler** — CLI-triggered only
- **No multi-repo execution** — single repo per invocation
- **No dashboard** — CLI-only
- **No OpenTelemetry** — existing diagnostics store is sufficient
- **No orchestration rewrite** — uses `runTask()` and existing agent loop

## Verification

```bash
pnpm build
pnpm typecheck
pnpm test:vitest
```

All clean: 2669+ tests, 256+ files, 0 type errors.
