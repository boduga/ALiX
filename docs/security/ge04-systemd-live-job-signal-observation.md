# GE-04 bounded systemd JobRemoved signal observation

**Security status:** GE-04 SECURITY HOLD ACTIVE · R1-B1 OPEN.
This is an unprivileged, read-only event-feed diagnostic. It does not
authenticate the original unit creation transaction or issue phase ACKs.

`native/ge04/systemd_job_signal_observer.py` now opens a **private GLib-integrated system bus connection**
using dbus-python/GLib, pins the unique `org.freedesktop.systemd1` owner
and root UID, and registers for the manager's fixed-path `JobRemoved`
signal. `Manager.Subscribe` registers an event notification subscription
and `Unsubscribe` removes it after the observation. These registration
operations do not create, start, enable, stop or replace systemd units.

The listener has a maximum two-second **GLib event window**, checks the
manager owner before subscription and around event receipt, and uses the
existing `JobEventWindow` to match a single expected job ID/path, fixed
qualification unit, manager sender and `done` result. Wrong fixed-unit
job, missing signal, owner swap, malformed job ID or unsuccessful result
causes refusal and quarantine. The handler's bus identity comes from
dbus-python's signal `sender_keyword`, not an arbitrary JSON field.
A positive result is named `UNQUALIFIED_LIVE_SYSTEMD_JOB_SIGNAL` and
retains no ACK capability. Match removal, best-effort unsubscription and private connection close
run on all exit paths. The listener also refuses root execution.

**Boundedness limit:** The event loop has a maximum two-second window,
but setup and cleanup contain synchronous D-Bus calls with their own
one-second per-call timeouts, and the system bus connection may take longer.
This is NOT an externally enforced end-to-end process deadline. It must
not be used in the privileged path or to release an approval. A protected
controller needs separate process-level timeouts, source custody and exact
recovery semantics.

**Provenance limit:** The *expected* job path and manager owner are provided
by the caller. This listener has not observed an authenticated
`StartTransientUnit` request from an independent root issuer. Its
subscription is not tied to an original protected journal or prebirth
authority. Job `done` by itself does not prove a unit was newly created,
nor that its keeper, mount, cgroup and descendants are exclusive.

The current function waits for a specified job; it cannot demonstrate
that it was subscribed *before* a future creation request unless both are
coordinated inside a separately protected implementation. It cannot
recover a missed event by scanning current jobs. Tests use a mocked GLib
and D-Bus signal feed for positive cases, and a real quiet system-bus
subscription for the absent qualification unit. No service is created or
root tool executed. The existing `exclusive_birth_handoff.py` still uses
untrusted job-completion claims and remains NON-AUTHORIZING; there is no
production integration or positive authority upgrade.

Next prerequisite: independent root-owned prebirth issuer and secure
creation transaction; verified listener-before-request lifetime,
job completion plus independent kernel birth, source review, approved
disposable VM tests and Q13 human decision.

## Model review corrections

The first review found two P2 issues: real systemd D-Bus job identifiers are
`dbus.UInt32`, which must be converted to a built-in `int` after an integer
subtype check before feeding the exact job validator; and the live test must
handle unavailable/restricted system buses without claiming positive event
verification. Both are corrected. Focused regressions include a real
`dbus.UInt32` and mismatched signal sender; an inaccessible live bus remains
an unqualified refusal. The model review is not independent human security
signoff. No privileged service operation or worker ACK was introduced.

## Final review corrections — private GLib bus and live owner

The second model review identified two P2 issues: `dbus.SystemBus` may reuse a
cached connection with no GLib main loop, causing signal registration failure;
and a hardcoded `:1.5` in the live test could cause early refusal before
subscription. The listener now constructs a distinct
`dbus.bus.BusConnection(BUS_SYSTEM, mainloop=DBusGMainLoop(...))` and
closes it on every exit. The live test resolves the current systemd owner
first, then demands the quiet-subscription timeout refusal rather than a
pre-subscription mismatch. All source is still non-authorizing, and no
privileged job creation occurred.

## Restricted-host live-test qualification

A third model review identified a portability gap: some Linux hosts allow
systemd owner lookup but deny Subscribe, or lack GLib. The live test now
skips only explicit unavailable prerequisites (system-bus access denial or
missing GLib/dbus bindings) while still failing on unexpected observer
behavior. A mocked Subscribe-failure regression verifies the listener match
and private connection are closed. The full 9-test focused suite passes;
these skips provide **no positive live job-completion evidence**. Human
security review and privileged VM qualification remain outstanding.
