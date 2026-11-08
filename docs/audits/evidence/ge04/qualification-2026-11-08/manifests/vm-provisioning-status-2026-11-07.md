# VM provisioning attempt+ßuÁ‚ùÁT 2026-11-07

## Result

No qualification VM was created.

## Incus attempt

Requested a separate Ubuntu 24.04 virtual machine named `alix-ge04-qual-base` with:
- 2 GiB RAM
- 2 vCPU
- 24 GiB root disk
- Existing Incus default profile/network
- No host cgroup or security configuration changes

The Incus CLI connected to the local daemon and received the API root response, but did not proceed to create an instance or publish an operation. Two bounded attempts timed out (one manually interrupted after 179 seconds; one diagnostic attempt stopped after 25 seconds). `incus list` and `incus operation list` remained empty. No VM instance or downloaded image was left behind.

## Libvirt fallback discovery

- `virt-install` 4.1.0 is installed.
- `genisoimage` and `xorriso` are installed.
- The libvirt `default` network is active and persistent.
- No libvirt storage pools or domains existed at inventory time.
- `/dev/kvm` is present and the QEMU system service account belongs to group `kvm`.
- A canonical Ubuntu 24.04 cloud image and SHA256SUMS were identified. The image is 621,284,352 bytes. Download speed from both microcloud3 and ideapad was too slow for a practical transfer in this session; the partial download was stopped and removed. The checksum file is retained under `vm/ubuntu-24.04/SHA256SUMS`.

## Current state

- The pinned ALiX main checkout remains clean.
- The pre-existing `~/Projects/ALiX` checkout remains untouched.
- No libvirt pool, VM, or network configuration was created or changed.
- No host cgroup, sudoers, permission, or security-control changes were made.
- GE-04 SECURITY HOLD remains active; no credential-bearing worker was launched.

## Next implementation path

Diagnose the Incus VM launch stall or provision the disposable guest through the already-active libvirt default network. Prefer a small, checksum-verified server cloud image or a locally transferred image. Keep the guest bounded to 2 GiB RAM and 2 vCPU, and use a fresh disposable clone/snapshot for each hostile-worker qualification run.
