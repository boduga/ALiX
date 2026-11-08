# GE-04-R2S — Independent Trust Service Contract

**Status:** Proposed / NOT provisioned / GE-04 SECURITY HOLD ACTIVE.
**Decision:** [ADR-0018](../architecture/adrs/ADR-0018-independent-trust-service.md).
**Threat model:** [GE-04 Trust Service](ge04-trust-service-threat-model.md).
**Implementation snapshot:** `src/governance/security/evidence/monotonic-witness.ts` currently provides an **unwired qualification-only reader**; the proposal below is not an implemented production API.

## 1. Ownership and purpose

The trust service is externally administered **security evidence infrastructure**, not an ALiX policy, approvals, release, issuer, scheduler, worker supervisor or recovery decision authority. ALiX governance remains the only authorization authority. The service produces signed evidence of a protected revision/head; the client verifies it against a separately protected floor. No service response can grant credentials, approve a tool, clear worker ownership, waive recovery ambiguity or release GE-04 SECURITY HOLD.

## 2. Trust domains

- `verifier`: authenticated, read and challenge-only; owns locally durable issued/consumed nonces via the established ALiX security state boundary.
- `publisher`: authenticated proposal-only; can submit versioned checkpoint candidate after canonical authorization, never choose policy or sign unconstrained data.
- `committer`: separately authorized, monotonic compare-and-advance; rejects stale head, fork, rollback, unapproved issuer and changed policy.
- `service-signer`: may sign **only the committed protected head** and fresh challenge; no private-key export, arbitrary-sign, state mutation or operator endpoints.
- `security-operator`: restricted enrollment, keys/certificates, compromise response, rotations and restore/recovery procedures; use independently approved dual control where risk requires.
- `ALiX workload` (worker/model/plugin): untrusted; no direct trust-service privileges.

Separate guest, publisher, anchor and operator administrative identities. Sharing a single root credential or snapshot domain defeats the intended independence.

## 3. Proposed logical APIs (version 1; transport binding undecided)

These names describe protocol intents and MUST NOT be mistaken for existing routes.

| Logical method | Principal | Request identity | Response / mutation |
|---|---|---|---|
| `ReadWitnessHead` | verifier | client ID, audience, challenge context | Signed committed head + anchor reference; read-only |
| `ChallengeReceipt` | verifier | 256-bit unique nonce, target boot/session, audience | Signed nonce-bound receipt for **committed** head; no write |
| `ProposeCheckpoint` | publisher | signed publisher ID, current head, next revision, ALiX policy revision, checkpoint, idempotency token | Proposed-only; no automatic commit or worker permission |
| `CommitCheckpoint` | separately authorized committer | verified proposal, expected prior epoch/revision/digest, atomic preconditions | Atomic monotonic advance + durable checkpoint commitment |
| `ReadConsistency` | verifier / independent monitor | old/new checkpoint or monotonic register reference | Verified inclusion/consistency proof or protected register value |
| `RotateIdentity` | privileged operator workflow (not public API) | independently approved old/new keys and epochs | Audited, explicit trust migration, never implicit re-pin |

No `ApproveWorker`, `ClearRecovery`, `ResetRevision`, arbitrary signing, user-selected trust-path, or automatic emergency bypass endpoints. Keep management off public/read API surfaces; disable all write routes until independently qualified.

## 4. Wire-level security requirements

1. Mutually authenticate caller and service (mTLS with pinned roots/SPIFFE-equivalent workload identity or another reviewed protocol); private VLAN/SSH tunnel **alone** is not a production identity scheme.
2. Bind each credential to exact role, service ID, audience, deployment/environment and short validity; revoked, expired, unknown, wrong-tenant/worker credentials deny.
3. Strict versioned schema, canonical serialization, bounded  request/response sizes, reject duplicate keys/unknown fields, bounded concurrency, server timeouts, quotas and explicit non-200 errors without sensitive detail leakage.
4. Use cryptographic verification of *pinned* signer identity and exact domain-separated message schema. Current R2P Ed25519 receipt contains `schema`, `witnessId`, `nonce`, `revision`, `checkpointSha256`, `policySha256`, `bootId`. A production protocol revision MUST additionally settle audience, deployment/epoch, key ID, producer identity and protected anchor reference. Never silently reinterpret an R2P fixture as authenticated production v1.
5. Neither `/health` nor TLS connectivity means the trust floor or signed evidence is valid. Health cannot grant authorization.
6. Signing private keys must never be exported to ALiX workers, runtime configuration, source control, logs or API clients. Non-exportable/HSM custody is preferred if needed for the threat model.

## 5. Revision and evidence state machine

An externally protected head is `(anchorId, epoch, revision, policySha256, checkpointSha256, signerKeyId)`. The sequence is strictly increasing for an epoch. The ALiX canonical `computePolicyRevision` fingerprint remains a SHA-256 digest; the witness revision is a different increasing integer.

Proposed transitions:

```text
COMMITTED(n, Pn, Cn) -- authenticated propose(n+1, Pn+1, Cn+1) -->
PENDING(n+1, expected n, fingerprint) -- independent authorize / compare -->
COMMITTING(n+1) -- durable protected atomic advance and checkpoint -->
COMMITTED(n+1, Pn+1, Cn+1)
```

- Stale expected revision, duplicate same-revision different digest, gap, fork, wrong publisher or unsigned evidence → reject.
- Concurrent commits serialize at the protected floor boundary; network retried idempotency tokens do not create fresh authorization.
- Crash at any boundary: do not re-sign a not-yet-committed head; fail closed and reconcile against the protected source, never guess success.
- An anchor reset or epoch change is an incident/approved recovery event, not a normal sequence transition.
- Protect *both* a strictly monotonic number and the exact checkpoint identity: a bare counter without bound digest is inadequate.

## 6. Verifier acceptance algorithm (future; no implementation claim)

1. Read independently provisioned service public-key trust and protected floor provenance; fail closed if unavailable, unknown or potentially rolled back.
2. Atomically persist a CSPRNG challenge before transmission. Use authenticated transport.
3. Receive bounded signed receipt; atomically consume the exact issued nonce at the ALiX canonical state boundary **before** interpreting signature. Consumed once across restart/parallelism.
4. Verify schema, signature, witness key epoch, audience/boot identity, nonce, policy fingerprint, checkpoint digest and exact or reviewed monotonic floor advancement protocol.
5. Verify consistency with **separately protected** anchor and externally monitored checkpoint history. Detect split view, unexpected key rotation, fork, rollback or missing floor. Absence of reliable evidence → blocked.
6. Return evidence integrity and error reasons to ALiX governance/recovery. **Never return allow, a grant, or a recovered worker state.** Existing policy/approval/supervisor/ledger gates must independently remain satisfied.

Current TypeScript `consumedByVerifier` boolean is a caller-provided qualification assertion, NOT a production custody proof. Its snapshots and Python local fixtures do not establish trust provenance or rollback resistance. Production wiring requires typed evidence from the existing durable verifier custody.

## 7. Operational control and failure policy

- Provision certificates, key material and floor/anchor through independently controlled operator workflow; document authorization and key fingerprint provenance outside the witness VM.
- Key rotation: revoke old identity, review key/anchor epoch transition, preserve signed history and independently publish old→new certificate/key binding. Reject surprise changes.
- Backups and restore: permitted only if protected floor continuity and key custody can be verified; guest snapshot restore alone cannot lower trusted head.
- Network/API outage, invalid signature, inconsistent history, expired credential, untrusted floor, clock uncertainty and ambiguous commit all block security-sensitive recovery/admission. No emergency fail-open.
- Audit rejected and accepted proposals, commits, key rotations, client identity failures, anchor epochs and incident decisions to a separately controlled monitoring sink.
- Security patching, supply-chain verification, secrets rotation, least-privilege runtime and incident response are operational release prerequisites.

## 8. Qualification/acceptance gates

[ ] Threat model reviewed by independent security owner
[ ] Mutual authentication, role tests, cert expiry/revocation, malformed/fuzz/DoS tests
[ ] Protected signer key provenance/rotation with independent operator evidence
[ ] Independent protected floor and checkpoint with distinct admins from VM/ALiX worker
[ ] Concurrent proposals/commits, fsync/power-loss and crash/restart unknown-outcome tests
[ ] Real Proxmox VM snapshot rollback and cross-host split-view detection
[ ] External audit integrity and checkpoint monitor fault testing
[ ] One ALiX governance/recovery evidence seam, no parallel policy/supervisor authority
[ ] Supported platform native qualification per Master PRD; deferred systems not auto-certified
[ ] Signed independent review; Q13 release approval and GE-04 hold clearance separately recorded

**Until all relevant gates are independently evidenced, status remains SECURITY HOLD.**
