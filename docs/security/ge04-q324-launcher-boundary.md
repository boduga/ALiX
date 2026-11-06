# GE-04 Q3.24 — Native launcher trust boundary

## Status: SECURITY HOLD; qualification incomplete

The Q3.23 helper is opened with `O_NOFOLLOW`, checked with `fstat` against the validated path, and executed by a native `execveat(AT_EMPTY_PATH)` launcher. The launcher **itself** is still executed by pathname through Node `spawn()`. The launcher preflight checks root ownership, executable mode, writable ancestors, and symlinks; Q3.24 adds negative tests for missing, writable, and symlinked launchers.

These checks **do not prevent a privileged concurrent rename, mount replacement, or replacement between the last metadata check and Node's `spawn`**. An attacker with the power to mutate the trusted root-owned installation can substitute the launcher. Do not describe Q3.24 as providing race-free launcher identity.

## Production exit requirements

1. Define the launcher's trust root and install it in a root-controlled, read-only or otherwise immutable mount with auditable deployment and rollback.
2. Remove the Node `socket._handle.fd` dependency: use a documented native broker boundary for accepted Unix sockets and `SO_PEERCRED` directly, or a supported native binding with explicit ownership/lifetime semantics.
3. Test concurrent pathname replacement, directory and mount manipulation (where capabilities permit), restart, and fail-closed behavior. Include real authorized and unauthorized distinct-UID clients.
4. Verify that the credential delivery path binds kernel peer identity to run/worker/attempt/capability, live approval, and replay protection; do not use test probes as evidence of real secret delivery safety.

No production credential delivery is authorized by these tests. GE-04 SECURITY HOLD remains active.
