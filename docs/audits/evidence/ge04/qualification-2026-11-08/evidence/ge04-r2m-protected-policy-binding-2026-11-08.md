# GE-04-R2M protected issuer-policy consistency evidence — 2026-11-08

## Disposition
SECURITY HOLD ACTIVE; qualification-only. No production worker admission, credential delivery, privileged issuer activation, recovery ledger clearance, policy provisioning, or PR merge.

## Implementation (local ALiX worktree; uncommitted)
- scripts/ge04-r2m-protected-policy-binding.py
- tests/agents/test_ge04_r2m_protected_policy_binding.py

## Design
Read protected policy manifest through R2H descriptor-relative protected-file checks; validate R2M schema, four distinct issuer/verifier/worker/attacker UID assignments, boot ID, issuer ID, custody directory/manifest name, cgroup identity and policy revision presence. Check real AF_UNIX SO_PEERCRED via R2K against the policy issuer UID and verifier effective UID; check sticky issuer claim/held lock/worker manifest against R2J. All states return status=blocked. ConsistencyChecksPassed is not a release gate and must not be wired to admission.

## Results
- R2M focused Python: 10/10 PASS
- R2G-R2L Python regression: 56/56 PASS
- R2A-R2F and R1B1 Vitest regression: 35/35 PASS
- pnpm typecheck: PASS
- Live Debian guest alix-ge04-kvm01 read-only missing-policy probe: status=blocked, policyVerified=false, peerVerified=false, custodyVerified=false, consistencyChecksPassed=false. Reason: FileNotFoundError, no independently authenticated issuer authority. Guest source copied into /tmp only. No policy file created or changed.

## Limits
The passing positive fixture simulates distinct verifier UID; it does not prove real protected-policy + true cross-UID issuer integration. Operator-owned policy provenance, monotonic policy revisions, OS-level exclusive privileged writer identity, pidfd process lifetime, cgroup ownership and hostile descendant containment remain unqualified. R2L true cross-UID socket denial proof passed earlier, but not integrated with an independent protected issuer-policy store. No security-hold release.
