# Inspector workspace authorization implementation plan

Status: Implementation approved for commit, push and PR (2026-10-15); merge not authorized.

**Spec:** ../specs/2026-10-15-srap-p3-workspace-authorization-design.md

**Goal:** Enforce credential workspace restrictions without widening authority.

**Architecture:** Canonicalize server root once and enroll canonical paths.
Use one workspace eligibility predicate for bearer verification and current
cookie-principal validation. Carry scope into request context without changing
role permissions.

**Tech stack:** TypeScript, node:test, existing Inspector authentication stores.

## Global constraints

G3 closed. No remote decision route, new authority, ledger, scheduler, state
machine, HMAC lifecycle, audit projector, batching, commit, or merge.
Scope undefined allows ordinary legacy access; empty denies; nonempty requires
membership. Canonical paths are host-local identities. Preserve unrelated files.

## Tasks

- [x] Read owning contracts; refresh graph and analyze existing edit targets.
- [x] Add literal expected-outcome parity matrix before implementation in
  tests/server/workspace-authorization.test.ts. Real middleware + AuthStore and
  browser sessions must cover transport × role × scope × authentication mode.
  Assert HTTP status and forwarded scope, then mutate source credentials from
  a separate store and assert denial or reduced role permissions.
- [x] Add CLI enrollment tests in tests/cli/inspector-workspace.test.ts using
  child processes with isolated state and cwd. Assert stored canonical IDs and
  absence of token/audit creation for invalid input.
- [x] Run new tests against baseline and record behavioral failures.
- [x] Add src/governance/security/inspector/workspace-scope.ts with
  canonicalWorkspaceId(root: string): string and
  allowsWorkspace(workspaceIds: readonly string[] | undefined,
  targetWorkspace: string | undefined): boolean. Use native realpath + resolve;
  undefined legacy scope allows; empty denies; scoped without target denies.
- [x] Wire AuthService.verifyTokenForRequest and middleware cookie validation
  through allowsWorkspace. Fail cookie source validation closed. Propagate scope
  using SecurityContext.workspaceIds and factory options. Bind server root and
  middleware targetWorkspace to canonicalWorkspaceId(root).
- [x] Parse all --workspace values before createAuthService/createToken in
  handleInspectorAuthCreate, canonicalize and deduplicate, reject missing or
  invalid paths, retain undefined for omitted enrollment.
- [x] Add real startServer path/identity and spoofing tests; run focused tests.
- [x] Update server/CLI contracts and device handoff status; run clean pnpm build,
  focused suites, typecheck:unused, check:dead, check:dox, verify:deps and
  architecture tests. Review diff for spec compliance and quality. Report
  evidence/remaining risks; leave changes uncommitted for operator review.

## Verification and review record

- Clean `pnpm run build`: passed; final rebuild after scope-shape guard passed.
- Focused Inspector auth, CLI, server and architecture suites: 491/491 passed,
  125 suites, zero skips/cancellations. Normal node:test runner (no forced exit).
- Parity: 48 role/transport/scope/mode combinations, with explicit read/execute
  expectations; 16 independent-store revocation/expiry/scope-change cases, plus
  repeated denied-cookie requests, current role reduction, missing source
  validation, anonymous development compatibility and request spoofing.
- Enrollment: 8 cases; canonical path equivalence, deduplication, multiple paths,
  legacy omission, missing/empty values and nonexistent paths with no credential
  or audit side effects. Server canonicalization covers 4 root forms.
- Malformed string scope reproduced 200 instead of 401 on bearer and cookie;
  shared array-shape guard fixed both regression cases.
- typecheck:unused, check:dead and verify:deps passed. Architecture checks passed
  within the 491-test run. Whitespace diff check passed.
- check:dox executed and FAILED: added allowsWorkspace contract cannot resolve
  against committed HEAD. The checker uses git grep at HEAD, not worktree source.
  The worktree declaration and both consumers were read back; rerun the official
  gate after a reviewed commit. No checker bypass or scope reduction applied.
- GitNexus detect_changes: 14 changed files, 21 indexed symbols, LOW reported
  risk, no partial/truncated flags. New files included through a temporary index;
  the real index remains untouched. New symbols are not yet in the baseline
  index, so the low-risk report is not proof that they have no callers.
- Spec compliance and code-quality diff reviews completed inline. Source changes
  stay within P3; no new route or permission vocabulary, authority, registry,
  ledger, scheduler, HMAC lifecycle or projector. Public auth/logout recovery
  remains available; explicit invalid credentials cannot downgrade protected
  requests to anonymous development access.
- DOX: updated owning server/CLI contracts and handoff. Root, docs and approval
  contracts intentionally unchanged: ownership/index structure and future
  approval authority are unchanged.
- Main remains clean at 4440e48c. No commit, push, PR or merge performed for P3.

## Publication authorization — 2026-10-15

Operator reviewed the implementation outcome and authorized commit, push and
opening a separate P3 PR. This supersedes the earlier pre-review publication
restriction; G3 and merge remain unauthorized. The pre-commit DOX finding above
must be rerun against the committed source snapshot before publishing.
Local 491-test evidence was collected under Node 24.21.0; the supported runtime
floor is Node 26.4.0 and the PR's Node 26 CI remains a required validation gate.
