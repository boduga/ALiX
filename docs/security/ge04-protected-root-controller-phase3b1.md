# GE-04 R1-B1 Protected Root Controller — Phase 3B1 native job binding

**SOURCE CANDIDATE ONLY — GE-04 SECURITY HOLD ACTIVE — ALL R1-B1 GATES OPEN**

This increment extends the **existing native systemd transaction object**;
it does not introduce an additional standalone Python validation layer.

## Native transaction state

`native/ge04/protected-systemd-transaction.[ch]` now keeps an exact
original request cookie, one canonical returned job object path, and one
`JobRemoved` completion on the same private D-Bus manager connection.
A future reviewed sender must bind the outgoing D-Bus message cookie
it actually dispatched to `request_cookie` and set `request_in_flight`
**inside the protected issuer**. The current source does NOT set either.
`ge04_systemd_create_exclusive()` still unconditionally refuses with EPERM.

A completed method reply is accepted only as `METHOD_RETURN`, on the
same retained sd-bus object, from the pinned manager unique owner,
with signature exactly `o`, and with `reply_cookie` equal to the
nonzero original request cookie. Its returned path must be the canonical
`/org/freedesktop/systemd1/job/<uint32-positive>` path, without
zero-padding, suffixes, overflow or alternate object spelling.

A fixed-unit `JobRemoved(id, path, unit, result)` signal must originate
from the same pinned unique sender. The ID must match the canonical
path and the result must equal `done`. A valid signal can occur
**before** the method reply: it is stored once, without claiming
completion, then compared with the authenticated reply. If the reply
comes first, only the exact matching subsequent event is accepted.
Duplicate signals, repeated replies, wrong sender, mismatched job IDs,
bad result, or malformed data poison the transaction. Unrelated-unit
signals are ignored; a fixed-unit event before the actual request is
issued poisons.

The resulting `job_done_claimed` bit represents only the matching
**systemd method reply plus signal**. It does NOT prove new unit birth,
kernel keeper/cgroup custody, manager transaction exclusivity or
authorization to send any protected phase ACK.

## Security hold and unfinished integration

There is no native StartTransientUnit request builder or sender in this
increment, **no actual method call**, no service properties or keeper
launch, no unit birth, and no approved root execution. The controller
entrypoint still exits 77 unconditionally. The current test harness
sets the internal `request_in_flight` and cookie fields by hand to
exercise these source-level transitions; that cannot authenticate a
real outgoing request. The native code remains in a mutable worktree.

**Next needed before privileged activity:** independently review the
fixed transient service properties and launch semantics, create the
protected request sender with one retained cookie, prove subscription
preceded the request, enforce a hard end-to-end deadline, independently
pin genuine original systemd/kernel/cgroup resource custody, and
document crash/owner-swap recovery as quarantine. Separate source/binary
staging approval, disposable-VM fault injection and Q13 human decision
remain mandatory.

Tests link real libsystemd code and use unprivileged link-wrapper
injections to exercise 19 sequences (early/later event, duplicate,
mismatched reply serial/path/sender/bus/result, wrong signature,
overflow/zero/zero-padded IDs and held creator refusal). Tests do not
perform D-Bus mutations or privileged operations.

## Provisional Phase 3B1 source fingerprints (not independent approval)

| File | Source SHA-256 |
| --- | --- |
| `native/ge04/protected-systemd-transaction.c` | `21747be87ffcf7cb6b1fd6e8d9b266bdd61e4c9c6b6df0edeec9cc99a93b00f0` |
| `native/ge04/protected-systemd-transaction.h` | `27aedc66cdd98de0b08faad21586aebf952f0f4ed9f5c055625c2a8cf69eb99f` |

These hashes supersede the corresponding Phase 3A file fingerprints; they
are not a frozen compiler, installed binary, qualified root issuer or Q13
security clearance. Independent reviewers must rederive them after any edits.
