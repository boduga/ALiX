# GE-04 Phase 3B4G — bounded native operation plan

**REVIEW-ONLY DESIGN. SECURITY HOLD ACTIVE.** No root execution, StartTransientUnit send, ACK, worker admission, privileged cleanup, or gate closure. This plan does not claim that existing diagnostic code enforces a blocking-operation deadline.

## One protected owner, one irreversible attempt

The future native controller must own the attempt journal, original intent dirfd/inode, retained authenticated system bus and manager owner, and birth-time keeper/mount/cgroup descriptors. It must be the only component allowed to mutate the attempt state. A process crash or loss of these resources after pre-send intent cannot be repaired by caller-supplied evidence or a new process; the attempt remains quarantined. The current nonexecuting sender and diagnostic-deadline C files have none of these authorities.

## Absolute monotonic deadline: operation-by-operation review matrix

| Boundary | Blocking hazard | Required reviewed mechanism | Timeout or ambiguity |
| --- | --- | --- | --- |
| Original journal and fsync | filesystem stall, write partial, fd close | independent absolute-budget enforcement for every write, sync and directory sync; record durable original inode before send | quarantine; never infer that intent was not persisted |
| Bus connect/auth | blocking socket connect, authentication and name owner query | nonblocking fd with poll/epoll on *remaining* CLOCK_MONOTONIC budget; verify SO_PEERCRED and authenticated manager identity on retained connection | quarantine, close held resources only if bounded and safe |
| Subscribe | synchronous method reply, signal ordering | install signal match before any request; bounded asynchronous reply on retained bus | quarantine; no creation |
| Pre-send original recheck | namespace/procfs/descriptor inspection may block | bounded read-only kernel checks with retained descriptors, no replacement by path lookup | quarantine |
| Fixed request transmit | partial write, EAGAIN, EINTR, disconnect after partial write | exactly one queued method on retained bus; persist irreversible intent *before* possible send; derive serial from actual outbound transport result | any uncertain delivery quarantines; no resend |
| Reply and JobRemoved | no reply, early/late signal, manager swap | correlation to outbound serial, retained bus and original manager; bounded event processing with absolute remaining budget | quarantine; job success is not birth proof |
| Keeper/cgroup birth corroboration | procfs or cgroup read stalls, PID reuse | retained pidfd/dirfds, independent birth-time original binding, bounded reads | quarantine; no ACK |
| Terminal/cleanup | uninterruptible kernel I/O, stuck cgroup, missing witness | independently approved external witness and separately bounded cleanup procedure | quarantine; do not claim cleanup or retry |

**Important:** A timeout before or after a synchronous syscall is not an enforceable deadline for that syscall. A polling loop must recompute remaining time from the original absolute deadline, and handle EINTR without resetting it. Any syscall that cannot be made nonblocking or safely isolated is a **design blocker**, not an exception to the deadline. Closing a socket does not guarantee cancellation of an already delivered method.

## Native interface contract to review before any operational sender

Proposed `ge04_operation_context` contains the protected attempt generation, original immutable intent descriptor, retained bus identity, outbound serial captured by the sender, one absolute monotonic deadline, and absorbing quarantine state. Only the future separately reviewed native sender may populate transport-origin fields. An untrusted diagnostic cannot construct or deserialize an authoritative context.

Proposed primitive operations (not implemented here):

1. `remaining_budget(ctx)` samples CLOCK_MONOTONIC and fails closed on clock error, overflow or expiry.
2. `wait_fd_until(ctx, fd, events)` waits only for nonblocking readiness; each retry uses the original absolute deadline, never a refreshed interval.
3. `record_intent_once(ctx)` durably commits original one-shot intent and fences generation before any possible transmission.
4. `send_once(ctx, prepared)` binds a transport-produced serial on the held bus, never from a caller parameter; any uncertain result is irreversible.
5. `observe_reply_and_job(ctx)` correlates reply/job under manager and bus custody and refuses replay or owner changes.
6. `quarantine(ctx, cause)` is absorbing and cannot be cleared by process restart or caller action.

These APIs are **design sketches only**, not authorization to add root-callable code.

## Required negative tests and evidence

| Fault injection | Required result |
| --- | --- |
| Poll timeout, EINTR storm, repeated EAGAIN | same original deadline; terminal quarantine, no busy loop or retry of send |
| Blocking connect/auth/subscribe and blocked fsync | bounded failure or explicit unresolved design blocker |
| Disconnect or crash during partial send | ambiguous delivery, quarantine, no second send |
| Reply serial mismatch, bus replacement, manager restart, early/duplicate JobRemoved | quarantine; no worker admission |
| Missing original journal, reused generation, swapped kernel descriptors | quarantine before birth claim |
| Close/teardown hangs, process loss during cleanup | quarantine and independently verified external recovery; never infer empty subtree |
| Exact synthetic transcript and matching supplied deadline | still UNQUALIFIED; no authority |

Tests must capture monotonic start/end, raw syscall outcomes, journal bytes and inode, fd/peer identity, exact bus serial origin, phase/cgroup evidence and independent witness disposition. Synthetic/unit tests are useful for rejecting invalid inputs, but cannot clear B1-A–H.

## Explicit decision

**NO-GO:** Existing `diagnostic-deadline.c` samples CLOCK_MONOTONIC but does not bound any blocking call. Existing `nonexecuting-sender-contract.c` consumes supplied observations, not authenticated D-Bus facts. The protected native controller still refuses execution; no sender or ACK is present.

**Next legitimate step:** implement and test a *nonprivileged*, standalone nonblocking-fd wait primitive with a shared absolute deadline, including EINTR, EAGAIN and peer-loss adversarial tests. Keep it completely disconnected from systemd and root until independent source review.

## Unprivileged adversarial fixture results and remaining gaps

The standalone `test_ge04_diagnostic_fd_wait.py` exercises periodic SIGALRM interruptions against a single absolute 50ms budget, repeated empty nonblocking-pipe reads yielding EAGAIN, and numeric descriptor reuse. The test deliberately demonstrates that readiness can succeed on a *replacement* descriptor: numeric fd equality is **not** original-descriptor custody. No cancellation token or concurrent cancellation wakeup is implemented. Cancellation races remain an open requirement, not a passing security proof. The fixture never transmits data, authenticates a bus, or supplies privileged authority.

## Cancellation wakeup diagnostic (non-authorizing)

The standalone wait fixture now accepts an optional nonblocking cancellation descriptor, polls it alongside the data descriptor and quarantines on cancellation, including simultaneous data readiness. A second zero-time cancellation probe narrows but **cannot eliminate** the race between the last probe and return or any later I/O. A caller must retain original descriptor custody: fd number reuse is not authenticated, and this primitive does not solve it. It does not bound fcntl, descriptor close, systemd calls, or other blocking operations. The test child only writes to a local pipe and cannot authorize root operations.
