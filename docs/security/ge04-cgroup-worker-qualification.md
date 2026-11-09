# Fixed cgroup worker qualification

GE-04 SECURITY HOLD remains active. This is a closed synthetic fixture for the
designated disposable Linux x86-64 VM, not a production supervisor/backend.
The operator selected exclusive cgroup ownership as recovery authority.

`native/ge04/cgroup-worker-qualification.c` accepts only named test modes. It
accepts no path, executable, PID or UID arguments; worker UID/GID is fixed20002.
Nonroot execution refuses before writes. The fixed worker only drops privilege,
forks one setsid descendant and idles. No model, shell, network, keyring or
credential operation exists in the worker. No production consumer is wired.

## Ownership and launch

Use only a newly created `ge04-r1b2-qualification.service`, with its idle trusted
keeper in a `controller` subgroup. Never reuse the witness unit or any existing
unit, login/session scope, root cgroup or shared ancestor. No persistent unit or
sudoers change is made. The native fixture pins root-owned non-writable ancestry,
cgroup2 device/inode, exclusive random leaf and its kernel controls. It never
adopts an existing leaf or writes shared delegation controls.

An immutable protected intent is fsynced before
`clone3(CLONE_INTO_CGROUP|CLONE_PIDFD)`. The child belongs to that leaf from its
first instruction and stops in trusted fixture code before restricted execution.
Trusted child setup redirects standard streams to validated /dev/null and closes
inherited high descriptors **before SIGSTOP**, including the shared flock and
controller pipes. Otherwise a stopped orphan could block recovery and EOF.
The parent verifies pidfd/generation and kernel stopped membership, writes only
that child through the pinned `cgroup.procs`, verifies again, then resumes using
pidfd. Unsupported primitives deny with no fork/PID/process-group fallback.

While unit/parent/leaf bindings and exclusive custody remain valid, cleanup may
terminate every member of that owned leaf, including a stopped root launcher or
unrecorded descendant. No other administrative actor may place unrelated tasks
inside it. Broken identity/custody preserves quarantine; it does not authorize
another leaf or shared ancestor kill. Per-process records are qualification
observations, not the collective cleanup authority.

## Private records and recovery

The controller creates `/run/ge04-cgroup-qualification` exclusively, root0700.
Native accesses its fixed root0600 single-link records under a nonblocking flock:

- `approval.v1`: `GE04A1 <invocation32hex> <parentDev> <parentIno>\n`.
- `intent.v1`: `GE04I1 <invocation32hex> <parentDev> <parentIno> <worker-16hex> <leafDev> <leafIno>\n`.
- `intent.tmp`: complete/fsynced unpublished record before exclusive rename and
  directory fsync. No child exists before successful intent publication.

Parsers require bounded canonical ASCII, exact fields/newline, no NUL, signs,
overflow or noncanonical decimal spelling. No normal in-place intent updates.
Recovery compares protected intent, approval and pinned kernel identities before
leaf `cgroup.kill`, populated0 verification and exact cleanup. Root caller checks
live systemd invocation and keeper identity; the native file is not independent
systemd attestation. `/run` provides same-boot fixture evidence, not reboot or
power-loss durability or protected production registration.

Pre-intent crash residues cannot authorize worker recovery. A separate empty
sweep can rmdir only validated empty worker-named cgroups inside the newly owned
unit and remove canonical unpublished metadata. It never writes cgroup.kill or
adopts a process. Populated, malformed or mismatched state remains quarantined.

## Trusted staging and execution

After independent source/root-scope review, the execution session exclusively
creates `/run/ge04-cgroup-code` with root0700 directories. Stage only the reviewed
C source and Python controller into their repository-relative layout; files0400.
Verify frozen source hashes as root before compile. Compile with trusted `cc`
and `-Wall -Wextra -Werror -O2` into root0500 `bin/probe`. Record source/controller/
binary hashes in root0400 `manifest.json`, schema1 with exactly `sourceSha256`,
`controllerSha256`, `binarySha256`. The bootstrap owns staging creation/removal;
the staged controller validates existing custody/hashes and never stages itself.
No sudo grant to repository paths or root execution of a user-writable checkout.

The controller starts this exact new unit only after absence/UID/witness checks:

```sh
systemd-run --no-ask-password --unit=ge04-r1b2-qualification.service \
 --property=Delegate=yes --property=DelegateSubgroup=controller \
 --property=TasksMax=32 --property=CPUQuota=50% \
 --property=KillMode=process --property=OOMPolicy=continue \
 -- /usr/bin/gnusleep infinity
```

There is no automatic unit lifetime timeout or whole-subtree teardown bypass.
KillMode=process constrains unit stop to the known keeper. Teardown requires the
original invocation/keeper identity and verified empty worker/journal state.
Uncertainty leaves the unit and evidence quarantined for scoped recovery.

Local compile/argument/nonroot checks:

```sh
python3 -m unittest discover -s tests/agents -p test_ge04_cgroup_worker.py -v
```

After reviewed root staging, exact privileged invocation on the designated VM:

```sh
sudo -n env -i PATH=/usr/bin:/bin HOME=/nonexistent LANG=C \
 ALIX_GE04_STAGE_IDENTITIES="$ORIGINAL_BOOTSTRAP_RECEIPT_JSON" \
 ALIX_GE04_PRIVILEGED_QUALIFICATION=1 ALIX_GE04_CGROUP_QUALIFICATION=1 \
 /usr/bin/python3 -I -S /run/ge04-cgroup-code/tests/agents/test_ge04_cgroup_worker.py -v
```

The original receipt is captured by the trusted bootstrap before execution; it
contains the exact stage entry device/inode map and cannot be reconstructed from
a later current inventory. Missing or changed receipt bindings deny execution.
Root mode refuses an unstaged repository invocation. It verifies the staged
manifest and uses the prebuilt helper, without recompiling mutable inputs.
Bootstrap deletes only fixed hash-matched staging files and empty directories
after successful verified unit cleanup/evidence capture; no recursive deletion.

## Observation and evidence limits

Privileged controller/helper use a private bounded phase/ack pipe. Worker standard
streams become validated /dev/null and inherited high FDs close before restricted
code. Phase lines schedule independent kernel/file observations; stdout alone is
never worker admission evidence. File publication, stopped/attached membership,
restricted descendants and empty state are independently checked. Injected EBADF
and generation mismatch are named synthetic faults, not actual disk failure/PID
reuse qualification. Tests also cover protected-record mismatch, concurrent
writer refusal and teardown refusal with an incorrect expected unit identity.

No containment test has run merely because this contract exists. Preserve actual
commands, source/binary hashes, all results/skips/failures, unit identities,
before/after witness and labeled process/directory counts. Local skips are not
qualification. Recovery tests cover native helper death while trusted controller
and owned unit survive; not whole-controller death, host reboot, arbitrary
hostile binaries, constrained filesystem/network, production task integration,
broker inference/authorization or independent F release. These remain open.

The systemd delegation arrangement follows its primary
[delegation documentation](https://github.com/systemd/systemd/blob/main/docs/CGROUP_DELEGATION.md).
No documentation or agent review grants production or independent security release.

Source-review corrections require current leaf/control custody before destructive
writes, exact published-record presence and stable leader PID/starttime through
phases. READBACK observes stopped membership before the injected generation
comparison; other prerequisite failures cannot count as that mismatch. Actual
flock contention has a distinct LOCK_DENIED result. BaseException cleanup attempts
verified recovery outside unittest teardown, with quarantine fallback. Tests
interrupt TEMP/CHILD/RUNNING, reject unknown work artifacts before unit stop, and
change root-group writable bits in owned fixtures to prove custody denial. No
unprivileged write permission is granted; exact modes are restored before recovery.

Executed closed-fixture results and evidence limits are recorded in
`docs/audits/evidence/ge04/r1b2-cgroup-2026-11-09/record.md`. This evidence
does not change the SECURITY HOLD or qualify the remaining B2 requirements.
