# GE-04 systemd manager observation — read-only, security hold

**Status:** Engineering diagnostic only. R1-B1 OPEN; GE-04 SECURITY HOLD ACTIVE.

`native/ge04/systemd_unit_observer.py` now queries the actual system D-Bus
for `org.freedesktop.systemd1`, pins its unique bus name for all calls and
requires a root UID bus owner. It calls the **read-only** Manager.GetUnit on
exactly `ge04-r1b2-view-qualification.service`, rejects any alternate object
path, and reads the Unit/Service property maps twice. It checks the exact
loaded/active/running state, 128-bit invocation ID, fixed control group,
MainPID and zero NRestarts, and refuses changed manager owner or properties.

The observer **never** calls StartTransientUnit, LoadUnit, StartUnit,
SetProperty, StopUnit or any mutating method; an absent unit is a refusal.
The unprivileged `ideapad` diagnostic on 2026-11-09 confirmed a real root-owned
systemd bus owner and `org.freedesktop.systemd1.NoSuchUnit` for the fixed unit.
Four local tests cover exact property parsing, mismatch/missing identity
fields, path substitutions and live absent-unit refusal. An actual present
qualification unit was **not** observed; no privileged unit was created.

This does not prove original unit absence *before birth*, or that the manager
properties derive from a controller-owned approved creation. It does not pin
the keeper's PID generation, mount namespace, cgroup FDs, original protected
journal, witness, or restart/recovery attempt. A root-owned D-Bus server can
report current service properties; **current properties are not proof of
pre-birth authorization**. No ACK or production admission follows.

The current `bootstrap_publisher.py` still uses independently supplied
manager/kernel callbacks. Integrating this observer into a root controller
requires separate source/root-scope review, original prebirth custody,
independent kernel/cgroup comparison, a controlled disposable VM run and
explicit Q13 acceptance. Do not run anything privileged from this file.

## Model review correction

Separate read-only Codex review found a P2 interface error: the initial
implementation requested `ControlGroup` from the Unit property map, but
systemd exposes it on `org.freedesktop.systemd1.Service`. Corrected the
property interface and added an integration-shaped mocked D-Bus test with
separate realistic Unit and Service responses. The test verifies the positive
path and changed-property resampling refusal. Focused suite now **5/5 PASS**.
This engineering review is not independent human root/source approval.
