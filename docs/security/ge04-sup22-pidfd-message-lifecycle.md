# GE-04 SUP-22 — pidfd sender lifecycle observation

**GE-04 SECURITY HOLD remains in force. Experimental, inert Linux fixture only.**

`experiments/ge04/pidfd-message-lifecycle.py` opens a pidfd for a fixture-pinned sender, snapshots the `/proc/PID/stat` process birth ticks and `/proc/PID/exe` device/inode (using the existing SUP-11 observer), and verifies that the original pidfd has not signalled process termination before and after each SUP-20 kernel-credential datagram receive. Each datagram still must match the pinned PID and UID. Closing the pin prevents further reads.

`experiments/ge04/test-pidfd-message-lifecycle.py` uses a separate live forked sender to verify live-message acceptance, deliberately wrong birth-tick rejection, denial after sender exit, and denial of an already-queued datagram after its original sender has exited. It also verifies that a dead numeric PID cannot establish a new pin and that a new live sender must have its own pin. The regression runs in the GE-04 CI job.

## Limitations

A pidfd is kernel-bound to the process that existed when it was opened, but `SCM_CREDENTIALS` contains numeric PID/UID, **not a pidfd**; establishing that the datagram and pin refer to the same process is not a single atomic kernel operation. PID reuse between message emission, pin acquisition, and checks; PID namespaces and `/proc` access restrictions; provisioner trust; same-UID compromised process; forwarding by an authorized process; and close-after-check races all require separate analysis. The fixture must establish the pin before accepting messages and fail closed on exit. This does **not** provide a nondelegatable authorization primitive, an independently privileged supervisor, durable approval/lease/revocation serialization, or authenticated terminal receipts. Never connect this experiment directly to production mutation authority. The SUP-16 old stream-socket descriptor-transfer counterexample remains valid.

PR #1039 stays unmerged pending independent review and remaining GE-04 gates.
