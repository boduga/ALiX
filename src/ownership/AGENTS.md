# DOX — Ownership

## Purpose

Who is allowed to write where, and for how long. The ownership
records that make a worker's declared write scope enforceable and reclaimable,
plus the path-scope arithmetic both enforcement points share.

## Ownership

- `path-scope.ts` — Path scope arithmetic. `normalizePathScope` (planning-side,
  rejects `..` and uninterpretable wildcards) and `resolveOwnedScopePrefix` + `isWithinOwnedScope` (enforcement-side).
- `ownership-registry.ts` — The registry of live ownership claims: which agent
  holds which paths, with lease ids.
- `ownership-types.ts` — `PathScope`, `OwnershipScope`, `OwnershipMode`, `OwnershipStatus`, `OwnershipRecord`, `AcquireResult`, `OwnershipStore`, `OwnershipEventSink`.
- `ownership-lock.ts` — Cross-process locking around claim mutation, so two
  schedulers cannot grant the same path concurrently.
- `ownership-gate.ts` — Pre-dispatch check that a write falls inside the
  caller's declared scope.
- `mutation-targets.ts` — Derives the paths a tool call will actually write, so
  an `alix_patch_apply` call with several targets cannot be judged by its first path alone.

## Local Contracts

- **Owned-scope matching is ONE contract enforced at TWO points.**
  `PolicyGate` (`src/policy/policy-gate.ts`) and `FileToolRouter`
  (`src/tools/tool-router.ts`) both authorize the same `ownedPaths`, and the
  gate runs first. Both call `isWithinOwnedScope`; neither
  may grow a second matcher, and neither may re-normalize on its own.
- **A workspace-wide grant is a RULE, not a list of spellings.**
  `isWorkspaceWideGrant` treats `.` and any pattern made only of `*` segments as
  the whole workspace; derive the rule rather than enumerating spellings.
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
- **Any change to what a grant AUTHORIZES gets an expectation table, not a spot check.**
  A derived rule must be a strict SUPERSET of any list it replaces.
  `tests/ownership/path-scope.test.ts` holds the parity TABLE — the input space,
  not a sample — so a changed row shows up in review as a visible authority
  diff. Extend the table in the same commit as any behaviour change.

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
