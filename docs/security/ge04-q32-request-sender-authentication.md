# GE-04 Q3.2 — Request-level sender authentication boundary (design only, HOLD)

**Status:** No approved authentication protocol, credentials, positive verification, issuance, or effects. GE-04 SECURITY HOLD applies throughout.

## Operator-reported observation

On microcloud3, supervisor UID 995 established a connected Unix socket and passed its descriptor through `SCM_RIGHTS` to attacker UID 993. The attacker successfully sent a synthetic `approved=true` request over that connection. The deny-only verifier responded `DENIED_SECURITY_HOLD`, `authorized=false`, zero real effects; service exited 78. This is operator-reported synthetic host evidence, not proof of a production descriptor leak or resistance of a positive authorization path.

## Security consequence

Socket pathname DAC controls who can **establish** a connection, not who can **use** a connection after descriptor transfer. `SO_PEERCRED` is connection-time identity and does not establish the identity of every subsequent sender. `SCM_CREDENTIALS` may provide message-associated kernel credentials on supported Linux Unix sockets, but any reliance on it requires explicit platform, socket-type, credential-validation, forwarding and delegation threat review; it is not an approved solution here. A delegated sender can still carry bytes or credentials supplied by another principal; sender identity alone does not prove authority to approve an attempt.

## Proposed contract, not implementation approval

1. **Issuer custody:** Only the issuer process owns issuance authority, private keys or writable authority state. No secret, mutable authority handle, authenticated connection or preauthenticated capability is delegated to a coordinator, worker or attacker. The supervisor receives no issuer secret or authority-bearing descriptor.
2. **Per-request proof:** A future verifier must validate fresh, request-bound evidence of issuer authority, not infer authority from a socket connection, UID, `approved` field, or untrusted worker payload. The proof must bind issuer identity and release, supervisor audience and release, run/worker/attempt ID, retry generation, operation/capability, canonical target and argument digest, approval ID and revision, policy revision, nonce, expiry and protocol version. Specify canonical encoding before any signing/MAC design; no algorithm or key scheme is selected.
3. **Replay and substitution:** Supervisor maintains a protected durable replay/consumption record scoped to the bound request and generation. Replays, expired requests, mismatched responses, altered target, audience swaps and stale policy revisions fail closed. Crash and concurrent consume behavior require independent testing; a cache alone is not sufficient.
4. **Response integrity:** The verifier response must be authenticated, unambiguously associated with the exact request and channel, and resistant to coordinator/attacker substitution. A bare JSON `authorized=true` response is never sufficient.
5. **Effect boundary:** A verified issuer statement is not effect authorization. Supervisor must revalidate policy, approval, expiry, revocation and protected serialized final-effect fence immediately before mutation. Unknown external effect outcomes cannot be blindly retried.
6. **Lifecycle:** Audit `fork`, `exec`, subprocess `pass_fds`, `SCM_RIGHTS`, process inheritance, socket ownership and restarts. Credentials and connected descriptors must not escape to untrusted principals. Rejection of incoming `SCM_RIGHTS` is insufficient to prevent **outgoing connected-socket delegation**.

## Negative acceptance matrix (not yet qualified)

| Adversarial condition | Required outcome |
|---|---|
| Direct unauthorized connect | DENY |
| Delegated connected socket, forged `approved=true` | DENY, regardless of connector UID |
| Same binding, nonce replay or concurrent consume | At most one eligible consume; otherwise DENY |
| Changed target, operation, generation, audience, expiry or policy revision | DENY |
| Swapped or fabricated verifier response | DENY |
| Issuer credential/descriptor passed to untrusted process | Containment failure; HOLD |
| Crash between final check and effect, ambiguous outcome | UNKNOWN_RECOVERY / HOLD, no blind retry |

## Next safe engineering slice

Implement a **deny-only**, synthetic request-envelope validator and negative test corpus for missing, altered, replayed and cross-attempt fields. This may test parser and binding completeness, but cannot establish authentication without independently reviewed issuer custody and a positive-path design. Never convert its success to qualification. An independent security reviewer must evaluate the proposed protocol and custody before implementing any positive authority.

**Disposition: HOLD.** `createScopedMutationService()` remains unavailable.
