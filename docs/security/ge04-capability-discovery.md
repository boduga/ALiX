# GE-04-CAP — read-only Linux capability discovery

## Contract

`discoverLinuxContainment()` returns a versioned, structured report with explicit `observed`, `absent`, or `unknown` evidence and denial reasons. It is safe to call without root; its default I/O reads procfs, sysfs and runtime marker files only. Tests inject a fake read-only I/O source. No subprocesses, cgroup writes, sudo, worker spawning or signals occur.

The observations are **non-atomic, point-in-time reads**, not a pinned snapshot: mountinfo, membership, namespace links and filesystem markers are read separately and may change between probes. A report must not be treated as a mutually consistent or race-free view of host state. A cgroup2 mount whose reported mount root is not `/` is explicitly denied as host-root evidence.

This detector is **not** an authority provider: `supportedForQualification=false` and `authorizedForWorkerLaunch=false` unconditionally. The earlier `assessLinuxContainment()` is also qualification-only. Neither can override the GE-04 security hold.

## Evidence and limitations

| Probe | Read-only evidence | What remains unverified |
| --- | --- | --- |
| `/proc/self/mountinfo` | Unified cgroup2 mount at expected mountpoint, reported mount ID, device, root/options (not pinned or authenticated) | Kernel mount identity pinning, delegated writable subtree, exclusive ownership |
| `/proc/self/cgroup` | Single unified hierarchy membership | Host cgroup path and parent authority |
| `/sys/fs/cgroup/cgroup.kill` | Regular control-file presence | Actual write permission, kernel enforcement and safe ownership |
| `/proc/self/ns/{user,pid,cgroup}` | Namespace inode links | Host namespace equivalence (PID 1 may be container PID 1) |
| `/proc/self/{uid,gid}_map` | Mapping syntax | Mapping to trusted host identity and ownership |
| `/run/systemd/container`, `/.dockerenv`, `/run/.containerenv` | Regular-file/runtime marker hints (including Podman marker presence) | Authenticated container identity, Incus vs standalone LXC, nesting; marker content is not trusted as runtime identity |
| SELinux/AppArmor sysfs | Visible policy status | Policy permissions and confinement of spawned workers |
| pidfd, stopped-child attach, exclusive delegation | Unknown | Requires separate reviewed trusted syscall/real-kernel qualification |

**Do not infer containment from a distro name, host filesystem, read-write cgroup mount, root inside a container, or cgroup.kill presence.** Marker absence does not establish that the process is native; ambiguous markers require additional verification. Kubernetes/pod and nested configurations remain unqualified until explicitly tested.

## Qualification boundary

GE-04-NATIVE (#1064) must implement pinned cgroup descriptors, exclusive leaf ownership, pidfd-backed process identity, stopped-before-exec attach and kernel membership verification in a disposable VM. GE-04-CONTAINER (#1065) must independently qualify Docker/Podman, Incus-managed LXC and standalone LXC, including rootless/unprivileged and nested configurations. GE-04-QUAL (#1066) records real-kernel hostile-worker evidence. GE-04-ADMIT (#1067) must independently gate production admission. None of these capabilities are proven by CAP alone.

Shared microcloud3 remains read-only. No credential-bearing worker admission until independent security review releases the GE-04 hold.
