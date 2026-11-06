# GE-04 Q3.21 — Kernel peer attestation gate

**SECURITY HOLD ACTIVE. The OS-attested IPC milestone is NOT complete.**

The credential-free Unix probe now bounds the attestation callback with a configurable timeout (default 2 seconds; valid range 1–30000 ms), destroys timed-out sockets and checks for aborted connections before authorization. The tests exercise a stalled attestor and invalid timeout configuration. This is lifecycle hardening only.

## Required before declaring authenticated IPC

1. A Linux-specific, audited adapter must obtain `SO_PEERCRED` from the accepted Unix socket using the kernel `getsockopt` API, not client JSON or unverified process metadata. Native code or a reviewed dependency may be required. The current Node `net.Socket` does not supply this proof in the implementation.
2. Run broker and worker under genuinely distinct UIDs. Broker signing keys, credential stores and SQLite WAL files must be unreadable and unwritable by worker UID; verify filesystem ownership and permissions, including parent directories.
3. Bind verified peer identity to a broker-owned worker claim. A UID allowlist alone cannot prove a particular run/worker/attempt; PID reuse and shared worker UIDs require explicit treatment.
4. Verify actual cross-UID connection, forged peer payload rejection, disallowed UID rejection, restart, and revocation with independent integration tests.
5. Integrate replay consumption with authorization and delivery under a sound concurrency model. The current Q3.20 in-memory nonce set and Q3.21 SQLite ledger remain separate.

No production credential transport is enabled or authorized by these changes.
