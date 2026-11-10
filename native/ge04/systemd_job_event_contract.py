"""GE-04 systemd JobRemoved event correlation, read-only and UNQUALIFIED.

Pure validation of a manager-emitted event *candidate*. An injected event is
forgeable and cannot prove who subscribed, who created the job or who made
the original request. No systemd calls, root execution or ACK authority.
"""
import re
from collections.abc import Mapping
from types import MappingProxyType

from systemd_unit_observer import UNIT

_JOB = re.compile(r"/org/freedesktop/systemd1/job/([1-9][0-9]{0,18})")
_OWNER = re.compile(r":[0-9]+\.[0-9]+")
_FIELDS = frozenset(("sender", "jobId", "jobPath", "unit", "result"))
_EXPECTED = frozenset(("managerOwner", "jobPath", "unit"))


def job_removed_diagnostic(event, expected):
    """Validate exact name/path/id/sender and completion outcome.

    A positive result is only UNQUALIFIED: the event is caller-supplied.
    """
    if (not isinstance(event, Mapping) or frozenset(event) != _FIELDS
            or not isinstance(expected, Mapping)
            or frozenset(expected) != _EXPECTED):
        raise ValueError("Incomplete manager job event")
    job = event["jobPath"]
    if type(job) is not str:
        raise ValueError("Malformed systemd job object path")
    match = _JOB.fullmatch(job)
    if match is None:
        raise ValueError("Malformed systemd job identity")
    if (type(event["jobId"]) is not int or event["jobId"] != int(match[1])
            or type(expected["managerOwner"]) is not str
            or _OWNER.fullmatch(expected["managerOwner"]) is None
            or event["sender"] != expected["managerOwner"]
            or event["unit"] != UNIT or expected["unit"] != UNIT
            or event["jobPath"] != expected["jobPath"]
            or event["result"] != "done"):
        raise ValueError("Unbound, failed or substituted systemd job")
    return MappingProxyType({
        "status": "UNQUALIFIED_SYSTEMD_JOB_EVENT_CORRELATION",
        "jobPath": job,
        "managerOwner": expected["managerOwner"],
        "unit": UNIT,
        "result": "done",
    })


class JobEventWindow:
    """One-shot event window, poison-on-any-ambiguity. Never issues ACK."""

    __slots__ = ("_expected", "_open", "_quarantined", "_observed")

    def __init__(self, expected):
        if not isinstance(expected, Mapping) or frozenset(expected) != _EXPECTED:
            raise ValueError("Missing expected original systemd job")
        if (type(expected["managerOwner"]) is not str
                or _OWNER.fullmatch(expected["managerOwner"]) is None
                or type(expected["jobPath"]) is not str
                or _JOB.fullmatch(expected["jobPath"]) is None
                or expected["unit"] != UNIT):
            raise ValueError("Invalid original job identity")
        self._expected = dict(expected)
        self._open = True
        self._quarantined = False
        self._observed = None

    @property
    def status(self):
        return ("UNQUALIFIED_QUARANTINED" if self._quarantined
                else "UNQUALIFIED_JOB_CORRELATED" if self._observed
                else "UNQUALIFIED_AWAITING_JOB")

    def accept(self, event):
        if self._quarantined or not self._open:
            self.quarantine()
            raise ValueError("Repeated or terminal job event")
        try:
            result = job_removed_diagnostic(event, self._expected)
            self._observed = result
            self._open = False
            return result
        except Exception:
            self.quarantine()
            raise

    def quarantine(self):
        self._quarantined = True
        self._open = False
        self._observed = None

    def issue_ack(self, *_args, **_kwargs):
        raise PermissionError("GE-04 SECURITY HOLD: no job-event ACK authority")
