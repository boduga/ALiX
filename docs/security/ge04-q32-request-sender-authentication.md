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

## Synthetic deny-only envelope validator (implemented; not qualification)

`scripts/ge04-q32-deny-envelope.py` implements a pure comparison of 18 nonempty string fields against a caller-supplied synthetic expectation, requiring the exact field set, `synthetic-v1` protocol and `supervisor` audience. Every path returns `authorized=false`, `HOLD`, zero real effects. Its `seen` input only models a replay marker **provided by the caller**; it is neither a durable replay store nor trustworthy authentication evidence. The CLI is inert and always exits 78. `scripts/test-ge04-q32-deny-envelope.py` covers 7 test groups, including field-by-field mutation and cross-attempt mismatch. No trusted expectation source, canonical signing format, issuer key, positive verification, expiry clock check, or atomic consume exists. The apparent completeness of the envelope does not qualify issuance or a final-effect fence.

## Synthetic durable replay observation ledger (implemented; not qualification)

`scripts/ge04-q32-deny-replay-ledger.py` uses an operator-supplied scratch SQLite file with WAL and FULL synchronous mode. `BEGIN IMMEDIATE` and a composite primary key (`issuer`, `attempt`, `generation`, `nonce`) serialize duplicate observations. **Both first and repeated observations are denied**. Six local test groups cover first/replay, subprocess restart, 24 concurrent observations (one first and 23 replay), distinct keys, invalid/missing ledger, and inert CLI exit 78. This is an observation ledger, not an authenticated issuance or consumption ledger. Its file path, database ownership, clock, input binding and authority are not protected; no crash injection, power-loss durability proof, cross-process adversarial custody or final-effect fencing has been established. GE-04 HOLD remains.

## Synthetic process-crash replay recovery (operator host rerun pending)

`scripts/ge04-q32-deny-replay-crash-probe.py` starts a disposable SQLite transaction worker, waits for a flushed checkpoint, sends `SIGKILL`, and reopens the ledger. Before insert and before commit must recover with `FIRST_OBSERVATION_DENIED` (uncommitted observation absent); after commit must recover with `REPLAY_DENIED`. Every path remains `authorized=false`, HOLD, zero effects, and the probe exits 78. The nonroot Linux local suite passes 2/2. This tests process death at deterministic checkpoints, **not** abrupt power loss, torn storage, crash during COMMIT, malicious database tampering, independently protected custody, or an authenticated positive path. The script must be rerun by the operator on microcloud3 for host-specific evidence.

## Operator-run cross-UID replay-ledger DAC probe (host evidence pending)

`scripts/ge04-q32-replay-cross-uid.py` is an opt-in root-launched **disposable-host** test that drops each child to four distinct nonroot UIDs. The synthetic SQLite replay ledger is created in an issuer-owned `0700` directory with a `0600` database. Supervisor, coordinator and attacker children attempt read, write, replace, unlink, hard link, directory traversal and SQL deletion; the parent compares the original ledger hash and confirms no hard link was created. The launcher always exits 78 and reports HOLD, zero real effects. Its two local unprivileged entry tests pass. Operator execution on microcloud3 is pending. This proves at most path-based DAC under the tested host setup, **not** FD delegation containment, ACL/mount/namespace isolation, durable authorization, or positive issuer qualification.
