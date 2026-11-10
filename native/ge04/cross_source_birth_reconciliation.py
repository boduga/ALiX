"""GE-04 cross-source birth reconciliation, pure and NON-AUTHORIZING.

Consumes separately supplied original/birth/job/manager/kernel diagnostics.
Every claim is forgeable by its caller. No root issuance, unit creation,
native ACK, policy bypass, recovery or production consumer.
"""
import hashlib
import json
from collections.abc import Mapping
from types import MappingProxyType

from bootstrap_binding import UNIT, FIELDS, parse_bootstrap_binding
from exclusive_birth_handoff import ExclusiveUnitBirthHandoff
from prebirth_issuance_contract import canonical_prebirth, canonical_birth
from systemd_job_event_contract import job_removed_diagnostic

_EXPECTED_KERNEL = frozenset(("status", "pid", "startticks", "mount", "cgroup"))
_EXPECTED_ORIGINAL = frozenset(FIELDS)
_FIXED_SCOPE = "/system.slice/" + UNIT


def _original(record):
    if not isinstance(record, Mapping) or frozenset(record) != _EXPECTED_ORIGINAL:
        raise ValueError("Missing exact original postbirth binding")
    data = dict(record)
    if isinstance(data.get("ancestry"), tuple):
        data["ancestry"] = [list(pair) for pair in data["ancestry"]]
    raw = (json.dumps(data, sort_keys=True, separators=(",", ":")) +
           "\n").encode("ascii")
    return parse_bootstrap_binding(raw)


def reconcile_birth_packet(*, prebirth, journal, absence, creation,
                           job_event, live_signal, completion, manager, original,
                           kernel, birth_claim):
    """Verify one packet's cross-source consistency; never authorize.

    All packet inputs are caller-provided. A fresh handoff is built for
    each invocation; global replay prevention cannot be established here.
    This function cannot prove source independence or event subscription
    preceding original exclusive creation.
    """
    raw = canonical_prebirth(prebirth)
    canonical_birth(birth_claim)
    expected_hash = hashlib.sha256(raw).hexdigest()
    post = _original(original)
    if (post["unit"] != UNIT or post["attempt"] != prebirth["attempt"]
            or post["nonce"] != prebirth["nonce"]
            or post["sourceSha256"] != prebirth["sourceSha256"]
            or post["controllerSha256"] != prebirth["controllerSha256"]):
        raise ValueError("Original postbirth record contradicts prebirth")

    handoff = ExclusiveUnitBirthHandoff(prebirth, journal, absence)
    try:
        handoff.submit_creation_claim(creation)
        expected = {
            "managerOwner": creation["managerOwner"],
            "jobPath": creation["jobPath"], "unit": UNIT,
        }
        result = job_removed_diagnostic(job_event, expected)
        # The actual bounded listener returns only this exact unqualified
        # summary. It must not be treated as an original source attestation.
        if (not isinstance(live_signal, Mapping) or frozenset(live_signal) !=
                {"status", "managerOwner", "jobPath", "unit", "result"}
                or live_signal["status"] !=
                   "UNQUALIFIED_LIVE_SYSTEMD_JOB_SIGNAL"
                or live_signal["managerOwner"] != expected["managerOwner"]
                or live_signal["jobPath"] != expected["jobPath"]
                or live_signal["unit"] != UNIT
                or live_signal["result"] != "done"):
            raise ValueError("No exact unqualified live job signal correlation")
        if (result["result"] != "done" or completion["prebirthSha256"] !=
                expected_hash):
            raise ValueError("Job event does not bind original attempt")
        handoff.corroborate_job_completion(completion)
        handoff_result = handoff.corroborate_birth(manager)
        if (not isinstance(kernel, Mapping) or frozenset(kernel) !=
                _EXPECTED_KERNEL or
                kernel["status"] != "UNQUALIFIED_KERNEL_UNIT_CORRELATION"
                or type(kernel["pid"]) is not int
                or kernel["pid"] != post["keeperPid"]
                or type(kernel["startticks"]) is not int
                or kernel["startticks"] != post["keeperTicks"]
                or tuple(kernel["mount"]) !=
                   (post["mountId"], post["mountDevice"])
                or kernel["cgroup"] != _FIXED_SCOPE):
            raise ValueError("Kernel generation and mount inconsistent")
        props = manager["properties"]
        if (handoff_result["invocation"] != post["invocation"]
                or handoff_result["keeperPid"] != post["keeperPid"]
                or handoff_result["prebirthSha256"] != expected_hash
                or handoff_result["managerOwner"] != absence["managerOwner"]
                or props["mainPid"] != kernel["pid"]
                or birth_claim["invocation"] != post["invocation"]
                or birth_claim["keeperPid"] != post["keeperPid"]
                or birth_claim["keeperTicks"] != post["keeperTicks"]
                or birth_claim["mountId"] != post["mountId"]
                or birth_claim["mountDevice"] != post["mountDevice"]
                or birth_claim["mountRoot"] != post["mountRoot"]
                or tuple(tuple(pair) for pair in birth_claim["ancestry"]) !=
                   post["ancestry"]
                or birth_claim["attempt"] != post["attempt"]
                or birth_claim["nonce"] != post["nonce"]
                or birth_claim["unit"] != UNIT
                or birth_claim["bootId"] != prebirth["bootId"]
                or birth_claim["restartCount"] != 0):
            raise ValueError("Cross-source original/manager/kernel disagreement")
        # Validation of the entire postbirth shape, beyond accessed claims.
        return MappingProxyType({
            "status": "UNQUALIFIED_CROSS_SOURCE_BIRTH_CORRELATION",
            "prebirthSha256": expected_hash,
            "jobPath": creation["jobPath"],
            "invocation": post["invocation"],
            "keeperPid": post["keeperPid"],
            "keeperTicks": post["keeperTicks"],
            "managerOwner": absence["managerOwner"],
        })
    except Exception:
        handoff.quarantine("CROSS_SOURCE_CONTRADICTION")
        raise


class OneShotBirthPacket:
    """In-memory one-shot diagnostic only; no persistence or global replay lock."""

    __slots__ = ("_used", "_result", "_quarantined")

    def __init__(self):
        self._used = False
        self._result = None
        self._quarantined = False

    @property
    def status(self):
        if self._quarantined:
            return "UNQUALIFIED_QUARANTINED"
        if self._used:
            return "UNQUALIFIED_PACKET_CORRELATED"
        return "UNQUALIFIED_AWAITING_PACKET"

    def accept(self, **packet):
        if self._used or self._quarantined:
            self._quarantined = True
            self._result = None
            raise ValueError("Replayed or invalid cross-source packet")
        # No second chance, even if this first observation fails.
        self._used = True
        try:
            self._result = reconcile_birth_packet(**packet)
            return self._result
        except Exception:
            self._quarantined = True
            self._result = None
            raise

    def recover(self):
        self._quarantined = True
        self._result = None
        raise PermissionError("GE-04 SECURITY HOLD: no original replay recovery")

    def issue_ack(self):
        raise PermissionError("GE-04 SECURITY HOLD: no trusted phase ACK")

    def create_unit(self):
        raise PermissionError("GE-04 SECURITY HOLD: no privileged unit creation")
