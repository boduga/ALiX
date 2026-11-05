# GE-04 — Pinned executable identity checkpoint (experimental)

**SECURITY HOLD — NO PRODUCTION MUTATION. PR #1039 remains open/unmerged.**

## Narrow evidence

`supervisor-pinned-native-fixture.py` adds a root-only Linux **test fixture** for inspecting a small fixed ELF binary through a nofollow file descriptor. Before spending a fixture approval, composed execution checks the ELF magic, root owner, exact 0700 mode, single link, bounded size, stable inspected inode metadata, and SHA-256 digest against a test-harness-provided expected value. The composed fixture keeps that descriptor open through native invocation and uses `/proc/self/fd/<n>` with `pass_fds`, rather than re-resolving its original path. A digest/permission mismatch is rejected *before* the approval is consumed.

`test-supervisor-pinned-native-root.py` builds the existing fixed `openat2` test binary, tests digest, mode, symlink, hardlink and non-ELF denials, then opens the permitted ELF, **renames it and replaces its old pathname**, and runs the previously pinned descriptor. The existing privileged composed-lifecycle test is now supplied the test binary's SHA-256 digest and rejects a deliberately wrong digest before consumption. CI runs both suites under isolated Linux root.

## Trust and race boundaries (NOT solved)

- The expected digest and image path are supplied by the privileged test harness, **not** a signed immutable release manifest under a separately provisioned trust root. A malicious privileged caller can choose a different image and matching digest; no independent installation identity is established.
- A file descriptor pins an inode, **not immutable bytes**. An actor able to write the pinned inode or use privileged replacement mechanisms may modify it after inspection. Rechecking `fstat` is not a trusted executable measurement at syscall/exec time. A future production design needs sealed, verified snapshot execution or equivalent OS-enforced immutability, a rooted/signature-checked release policy, authenticated upgrade path and independent provisioning.
- The fixture's ancestor path, `/proc` mount, interpreter/dynamic loader, mount namespace, environment and supervisor binary itself are not independently authenticated by this test. `/proc/self/fd` is Linux-specific and must not be silently extended to unqualified systems.
- Root-equivalent or same-UID attacks against state, signer and protected anchor remain known release blockers. The fixture is not an independent service-manager-managed process and does not solve old delegated-FD authority transport.
- Approval/lease/policy checks and the late test-controlled clock remain cooperative. No proven trusted syscall-adjacent authorization, power-cut durability or terminal receipt follows from executable pinning.
- This **does not** wire a production factory or open a new tool/CLI route. Production `UnavailableScopedMutationService` remains the only allowed service.

## Next release gate

Install and attest a separate supervisor with administrator-pinned release/key identity and protected state (including signed release sequence and independently enforced rollback anchor). Execute an actually sealed or otherwise OS-immutable verified image, and independently review role credentials, path/mount provenance, expiry/revocation at final kernel effect, rollback and storage-fault behavior. Keep root-compromise assumptions explicit, and obtain independent security signoff before considering production mutation authority.

**A green CI test here proves only executable-descriptor selection under a fixed disposable fixture. It does not change GE-04 SECURITY HOLD.**
