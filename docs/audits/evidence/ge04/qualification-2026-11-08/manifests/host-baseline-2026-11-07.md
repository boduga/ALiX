# microcloud3 host baseline"éÝyø§yÔ 2026-11-07

## Identity
- Host: microcloud3
- Address: 10.1.1.22
- OS: Ubuntu 24.04.5 LTS
- Kernel: 6.8.0-147-generic
- Account: babasola
- Role: permanent ALiX sandbox and qualification host

## Available runtime
| Component | Observed version / state |
|---|---|
| Docker | 29.1.3, active |
| Incus | 7.6, active |
| libvirt / virsh | 10.0.0; socket activation available |
| QEMU | 8.2.2 |
| virt-install | 4.1.0 |
| qemu-img | 8.2.2 |
| KVM | /dev/kvm present; virt-host-validate previously reported all PASS |
| Incus default pool | dir, created |
| Incus bridge | incusbr0, 10.97.222.1/24 |
| Incus instances | none at inventory time |
| libvirt domains | none at inventory time |
| Docker containers | none at inventory time |

## Capacity snapshot
- RAM: 5.7 GiB total; 4.9 GiB available at inventory time.
- Swap: 4 GiB.
- Root filesystem: 228 GiB total; 198 GiB available.
- Use conservative guest limits; avoid memory overcommit during qualification.

## Host security constraints
- Unified cgroup v2 is mounted at /sys/fs/cgroup.
- Host cgroup root observed as root:root, mode 0555 (read-only).
- /sys/fs/cgroup/cgroup.kill was absent at inventory time.
- Do not remount, chmod, chown, reconfigure delegation, or otherwise mutate host cgroup/security settings.
- Host-level privileged containment experiments are out of scope. Use a disposable VM and qualify the guest kernel boundary separately.
- Existing read-only GE-04 preflight helper and sudoers policy must remain untouched.

## Existing ALiX checkout ºw^~)Þt preserve
Path: /home/babasola/Projects/ALiX
- Branch: feat/ge04-q31-distinct-uid-qualification
- HEAD: 1c055e5731207998bafe1cc563c0236eef841027
- Worktree was clean at inventory time.
- Compared with current remote main (3599c1fdacc4902ea046c52421ae48fbdc591497): diverged, 105 commits ahead and 4 behind.
- This checkout is not the deployment baseline and must not be overwritten.

## Development / candidate refs observed
- Development checkout: feat/ge04-r1b1-supervisor-contract, b0a335e7e03285cd8ec1f2557f7be89d03e376a0.
- PR #1060 is draft and contract-only; no production wiring or OS isolation.
- PR #1068 is open; read-only capability discovery only, with worker-launch authorization false.
- These candidates remain separate from the baseline and are not qualified production containment.

## Initial deployment baseline
Path: /home/babasola/alix-qualification/checkouts/main-3599c1f
Commit: 3599c1fdacc4902ea046c52421ae48fbdc591497
Checkout is detached and clean. No dependencies have been installed and no ALiX service or worker has been started.
