# GE-04 Q3.31 — Native-to-governance admission boundary (initial gate)

Status: **DENY ONLY**. The Q3.30 root Linux integration demonstrates native `SO_PEERCRED` and descriptor-pinned execution, but its `READY`/`PEER` stdout is a diagnostic frame, not a transferable authentication assertion. A worker can forge an identical frame. The existing Q3.26 governed admission accepts a `VerifiedBrokerPeer` supplied by its caller, and must not be invoked by casting or parsing Q3.30 stdout.

`admitNativeDiagnosticHandoff` is an explicit deny-only boundary: all diagnostic handoffs are rejected regardless of UID, authorized flag, ticket, or provider. It does not consume tickets, invoke the authorizer, or deliver credentials. Tests cover forged authorized frames, denied frames, and attempted callback bypass.

Before any positive native admission, implement a protected broker-owned IPC boundary that verifies the peer using kernel credentials on the **actual accepted socket**, pins the live worker process/attempt mapping against authoritative state, and establishes crash-safe atomic replay semantics. Revalidate these conditions at the final credential mutation/delivery boundary. This phase is not an authenticated handoff implementation and does not lift GE-04 SECURITY HOLD.
