## Issue and scope

<!-- Refs #123 for partial work. Closes #123 only when all acceptance criteria are satisfied. -->
Refs #

**Scope:** <!-- comma-separated top-level areas: e.g. scripts, tests, .github -->
**Risk:** <!-- low / medium / high / critical; justify -->
**Broad-scope:** <!-- required only when the diff spans more than three areas: why this is one change -->
**Areas:** <!-- optional detail: exact affected subsystem/files -->
**Agent/worktree:** <!-- agent/session and isolated worktree or N/A -->
**Dependencies:** <!-- other PRs, or none -->

## Review and authorization

- [ ] Complete diff against current main inspected
- [ ] Fresh-context agent review recorded in `docs/reviews/PR-<n>.json`; `check:review` passes at the PR head
- [ ] CI evidence linked and applicable checks pass
- [ ] Human authorization recorded if security/release sensitive
- [ ] Existing security holds unchanged (or explicit release evidence attached)

## Rollback

<!-- How to revert this change safely; describe irreversible side effects or N/A -->

## Summary

<!-- 2-3 bullets: what changed and why -->

-

-

-

## Test Plan

<!-- How was this tested? Check the boxes or describe -->

- [ ] `pnpm typecheck` passes
- [ ] `pnpm build` passes
- [ ] `pnpm test:node:ci` passes
- [ ] `pnpm test:vitest` passes
- [ ] Manual test: `alix run "<task>"` completes a session without errors
- [ ] For provider changes: tested with at least one live model call

## Security Checklist

<!-- Required for all PRs. If not applicable, mark N/A with a reason. -->

- [ ] No new credentials, tokens, or secrets added to source code or config files
- [ ] All new API routes registered in `route-policy.ts` with appropriate auth/permission
- [ ] All JSON responses pass through `SecureResponder` (secret detection active)
- [ ] Error messages use stable error codes, not exception details
- [ ] No new filesystem writes without symlink safety checks (if security-sensitive)
- [ ] `alix security doctor` passes (run locally)
- [ ] `alix security gate` passes (run locally)
- [ ] New security-sensitive tests added in `tests/security/`
- [ ] No debug logging or stack traces exposed in production paths
- [ ] Config changes do not weaken security defaults

## Route Registration (if adding/changing endpoints)

<!-- Required if modifying anything in src/interfaces/server/server.ts or route-policy.ts -->

- [ ] New route has a unique, stable `RouteId`
- [ ] Route descriptor in `route-policy.ts` matches handler in `server.ts`
- [ ] Auth requirement correct (`public`, `authenticated`, or `sse`)
- [ ] Permission string matches authorization check in handler
- [ ] Redaction profile appropriate (`public`, `operational`, or `administrative`)
- [ ] Route coverage test updated (`tests/server/route-coverage.test.ts`)

## CLI Command Checklist (if adding/changing commands)

<!-- Required if modifying src/cli.ts or src/interfaces/cli/commands/ -->

- [ ] `--json` flag supported for machine-readable output
- [ ] Exit codes documented (0=success, non-zero=error)
- [ ] Help text updated in CLI routing
- [ ] No raw tokens, hashes, or addresses in human-readable output
- [ ] JSON output redacts sensitive fields

## Config / State Changes (if applicable)

<!-- Required if modifying config loading, signing, or state management -->

- [ ] Config mutation goes through `ConfigMutationService` (not direct writeFile)
- [ ] Config signing handled for production mode
- [ ] Credentials stored in credential store, not plaintext
- [ ] Audit log appended for state changes

## Documentation

<!-- Check if documentation needs updating -->

- [ ] New/changed features documented in `docs/`
- [ ] Security docs updated if applicable (`docs/security/`)
- [ ] `docs/security/baseline-inventory.md` updated for new routes/files
- [ ] `CONTEXT.md` updated if architecture changed

## Code Quality

- [ ] Code is focused and reviewable (under 15 min review)
- [ ] Tests included for new behavior
- [ ] Error messages are actionable (what, why, how to fix)
- [ ] No placeholder TODOs
- [ ] Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)
