# GE-04 SUP-22b — sender pidfd attached to each datagram

**SECURITY HOLD — inert fixture, not production authority.**

## Gap addressed

SUP-22 compared numeric sender PID/UID from `SCM_CREDENTIALS` with a pidfd opened independently. A numeric PID is not a stable kernel object across process death and reuse. On Linux 6.8, `SO_PASSPIDFD` makes `recvmsg` attach `SCM_PIDFD`, a kernel-created descriptor for the process associated with the datagram. `experiments/ge04/kernel-bound-datagram-sender.py` requires **both** `SO_PASSCRED` and `SO_PASSPIDFD`, refuses missing or truncated control data, unknown ancillary records and delegated `SCM_RIGHTS` handles, and always closes received descriptors.

The fixture opens its expected sender pidfd **before messages are accepted** and keeps it open. It requires that pin to be live before and after receiving a message, compares the `Pid` and `NSpid` fields from **both pidfds** via `/proc/self/fdinfo/<fd>`, and verifies the message's UID against the pinned fixture UID. The pinned process must still be live at the final check. This eliminates the window in which a different live process with a recycled numeric PID could pass while the pinned original is still alive. When the original exits, the post-receive pidfd poll fails closed. No fallback to numeric `SCM_CREDENTIALS` alone is allowed. The kernel-created message pidfd is preferable to reopening a PID after `recvmsg`.

**Rejected design discovery:** Comparing the two pidfds' `fstat().st_dev/st_ino` is invalid: on the Linux 6.8 runner, different process pidfds have identical `st_ino` values. A regression caught a same-UID inherited-socket sender incorrectly passing with that design, so it was discarded before commit.

## Tests

`test-kernel-bound-datagram-sender.py` exercises a legitimate live sender, a same-UID forked process using the inherited socket, a valid sender after an attempted impersonation, unexpected `SCM_RIGHTS` with no fd leak, oversized/empty frames, missing `SO_PASSCRED` or `SO_PASSPIDFD`, a closed pin, and a queued message from a process that exited before receipt. `test-kernel-bound-datagram-root.py` is privileged and passes an existing connected datagram descriptor to an independently dropped UID 65534; it expects denial while the original root sender still works.

## Remaining conditions and limits

- This is valid only for the defined threat model: an independently provisioned, live process pin; untrusted *unprivileged* senders; a trustworthy kernel, procfs, and receiver's PID namespace. `fdinfo` projections must be visible and consistent; otherwise reject.
- The sender-pidfd comparison is not an atomic kernel `pidfd == pidfd` operation. It relies on a concurrently live pinned process keeping the PID uniquely occupied, plus fail-closed exit checks. A process may exit immediately after the final check. **This is not an atomic commit/mutation authorization boundary.**
- A privileged sender with capability to forge `SCM_CREDENTIALS` (notably `CAP_SYS_ADMIN`) is outside the demonstrated protection. A compromised authorized process or authorized proxy can still send/forward. Credential theft, PID namespaces, procfs mounting differences, and privileged tampering need separate review.
- `SO_PASSPIDFD` is Linux-specific and requires kernel support (introduced in Linux 6.5). If it is unavailable, setup must fail closed, not downgrade to PID-only checks. Python may not expose constants even when the running kernel supports them; the Linux UAPI numbers `SO_PASSPIDFD=76` and `SCM_PIDFD=4` are used where missing.
- Existing AF_UNIX **stream** transport remains vulnerable to the SUP-16 descriptor handoff. This datagram experiment does not secure that transport, supply an independently authoritative supervisor, serialize approval/lease/revocation with a final mutation, or persist authenticated terminal receipts.

**PR #1039 remains unmerged; production mutation execution remains disabled.**
