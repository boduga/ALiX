# KVM Qualification Guest  2026-11-08

## Host
- Hostname: microcloud3
- OS: Ubuntu 24.04.5 LTS
- Host kernel: 6.8.0-147-generic
- Hypervisor: KVM / QEMU 8.2.2 / libvirt 10.0.0
- Hardware virtualization: Intel VT-x available
- Host cgroup filesystem: cgroup v2, mounted rw; root directory remains mode 0555 (root:root)
- Host /sys/fs/cgroup/cgroup.kill: absent

## Guest
- Domain: alix-ge04-qual-01
- UUID: 5f5629a5-123e-4edd-98d2-6033ea129bed
- State at record time: running; SSH verified after reboot
- Guest OS: Debian GNU/Linux 13.7 (trixie)
- Guest kernel: 6.12.115+deb13.1-amd64
- vCPU: 2
- RAM: 2048 MiB
- Disk: 20 GiB qcow2 overlay, backed by immutable Debian base image
- Network: libvirt default NAT, MAC 52:54:00:22:82:34, DHCP 192.168.122.21/24
- SSH operator: qualifier; keypair stored in this workspace, private key mode 0600
- Storage pool: alix-qualification, persistent and autostart enabled
- VM autostart: disabled; guest remains disposable and is started explicitly

## Image provenance
- Source: https://cloud.debian.org/images/cloud/trixie/latest/debian-13-generic-amd64.qcow2
- SHA-512: 1207e6e3efaff8ee77ab7a32c156a3eea6a9e53f94cfc48efbd1f49ba554ca36ac62ab27395aa813a1775a8c0a393b1a1ce5377d9e5670f6113e3110c57fee4b
- Verified against the official SHA512SUMS file before use.
- Persistent cloud-init seed ISO: /var/lib/libvirt/images/alix-qualification/seed.iso

## ALiX candidate deployment
- Repository: https://github.com/boduga/ALiX
- Branch resolved at deployment: feat/ge04-cap-readonly-pr
- Exact detached commit: d173f9bff27ccf74cf0d66e60d69fe20190550ff
- Node.js: v26.11.0
- pnpm: 11.28.11 (CI workflow specifies pnpm 11)
- Dependency install: pnpm install --frozen-lockfile passed; lockfile supply-chain policy check passed (299 entries); 174 packages installed.
- Git worktree: clean; pnpm-lock.yaml unchanged.
- Focused tests: 4 Vitest files, 57/57 passed:
  - tests/agents/ge04-linux-containment-capabilities.vitest.ts (13)
  - tests/agents/ge04-linux-containment-discovery.vitest.ts (21)
  - tests/agents/ge04-linux-containment-observer.vitest.ts (11)
  - tests/agents/ge04-linux-container-runtime-evidence.vitest.ts (12)
- Full pnpm build: not completed. A build attempt caused sustained guest CPU load and SSH responsiveness degradation; the disposable VM was power-cycled. qemu-img check reported no errors, the guest rebooted, and SSH recovered. No build pass is claimed.
- Existing older host checkout /home/babasola/Projects/ALiX remains at 1c055e5731207998bafe1cc563c0236eef841027 and was not overwritten.
- The qualification candidate is deployed inside the guest; the older host checkout is not used as the candidate.

## cgroup v2 probe
- Guest cgroup v2 mount: rw,nosuid,nodev,noexec,relatime,nsdelegate,memory_recursiveprot
- Guest controllers available: cpuset cpu io memory hugetlb pids rdma misc
- Guest root subtree controllers enabled: cpu memory pids
- Root cgroup does not expose cgroup.kill; a temporary non-root child cgroup did expose cgroup.kill with root-only write permission.
- Empty probe cgroup was created, inspected, and removed. No worker process was launched.
- Host cgroup root was rechecked afterward and remained 0555 root:root; no host cgroup changes were made.

## Security status
- GE-04 security hold remains active.
- Worker launch authorization: false.
- Credential-bearing worker launches: prohibited.
- This record proves KVM guest provisioning, candidate deployment, focused unit-test execution, and basic cgroup v2 visibility only. It does not qualify kernel containment, authenticated IPC, exclusive cgroup attachment, crash recovery, or hostile-worker resistance.
