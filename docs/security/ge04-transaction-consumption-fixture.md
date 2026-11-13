# GE-04 durable-consumption marker (unprivileged fixture only)

**State:** R1-B1 OPEN · GE-04 SECURITY HOLD ACTIVE.

The new transaction_consumption_fixture.py exercises one missing failure
boundary: cross-source birth packets are accepted by OneShotBirthPacket in
memory, but process restart loses its state. The fixture writes an
**exclusive** single-use marker in a private unprivileged directory *before*
evaluating a caller-supplied reconciliation packet. The marker contains the
canonical original attempt, nonce, and SHA-256 of existing prebirth-intent.v1.

It uses a fixed name birth-consumption.v1 with no-follow exclusive creation,
mode 0600, file fsync and parent-directory fsync. The marker's original inode
and the earlier prebirth journal inode must remain stable. Failed, partial,
interrupted or previously present markers are never removed or adopted.
Reopening after a restart returns UNQUALIFIED_QUARANTINE_ON_RESTART even
when exact bytes are valid. Repeated consumption in the same directory fails
O_EXCL. A successful single reconciliation is only
UNQUALIFIED_JOURNALED_PACKET_CORRELATION, not approval or worker admission.

Fault tests inject interruptions after write, after file fsync, after
directory fsync and after reconciliation. Other tests check failed packet
reconciliation, replay, symlink substitution, wrong original, same-content
file replacement, root denial and nonprivate directory mode.

**Non-security boundary:** this is a disposable fixture in a **user-owned,
user-writable** directory. The same UID can unlink its marker or recreate
its directory. This demonstration DOES NOT establish protected durable replay
prevention, power-loss durability, a trusted monotonic attempt counter or
independent original source custody. File fsync does not make systemd birth,
D-Bus job completion and cgroup correlation atomic. The packet contains
caller-supplied manager, kernel and live-event claims; an internally
consistent fabricated packet remains possible. No result is authorizing.

A separately reviewed protected root issuer must exclusively maintain an
original consumed/poisoned attempt journal through reboot and crash; refuse
adoption of a pre-existing fixed unit or lost signal; authenticate the
creation request and job completion; pin the original kernel identity and
cgroup ancestry, and enforce no approval without separate human review.
No root tool, systemd unit mutation, ACK, cleanup, recovery or production
admission was implemented. Approved disposable VM and Q13 still gate release.

## Review finding and amendment: bind result to consumed original

An adversarial review reproduced a mutable packet being changed after the
consumption file was fsynced. Without a final digest check, reconciliation
could return a self-consistent different attempt than the one whose original
journal digest was consumed. The fixture now requires the resulting
`UNQUALIFIED_CROSS_SOURCE_BIRTH_CORRELATION.prebirthSha256` to equal the
persisted claim AND the post-check canonical prebirth bytes to equal the
original read journal. A regression changes nonce, journal bytes, creation
and completion digests, original receipt and birth claim inside the fault
callback; the attempt is refused and the marker remains permanently consumed
within that disposable directory. These checks are still not independently
protected against same-UID malicious mutation or cross-process races.
