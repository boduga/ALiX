# GE-04 runtime-view independent binding review — SECURITY HOLD

**Status:** Design/review input only, 2026-11-09. NOT independently approved;
not a privileged launch procedure, qualification result or authorization.
**Scope:** Trusted provenance of the intended systemd unit, cgroup mount,
keeper and root-to-leaf identities before *any* phase ACK. The proposed portable
control plane in [ADR-0019](../architecture/adrs/ADR-0019-cross-platform-worker-execution.md)
does not change the Linux trust boundary.

## Where current local evidence stops

`tests/agents/test_ge04_runtime_view.py` contains read-only parsers and
directory-FD observations, including a pure
`validate_external_cgroup_binding(binding, observed)`. It compares exact
fields but does **not** authenticate either supplied record. The unprivileged
test suite does not provide trusted systemd credentials, a root-owned
pre-execution publication, pin an independently identified cgroup2 mount,
prove fixed-unit ownership or authorize worker execution.

The C helper `native/ge04/cgroup-runtime-view-qualification.c` remains a
closed test fixture with no production caller. Its internal checks do not
constitute independent review of source/root scope, and its stdout/phase
diagnostics cannot become authority. Privileged Python admission remains
unconditionally refused.

## Required independently sourced bindings

| Input | Trusted owner required | Verify before ACK | Current gap |
| --- | --- | --- | --- |
| Unit/invocation | A separately controlled root bootstrap and authenticated systemd manager query | Exact fixed new unit, invocation ID, start/restart state, no adoption of pre-existing unit | No independently authenticated manager response in the staged controller |
| Keeper | Same protected bootstrap plus observer-owned pidfd | Trusted keeper PID and start ticks, owner/UID, membership and live generation after restart | PID/ticks comparison only; no trusted keeper binding |
| Cgroup2 mount | Kernel mount information reached through independently pinned mount-namespace/root descriptors | Exact mount ID and superblock identity, root /, expected cgroup v2 filesystem, no different mount namespace substitution | Text mountinfo parsing; no protected mount/superblock identity pin |
| Cgroup ancestry | Root-owned, exclusive delegated cgroup tree provisioned by the bootstrap | Held directory descriptors and exact root/parent/outer/leaf (dev,ino) identities; parent/unit owner, no pre-existing adoption; cgroup filesystem and single-owner checks | Synthetic path and dev/ino comparisons, not provenance of expected identities |
| Worker generation | Kernel process identity observed by a separately trusted controller | Observer-owned pidfd, procfs ancestry, exact start ticks/UID and stopped state, cgroup membership from held directories | Unprivileged pidfd tests only; no protected stopped-before-restricted-exec admission |
| Private intent/approval | Independent protected publisher, fsync and custody validation | Original canonical immutable pre-birth intent, exclusive journal binding, fresh invocation and monotonic/fenced retry semantics | Parser/fixture records only; root publication and failure recovery unqualified |
| Failure and cleanup | Independently bound unit, protected journal, kernel cgroup controls | Exclusive subtree ownership, real descendant-empty evidence, bound cleanup budget, quarantine on any mismatch | No live controller, real hostile worker evidence or crash-recovery gate |
| ACK | Independent observer after all above | Exact single-use phase ACK only after independently corroborated kernel facts; never from helper stdout alone | Explicitly unimplemented and refused |

## Mandatory refusal cases

Any unsupported/restarted unit, changed invocation, lost or nonresponsive keeper,
different guest/namespace, mount ID or filesystem mismatch, changed directory
identity, unexpected cgroup member, absent controller/limit, partially read
state, extra executable/credential FD, unknown descendant, unproven cleanup,
expired approval or ambiguous protected journal must yield HOLD/QUARANTINE. A
failed verification must not invent a new unit/leaf, signal a numeric PID,
kill a shared ancestor, retry an ambiguous attempt or return a positive ACK.

## Review and implementation order

1. Independent source reviewer validates C helper, diagnostic protocol,
   fd/mount/ns/cgroup custody and confined fault modes against a frozen
   source SHA-256. Reviewer has **not** yet signed this source.
2. Separately review root bootstrap ownership/absence checks and the original
   immutable binding publication before any native child exists. The holder
   of a binding must not be permitted to mint/replace its own expected proof.
3. Implement a separate, reviewed **read-only** protected observer and test
   its refusal matrix; keep root qualification disabled during development.
4. Review exclusive cleanup/recovery authority, restart and hostile-descendant
   evidence, then capture an explicit operator-scoped disposable-VM
   qualification plan, hashes, witnesses and stop conditions.
5. Only after independent security approval for the *exact staged tip* may an
   operator separately authorize privileged qualification. An eventual
   positive local test is not Q13 production approval.

## Existing verification and limitations

`python3 -B -m unittest discover -s tests/agents -p test_ge04_runtime_view.py -q`
currently has 24 passing **unprivileged** tests, including exact supplied
unit/mount/keeper/ancestry binding mismatch rejection. The result is
contract testing; it cannot demonstrate the independent origin of either
input to the comparison.

**Decision:** Remain in SECURITY HOLD; no root test, privileged install,
worker admission, production native code, approval grant or gate closure.
