# GE-04 Q3.20 — Isolated broker authorization prototype

**SECURITY HOLD ACTIVE. Not a production credential broker.**

`createIsolatedBrokerAuthorizer` accepts a broker-owned HMAC key (minimum 32 bytes), a trusted claim reader and a trusted canonical route resolver. `issue` validates the running worker claim, owner, attempt, plan revision, route revision and revocation; computes the exact primary+fallback provider set; and signs a short-lived ticket. `authorize` authenticates the ticket, checks expiry, exact provider membership, current claim and route evidence, and consumes its nonce once per broker instance. No secrets are read, granted, serialized or delivered.

## Boundary requirements

- Run only in a separately isolated broker process; worker must never access signing key, trusted route resolver or claim authority.
- The current prototype has no IPC, peer credential verification, process isolation, persistent nonce store or crash-safe replay protection. Its `used` set is per process, so restarting or using another broker instance loses replay state.
- The claim and route callbacks are supplied by the embedding process. Their provenance is **not** authenticated by this module. Do not use worker-supplied config or writable projections as broker authority.
- The ticket is not bound to a cryptographically authenticated process identity; the caller-supplied worker identity is not sufficient.
- This module does not replace Q3.19 precredential checks, does not change legacy FD3 delivery or credential loading, and is not wired to scheduler or child execution.
- Broker must recheck current authoritative claim and route at actual credential delivery, use a crash-safe single-use transaction, and enforce OS-level distinct-UID or equivalent isolation.

Next: design broker IPC and peer authentication, trusted claim/route provenance, durable replay store, exact credential selection, and negative end-to-end tests before any production integration.
