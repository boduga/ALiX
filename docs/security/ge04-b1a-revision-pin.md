# GE-04 B1-A.02 — Candidate revision pin (not approved freeze)

**Status:** Candidate Git-tree snapshot recorded; **B1-A.02 not accepted**. GE-04 SECURITY HOLD ACTIVE.

- Source commit: `7a15a906488996bd677a246d2d24787d4fbf5b4e` (before this evidence-only commit).
- Candidate inventory: `docs/security/ge04-b1a-source-inventory.md` (68 C/H/Python candidates plus one other tracked native input).
- Hash manifest: `docs/security/ge04-b1a-candidate-source-sha256.txt`, 69 tracked `native/ge04` paths, SHA-256 of exact Git blob bytes at source commit (not dirty worktree contents).
- Manifest SHA-256: `5a393ba02d8ddfc5bd7298090a69abaeafe3f7cd37169eee6f82834d4eec1479`.
- Verification: `git show 7a15a906488996bd677a246d2d24787d4fbf5b4e:<path> | sha256sum` must match each manifest entry.
- Rejection: any changed blob, missing path, added build input, compiler/runtime mismatch, changed linked library, or unreviewed binary invalidates this candidate snapshot.

## Dirty-worktree and scope limitations

At capture, `.gitignore` and `docs/security/ge04-phase3b4g-bounded-native-operation-plan.md` were modified, and `tmp/` was untracked. These unrelated files were deliberately excluded. This is **not a clean-tree freeze**. External dependencies, source/link closure, compiler/runtime and binary identities remain unresolved; the inventory's 69 paths must not be mistaken for the approved minimal build set.

## Acceptance remains blocked

A reviewer must approve the precise source/build closure, toolchain and binary SHA-256 before B1-A can close. This candidate pin is non-authorizing and does not enable root execution, dispatch, worker admission, or Q13.
