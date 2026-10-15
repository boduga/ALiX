# SRAP P3 — Inspector workspace authorization

Status: Approved with conditions (2026-10-15 amendment below). P3 infrastructure only; G3 remains closed.

## Goal and boundary

Make Inspector workspace identity and token scope enforceable through existing
authentication plumbing. Do not add the remote approval decision endpoint,
approval authority, ledger, scheduler, state machine, HMAC lifecycle, or audit
projector. P4 and P5 remain separate gates.

## Design

Canonicalize the configured project root once at server startup using
`realpathSync.native(resolve(root))`. Bind project stores and middleware to that
same root. Resolution failure aborts startup. Request headers, query parameters,
and bodies never supply or override workspace identity.

Carry the authenticated principal's workspace IDs into `SecurityContext` for
both bearer tokens and freshly revalidated browser sessions. Preserve scope
absence versus an explicit empty list; neither confers remote-decision scope.

Wire `AuthService.verifyTokenForRequest` into bearer authentication using the
server's canonical identity. Apply the equivalent scope check to cookie
principals after source-token revalidation; cookie sessions must not bypass a
scoped token's restrictions. Use one shared scope predicate for both transports.
Existing Inspector access with unscoped tokens remains compatible. Tokens with
nonempty workspace scope must match the server identity. Anonymous loopback
access remains governed by existing development authentication mode.

Remote approval requires a stricter predicate: explicit nonempty scope containing
the canonical identity. P3 makes the data available but does not implement or
expose that future route. Existing development and cookie access confer no
remote-decision authority.

Add repeatable `--workspace <path>` enrollment to `alix inspector auth create`.
Resolve each supplied path with the same canonicalization rule before token
creation, deduplicate canonical identities, and reject missing values or
unresolvable paths before creating a token. Omission preserves existing unscoped
token creation. Relative paths resolve from the enrollment command's cwd.

## Alternatives

1. Recommended: wire existing request verification, share its workspace predicate
   with cookie revalidation, and preserve ordinary unscoped access. Closes the
   plumbing gaps with bounded compatibility impact.
2. Deny all unscoped Inspector access. Stronger global policy, but breaks existing
   tokens and exceeds the remote-decision contract.
3. Carry scope without enforcing scoped ordinary requests. Smaller change, but
   leaves the request-verification seam unused and scope restrictions bypassable.

## Acceptance and verification

Add an explicit expected-outcome parity table broader than the new code: bearer
and cookie transport; scoped match/mismatch; missing/empty scope; operator,
admin, readonly; revoked/expired identity; required and loopback development
modes. Preserve existing route permission outcomes. Cover cookie scope updates
and revocation from a separate store instance.

Prove relative, absolute, dot-segment, and symlink enrollment/server paths map to
one canonical identity. Reject nonexistent enrollment paths and missing option
values without creating tokens. Verify multiple workspace enrollment and
unscoped CLI compatibility. Requests cannot override server identity.

Run focused Inspector auth, middleware, CLI, and server tests; clean build;
unused-symbol typecheck; architecture boundary checks; and DOX claim checks.
Run GitNexus impact before source edits and graph change analysis before commits.
Update owning server/CLI contracts and remove stale scope-dropping language.

## Device correction

Current workspace is `/home/babasola/Projects/Monolith`. Operator confirms this
device has SSD. Historical HDD measurements describe the previous device only;
P4 still requires a representative benchmark on this SSD.

## Approved amendment — 2026-10-15

Operator approved bounded implementation with these overriding conditions:
`undefined` means legacy unscoped ordinary access; `[]` denies all workspace
access; a nonempty list requires canonical membership. Cookie revalidation
must read current source credentials and fail closed on expiry, revocation,
scope loss, or unavailable source validation. Preserve existing role checks and
anonymous ordinary development access. Absolute canonical paths are local to a
host/filesystem and are not portable identities; do not add a workspace registry.

The prior proposed treatment of an empty list as ordinary unscoped access is
superseded. No commit or merge without operator review. Required checks include
build, focused auth/server/CLI tests, typecheck:unused, check:dead, check:dox,
verify:deps, and GitNexus analysis. P4 must measure the actual SSD volume holding
the ledger; historical HDD and tmpfs measurements do not qualify.
