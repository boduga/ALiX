# GE-04 Phase 3B4F — trusted transport origin and bounded lifetime

**DESIGN ONLY — SECURITY HOLD / NO-GO.** All B1-A–H remain open. No sender, privileged execution, root staging, ACK, cleanup, worker admission, or Q13 release is authorized.

## Trust boundary

The Python `bounded_dispatch_evidence.py` reducer checks only caller-supplied values. Its `elapsedMs`, `requestSerial`, manager, and job path are not evidence that a D-Bus request was actually sent. The existing native transaction's `request_cookie` has no trusted writer. No future component may convert a matching diagnostic transcript into permission to dispatch or admit a worker.

The eventual *sole* privileged sender must be a separately reviewed immutable binary, launched from protected installation with independently verified source/binary/toolchain provenance. It must retain the original root-owned attempt journal, intent inode/dirfd, authenticated private system bus, manager unique name and credentials, and birth-time kernel descriptors in one protected lifetime. An unprivileged caller, model, worktree script, log, sealed memfd or replayed message cannot supply those holdings.

## Proposed transport-origin contract

1. **Before any request:** Validate source provenance and original attempt generation; retain the original manager connection and verify the manager's unique owner and root credentials. Subscribe to the exact JobRemoved stream before creating a request. Check fixed unit absence, recognizing this is not an atomic exclusion lock. Durably write the irreversible one-shot pre-send intent before any possibility of sending.
2. **Single outbound operation:** A reviewed native sender must construct the fixed StartTransientUnit method call on that *same* retained bus. The sender itself obtains the outgoing nonzero D-Bus method serial from the actual transport send result and binds it to the original attempt, bus identity, immutable request bytes and durable intent. A caller-provided serial, an observed reply serial, or a fabricated event is never a substitute.
3. **Uncertain send:** Once intent exists, any crash, lost connection, timeout, failed send with uncertain transport outcome, owner swap or lost cookie quarantines permanently. There is no second send, new unit name, adopted unit, reset of the journal or automatic cleanup. A local send failure does not by itself prove the manager never received the request.
4. **Reply correlation:** Match method reply to the transport-issued cookie, retained bus and manager generation. Validate the exact fixed job path and bind the matching JobRemoved event. An early JobRemoved can be buffered only under bounded, authenticated subscription custody; duplicate/conflicting/late events quarantine. A successful job does not establish exclusive birth or keeper/cgroup custody.
5. **Original birth:** The original invocation, keeper generation/pidfd and namespace/mount/cgroup dirfds must be independently held at birth time. Later snapshots cannot retroactively establish that custody. No ACK or worker admission is available until the independent phase, terminal and human-review gates are separately cleared.

## One absolute lifetime budget

The eventual sender must use a single monotonic, absolute deadline across connection setup, authentication, subscription, pre-send fence, request transmission, reply, job event and final corroboration. It must bound *blocking* native operations (not merely inspect timestamps after they return). A timeout, cancellation, signal interruption or process loss enters irreversible quarantine. Never reset the deadline per step; avoid synchronous unbounded D-Bus setup, teardown, destructor, fsync or worker waits. Record a separately verified failure mode for any operation that cannot be interrupted safely. The 3000ms field in the Python diagnostic is **not** this lifetime guarantee.

## Mandatory adversarial tests before enabling anything

- Forged and zero outbound serial; wrong manager/owner, bus replacement, serial replay, swapped reply or job; early, duplicate and missing JobRemoved.
- Crash before send, during send, after send before reply, after reply, and during birth observation; journal rollback/loss; process restart and same-unit adoption attempt.
- Absolute deadline exhaustion during every blocking operation, including connection, subscription, send, reply, cleanup and descriptor close; stalled peer, event flood and cancellation race.
- Original keeper pidfd, mount namespace/mount ID, superblock/root, unit/ancestor dirfd substitution and late-born lookalikes.
- Independently observed witness survival and terminal empty descendants under separately approved disposable-VM fault injection; record raw evidence and reviewer disposition.

## Implementation boundary and hold invariants

Existing `native/ge04/protected-dispatch-preparation.c` and `protected-systemd-transaction.c` remain non-sending. `ge04_dispatch_prepared` and `ge04_systemd_create_exclusive` must always deny; `protected-root-controller.c` must return 77. The unprivileged Python diagnostic and its tests are not wired into native authorization. Do not add a transport sender, service, sudoers, capabilities, privileged test or production consumer in this change.

**Next prerequisite:** independent native source and immutable-binary provenance review; then a separately reviewed non-executing sender interface and bounded native operation plan. Only a named disposable VM, explicit operator authorization and independent security acceptance can move the B1 gates.
