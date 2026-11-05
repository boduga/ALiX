# GE-04 qualification stage Q1 — read-only installation preflight

**Status: SECURITY HOLD ACTIVE. No production supervisor has been installed or qualified.**

This stage follows merged remediation PRs #1041–#1047. They delivered
fail-closed scaffolding and negative evidence tests, not a production native
mutation backend. Issue #1040 remains the authoritative qualification tracker.

## Command

From the ALiX repository:

```sh
node scripts/ge04-qualification-preflight.mjs --json
```

This command is **read-only** and **always exits code 78**, including if all
visible files appear root-owned. Its JSON disposition is always `HOLD`.
Neither the command nor its report provides activation authority.

It checks these **proposed future external installation locations**, which
ALiX does not provision:

| Purpose | Fixed proposed path |
|---|---|
| Administrator-managed public verification key and minimum sequence | `/etc/alix/ge04/trust.json` |
| Signed release manifest | `/usr/local/lib/alix/ge04/release.json` |
| Supervisor executable bytes | `/usr/local/lib/alix/ge04/supervisor.bin` |
| Supervisor service unit on systemd hosts | `/etc/systemd/system/alix-ge04-supervisor.service` |

Checks reject missing paths, symlinked components, non-root ownership,
group/world writable paths, non-regular files, hard-linked leaf files and
observed inode changes. A visible root-owned file is reported as
`PATH_ATTRIBUTES_OBSERVED_ONLY`, **not** a valid release, independent
provisioning, or proof of immutable custody.

On hosts not using systemd, the service path is only a planning assumption.
A separate platform-specific service design and review are mandatory.
Do not create a placeholder unit merely to make an observation turn green.

## Independent acceptance gates

All eight gates remain open and require independent security evidence:

1. **Separate operator and key custody.** A security administrator, not the
   ALiX coordinator, must provision and control trust, keys, service
   identity, revocation and rollback authority. Never place private signing
   keys in the ALiX repository or agent-accessible filesystem.
2. **Protected monotonic rollback floor.** Demonstrate independent durable
   updates, downgrade rejection and power-loss protection, not merely a
   JSON minimum sequence checked by the untrusted coordinator.
3. **Executable/runtime chain.** Verify supervisor code, interpreter, loader,
   linked libraries, mount namespace, process lineage and deployment identity
   through an independently administered root.
4. **Authenticated independent channel.** Run separate-UID, separate-process
   negative tests that prevent FD delegation, impersonation, confused deputy,
   peer replacement and stale binding to worker/attempt identity.
5. **True native last-effect fence.** Re-evaluate the exact request,
   ownership and inode/mount authority, policy revision, approval
   single-use, lease revocation, and expiry at the final syscall boundary.
6. **Effect journal/receipt provenance.** Use independent rollback-resistant
   anchoring and bind release+worker+request+approval+lease+effect+receipt;
   never accept an untrusted claimed success.
7. **Crash and adversarial qualification.** Prove real SIGKILL/power loss,
   fsync/rename order, replay quarantine and concurrent same-UID alias,
   symlink, hardlink, mount and parent swap protection.
8. **Independent human signoff.** An authorized reviewer must inspect the
   production installation and tests and explicitly approve activation.
   Passing CI or a local preflight never substitutes for this signoff.

## Execution sequence

Q1: Inert host preflight and operator checklist (this PR).

Q2: Separately reviewed **non-mutating** supervisor installer/runtime
provenance design, with an actual independent security principal and operator
provisioning. This cannot be truthfully completed by running the ALiX agent
with sudo or by writing root-owned files under its own control.

Q3: Native descriptor-relative mutation and final-effect authorization
qualification with separate privileged and unprivileged principals.

Q4: Protected append-only journal, external checkpoint custody, and real
crash/power-loss/fault-injection tests.

Q5: Independent assessment, residual-risk acceptance and explicit
production activation change (separate PR). Until then
`createScopedMutationService()` must always return
`UnavailableScopedMutationService`.

**Safety invariant:** No user-supplied trust-path/identity overrides,
automatic root provisioning, signing-key generation, service start,
filesystem mutation or change to the production activation factory occurs
in Q1.
