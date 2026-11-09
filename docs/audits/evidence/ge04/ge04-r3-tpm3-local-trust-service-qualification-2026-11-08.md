# GE-04 R3-TPM3 — Local Trust-Service Transport Qualification

**Date:** 2026-11-08
**Status:** GE-04 SECURITY HOLD ACTIVE — inert Linux IPC fixture only.

## Purpose and exact scope

For ALiX's first deployment on a physical Linux laptop, the local transport may
replace network mTLS as the **connection transport**. It does NOT replace
independent TPM key/NV custody, signed native governance publication, durable
nonce/replay state, root-separation design, or explicit Q13 release decisions.

`scripts/ge04-r3-local-trust-service-inert.py` provides an import-only
AF_UNIX SOCK_SEQPACKET listener fixture. Running the script directly exits 78.
Its only accepted request operations are `status.read` and
`nv.inspect.metadata`; **both always return blocked** and neither actually
reads TPM metadata. All other requests, including checkpoint commit, worker
execution, recovery, NV creation/deletion/extend, and arbitrary signing,
are refused. No deployment daemon, systemd service, or privileged socket
has been installed.

The fixture uses Linux `SO_PEERCRED` on the accepted socket and requires
a private 0700 parent directory and 0600 socket. Request messages use a
bounded, strict, versioned ASCII JSON schema; duplicate keys, extra fields,
invalid nonce/identity, oversized frames, and ancillary FD transfers are
rejected. Unexpected received SCM_RIGHTS descriptors are closed. Socket
cleanup compares the created device/inode to avoid deleting a substituted
path. It never sends a positive authorization response.

## Observed qualifications (no real TPM interaction)

Tests exercise real AF_UNIX SOCK_SEQPACKET Linux socket connections, kernel
peer credentials, wrong expected UID, rejected mutation operations, replay,
lost nonce state across fixture restart, FD transfer denial, spoofed socket
path/symlink, permissive parent directory, replaced socket cleanup, and a
non-deployable executable entrypoint.

- A kernel UID check is **only a connection-level identity observation**.
  It does not prove the expected UID was bound by an independently authorized
  operator. `SO_PEERCRED` is fixed at connection time; a connected descriptor
  may be delegated. No pidfd or live process generation is pinned here.
- For unit testing, both client and server run under the same development
  identity. This is **not** separation of duties or cross-UID verification.
  A separate protected service account and trusted workload identity must
  be designed and independently qualified before production use.
- The replay set is **process memory only**; restarting the fixture loses it.
  Even requests that pass its check always return blocked. A production
  verifier must atomically persist and consume challenges across crashes.
- The socket parent and socket can be controlled by the same fixture owner;
  a compromised root or local trust daemon is outside the proof obtained.
  In particular this does not provide a separate protected root/TPM
  administrator or protect against TPM clear/reprovision.

## Future local trust daemon requirements

1. Review service-account and IPC directory ownership model. Prefer a
   separately installed OS identity, narrowly permissioned Unix socket,
   kernel credential and process-generation checks, no ALiX worker UID access.
   Audit descriptor-delegation, namespace and role-confusion threats.
2. Use verified, externally retained TPM enrollment provenance. Read
   designated ALiX-only NV public Name and policy, check against a protected
   enrollment record; keep all five pre-existing NV indices untouched.
3. Specify TPM policy sessions, signing algorithm transition from Ed25519
   fixtures to hardware-compatible ECDSA P-256 and exact verifier identity.
4. Prove durable request/replay consumption and crash-safe TPM-vs-SQLite
   reconciliation; no implicit retry of ambiguous commits.
5. Conduct restricted physical hardware tests only after separate explicit
   provisioning approval, independent security review, and recovery design.
6. Integrate with canonical governance, Q13 release, supervised worker
   admission and recovery only after all security gates are independently met.

This is **not** an authorization server or a deployed security boundary.
The SECURITY HOLD on checkpoint commits, privileged worker execution, and
recovery remains active.
