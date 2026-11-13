# GE-04 exclusive systemd unit-birth handoff — review contract

**Status:** R1-B1 OPEN · GE-04 SECURITY HOLD ACTIVE. This document describes a
pure, non-authorizing diagnostic prototype, not a privileged root controller.

## Contract

`native/ge04/exclusive_birth_handoff.py` models the missing cross-system
handoff between durable original intent and a genuinely **new** fixed systemd
qualification unit.

<escape>PREBIRTH_OBSERVED → CREATION_CLAIMED → JOB_COMPLETION_CLAIMED → BIRTH_CORRELATED</escape>

Any missing, repeated, contradictory, interrupted, ambiguous or
out-of-sequence transition => `UNQUALIFIED_QUARANTINED`.

The starting evidence is a canonical `prebirth-intent.v1` byte string
exactly matching the separately supplied pre-birth record, plus an exact
read-only `UNQUALIFIED_SYSTEMD_ABSENCE_OBSERVATION` identifying the fixed
unit and manager owner. Both currently originate from user-controlled
inputs or unprivileged fixture state, not independently protected issuer
custody.

The creation claim must name only `StartTransientUnit` with mode `fail`,
the fixed qualification service, a canonical systemd job object path,
the same root-owned manager's unique bus owner, exact original attempt and
nonce, and SHA-256 of the original canonical journal bytes. No other
creation mode, unit, repeated claim or later job may be substituted.

Before post-birth sampling, an exact separate job-completion claim must
match the original fixed unit, manager owner, job object path and prebirth
digest, with a literal `done` result. Missing, failed, mismatched or replayed
job completion quarantines and invalidates the attempt. This callback is
currently supplied by the same untrusted test caller; a matching result
must never be mistaken for verified systemd job completion.

The post-birth observation must contain the same manager owner, exact
unit name/object path, active/running state, restart count zero,
fixed unit cgroup, canonical invocation and valid keeper PID. The
controller records only an
`UNQUALIFIED_BIRTH_HANDOFF_CORRELATION` with these claims. A matching
`StartTransientUnit` *claim* and an observed *current* unit do not prove
that the corresponding job created it. Actual job completion identity,
exclusive transaction origin and original birth must be verified by a
separately protected root controller; no identity is inferred from a
name-matched pre-existing unit.

## Blocking independent issuer responsibilities

- Independent security review of the fixed issuer, source staging and
  exact executable hash, root-only file and process custody.
- Durable exclusive root-owned original journal, protected attempt
  monotonicity and impossible-to-adopt recovery on any crash.
- Manager-specific non-replacing creation request in a reviewed disposable
  VM, with protected job/call correlation and verified job completion,
  followed by authenticated keeper pidfd/startticks and cgroup mount
  ancestry observations.
- Original and post-birth observations must remain held by an independent
  controller; caller-supplied D-Bus snapshots and job paths are insufficient.
- Verified single-use phase ACK delivery, locked cleanup and recovery,
  independent human review, and explicit Q13 release decision.

The test-only handoff has **no D-Bus mutation**, no PID signal, cgroup
modification, journal write, IPC writer, ACK, worker launch or production
consumer. `create_unit()`, `issue_ack()` and `recover()` remain
unconditional refusals. All positive examples use invented matching
records and are therefore **unqualified even when tests pass**.

Nine focused tests reject creation mode replacement, manager
substitution, mismatched nonce/attempt/digest, malformed job path, wrong
unit/keeper/restart evidence, replay and recovery after crash. They include read-only immutable mapping inputs and
demonstrate shape/sequence enforcement, **not** systemd-exclusive creation
or any B1 gate clearance.
