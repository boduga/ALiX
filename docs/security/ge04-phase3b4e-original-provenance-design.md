# GE-04 Phase 3B4E — original unit and mount provenance design

**Disposition: DESIGN ONLY / NO-GO.** All B1-A–B1-H remain OPEN. This document does not authorize a systemd request, privileged staging, a root test, ACK, worker admission, cleanup, or release. The root controller must still return 77 and `ge04_systemd_create_exclusive` must still deny.

## Authority boundary and ownership

A separately reviewed, immutable root-owned bootstrap (not the worktree, agent, fixture, or postbirth observer) must be the **sole issuer** of the one-shot attempt and sole initiator of the fixed unit's birth. It owns the original attempt journal, manager connection, dispatch-intent file, request identity, and held kernel descriptors. The future observer may corroborate those holdings but cannot create or replace them. A caller-provided digest, expectedAbsence boolean, manager property snapshot, or sealed memfd alone is not authority.

The bootstrap must freeze source/binary/toolchain provenance and immutable installation before any privileged experiment (B1-A/G). The keeper executable path is currently uninstalled; the design cannot be implemented safely by enabling the current controller or by trusting a worktree binary.

## Proposed one-shot protocol (not implemented)

1. **Original identity:** Before any send, obtain a trusted boot/attempt generation and exclusive protected journal under root-controlled non-writable staging. Capture and retain original manager unique-name/EUID credentials on one authenticated system bus connection. Reject unexpected manager generation, a preexisting fixed unit, any ambiguous absence check, and any previously observed intent. A negative GetUnit observation is **not** an atomic exclusion lock.
2. **Pre-request fence:** Construct the exact fixed `StartTransientUnit` request with non-adopting `fail` mode, stage the fsynced irreversible `PRE_SEND_INTENT` marker and retain its file/directory descriptors. The marker means *record created*, never *send did not occur*. No send is authorized until source review approves the exclusive birth protocol and crash/rollback custody.
3. **Single send and correlation:** A future trusted sender, and only that sender, must transmit once on the retained bus. Capture the actual outgoing D-Bus serial/cookie from the transport (not an arbitrary caller field), then bind method reply, job path, JobRemoved and manager generation to that same request. Any timeout, disconnection, ambiguous reply, owner change, duplicate, or event flood permanently quarantines the attempt; no retry, unit adoption or fallback.
4. **Original birth receipt:** A successful manager job is **not** enough. Bind original invocation ID, keeper generation and held keeper pidfd to the same newly created unit and original attempt. Require stable, authenticated manager observations and independently held kernel corroboration. If birth-time custody was not captured, later matching observations cannot retroactively establish it.
5. **Original mount custody:** Retain kernel-backed cgroup2 mount namespace descriptor, mount ID, superblock/root identity and original unit/ancestor cgroup dirfds from a protected, independently established bootstrap boundary. Recheck against the same original held descriptors at every phase and terminal boundary. Never synthesize expected identities from the same observation being verified; reject namespace replacement, remount, inode substitution, extra members and manager restart.
6. **Terminal uncertainty:** On process loss after intent creation, journal loss, any identity mismatch or incomplete cleanup, enter absorbing quarantine. No numeric-PID kill, subtree fallback, marker deletion, new attempt or ACK. Recovery requires a separately approved, human-controlled protocol and independently corroborated empty descendants and witness survival.

## Proof obligations and required negative evidence

| Gate | Required proof | Mandatory refusal |
| --- | --- | --- |
| B1-B | Original protected journal + exclusive new fixed-unit creation + real request serial + authenticated invocation and keeper generation | Existing/adopted unit; absent-unit race; owner swap; reply without outgoing serial; post-send crash |
| B1-C | Original held cgroup2 namespace/mount/superblock/root linked to trusted boot and unit receipt | Text-only mount ID; changed namespace, mount, superblock, root or ancestor |
| B1-D | Original unit/outer/launcher/payload dirfds and exclusive owner retained across all boundaries | Reopened lookalike cgroup; extra member; lost descriptor |
| B1-F | Durable anti-rollback intent plus independently verified terminal and crash quarantine | Missing/rolled-back marker; uncertain send; partial cleanup; replay |

B1-A, B1-E, B1-G and B1-H remain independent prerequisites. Before any privileged test, an independent human reviewer must approve source/binary hashes, a named disposable VM and witness, exact commands, stop conditions and the raw evidence protocol. Green CI, local tests, this design and model review are **not** acceptance.

## Existing implementation and gaps

- `native/ge04/protected-root-controller.c`: unconditional exit 77; preserve.
- `native/ge04/protected-systemd-transaction.c`: root-EUID manager subscription, but `ge04_systemd_create_exclusive` always refuses; no real outgoing serial.
- `native/ge04/protected-dispatch-intent.c`: exclusive fsynced marker; no anti-rollback or trusted send result.
- `native/ge04/protected-transaction-state.c`: diagnostic absorbing quarantine; not wired into controller, no retry authorization.
- `native/ge04/protected-keeper-custody.c` and `protected-mount-namespace.c`: post-observation, explicitly UNQUALIFIED corroboration; not original birth-time proof.
- `docs/security/ge04-r1b1-closeout-gates.md`: authoritative B1-A–H requirements; unchanged by this design.

**Implementation order:** independent provenance/ownership contract → bounded authenticated sender design → birth-time descriptor custody → adversarial crash/replay tests → separate human security review → separately authorized VM evidence. Do not make the sender operational as a shortcut.
