# GE-04 R1-B1 Protected Root Controller — Phase 3B2 fixed request source

**CANDIDATE SOURCE ONLY — GE-04 SECURITY HOLD ACTIVE — ALL R1-B1 GATES OPEN**

Phase 3B2 adds `native/ge04/protected-systemd-request.[ch]` as a native
`libsystemd` **request body serializer** for the future reviewed issuer.
This is production-intended C source, not a standalone Python validator.

## Fixed request contract

`ge04_append_fixed_transient_request()` accepts a caller-owned
`sd_bus_message` and only appends the fixed arguments for the
`org.freedesktop.systemd1.Manager.StartTransientUnit` method:

- Signature: `ssa(sv)a(sa(sv))`; fixed unit
  `ge04-r1b2-view-qualification.service`; creation mode `fail`
  (never `replace` or adoption).
- Properties: `Description` (fixed string), `Type=exec`,
  `NoNewPrivileges=true`, `Delegate=true` and exactly one
  `ExecStart` tuple using signature `a(sasb)`.
- Executable and sole argv entry are both the fixed
  `/usr/libexec/alix/ge04-qualification-keeper` path, with ignore-failure
  false. **No executable has been installed or approved at this path.**
- Auxiliary unit array is explicitly empty.

Every field and sequence is hardcoded. There is no user-controlled service
name, executable path, option, action, arbitrary property or auxiliary unit
parameter. Every D-Bus serialization error returns failure immediately.
The serializer does not create a connected bus, make or send a method call,
obtain a D-Bus request cookie, launch a keeper or mutate systemd.

## Critical blockers

The `StartTransientUnit` request is **NOT** enabled. The separate
`ge04_systemd_create_exclusive()` function continues to unconditionally
return EPERM; the controller entrypoint still exits 77 regardless of input.
The new serializer is not invoked by either. It has no bypass switch.

The proposed `Type=exec`, `Delegate=true`, `ExecStart` and other
service properties must be reviewed for Linux/systemd semantics,
privilege containment, process/keeper ownership and compatibility with the
original cgroup-control contract. `Delegate=true` is not permission for
ALiX to manipulate an existing cgroup, and `fail` alone cannot prove
that a newly created unit has independently held original kernel resources.

A future protected issuer must:
1. Verify reviewed, root-owned installed source/binary and exact approved
   keeper identity, including executable hash and sandboxing restrictions.
2. Retain original boot/nonce/attempt fence and prebirth inode custody,
   positively verify absence and hold the pinned manager subscription
   before any outgoing request.
3. Construct and validate the exact method request on that same protected
   private D-Bus connection, persist the attempt transition, dispatch once,
   retain a genuine outgoing request cookie and bind its exact job reply.
4. Independently prove newly created fixed unit and original
   keeper/kernel/mount/cgroup ancestry custody, with hard process-wide
   deadlines, crash/owner-swap quarantine and authenticated phase ACK.
5. Receive independent human security review and explicit approval for
   disposable-VM root tests, followed by Q13 release acceptance.

## Verification

Unprivileged link-time C wrappers capture the exact append/open/close
sequence and check its fixed values, nested `a(sasb)` shape and balanced
containers. Injecting failure into each native append/container action must
return an error. The test never opens a system bus or exercises root.
Existing native regression tests ensure no StartTransientUnit call
is sent and the linked controller still exits 77.

**This phase makes no claim of an executable, valid operational unit,
authentic creation transaction, root-test success or security gate closure.**

## Provisional Phase 3B2 source fingerprints — NOT approval

| File | SHA-256 |
| --- | --- |
| `native/ge04/protected-systemd-request.c` | `25218a14f73523a71bd451a304ac497273f0edcd3f85c53110e386a7a4d7a9a0` |
| `native/ge04/protected-systemd-request.h` | `5a5c87c1cfb90641fd3db4c8952246bc9cf7ac5b12db376a2412f746a0a1b263` |

These hashes identify editable source candidates only; they are not
independent human review, signed deployment identities or an executable
qualified for privileged use.
