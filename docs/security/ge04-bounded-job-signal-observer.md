# GE-04 isolated bounded systemd JobRemoved observation

**State:** R1-B1 OPEN · GE-04 SECURITY HOLD ACTIVE.

`native/ge04/bounded_job_signal_observer.py` and
`native/ge04/isolated_job_signal_worker.py` wrap the existing actual
read-only systemd `JobRemoved` listener in a **separate unprivileged
Python subprocess**. The outer parent requires a supplied absolute
monotonic deadline at most three seconds ahead and kills/reaps the child
on deadline expiration, including a stall in synchronous system-bus
connection, Subscribe, Unsubscribe or other setup/cleanup. Its single
canonical input line contains a fixed expected job and a 1–2000 ms
inner GLib event window (request cap 256 bytes). The parent uses
selector-driven nonblocking pipes and stops as soon as stdout exceeds
256 bytes; nonzero exit, absent response, duplicate/malformed JSON,
noncanonical serialization, wrong expected manager/job/unit, or a
late response fails closed. No extra file descriptors are deliberately
passed to the subprocess, and root invocation is refused.

The worker itself runs with `python -I` under its invoking
unprivileged UID and uses the existing real D-Bus/GLib listener. It
has no systemd unit mutation, root issuer, cgroup operation,
phase-ACK writer, recovery or worker admission path.

**Limits:** This adds a hard deadline to an *unprivileged diagnostic*
call, not to any protected issuer or systemd creation transaction.
The expected job identity and the worktree source remain
caller-controlled; the child response is ordinary public JSON and can
be forged by code under the same UID. A correctly formatted positive
result remains exactly
`UNQUALIFIED_LIVE_SYSTEMD_JOB_SIGNAL`, **never** an authorization
credential. No evidence proves the listener was registered before a
particular exclusive `StartTransientUnit` request, that a real job
created a new unit, or that the original keeper/cgroup/mount identities
are independently protected. Process kill/reap does not substitute for
external root-owned journal recovery or manager-side subscription
cleanup confirmation.

Tests run entirely unprivileged. They include a deliberately hanging
mock subprocess, 10 MB output flood, nonzero exits, malformed and
wrong-generation evidence, canonical but forged positive evidence,
bad deadlines/window budgets, root denial, and a quiet live system-bus
negative observation. No systemd unit is created or modified.
Source/binary review, trusted original root issuance, protected
creation-job handoff, approved disposable VM and Q13 remain gating.
