# GE-04 R1-B1 — ambiguous dispatch intent reducer (source-only)

**SECURITY HOLD ACTIVE — B1-A–H OPEN — NOT AUTHORIZED FOR ROOT USE**

The original durable `PRE_SEND_INTENT` record denotes the instant the
intent was created. It is **not** a durable assertion that the method call
was never sent. After a crash, a surviving record cannot distinguish
crash-before-send from crash-after-send. Never retry or adopt a unit on
that basis.

`protected-transaction-state.[ch]` is a standalone, unprivileged,
non-authorizing diagnostic reducer. It models local observations
(`UNOBSERVED`, `INTENT_RECORDED`, `SEND_ATTEMPTED`,
`REPLY_OBSERVED`) and an absorbing `QUARANTINED` state.
Process loss, restart with intent, conflicts, invalid inputs,
duplicates and out-of-order transitions all quarantine. Its
`ge04_tx_can_retry` function **always refuses**. A reply observation
does not establish exclusive birth or cleanup authority.

This module is deliberately **not wired into the privileged controller**:
there is no sender, retry, recovery, ACK, release or systemd operation.
Controller exit 77, the native dispatch refusal and the default helper
hold remain unchanged. The reducer does not provide trusted storage,
anti-rollback, manager-generation evidence or original kernel custody.
Those require separate implementation and qualification under the
existing B1 and Q13 gates.

Unprivileged native C compilation and negative-transition tests are in
`tests/agents/test_ge04_protected_transaction_state.py`. Their passing
does not qualify privileged runtime behavior or close any B1 gate.
