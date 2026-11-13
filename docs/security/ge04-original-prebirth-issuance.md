# GE-04 two-stage original pre-birth issuance contract

**Decision:** R1-B1 OPEN; GE-04 SECURITY HOLD ACTIVE. The code is a
non-authorizing pure state machine, **not** a root-owned publisher,
protected journal, systemd service creator, or production controller.

## Why original approval alone cannot prove pre-birth authorization

The existing native `approval.v1` file includes the *unit cgroup's*
`st_dev/st_ino`. In a genuinely new fixed systemd unit, that directory
identity is obtained **after** the unit is created. Therefore a currently
existing approval with matching cgroup identity is not independently
verifiable evidence that permission was issued **before** the service
was born. It can only be a later corroboration of a separately held
pre-birth issuance record. Existing `protected_approval_observer.py`
checks current file custody; it cannot establish creation order.

## Required two-stage authority separation

1. **PREBIRTH (before service creation):** a separately authorized root
   issuer must establish the fixed unit **does not exist**, commit an
   original durable and immutable intent with exactly one attempt number,
   expected boot ID, unpredictable nonce, fixed unit, reviewed source and
   controller digests, and the approved root scope. It must exclusively
   own the original journal and persist the intent before attempting the
   creation. If any step fails, preserve the journal and quarantine.
2. **BIRTH_OBSERVED (after authorized new creation):** a separately
   protected observer must obtain the actual manager invocation, no
   restart, original keeper PID/start ticks, mount identity and exact
   cgroup ancestry, **not** from the publisher's self-report. The
   observation must match the same immutable `bootId/attempt/nonce/unit`
   fence. Only then may a post-birth sealed record be assembled for
   additional independent review. A matching record alone is not a
   privileged phase ACK.
3. **QUARANTINED:** existing/adopted unit, ambiguous unit absence,
   missing durable original, crash between publish/create/observe,
   interrupted ACK, restart, generation mismatch or unavailable kernel
   custody prohibits automatic adoption or cleanup. Recovery requires
   separate reviewed original-journal and exactly owned-unit proof.
   No name scan, numeric-PID fallback or resetting the attempt.

`native/ge04/prebirth_issuance_contract.py` models these transitions in
memory, with strict canonical prebirth and birth claim schemas, replay
refusal and irreversible quarantine. It uses the shared exact sealed
bootstrap-binding parser for the assembled post-birth record.
`issue_approval`, `issue_ack`, and `recover` deliberately deny all
authority. Its two booleans (`unit_absent_before_creation`,
`original_durable`) are **assertions supplied by the caller**, not
trusted predicates or protected credentials. Reconstructing this object
after a crash does not constitute recovery. It has no filesystem write,
D-Bus mutation, root operations or production consumer.

## Independent trust requirements not implemented

A trusted root issuer must retain the original issuance record under
root-only immutable custody, with a crash-safe durable ordering barrier.
An independent reviewer/controller must verify exclusive unit creation,
authenticated manager invocation and original keeper generation, pin
mount namespace and original cgroup FD identity, and hold a separately
authenticated phase channel. The existing C fixture's `approval.v1`
must be minted only *after* the verified unit cgroup comes into existence,
and be bound to the earlier original attempt; it cannot replace it.

The eventual root implementation requires an independently reviewed
source/binary hash, scoped one-purpose staging, exact compiled
privilege permissions, negative fault/crash and witness tests in an
**explicitly approved disposable Linux VM**, and Q13 human acceptance.
Do not change the default-deny native build, lift quarantine, create
unit/service state or run repo source as root based on this contract.

## Local evidence

`tests/agents/test_ge04_prebirth_issuance_contract.py` checks complete
two-stage claims, missing durable/absence assertions, malformed records,
unit restart, replaced boot/attempt/nonce, wrong keeper/cgroup, replay,
quarantine after crash and unconditional privilege refusal. The positive
test demonstrates only *internally consistent caller-supplied values*,
not independently authenticated provenance.

## Independent model review finding and correction

Read-only review found a P2 fail-closed transition defect: a repeated
`observe_birth` invocation was rejected but had previously retained the
`UNQUALIFIED_BIRTH_OBSERVED` state and record. Corrected the guard to
**quarantine and discard the prior record before rejecting** any unexpected
second observation. The replay regression now explicitly asserts terminal
`UNQUALIFIED_QUARANTINED`, the replay reason, and continued refusal of later
claims. This is engineering model review, not independent security approval.
