# GE-04 R1-B1 Phase 3B4B — original durable dispatch intent

**CANDIDATE NATIVE SOURCE ONLY · SECURITY HOLD ACTIVE · B1-A–H OPEN**

Phase 3B4B implements a production-intended, root-gated one-shot
*pre-send* transaction custody record in
`native/ge04/protected-dispatch-intent.[ch]`. It is not an enabled
systemd sender, newly created unit witness, or permission to run as root.

## Original attempt to dispatch-intent handoff

The future independently reviewed issuer must have the same original
attempt fence and prebirth journal descriptors, a pinned private
systemd manager subscription, and the Phase 3B4A fixed prepared
StartTransientUnit message on that exact connection.

The new native function `ge04_dispatch_intent_stage` rechecks those
resources and the prepared message's same bus, unique manager
destination, fixed path/interface/member and complete method
signature. It then opens the *already existing* root-owned private
`/var/lib/alix-ge04` directory, exclusively creates the fixed
`dispatch-intent.v1` regular file with `O_EXCL|O_NOFOLLOW`, mode
0600, writes one exact canonical original attempt/boot/nonce and
source/controller hash, manager unique owner, fixed unit and
non-adopting `fail` creation mode. The record's terminal field
`PRE_SEND_INTENT` describes **the moment of record creation**.
It is deliberately **not** a durable assertion that no send ever
occurred.

It fsyncs the file then parent directory, retains the original
file/directory descriptors and inode, compares the path against
those held originals, rereads exact bytes and checks original manager,
attempt and journal custody before returning. Any failure after
exclusive creation leaves the original possibly partial file in
place and poisons the transaction. Neither this API nor the current
controller has a recovery, unlink, replace, adoption or retry path.
An existing marker causes permanent refusal within this candidate
design, including on a new boot, until independently approved
anti-rollback and recovery semantics exist.

**Important limitation:** successful local fsync is not guaranteed
power-loss durability on an unreviewed filesystem. It is not
proof of trusted root storage, legitimate request issuance, or
exclusive birth. A privileged adversary capable of removing the
persistent marker could defeat this source alone. The record does
not contain a true outgoing D-Bus request serial, because no
request has been sent.

## No active privileged path

The `ge04_dispatch_prepared` function still always returns EPERM.
The original `ge04_systemd_create_exclusive` still always refuses.
The controller main still unconditionally exits 77; no root
staging, systemd mutation, cgroup change, service launch, keeper
execution or ACK has been performed.

Root-controlled immutable binary/keeper installation, genuine
pre-request absence proof, a single protected send with actual
request cookie, original birth-time kernel custody, bounded crash
recovery, disposable-VM approval and independent Q13 review remain
OPEN and are required before any privileged invocation.

## Evidence

Unprivileged native C tests exercise the production encoder's
exact original bytes and negative owner, attempt and nonce values,
the root gate on staging/recheck and borrowed-FD cleanup. They do
not execute the successful O_EXCL root write path. Related native
request preparation and default controller refusal tests must
remain green. No model review can substitute for independent
human security acceptance.

## Provisional Phase 3B4B source fingerprints (NOT authorization)

| Native source | SHA-256 |
| --- | --- |
| `native/ge04/protected-dispatch-intent.c` | `1976e53181442d953542d6e067f27e7c2dc96164ab776390661f2011a141eb49` |
| `native/ge04/protected-dispatch-intent.h` | `a15c98e71974e82aa0a74fd5cb4bf4b44f846dc9b3424a90a5b369a14b6b780f` |

The separate model review timed out at the explicit 75-second bound;
there is NO reviewer verdict. The direct targeted/native tests, 36
supervisor tests, TypeScript, DOX and GitNexus detect-changes command
passed, but GitNexus does not index new C symbols. No positive
privileged-path test or human Q13 approval has occurred.
