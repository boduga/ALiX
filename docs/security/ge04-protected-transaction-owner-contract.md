# GE-04 protected transaction owner — authority boundary and review contract

**Status:** R1-B1 OPEN · GE-04 SECURITY HOLD ACTIVE. No root controller
exists and no independent security signoff has occurred.

## Trust boundaries

The current diagnostic chain can verify that supplied records agree. That
does not prove who issued the prebirth intent, who created the unit, who
received JobRemoved, or who owns the original kernel resources. The
following authority responsibilities must be implemented *outside* the
editable ALiX worktree in an independently reviewed root-only source:

1. Original root publisher: exclusive fixed path, original boot and attempt,
   durable prebirth publication before unit creation, no adoption after crash,
   controlled source/binary/toolchain hashes and protected stable receipt.
2. Exclusive creator and event owner: one protected transaction across
   pre-request subscription, non-replacing systemd creation, job reply and
   authentic JobRemoved; manager owner change, missed event or uncertain
   creation quarantines without reconstructing success from current unit.
3. Kernel custodian: independently pin keeper pidfd/startticks, original
   mount namespace/mount ID/superblock/root and original cgroup ancestor
   descriptors. Keep ownership from original unit birth through all phases.
4. Protected controller: independently observed six-phase states, single-use
   authenticated ACK delivery, terminal EMPTY/DENIED evidence, exact
   generation-fenced cleanup/recovery. No numeric-PID, name scan, mutable
   worktree or shared-cgroup fallback.
5. Qualification authority: reviewed binary and privilege policy, explicitly
   approved disposable VM fault injection with surviving external witness,
   raw evidence and human security acceptance including Q13.

These are dependencies in order, not five caller-controlled flags. Source
review cannot be delegated to the same unit claiming its own authorization.

## Implemented review-only guard

The new protected_owner_review_boundary.py enumerates eight sequential
checkpoints, corresponding to source custody, original prebirth custody,
exclusive birth, trusted job transaction, pinned kernel resources, phase
ACK and terminal control, approved disposable VM, and human acceptance.

An exact caller-supplied review packet must have canonical source-attempt
SHA-256, the fixed unit, and one known requested gate. Its boolean claims
are intentionally NEVER accepted as authority: even if every flag is true,
the result is SECURITY_HOLD_PROTECTED_ORIGIN_UNAVAILABLE with every
required gate still marked unverified. Wrong original, unknown fields,
malformed claims and replay refuse. The guard has no success, attestation
mint, ACK, privileged command, recovery or production registration path.

The tests explicitly check the all-true forgery, missing/extra/incorrect
claims, every individual gate, one-shot refusal and five denied privileged
method names. Passing this suite proves the local *refusal* contract only.
It does not approve even B1-A and does not count as a human review.

## Staging and subsequent work

Before any executable privileged implementation, prepare a source-identity
and control-plane threat review of the exact independently protected root
controller (not this worktree), specifying kernel and systemd APIs, original
journal crash ordering, secure installation and rollback, least-privilege
entrypoint, disjoint issuer/observer/ACK responsibilities, and provenance
collection. Independently review/freeze hashes before a separately approved
disposable Linux VM run. Preserve the native compile-time hold until that
review explicitly authorizes a single procedure. Do not ship a unit file,
perform sudo/root actions, or loosen quarantine through these diagnostics.
