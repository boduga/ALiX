# GE-04 systemd job event correlation — one-shot non-authorizing contract

**State:** R1-B1 OPEN; GE-04 SECURITY HOLD ACTIVE.

The existing exclusive birth handoff models a caller-provided
`JOB_COMPLETION_CLAIMED` stage, but it cannot prove the claim came from a
systemd manager event. `native/ge04/systemd_job_event_contract.py` defines
an exact shape for the manager's `JobRemoved` event and validates the
*expected* job identity in a one-use quarantine-on-ambiguity state machine.

The event must contain the same pinned manager unique sender, the
fixed `ge04-r1b2-view-qualification.service` unit name, exact
`/org/freedesktop/systemd1/job/<positive ID>` job path and matching numeric
ID, and the literal `done` result. A different sender, unit, job ID/path,
failed result, extra field, duplicate or later replay permanently poisons
that observation window. A positive result is deliberately named
`UNQUALIFIED_SYSTEMD_JOB_EVENT_CORRELATION`: all inputs can currently
be invented by the caller, and the class has no system-bus subscription,
file descriptor or ACK writer.

## Required protected systemd event lifecycle (NOT implemented)

1. Independently reviewed root issuer holds original prebirth journal and
   manager unique name under protected custody; no root worktree imports.
2. Protected controller subscribes to the systemd `JobRemoved` signal on
   the root-owned system bus *before* making the scoped creation request.
   A read-only listener instantiated later cannot recover an already
   delivered event by scanning current jobs.
3. Controller records the exact `StartTransientUnit` method invocation,
   D-Bus reply job object path and issuer identity; its `fail` mode alone
   does not establish no-adoption or transactional exclusivity. Only that
   independently protected process may bind the event to its own request.
4. It verifies the genuine D-Bus sender (not a field in untrusted JSON),
   matching job ID/path/unit, result and manager generation. Missing,
   duplicate, reordered, changed-owner or timed-out events => permanent
   quarantine. Job result `done` is not sufficient proof of a newly created
   unit or original keeper: the kernel owner/namespace/mount/cgroup facts
   must also be independently pinned.
5. Crash or restart loses transient signal evidence, and replaying a
   claimed completion must **not** resume authority. A durable reviewed
   controller/journal must explicitly reject or safely quarantine uncertainty.
6. Independently reviewed disposable-VM validation and Q13 decision are
   prerequisites for any root controller execution or phase ACK.

The current module is a **pure input validator** and remains separate
from the handoff's existing supplied completion assertion. It does not
silently upgrade supplied event data into an authenticated signal, nor
create/stop/enable a service, write an original record, send an ACK, or
relax the default native security hold. Focused tests use synthetic
events to prove local shape, one-use and quarantine invariants only.
