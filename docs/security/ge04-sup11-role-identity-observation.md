# GE-04 SUP-11: Linux IPC role identity observation

**SECURITY HOLD: test-only observation, never admission or execution authority.**

The standalone SUP-11 fixture compares `SO_PEERCRED` PID and UID with expected test identity, inspects the process executable inode and start-time ticks, and opens a pidfd. Matching returns only `ROLE_IDENTITY_OBSERVED_UNTRUSTED`.

The adversarial regression tests mismatched PID, UID, executable identity and process birth; stale terminated processes; and a connected socket descriptor inherited by another process. The latter still identifies the original socket peer, not its new holder, so peer credentials must never be treated as proof of the current message sender or coordinator role.

Expected identity values remain supplied by a fixture, not an independently provisioned coordinator trust root. A pidfd opened after a connection does not retroactively make establishment atomic. No authenticated coordinator protocol, authority consumption, revocation fence, protected receipt, mutation service, or production integration is present. The test runs in Linux CI. Keep PR #1039 unmerged.
