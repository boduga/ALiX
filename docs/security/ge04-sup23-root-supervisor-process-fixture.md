# GE-04 SUP-23 — Separate root supervisor process fixture

**GE-04 SECURITY HOLD — inert experiment only. No production mutation authority.**

The root-only Linux test `experiments/ge04/test-sup23-root-supervisor.py` starts `sup23-root-supervisor.py` in a fresh exec'd subprocess, with `close_fds=True` and no inherited application file descriptors. The supervisor reopens a root-owned `0700` credential directory and a protected `0600` 32-byte fixture secret using the existing SUP-15 validation, configures `SO_PASSCRED` and `SO_PASSPIDFD` on an AF_UNIX datagram endpoint, pins the expected root coordinator with the SUP-22b `KernelPinnedSender`, and accepts only a fixed **inert** request. The reply is a constant observation marker, not an authorization receipt. The key is never sent in the reply or delegated by descriptor.

The privileged CI test verifies that a separately exec'd process dropped to UID/GID 65534 cannot read the protected key or send to the protected endpoint; that the root coordinator can send the fixed inert datagram and receive the fixed marker; that the supervisor terminates; and that its orphan socket is not mistakenly treated as a live service. Endpoint creation never unlinks or replaces a preexisting name; recovery must be explicit.

## Limitations and open security gates

This fixture demonstrates an **OS process boundary and root-owned path isolation**, not independence from a malicious root coordinator. The fixture coordinator creates the key and launches a root supervisor; root can still read or replace same-root files, control the child, or impersonate other root processes. It is not an independent supervisor trust root. Process and credential bootstrap remain test-controlled, and the datagram sender pin has the previously documented lifecycle/race and namespace limitations. No actual operation is performed, no approval/lease/policy/revocation decision is serialized, and there are no authenticated durable terminal receipts or crash recovery protocol. A privileged helper with genuinely separated authority (for example, distinct protected service identity/OS-managed launch policy and appropriately protected resources), an end-to-end threat model, hardening and independent adversarial review are still required.

SUP-16 continues reproducing the old stream socket holder-identity failure. Do not bridge that transport into production. PR #1039 remains open/unmerged; production `UnavailableScopedMutationService` stays disabled.
