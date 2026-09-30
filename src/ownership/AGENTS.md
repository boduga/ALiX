# DOX — Ownership

**Purpose:** Who is allowed to write where, and for how long. The ownership
records that make a worker's declared write scope enforceable and reclaimable,
plus the path-scope arithmetic both enforcement points share.

**Ownership:**
- `path-scope.ts` — Path scope arithmetic. `normalizePathScope` (planning-side,
  rejects `..` and uninterpretable wildcards) and, added in the owned-write
  fix, `resolveOwnedScopePrefix` + `isWithinOwnedScope` (enforcement-side).
- `ownership-registry.ts` — The registry of live ownership claims: which agent
  holds which paths, with lease ids.
- `ownership-types.ts` — `PathScope`, `OwnershipScope`, `OwnershipMode`, `OwnershipStatus`, `OwnershipRecord`, `AcquireResult`, `OwnershipStore`, `OwnershipEventSink`.
- `ownership-lock.ts` — Cross-process locking around claim mutation, so two
  schedulers cannot grant the same path concurrently.
- `ownership-gate.ts` — Pre-dispatch check that a write falls inside the
  caller's declared scope.
- `mutation-targets.ts` — Derives the paths a tool call will actually write, so
  a `patch.apply` with several targets cannot be judged by its first path alone.

## Local Contracts

- **Owned-scope matching is ONE contract enforced at TWO points.**
  `PolicyGate` (`src/policy/policy-gate.ts`) and `FileToolRouter`
  (`src/tools/tool-router.ts`) both authorize the same `ownedPaths`, and the
  gate runs FIRST. They previously carried two independent matchers: the gate's
  did no normalization, so a `**` grant resolved to a literal `**` path segment,
  the gate denied before the router was reached, and the router's own tests
  passed because they bypass the gate entirely. Glob ownership therefore had
  never worked through the real path. Both call `isWithinOwnedScope`; neither
  may grow a second matcher, and neither may re-normalize on its own.
- **A workspace-wide grant is a RULE, not a list of spellings.**
  `isWorkspaceWideGrant` treats `.` and any pattern made only of `*` segments as
  the whole workspace. An enumerated list of spellings was incomplete and stayed
  that way until someone added the missing entry; deriving it means an unseen
  spelling still resolves correctly.
- **Fail closed.** `..` traversal, uninterpretable wildcards, and an owned entry
  resolving outside the workspace all reduce to `undefined`, which authorizes
  NOTHING. An entry that cannot be reduced safely must never widen to
  everything.
- Coverage belongs with the enforcement point, not only beside it: the
  authorization regression test for owned writes is
  `tests/policy/policy-gate.test.ts`, because a router-only test cannot reach
  the gate.

## Work Guidance

- Change an owned-scope rule here, then run BOTH `tests/policy/policy-gate.test.ts`
  and `tests/tools/tool-router.test.ts`. A change that only the router suite
  exercises is unverified.
- **Any change to what a grant AUTHORIZES gets a parity check, not a spot check.**
  Establish the old behaviour first (a scratch worktree at the pre-change
  revision builds fine), run both versions over the full input space, and diff.
  Two rules, both learned the hard way:
  1. A derived rule must be a strict SUPERSET of any list it replaces. A rule
     that is narrower is a silent narrowing wearing the costume of a cleanup.
  2. A test that enumerates the same cases as the implementation cannot detect
     the implementation losing one. `tests/ownership/path-scope.test.ts` holds the
     parity TABLE — the input space, not a sample — so a changed row shows up in
     review as a visible authority diff. Extend the table in the same commit as
     any behaviour change.

## Verification

- `tests/ownership/` — registry, locking, and scope-arithmetic suites.
- `tests/policy/policy-gate.test.ts` — pins the owned-path rule in every
  workspace-wide spelling and pins fail-closed behaviour.
- `tests/tools/tool-router.test.ts` — pins recursive scopes and that an escape
  denial comes from containment rather than the ownership matcher.

## Child DOX Index

This directory has no child `AGENTS.md` files. Its dependencies are documented
where the rules are enforced: `src/policy/AGENTS.md` (the gate) and
`src/kernel/AGENTS.md` (coordination claims and cancellation).
