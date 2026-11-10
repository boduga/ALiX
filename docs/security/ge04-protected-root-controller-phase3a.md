# GE-04 R1-B1 Protected Root Controller — Phase 3A: native manager subscription

**SOURCE CANDIDATE ONLY · R1-B1 OPEN · GE-04 SECURITY HOLD ACTIVE.**

Phase 3A introduces production-intended native C source rather than another
Python diagnostic layer:

- `native/ge04/protected-systemd-transaction.[ch]` uses native libsystemd
  and defines a root-only transaction object that retains a private bus,
  signal-match slot, original manager unique owner and terminal poison state.
- `tests/agents/test_ge04_protected_systemd_transaction.py` compiles and
  links the C source, exercises unprivileged refusal, state and cleanup, and
  verifies the linked controller still exits 77.

## Implemented trust boundary

A future reviewed root-only caller must retain the existing *original* boot
and nonce attempt fence and exact pre-birth journal descriptor before it can
call `ge04_systemd_subscribe_original`. The C source first rechecks these
held original resources, then uses a private sd-bus connection to the fixed
`unix:path=/run/dbus/system_bus_socket` address. It does not use a caller
supplied D-Bus address, and sets a one-second per-call method timeout.
The manager is queried by its well-known `org.freedesktop.systemd1` name,
but its **unique** bus name and EUID=0 must both be verified.

The code installs a `JobRemoved` signal match restricted to the pinned
unique manager owner, manager object and interface, before issuing systemd
`Manager.Subscribe`. It then rechecks the manager generation and original
journal/attempt custody. A `JobRemoved` for the fixed unit **before any
owned creation request** poisons the transaction, rather than authorizing
adoption. Unexpected state or credential changes fail closed. Closing the
private connection removes its match and attempts best-effort Unsubscribe.
An existing poison state survives cleanup. The recheck actively dispatches
already-queued messages with bounded `sd_bus_process()` calls before and
after verifying the manager generation. An unexpected fixed-unit JobRemoved,
dispatch error or 64-message flood poisons and refuses. This does **not**
prove absence of in-flight or future events, nor does it constitute a
linearizable creation transaction.

The creation API `ge04_systemd_create_exclusive` **always returns EPERM**
and poisons the transaction. No `StartTransientUnit` request can be sent by
this source; neither manager job receipt nor JobRemoved correlation has a
positive authorization path. The controller executable main remains an
unconditional exit 77 with no environment, CLI or compiler override.

## Unresolved protected transaction requirements

1. **Immutable staging and privileged entrypoint:** source, compiler and linked
   executable must be reviewed/frozen and installed root-owned outside
   mutable worktrees. The current C files are not trusted binaries.
2. **Exact system-bus provenance:** independent review must verify ownership,
   peer credentials, bus socket and namespace provenance, not merely the
   manager's unique name and claimed EUID. Mount substitution, a compromised
   bus and changed bus owner remain relevant threats.
3. **True bounded operation:** individual D-Bus method calls use a timeout,
   but initial bus connection, cleanup and blocking I/O still require an
   independent supervisor enforcing an absolute process deadline.
4. **Original exclusive birth:** subscribe-before-request is source-ordered,
   but no creation is attempted. A future protected root controller must
   send only a reviewed fixed-unit non-adopting creation request, persist the
   original job reply, correlate JobRemoved from the same manager and
   prove the job created the *new* unit. Signal receipt alone is inadequate.
5. **Original resource custody:** kernel keeper pidfd/startticks, cgroup2
   mount superblock/root and ancestor directory FDs, authenticated phase
   ACK and fail-closed cleanup/recovery are not implemented.
6. **Independent acceptance:** no root invocation, actual subscription as
   root, systemd unit creation, kernel fault injection, disposable-VM
   qualification, human adversarial review or Q13 acceptance occurred.

The native source can be built with `libsystemd` for unprivileged tests,
but linked source is *never* an authorization credential. The tests only
prove compileability, local unconditional denial and shape of restricted
method calls; they cannot establish that a privileged subscription would
succeed or safely recover under systemd restart, crash, power loss or race.

## Provisional Phase 3A source hashes (not approved or frozen)

| Source | SHA-256 |
| --- | --- |
| `protected-systemd-transaction.c` | `a7e837a229e87976b1e62ddee9c0db12bfb516be5b87e89259e7b6dd6fcc14c8` |
| `protected-systemd-transaction.h` | `a6426d8b753ac28d6100f40134223a6a79b9001a23f56e389236b5fc650c8189` |

These are source-byte fingerprints only, not independently attested identities.
An independent reviewer must verify the exact final source, `libsystemd`
version, compiler, linked binary and deployment custody before any root use.

## Review amendment: dispatch queued signals before accepting recheck

An independent model review caught a P2 correctness defect: registering a
JobRemoved match without dispatching D-Bus messages never invokes its
callback. The source now calls a bounded nonblocking `sd_bus_process()` drain
before and after the manager credentials recheck. Dispatch failures, a
64-message flood, or the fixed-unit callback poison the source-level
transaction. Unprivileged C link-wrapper tests exercise all three negative
outcomes without claiming to observe a genuine privileged unit creation.
The callback still cannot establish absence of future signals, and there is
no positive authenticated job receipt or creation authority.
