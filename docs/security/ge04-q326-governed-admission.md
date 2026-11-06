# GE-04 Q3.26 — Credential-free governed admission composition

`src/agents/worker-broker-governed-admission.ts` composes existing peer policy, broker-owned live worker identity resolution, the Q3.20 signed ticket authorizer (which rechecks current claim, route, provider and revocation), and the Q3.21 SQLite replay ledger. It emits no credential material and is not connected to a worker-facing production socket.

The `resolveLivePeerClaim` callback is a **trusted dependency**, not a claim read from the request body. It must be implemented against broker-owned, authoritative process ownership state and bind a kernel-attested PID/UID to a specific run/worker/attempt. Merely supplying a callback that returns client input defeats the boundary. The current native Q3.25 probe is not connected to this module; native-to-Node handoff authentication remains unimplemented.

The authorizer consumes its in-memory nonce before the ledger persists it. This is intentionally fail-closed if the ledger fails, but is **not** a single atomic authorization+ledger transaction; production must define crash semantics and transactional authorization state. The ledger does not independently authenticate tickets; `consumeAuthenticated` must only be called after the authorizer has validated the MAC and live state.

The Q3.26 unit tests verify successful credential-free admission, unauthorized peer/claim rejection, revocation, provider and expiry rejection, and replay persistence across reopened database handles. They do not establish a production credential-delivery path.

**GE-04 SECURITY HOLD remains active.**
