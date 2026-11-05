# GE-04 remediation PR 3 — legacy owned-file replacement boundary

This PR improves the **existing Node FileToolRouter**, not the disabled GE-04
native scoped-mutation service. The factory still returns
`UnavailableScopedMutationService` on every platform; this is not
production qualification of the experimental native backend.

## Strengthened properties

- Existing-file no-op remains read-only. A differing-content rewrite still
  requires the router's declared owned path and an OS-writable original file.
- Rewrite uses an exclusive, same-directory staging inode opened private
  (`0600`), writes all bytes, synchronizes the staging file and then renames.
  It no longer truncates or changes the original inode in place.
- An attacker adding a hard link to the old inode during staging does not gain
  the new bytes through that alias; the final link-count check rejects the
  observed concurrent alias.
- Inode/content and parent identity are checked before the commit. A replaced
  staging inode is rejected. The original mode is restored through a pinned
  descriptor **after** rename, so group-writable original modes do not expose
  the temporary file to other users before commit.
- A failed staging step returns an ordinary error and leaves the original
  target content intact under the tested non-concurrent conditions.
- Any error at or after the rename is reported as an **ambiguous outcome**
  (`outcomeUnknown: true`, `retryable: false`) by the router. It must not
  authorize automatic replay. On POSIX, parent directory fsync is attempted
  before reporting verified success.

## Security limits — explicitly NOT fixed

1. **No atomic compare-and-swap:** Node pathname-based `rename` cannot
   atomically assert that the original target inode and authorized parent are
   unchanged at the syscall boundary. A malicious same-UID actor who can swap
   parent/target entries after the final check remains a risk. The tests
   deterministically exercise only *pre-commit* swaps.
2. **Stage tampering:** A same-UID actor able to modify the staging inode may
   still race the last verification; the private stage is a confidentiality/
   permissions improvement, not an independent security principal.
3. **Metadata:** Mode bits are restored for common POSIX files, but owner
   changes, ACLs, xattrs, security labels, alternate streams, symlink/mount
   provenance, and nonstandard filesystem semantics are not preserved or
   qualified. Files whose filesystem owner differs from the process, or that
   carry special mode bits, are rejected. Windows ACL/rename durability
   requires its own qualification.
4. **Durability:** A staging file and directory fsync reduce ordinary crash
   windows on POSIX but do not demonstrate power-loss recovery or atomic
   journal/effect provenance. On Windows the parent directory fsync is not
   attempted. Unexpected effects after a failed rename must be reconciled,
   never automatically retried.
5. **Other tools:** `file.delete`, patch and shell tools remain distinct
   channels, and are not suddenly GE-04-governed by this patch.

## Deterministic regression coverage

`tests/capabilities/tools/ge04-owned-file-transaction.test.ts` exercises
replacement-inode semantics, staging fault isolation, a newly-created hard
link, parent replacement, leaf replacement, staged-inode substitution,
read-only refusal, restored group-writable file mode, and a simulated
post-commit observation failure that is explicitly ambiguous.

**Release gate:** This PR can be merged as a scoped legacy router improvement
after all CI and review checks. It does **not** lift GE-04 SECURITY HOLD or
authorize production selection of a native backend. Further OS-verified
atomic mutation and authority-to-syscall tests remain mandatory.
