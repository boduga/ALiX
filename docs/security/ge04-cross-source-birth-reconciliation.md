# GE-04 cross-source unit-birth reconciliation — diagnostic only

**Status:** R1-B1 OPEN · GE-04 SECURITY HOLD ACTIVE.

`native/ge04/cross_source_birth_reconciliation.py` composes existing
individually UNQUALIFIED records into one **single-use diagnostic consistency
check**. It requires exact canonical prebirth bytes and a matching journal
fixture, fixed unit absence observation, the non-replacing systemd creation
claim, the expected `JobRemoved` event, the bounded real-listener's exact
`UNQUALIFIED_LIVE_SYSTEMD_JOB_SIGNAL` response, job completion, the systemd
manager's observed invocation and keeper, canonical postbirth original receipt,
postbirth attempt claims, and kernel keeper start ticks, cgroup mount
identity and exact unit scope.

The check demands agreement on original attempt/nonce/source digests,
original byte SHA-256, manager unique owner, job path, invocation ID,
keeper PID/start generation, mount ID/device, cgroup scope and postbirth
ancestry claims. Mismatched, absent or incomplete records are refused.
`OneShotBirthPacket` quarantines permanently after a failed attempt or a
second call. Its approval, recovery and unit-creation methods are
unconditional refusals.

**Critical distinction:** all inputs are STILL supplied by the calling
process. Although the forms match existing read-only observer outputs,
this reconciler does **not** call those observers or authenticate their
source, independence, lifetime, publisher, transaction or ordering.
A single attacker-controlled caller can fabricate an internally consistent
packet. A complete packet returns only
`UNQUALIFIED_CROSS_SOURCE_BIRTH_CORRELATION`, never authorization.

The live listener's output itself is plain JSON and remains untrusted;
the supplied raw event and live-signal summary agreeing does not prove
they represent independent sources. Neither existing kernel observation
nor this packet proves original directory **ancestry custody** by itself:
ancestry is checked against two supplied records, and a separately held
root-owned cgroup FD chain remains B1-D. There is no durable replay
database, source-staged root process, signed provenance or authenticated
unit-creation request. In-memory single-use is not restart-safe.

Tests use fully synthetic evidence to verify cross-source mismatch
quarantine, replay refusal, absent evidence, immutable mapping inputs,
manager/keeper/mount fencing, job-event disagreement and live-listener
summary disagreement. They do not create a systemd unit, modify cgroups,
run root, send phase ACK or clear any security gate.

**Next substantive boundary:** a separately reviewed protected issuer must
supply provenance-tagged retained original prebirth evidence, actual
exclusive creation request and verified completion in the *same protected
subscription lifetime*, plus independently pinned manager/keeper/kernel
descriptors and durable anti-adoption recovery. Disposable-VM root
qualification and human Q13 remain blocked until explicitly approved.
