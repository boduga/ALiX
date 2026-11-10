# GE-04 bounded isolated read-only phase observer

**Status:** R1-B1 OPEN · GE-04 SECURITY HOLD ACTIVE. This is NOT a
privileged controller, authenticated evidence issuer, or phase-ACK authority.

The controller's **default** manager/kernel observer now runs in a distinct
unprivileged `python -I` child process
(`native/ge04/isolated_phase_observer_worker.py`), supervised by
`bounded_phase_observer.py`. The parent accepts only a canonical bounded
original intent, requires an absolute monotonic deadline with at most 3
seconds remaining, opens no privileged handles, passes no extra descriptors,
and uses nonblocking selector-driven pipe I/O. The complete request must fit
the existing sealed bootstrap schema (4,096 bytes). Child output is read
incrementally and rejected above 1,024 bytes. Any invalid exit, missing
unit, bad response, changed generation, timeout or partial output fails
closed. A timed-out child is killed and reaped, not left as a stuck in-process
callback. The only accepted response is a canonical, exactly shaped
`UNQUALIFIED_MANAGER_KERNEL_CORRELATION` with the expected keeper PID and
start-generation. Even a syntactically valid response has no authorization
value.

The worker imports the fixed read-only systemd and kernel observation code,
using the repository-local sibling Python files. It is isolated from Python
environment imports but **does not authenticate source-file custody**; the
worktree remains editable by its owner, and no protected binary/source-hash
staging or new systemd unit birth has occurred. The child inherits the user's
ordinary UID (never runs as root), and performs only existing D-Bus, procfs,
pidfd and cgroup read operations. No descriptor is passed to the native
helper, and **no phase ACK is constructed or sent**.

The `ReadOnlyPhaseController` invokes this bounded child **only for its
default observer**. Supplying a callback remains an explicitly non-authorizing
test seam: a caller-supplied callback is still in-process and has no hard
timeout. Injected callbacks are not permitted as evidence for privileged
qualification. The controller keeps its unconditional `issue_ack`
PermissionError, phase-order checks, terminal quarantine and refusal
behavior. The parent process itself is not an independently protected issuer.

New tests exercise a genuinely missing fixed unit, a hanging process killed
at the deadline, overlong/bad/mismatched output, and intentionally forged
publicly formatted evidence, demonstrating that even a format-valid test
witness does not enable an ACK. They are unprivileged and use no systemd
unit creation or cgroup mutation. This is engineering validation, not a human
security signoff.

**Unresolved security gates:** trusted root-owned pre-birth publication and
exclusive unit creation, original keeper/mount/cgroup FD custody, authenticated
protected controller IPC and ACK authority, root-owned executable and source
staging, immutable recovery fencing, independent source review, approved
disposable-VM qualification and explicit Q13. The worktree subprocess is
not safe to connect to a privileged worker path.
