# GE-04 Q3.1 — distinct-UID supervisor isolation experiment (HOLD)

**Scope:** opt-in external-host experiment; not a production supervisor installation or independent security approval. Issue #1050 tracks this preparatory subgate. The roadmap's later Q3 native mutation qualification is separate. GE-04 SECURITY HOLD remains active; `createScopedMutationService()` remains unavailable.

Q2 (`scripts/ge04-q2-custody-fixture.py`) already checks a supervisor-owned `0710` directory and group-accessible `0660` `SOCK_SEQPACKET` socket with `SO_PEERCRED`. Q2's normal CI uses the same actual UID for client/server and cannot establish custody. Q3.1 adds `scripts/ge04-q31-distinct-uid.py` and `scripts/test-ge04-q31-distinct-uid.py`. The latter verifies refusal/prerequisite behavior in CI, not cross-UID acceptance.

## Independent-operator procedure — disposable Linux host only

An independent administrator, not the ALiX agent, must provision three separate non-root Linux UIDs (supervisor, coordinator, unrelated attacker) and an exclusive transport group. Only the coordinator belongs to that group. An independently controlled launcher with required test-only privileges invokes the following in a disposable environment:

```sh
python3 scripts/ge04-q31-distinct-uid.py --isolated-test \
  --supervisor SUPERVISOR_ACCOUNT \
  --coordinator COORDINATOR_ACCOUNT \
  --attacker UNRELATED_ACCOUNT \
  --group TRANSPORT_GROUP
```

The script does not create accounts, install services, generate keys, or activate mutations. It attempts a real cross-UID Q2 denial exchange and checks that an unrelated UID cannot connect. Output always carries `disposition: HOLD`, including when the transport experiment succeeds (process exit `0` means only that the experiment completed). Missing prerequisites or failed checks exit `78`. Do not run on a production host. Running a fixture as root under ALiX's control does not establish independent custody.

## Remaining blockers

- The disposable `microcloud3` host (`10.1.1.22`) has three provisioned distinct non-root test UIDs. The operator supplied the deny-only launcher output reporting supervisor UID 995, coordinator UID 994, attacker UID 993, transport GID 986, `attacker_denied: true`, `coordinator_denied: true`, `credential_match: true`, directory `0710`, socket `0660`, and `disposition: HOLD`. This is operator-reported evidence, **not independently witnessed or attested** by the harness or a reviewer. It establishes a reported cross-UID transport experiment, not independent custody.
- An unprivileged **same-UID** fork/inherited-connected-FD negative test now demonstrates that `SO_PEERCRED` still matches the original connector when another process sends a forged approval frame; the fixture still replies `DENIED`. This proves a credential-attribution limitation, **not cross-UID FD delegation resistance**. Empty-frame rejection is also covered. Cross-UID descriptor delegation has now been reproduced as a negative attribution finding (operator-reported; see below), not qualified as safe. Peer replacement, stale attempt binding, namespace/path races, socket substitution and protected runtime/loader provenance remain unqualified.
- Signing-key and protected policy/approval/lease custody, rollback floor, final-effect authorization, crash/effect receipt qualification, and independent human signoff are absent.
- The Q3.1 script is a **partial probe**, not acceptance of issue #1050's complete negative-test matrix. GE-04 SECURITY HOLD remains active.

## Q3.1 FD delegation adversarial probe (operator-reported execution)

`scripts/ge04-q31-fd-delegation.py` is a separate deny-only, root-launched
**disposable-host** probe. It creates a real connection under the coordinator UID,
passes that connected socket through `SCM_RIGHTS` to the unrelated attacker UID,
and records the kernel's original-peer credential match alongside the actual
sender UID and fixed `DENIED` response. An exit code of zero establishes the
**attribution weakness**, not authorization, safety, or independent custody.
The unprivileged tests only prove the launcher's fail-closed prerequisites.

Stage the scripts in a root-owned, non-writable directory and invoke as an
independent operator (never through a model-controlled privileged command):

```sh
sudo python3 -B /opt/alix-ge04-q31-test/ge04-q31-fd-delegation.py \
  --isolated-test --supervisor alixge04supervisor \
  --coordinator alixge04coordinator --attacker alixge04attacker \
  --group alixge04transport
```

The fixture does not authenticate a request's *current* sender, and the
fixed denial is not a substitute for an effect-time authorization boundary.
GE-04 SECURITY HOLD remains active regardless of the probe outcome.

## Operator-reported cross-UID connected-FD delegation result

The operator supplied the following output from the disposable-host privileged
`ge04-q31-fd-delegation.py` run. It has **not** been independently attested or
reproduced by the repository reviewer:

```json
{"actual_sender_uid":993,"cross_uid_delegation_observed":true,"disposition":"HOLD","gate":"GE04_Q31_FD","kernel_credential_match":true,"original_connector_uid":994,"qualified_independent_custody":false,"response_denied":true,"supervisor_uid":995}
```

The reported result reproduces a security-relevant limitation: the kernel
credential match reflects the coordinator's original connection (UID 994)
although the attacker (UID 993) sends the payload through a delegated FD. The
fixture's fixed `DENIED` reply is not proof that a future authorization-bearing
supervisor resists delegation. **Do not accept SO_PEERCRED as per-request
sender identity or promote this result to independent custody clearance.**

Next required design gate: bind each effect authorization to the independently
verified request, attempt, capability, policy revision, and effect-time fence;
reject stale/replayed or delegated requests, and independently test the
protected runtime, key custody, crash recovery and human signoff. The GE-04
SECURITY HOLD remains active.

Next design-only gate: [Q3.2 attempt binding and last-effect fence](ge04-q32-attempt-binding-design.md).
