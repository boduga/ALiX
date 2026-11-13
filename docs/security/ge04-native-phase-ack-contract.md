# GE-04 native phase ACK framing — non-authorizing contract

**Status: GE-04 SECURITY HOLD ACTIVE, R1-B1 OPEN.** This specification describes
protocol integrity only. It does not establish trusted controller custody,
root-owned original birth, legitimate sender, or production worker admission.

The native `event_until()` no longer accepts a bare `c` byte. After a
`EV <phase> <pid/ticks>...` diagnostic, it expects exactly one bounded
ASCII frame, with the canonical form:

```text
GE04ACK1 <32 lowercase hex invocation> <phase> <decimal sequence>\n
```

The phase must belong to `INTENT`, `PRE_NAMESPACE`, `PINNED`, `ENABLED`,
`PRE_JOIN`, `READY`, `EMPTY`, or `DENIED`, and must match the phase just
emitted. The decimal sequence begins at 1 for each process invocation and
increments only after exactly one successful frame. The helper reads one
byte at a time within its existing monotonic deadline and refuses incorrect
bytes, timeouts, EOF, extra queued data, wrong phase, wrong sequence,
noncanonical encoding, and the old bare `c`. A refused ACK does not advance
its local sequence. `DENIED` cannot release quarantine.

`tests/fixtures/ge04-ack-frame-probe.c` includes the native fixture with an
inert renamed `main` and exercises only `event_until()` as a regular process.
`tests/agents/test_ge04_native_ack_frame.py` tests the actual C parser over
pipes, including two ordered phases, duplicate/replayed frames, invocation,
phase and sequence substitutions and malformed input. **These tests never
execute the native privileged fixture or call the root entry point.**

**Security limit:** A process holding the input pipe can still forge a correct
ACK frame; the invocation and sequence are public correlation fields, not
secrets, MACs or signatures. There is no protected producer, authenticated
connection, trusted prebirth unit creation, replay fence across restarts,
verified kernel phase oracle or privileged recovery. The exact format may
change following independent root-controller security review; the root
qualification implementation remains disabled in ordinary builds.
