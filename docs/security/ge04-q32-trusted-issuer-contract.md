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

## Synthetic target-side idempotency and reconciliation (HOLD)

`scripts/ge04-q32-inert-target-reconcile.py` models a *separate caller-owned
scratch SQLite target* with a unique idempotency key, immutable request digest
and synthetic result. The first request inserts a durable synthetic receipt;
a repeat of the same key and digest returns the existing result; a different
digest with the same key is a conflict. Read-only `lookup` distinguishes
`CONFIRMED_SYNTHETIC`, `CONFLICT` and `NOT_OBSERVED`. The lost-acknowledgement
test commits, discards the returned status, reopens the database and finds the
receipt without issuing a second submit. All test invocations return HOLD;
zero real effects are performed.

**Non-qualification:** This is an idealized target contract, not a real
external API, trusted target, independent custody, authorization protocol,
crash-atomic target adapter or reconciliation oracle. A missing receipt is
**not** evidence that an external effect did not occur, and a synthetic
receipt is not an independently verified real-world effect. The target's
atomic insert does not prove atomicity between a real effect and receipt.
A future adapter must prove that its idempotency key is enforced at the
actual effect boundary, receipts are durable and authentic, the query is
side-effect-free, and ambiguous outcomes never trigger a blind retry.
GE-04 SECURITY HOLD remains active.

## Integrated synthetic journal-to-target reconciliation (HOLD)

`scripts/ge04-q32-inert-integrated-recovery.py` reads the existing journal
attempt phase and target receipt registry without submitting an effect,
retrying, or mutating either store during reconciliation. An ambiguous
`UNKNOWN_RECOVERY` attempt plus a matching synthetic receipt yields
`RECONCILED_SYNTHETIC_ONLY`; missing receipt yields `HOLD_UNRESOLVED`;
conflicting digest yields `HOLD_INTEGRITY_CONFLICT`. Missing or nonambiguous
attempts fail closed. Eight tests cover these outcomes, read-only repeat
lookups, and the CLI's HOLD/zero-retry contract.

This integration does **not** authenticate or bind the journal attempt to
the target receipt: the caller supplies the attempt, idempotency key and
digest independently. A real trusted reconciliation protocol must persist
and verify the exact key/digest/attempt binding in protected state, verify
receipt provenance, and ensure the receipt attests to the actual effect.
`RECONCILED_SYNTHETIC_ONLY` never grants effect authority. No external effect,
protected custody or independent issuer is involved. GE-04 HOLD persists.

## Synthetic attempt-to-receipt binding checks (HOLD)

The integrated test-only workflow now stores one immutable mapping from
`attempt` to `(idempotency_key, request_digest, revision)` in a
`synthetic_bindings` table in the **same unprotected scratch journal**.
Bindings can be inserted only for an `INTENT` at its matching revision; a
unique key prevents two attempts from claiming one synthetic target key.
Read-only reconciliation requires the caller-supplied attempt, key, digest,
and revision to match this stored mapping before looking up the target.
Adversarial tests reject swapped keys, wrong digests, stale revisions,
missing bindings, duplicate keys, and cross-attempt receipt substitution.

**Threat-model limitation:** The caller-controlled scratch SQLite database
is not protected against a writer that can alter both the attempt and its
binding. The target simulator is also caller-controlled and its receipts are
not authenticated. These tests prove *internal consistency* only, not
issuer identity, independent custody, cryptographic integrity, real target
attestation, or final-effect authorization. The existing journal `revision`
is a synthetic attempt revision, not a real policy/approval revision.
Production reconciliation must obtain expected bindings from a separately
protected authority, independently authenticate target receipts, and verify
operation/target identity, approval revision, attempt generation and audience.
No production mutation path is enabled. GE-04 SECURITY HOLD persists.

## Separate synthetic authority registry (logical separation only; HOLD)

`scripts/ge04-q32-inert-custody.py` introduces a second SQLite registry with
immutable `(attempt, idempotency_key, request_digest, revision, audience,
generation)` records. `reconcile_with_authority` checks that independent
*database handle* before the existing journal/target lookup. Adversarial
fixture tests modify coordinator-side journal bindings and demonstrate
mismatches against the separate authority record; they also reject forged
keys/digests, stale revisions, incorrect audience/generation and missing
attempts. A matching authority record plus missing target receipt remains
`HOLD_UNRESOLVED`. The new test suite has 14 tests.

**No security boundary is qualified.** Both scratch databases are accessible
to the same test UID; the test code can call `issue()` on the authority store.
The registry has no independent issuer, authenticated signature, secret,
permission boundary, authenticated receipt, or real effect. A coordinator
with write access to the authority database can forge matching rows. Cross-UID
ownership, path traversal, descriptor delegation, process credentials, and
protected custody have **not** been tested by this slice. The real trusted
issuer must control issuance and protect its state independently before any
claim of resistance to a compromised coordinator. GE-04 SECURITY HOLD remains.

## Cross-UID custody probe prepared — operator execution pending (HOLD)

`scripts/ge04-q32-custody-cross-uid.py` is a Linux-only disposable fixture
probe requiring an explicit `--isolated-test`, four distinct nonroot role
accounts, and **operator-controlled root invocation**. It creates a temporary
issuer-owned 0700 directory and 0600 synthetic binding file; separate
children drop supplementary groups and assume the requested UID/GID before
attempting file read, write, replacement, hard-link creation and directory
listing. Results record each observed UID and operation outcome; the fixture
is checked for unchanged contents. It always exits 78/HOLD, including when
all negative checks pass. The three unprivileged tests only exercise entry
and fail-closed behavior, not the actual four-UID security boundary.

**Not executed with privilege by the agent.** A disposable host operator must
run the privileged probe and retain its raw output. This fixture does not
test an inherited/delegated open file descriptor, Linux ACLs, namespaces,
mount attacks, symlink swaps, target receipt authentication, or a supervisor
read-only verification service. In particular, DAC denial of a path cannot
revoke access to an already-open delegated descriptor. No cross-UID result
is claimed until operator evidence is available. GE-04 HOLD remains active.

Operator-only example (after independently verifying disposable host and
account identities; do not run on production):

```sh
sudo python3 -B scripts/ge04-q32-custody-cross-uid.py \\
  --isolated-test \\
  --issuer alixge04issuer --supervisor alixge04supervisor \\
  --coordinator alixge04coordinator --attacker alixge04attacker
```
