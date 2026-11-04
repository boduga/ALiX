# GE-04 SUP-17 — Distinct-UID direct path isolation test

**SECURITY HOLD — privileged CI fixture only; no production authorization or mutation.**

`experiments/ge04/test-cross-uid-path-isolation-root.py` must run as root on Linux. It creates a disposable root-controlled test key under a mode-0700 directory, and an AF_UNIX listener whose socket pathname is mode 0600 in a traversable disposable directory. A child process drops supplementary groups and changes to UID/GID 65534; it must receive `PermissionError` when reading the fixture key or connecting directly to the socket. The parent verifies an explicit successful child exit. This is a real OS-level negative test of **direct pathname access**, registered with `sudo -n` in the GE-04 CI lane.

**Not demonstrated:** This test does NOT deny or even test access via inherited descriptors, `SCM_RIGHTS` FD passing, a compromised same-UID process, namespace credentials, executable attestation, session credential custody, signed coordinator role provisioning, process restart/power loss, or cross-process final-mutation fencing. SUP-15 has already reproduced a delegation risk despite apparently good peer credentials, so direct pathname isolation must not be misrepresented as full isolation.

The fixture never invokes a helper or changes production behavior. Until its privileged CI run finishes, the isolation test is **unverified**, even if syntax checks and unprivileged regressions pass. PR #1039 remains open and unmerged; `UnavailableScopedMutationService` remains disabled.
