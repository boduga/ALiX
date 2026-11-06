# GE-04 Q3.21 — Broker IPC boundary primitives (partial milestone)

**SECURITY HOLD ACTIVE. No production broker or authenticated IPC is deployed.**

This phase adds a pure `assertBrokerPeer` policy that requires a trusted transport-supplied Unix peer UID/PID, rejects the broker's own UID and unknown worker UIDs, and a broker-owned SQLite nonce ledger using WAL, synchronous FULL, a unique nonce key and transactional `INSERT OR IGNORE`. The ledger rejects replay across multiple connections and process restarts. The code is deliberately not wired to any socket, scheduler, worker, or credential sender.

## Not yet satisfied

- No Unix socket server, kernel peer credential retrieval (`SO_PEERCRED`/equivalent), or authenticated request framing. **Never accept peer identity from request payload.**
- No actual separate-UID broker/worker deployment, file permission enforcement, key isolation or independent authoritative claim/route reader.
- The Q3.20 authorizer still has an in-memory replay set; Q3.21 ledger is not integrated with its authorization transaction. Do not mistake the new ledger for live crash-safe ticket consumption.
- `consumeAuthenticated` assumes the caller already verified the ticket MAC, provider, expiry and current claim. The method itself does not authenticate tickets; exposing it to untrusted callers would be unsafe.
- No multi-process delivery-time atomicity across claim revalidation and nonce consumption; no revocation race proof.
- No credential access, selection, delivery, or changes to the legacy FD3 path.

Next: establish an OS-attested peer transport in a separately privileged broker, broker-owned signing key and database permissions, trusted route/claim provenance, and atomic delivery-time authorization. Test forged peer identity, process restart, concurrency, stale claims, and revocation under real OS isolation before changing production credential handling.
