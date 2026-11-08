# GE-04-R2G descriptor-relative recovery observation (2026-11-08)

## Qualification limits
Linux-only, read-only, non-privileged and non-authorizing. Security hold ACTIVE. No supervisor launch, ledger clearance, custody takeover, credential delivery or production enablement.

## Implementation
ALiX local uncommitted:
- scripts/ge04-r2g-fd-recovery-probe.py
- tests/agents/test_ge04_r2g_fd_recovery_probe.py

Uses O_DIRECTORY|O_NOFOLLOW open on cgroup ancestor and leaf directories, descriptor-relative cgroup.events reading, /proc/<pid>/stat via process-directory descriptor, repeated process start-time reads, stable inode/dev/metadata before and after, and fresh descriptor walk to detect simple path replacement. This prototype does not create independently trusted expected dev/inode and cannot close all path-race windows. Every outcome is blocked.

## Results
8/8 Python unit tests passed, including symlink leaf, inode mismatch, post-open rename/replacement, malformed events, wrong generation, absent PID and invalid path. 

Ran the actual Python probe inside KVM guest alix-ge04-kvm01 (Debian kernel 6.12.115+deb13.1-amd64) via provisioned SSH key:
- leaf=user.slice/user-1000.slice/session-30.scope (ephemeral)
- process=matching
- populated=yes
- leaf_identity_stable=true
- matches_expected_leaf=true
- status=blocked
- expected identity was sampled by the same unprivileged process: NOT independent attestation.

## Remaining gates
Trusted exclusive custody, kernel-authenticated independent expected identity, pidfd-based process generation evidence, hostile descendant containment, crash recovery authorization and protected writer exclusivity are unproven. No security hold release.
