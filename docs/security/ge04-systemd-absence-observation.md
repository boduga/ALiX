# GE-04 — fixed systemd unit absence observation (read-only)

**Qualification only. R1-B1 OPEN. GE-04 SECURITY HOLD ACTIVE.**

The fixed pre-birth contract previously used a caller-controlled boolean for
`unit_absent_before_creation`. The unprivileged journal fixture separately
accepted an arbitrary absence callback. Neither established actual systemd
manager state, even momentarily.

`native/ge04/systemd_absence_observer.py` now reads the **actual system bus**
without creating or adopting any unit. It pins a unique root-owned
`org.freedesktop.systemd1` manager owner, uses a fixed service name
`ge04-r1b2-view-qualification.service`, and repeats the following exact
negative checks twice: `Manager.GetUnit` must return the D-Bus error
`org.freedesktop.systemd1.NoSuchUnit`, and `Manager.GetUnitFileState`
must return `org.freedesktop.DBus.Error.FileNotFound`. A loaded unit,
installed unit file, changed manager owner/UID, ambiguous bus error,
noncanonical error name, or unavailable bus is refusal.

The only positive result is
`UNQUALIFIED_SYSTEMD_ABSENCE_OBSERVATION`. This is a **read-only observation
of absence at two instants**, not a reservation, lock, exclusive birth
transaction, or durable authority.

`prebirth_fixture_journal.publish_observed_fixture_once` optionally uses
this exact real manager read before the fixture write and after the file
and directory fsync. It still writes **only** a user-owned 0700 temporary
directory, never a root-owned work directory. Existing original-file inode,
durable ordering simulation, replay refusal, root execution denial and
quarantine-on-reopen behavior remain unchanged.

## Non-negotiable limits

- Two `GetUnit` negatives do **not** make absence-to-create atomic. A unit
  may appear after either query. A real privileged issuer must resolve this
  with exclusive creation semantics and independently observed original birth.
- `GetUnitFileState` is negative evidence about the fixed unit file at the
  time of query, not proof against every transient alias or subsequent unit
  creation. Systemd manager and kernel custody must be verified again at
  the final root mutation boundary, after human review.
- A root-owned D-Bus manager does not authenticate the **caller-supplied**
  journal nonce, attempt, publisher, original source hashes or original
  pre-birth creation order.
- The optional fixture is not a root publisher. No service is created,
  no cgroup is mutated, no privilege is acquired and no ACK is sent.
  `publish_root_bootstrap` and the native default build remain denied.
- Negative live observations and synthetic tests are not B1-B approval or
  Q13 security acceptance; the root controller, protected issuer and
  authorized disposable-VM qualification remain blocked.

The focused tests exercise exact two-sample negatives, installed/loaded unit,
owner substitution, malformed systemd errors, real read-only bus observation
and fixture wiring. They do not create or manage any systemd unit.
