# GE-04 R1-B1 Phase 3B4A — protected request preparation, no dispatch

**SECURITY HOLD ACTIVE · ALL B1 GATES OPEN · NO ROOT EXECUTION**

This increment integrates the existing fixed `StartTransientUnit` payload
serializer into the existing production-intended native systemd transaction
boundary. It does **not** create another standalone Python validator.

## Native source

- `native/ge04/protected-dispatch-preparation.[ch]` adds
  `ge04_prepare_fixed_dispatch`: requires root identity, original
  first-attempt/prebirth custody, existing pinned private manager bus and
  subscription, unpoisoned empty request state, and original transaction
  rechecks before and after construction.
- Uses `sd_bus_message_new_method_call` on the *same retained private bus*
  with the *pinned unique manager owner*, fixed manager object/interface,
  and `StartTransientUnit`. Appends the Phase 3B2 fixed-unit,
  non-adopting `fail` request with the one **uninstalled** keeper path.
- Requires exact method destination, path, interface, member,
  same-bus identity and signature `ssa(sv)a(sa(sv))`.
- On any preparation or custody error, releases the temporary message and
  permanently poisons the transaction. On success, retains a single
  prepared message with explicit descriptor ownership; closing it only
  unrefs the message. **Preparation does not issue an outgoing request
  cookie or transition to request_in_flight.**
- `ge04_dispatch_prepared` unconditionally returns EPERM and poisons.
  This C translation unit contains **no** `sd_bus_send`, `sd_bus_call`,
  `StartTransientUnit` invocation or privileged-entrypoint activation.

The existing `ge04_systemd_create_exclusive` still always returns EPERM.
The root controller `main` still unconditionally exits 77.
No daemon, systemd unit, keeper executable, ACK or worker was started.

## Unresolved blockers before privileged send

A prepared D-Bus object is *not* a dispatched request. It is not evidence of
new unit birth or a trusted outgoing cookie. Authentic protected dispatch
requires independent human source, binary and deployment review; an
immutable root-controlled issuer and installed/attested keeper; a separately
protected durable intent transition; pre-request absence and original
manager subscription; a single authenticated `sd_bus_send` with its actual
cookie; bounded process lifetime and owner-swap/crash quarantine; and
original keeper/kernel/cgroup birth-time custody.

The prior read-only PID, cgroup and mount namespace observations cannot
substitute for this missing original birth witness. All B1-A through B1-H
and Q13 remain open. An independent approved disposable Linux VM and
adversarial human security review are needed **before any root execution**.

## Verification

`tests/agents/test_ge04_protected_dispatch_preparation.py` compiles the
actual C source as an ordinary unprivileged user. Link wrappers exercise
eight scenarios including root gate, reserved prior request, exact
prepared header on pinned bus, original custody before/after, failing
builder/payload, substituted manager destination and wrong signature.
Unqualified positive preparation is only simulated in a test with wrapped
identity/custody; no privileged operation occurs. The binary's unresolved
symbols are checked for absence of `sd_bus_send`/`sd_bus_call`.

These are developer-level source checks, not security qualification.

## Provisional Phase 3B4A source fingerprints — not approval

| Source | SHA-256 |
| --- | --- |
| `native/ge04/protected-dispatch-preparation.c` | `2035b4b5a6d560a69075f7cb7ca8d995734da822738f76df92a8d98805d3a2f3` |
| `native/ge04/protected-dispatch-preparation.h` | `588ce70ac2a2f0cea7708ac96200c028cf3e7695ae42ba260b2d622f1da4a8e3` |

**Review limitation:** The separate Codex review became blocked in an
auxiliary plugin/network lookup and was terminated without a conclusive
review verdict. The GitNexus scan was also terminated after stalling;
native symbol coverage remains unknown. Direct native compile/targeted
regression, GE-04 Python, 36 supervisor Vitest, TypeScript, DOX and staged
whitespace checks passed in the worktree. No human approval, independent
security signoff, privileged execution or Q13 evidence is claimed.
