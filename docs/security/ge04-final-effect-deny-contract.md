# GE-04 PR 6 — final-effect authorization contract (DENY ONLY)

**Not a qualified final-effect authorization service. GE-04 SECURITY HOLD remains ACTIVE.**

This PR introduces `src/execution/filesystem/final-effect-guard.ts` as a
read-only, deterministic *contract qualification* component. It is not
imported by production routers and does not provide a mutation, commit,
delegate, permit, or token issuance API. **Every evaluation returns DENY**,
including evaluations where all fixture observations match.

## Exact-request and authority-evidence fields

The claimed effect request must have a strict known schema:

- Protocol `ALIX_GE04_FINAL_EFFECT_V1`
- Attempt identity and worker identity
- Policy revision
- Approval identity
- Lease identity
- SHA-256 over the **exact binary request bytes** (not a reserialized object)
- SHA-256 of the claimed signed release
- Explicit expiry timestamp

For testing, a separate fixture observation reproduces the identities,
digest bindings and expiry, and records whether policy currently allows
the effect, whether approval is still approved and unconsumed, and whether
the lease is active. The assessment rejects mismatches, expired snapshots,
revoked/released/expired leases, denied/revoked/consumed/pending approvals,
unknown metadata fields, malformed hashes and substituted request bytes.

These are necessary *structural* checks, but the observation object is
supplied by the same process running the tests. It is **not trusted
evidence** of current protected stores or native process identity.

## Mandatory production gate (NOT SATISFIED)

To implement actual GE-04 final-effect authorization, a future independent
native supervisor must:

1. Open and pin the trusted release and exact request under its own security
   principal; bind the worker/attempt, policy revision, approval and lease to
   its authenticated channel and protected stores.
2. At the **last native syscall boundary**, re-validate policy permission,
   single-use approval reservation/consumption, lease identity, unrevoked
   status and expiry using a supervisor-trusted clock and final effect target.
3. Reject expiry/revocation occurring between admission and effect;
   serialize competing attempts, without issuing reusable approval tokens.
4. Use descriptor-relative, constrained filesystem syscalls and independently
   protected directory identity against symlink/mount/parent/leaf races.
5. Record an effect journal with a signed, replay-safe request-to-release-to-
   kernel-outcome chain and an explicit unknown outcome after a crash.
6. Prove a distinct privileged trust boundary, sealed runtime/loader identity,
   durable rollback floor, protected key custody and recovery qualification.

**None of these final syscall trust properties are implemented here.**
Returning `checksMatched: true` means only that caller-originated *fixture*
fields agree; it is *not* a grant or authorization verdict. The only
`disposition` is `DENY` and `code` is
`GE04_FINAL_EFFECT_UNQUALIFIED`.

## Tests and release decision

`tests/execution/filesystem/final-effect-guard.test.ts` deterministically
asserts DENY for matching evidence, exact-byte substitution, changed
worker/attempt/approval/lease/policy/release, missing or revoked authority,
expiry at the boundary, oversized payloads and schema injection. It also
confirms the factory remains unavailable for Linux, macOS, Windows and
FreeBSD.

This PR can be merged **as deny-only contract scaffolding** following full
CI and review. It cannot and does not lift GE-04 SECURITY HOLD or establish
that ALiX can perform governed production filesystem mutations.

PR 7 must separately address receipt provenance and crash recovery; neither
an inert PR 6 gate nor a successful PR 7 fixture can replace operator-led
provisioning and independent human security signoff.
