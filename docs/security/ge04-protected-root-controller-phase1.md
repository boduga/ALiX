# GE-04 R1-B1 protected root controller — Phase 1 source candidate

**State: SOURCE CANDIDATE ONLY. SECURITY HOLD ACTIVE. ALL B1 gates OPEN.**
**No root test, service installation, protected runtime invocation, ACK, cleanup
or unit creation is approved by this change.**

## Scope and source boundary

This is the **start of production-intended native controller code**, rather
than another Python validator. Source files:

- native/ge04/protected-root-controller.c — unconditional exit 77,
  independent of UID, arguments or environment. No override macro.
- native/ge04/protected-prebirth-journal.h and .c — root-only, fixed-path,
  one-time prebirth persistence primitive. These are **library source**, not
  an installed controller or a connected executable path.
- tests/agents/test_ge04_protected_native_journal.py — build/format/negative
  test executed as the normal unprivileged user.

The C implementation is in the editable ALiX worktree. Compiling and
testing it as an unprivileged user **does not establish trusted source or
binary custody**. No existing privileged program imports these files.
No operational controller link or systemd service definition has been added.

## Journal API

The caller must supply a prebirth claim containing 32 lowercase hex boot ID,
positive bounded attempt (< 2^63), 64 lowercase hex nonce and source/controller
digests. The encoder produces the exact existing Python canonical prebirth
JSON, including fixed unit and expectedAbsent=true. This is encoding, not
verification of where the boot ID, nonce, attempt or hashes originated.

Stage requires all real/effective UID and GID to be root. It opens the fixed
existing **/var/lib/alix-ge04** only via no-follow root, var, lib and
private-directory components; checks root ownership, non-writable ancestors,
and mode 0700 private leaf. It **never creates the directory**. It exclusively
creates prebirth-intent.v1 (O_CREAT|O_EXCL|O_NOFOLLOW) with root owner, regular
type, link count one and mode 0600, writes canonical bytes, syncs the file
then parent directory, and holds both descriptors with original device/inode
metadata. Recheck requires matching original held descriptors, path inode,
exact bytes, root ownership and private directory mode. Descriptor cleanup
closes owned handles only; it never unlinks, adopts, repairs or retries the
file. The caller must initialize custody explicitly before staging.

A failed staging attempt after the exclusive create can leave incomplete
journal bytes. This is **terminal uncertainty**. A separately reviewed
controller must persist and enforce a no-adoption/recovery fence; file
absence after power loss does not prove an attempt never existed. There
is **no** recovery operation in this source tranche. A successful fsync
return on an appropriately durable filesystem is *persistence of bytes*,
not exclusive service creation or trusted transaction authorization. The
location is deliberately not under /run (normally volatile); the eventual
reviewed installer must validate the filesystem, mounts and durability
assumptions before a protected root run.

## Independent security review gates before privileged operation

1. Freeze exact source files, compiler, flags, linked binary and reproducible
   build output. Confirm only a reviewed root-controlled installation path,
   fixed capabilities and execution entrypoint; never run a mutable checkout.
2. Review root setup and parent directory creation policy separately; no
   user-writable ancestors, mounts, symlinks, hardlinks, stale paths, bind
   mount substitutions, or unapproved writer. The library currently checks
   ownership/mode and inode but does **not** pin independent mount namespace,
   statx mount ID, superblock, or immutable installation provenance.
3. Add a protected monotonic boot/attempt record created **before** the unit
   birth. Never interpret a missing or damaged journal, crash, or unexpected
   systemd state as a new attempt. Define power-loss ordering and process
   crash consistency under independently owned root storage.
4. Generate and bind nonce/hash/boot ID from independently authenticated
   controller and kernel sources; never use a user-supplied claim as proof.
5. Separately implement atomic non-adopting unit-creation contract with
   genuine JobRemoved subscription-before-request, authenticated manager
   generation, original keeper pidfd and cgroup mount/ancestry ownership.
6. Subject the reviewed controller and observer/ACK/recovery components to
   human adversarial review and approved one-purpose disposable Linux VM
   fault injection. Preserve external raw witnesses and Q13 acceptance.

## Current verification and non-goals

The tests compile the native journal library with strict C warnings and
compare its canonical output byte-for-byte with Python canonical_prebirth.
They reject malformed hashes/attempts, prove root-only staging/recheck refuse
when called by a non-root user, and link and execute the default controller
binary to observe the unconditional exit 77 across different arguments.
No root-only happy-path filesystem test was performed or implied.

The actual privileged issuer, systemd request/response owner, manager/kernel
custodian, authenticated ACK owner, cleanup/recovery, and authorized VM
qualification are **not implemented**. These are next development/review
milestones, not additional standalone synthetic validation layers.

## Provisional candidate source fingerprints (NOT review approval)

These are local source fingerprints from the unprivileged build candidate,
**not** a frozen, independently reviewed or installed executable:

| Source | SHA-256 |
| --- | --- |
| `native/ge04/protected-prebirth-journal.c` | `2ea84e1c0bc06249d1c76b73f4b22d0db1f07310388eac55078afb3f88d1d79c` |
| `native/ge04/protected-prebirth-journal.h` | `f364cd0e1eb4443232c9e3891bbdf17984a7ecd2e356929b737ff93844981b25` |
| `native/ge04/protected-root-controller.c` | `e994999de7933d55b838c882583fe415b2b32eb8cf2d7c1c0b58b9c711fc9e51` |

An independent reviewer must re-derive these values from the final source,
verify the compiler flags/toolchain and signed approved staging manifest, and
review a reproducible linked binary before **any** privileged invocation.
