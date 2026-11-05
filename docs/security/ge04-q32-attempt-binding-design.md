# GE-04 Q3.2 — Attempt binding and last-effect fence (DESIGN ONLY / HOLD)

**Status:** NOT QUALIFIED. This document specifies the next adversarial gate; it does not introduce an authorization-bearing supervisor, service, trust key, or mutation API. `createScopedMutationService()` remains unavailable. Issue #1040 SECURITY HOLD persists.

## Finding motivating this gate

The operator-reported Q3.1 disposable-host experiment used distinct supervisor UID 995, coordinator UID 994 and attacker UID 993. The coordinator connected, then passed the connected socket to the attacker using `SCM_RIGHTS`. The attacker sent the forged payload, yet `SO_PEERCRED` still matched the original coordinator. The fixture replied `DENIED`. The output is operator-reported, not independently attested. This proves **connection identity is not per-message sender identity**, not that authorization is secure.

## Required authorization boundary

A connection or group membership grants only access to the *transport*. It never grants an effect. A future independently administered supervisor must verify an authorization artifact for **each** requested effect and bind it to all of:

- canonical run ID, worker ID and attempt ID (including retry generation);
- exact operation/capability and canonicalized target, with digest of effect arguments;
- trusted policy revision and approval identity, scope and expiry;
- nonce or monotonic sequence, unique for the authorization scope;
- authorized principal identity and independently verified issuance provenance;
- immutable protected release identity and the supervisor's current runtime identity.

The request's JSON fields, claimed UID/PID, or `SO_PEERCRED` are not trusted issuance evidence. A model, coordinator, or delegated socket holder must be unable to mint, rewrite, extend, or replay authorization. **No cryptographic token format is approved here:** key custody and issuer independence must be established before selecting or implementing one.

## Proposed last-effect sequence (subject to independent review)

1. Parse a bounded, canonical request; reject unknown, ambiguous or duplicated fields and ancillary FDs. Reject malformed or truncated messages without changing state.
2. Read independently protected authorization, policy revision, approval state and attempt state. Validate issuer provenance, binding fields, scope, expiry and revocation. Do not trust fields echoed by the client.
3. Recheck the *current* target and protected release/runtime identity immediately before the effect. Use descriptor-based containment rather than trusting a previously checked pathname.
4. Atomically claim the single-use authorization in durable protected state. Concurrent or repeated claims must yield at most one winner. If the claim cannot be made durably, fail closed.
5. At the final effect boundary, revalidate the claimed attempt, policy/approval status and target binding against protected state. Do not perform an effect after expiry, revocation, policy change, cancellation or target substitution.
6. Persist a durable effect-intent/effect-receipt protocol that distinguishes `not started`, `possibly applied`, and `confirmed applied` across crashes. Never assume a crash means no effect, or retry a non-idempotent effect blindly.

The ordering, durability and recovery model are **open design questions**, not validated guarantees. In particular, a claim alone is not a safe fence if authorization can change between claim and effect; a protected serialization/fencing mechanism is still required.

## Required negative-test matrix

| Case | Required result |
|---|---|
| Valid connected FD delegated to unrelated UID | No effect from connection credentials alone; reject missing independently valid per-effect authority |
| Forged approval/UID/attempt fields in payload | Reject; client claims never become authority |
| Reuse same authorization after one successful claim | Reject replay; no second effect |
| Two simultaneous claims of same authorization | At most one successful durable claim |
| Retry with changed worker/attempt generation | Reject stale binding |
| Changed capability, target, or argument digest | Reject mismatched binding |
| Policy revision changed or approval revoked/expired | Reject at last effect fence |
| Socket pathname or target symlink swapped | Reject or use verified pinned descriptor; no wrong-target effect |
| Crash before claim, after claim, before/after effect | Durable, unambiguous recovery disposition; no unsafe duplicate effect |
| Untrusted ALiX UID modifies key, policy, supervisor binary or runtime | Mutation denied by independent OS custody, not just application checks |
| Malformed, truncated, FD-ancillary or oversized frame | Deny; no state mutation or leaked received FD |
| Supervisor/issuer unavailable or protected store unreadable | Fail closed |

## Acceptance boundary

Q3.2 cannot be marked qualified until an independent operator/reviewer witnesses the real distinct-UID adversarial tests, independently controlled trust material and runtime, crash recovery, durable atomicity, and effect-time fence. Tests of a **deny-only fixture** may demonstrate rejection or expose weaknesses but cannot establish authorization safety. No release, merge, or gate transition may be inferred from a green test suite alone. Final human signoff remains mandatory.
