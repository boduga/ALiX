# GE-04 fixed systemd unit — kernel correlation contract

**State:** Qualification-only, read-only. R1-B1 OPEN; SECURITY HOLD ACTIVE.

`native/ge04/unit_kernel_observer.py` requires a *supplied* immutable original
unit/keeper/mount/ancestry claim and reads the current manager via
`systemd_unit_observer.py`. It correlates the exact fixed service's
manager-reported invocation/MainPID/control group with procfs PID start ticks,
observer-owned pidfd liveness, exact self cgroup membership, one canonical
cgroup2 mountinfo entry from the keeper, held directory FD root-to-unit inode
identity and exact keeper PID membership in `cgroup.procs`. It rechecks procfs,
mountinfo and manager owner/Unit/Service properties after reading. No signals,
service/cgroup operations, namespace changes, process launch, ACK or cleanup.
The only successful result is `UNQUALIFIED_MANAGER_KERNEL_CORRELATION`.

Local tests exercise a deterministic directory-backed fixture and mocked
pidfd/procfs records, mount/keeper/inode substitutions and manager-owner
changes. The host's actual fixed qualification service is absent, and the
positive test is **not** a real protected systemd unit qualification.

**Not proven:** origin of supplied prebirth record, trusted systemd unit
creation and original non-existence, external issuer of sealed descriptor,
keeper namespace and inherited-FD custody, pinned cgroup mount superblock,
whole-descendant completeness, exclusive parent ownership, recovery/quarantine
or authority to run a worker. A matching pidfd and process membership does
not prove first birth or that a malicious descendant cannot exist. The
observer must never be treated as a security gate without independent source
review and reviewed disposable-VM root execution. No caller is connected to
production. SECURITY HOLD remains active.

## Read-only model review and corrections

A separate Codex engineering review identified two P2 defects: procfs
mountinfo and cgroup membership were read with a single `read()`, allowing
short-read truncation to be mistaken for complete evidence; and normal
S-to-R keeper scheduling transitions were rejected as identity changes.
The code now loops to EOF within strict byte bounds and separately requires
a live acceptable process state at both samples while preserving the original
PID/start-generation and pidfd. New tests cover short reads and scheduler
transitions. **5/5 focused tests passed after correction.** Review is a model
code review, **not** independent native security approval.
