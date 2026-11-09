# GE-04 worker lifecycle integration — SECURITY HOLD ACTIVE

## Mandatory manager facade increment

`SubagentManager` now requires a trusted `TaskWorkerSupervisor` for preparation, launch, completion, cancellation and startup recovery. It projects explicit nonsecret task fields, checks process-generation evidence, and accepts only bounded structured completion. It owns no subprocess, credential pipe, keyring environment or PID signalling. Default composition has no enabled task supervisor and refuses execution; old command overrides and optional observers are rejected.

Credential-free doubles test facade behavior only. No qualified native task backend, authenticated result transport or cross-manager durable containment guarantee is supplied. A lost ownership lease cannot be protected by retaining a JavaScript map entry. In-process coordination and direct legacy CLI entry points remain outside this increment and block complete R1-B1 acceptance. R1-B2 through R1-F remain open; do not infer production qualification or hold clearance.

## Historical optional-observer integration

The following describes the former manager path retained as historical design context. The option names remain deprecated types solely for explicit refusal; they no longer launch through the manager. Removal of the legacy CLI startup/credential readers remains R1-E work.


This opt-in `SubagentManagerOptions.supervisorWorkerLifecycle` hook observes actual child process spawn/exit and supplies the coordinator's run/worker/attempt identity to a trusted, caller-supplied supervisor callback. It deliberately suppresses credential payload transfer on FD3 when enabled. It does **not** turn on positive admission, does not authenticate native IPC, and does not prove worker execution is blocked before registration: the child may execute immediately after spawn. Registration callback rejection kills the child, but that is **not** a security boundary against pre-registration execution. At that historical baseline, legacy credential delivery was unchanged when the hook was disabled. Do not enable this option in production or claim it isolates worker credentials. GE-04 SECURITY HOLD remains active.

Next: redesign the worker startup as a true suspended/blocked handshake under a trusted supervisor, with no credential access before authenticated registration; verify Linux UID isolation and kernel-attested IPC before any positive governance admission.

## Cooperative startup gate (second slice)

With the opt-in hook, the supervisor provides a separate FD4 pipe and releases the exact `GE04_READY\n` marker only after the asynchronous registration callback succeeds. The real subagent CLI waits for the marker before loading configuration or reading FD3. EOF, missing descriptor and malformed release fail closed. This is a **cooperative** barrier only: the child process already exists and may execute imports, and a compromised child or test override can ignore the handshake. The callback must be trusted and registration must not be interpreted as native kernel attestation. No secrets are sent via FD4.

## Broker-owned Linux registry adapter

`createSupervisorLinuxWorkerLifecycle()` supplies the opt-in manager callback contract using `createLinuxBrokerProcessRegistry()` and procfs process identity. It registers the spawned PID/UID/run/worker/attempt, revokes on exit, rejects duplicate registrations and mismatched UID, and handles exit during asynchronous registration. A pending exited PID cannot be reused until the original registration settles. It is **not enabled by default** or connected to a privileged supervisor deployment. `resolveAttestedPeer` is diagnostic only and must never receive worker-supplied peer objects as authority. Same-UID workers and pre-gate imports remain security gaps. No positive credential admission.

## Real Linux lifecycle integration qualification

`tests/agents/ge04-real-worker-lifecycle.test.ts` exercises actual `SubagentManager.spawn` with Linux `/proc` registration, FD4 cooperative release, empty FD3 snapshot, exit revocation, and registration failure termination. It uses a Node fixture as the worker, not the complete production ALiX CLI. The resolver call in this test supplies a synthetic `VerifiedBrokerPeer` object: it does **not** demonstrate kernel-attested IPC, distinct UIDs, or secure credential isolation. The hook is still opt-in; no production activation or positive admission is allowed.

---

## R2S protected witness dependency (2026-11-08; proposed)

Future positive worker admission must not derive permission from trust-service availability, TLS connectivity, a signed receipt, or a synthetic `evidenceConsistent` result. Failure to authenticate the witness, verify the independent monotonic floor, consume a fresh challenge, reconcile privileged issuer custody or verify descendant containment requires a **fail-closed protected admission/recovery decision**. When the trust service is offline, ALiX may continue only the operations already independently permitted by existing local policy; no cached receipt or degraded-mode bypass may silently authorize new protected workers. See [ADR-0018](../architecture/adrs/ADR-0018-independent-trust-service.md). Production opt-in remains prohibited by the current GE-04 SECURITY HOLD.


## Source-integration decision versus production authorization

**Decision (2026-11-08):** GE-04 qualification-only source code and test evidence MAY be merged into the ALiX development baseline without an independent Q13 *production release* decision, provided the PR is explicitly scoped as non-deployable/non-authorizing and ordinary repository review/CI requirements are met. This is an integration decision only; it is not proof of GE-04 security qualification.

Before merging such a PR, a reviewer must verify and record all of the following on the exact integration tip:

1. All privileged worker launch, credential admission, checkpoint commit and recovery functions remain disconnected from production dispatch, or remain provably fail-closed; no feature flag or configuration can turn a qualification fixture into production authorization.
2. Every changed authority-bearing boundary has an explicit owner; no parallel policy, approval or recovery authority is introduced. The merge must not silently replace an existing denial with a positive grant.
3. Required GitHub branch checks, supported-platform regressions and cumulative merge simulation pass. Skipped privileged/VM tests are **not** qualifying evidence. A documented engineering review and operator decision are required; independent security review remains required before promoting a prototype into a trusted production boundary.
4. Release records, documentation, operator runbooks and test fixtures consistently declare **GE-04 SECURITY HOLD ACTIVE**. The source merge cannot create a signed release, provision hardware, install a privileged service, distribute credentials or enroll a trust root.

**Separate release gate:** Independently administered signing/rollback protection, real containment and peer authentication, crash/recovery qualification, independent security review and Q13 security clearance remain required **before any production authorization or GE-04 security hold removal**. A green PR, successful integration or test-only merge does not satisfy that gate.

If any integration criterion is unverified, keep the PR in draft and block the merge. If the repository's ordinary branch policy requires additional review, follow it rather than overriding checks.
