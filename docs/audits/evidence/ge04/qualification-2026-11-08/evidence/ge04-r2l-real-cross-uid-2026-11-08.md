# GE-04-R2L real cross-UID Unix peer-credential qualification — 2026-11-08

## Disposition
LIVE CROSS-UID PROBE PASS. GE-04 SECURITY HOLD ACTIVE. qualifiedForRecovery=false; credentialDelivery=false; no admission, recovery clearance, or production activation.

## Verified approved call
The user approved the previously reviewed start_process call. The result was recovered from Remote Desktop Commander's recent tool-call history. The approved command WAS NOT rerun.

Process 76852 exited successfully. Dedicated guest alix-ge04-kvm01 (192.168.122.21) was invoked through microcloud3.

Actual guest role UIDs:
- verifier = 62041
- issuer = 62042
- attacker = 62043

Kernel SO_PEERCRED observations:
1. Real issuer: PID 2016, UID/GID 62042; peerIdentityConsistent=true, status=blocked, explicit denial.
2. Attacker forged issuer UID/GID: actual PID 2017 UID/GID 62043; peerIdentityConsistent=false; kernel UID mismatch and claim contradiction, explicit denial.
3. Issuer forged process PID: actual PID 2018 UID/GID 62042; peerIdentityConsistent=false; claimed PID contradicted kernel, explicit denial.

All three clients received denial, no credentials delivered. Result returned gate GE04_R2L_REAL_CROSS_UID; passed=true; disposition=HOLD; qualifiedForRecovery=false.

## Local tests
- Python R2G-R2L: 56/56 PASS
- Vitest R2A-R2F plus R1B1: 35/35 PASS
- pnpm typecheck: exit 0

## Relevant new source (local, uncommitted)
- scripts/ge04-r2l-cross-uid-qualification.py
- tests/agents/test_ge04_r2l_cross_uid_qualification.py
- scripts/ge04-r2k-peercred-gate.py

## Remaining gaps
The isolated test created ephemeral role processes with distinct numeric UIDs, not persisted system accounts. UID separation and SO_PEERCRED do not establish authenticated privileged issuer policy/provenance, pidfd lifecycle custody, exclusive cgroup attachment, crash recovery, hostile descendant containment, or security-hold release. The verifier's trusted config still originates from the test harness. The socket mode 0777 is qualification-only and MUST NOT be reused in production. Never promote PASS to worker-launch authorization.
