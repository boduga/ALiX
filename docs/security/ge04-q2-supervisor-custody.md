# GE-04 Qualification Q2 — Independent Supervisor Custody Contract (deny-only)

**Decision: Q2 design and unprivileged transport tests only. SECURITY HOLD ACTIVE.**
**The independent-UID custody acceptance gate is NOT yet satisfied.**

This stage follows Q1 PR #1048. It does not provision a security principal,
signing keys, release artifacts, service units or a production supervisor.
The executable `scripts/ge04-q2-custody-fixture.py` always exits **78**.
The existing `createScopedMutationService()` stays unavailable.

## Separation of responsibilities

| Actor | Security responsibility | Prohibited authority |
|---|---|---|
| Independent operator | provision dedicated supervisor identity and group, protected verification key, pinned signed release, rollback floor and audited service installation | never delegate private signing keys to ALiX |
| Supervisor service identity (proposed `alix-ge04-supervisor`) | own executable runtime, socket, protected approval/policy/lease store access and eventually final-effect enforcement | cannot infer authority from coordinator-supplied `approved: true` |
| ALiX coordinator identity (dedicated, distinct UID) | submit bounded operation requests over authenticated transport | cannot modify supervisor executable, service unit, trust root, authorization stores or rollback floor |
| Filesystem mutation backend | **not implemented / unavailable** | never activate based on this fixture or a successful IPC handshake |

The two UIDs **must differ in the actual kernel**. Config strings, a
`sudo`-launched fixture, environment variables and a mocked `uid` field do
not establish independent custody.

## Socket access design

PR4 used a private **0700** directory and **0600** socket, preventing a
different coordinator UID from traversing the parent or connecting. Q2
proposes an **operator-provisioned** restricted group for transport only:

- Privileged parent directory: supervisor-owned, **0710** (owner `rwx`,
  operator-approved client group `--x`, other `---`).
- Unix `SOCK_SEQPACKET` socket: supervisor-owned, **0660**, same restricted
  client group; process verifies inode, owner, group and permissions.
- Kernel `SO_PEERCRED` must match the **exact expected coordinator UID** and
  differ from the supervisor UID. Group membership only enables connection;
  it is not permission to execute an operation.
- Request frame bounded to 4096 bytes. Unexpected ancillary data and passed
  file descriptors are rejected; received descriptors are closed. Messages
  that forge `uid`, `approved` or authorization status cannot override
  kernel identity. Every response remains `DENIED GE04_SECURITY_HOLD`.

Important limits: `SO_PEERCRED` reports credentials at **connect time**;
a connected socket FD may be passed to another process. This prototype
**does not prevent FD delegation, process substitution, namespace tricks,
stale worker binding, or confused-deputy execution**. The operator must
demonstrate those defenses (e.g. supervisor-owned per-attempt challenge and
protected authorization service) in further qualification. Socket access
and matching peer credentials do not establish request authorization.

## Evidence delivered by this PR

`scripts/ge04-q2-custody-fixture.py` is importable **only by tests** and
never deployable via its executable entrypoint. It provides one bounded,
non-mutating request with a fixed DENIED response.

`scripts/test-ge04-q2-custody-fixture.py` uses separate Linux server/client
**processes**, but they deliberately share the **same UID** under ordinary
non-root CI. It validates the 0710/0660 transport design, raw kernel
peer credentials, same-UID rejection, forged claims, oversized frames,
file-descriptor passing rejection, unsafe directory modes, symlink paths,
and entrypoint fail-closed behavior.

**These tests do not demonstrate an actual cross-UID connection or
independent administrative custody.** A positive fixture diagnostic boolean
means only that the synthetic expected UID differs from the configured
supervisor UID. It never means the supervisor has that UID, and it never
grants permission.

## Independent operator acceptance checklist (not executed here)

1. Review threat model and choose actual dedicated, non-login supervisor
   UID, separate coordinator UID and minimal socket client group.
2. Independently provision / protect the signed release, verifier key,
   trusted policy stores and rollback floor. Ensure ALiX's UID cannot
   rewrite parent directories, binaries, keys, leases, approvals or journal.
3. Review systemd (or equivalent) hardening separately: `NoNewPrivileges`,
   capability bounding, namespace isolation, read-only root mounts,
   restricted writable directories, and protected interpreter / dynamic
   loader / libraries. No unit is installed by this PR.
4. Execute an actual **two-UID test** on a disposable host controlled by
   an independent administrator. Show that a coordinator in the restricted
   group can connect using group traversal without access to the protected
   files, and that any third-party UID/group is refused.
5. Demonstrate same-UID impersonation rejection, peer replacement, FD
   delegation, inherited connected descriptors, denied SCM_RIGHTS,
   symlink/mount substitution and supervisor restart negative tests.
6. Produce an independently signed evidence package with process UID/GID,
   loaded binary digest, release identity, test transcript, denial results
   and operator signoff. It must not contain secrets.
7. Retain all Q1/Q2 hold conditions. Do not start a filesystem mutation
   endpoint before protected final-effect policy/approval/lease enforcement
   and crash/effect receipt qualification.

## Result

This PR may be merged as **fail-closed Q2 transport scaffolding**, but
**Q2 independent supervisor custody remains unqualified** until the
operator-controlled principal, provenance and real distinct-UID tests exist.
Do not mark issue #1040 completed; do not activate GE-04.
