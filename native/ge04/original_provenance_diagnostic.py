"""GE-04 B1-B/C provenance comparison. Diagnostic only; never authority.

All observations are caller supplied. No root, D-Bus, filesystem or ACK effects.
"""
from collections.abc import Mapping
from types import MappingProxyType

_FIELDS = ("boot", "attempt", "manager", "unit", "requestSerial",
           "invocation", "keeperGeneration", "keeperPidfd",
           "namespace", "mountId", "superblock", "mountRoot",
           "unitCgroup", "outerCgroup", "launcherCgroup", "payloadCgroup")
_POSITIVE = ("requestSerial", "keeperGeneration", "keeperPidfd", "mountId")
_UNTRUSTED = "UNQUALIFIED_CALLER_SUPPLIED_PROVENANCE"


def _canonical(record):
    if not isinstance(record, Mapping) or set(record) != set(_FIELDS):
        raise ValueError("Incomplete B1-B/C provenance record")
    values = {}
    for key in _FIELDS:
        value = record[key]
        if key in _POSITIVE:
            if type(value) is not int or value <= 0:
                raise ValueError("Invalid provenance identity: " + key)
        elif type(value) is not str or not value or len(value) > 256:
            raise ValueError("Invalid provenance identity: " + key)
        values[key] = value
    return MappingProxyType(values)


class OriginalProvenanceDiagnostic:
    """One-use equality check; any ambiguity permanently quarantines."""

    __slots__ = ("_original", "_consumed", "_quarantined")

    def __init__(self, original):
        self._original = _canonical(original)
        self._consumed = False
        self._quarantined = False

    @property
    def status(self):
        return "QUARANTINED" if self._quarantined else _UNTRUSTED

    def compare(self, observed):
        if self._consumed or self._quarantined:
            self._quarantined = True
            raise ValueError("Provenance comparison consumed or quarantined")
        self._consumed = True
        try:
            candidate = _canonical(observed)
            if any(self._original[k] != candidate[k] for k in _FIELDS):
                raise ValueError("Original provenance substitution")
        except Exception:
            self._quarantined = True
            raise
        return MappingProxyType({
            "status": _UNTRUSTED,
            "equal": True,
            "authority": False,
            "gatesCleared": (),
        })

    def authorize_send(self, *_a, **_kw):
        self._quarantined = True
        raise PermissionError("GE-04 SECURITY HOLD: no systemd sender")

    def issue_ack(self, *_a, **_kw):
        self._quarantined = True
        raise PermissionError("GE-04 SECURITY HOLD: no ACK")
