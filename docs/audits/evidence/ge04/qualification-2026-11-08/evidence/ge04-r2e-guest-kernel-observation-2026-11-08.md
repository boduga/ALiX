# GE-04-R2E read-only guest kernel observation  2026-11-08

## Scope
Dedicated KVM qualification guest alix-ge04-qual-01, guest hostname alix-ge04-kvm01, guest private IP 192.168.122.21, accessed from microcloud3 with the existing dedicated qualification private key. No new keys, sudo privilege, credentials, production admission, cgroup mutation, or worker launch were used.

## Guest read-only result
- Guest kernel: 6.12.115+deb13.1-amd64
- Observed process PID: 1806 (ephemeral)
- /proc/<pid>/stat startTimeTicks: 570723
- Repeat process-generation comparison: true
- Dynamically located cgroup.events: /sys/fs/cgroup/user.slice/user-1000.slice/session-28.scope/cgroup.events
- populated: 1 (expected while probe running)
- A spawned /bin/true subprocess exited, and /proc/<pid>/stat was absent after wait: true
- Node and Python available in guest

## Interpretation and limitations
PASS for reading live kernel process-generation and cgroup.events state in the dedicated VM. These probes were implemented as a read-only Python observation, not execution of the TypeScript R2E observer inside the guest. A disappearing PID and cgroup populated state do not prove containment, exclusive supervisor authority, cgroup inode identity, termination of hostile descendants, or recovery clearance. Session-scoped cgroup paths change on each SSH connection and must not be reused. The account's prior SSH login failed because no default private key was configured; the existing provisioned key at vm/debian-13/qualifier_ed25519 succeeded.

Security hold ACTIVE. No worker launch, automatic recovery, ledger clearance, credential delivery, or production qualification.
