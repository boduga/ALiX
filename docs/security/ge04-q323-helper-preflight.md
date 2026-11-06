# GE-04 Q3.23 — Trusted helper filesystem preflight (partial)

**GE-04 SECURITY HOLD ACTIVE. Not a production-ready executable trust boundary.**

`assertTrustedPeercredHelper(path)` rejects non-Linux/relative paths, symlink resolution, non-root ownership, group/other-writable helper files or ancestor directories, missing execute bits, and setuid/setgid helpers. `createLinuxPeerCredentialAttestor(path, {requireTrustedHelper:true})` opts into the check at construction and before every invocation. Existing prototype tests intentionally retain the default mode; this does not silently promote temporary helpers to trusted production binaries.

This preflight is **not race-free**: a privileged actor could replace the helper between `lstat` and `spawn`, and a writable bind mount or mutable filesystem could defeat path checks. Production must pin the executable identity (e.g. verified fd/inode and safe exec mechanism) or deploy a verified immutable root-controlled mount, and eliminate dependence on undocumented Node socket internals. The peercred helper still carries no provider credentials. The privileged test uses `/root` because `/tmp` has a world-writable ancestor and correctly cannot qualify as a trusted installation.

Q3.22 distinct-UID test previously passed independently on microcloud3 (1 passed, 0 skipped). Q3.23 privileged qualification requires a separate independent run. No production broker is enabled and no credentials are released.

## Q3.23 continuation — descriptor-pinned execution candidate

The opt-in trusted mode now opens the helper with `O_NOFOLLOW`, checks the opened file's UID, mode, device and inode against the current path, and passes that open descriptor to a child as fd 4. The child executes `/proc/self/fd/4`, not the original mutable pathname. The parent closes its copy after spawn. A privileged test replaces the helper pathname between opening and execution and asserts the original compiled binary executes. This addresses pathname substitution **after successful open**, not arbitrary hostile mount replacement, unsafe deployment, or the undocumented Node accepted-socket FD API.

This implementation is **candidate-only** until independent root-in-container validation of the replacement test and a complete production security review. The root-controlled ancestor requirement is retained; a trusted immutable mount remains recommended. Linux `/proc` is required. No credentials are delivered.

## Q3.23 native launcher correction

Node/libuv `spawn('/proc/self/fd/4')` fails with `EACCES` in the privileged integration environment because the child FD mapping is not available when libuv resolves the executable. The replacement design uses `native/ge04/exec-pinned.c`, a small Linux launcher invoking `execveat(4, "", ..., AT_EMPTY_PATH)` **after** the child starts with its descriptor table. The accepted Unix socket remains fd 3 and the pinned helper is fd 4. Trusted mode now requires `trustedLauncherPath`, and checks both launcher and helper ownership and parent directories. Prototype mode is unchanged.

**Important remaining limitation:** the native launcher itself is started by pathname after a filesystem preflight, so the launcher still requires an immutable trusted deployment and is not protected against all path/mount replacement races. No production security guarantee is claimed. The privileged replacement test must pass independently before this correction is accepted. The undocumented Node socket descriptor access is still unresolved.
