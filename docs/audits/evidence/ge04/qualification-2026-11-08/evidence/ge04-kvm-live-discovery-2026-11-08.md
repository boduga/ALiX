# GE-04 KVM live discovery - 2026-11-08
Host: microcloud3 (10.1.1.22)
Guest: alix-ge04-qual-01 (192.168.122.21), Debian 13.7, kernel 6.12.115+deb13.1-amd64
Candidate: d173f9bff27ccf74cf0d66e60d69fe20190550ff
Node 26.11.0; pnpm 11.28.11; Vitest 5.0.5

Read-only live test called discoverLinuxContainment() and observeLinuxContainment() against actual guest /proc and /sys; 1/1 passed. Four focused tests: 57/57 passed. Temporary test removed; checkout clean.

Discovery:
- cgroup2 mount observed: mount-id 31, device 0:26, mount-root /, options rw,nosuid,nodev,noexec,relatime.
- Unified cgroup membership observed, namespace-relative.
- Non-root cgroup.kill file observed; write authority unverified.
- pidfd, stopped-child attach, exclusive delegation remain unverified.
- Namespace inodes and uid/gid maps observed; host ownership unverified.
- AppArmor enabled; SELinux state unknown.
- Runtime identity unknown (missing container markers do not prove native host).
- supportedForQualification=false; authorizedForWorkerLaunch=false.

Observer:
- cgroupVersion=2, cgroup2Mount=true.
- cgroupKill=false, pidfd=false, delegatedExclusiveSubtree=false, namespaceMappingKnown=false, securityPolicyKnown=false, environment=unknown.
- eligibleForQualification=false; authorizedForWorkerLaunch=false.
- Unprivileged qualifier could not read /proc/1/ns/cgroup or /proc/1/ns/user (permission denied); namespace comparison unknown.

No worker launch, credentials, cgroup mutation, or host security changes.
This is read-only discovery, NOT kernel containment qualification.
Next: disposable guest-only credential-free experiments and independent review.
GE-04 SECURITY HOLD ACTIVE.
