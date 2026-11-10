# GE-04 R1-B1 proposed bootstrap publisher — engineering contract

**Status:** SECURITY HOLD ACTIVE. Qualification-only, unprivileged fixture.
This is **not** the root publisher, not an independently protected systemd
manager observation, not original publication, and not a release gate.

## Reconciliation contract

`native/ge04/bootstrap_publisher.py` compares three separately supplied
observations: a frozen **pre-birth record**, an exact fixed **systemd-manager
snapshot**, and a **kernel view**. It refuses absent/extra fields, changed
invocation, service/scope, keeper PID/start generation, non-active service,
unit restart count, missing unit, zombie keeper, mount ID/device/root,
ancestry, stale attempt or inconsistent nonce/digests. Its external reader
callbacks are sampled twice; a changed record is rejected.

The only resulting status is `UNQUALIFIED_PREBIRTH_RECONCILIATION`. A
second function can serialize this record into a fully sealed Linux memfd,
but **only under an unprivileged UID** for adversarial testing. Its return
value is a raw test FD; the independently reviewed receiver still treats it
as `UNQUALIFIED_SEALED_BOOTSTRAP` and has no ACK authority.
`publish_root_bootstrap` unconditionally raises a permission error and
must remain that way until a separately reviewed implementation exists.

## Boundary explicitly NOT achieved

- The three records and the callbacks are supplied by the same test caller.
  Their agreement proves nothing about authentic source custody. A malicious
  caller can invent all three agreeing records and produce a sealed FD.
- The systemd property snapshot is not yet read from the authenticated
  manager over the system bus. The read-only mock does not establish a new
  transient service, its original absence, the keeper's trusted invocation,
  pre-birth publication or restart fencing.
- The kernel view is not pinned from independently held procfs/cgroup mount
  and namespace FDs, and process generation can still be forged by a caller.
- There is no controller admission, process launch, root operation, cgroup
  mutation, permission grant, ACK, recovery, cleanup, release or production
  caller. No existing staging manifest or privileged source scope is updated.

## Required next implementation and independent review

A separately authorized root-owned bootstrap must (a) exclusively create
the *new* exact qualification unit after a verified absence, (b) obtain
manager invocation/keeper properties through an authenticated manager
connection, (c) independently pin the keeper pidfd, namespace, and exact
cgroup2 mount and originally owned outer, (d) publish a canonical sealed
record with protected prebirth attempt/journal custody, and (e) furnish its
identity to a **separately protected** read-only observer. The publisher
cannot supply both its own expected record and an alleged independent
verification. Unknown lineage, restarts, missing roots, changed names,
unresolved cleanup, or mismatches mean HOLD/QUARANTINE.

Before root use: independent source/root/staging review, fixed hashes and
scope, authorized disposable VM, witness and adversarial crash/cleanup
evidence, and explicit operator Q13 decision. **No privileged execution
is authorized by this document.**
