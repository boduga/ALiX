# GE-04 read-only phase controller — fail-closed qualification prototype

**Status:** GE-04 SECURITY HOLD ACTIVE · R1-B1 OPEN. **NOT an ACK controller**.

`native/ge04/phase_controller.py` adds the first composite controller-side
phase state machine to the existing sealed receipt, read-only systemd manager
and live kernel observer components. The module enforces exactly eight
diagnostic slots, canonical original-record shape, native event grammar,
strict six-step preterminal phase order, monotonic deadline checks, poisoned
state on failed observation, and terminal quarantine. Its default observer
uses `unit_kernel_observer.observe_manager_and_kernel`.

For each expected phase it consumes an **untrusted** native `EV` line,
observes manager/kernel correlation and the bound keeper PID/start generation,
and preserves an immutable local evidence record. `DENIED` immediately
quarantines. `EMPTY` is accepted only after a previous phase and **still
quarantines** because a terminal diagnostic cannot establish complete
descendant cleanup, exclusive tree ownership or successful recovery.
Any malformed, replayed, reordered, expired, inconsistent or unsupported
observation poisons the instance. `issue_ack` always raises
`PermissionError`. There is **no file descriptor, pipe, socket, root
operation, worker admission, cgroup mutation, ACK emission, or production call**.

The original record is validated through the exact canonical sealed-binding
schema; the code does not authenticate who supplied it. The observer callback
can be replaced by a test caller; even the default real observer cannot
independently prove original service creation, original unit absence, protected
pre-birth record or mount/root custody. The prototype **cannot interrupt a
blocked observer callback** and therefore must never be connected to a
privileged helper. A supplied absolute monotonic deadline is checked before
and after observation only. Evidence is an unqualified diagnostic, not a
release witness. No source hashes, nonces or model results constitute
security approval.

`tests/agents/test_ge04_phase_controller.py` tests all six ordered phases,
replayed/out-of-order input, DENIED/EMPTY quarantine, malformed process hints,
missing/wrong kernel witness, invalid originals, deadline expiry and
unconditional ACK refusal. Positive tests use mocked witnesses and do not
run the native privileged fixture. The existing native ACK test remains a
separate unprivileged frame-parser test.

**Next required implementation:** independent root-owned original intent
publication and exclusive initial systemd unit creation; held kernel
mount/namespace/cgroup descriptors; a protected bounded controller process
with authenticated IPC and one-use phase authority; independently witnessed
terminal/cleanup recovery; reviewed disposable-VM fault injection; independent
human security review and Q13 release decision. No gate is cleared by this
prototype. Preserve GE-04 hold.
