# GE-04 Q3.2 — Supervisor-only verification boundary (design, HOLD)

**Status:** Proposed contract; no implementation, qualification, or release authorization.
**Evidence:** Operator-reported microcloud3 synthetic fixture probes, not independently witnessed or cryptographically attested.

## Observed evidence and its limits

- Corrected `ge04-q32-custody-cross-uid.py` run: distinct issuer UID 990, supervisor 995, coordinator 994, attacker 993; all 15 nonissuer path operations denied; `fixture_unchanged=true`; issuer positive control observed; exit 78/HOLD. The earlier `fixture_unchanged=false` run was contaminated by issuer mutations against the negative fixture and must not be counted as an access bypass or successful integrity test.
- `ge04-q32-custody-fd-delegation.py` run: issuer UID 990 transferred a synthetic file descriptor to attacker UID 993. Read-only transfer allowed reading but denied writing, fixture unchanged. Writable transfer allowed reading and writing, fixture modified. Exit 78/HOLD. This proves an already-open descriptor retains its granted access across UID transfer in this fixture; it does **not** prove a production ALiX descriptor leak.
- The above observations do not qualify independent issuance, runtime protection, authenticated approvals, target receipts, or final-effect fencing. `createScopedMutationService()` remains unavailable under GE-04 SECURITY HOLD.

## Trust boundary and proposed interface

1. **Issuer** owns private authority state and all authority-bearing descriptors. No key, mutable store handle, signing capability, or writable authority descriptor crosses its process boundary. Issuer never executes effects.
2. **Supervisor** may receive a narrowly scoped *verification verdict* through an authenticated, access-controlled channel. It does not receive issuer file descriptors, issuer private keys, or unrestricted issuance operations. Supervisor remains the only proposed final-effect executor, subject to independent authorization and a protected final-effect fence (both unqualified).
3. **Coordinator, workers, models, plugins, and transport** are untrusted. They may propose an attempt, but cannot mint or change an issuer-approved binding or substitute a verification verdict.
4. A verification request must bind attempt ID, retry generation, nonce, actor, operation/capability, immutable target identity and argument digest, approval/policy revision, expiry, and supervisor audience/release. No caller-supplied `approved=true` flag is authority.
5. A response must be bound to the exact request and authenticated channel, with a deny-by-default result. The supervisor must reject missing, stale, replayed, conflicting, or unverifiable responses. No proposed wire format, cryptographic key, signature algorithm, or production credential mechanism is approved yet.
6. `SO_PEERCRED` identifies the original connector of a Unix socket, not necessarily a later sender of a delegated connected descriptor. Therefore peer credentials alone do not authenticate a request payload or establish nondelegation. The design must explicitly address `SCM_RIGHTS`, inherited descriptors, subprocess handle passing, and credential delegation; avoiding file-descriptor payloads in a normal protocol is necessary but not sufficient.
7. A positive verification verdict is **not** final-effect permission by itself. The supervisor must recheck revocation/expiry/policy and the protected serialized effect fence at the final mutation boundary. An ambiguous crash after an effect may have started must not trigger blind retry.

## Fail-closed acceptance criteria (not yet tested)

- Supervisor verification path cannot access issuer-private authority files or writable issuer descriptors, including via inherited or transferred handles.
- A forged, altered, expired, wrong-audience, wrong-generation, replayed, or swapped attempt request produces DENY, with no effect.
- Issuer-to-supervisor response is request-bound and cannot be forged by coordinator/attacker or substituted across attempts.
- Channel lifecycle and child process launch cannot leak issuer handles; denial remains effective under deliberate FD delegation attempts.
- Concurrent revocation versus verification/effect-start has a documented protected linearization point; restart and unknown-outcome cases fail closed.
- Operator captures host identity, script hash, invocation, output, exit status, and independent review. The authority design requires separate custody and key-management review before implementation or release.

**Disposition: HOLD.** The next implementable slice should be a *deny-only* supervisor verification service with synthetic request binding and explicit no-FD-response assertions. Its tests must not be described as authorization proof.
