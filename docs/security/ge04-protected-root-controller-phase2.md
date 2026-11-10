# GE-04 R1-B1 Protected Root Controller — Phase 2: original attempt and boot fencing

**State: NATIVE SOURCE CANDIDATE ONLY · GE-04 SECURITY HOLD ACTIVE.**
All B1 gates remain OPEN. No source in this phase can activate the root
controller or authorize a systemd creation, worker admission or phase ACK.

## What Phase 2 implements

The production-intended native source now has one fixed first-attempt ledger,
`native/ge04/protected-attempt-fence.[ch]`, tied to the existing
`protected-prebirth-journal.[ch]` source:

1. Acquire Linux boot UUID from the fixed, read-only
   `/proc/sys/kernel/random/boot_id` (canonical lowercase 32 hex, no dashes).
   This is a local kernel observation; by itself it is not remotely attested.
2. Generate 256 bits of nonce material using Linux `getrandom`, encode it
   as 64 lowercase hexadecimal characters, and set `attempt=1` in the
   native candidate. The caller must still supply source/controller hash
   claims, which are included in the fence; no independently verified
   build/staging attestation exists.
3. Open only the existing, root-owned, private 0700
   `/var/lib/alix-ge04` directory using `O_NOFOLLOW` traversal of root,
   var, lib and the fixed final component. No path or directory is created
   except the fixed journal file itself.
4. Create a single `attempt-fence.v1` with `O_EXCL|O_NOFOLLOW`, root-owned
   mode 0600, canonical closed `GE04AF1 <boot> <nonce> <source-sha256> <controller-sha256> 1\n` bytes, file
   `fsync` then directory `fsync`. Retain the original file/directory
   descriptors and inode identity.
5. Require the same process-held attempt-fence descriptors, file contents,
   current kernel boot UUID and original nonce/attempt to pass recheck
   **before and after** existing prebirth-intent staging. It is no longer
   possible to call `ge04_prebirth_stage` with only caller-supplied identity.

The new fence uses **attempt 1 only**. It has no counter increment, rollover,
boot reset, reissue, file deletion, adoption or salvage path. An existing
fence (including another boot's or a corrupt one) blocks further creation.
A failed write or crash after exclusive creation intentionally leaves
uncertainty and blocks subsequent attempts as long as the original protected
marker survives.

## Security limitations

The fixed `/var/lib` location is a source-level proposal, not a verified
persistent filesystem or deployed root-owned directory. Root-controlled
filesystem mounting, inode/source custody, write durability through power
loss, hardware anti-rollback, durable detection of deleted journal files,
and recovery after a failed first attempt are **not solved**. If an untrusted
actor or privileged component deletes both journal files, this source alone
cannot detect it. No monotonic sequence beyond first-attempt refusal exists.
A later repeated-attempt implementation must first prove separate durable
anti-rollback custody and be independently reviewed.

The source and controller binary remain in an editable worktree, not a
reviewed root-only installation. The controller's executable entrypoint
still **always exits 77**. The native attempt and prebirth code is linked
to the disabled binary only for unprivileged compile/default-denial testing.
No root-stage success test has been executed, and no operating system
resources were created at the fixed path.

No systemd creation request, protected listener/request lifecycle, keeper
pidfd/cgroup mount pinning, six-phase ACK, terminal cleanup, or protected
recovery exists. Source/controller digests are still caller-supplied, not
independently authenticated. Successful local serialization/custody
compilation does not satisfy B1-A or any other review gate.

## Review checklist for independent security owner

- Verify the exact source/binary/toolchain identity and signatures after
  all revisions; review dependency linkage and remove mutable worktree trust.
- Inspect the kernel boot ID read, getrandom behavior, real/effective
  UID/GID checks, canonical fence bytes, exclusive O_EXCL, file/dir fsync,
  fd ownership, and no symlink/hardlink/adoption policy under concurrency.
- Decide authoritative persistent state and anti-rollback/anti-deletion
  mechanism, mount namespace/superblock custody, and partial-power-loss
  consistency; define a separate recovery protocol before any new attempt.
- Reject reboot, an existing fence, absent/partial journal, changed source
  hashes, manager owner change, skipped/failed events or lost kernel custody.
- Require a separately authorized, one-purpose disposable Linux VM test
  with raw witnesses and independent adversarial human acceptance (Q13).

The unprivileged native tests verify exact boot ID normalization against
procfs, byte-for-byte prebirth compatibility, malformed claim denial,
unprivileged refusal of fence/stage/recheck, and the linked controller's
unconditional exit 77. They do **not** establish privileged first-attempt
success, kernel entropy provenance or power-loss safety.

## Provisional Phase 2 source hashes (NOT an approved build)

These are local source-byte fingerprints only. An independent human reviewer
must rederive them after any changes and separately hash the approved
compiler/toolchain and linked executable, before a disposable-VM root run.

| Source | Candidate SHA-256 |
| --- | --- |
| `protected-attempt-fence.c` | `3a50d7ed11f4039c16417fae4b5ace28226f4db017577916a4ae52d2e2d778d7` |
| `protected-attempt-fence.h` | `a708098e2b05e222cecaddcf6918a1bbae37e53fab8223d7e8bc29836fb8d85f` |
| `protected-prebirth-journal.c` | `06cedebeacb85331e28c806bfc51cdc9ecae095332606cfe4386982d179b4adb` |
| `protected-prebirth-journal.h` | `233ead41262b59ce427d303935d35ad542168b05ec5ad7586b07762c67e1c501` |
| `protected-root-controller.c` | `e994999de7933d55b838c882583fe415b2b32eb8cf2d7c1c0b58b9c711fc9e51` |

The six unprivileged native tests cover normalized kernel boot ID, exact
first-attempt bytes with both source digests, rejection of invalid source
digests and non-first attempt values, legacy prebirth format compatibility,
root-only API refusal and an always-disabled controller entrypoint. This
coverage does **not** exercise privileged journal creation or crash recovery.
