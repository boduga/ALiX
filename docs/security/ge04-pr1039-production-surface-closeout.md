# GE-04 PR #1039 — Production-Surface Closeout Review (2026-11-05)

**Decision: MERGE HOLD; no activation.** This is a repository diff/CI review, **not independent security signoff**. PR #1039 is consolidated security research, NOT an experiments-only patch. The production scoped mutation factory must continue to return `UnavailableScopedMutationService` on all platforms. **GE-04 SECURITY HOLD persists after any future documentation/test-only merge.**

## Evidence snapshot

- Audited PR head `c47fe0a3382ccf442c268daf0971d0ad46345aac`: 258 changed files (approximately 180 commits), including `src/`, tests, CI, scripts and GE-04 experiments.
- Both PR-triggered workflow runs completed **successfully** at this head: full **CI** and **OpenTUI native checks**. Previously the `ge04-live-systemd-inert` job failed because its 6-second polling window was shorter than the restarted inert service's 8-second socket timeout; commit `c47fe0a3` extends observation to 18 seconds, retaining `ActiveState=failed`, `Result=exit-code` and `NRestarts=0` assertions. The new CI success is the relevant verification.
- The `node-tests`, `unit`, `typecheck`, `integration`, `ge04-cross-uid-denial` and coverage jobs passed. `tests/execution/filesystem/scoped-mutation.test.ts` rejects unavailable backends on Linux/macOS/Windows.

## Production-touching diff assessment

| Changed seam | Observed behavior | Classification / limitation |
| --- | --- | --- |
| `src/execution/filesystem/scoped-mutation.ts` | Defines fail-closed seam, factory always returns `UnavailableScopedMutationService` | **Factory fail-closed verified**; does not in itself prove no manually constructed experimental service in future consumers |
| `src/execution/filesystem/linux-scoped-mutation.ts` and `ge04-*` modules | Export experimental adapter, authorization, provenance, evidence and recovery helpers | **Research code in src**; no qualified production activation; same-UID/native provenance/final-boundary gaps persist |
| `src/capabilities/tools/tool-router.ts` | `file.create` exclusive creation; existing-file identical content read on `O_RDONLY|O_NOFOLLOW`, then owner-authorized differing-content overwrite through revalidated writable inode | F1 read-only no-op restored; F2 hardlink static alias denied; new regression in `tests/capabilities/tools/ge04-file-create-safety.test.ts` |
| `src/coordination/ownership/path-scope.ts` | Owned-path check adds symlink-in-root and canonical workspace/prefix checks | Deny-first defense for static symlinks; synchronous pathname checks **not atomic** against concurrent parent changes |
| `src/coordination/ownership/ownership-registry.ts` | Adds cooperative cross-process `withExclusiveLeaseFence` using existing `withLock` | No behavior change to existing lease API calls; not a policy/approval lock, trusted clock, or syscall-adjacent final gate |
| `src/coordination/ownership/ge04-ownership-authority.ts`, `src/governance/approvals/ge04-approval-authority.ts` | Mint restricted owner-local ports from real stores | Same-process WeakSet branding is not an independent OS security principal |
| `tests/architecture/r1-boundary-freeze.test.ts` | Narrow exceptions for new owner-local port modules | Must retain architecture constraints; CI currently passes |
| `scripts/run-node-tests.mjs` and `package.json` | `--list` drains stdout rather than calling immediate `process.exit`; coverage test invocation adjusted | CI passes. Changes affect test discovery/coverage, not mutation authority |
| `.github/workflows/ci.yml` | Numerous privileged Linux GE-04 experimental jobs | CI evidence is fixture-specific, not production qualification |

## Fix verification and remaining live-write risks

- **F1**: Read-only identical `0444` file succeeds with `changed:false`, no write descriptor. Differing content on a read-only file is denied for unprivileged Linux.
- **F2**: A pre-existing hard link from `owned/alias.txt` to `outside/important.txt` is denied on overwrite; unowned content stays unchanged. A normal single-link owned file can still be overwritten. The initial lstat and final writable FD both require `nlink===1`.
- **Not closed**: An attacker able to create another hard link to the already-open inode after the last `nlink` check can still cause an in-place overwrite to alter another path. Parent path swaps, mount/symlink changes, non-atomic truncation and post-write crashes are outside these fixes. These live Node `file.create` operations must not be considered governed GE-04 scoped mutations.
- A pre-existing hard-linked file with identical content may return idempotent no-change success because it performs no write. That is not authorization for a changed-content overwrite.

## Merge and production decision

**Experimental merge exit checklist:**

1. [x] All required CI successful at reviewed head.
2. [x] F1 and F2 regression implementations and tests present.
3. [x] Scoped mutation factory remains unavailable and has platform-denial tests.
4. [x] Production-touching diff surveyed for effect and explicit limitations.
5. [ ] Independent reviewer confirms behavior changes and security boundaries; no self-certification from this report.
6. [ ] Merge approver explicitly accepts experimental research plus the live router/ownership changes; absent this, retain PR as open/unmerged.

**Production activation exit checklist (not satisfied):** independently administered supervisor process and release identity, protected real approvals/policy/lease and key custody, rollback-resistant authority, exact request-to-release-to-journal-to-receipt binding, trusted syscall-adjacent expiry and revocation, adversarial race and crash/power-fault qualification, and cross-platform deny/default behavior.

**Do not merge PR #1039 as if it certified filesystem mutation security. Do not wire `ExperimentalLinuxScopedMutationService` through tool/patch routers or the scoped mutation factory. Preserve existing branches and the evidence trail until the explicit merge decision.**
