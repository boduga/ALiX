# GE-04 production worker lifecycle integration — first slice

This opt-in `SubagentManagerOptions.supervisorWorkerLifecycle` hook observes actual child process spawn/exit and supplies the coordinator's run/worker/attempt identity to a trusted, caller-supplied supervisor callback. It deliberately suppresses credential payload transfer on FD3 when enabled. It does **not** turn on positive admission, does not authenticate native IPC, and does not prove worker execution is blocked before registration: the child may execute immediately after spawn. Registration callback rejection kills the child, but that is **not** a security boundary against pre-registration execution. Existing legacy credential delivery is unchanged when the hook is disabled. Do not enable this option in production or claim it isolates worker credentials. GE-04 SECURITY HOLD remains active.

Next: redesign the worker startup as a true suspended/blocked handshake under a trusted supervisor, with no credential access before authenticated registration; verify Linux UID isolation and kernel-attested IPC before any positive governance admission.

## Cooperative startup gate (second slice)

With the opt-in hook, the supervisor provides a separate FD4 pipe and releases the exact `GE04_READY\n` marker only after the asynchronous registration callback succeeds. The real subagent CLI waits for the marker before loading configuration or reading FD3. EOF, missing descriptor and malformed release fail closed. This is a **cooperative** barrier only: the child process already exists and may execute imports, and a compromised child or test override can ignore the handshake. The callback must be trusted and registration must not be interpreted as native kernel attestation. No secrets are sent via FD4.

## Broker-owned Linux registry adapter

`createSupervisorLinuxWorkerLifecycle()` supplies the opt-in manager callback contract using `createLinuxBrokerProcessRegistry()` and procfs process identity. It registers the spawned PID/UID/run/worker/attempt, revokes on exit, rejects duplicate registrations and mismatched UID, and handles exit during asynchronous registration. A pending exited PID cannot be reused until the original registration settles. It is **not enabled by default** or connected to a privileged supervisor deployment. `resolveAttestedPeer` is diagnostic only and must never receive worker-supplied peer objects as authority. Same-UID workers and pre-gate imports remain security gaps. No positive credential admission.

## Real Linux lifecycle integration qualification

`tests/agents/ge04-real-worker-lifecycle.test.ts` exercises actual `SubagentManager.spawn` with Linux `/proc` registration, FD4 cooperative release, empty FD3 snapshot, exit revocation, and registration failure termination. It uses a Node fixture as the worker, not the complete production ALiX CLI. The resolver call in this test supplies a synthetic `VerifiedBrokerPeer` object: it does **not** demonstrate kernel-attested IPC, distinct UIDs, or secure credential isolation. The hook is still opt-in; no production activation or positive admission is allowed.
