# Contributing to ALiX

## Getting Started

1. Clone the repo and read root and scoped `AGENTS.md` instructions.
2. Run `pnpm install --frozen-lockfile && pnpm build`.
3. Run `pnpm hooks:install` once per checkout to enable the pre-push gate.
4. Run `pnpm preflight` before pushing; run relevant `pnpm test:node` / `pnpm test:vitest` suites as well.

## Solo maintainer + coding agents

This is a one-person repository with multiple coding agents. Agents are contributors,
not substitute human approvers. Use a separate worktree for each concurrent task;
do not switch branches or overwrite a worktree owned by another agent.

1. Read `AGENTS.md` and `docs/agents/issue-tracker.md`; inspect status, worktrees, existing branches and open PRs.
2. Fetch `origin/main`; create one scoped branch for one issue or independently mergeable change.
3. Use `feat/`, `fix/`, `docs/`, `chore/`, `test/`, `refactor/`, `security/`, `ci/`, `build/`, or `hotfix/`. Include the issue number when available.
4. Before committing, inspect `git diff`, `git diff --cached`, and `git status`; run applicable DOX/GitNexus and tests.
5. Run `pnpm preflight`. It must end with `Preflight OK`. A `UNKNOWN`/`not_checked` step is an incomplete run and exits non-zero; `SKIP` is reserved for an intentional, documented case such as a docs-only change.
6. Open one primary PR; use Conventional Commits PR titles. Link the issue with `Refs #N` for partial work; use `Closes #N` only when all acceptance criteria are met.
7. Have a separate agent session review the complete diff and a verifier check test evidence. Their reports do not count as independent human security qualification.
8. Merge only after required GitHub checks and applicable human authorization; prefer squash merge. Do not push to `main` directly, bypass checks, or rewrite others' branches.
9. After merging, fetch and verify main. Preserve active worktrees, review/evidence and backup branches. Delete other branches only with explicit maintainer authorization.

A clean PR or green CI is not permission to lift the GE-04 security hold.
The PR metadata check enforces naming, not security or merge authorization.

## Pull Requests

- Keep changes focused — one feature or fix per PR
- Fill the PR template's `**Scope:**` line with the top-level areas the diff touches (for example `scripts, tests, .github`). `check-pr-scope` fails when a touched area is undeclared.
- A diff spanning more than three areas must state why it is one change in a `**Broad-scope:**` line. The reason is reviewed, not scored: "it is a contract sweep across N subsystems" is fine, silence is not.
- Write tests for new code (we use `node:test`)
- Timing-sensitive tests must declare an explicit `timeout` with a workload-rationale comment (see `tests/soak/store-load.test.ts`), so slow runners don't turn them into flakes
- Ensure relevant `pnpm` tests and required CI checks pass before merging

## Commit Style

Use conventional commits:

```
feat: add multi-embedder search
fix: resolve provider test async issues
docs: update README with examples
refactor: extract task-loop module
test: add context compiler cache tests
```

## Code Conventions

- TypeScript, strict mode
- No classes where functions suffice (prefer pure functions for testability)
- `vitest` for unit specs (`*.vitest.ts`, colocated under `tests/`) and `node:test` for the node test suite (`tests/**/*.test.ts`); not mocha/jest
- Errors use `ApiError` in providers, `ToolResult` in tools
- Events use typed payloads from `src/runtime-state/events/types.ts`

## Project Structure

```
src/          — TypeScript source
tests/        — node:test suite (mirrors src/ layout)
dist/         — Compiled output (generated)
docs/         — Specs, plans, architecture
```

## License

MIT
