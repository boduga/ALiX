# GE-04 Q3.2 — Trusted issuer and effect-fence contract

**Status: DESIGN / SECURITY HOLD. Not an approved implementation or gate qualification.**

## Decision boundary

Separate four principals and two distinct forms of evidence:

1. **Operator / approval authority:** independently administered human and policy source. Neither coordinator nor model may create, amend, or revoke approval records.
2. **Issuer:** a separately controlled process with exclusive access to protected issuance state. It authenticates the operator-approved authorization intent against trusted policy and current attempt state. Its output is not accepted solely because a caller claims an issuer identity.
3. **Supervisor / effect executor:** separately controlled runtime with the *only* narrow effect capability. It independently verifies protected authorization and performs the final fence. The issuer has **no effect capability**.
4. **Coordinator / workers / model / transport:** untrusted requesters. Their task fields, sockets, environment and delegated descriptors are never authority.

**Important:** Separate UIDs alone are insufficient. Trusted launch chain, binary provenance, filesystem ancestry, service manager privileges, ACLs, sudo/polkit/setuid/capabilities, credential injection and operational separation require review. Issuer compromise must not automatically yield effect capability; supervisor compromise remains a critical threat requiring isolation and detection.

## Proposed authorization artifact (schema contract only)

All fields must be canonical and typed, with explicit domain separation and protocol version. No serialization, signature algorithm, key type or token format is approved.

| Field | Source of truth | Rule |
|---|---|---|
| `protocol_version`, `issuer_id`, `issuer_release_digest` | Independently trusted issuer metadata | Reject unknown version, release, issuer |
| `authorization_id`, `nonce` | Protected issuer state | Unique and single use; never caller-chosen |
| `run_id`, `worker_id`, `attempt_id`, `retry_generation` | Protected execution ledger | Exact match; changed retry invalidates |
| `principal_id`, `capability`, `operation` | Trusted policy and approval | Narrow scope; no wildcard expansion |
| `target_identity`, `arguments_digest` | Canonical operation descriptor | Exact effect binding; never path text alone |
| `approval_id`, `approval_revision`, `policy_revision` | Protected approval/policy store | Current at final fence, not just issue time |
| `not_before`, `expires_at` | Trusted time source | Fail closed on clock uncertainty |
| `supervisor_release_digest`, `audience` | Protected deployment metadata | Bind to one authorized effect executor |

Every field is an *input to verification*, not self-authenticating proof. The verifier must independently authenticate the complete canonical artifact and its protected source, then check the current ledger. A matching JSON object or `SO_PEERCRED` is not sufficient.

## Issuance protocol — proposed

1. Receive a bounded intent. Reject malformed/ambiguous fields, unexpected ancillary descriptors and unsupported operations. Transport identity only determines who may submit requests.
2. Independently resolve protected approval, policy, principal, attempt generation, release and target metadata. Never accept caller-supplied approval status as truth.
3. Require an independently authorized approval action and an issuance policy that cannot be modified by coordinator/worker/model UIDs.
4. Reserve a unique authorization ID/nonce in protected durable state, bound to the exact attempt and effect descriptor. Do not create transferable broad bearer authority.
5. Produce an authenticated, narrowly scoped artifact only after custody and anti-delegation design review. Until then, the implementation must always return `DENIED GE04_SECURITY_HOLD`.

**FD delegation hazard:** `SO_PEERCRED` on a connected Unix socket describes the original connector, not necessarily the process sending a later message. A delegated FD may deliver a request with the connector's credentials. Therefore connection identity cannot be the authorization subject. An authorization artifact may itself be copied; preventing replay requires protected one-time claim and per-effect binding, not an assertion that signatures alone are nondelegable.

## Final-effect and crash-safety contract

A protected, serialized authorization decision must cover the **final mutation boundary**. A transaction that commits before an unprotected effect leaves a revocation window. The design must select and independently validate one of:

- A fence that keeps the relevant protected policy/approval/attempt revision stable through the effect boundary, with explicit concurrency and deadlock behavior; or
- A versioned, durable intent protocol where revocation and effect execution share a formally defined ordering, and a stale effect is impossible after a completed revocation.

The chosen mechanism must distinguish `UNCLAIMED`, `CLAIMED`, `EFFECT_POSSIBLE`, `EFFECT_CONFIRMED`, `ABORTED` and `UNKNOWN_RECOVERY`. A crash after an external non-idempotent effect but before durable receipt is **ambiguous**; do not automatically retry. Idempotency keys must be enforced by the effect target, not assumed from a local journal. Supervisor must reject stale attempt generations, substituted targets, changed arguments, expired approvals, changed policy revisions, replayed authorization IDs, or unverifiable issuer provenance.

## Rejection / adversarial acceptance matrix

| Adversary / event | Mandatory outcome |
|---|---|
| Forged issuer JSON, claimed UID or copied token | No effect without independently authenticated issuance and live binding |
| Connected FD transferred from trusted connector | No effect from socket provenance alone |
| Coordinator/worker changes approval or issuer store | OS-level denial and auditable tamper evidence |
| Two workers race one nonce | At most one durable claim and one permitted effect |
| Approval revoked before final fence | No effect |
| Revocation races effect | Defined serialized order; no unaccounted effect after completed revocation |
| Crash before/after effect and before receipt | No blind replay; explicit recovery state |
| Symlink, mount, regular-file or inode substitution | No wrong-target effect; descriptor identity and mount assumptions verified |
| Issuer, store, clock, policy or audit unavailable | Fail closed |
| Compromised issuer but intact supervisor | No arbitrary effect; supervisor checks narrow scope and current protected policy |
| Compromised supervisor or privileged operator | Outside current demonstrated boundary; requires independent threat analysis |

## Independent evidence required before design approval

- Concrete issuer and supervisor deployment model with trusted administrators and negative privilege escalation review.
- Protected state ownership, backup/recovery, issuer release provenance, revocation authority and rotation protocol.
- Selected canonical encoding, cryptographic verification and anti-replay protocol with reviewable test vectors.
- Formal concurrency/linearization argument for revocation vs effect, plus fault-injection tests across crash points.
- Real target-specific effect adapter idempotency/recovery contract and adversarial tests.
- Independent reviewer signoff and explicit human gate decision.

**Non-goals of this document:** creating a key, running an issuer, authorizing a mutation, changing ALiX's public APIs, or clearing the hold. `createScopedMutationService()` remains unavailable.

## Inert transition model (synthetic only)

`scripts/ge04-q32-inert-fence-model.py` defines immutable `State` transitions
for `UNCLAIMED`, `CLAIMED`, `EFFECT_POSSIBLE`, `EFFECT_CONFIRMED`, `ABORTED`,
and `UNKNOWN_RECOVERY`. Its eight tests cover one-time synthetic claim,
wrong nonce/attempt/revision, revocation before effect start, ordered
revocation after start, and crash ambiguity. It performs **zero real effects**;
its CLI returns exit 78 and `HOLD` regardless of transitions.

**Critical modeling limits:** the sequential loop is not a concurrent durable
transaction, a security fence, an effect adapter, or an issuer. Its `fence`
integer is only a model clock; `accepted=True` means a simulated transition,
not authorization. The test labeled racing claims is a *sequential replay*
check, not a simultaneous-claim race. A post-start revocation prevents a
synthetic confirmation but cannot undo an external effect that may already
have happened. Crash after effect start is intentionally `UNKNOWN_RECOVERY`;
no replay is permitted. No qualification follows from these unit tests.

## Q3.2 synthetic ordering explorer (not real fault injection)

`scripts/ge04-q32-inert-interleavings.py` enumerates all 120 permutations of
five abstract events: claim, effect start, revoke, crash, effect confirm.
It checks that no model effect-start succeeds after revocation and that
`UNKNOWN_RECOVERY` cannot be confirmed or retried. It is a *sequential
interleaving explorer*, not thread concurrency, process crash injection,
transaction linearizability, persistence, or a real effect-time fence. It
always exits 78 with `HOLD` and reports zero real effects.

**Open critical gap:** the existing inert model treats `effect_start` as one
atomic abstract transition and permits revocation after that point, but
`effect_confirm` may be denied even if an external effect already occurred.
A real implementation must explicitly define revocation completion versus
in-flight effects, record a durable intent before any irreversible operation,
and supply a recovery oracle for ambiguous target outcomes. These properties
cannot be established by permutations of in-memory events. Before any
implementation of effect authority, review the linearization point and
fault-injection matrix with an independent security reviewer. HOLD persists.

## Synthetic durable effect-intent journal (HOLD)

`scripts/ge04-q32-inert-effect-journal.py` uses a **caller-owned scratch** SQLite
journal to model durable `INTENT` → `EFFECT_POSSIBLE` and reopening the store
for recovery. `INTENT` becomes `ABORTED`; `EFFECT_POSSIBLE` becomes
`UNKNOWN_RECOVERY`, which cannot be claimed or started again. Duplicate
attempt IDs and stale revision transitions are rejected. SQLite uses WAL and
`FULL` synchronous mode for this test. The CLI requires explicit isolated-test
opt-in, returns 78 and reports zero real effects.

This is **not** a protected store, a real effect adapter, a proven power-loss
recovery protocol, or an authorization-bearing implementation. Tests reopen
a database connection but do not kill processes at every write boundary or
simulate torn writes/power loss. A journal entry does not make an external
operation atomic with the journal transaction; `UNKNOWN_RECOVERY` cannot be
resolved automatically without a trusted target-side idempotency/reconciliation
protocol. No `CONFIRMED` transition is implemented because there is no real
trusted receipt. The simulated `mark_possible` does not hold a fence across
any real effect. GE-04 SECURITY HOLD remains.

## Disposable SIGKILL fault injection (HOLD)

`scripts/ge04-q32-inert-crash-worker.py` is a test-only child process that
commits either synthetic `INTENT` or `EFFECT_POSSIBLE` to a scratch SQLite
journal, flushes a checkpoint marker and blocks. Its test parent sends
`SIGKILL`, waits for signal termination, reopens the database and checks
recovery to `ABORTED` or `UNKNOWN_RECOVERY`, respectively. Both states reject
reusing the attempt. A missing `--isolated-test` flag fails closed before
opening a journal. This is actual process-kill injection at **two post-commit
checkpoints**, not arbitrary-instruction crash injection, torn-write testing,
power-loss durability, concurrency proof, or real effect execution. The
checkpoint's stdout marker is test synchronization, not a production commit
receipt. No authorization, keys, target-side idempotency or reconciliation
oracle exists; ambiguous outcomes remain unresolved. GE-04 HOLD persists.
