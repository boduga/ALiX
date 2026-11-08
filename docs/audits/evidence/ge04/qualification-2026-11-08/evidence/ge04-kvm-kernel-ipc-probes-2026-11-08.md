# GE-04 isolated guest kernel and IPC probes - 2026-11-08

Host: microcloud3, guest: alix-ge04-qual-01 (Debian 13.7, kernel 6.12.115+deb13.1-amd64)
Candidate source: d173f9bff27ccf74cf0d66e60d69fe20190550ff
All experiments used disposable credential-free Python test children inside guest, NOT ALiX workers.

## Cgroup and pidfd probe
- Created a fresh guest-local cgroup leaf; removed it after test.
- Forked child, confirmed SIGSTOP before attaching.
- Wrote child's PID to cgroup.procs; read back exactly one PID (child).
- pidfd_open succeeded; pidfd poll signaled exit.
- cgroup.kill terminated child; cgroup.events reported populated 0.
- Eight checks passed.
- First version of IPC check incorrectly expected socketpair SO_PEERCRED to identify child; it identified parent (the socket creator). The test was corrected to validate parent identity, then passed. This is not authenticated child IPC evidence.

## Separate Unix IPC authentication probe
- Created a fresh AF_UNIX stream listening socket.
- Forked child which established its own connection to listener.
- Parent accepted and checked SO_PEERCRED; kernel reported child PID=1670, UID=0, GID=0.
- Parent verified reported PID equals forked child PID, UID=0, and exact challenge payload ALIX-GE04-CHILD-HELLO.
- Three checks passed; socket path removed.
- This demonstrates SO_PEERCRED semantics for a simple guest-local connection. It does NOT demonstrate ALiX production IPC authentication, anti-replay, namespace crossing, or security against hostile workers.

## Security status
- GE-04 security hold ACTIVE.
- No credential-bearing workers launched.
- No host cgroup or security controls changed.
- No PR changes or merge.
- Exclusive ownership was only observed for a newly created single-child test leaf; robust adversarial exclusivity and recovery remain unqualified.
- Next: crash recovery, hostile-worker qualification, and ALiX implementation integration evidence; independent security review required.
