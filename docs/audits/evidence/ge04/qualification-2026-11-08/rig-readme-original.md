# ALiX Qualification Host

This workspace is separate from the existing ALiX checkout and configuration. It is the permanent home for reproducible sandbox and security-qualification runs on microcloud3.

## Rules
- Source of truth remains the ALiX development repository and reviewed Git commits.
- Never overwrite or repurpose /home/babasola/Projects/ALiX.
- Pin every candidate run to a full Git commit SHA and record guest image, kernel, VM/container configuration, test command, and evidence.
- Keep baseline, candidate, and evidence artifacts separate.
- Do not place API keys, provider credentials, or user secrets in this workspace.
- Do not launch credential-bearing workers. GE-04 SECURITY HOLD remains active.
- Do not modify host cgroup configuration, host security controls, sudoers, or the existing read-only preflight helper.
- Run kernel-containment and hostile-worker experiments inside disposable guests, not against the host.
- Passing tests alone do not qualify GE-04 or authorize release.

## Layout
- checkouts/: isolated source checkouts pinned to exact commits.
- releases/: immutable candidate bundles and checksums.
- manifests/: host, source, guest, and run manifests.
- evidence/: raw test outputs and qualification evidence.
- vm/: guest lifecycle metadata (not guest disks).
- logs/: orchestration and provisioning logs.

## Initial baseline
See manifests/host-baseline-2026-11-07.md and manifests/source-lock.env.
The first source checkout is detached and clean at 3599c1fdacc4902ea046c52421ae48fbdc591497. It is a baseline only; GE-04 candidate branches remain separately gated.

## KVM qualification guest
The first disposable KVM guest is alix-ge04-qual-01 (Debian 13.7, kernel 6.12.115+deb13.1-amd64, 2 vCPU, 2 GiB RAM). It is reachable on the libvirt NAT network at 192.168.122.21. The guest contains the pinned GE-04 candidate commit d173f9bff27ccf74cf0d66e60d69fe20190550ff. Four focused Linux-containment Vitest files passed 57/57. See manifests/kvm-guest-alix-ge04-qual-01-2026-11-08.md for image provenance, exact VM settings, validation limits, and the build attempt status.
