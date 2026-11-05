# GE-04 PR 4 — inert supervisor boundary (research qualification)

**Status:** non-mutating qualification substrate only; **not a deployed supervisor**.

The entrypoint `scripts/ge04-inert-supervisor.py` **always exits with status 78**
and cannot accept a production listener path, trust key, installer override,
coordinator identity, or mutation command. The production
`createScopedMutationService()` factory stays unavailable.

A disposable test fixture can instantiate `InertSupervisor` to exercise
Linux `AF_UNIX/SOCK_SEQPACKET` IPC, kernel-provided `SO_PEERCRED`, a private
`0700` socket directory and `0600` socket, bounded frames, unexpected
ancillary-fd rejection/closure, and single-request fail-closed responses.
Even an expected kernel UID receives the same fixed `DENIED GE04_UNAVAILABLE`
response. JSON fields purporting to identify an operator or worker grant
no authority. A supplied UID is used **only in the fixture constructor**;
the executable entrypoint cannot be configured with it.

The `trusted_install_preflight` helper rejects non-root-owned, writable or
symlinked trust-path components. It is **not invoked by an installed service**,
and it is not a race-free install-time trust anchor. In particular, running
this script as root, chmod-ing a directory, or passing an expected UID through
a fixture does not constitute independently provisioned custody.

## Evidence and negative tests

`tests/security/ge04-inert-supervisor.test.ts` executes eight Python
unittest cases on Linux, including matching/mismatched peer credentials,
forged JSON identity, SCM_RIGHTS fd rejection, oversized packets, existing
socket-file refusal, public-directory refusal, distinct UID constraints,
and direct-executable startup denial. Tests are skipped only on unsupported
platforms. They do not require root, change host service configuration,
install a systemd unit, or mutate any real workspace.

## Outstanding requirements (not proven here)

- Installation under an independently administered supervisor account.
- A separately provisioned and immutable trust configuration, key custody,
  rollback floor and authenticated release manifest.
- A real *distinct UID* end-to-end negative test with separate processes,
  and authorization that cannot be delegated through inherited connected
  sockets; `SO_PEERCRED` alone pins connect-time credentials, not a worker
  attempt or exact request.
- Proven supervisor executable, interpreter, loader, libraries, mount
  namespace and process lineage.
- Crash/restart behavior, pin freshness and peer attempt binding.
- Trusted policy/approval/lease checks immediately before the actual native
  mutation boundary, journal/effect/receipt binding and power-fault recovery.
- Independent human security signoff for any production activation.

**Release rule:** This PR may merge as isolated *deny-only* scaffolding after
review and passing CI. It **does not** lift GE-04 SECURITY HOLD, install a
service or authorize any filesystem mutation. Do not interpret the fixture's
identity verdict as a production authentication grant.
