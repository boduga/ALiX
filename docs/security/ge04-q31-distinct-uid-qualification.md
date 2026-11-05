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

- No independently administered identity provisioned here, and no real cross-UID execution evidence from this development host.
- Connected-FD delegation, inherited descriptors, peer replacement, stale attempt binding, namespace/path races, socket substitution and protected runtime/loader provenance remain unqualified.
- Signing-key and protected policy/approval/lease custody, rollback floor, final-effect authorization, crash/effect receipt qualification, and independent human signoff are absent.
- The Q3.1 script is a **partial probe**, not acceptance of issue #1050's complete negative-test matrix. GE-04 SECURITY HOLD remains active.
