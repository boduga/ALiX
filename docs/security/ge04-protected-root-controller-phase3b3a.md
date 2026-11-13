# GE-04 Protected Root Controller — Phase 3B3A: native post-job read-only verification

**SOURCE CANDIDATE ONLY — ALL R1-B1 GATES OPEN — SECURITY HOLD ACTIVE.**

This increment adds native C source to observe the systemd fixed unit after
the source-level transaction has received **both** a matching method reply
and one matching `JobRemoved=done` signal. It is not a new synthetic Python
validation layer and it does not send any creation request.

## Implementation

- `native/ge04/protected-systemd-birth-observer.[ch]` accepts original
  held attempt-fence and pre-birth-journal descriptors and the existing
  `ge04_systemd_transaction` object.
- Before any property read, it requires the same held transaction to have
  subscribed, retained a nonzero outgoing cookie, bound a method reply,
  and observed a matching completed job. A root caller without all of
  these is refused. **Current production source never sends the request
  or sets its cookie; only test wrappers simulate this prerequisite.**
- Uses the retained private bus and pinned manager unique name. Queries
  `Manager.GetUnit` for exactly the fixed service, requires the canonical
  escaped systemd object path, then reads fixed `Unit` and `Service`
  properties: exact Id, loaded/active/running, exact cgroup scope,
  `MainPID` in range 2..INT32_MAX, zero `NRestarts`, and a nonzero
  16-byte `InvocationID`.
- Reads two independent property snapshots with the original
  `ge04_systemd_recheck_original` before, between and after them.
  The recheck corroborates original attempt/prebirth descriptor custody,
  manager root UID/unique owner and a bounded drain of queued job signals.
  PID or invocation changes, manager changes, missing/invalid values,
  or any API failure poison the transaction.
- Even an exact match returns only a
  `ge04_unqualified_birth_view` with `unqualified=1`. No native ACK,
  keeper adoption, worker admission or special success state exists.

## What this does NOT prove

A matching current unit could be a pre-existing service, a substituted
process, or a restarted process outside the sampled moments. D-Bus
snapshots are observations, not independent original birth proof. This
implementation **does not verify pre-request unit absence** in a protected
atomic transaction, authentic creation, immutable executable custody,
original keeper pidfd/startticks, original mount namespace/superblock,
the cgroup2 root/ancestor directory FDs, unit generation under races,
or a crash-safe externally protected journal.

It also has only a **per-method** D-Bus timeout inherited from the
transaction; it is not an end-to-end process deadline. A separate
independently reviewed and authorized root controller/host supervisor
and disposable-VM fault tests remain necessary.

The controller main still exits 77 unconditionally, the
`ge04_systemd_create_exclusive` path still denies with EPERM,
and the fixed request serializer remains unconnected and unsent.

## Evidence and review

Unprivileged link-time native C wrappers exercise a stable snapshot
(still explicitly unqualified) plus 11 adversarial variants: GetUnit
path/lookup failures, incorrect cgroup, PID or invocation changes,
manager failure, nonzero restarts, malformed or zero invocation,
inactive unit and incomplete job. No test runs as root or creates a
systemd unit.

Next source milestone: independently pinned original kernel resources,
especially a root-held keeper pidfd and the correct cgroup2 mount/FD
ancestry, together with genuine non-adopting creation and a trusted
request dispatch. None may clear the security hold without independent
source, binary, VM and Q13 review.

## Provisional Phase 3B3A source fingerprints — NOT review approval

| File | SHA-256 |
| --- | --- |
| `native/ge04/protected-systemd-birth-observer.c` | `2c83bf395265e723f5d5ed2892edac6879ad4f77a21c316c3ce2f3c13b6f7d36` |
| `native/ge04/protected-systemd-birth-observer.h` | `6a47c7b895a36638061f6be72f399e7f04f995e3b52166d802a92e917bf978d3` |

These are local editable source-byte hashes, NOT an approved/frozen root
binary, independent original-custody evidence or Q13 acceptance.
