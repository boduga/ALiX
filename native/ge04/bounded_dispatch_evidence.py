"""GE-04 bounded dispatch evidence reducer (unprivileged, non-authorizing).

A caller can forge every event, timestamp and cookie. Equality and ordering
are diagnostics only, never transport authentication or permission to send.
"""
from types import MappingProxyType

_FIELDS = ("kind", "manager", "requestSerial", "jobPath", "elapsedMs")
_KINDS = ("INTENT", "SEND_ATTEMPTED", "REPLY", "JOB_REMOVED")
_MAX_MS = 3000


class DispatchEvidenceDiagnostic:
    __slots__ = ("_manager", "_serial", "_job", "_state", "_last_ms")

    def __init__(self, manager, serial):
        if type(manager) is not str or not manager.startswith(":") or len(manager) > 256:
            raise ValueError("Invalid manager")
        if type(serial) is not int or serial <= 0:
            raise ValueError("Invalid serial")
        self._manager, self._serial = manager, serial
        self._job, self._state, self._last_ms = None, 0, -1

    @property
    def status(self):
        return "QUARANTINED" if self._state == -1 else "UNQUALIFIED"

    def observe(self, event):
        if self._state == -1:
            raise ValueError("Dispatch evidence quarantined")
        try:
            if type(event) is not dict or set(event) != set(_FIELDS):
                raise ValueError("Malformed dispatch event")
            kind = event["kind"]
            ms = event["elapsedMs"]
            serial = event["requestSerial"]
            manager = event["manager"]
            job = event["jobPath"]
            if (kind not in _KINDS or type(ms) is not int or ms < 0
                    or ms > _MAX_MS or ms < self._last_ms
                    or type(serial) is not int or serial != self._serial
                    or type(manager) is not str or manager != self._manager
                    or type(job) is not str or len(job) > 256
                    or (kind in ("INTENT", "SEND_ATTEMPTED") and job != "")
                    or (kind in ("REPLY", "JOB_REMOVED")
                        and not job.startswith("/org/freedesktop/systemd1/job/"))):
                raise ValueError("Unbound, late or substituted event")
            if self._state >= len(_KINDS) or kind != _KINDS[self._state]:
                raise ValueError("Duplicate or out-of-order event")
            if kind == "REPLY":
                self._job = job
            if kind == "JOB_REMOVED" and job != self._job:
                raise ValueError("Substituted job")
            self._last_ms = ms
            self._state += 1
        except Exception:
            self._state = -1
            raise
        return MappingProxyType({
            "status": "UNQUALIFIED_CALLER_SUPPLIED_EVIDENCE",
            "observedCount": self._state,
            "authorized": False,
            "gatesCleared": (),
        })

    def process_loss(self):
        self._state = -1

    def authorize_send(self):
        self._state = -1
        raise PermissionError("GE-04 SECURITY HOLD: no sender")

    def issue_ack(self):
        self._state = -1
        raise PermissionError("GE-04 SECURITY HOLD: no ACK")
