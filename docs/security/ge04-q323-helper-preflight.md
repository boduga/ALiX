# GE-04 Q3.23 — Trusted helper filesystem preflight (partial)

**GE-04 SECURITY HOLD ACTIVE. Not a production-ready executable trust boundary.**

`assertTrustedPeercredHelper(path)` rejects non-Linux/relative paths, symlink resolution, non-root ownership, group/other-writable helper files or ancestor directories, missing execute bits, and setuid/setgid helpers. `createLinuxPeerCredentialAttestor(path, {requireTrustedHelper:true})` opts into the check at construction and before every invocation. Existing prototype tests intentionally retain the default mode; this does not silently promote temporary helpers to trusted production binaries.

This preflight is **not race-free**: a privileged actor could replace the helper between `lstat` and `spawn`, and a writable bind mount or mutable filesystem could defeat path checks. Production must pin the executable identity (e.g. verified fd/inode and safe exec mechanism) or deploy a verified immutable root-controlled mount, and eliminate dependence on undocumented Node socket internals. The peercred helper still carries no provider credentials. The privileged test uses `/root` because `/tmp` has a world-writable ancestor and correctly cannot qualify as a trusted installation.

Q3.22 distinct-UID test previously passed independently on microcloud3 (1 passed, 0 skipped). Q3.23 privileged qualification requires a separate independent run. No production broker is enabled and no credentials are released.
