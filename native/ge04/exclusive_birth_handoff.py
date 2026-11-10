"""GE-04 exclusive new-unit birth handoff contract — NO systemd mutation.

All evidence comes from callers. Models the *required* ordering and rejection
criteria for a future separately reviewed protected issuer. Even a positive
result is UNQUALIFIED; no CreateUnit, ACK, privileged action or root publisher.
"""
import hashlib
import json
import re
from collections.abc import Mapping
from types import MappingProxyType

from bootstrap_binding import UNIT
from prebirth_issuance_contract import canonical_prebirth

_OWNER = re.compile(r":[0-9]+\.[0-9]+")
_JOB = re.compile(r"/org/freedesktop/systemd1/job/[1-9][0-9]{0,18}")
_ABSENCE = frozenset(("status", "unit", "managerOwner"))
_RECEIPT = frozenset(("unit", "method", "mode", "managerOwner", "jobPath",
                      "attempt", "nonce", "prebirthSha256"))
_BIRTH = frozenset(("status", "owner", "properties"))
_JOB_COMPLETION = frozenset(("unit", "managerOwner", "jobPath", "result", "prebirthSha256"))


def _exact(value, fields):
    if not isinstance(value, Mapping) or frozenset(value) != fields:
        raise ValueError("Incomplete exclusive birth evidence")


def canonical_absence(value):
    _exact(value, _ABSENCE)
    if (value["status"] != "UNQUALIFIED_SYSTEMD_ABSENCE_OBSERVATION"
            or value["unit"] != UNIT or type(value["managerOwner"]) is not str
            or _OWNER.fullmatch(value["managerOwner"]) is None):
        raise ValueError("Missing or changed systemd absence evidence")
    return MappingProxyType(value.copy())


def canonical_creation_receipt(value):
    _exact(value, _RECEIPT)
    if (value["unit"] != UNIT or value["method"] != "StartTransientUnit"
            or value["mode"] != "fail"
            or type(value["managerOwner"]) is not str
            or _OWNER.fullmatch(value["managerOwner"]) is None
            or type(value["jobPath"]) is not str
            or _JOB.fullmatch(value["jobPath"]) is None
            or type(value["attempt"]) is not int
            or not 0 < value["attempt"] < 2**63
            or type(value["nonce"]) is not str
            or re.fullmatch(r"[0-9a-f]{64}", value["nonce"]) is None
            or type(value["prebirthSha256"]) is not str
            or re.fullmatch(r"[0-9a-f]{64}", value["prebirthSha256"]) is None):
        raise ValueError("Invalid new-unit creation claim")
    return MappingProxyType(value.copy())


class ExclusiveUnitBirthHandoff:
    """Only diagnostic transitions, never a factory for privileged authority.

    Positive values may be fabricated by one caller. Neither this class nor
    the existing read-only bus observers reserves a unit or authenticates a
    creation job; the real issuer MUST be a protected separate implementation.
    """
    __slots__ = ("_intent", "_digest", "_state", "_owner", "_job",
                 "_failure", "_result")

    def __init__(self, prebirth, journal, absence):
        self._state = "QUARANTINED"
        self._failure = "INITIAL_ORIGIN_UNVERIFIED"
        self._result = None
        self._job = None
        self._owner = None
        self._intent = None
        self._digest = None
        original = canonical_prebirth(prebirth)
        if (not isinstance(journal, Mapping)
                or frozenset(journal) != {"status", "recordBytes"}
                or journal["status"] != "UNQUALIFIED_FIXTURE_PREBIRTH_PERSISTED"
                or type(journal["recordBytes"]) is not bytes
                or journal["recordBytes"] != original):
            raise ValueError("Original journal bytes are absent or inconsistent")
        observed = canonical_absence(absence)
        self._intent = MappingProxyType(json.loads(original))
        self._digest = hashlib.sha256(original).hexdigest()
        self._owner = observed["managerOwner"]
        self._state = "PREBIRTH_OBSERVED"
        self._failure = None

    @property
    def status(self):
        return "UNQUALIFIED_" + self._state

    @property
    def reason(self):
        return self._failure

    def quarantine(self, reason="UNRESOLVED_UNIT_BIRTH"):
        self._state = "QUARANTINED"
        self._job = None
        self._result = None
        self._failure = reason
        return self.status

    def submit_creation_claim(self, receipt):
        if self._state != "PREBIRTH_OBSERVED":
            self.quarantine("REPLAY_OR_MISSING_PREBIRTH")
            raise ValueError("No original pending prebirth for exclusive creation")
        try:
            claim = canonical_creation_receipt(receipt)
            if (claim["managerOwner"] != self._owner
                    or claim["attempt"] != self._intent["attempt"]
                    or claim["nonce"] != self._intent["nonce"]
                    or claim["prebirthSha256"] != self._digest):
                raise ValueError("Creation claim not bound to original")
            self._job = claim["jobPath"]
            self._state = "CREATION_CLAIMED"
            return self.status
        except Exception:
            self.quarantine("MISSING_OR_CONTRADICTORY_CREATION")
            raise

    def corroborate_job_completion(self, completion):
        if self._state != "CREATION_CLAIMED":
            self.quarantine("REPLAY_OR_UNISSUED_JOB_COMPLETION")
            raise ValueError("No original claimed creation job")
        try:
            _exact(completion, _JOB_COMPLETION)
            if (completion["unit"] != UNIT
                    or completion["managerOwner"] != self._owner
                    or completion["jobPath"] != self._job
                    or completion["result"] != "done"
                    or completion["prebirthSha256"] != self._digest):
                raise ValueError("Mismatched or failed systemd creation job")
            self._state = "JOB_COMPLETION_CLAIMED"
            return self.status
        except Exception:
            self.quarantine("UNBOUND_OR_FAILED_CREATION_JOB")
            raise

    def corroborate_birth(self, birth_observation):
        if self._state != "JOB_COMPLETION_CLAIMED":
            self.quarantine("REPLAY_OR_UNISSUED_BIRTH")
            raise ValueError("No exclusive creation claim")
        try:
            _exact(birth_observation, _BIRTH)
            if (birth_observation["status"] != "UNQUALIFIED_SYSTEMD_MANAGER_OBSERVATION"
                    or birth_observation["owner"] != self._owner):
                raise ValueError("Manager changed across unit creation")
            props = birth_observation["properties"]
            expected = frozenset(("unit", "invocation", "mainPid", "controlGroup",
                                  "activeState", "subState", "restartCount",
                                  "objectPath"))
            if not isinstance(props, Mapping) or frozenset(props) != expected:
                raise ValueError("Missing exact manager birth properties")
            if (props["unit"] != UNIT
                    or type(props["invocation"]) is not str
                    or re.fullmatch(r"[0-9a-f]{32}", props["invocation"]) is None
                    or props["controlGroup"] != "/system.slice/" + UNIT
                    or props["activeState"] != "active"
                    or props["subState"] != "running"
                    or type(props["restartCount"]) is not int
                    or props["restartCount"] != 0
                    or type(props["mainPid"]) is not int
                    or not 2 <= props["mainPid"] <= 2**31 - 1
                    or props["objectPath"] !=
                    "/org/freedesktop/systemd1/unit/ge04_2dr1b2_2dview_2dqualification_2eservice"):
                raise ValueError("Unexpected fixed unit birth generation")
            # A job path plus current unit observation cannot establish that
            # this job created the unit; its completion and exclusive link
            # need separate protected manager evidence.
            self._result = MappingProxyType({
                "status": "UNQUALIFIED_BIRTH_HANDOFF_CORRELATION",
                "jobPath": self._job,
                "invocation": props["invocation"],
                "keeperPid": props["mainPid"],
                "managerOwner": self._owner,
                "prebirthSha256": self._digest,
            })
            self._state = "BIRTH_CORRELATED"
            return self._result
        except Exception:
            self.quarantine("AMBIGUOUS_OR_ADOPTED_UNIT")
            raise

    def recover(self, *_args, **_kwargs):
        self.quarantine("CRASH_REQUIRES_INDEPENDENT_RECOVERY")
        raise PermissionError("GE-04 SECURITY HOLD: no recovery authority")

    def create_unit(self, *_args, **_kwargs):
        raise PermissionError("GE-04 SECURITY HOLD: no systemd creation authority")

    def issue_ack(self, *_args, **_kwargs):
        raise PermissionError("GE-04 SECURITY HOLD: no worker ACK authority")
